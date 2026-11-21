import { execFile } from "node:child_process";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { readWithoutFifoWriter } from "../../../tests/fixtures/fifoInput.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import {
  digestCloneTree,
  digestOriginalMaterial,
  readCloneTreeFile,
} from "./CloneRunTreeDigest.js";

/**
 * What the tree walk does with an entry that changes or cannot be read while
 * it runs. A file is read through one port, so the tests stand in front of it
 * instead of racing the walk; what follows is the walk's own code.
 */

const tree = async (): Promise<string> => {
  const root = join(await createTestTempDirectory("clone-tree-walk-"), "clone");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "a.mjs"), "export const a = 1;\n");
  await writeFile(join(root, "src", "b.mjs"), "export const b = 2;\n");
  return root;
};

const digest = async (root: string, readFile?: typeof readCloneTreeFile) => {
  const result = await digestCloneTree(
    root,
    [],
    readFile === undefined ? {} : { readFile },
  );
  if (!result.ok) throw result.error;
  return result.value;
};

/** The real read, after `act` has run once in front of the read of `path`. */
const beforeReading =
  (path: string, act: () => Promise<void>): typeof readCloneTreeFile =>
  async (file, onChunk) => {
    if (file === path) await act();
    return readCloneTreeFile(file, onChunk);
  };

it("skips a file that vanishes between the listing and the read, as if it had never been there", async () => {
  const root = await tree();
  const gone = join(root, "src", "b.mjs");
  const during = await digest(
    root,
    beforeReading(gone, () => rm(gone)),
  );
  expect(during.files.map(({ path }) => path)).toEqual(["a.mjs"]);
  expect(during.unreadable).toEqual([]);
  // The digest is the digest of the tree without it, so a capture bound to it is stale as soon as the file is back.
  expect((await digest(root)).sha256).toBe(during.sha256);
  await writeFile(gone, "export const b = 2;\n");
  expect((await digest(root)).sha256).not.toBe(during.sha256);
});

it("lists a file it could not read, and never leaves it out silently", async () => {
  const root = await tree();
  const denied = join(root, "src", "b.mjs");
  const snapshot = await digest(root, (file, onChunk) =>
    file === denied
      ? Promise.reject(
          Object.assign(new Error("EACCES: permission denied, open"), {
            code: "EACCES",
          }),
        )
      : readCloneTreeFile(file, onChunk),
  );
  expect(snapshot.files.map(({ path }) => path)).toEqual(["a.mjs"]);
  expect(snapshot.unreadable).toEqual([
    { path: "src/b.mjs", detail: "EACCES: permission denied, open" },
  ]);
});

it("does not follow a link that replaced a file between the listing and the read", async () => {
  const root = await tree();
  const outside = join(root, "..", "outside.mjs");
  await writeFile(outside, "export const outside = 1;\n");
  const swapped = join(root, "a.mjs");
  const snapshot = await digest(
    root,
    beforeReading(swapped, async () => {
      await rm(swapped);
      await symlink(outside, swapped);
    }),
  );
  // The outside file's bytes are never hashed as the clone's: the entry is reported, not read through.
  expect(snapshot.files.map(({ path }) => path)).toEqual(["src/b.mjs"]);
  expect(snapshot.unreadable.map(({ path }) => path)).toEqual(["a.mjs"]);
});

it.skipIf(process.platform === "win32")(
  "never reads a special file, in the clone or in the original material",
  async () => {
    const root = await tree();
    const before = await digest(root);
    const pipe = join(root, "src", "events.pipe");
    await promisify(execFile)("mkfifo", [pipe]);
    const read: string[] = [];
    const walked = await readWithoutFifoWriter(pipe, async () => ({
      clone: await digest(root, (file, onChunk) => {
        read.push(file);
        return readCloneTreeFile(file, onChunk);
      }),
      material: await digestOriginalMaterial(root),
    }));
    if (walked.state !== "completed")
      throw new Error("The walk waited for a writer on a named pipe");
    // It is neither a file nor a link: not digested, not unreadable, and it changes no digest.
    expect(walked.result.clone).toEqual(before);
    expect(read.toSorted()).toEqual([
      join(root, "a.mjs"),
      join(root, "src", "b.mjs"),
    ]);
    expect(
      walked.result.material.ok &&
        walked.result.material.value.files.map(({ path }) => path),
    ).toEqual(["a.mjs", "src/b.mjs"]);
  },
);
