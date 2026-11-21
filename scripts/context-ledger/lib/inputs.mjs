// Inputs the ledger measures REA on. Text inputs live under inputs/ with an
// `.input` suffix on every file (and on directories git would ignore), so the
// repository's formatter and linter leave their bytes alone. Binary inputs are
// built here at run time from those sources: the repository does not keep
// binaries.
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

import { run } from "./process.mjs";

export const INPUTS = fileURLToPath(new URL("../inputs/", import.meta.url));

/** Copy a source tree, dropping the `.input` suffix from every path segment. */
export const materialize = (source, destination) => {
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(source).sort()) {
    const from = join(source, name);
    const to = join(destination, name.replace(/\.input$/u, ""));
    if (statSync(from).isDirectory()) materialize(from, to);
    else cpSync(from, to);
  }
};

// 2026-01-01 00:00 in MS-DOS date and time fields: fixed, so the archive's
// bytes and digest are the same on every run.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const zipEntry = ({ name, data }) => {
  const directory = data === undefined;
  const raw = directory ? Buffer.alloc(0) : data;
  const deflated = directory ? raw : deflateRawSync(raw, { level: 9 });
  const stored = directory || deflated.length >= raw.length;
  return {
    name: Buffer.from(name, "utf8"),
    method: stored ? 0 : 8,
    crc: directory ? 0 : crc32(raw),
    body: stored ? raw : deflated,
    size: raw.length,
    external: directory ? 0x10 : 0,
  };
};

/** Write a deterministic zip archive; entries without data are directories. */
export const writeZip = (file, entries) => {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries.map(zipEntry)) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(entry.crc, 14);
    local.writeUInt32LE(entry.body.length, 18);
    local.writeUInt32LE(entry.size, 22);
    local.writeUInt16LE(entry.name.length, 26);
    local.writeUInt16LE(0, 28);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    local.copy(header, 8, 6, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(entry.external, 38);
    header.writeUInt32LE(offset, 42);
    parts.push(local, entry.name, entry.body);
    central.push(header, entry.name);
    offset += local.length + entry.name.length + entry.body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(file, Buffer.concat([...parts, directory, end]));
};

/** Zip entries for a directory tree, directories first, names sorted. */
const treeEntries = (root, prefix = "") =>
  readdirSync(join(root, prefix))
    .sort()
    .flatMap((name) => {
      const relative = prefix === "" ? name : `${prefix}/${name}`;
      return statSync(join(root, relative)).isDirectory()
        ? [{ name: `${relative}/` }, ...treeEntries(root, relative)]
        : [{ name: relative, data: readFileSync(join(root, relative)) }];
    });

/** Pseudo-random bytes from a fixed seed: the same on every run. */
const seededBytes = (seed, length) => {
  const chunks = [];
  let block = createHash("sha256").update(seed).digest();
  for (let total = 0; total < length; total += block.length) {
    chunks.push(block);
    block = createHash("sha256").update(block).digest();
  }
  return Buffer.concat(chunks).subarray(0, length);
};

const compile = (source, output, flags) => {
  const result = run("cc", [...flags, "-o", output, source], {
    timeoutMs: 120_000,
  });
  return result.exit === 0
    ? undefined
    : `cc ${flags.join(" ")} failed: ${result.error ?? result.stderr.slice(0, 300)}`;
};

/**
 * The ten-call task's inputs: a 3-file JavaScript app and its zip, a HAR, an
 * OpenAPI document and a small ELF (`cc -O1`, which reproduces the audit's
 * binary byte for byte with GCC 13.3 on x86-64).
 */
export const buildMcpInputs = (directory) => {
  rmSync(directory, { recursive: true, force: true });
  materialize(join(INPUTS, "mcp"), directory);
  const app = join(directory, "app");
  writeZip(join(directory, "app.zip"), treeEntries(app));
  const missing = compile(
    join(directory, "hello.c"),
    join(directory, "hello"),
    ["-O1"],
  );
  return {
    missing: missing === undefined ? [] : [{ input: "hello", reason: missing }],
  };
};

const safetensors = () => {
  const header = Buffer.from(
    JSON.stringify({
      __metadata__: { format: "pt" },
      weight: { dtype: "F32", shape: [2, 3], data_offsets: [0, 24] },
    }),
  );
  const padded = Buffer.concat([
    header,
    Buffer.alloc((8 - (header.length % 8)) % 8, 0x20),
  ]);
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(padded.length));
  const data = Buffer.alloc(24);
  for (let index = 0; index < 6; index += 1)
    data.writeFloatLE(index / 2, index * 4);
  return Buffer.concat([length, padded, data]);
};

const SQLITE_SCRIPT = `
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, created_at TEXT)");
db.exec("CREATE TABLE topics (id INTEGER PRIMARY KEY, title TEXT NOT NULL, slug TEXT UNIQUE, pinned INTEGER DEFAULT 0, author_id INTEGER REFERENCES users(id))");
db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value BLOB)");
db.exec("CREATE INDEX topics_author ON topics(author_id)");
db.exec("CREATE VIEW pinned_topics AS SELECT id, title FROM topics WHERE pinned = 1");
const user = db.prepare("INSERT INTO users VALUES (?, ?, ?, ?)");
for (let i = 1; i <= 40; i += 1) user.run(i, "user" + i + "@example.test", "User " + i, "2026-01-" + String((i % 28) + 1).padStart(2, "0"));
const topic = db.prepare("INSERT INTO topics VALUES (?, ?, ?, ?, ?)");
for (let i = 1; i <= 120; i += 1) topic.run(i, "Topic " + i, "topic-" + i, i % 7 === 0 ? 1 : 0, (i % 40) + 1);
db.prepare("INSERT INTO settings VALUES (?, ?)").run("theme", "dark");
db.prepare("INSERT INTO settings VALUES (?, ?)").run("limit", "20");
db.close();
`;

/**
 * The CLI census's inputs, built from text sources. Inputs whose build fails
 * are reported missing, and the specs that need them are skipped.
 */
export const buildCensusInputs = (directory, node) => {
  rmSync(directory, { recursive: true, force: true });
  materialize(join(INPUTS, "census"), directory);
  const missing = [];
  const hello = compile(join(directory, "hello.c"), join(directory, "hello"), [
    "-g",
    "-O0",
  ]);
  if (hello === undefined) {
    const stripped = run("strip", [
      "-o",
      join(directory, "hello.stripped"),
      join(directory, "hello"),
    ]);
    if (stripped.exit !== 0)
      missing.push({ input: "hello.stripped", reason: "strip failed" });
  } else missing.push({ input: "hello", reason: hello });
  const tree = join(directory, "ziptree");
  writeFileSync(
    join(tree, "blob.bin"),
    seededBytes("rea-context-ledger", 2048),
  );
  writeZip(join(directory, "sample.zip"), treeEntries(tree));
  writeFileSync(join(directory, "tiny.safetensors"), safetensors());
  const sqlite = run(
    node,
    ["--no-warnings", "-e", SQLITE_SCRIPT, join(directory, "sample.sqlite")],
    { timeoutMs: 60_000 },
  );
  if (sqlite.exit !== 0)
    missing.push({
      input: "sample.sqlite",
      reason: `node:sqlite unavailable: ${sqlite.stderr.slice(0, 200)}`,
    });
  return { missing };
};

/** Make an empty directory, removing what an earlier run left. */
export const freshDirectory = (directory) => {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  return directory;
};

export const ensureParent = (file) => {
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
};
