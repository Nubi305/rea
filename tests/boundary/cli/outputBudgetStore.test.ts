import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { savedDocumentParts } from "../../../src/cli/outputBudget/deliver.js";
import {
  aboutOf,
  clearSaved,
  listSaved,
  loadSavedDocument,
  resolveSaved,
  saveDocument,
  storeDirectories,
  sweepDirectory,
  type SavedOutputStoreOptions,
} from "../../../src/cli/outputBudget/store.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const posix = process.platform !== "win32" && process.getuid !== undefined;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A store whose every candidate lies in a fresh temporary root. */
const storeIn = async (
  overrides: Partial<SavedOutputStoreOptions> = {},
): Promise<SavedOutputStoreOptions & { readonly root: string }> => {
  const root = await createTestTempDirectory("rea-saved-output-");
  await mkdir(join(root, "home"));
  await mkdir(join(root, "tmp"));
  await mkdir(join(root, "work"));
  return {
    root,
    environment: { XDG_CACHE_HOME: join(root, "cache") },
    platform: process.platform,
    cwd: join(root, "work"),
    home: join(root, "home"),
    tmpdir: join(root, "tmp"),
    getuid: process.getuid?.bind(process),
    ...overrides,
  };
};

const evidence = (name: string, rows = 3) => ({
  evidence_id: `ev_${createHash("sha256").update(name).digest("hex")}`,
  operation: "inspect_artifact",
  subject: {
    name,
    local_path: `/targets/${name}`,
    identity: { sha256: createHash("sha256").update(`${name}!`).digest("hex") },
  },
  normalized_result: {
    rows: Array.from({ length: rows }, (_, index) => ({ index })),
  },
});

const save = async (
  options: SavedOutputStoreOptions,
  document: unknown,
  command = "inspect-artifact",
) => {
  const saved = await saveDocument(
    options,
    () => savedDocumentParts(document),
    {
      command,
      about: aboutOf(document),
    },
  );
  if (!saved.ok) throw new Error(JSON.stringify(saved.error));
  return saved.value;
};

it("saves canonical bytes privately, names them by hash and finds them by prefix", async () => {
  const options = await storeIn();
  const document = evidence("notes-app");
  const saved = await save(options, document);
  const bytes = await readFile(saved.file);
  expect(bytes.toString("utf8")).toBe(`${JSON.stringify(document)}\n`);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(saved.sha256);
  expect(saved.file).toBe(
    join(
      options.root,
      "cache",
      "rea",
      "saved-output",
      `${saved.sha256}.inspect-artifact.json`,
    ),
  );
  if (posix) {
    expect((await stat(saved.file)).mode & 0o777).toBe(0o600);
    expect(
      (await stat(join(options.root, "cache", "rea", "saved-output"))).mode &
        0o777,
    ).toBe(0o700);
  }
  const found = await resolveSaved(options, saved.id);
  if (!found.ok) throw new Error(found.error.message);
  expect(found.value).toMatchObject({
    file: saved.file,
    sha256: saved.sha256,
    command: "inspect-artifact",
    stored: true,
  });
  const loaded = await loadSavedDocument(options, saved.sha256.slice(0, 8));
  if (!loaded.ok) throw new Error(loaded.error.message);
  expect(loaded.value.document).toEqual(document);
});

it("keeps one file for equal content and does not rewrite it", async () => {
  const options = await storeIn({
    now: () => Date.parse("2026-11-21T12:00:00Z"),
  });
  const document = evidence("same");
  const first = await save(options, document);
  const old = new Date(Date.parse("2026-11-20T12:00:00Z"));
  await utimes(first.file, old, old);
  const later = { ...options, now: () => Date.parse("2026-11-21T13:00:00Z") };
  // A second command saving equal content reuses the first name.
  const second = await save(later, document, "extract-artifact");
  expect(second.file).toBe(first.file);
  expect((await stat(first.file)).mtimeMs).toBe(
    Date.parse("2026-11-21T13:00:00Z"),
  );
  // Two concurrent saves of one document leave one file and no temporary.
  const other = evidence("concurrent");
  const [left, right] = await Promise.all([
    save(options, other),
    save(options, other),
  ]);
  expect(left.file).toBe(right.file);
  const names = await readdir(
    join(options.root, "cache", "rea", "saved-output"),
  );
  expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([]);
  expect(
    names.filter(
      (name) => name.startsWith(left.sha256) && !name.endsWith(".about.json"),
    ),
  ).toHaveLength(1);
});

it("gives concurrent saves of different documents their own temporary names", async () => {
  const options = await storeIn();
  const documents = Array.from({ length: 8 }, (_, index) =>
    evidence(`doc-${String(index)}`, 50),
  );
  const saved = await Promise.all(
    documents.map((document) => save(options, document)),
  );
  expect(new Set(saved.map((entry) => entry.file)).size).toBe(8);
  for (const [index, entry] of saved.entries())
    expect(JSON.parse(await readFile(entry.file, "utf8"))).toEqual(
      documents[index],
    );
});

it("applies age, temporary-file and cap rules with a one-hour grace", async () => {
  const now = Date.parse("2026-11-21T12:00:00Z");
  const options = await storeIn({ now: () => now, capBytes: 1500 });
  const directory = join(options.root, "cache", "rea", "saved-output");
  const at = async (file: string, time: number) => {
    await utimes(file, new Date(time), new Date(time));
  };
  const ancient = await save(options, evidence("ancient", 5));
  const old = await save(options, evidence("old", 5));
  const middle = await save(options, evidence("middle", 5));
  const fresh = await save(options, evidence("fresh", 5));
  await at(ancient.file, now - 15 * DAY);
  await at(old.file, now - 3 * DAY);
  await at(middle.file, now - 2 * DAY);
  await at(fresh.file, now - 10 * 60 * 1000);
  const staleTemporary = join(directory, "inspect-artifact.0badf00d.tmp");
  const liveTemporary = join(directory, "inspect-artifact.0c0ffee0.tmp");
  await writeFile(staleTemporary, "partial");
  await writeFile(liveTemporary, "partial");
  await at(staleTemporary, now - 2 * HOUR);
  await at(liveTemporary, now - 5 * 60 * 1000);
  const swept = await sweepDirectory(directory, options);
  const names = await readdir(directory);
  const has = (file: string) =>
    names.includes(file.slice(directory.length + 1));
  // 14 days: removed with its about file. Cap: the oldest goes first.
  expect(has(ancient.file)).toBe(false);
  expect(names.some((name) => name.startsWith(ancient.sha256))).toBe(false);
  expect(has(old.file)).toBe(false);
  // The cap is met once the oldest documents are gone; the one-hour grace protects the fresh one.
  expect(has(fresh.file)).toBe(true);
  expect(names).not.toContain("inspect-artifact.0badf00d.tmp");
  expect(names).toContain("inspect-artifact.0c0ffee0.tmp");
  expect(swept.removed).toBeGreaterThanOrEqual(2);
  // A document read or changed within the hour is never removed, even over the cap.
  const tight = { ...options, capBytes: 1 };
  await sweepDirectory(directory, tight);
  expect(
    (await readdir(directory)).some((name) => name.startsWith(fresh.sha256)),
  ).toBe(true);
});

it.skipIf(!posix)(
  "refuses a store directory owned by another user or writable by others",
  async () => {
    const options = await storeIn();
    const selected = join(options.root, "selected");
    await mkdir(selected, { mode: 0o700 });
    const environment = { REA_SAVED_OUTPUT_DIR: selected };
    const foreign = await saveDocument(
      { ...options, environment, getuid: () => (process.getuid?.() ?? 0) + 1 },
      () => savedDocumentParts({ a: 1 }),
      { command: "doctor", about: {} },
    );
    expect(foreign).toEqual({
      ok: false,
      error: { code: "EFOREIGN", directory: selected },
    });
    await chmod(selected, 0o777);
    const open = await saveDocument(
      { ...options, environment },
      () => savedDocumentParts({ a: 1 }),
      {
        command: "doctor",
        about: {},
      },
    );
    // A set directory that cannot be used is not replaced by another candidate.
    expect(open).toEqual({
      ok: false,
      error: { code: "EWRITABLE", directory: selected },
    });
  },
);

it("makes no mode check on Windows and keeps the same layout", async () => {
  const options = await storeIn({ platform: "win32" });
  const selected = join(options.root, "selected");
  await mkdir(selected);
  if (posix) await chmod(selected, 0o777);
  const windows = {
    ...options,
    environment: { REA_SAVED_OUTPUT_DIR: selected },
    // Node reports a user id only where POSIX permissions apply; the store must not depend on it.
    getuid: () => -1,
  };
  const saved = await save(windows, evidence("windows"));
  expect(saved.file).toBe(
    join(selected, `${saved.sha256}.inspect-artifact.json`),
  );
  // The temporary candidate carries no user id on Windows.
  const candidates = storeDirectories({ ...options, home: undefined });
  expect(candidates).toEqual([
    {
      directory: join(options.root, "tmp", "rea-saved-output"),
      origin: "temporary",
    },
  ]);
});

it("falls back to the temporary directory when the cache cannot be created, and lists from it", async () => {
  const options = await storeIn();
  // A file where the cache root should be: creating the cache fails for any user, root included.
  const blocked = join(options.root, "not-a-directory");
  await writeFile(blocked, "");
  const sandboxed = { ...options, environment: { XDG_CACHE_HOME: blocked } };
  const saved = await save(sandboxed, evidence("sandboxed"));
  expect(saved.directory.startsWith(join(options.root, "tmp"))).toBe(true);
  const listed = await listSaved(sandboxed);
  expect(listed.entries.map((entry) => entry.file)).toEqual([saved.file]);
  expect(listed.directories).toEqual([saved.directory]);
});

it("never uses a candidate inside the working directory", async () => {
  const options = await storeIn();
  const inside = {
    ...options,
    environment: { REA_SAVED_OUTPUT_DIR: join(options.cwd, "saved") },
  };
  expect(storeDirectories(inside)).toEqual([]);
  const failed = await saveDocument(
    inside,
    () => savedDocumentParts({ a: 1 }),
    { command: "doctor", about: {} },
  );
  expect(failed.ok).toBe(false);
  expect(await readdir(options.cwd)).toEqual([]);
  const cacheInside = { ...options, home: options.cwd, environment: {} };
  expect(
    storeDirectories(cacheInside).map((candidate) => candidate.origin),
  ).toEqual(["temporary"]);
});

it("refuses a file changed after it was saved", async () => {
  const options = await storeIn();
  const saved = await save(options, evidence("tampered"));
  await writeFile(saved.file, `${JSON.stringify({ forged: true })}\n`);
  const found = await resolveSaved(options, saved.id);
  expect(found.ok).toBe(false);
  if (found.ok) return;
  expect(found.error.kind).toBe("tampered");
});

it("lists two analyses of two targets apart, from the document only", async () => {
  const options = await storeIn({
    environment: { XDG_CACHE_HOME: "", SECRET_TOKEN: "do-not-store" },
  });
  let clock = Date.parse("2026-11-21T10:00:00Z");
  const timed = { ...options, now: () => clock };
  await save(timed, evidence("first-target"));
  clock += 60_000;
  await save(timed, evidence("second-target"));
  await save(
    timed,
    { schema: "verdict/v1", verdict: "not_done", next: [{ role: "builder" }] },
    "evaluate-clone-run",
  );
  const listed = await listSaved(timed, { limit: 10 });
  expect(listed.entries_total).toBe(3);
  const analyses = listed.entries.filter(
    (entry) => entry.command === "inspect-artifact",
  );
  expect(analyses.map((entry) => entry.about["subject.name"])).toEqual([
    "second-target",
    "first-target",
  ]);
  expect(
    listed.entries.find((entry) => entry.command === "evaluate-clone-run")
      ?.about,
  ).toEqual({
    schema: "verdict/v1",
    verdict: "not_done",
  });
  const aboutFiles = (await readdir(listed.directories[0]!)).filter((name) =>
    name.endsWith(".about.json"),
  );
  for (const name of aboutFiles) {
    const text = await readFile(join(listed.directories[0]!, name), "utf8");
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1024);
    expect(text).not.toContain("do-not-store");
  }
  expect(
    (await listSaved(timed, { command: "evaluate-clone-run" })).entries,
  ).toHaveLength(1);
});

it("names what to do for an unknown or ambiguous id, and clears", async () => {
  const options = await storeIn();
  const unknown = await resolveSaved(options, "0123456789ab");
  expect(unknown.ok).toBe(false);
  if (!unknown.ok) {
    expect(unknown.error.kind).toBe("unknown");
    expect(unknown.error.message).toContain("rea saved-output list");
    expect(unknown.error.message).toContain("REA_SAVED_OUTPUT_DIR");
  }
  // Find two documents whose hashes share a first hex character, and ask for that prefix padded to 8.
  const saved = [];
  for (let index = 0; index < 40; index += 1)
    saved.push(await save(options, { index }));
  const byFirst = new Map<string, number>();
  for (const entry of saved)
    byFirst.set(
      entry.sha256.slice(0, 1),
      (byFirst.get(entry.sha256.slice(0, 1)) ?? 0) + 1,
    );
  const shared = [...byFirst].find(([, count]) => count > 1)?.[0];
  expect(shared).toBeDefined();
  const directory = saved[0]!.directory;
  // Rename two documents so that they share an eight-character prefix.
  const [first, second] = saved.filter((entry) =>
    entry.sha256.startsWith(shared!),
  );
  const prefix = first!.sha256.slice(0, 8);
  const forged = `${prefix}${second!.sha256.slice(8)}`;
  await writeFile(
    join(directory, `${forged}.doctor.json`),
    await readFile(second!.file),
  );
  const ambiguous = await resolveSaved(options, prefix);
  expect(ambiguous.ok).toBe(false);
  if (!ambiguous.ok) expect(ambiguous.error.kind).toBe("ambiguous");
  const cleared = await clearSaved(options);
  expect(cleared.removed).toBe(41);
  expect((await listSaved(options)).entries_total).toBe(0);
});

it("reads one record of an Evidence bundle and any JSON file by path", async () => {
  const options = await storeIn();
  const records = [evidence("one"), evidence("two")];
  const bundle = join(options.root, "bundle.json");
  await writeFile(bundle, JSON.stringify({ format: "bundle", records }));
  const loaded = await loadSavedDocument(options, bundle, {
    evidenceId: records[1]!.evidence_id,
  });
  if (!loaded.ok) throw new Error(loaded.error.message);
  expect(loaded.value.document).toEqual(records[1]);
  expect(loaded.value.saved).toMatchObject({ file: bundle, stored: false });
  expect(loaded.value.saved.command).toBeUndefined();
  const missing = await loadSavedDocument(options, bundle, {
    evidenceId: "ev_missing",
  });
  expect(missing.ok).toBe(false);
});
