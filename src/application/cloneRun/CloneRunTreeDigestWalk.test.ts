import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect, it, vi } from "vitest";

import { readWithoutFifoWriter } from "../../../tests/fixtures/fifoInput.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import {
  digestCloneTree,
  digestOriginalMaterial,
} from "./CloneRunTreeDigest.js";

/**
 * What the tree walk does with an entry that changes or cannot be read while
 * it runs. `open` is the one call a file is read through, so the tests stand
 * in front of it instead of racing the walk.
 */
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

const actualFs =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

afterEach(() => {
  vi.mocked(fs.open).mockReset();
  vi.mocked(fs.open).mockImplementation(actualFs.open);
});

const tree = async (): Promise<string> => {
  const root = join(await createTestTempDirectory("clone-tree-walk-"), "clone");
  await fs.mkdir(join(root, "src"), { recursive: true });
  await fs.writeFile(join(root, "a.mjs"), "export const a = 1;\n");
  await fs.writeFile(join(root, "src", "b.mjs"), "export const b = 2;\n");
  return root;
};

const digest = async (root: string) => {
  const result = await digestCloneTree(root, []);
  if (!result.ok) throw result.error;
  return result.value;
};

/** Stand in front of the read of one path; every other file is read as it is. */
const beforeReading = (path: string, act: () => Promise<void>): void => {
  vi.mocked(fs.open).mockImplementation(async (...args) => {
    if (args[0] === path) await act();
    return actualFs.open(...args);
  });
};

it("skips a file that vanishes between the listing and the read, as if it had never been there", async () => {
  const root = await tree();
  const gone = join(root, "src", "b.mjs");
  beforeReading(gone, () => fs.rm(gone));
  const during = await digest(root);
  expect(during.files.map(({ path }) => path)).toEqual(["a.mjs"]);
  expect(during.unreadable).toEqual([]);
  // The digest is the digest of the tree without it, so a capture bound to it is stale as soon as the file is back.
  vi.mocked(fs.open).mockImplementation(actualFs.open);
  expect((await digest(root)).sha256).toBe(during.sha256);
  await fs.writeFile(gone, "export const b = 2;\n");
  expect((await digest(root)).sha256).not.toBe(during.sha256);
});

it("lists a file it could not read, and never leaves it out silently", async () => {
  const root = await tree();
  const denied = join(root, "src", "b.mjs");
  vi.mocked(fs.open).mockImplementation((...args) =>
    args[0] === denied
      ? Promise.reject(
          Object.assign(new Error("EACCES: permission denied, open"), {
            code: "EACCES",
          }),
        )
      : actualFs.open(...args),
  );
  const snapshot = await digest(root);
  expect(snapshot.files.map(({ path }) => path)).toEqual(["a.mjs"]);
  expect(snapshot.unreadable).toEqual([
    { path: "src/b.mjs", detail: "EACCES: permission denied, open" },
  ]);
});

it("does not follow a link that replaced a file between the listing and the read", async () => {
  const root = await tree();
  const outside = join(root, "..", "outside.mjs");
  await fs.writeFile(outside, "export const outside = 1;\n");
  const swapped = join(root, "a.mjs");
  beforeReading(swapped, async () => {
    await fs.rm(swapped);
    await fs.symlink(outside, swapped);
  });
  const snapshot = await digest(root);
  // The outside file's bytes are never hashed as the clone's: the entry is reported, not read through.
  expect(snapshot.files.map(({ path }) => path)).toEqual(["src/b.mjs"]);
  expect(snapshot.unreadable.map(({ path }) => path)).toEqual(["a.mjs"]);
});

it.skipIf(process.platform === "win32")(
  "never opens a special file, in the clone or in the original material",
  async () => {
    const root = await tree();
    const before = await digest(root);
    const pipe = join(root, "src", "events.pipe");
    await promisify(execFile)("mkfifo", [pipe]);
    const walked = await readWithoutFifoWriter(pipe, async () => ({
      clone: await digest(root),
      material: await digestOriginalMaterial(root),
      // Read here: the helper itself opens the pipe afterwards to release a reader that waits.
      opened: vi.mocked(fs.open).mock.calls.map(([path]) => path),
    }));
    if (walked.state !== "completed")
      throw new Error("The walk waited for a writer on a named pipe");
    // It is neither a file nor a link: not digested, not unreadable, and it changes no digest.
    expect(walked.result.clone).toEqual(before);
    expect(
      walked.result.material.ok &&
        walked.result.material.value.files.map(({ path }) => path),
    ).toEqual(["a.mjs", "src/b.mjs"]);
    // Two regular files, read by each of the three walks of this test.
    expect(walked.result.opened).toHaveLength(6);
    expect(walked.result.opened).not.toContain(pipe);
  },
);
