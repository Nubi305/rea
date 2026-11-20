import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { sha256Hex } from "../../kernel/sha256Hex.js";
import {
  cloneTreeSha256,
  digestCloneTree,
  isCloneTreePathExcluded,
} from "./CloneRunTreeDigest.js";

const digest = async (root: string, exclude: readonly string[] = []) => {
  const result = await digestCloneTree(root, exclude);
  if (!result.ok) throw result.error;
  return result.value;
};

it("excludes on whole leading path segments only", () => {
  const exclude = [".git", "./build/", "data/cache", "."];
  expect(
    [
      ".git",
      ".git/config",
      ".gitignore",
      "build/app.js",
      "builder/app.js",
      "data/cache/a",
      "data/cached",
      "src/.git",
      "server.mjs",
    ].filter((path) => !isCloneTreePathExcluded(path, exclude)),
  ).toEqual([
    ".gitignore",
    "builder/app.js",
    "data/cached",
    "src/.git",
    "server.mjs",
  ]);
});

it("covers every file in a stable order and changes with any byte, name or new file", async () => {
  const root = await createTestTempDirectory("clone-tree-");
  await mkdir(join(root, "src", "deep"), { recursive: true });
  await mkdir(join(root, "node_modules", "left-pad"), { recursive: true });
  await writeFile(join(root, "src", "deep", "b.mjs"), "export const b = 2;\n");
  await writeFile(join(root, "a.mjs"), "export const a = 1;\n");
  await writeFile(join(root, "node_modules", "left-pad", "index.js"), "x");
  const first = await digest(root, ["node_modules"]);
  expect(first.files).toEqual([
    {
      path: "a.mjs",
      kind: "file",
      sha256: sha256Hex("export const a = 1;\n"),
      bytes: 20,
    },
    {
      path: "src/deep/b.mjs",
      kind: "file",
      sha256: sha256Hex("export const b = 2;\n"),
      bytes: 20,
    },
  ]);
  expect(first.exclude).toEqual(["node_modules"]);
  expect(first.sha256).toBe(cloneTreeSha256(first.files.toReversed()));
  expect((await digest(root, ["node_modules"])).sha256).toBe(first.sha256);

  // An excluded path may change freely; anything else may not.
  await writeFile(join(root, "node_modules", "left-pad", "index.js"), "y");
  expect((await digest(root, ["node_modules"])).sha256).toBe(first.sha256);
  expect((await digest(root)).sha256).not.toBe(first.sha256);
  await writeFile(join(root, "src", "deep", "b.mjs"), "export const b = 3;\n");
  const edited = await digest(root, ["node_modules"]);
  expect(edited.sha256).not.toBe(first.sha256);
  await writeFile(join(root, "src", "helper.mjs"), "");
  expect((await digest(root, ["node_modules"])).sha256).not.toBe(edited.sha256);
});

it("records a link by its text and lists those that leave the root or enter an exclude", async () => {
  const base = await createTestTempDirectory("clone-tree-links-");
  const root = join(base, "clone");
  await mkdir(join(root, "vendor"), { recursive: true });
  await writeFile(join(base, "outside.mjs"), "export const outside = 1;\n");
  await writeFile(join(root, "inside.mjs"), "export const inside = 1;\n");
  await writeFile(join(root, "vendor", "lib.mjs"), "export const lib = 1;\n");
  await symlink("inside.mjs", join(root, "alias.mjs"));
  await symlink(join(base, "outside.mjs"), join(root, "escape.mjs"));
  await symlink("vendor/lib.mjs", join(root, "excluded.mjs"));
  await symlink("nowhere.mjs", join(root, "dangling.mjs"));
  await symlink(base, join(root, "up"));
  const snapshot = await digest(root, ["vendor"]);
  expect(snapshot.files.map(({ path, kind }) => [path, kind])).toEqual([
    ["alias.mjs", "symlink"],
    ["dangling.mjs", "symlink"],
    ["escape.mjs", "symlink"],
    ["excluded.mjs", "symlink"],
    ["inside.mjs", "file"],
    ["up", "symlink"],
  ]);
  expect(snapshot.files[0]).toMatchObject({
    sha256: sha256Hex("inside.mjs"),
    bytes: 10,
  });
  expect(snapshot.symlinksOutsideRoot).toEqual([
    "escape.mjs",
    "excluded.mjs",
    "up",
  ]);

  // What an outside link serves can change without the digest changing: that is why it blocks.
  await writeFile(join(base, "outside.mjs"), "export const outside = 2;\n");
  expect((await digest(root, ["vendor"])).sha256).toBe(snapshot.sha256);
  // A link that is itself excluded is neither digested nor listed.
  expect(
    (await digest(root, ["vendor", "escape.mjs", "excluded.mjs", "up"]))
      .symlinksOutsideRoot,
  ).toEqual([]);
});

it("refuses a root that is absent or not a directory", async () => {
  const base = await createTestTempDirectory("clone-tree-missing-");
  await writeFile(join(base, "file"), "x");
  for (const root of [join(base, "absent"), join(base, "file")]) {
    const refused = await digestCloneTree(root, []);
    expect(refused).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError", operation: "evaluate-clone-run" },
    });
    expect(!refused.ok && refused.error.userMessage).toContain(
      "does not exist or is not a directory",
    );
  }
  await rm(join(base, "file"));
  const aborted = new AbortController();
  aborted.abort();
  await writeFile(join(base, "one"), "1");
  expect(
    await digestCloneTree(base, [], { signal: aborted.signal }),
  ).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
});
