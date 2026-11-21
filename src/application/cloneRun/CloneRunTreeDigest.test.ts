import { mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { sha256Hex } from "../../kernel/sha256Hex.js";
import { cloneFilesNamingOriginal } from "./CloneRunCleanRoom.js";
import {
  cloneTreeLinkTextLeavesRoot,
  cloneTreeSha256,
  digestCloneTree,
  digestOriginalMaterial,
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
  // A link is judged by its text first: one that leaves the root, or cannot be resolved, is listed
  // whether or not its target exists when the referee looks.
  expect(snapshot.unsafeLinks).toEqual([
    { path: "dangling.mjs", cause: "unresolved" },
    { path: "escape.mjs", cause: "outside" },
    { path: "excluded.mjs", cause: "excluded" },
    { path: "up", cause: "outside" },
  ]);

  // What an outside link serves can change without the digest changing: that is why it blocks.
  await writeFile(join(base, "outside.mjs"), "export const outside = 2;\n");
  expect((await digest(root, ["vendor"])).sha256).toBe(snapshot.sha256);
  // A link that is itself excluded is neither digested nor listed.
  expect(
    (
      await digest(root, [
        "vendor",
        "dangling.mjs",
        "escape.mjs",
        "excluded.mjs",
        "up",
      ])
    ).unsafeLinks,
  ).toEqual([]);
});

it("lists a link whose text rises above the root, also when it comes back in by the root's own name", async () => {
  const base = await createTestTempDirectory("clone-tree-link-walk-");
  const root = join(base, "clone");
  await mkdir(join(root, "sub", "deep"), { recursive: true });
  await writeFile(join(root, "sub", "real.mjs"), "export const real = 1;\n");
  // Out and back in: it resolves inside the root today and names the root from outside.
  await symlink("../clone/sub/real.mjs", join(root, "back.mjs"));
  await symlink("../../clone/sub/real.mjs", join(root, "sub", "back.mjs"));
  await symlink(
    "deep/../../../clone/sub/real.mjs",
    join(root, "sub", "late.mjs"),
  );
  // An absolute text names the root from outside as well.
  await symlink(join(root, "sub", "real.mjs"), join(root, "absolute.mjs"));
  // Links that stay inside on every segment of their way are not listed.
  await symlink("sub/real.mjs", join(root, "plain.mjs"));
  await symlink("../real.mjs", join(root, "sub", "deep", "up-one.mjs"));
  await symlink("./deep/../real.mjs", join(root, "sub", "around.mjs"));
  await symlink("../sub/deep/../real.mjs", join(root, "sub", "sibling.mjs"));
  expect((await digest(root)).unsafeLinks).toEqual([
    { path: "absolute.mjs", cause: "outside" },
    { path: "back.mjs", cause: "outside" },
    { path: "sub/back.mjs", cause: "outside" },
    { path: "sub/late.mjs", cause: "outside" },
  ]);
  expect(cloneTreeLinkTextLeavesRoot("a/b/link", "../../x")).toBe(false);
  expect(cloneTreeLinkTextLeavesRoot("a/b/link", "../../../x")).toBe(true);
  expect(cloneTreeLinkTextLeavesRoot("link", "x/../../clone/y")).toBe(true);
  expect(cloneTreeLinkTextLeavesRoot("link", "x//./y/../..")).toBe(false);
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

it("lists a link that leaves the root while its target is absent, so hiding the target hides nothing", async () => {
  const base = await createTestTempDirectory("clone-tree-absent-target-");
  const root = join(base, "clone");
  const outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(outside, "rule.mjs"), "export const limit = 24;\n");
  await symlink("../outside/rule.mjs", join(root, "rule.mjs"));
  const present = await digest(root);
  expect(present.unsafeLinks).toEqual([{ path: "rule.mjs", cause: "outside" }]);
  // The time-of-check game: the target is moved away only while the referee looks.
  await rename(outside, join(base, "hidden"));
  const hidden = await digest(root);
  expect(hidden.unsafeLinks).toEqual(present.unsafeLinks);
  expect(hidden.sha256).toBe(present.sha256);
});

it("returns what it could not read instead of refusing, and lists only the excludes that matched", async () => {
  const base = await createTestTempDirectory("clone-tree-unreadable-");
  const root = join(base, "clone");
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(join(root, "app.mjs"), "export const app = 1;\n");
  await writeFile(join(root, "data", "app.db"), "rows");
  // A name that is not UTF-8 cannot be recorded as a path; it must not read as an absent file.
  await writeFile(
    Buffer.concat([
      Buffer.from(`${root}/caf`),
      Buffer.from([0xe9, 0x2e, 0x6a, 0x73]),
    ]),
    "export const hidden = 1;\n",
  );
  const snapshot = await digest(root, ["data", "node_modules", "logs/app.log"]);
  expect(snapshot.files.map(({ path }) => path)).toEqual(["app.mjs"]);
  expect(snapshot.unreadable).toHaveLength(1);
  expect(snapshot.unreadable[0]?.detail).toContain("not valid UTF-8");
  expect(snapshot.exclude).toEqual(["data"]);
});

it("reads original material through links by its real path, each directory once", async () => {
  const base = await createTestTempDirectory("clone-material-links-");
  const material = join(base, "scout");
  const mirror = join(base, "mirror");
  await mkdir(material);
  await mkdir(join(mirror, "assets"), { recursive: true });
  await writeFile(join(mirror, "assets", "app.js"), "x".repeat(100));
  await writeFile(join(material, "own.js"), "y".repeat(100));
  await symlink(mirror, join(material, "site"));
  await symlink(join(mirror, "assets", "app.js"), join(material, "app.js"));
  await symlink(material, join(mirror, "loop"));
  await symlink("gone.js", join(material, "dangling.js"));
  const read = await digestOriginalMaterial(material);
  if (!read.ok) throw read.error;
  expect(read.value.files).toEqual([
    { path: "app.js", sha256: sha256Hex("x".repeat(100)), bytes: 100 },
    { path: "own.js", sha256: sha256Hex("y".repeat(100)), bytes: 100 },
    {
      path: "site/assets/app.js",
      sha256: sha256Hex("x".repeat(100)),
      bytes: 100,
    },
  ]);
  expect(read.value.unreadable).toEqual([
    {
      path: "dangling.js",
      detail: expect.stringContaining("the link cannot be followed"),
    },
  ]);
});

it("finds the original's name in a link's text as well as in paths and bytes", async () => {
  const base = await createTestTempDirectory("clone-names-links-");
  const root = join(base, "clone");
  await mkdir(root);
  await writeFile(join(root, "about.txt"), "Welcome to QUILLBROOK.\n");
  await writeFile(join(root, "clean.txt"), "Welcome.\n");
  await symlink("quillbrook-data", join(root, "data"));
  await symlink("clean.txt", join(root, "alias"));
  const snapshot = await digest(root);
  expect(
    await cloneFilesNamingOriginal(root, snapshot.files, ["Quillbrook"]),
  ).toEqual([
    { path: "about.txt", name: "Quillbrook", where: "content" },
    { path: "data", name: "Quillbrook", where: "link" },
  ]);
});
