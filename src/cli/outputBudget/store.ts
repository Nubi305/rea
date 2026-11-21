/**
 * The per-user store of saved answers (contract 8.1): complete results that
 * were over the answer budget, written before their digest is printed,
 * content-addressed by the SHA-256 of their bytes.
 *
 * Every platform fact (the platform, the user id, the clock, the directories)
 * is a parameter, so the same rules are tested for POSIX and for Windows.
 */
import { isRecord } from "../../kernel/isRecord.js";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  utimes,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { OwnedFileHandle } from "../../filesystem/OwnedFileHandle.js";
import { withOwnedFileHandle } from "../../filesystem/OwnedRegularFile.js";
import {
  reaCacheDirectory,
  withinLexicalDirectory,
} from "../../filesystem/cacheDirectory.js";
import { err, ok, type Result } from "../../domain/result.js";

/** Store cap: oldest documents are removed past this total. */
export const SAVED_OUTPUT_CAP_BYTES = 512 * 1024 * 1024;
/** Documents neither saved nor read for this long are removed. */
export const SAVED_OUTPUT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** A document changed or read this recently is never removed by the sweep. */
export const SAVED_OUTPUT_GRACE_MS = 60 * 60 * 1000;
/** Characters of the hash a printed id uses. */
export const SAVED_OUTPUT_ID_LENGTH = 12;
/** The environment variable that names the store directory. */
export const SAVED_OUTPUT_ENVIRONMENT = "REA_SAVED_OUTPUT_DIR";

const ABOUT_MAX_BYTES = 1024;
const ABOUT_VALUE_MAX_BYTES = 200;
const WRITE_CHUNK = 64 * 1024;
const DOCUMENT_NAME = /^([0-9a-f]{64})\.([a-z0-9][a-z0-9-]*)\.json$/u;
const ABOUT_NAME = /^([0-9a-f]{64})\.([a-z0-9][a-z0-9-]*)\.about\.json$/u;
const HEX_REFERENCE = /^[0-9a-f]{8,64}$/u;

/** Platform facts and limits for one use of the store. */
export interface SavedOutputStoreOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  /** The working directory; no candidate inside it is used. */
  readonly cwd: string;
  /** The user's home, for the cache candidate. */
  readonly home: string | undefined;
  /** `os.tmpdir()`, for the last candidate. */
  readonly tmpdir: string;
  /** `process.getuid` where it exists; without it no POSIX mode check is made. */
  readonly getuid?: (() => number) | undefined;
  readonly now?: () => number;
  readonly capBytes?: number;
  readonly maxAgeMs?: number;
}

export type StoreCandidateOrigin =
  | "REA_SAVED_OUTPUT_DIR"
  | "cache"
  | "temporary";

export interface StoreCandidate {
  readonly directory: string;
  readonly origin: StoreCandidateOrigin;
}

/** Why nothing could be saved: the code of the last refusal and where. */
export interface StoreFailure {
  readonly code: string;
  readonly directory: string | undefined;
}

/** A saved document, as a digest names it. */
export interface SavedReference {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  /** The hash prefix printed commands use. */
  readonly id: string;
}

/** Scalars copied from a document so that `list` tells saved answers apart. */
export type SavedAbout = Readonly<Record<string, string | number | boolean>>;

export interface SavedAboutFile {
  readonly command: string;
  readonly saved_at: string;
  readonly bytes: number;
  readonly about: SavedAbout;
}

/**
 * The candidate directories, in order (contract 8.1): `REA_SAVED_OUTPUT_DIR`
 * alone when it is set; otherwise the per-user cache, then a per-user
 * directory under the temporary directory. A candidate inside the working
 * directory is skipped (a saved file must never appear in a clone or run tree).
 */
export const storeDirectories = (
  options: SavedOutputStoreOptions,
): readonly StoreCandidate[] => {
  const outside = (directory: string): boolean =>
    !withinLexicalDirectory(directory, options.cwd, options.platform);
  const selected = options.environment[SAVED_OUTPUT_ENVIRONMENT];
  if (selected !== undefined && selected !== "")
    return isAbsolute(selected) && outside(selected)
      ? [{ directory: selected, origin: "REA_SAVED_OUTPUT_DIR" }]
      : [];
  const candidates: StoreCandidate[] = [];
  if (options.home !== undefined && options.home !== "")
    candidates.push({
      directory: reaCacheDirectory(
        options.home,
        options.environment as NodeJS.ProcessEnv,
        options.platform,
        "saved-output",
      ),
      origin: "cache",
    });
  const uid = options.getuid?.();
  candidates.push({
    directory: join(
      options.tmpdir,
      uid === undefined || options.platform === "win32"
        ? "rea-saved-output"
        : `rea-saved-output-${String(uid)}`,
    ),
    origin: "temporary",
  });
  return candidates.filter((candidate) => outside(candidate.directory));
};

const errorCode = (cause: unknown): string =>
  cause !== null &&
  typeof cause === "object" &&
  "code" in cause &&
  typeof cause.code === "string"
    ? cause.code
    : "EUNKNOWN";

/**
 * Create a candidate (mode 0700) and check it is private: where `getuid`
 * exists, an existing directory owned by someone else, or writable by group or
 * others, is refused. On Windows no mode check is made: Node synthesizes the
 * bits there, and the default lies under the user profile.
 */
const prepareDirectory = async (
  directory: string,
  options: SavedOutputStoreOptions,
): Promise<Result<string, StoreFailure>> => {
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const facts = await lstat(directory);
    if (facts.isSymbolicLink() || !facts.isDirectory())
      return err({ code: "ENOTDIR", directory });
    if (options.getuid !== undefined && options.platform !== "win32") {
      if (facts.uid !== options.getuid())
        return err({ code: "EFOREIGN", directory });
      if ((facts.mode & 0o022) !== 0)
        return err({ code: "EWRITABLE", directory });
    }
    return ok(directory);
  } catch (cause: unknown) {
    return err({ code: errorCode(cause), directory });
  }
};

const commandPart = (command: string): string => {
  const part = command
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  return part === "" ? "result" : part;
};

const documentName = (sha256: string, command: string): string =>
  `${sha256}.${commandPart(command)}.json`;

const aboutName = (sha256: string, command: string): string =>
  `${sha256}.${commandPart(command)}.about.json`;

/** An existing document with this hash, whatever command saved it first. */
const existingDocument = async (
  directory: string,
  sha256: string,
): Promise<string | undefined> => {
  for (const name of await readdir(directory)) {
    const match = DOCUMENT_NAME.exec(name);
    if (match?.[1] === sha256) return name;
  }
  return undefined;
};

/** Write bytes to a fresh temporary file opened `wx`, mode 0600, hashing them. */
const writeTemporary = async (
  directory: string,
  command: string,
  parts: Iterable<string>,
): Promise<{
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}> => {
  const path = join(
    directory,
    `${commandPart(command)}.${randomBytes(4).toString("hex")}.tmp`,
  );
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    await withOwnedFileHandle(
      path,
      new OwnedFileHandle(await open(path, "wx", 0o600)),
      {},
      async (handle) => {
        let buffer = "";
        const flush = async (): Promise<void> => {
          if (buffer === "") return;
          const chunk = Buffer.from(buffer, "utf8");
          buffer = "";
          hash.update(chunk);
          bytes += chunk.length;
          await handle.write(chunk);
        };
        for (const part of parts) {
          buffer += part;
          if (buffer.length >= WRITE_CHUNK) await flush();
        }
        await flush();
        await handle.sync();
      },
    );
  } catch (cause: unknown) {
    await unlink(path).catch(() => undefined);
    throw cause;
  }
  return { path, sha256: hash.digest("hex"), bytes };
};

const writeAbout = async (
  directory: string,
  name: string,
  about: SavedAboutFile,
): Promise<void> => {
  const entries = Object.entries(about.about);
  let record: SavedAboutFile = about;
  while (
    Buffer.byteLength(JSON.stringify(record)) > ABOUT_MAX_BYTES &&
    entries.length > 0
  ) {
    entries.pop();
    record = { ...about, about: Object.fromEntries(entries) };
  }
  const temporary = join(
    directory,
    `about.${randomBytes(4).toString("hex")}.tmp`,
  );
  await withOwnedFileHandle(
    temporary,
    new OwnedFileHandle(await open(temporary, "wx", 0o600)),
    {},
    async (handle) => {
      await handle.write(`${JSON.stringify(record)}\n`);
    },
  );
  await rename(temporary, join(directory, name));
};

/** What a save needs besides the bytes. */
export interface SaveRequest {
  /** The CLI command, recorded in the file name. */
  readonly command: string;
  /** Scalars copied from the document ({@link aboutOf}). */
  readonly about: SavedAbout;
}

/**
 * Save a document's bytes in the first usable candidate. The file is durable
 * (synced and renamed into place) before this resolves. Equal content is one
 * file: an existing document is not rewritten, only its mtime is refreshed.
 * After the save, the cap-and-age sweep runs over that directory. `parts`
 * produces the bytes afresh for each candidate tried.
 */
export const saveDocument = async (
  options: SavedOutputStoreOptions,
  parts: () => Iterable<string>,
  request: SaveRequest,
): Promise<
  Result<SavedReference & { readonly directory: string }, StoreFailure>
> => {
  const candidates = storeDirectories(options);
  let failure: StoreFailure = { code: "ENOENT", directory: undefined };
  for (const candidate of candidates) {
    const prepared = await prepareDirectory(candidate.directory, options);
    if (!prepared.ok) {
      failure = prepared.error;
      continue;
    }
    try {
      const written = await writeTemporary(
        candidate.directory,
        request.command,
        parts(),
      );
      const now = new Date(options.now?.() ?? Date.now());
      const existing = await existingDocument(
        candidate.directory,
        written.sha256,
      );
      let name: string;
      if (existing !== undefined) {
        await unlink(written.path).catch(() => undefined);
        name = existing;
        await utimes(join(candidate.directory, name), now, now);
      } else {
        name = documentName(written.sha256, request.command);
        await rename(written.path, join(candidate.directory, name));
        await writeAbout(
          candidate.directory,
          aboutName(written.sha256, request.command),
          {
            command: request.command,
            saved_at: now.toISOString(),
            bytes: written.bytes,
            about: request.about,
          },
        ).catch(() => undefined);
        await utimes(join(candidate.directory, name), now, now);
      }
      const file = join(candidate.directory, name);
      await sweepDirectory(candidate.directory, options, file).catch(
        () => undefined,
      );
      return ok({
        file,
        bytes: written.bytes,
        sha256: written.sha256,
        id: written.sha256.substring(0, SAVED_OUTPUT_ID_LENGTH),
        directory: candidate.directory,
      });
    } catch (cause: unknown) {
      failure = { code: errorCode(cause), directory: candidate.directory };
    }
  }
  return err(failure);
};

interface StoredFile {
  readonly name: string;
  readonly path: string;
  readonly bytes: number;
  readonly mtimeMs: number;
}

/**
 * The cap-and-age pass over one directory (contract 8.1): `*.tmp` older than
 * one hour; documents not saved or read for the age limit; then, oldest first,
 * documents until the total is under the cap. A document changed or read in
 * the last hour, and `keep`, are never removed. An about file goes with its
 * document. Returns what was removed.
 */
export const sweepDirectory = async (
  directory: string,
  options: SavedOutputStoreOptions,
  keep?: string,
): Promise<{ readonly removed: number; readonly bytesFreed: number }> => {
  const now = options.now?.() ?? Date.now();
  const cap = options.capBytes ?? SAVED_OUTPUT_CAP_BYTES;
  const maxAge = options.maxAgeMs ?? SAVED_OUTPUT_MAX_AGE_MS;
  const documents: StoredFile[] = [];
  const abouts = new Map<string, StoredFile>();
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    let facts;
    try {
      facts = await stat(path);
    } catch {
      continue;
    }
    if (!facts.isFile()) continue;
    const file = { name, path, bytes: facts.size, mtimeMs: facts.mtimeMs };
    if (name.endsWith(".tmp")) {
      if (now - facts.mtimeMs > SAVED_OUTPUT_GRACE_MS)
        await unlink(path).catch(() => undefined);
      continue;
    }
    const about = ABOUT_NAME.exec(name);
    if (about?.[1] !== undefined) abouts.set(about[1], file);
    else if (DOCUMENT_NAME.test(name)) documents.push(file);
  }
  let removed = 0;
  let bytesFreed = 0;
  const remove = async (file: StoredFile): Promise<void> => {
    try {
      await unlink(file.path);
    } catch {
      return;
    }
    removed += 1;
    bytesFreed += file.bytes;
    const hash = file.name.slice(0, 64);
    const about = abouts.get(hash);
    if (about !== undefined) {
      await unlink(about.path).catch(() => undefined);
      bytesFreed += about.bytes;
    }
  };
  const protectedFile = (file: StoredFile): boolean =>
    file.path === keep || now - file.mtimeMs < SAVED_OUTPUT_GRACE_MS;
  const kept: StoredFile[] = [];
  for (const file of documents)
    if (!protectedFile(file) && now - file.mtimeMs > maxAge) await remove(file);
    else kept.push(file);
  let total = kept.reduce(
    (sum, file) =>
      sum + file.bytes + (abouts.get(file.name.slice(0, 64))?.bytes ?? 0),
    0,
  );
  kept.sort((left, right) => left.mtimeMs - right.mtimeMs);
  for (const file of kept) {
    if (total < cap) break;
    if (protectedFile(file)) continue;
    total -= file.bytes + (abouts.get(file.name.slice(0, 64))?.bytes ?? 0);
    await remove(file);
  }
  return { removed, bytesFreed };
};

/** A saved document found by reference. */
export interface ResolvedSaved {
  readonly file: string;
  readonly bytes: number;
  /** For a store document, its verified hash; for a path, the hash of its bytes. */
  readonly sha256: string;
  /** For a store document, its printed id. */
  readonly id?: string;
  /** The command recorded in the file name; absent for an arbitrary path. */
  readonly command?: string;
  /** True for a file of the store, false for a caller's path. */
  readonly stored: boolean;
}

export type SavedLookupFailure =
  | { readonly kind: "unknown"; readonly message: string }
  | {
      readonly kind: "ambiguous";
      readonly message: string;
      readonly matches: readonly string[];
    }
  | {
      readonly kind: "tampered";
      readonly message: string;
      readonly file: string;
    }
  | {
      readonly kind: "unreadable";
      readonly message: string;
      readonly file: string;
    };

const hashFile = async (
  path: string,
): Promise<{ readonly sha256: string; readonly bytes: number }> => {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = chunk as Buffer;
    hash.update(buffer);
    bytes += buffer.length;
  }
  return { sha256: hash.digest("hex"), bytes };
};

/** The SHA-256 and size of any file, for a digest that names a caller's file. */
export const fileReference = hashFile;

/** Existing candidate directories, in order. */
const existingDirectories = async (
  options: SavedOutputStoreOptions,
): Promise<readonly string[]> => {
  const found: string[] = [];
  for (const candidate of storeDirectories(options)) {
    try {
      if ((await stat(candidate.directory)).isDirectory())
        found.push(candidate.directory);
    } catch {
      // A candidate that was never created holds nothing.
    }
  }
  return found;
};

const unknownMessage = (ref: string, directories: readonly string[]): string =>
  `No saved output matches ${ref} in ${directories.length === 0 ? "any store directory" : directories.join(", ")}. Saved outputs are per user and per machine: run 'rea saved-output list', run the command again, or set REA_SAVED_OUTPUT_DIR to a directory that persists.`;

/**
 * Find a saved document (contract 8.3): `ref` is 8 to 64 hex characters (a
 * unique prefix of a stored hash, searched in every candidate directory) or a
 * path to any JSON file. A store document is re-hashed and refused when the
 * hash differs from its name; reading it refreshes its mtime.
 */
export const resolveSaved = async (
  options: SavedOutputStoreOptions,
  ref: string,
): Promise<Result<ResolvedSaved, SavedLookupFailure>> => {
  if (!HEX_REFERENCE.test(ref)) {
    const path = resolve(options.cwd, ref);
    try {
      const facts = await stat(path);
      if (!facts.isFile())
        return err({
          kind: "unreadable",
          message: `${path} is not a file.`,
          file: path,
        });
      const read = await hashFile(path);
      return ok({ file: path, ...read, stored: false });
    } catch (cause: unknown) {
      if (errorCode(cause) === "ENOENT")
        return err({
          kind: "unknown",
          message: unknownMessage(ref, await existingDirectories(options)),
        });
      return err({
        kind: "unreadable",
        message: `${path} cannot be read (${errorCode(cause)}).`,
        file: path,
      });
    }
  }
  const directories = await existingDirectories(options);
  const matches: {
    readonly path: string;
    readonly hash: string;
    readonly command: string;
  }[] = [];
  for (const directory of directories) {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      continue;
    }
    for (const name of names) {
      const match = DOCUMENT_NAME.exec(name);
      if (match?.[1]?.startsWith(ref) === true && match[2] !== undefined)
        matches.push({
          path: join(directory, name),
          hash: match[1],
          command: match[2],
        });
    }
  }
  const distinct = [...new Set(matches.map((match) => match.hash))];
  if (distinct.length === 0)
    return err({ kind: "unknown", message: unknownMessage(ref, directories) });
  if (distinct.length > 1)
    return err({
      kind: "ambiguous",
      message: `${ref} matches ${String(distinct.length)} saved outputs; give more characters of the id: ${matches.map((match) => match.path).join(", ")}.`,
      matches: matches.map((match) => match.path),
    });
  const found = matches[0]!;
  let read;
  try {
    read = await hashFile(found.path);
  } catch (cause: unknown) {
    return err({
      kind: "unreadable",
      message: `${found.path} cannot be read (${errorCode(cause)}).`,
      file: found.path,
    });
  }
  if (read.sha256 !== found.hash)
    return err({
      kind: "tampered",
      message: `${found.path} was changed after it was saved: its SHA-256 is ${read.sha256}. It is not read; run the command again.`,
      file: found.path,
    });
  const now = new Date(options.now?.() ?? Date.now());
  await utimes(found.path, now, now).catch(() => undefined);
  return ok({
    file: found.path,
    bytes: read.bytes,
    sha256: read.sha256,
    id: read.sha256.substring(0, SAVED_OUTPUT_ID_LENGTH),
    command: found.command,
    stored: true,
  });
};

export type LoadFailure =
  | SavedLookupFailure
  | {
      readonly kind: "not-json";
      readonly message: string;
      readonly file: string;
    }
  | {
      readonly kind: "no-record";
      readonly message: string;
      readonly file: string;
    };

/**
 * Load the document a reader shows: the saved JSON, or with `evidenceId` the
 * one record of an Evidence bundle (`records[]`) that has that id.
 */
export const loadSavedDocument = async (
  options: SavedOutputStoreOptions,
  ref: string,
  selection: { readonly evidenceId?: string | undefined } = {},
): Promise<
  Result<
    { readonly saved: ResolvedSaved; readonly document: unknown },
    LoadFailure
  >
> => {
  const resolved = await resolveSaved(options, ref);
  if (!resolved.ok) return resolved;
  let document: unknown;
  try {
    document = JSON.parse(await readFile(resolved.value.file, "utf8"));
  } catch {
    return err({
      kind: "not-json",
      message: `${resolved.value.file} is not a JSON document.`,
      file: resolved.value.file,
    });
  }
  if (selection.evidenceId === undefined)
    return ok({ saved: resolved.value, document });
  const records =
    document !== null &&
    typeof document === "object" &&
    "records" in document &&
    Array.isArray(document.records)
      ? (document.records as readonly unknown[])
      : [];
  const record = records.find(
    (candidate) =>
      candidate !== null &&
      typeof candidate === "object" &&
      "evidence_id" in candidate &&
      candidate.evidence_id === selection.evidenceId,
  );
  if (record === undefined)
    return err({
      kind: "no-record",
      message: `${resolved.value.file} holds no Evidence record ${selection.evidenceId}.`,
      file: resolved.value.file,
    });
  return ok({ saved: resolved.value, document: record });
};

export interface SavedListEntry {
  readonly id: string;
  readonly command: string;
  readonly saved_at: string;
  readonly bytes: number;
  readonly file: string;
  readonly about: SavedAbout;
}

export interface SavedList {
  readonly directories: readonly string[];
  readonly entries_total: number;
  readonly bytes_total: number;
  readonly cap_bytes: number;
  readonly entries: readonly SavedListEntry[];
}

/** `rea saved-output list` (contract 8.3): newest first, from every candidate that exists. */
export const listSaved = async (
  options: SavedOutputStoreOptions,
  request: { readonly limit?: number; readonly command?: string } = {},
): Promise<SavedList> => {
  const directories = await existingDirectories(options);
  const entries: (SavedListEntry & { readonly order: number })[] = [];
  let bytesTotal = 0;
  for (const directory of directories) {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      continue;
    }
    for (const name of names) {
      const match = DOCUMENT_NAME.exec(name);
      if (match?.[1] === undefined || match[2] === undefined) continue;
      const path = join(directory, name);
      let facts;
      try {
        facts = await stat(path);
      } catch {
        continue;
      }
      bytesTotal += facts.size;
      let about: Partial<SavedAboutFile> = {};
      try {
        about = JSON.parse(
          await readFile(
            join(directory, `${match[1]}.${match[2]}.about.json`),
            "utf8",
          ),
        ) as Partial<SavedAboutFile>;
      } catch {
        // A document saved without its about file is still listed.
      }
      const command =
        typeof about.command === "string" ? about.command : match[2];
      if (request.command !== undefined && command !== request.command)
        continue;
      const savedAt =
        typeof about.saved_at === "string"
          ? about.saved_at
          : new Date(facts.mtimeMs).toISOString();
      entries.push({
        id: match[1].substring(0, SAVED_OUTPUT_ID_LENGTH),
        command,
        saved_at: savedAt,
        bytes: facts.size,
        file: path,
        about:
          about.about !== null && typeof about.about === "object"
            ? about.about
            : {},
        order: Date.parse(savedAt),
      });
    }
  }
  entries.sort((left, right) => right.order - left.order);
  return {
    directories,
    entries_total: entries.length,
    bytes_total: bytesTotal,
    cap_bytes: options.capBytes ?? SAVED_OUTPUT_CAP_BYTES,
    entries: entries
      .slice(0, request.limit ?? 10)
      .map(({ order: _order, ...entry }) => entry),
  };
};

/** `rea saved-output clear [--older-than-days <n>]`: `removed` counts documents. */
export const clearSaved = async (
  options: SavedOutputStoreOptions,
  request: { readonly olderThanDays?: number } = {},
): Promise<{
  readonly removed: number;
  readonly bytes_freed: number;
  readonly directories: readonly string[];
}> => {
  const directories = await existingDirectories(options);
  const now = options.now?.() ?? Date.now();
  const limit =
    request.olderThanDays === undefined
      ? undefined
      : request.olderThanDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  let bytesFreed = 0;
  for (const directory of directories) {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      continue;
    }
    for (const name of names) {
      const document = DOCUMENT_NAME.exec(name);
      const about = ABOUT_NAME.exec(name);
      if (document === null && about === null && !name.endsWith(".tmp"))
        continue;
      const path = join(directory, name);
      let facts;
      try {
        facts = await stat(path);
      } catch {
        continue;
      }
      if (limit !== undefined && now - facts.mtimeMs <= limit) continue;
      try {
        await unlink(path);
      } catch {
        continue;
      }
      bytesFreed += facts.size;
      if (document !== null) removed += 1;
    }
  }
  return { removed, bytes_freed: bytesFreed, directories };
};

const aboutValue = (value: unknown): string | number | boolean | undefined =>
  typeof value === "number" || typeof value === "boolean"
    ? value
    : typeof value === "string" &&
        Buffer.byteLength(value) <= ABOUT_VALUE_MAX_BYTES
      ? value
      : undefined;

/**
 * Up to six scalars copied from the document, never from argv or the
 * environment (contract 8.1): for Evidence (or the summary wrapper's
 * `summary`) the subject's name, local path, SHA-256 or URL, the Evidence id
 * and the operation; otherwise the first four root-level strings of at most
 * 200 bytes.
 */
export const aboutOf = (document: unknown): SavedAbout => {
  const out: Record<string, string | number | boolean> = {};
  const put = (key: string, value: unknown): void => {
    const copied = aboutValue(value);
    if (copied !== undefined && Object.keys(out).length < 6) out[key] = copied;
  };
  const evidence =
    isRecord(document) && typeof document.evidence_id === "string"
      ? document
      : isRecord(document) &&
          isRecord(document.summary) &&
          typeof document.summary.evidence_id === "string"
        ? document.summary
        : undefined;
  if (evidence !== undefined) {
    const subject = isRecord(evidence.subject) ? evidence.subject : {};
    const identity = isRecord(subject.identity) ? subject.identity : {};
    put("subject.name", subject.name);
    put("subject.local_path", subject.local_path);
    if (identity.sha256 !== undefined)
      put("subject.identity.sha256", identity.sha256);
    else put("subject.identity.url", identity.url);
    put("evidence_id", evidence.evidence_id);
    put("operation", evidence.operation);
    return out;
  }
  if (isRecord(document)) {
    let strings = 0;
    for (const [key, value] of Object.entries(document)) {
      if (strings >= 4) break;
      if (
        typeof value === "string" &&
        Buffer.byteLength(value) <= ABOUT_VALUE_MAX_BYTES
      ) {
        out[key] = value;
        strings += 1;
      }
    }
  }
  return out;
};
