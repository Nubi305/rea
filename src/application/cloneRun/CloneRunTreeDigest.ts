import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
  readlink,
  realpath,
  stat,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisInputError,
  cancelledBy,
} from "../../domain/analysisErrorCore.js";
import { digestCanonicalValue } from "../../domain/canonicalDigest.js";
import { EVALUATE_CLONE_RUN_OPERATION } from "../../domain/cloneRun/cloneRunSchemas.js";
import { isPathWithinRoot } from "../../domain/localPath.js";
import { err, ok, type Result } from "../../domain/result.js";
import { OwnedFileHandle } from "../../filesystem/OwnedFileHandle.js";
import { withOwnedFileHandle } from "../../filesystem/OwnedRegularFile.js";
import { errorMessage } from "../../kernel/errorMessage.js";
import { sha256Hex } from "../../kernel/sha256Hex.js";

/**
 * The digest that ties clone-side Evidence to the clone's files.
 * Contract: docs/specs/reconstruction/clone-runs/spec.md, "Staleness".
 */

/** One entry of the clone tree, by its `/`-separated path relative to the root. */
export interface CloneTreeFile {
  readonly path: string;
  /** `file`: SHA-256 of the bytes. `symlink`: SHA-256 of the link text; links are never followed. */
  readonly kind: "file" | "symlink";
  readonly sha256: string;
  readonly bytes: number;
}

/**
 * A link whose target the digest does not cover. `outside`: its text leaves
 * the clone root on its way (`cloneTreeLinkTextLeavesRoot`), or its resolved
 * target lies outside it. `excluded`: the
 * target lies under an exclude. `unresolved`: the link cannot be resolved now
 * (its target is absent, or the chain loops), so nothing shows where it will
 * lead when the clone runs.
 */
export interface CloneTreeUnsafeLink {
  readonly path: string;
  readonly cause: "outside" | "excluded" | "unresolved";
}

/** An entry the walk could not read, with the system's reason. */
export interface CloneTreeUnreadable {
  readonly path: string;
  readonly detail: string;
}

/** The clone tree as one evaluation read it. */
export interface CloneTreeSnapshot {
  /** `cloneTreeSha256` of `files`. */
  readonly sha256: string;
  /** Sorted by path in UTF-16 code-unit order; excluded paths are absent. */
  readonly files: readonly CloneTreeFile[];
  /** The declared excludes that matched a path under the root, as declared. Each names one excluded path. */
  readonly exclude: readonly string[];
  /**
   * Links whose target the digest does not cover. What such a link serves
   * can change without the digest changing, so the referee blocks on each
   * (`clone_symlink_outside_root`). A link is judged by its text first, so
   * one that leaves the root is listed whether or not its target exists.
   */
  readonly unsafeLinks: readonly CloneTreeUnsafeLink[];
  /**
   * Entries that could not be read or recorded, so the digest does not cover
   * them: the referee blocks on each (`clone_path_unreadable`). An entry that
   * vanished during the walk is not listed; it is absent, as if never there.
   */
  readonly unreadable: readonly CloneTreeUnreadable[];
}

const CLONE_TREE_FORMAT = "rea.clone-tree/1";
/** Bytes read per call; a file is hashed as a stream and never held whole. */
const READ_CHUNK_BYTES = 64 * 1024;

const byPath = (
  left: { readonly path: string },
  right: { readonly path: string },
): number => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

/**
 * The digest of a file list: `digestCanonicalValue` of
 * `{ tree: "rea.clone-tree/1", files: [[path, kind, sha256], ...] }` in path
 * order. Sizes, modes and times are not part of it, and neither are empty
 * directories or entries that are not regular files or links (a FIFO, a
 * socket, a device).
 */
export const cloneTreeSha256 = (files: readonly CloneTreeFile[]): string =>
  digestCanonicalValue(
    {
      tree: CLONE_TREE_FORMAT,
      files: files
        .toSorted(byPath)
        .map(({ path, kind, sha256 }) => [path, kind, sha256]),
    },
    "Clone tree",
  );

/** An exclude as declared, without a leading `./` or a trailing `/`. */
const excludeSegments = (exclude: string): string =>
  exclude.replace(/^(?:\.\/)+/u, "").replace(/\/+$/u, "");

/** Whether a relative path falls under a declared exclude, compared on whole leading segments. */
export const isCloneTreePathExcluded = (
  path: string,
  exclude: readonly string[],
): boolean =>
  exclude.some((declared) => {
    const prefix = excludeSegments(declared);
    return (
      prefix !== "" &&
      prefix !== "." &&
      (path === prefix || path.startsWith(`${prefix}/`))
    );
  });

/**
 * Whether a link's text leaves the clone root when it is walked segment by
 * segment from the link's own directory. An absolute text starts outside; a
 * relative one leaves as soon as a `..` rises above the root, whatever it
 * does afterwards. A text that comes back in by the root's own name
 * (`../clone/app.mjs` in a root named `clone`) has still left: it names the
 * root from outside, so it leads elsewhere once the root is moved, renamed or
 * reached through another path. `linkPath` is the link's `/`-separated path
 * relative to the root.
 */
export const cloneTreeLinkTextLeavesRoot = (
  linkPath: string,
  text: string,
): boolean => {
  if (isAbsolute(text)) return true;
  // Directories between the root and the link.
  let depth = linkPath.split("/").length - 1;
  for (const segment of text.split(sep === "/" ? "/" : /[\\/]/u)) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") depth += 1;
    else if (depth === 0) return true;
    else depth -= 1;
  }
  return false;
};

const errnoCode = (cause: unknown): unknown =>
  typeof cause === "object" && cause !== null && "code" in cause
    ? cause.code
    : undefined;

/** The refusal for a root that is absent or not a directory. */
const rootMissing = (root: string, cause?: unknown): AnalysisInputError =>
  new AnalysisInputError(EVALUATE_CLONE_RUN_OPERATION, {
    ...(cause === undefined ? {} : { cause }),
    conformsToInputContract: true,
    userMessage: `The clone root ${root} does not exist or is not a directory.`,
    remediationAction:
      "Create the clone's source directory, or correct clone.root in target.json.",
  });

const readFailure = (path: string, cause: unknown): AnalysisInputError =>
  new AnalysisInputError(EVALUATE_CLONE_RUN_OPERATION, {
    cause,
    conformsToInputContract: true,
    userMessage: `Could not read ${path} while digesting the clone tree: ${errorMessage(cause)}`,
    remediationAction:
      "Make the path readable, or list it in clone.exclude in target.json; excluded paths are neither digested nor checked.",
  });

/**
 * Read one regular file of the tree in chunks, without following a link that
 * replaced it. `onChunk` may return `"stop"` to end the read early. The chunk
 * is reused by the next read.
 */
export const readCloneTreeFile = async (
  path: string,
  onChunk: (chunk: Buffer) => "stop" | undefined,
): Promise<void> => {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  await withOwnedFileHandle(path, new OwnedFileHandle(handle), {}, async () => {
    const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) return;
      position += bytesRead;
      if (onChunk(chunk.subarray(0, bytesRead)) === "stop") return;
    }
  });
};

/** Hash one regular file as a stream. */
const hashFile = async (
  path: string,
  read: typeof readCloneTreeFile = readCloneTreeFile,
): Promise<{ readonly sha256: string; readonly bytes: number }> => {
  const hash = createHash("sha256");
  let bytes = 0;
  await read(path, (chunk) => {
    hash.update(chunk);
    bytes += chunk.length;
    return undefined;
  });
  return { sha256: hash.digest("hex"), bytes };
};

const isVanished = (cause: unknown): boolean => errnoCode(cause) === "ENOENT";

/** A directory's entries with their raw names, so a name that is not UTF-8 is seen and not misread. */
const readEntries = async (directory: string) =>
  (await readdir(directory, { withFileTypes: true, encoding: "buffer" })).map(
    (entry) => {
      const name = entry.name.toString("utf8");
      return {
        entry,
        name,
        nameIsText: Buffer.from(name, "utf8").equals(entry.name),
      };
    },
  );

const NAME_NOT_TEXT =
  "its name is not valid UTF-8, so its path cannot be recorded; rename it";

/**
 * Read every file under the clone root except the declared excludes and
 * digest the tree. The root is symlink-resolved first; links inside it are
 * recorded by their text and never followed, and entries that are neither
 * regular files, directories nor links are skipped. A root that is absent or
 * not a directory is a refusal the referee reports as `clone_root_missing`.
 * An entry that vanishes during the walk is skipped; any other entry that
 * cannot be read is returned in `unreadable`, never thrown.
 *
 * Files are hashed one at a time as streams, so memory does not grow with the
 * tree; the cost is one read of every non-excluded byte per evaluation.
 */
export const digestCloneTree = async (
  root: string,
  exclude: readonly string[],
  options: {
    readonly signal?: AbortSignal;
    /** How a file's bytes are read: `readCloneTreeFile`, unless a test stands in front of it to change the tree between the listing and the read. */
    readonly readFile?: typeof readCloneTreeFile;
  } = {},
): Promise<Result<CloneTreeSnapshot, AnalysisError>> => {
  let resolvedRoot: string;
  try {
    resolvedRoot = await realpath(root);
    if (!(await lstat(resolvedRoot)).isDirectory())
      return err(rootMissing(root));
  } catch (cause: unknown) {
    const code = errnoCode(cause);
    return err(
      code === "ENOENT" || code === "ENOTDIR"
        ? rootMissing(root, cause)
        : readFailure(root, cause),
    );
  }

  const files: CloneTreeFile[] = [];
  const unsafeLinks: CloneTreeUnsafeLink[] = [];
  const unreadable: CloneTreeUnreadable[] = [];
  const matched = new Set<string>();
  const failed = (path: string, cause: unknown): void => {
    if (!isVanished(cause))
      unreadable.push({ path, detail: errorMessage(cause) });
  };
  /** Why the digest does not cover what a link leads to, judged by its text before its target. */
  const linkCause = async (
    path: string,
    absolute: string,
    text: string,
  ): Promise<CloneTreeUnsafeLink["cause"] | undefined> => {
    if (cloneTreeLinkTextLeavesRoot(path, text)) return "outside";
    const target = await realpath(absolute).catch(() => undefined);
    if (target === undefined) return "unresolved";
    if (!isPathWithinRoot(resolvedRoot, target)) return "outside";
    return isCloneTreePathExcluded(
      relative(resolvedRoot, target).split(sep).join("/"),
      exclude,
    )
      ? "excluded"
      : undefined;
  };
  const pending: string[] = [""];
  for (;;) {
    const directory = pending.pop();
    if (directory === undefined) break;
    const absoluteDirectory = join(resolvedRoot, directory);
    let entries: Awaited<ReturnType<typeof readEntries>>;
    try {
      entries = await readEntries(absoluteDirectory);
    } catch (cause: unknown) {
      failed(directory === "" ? "." : directory, cause);
      continue;
    }
    for (const { entry, name, nameIsText } of entries) {
      if (options.signal?.aborted === true)
        return err(cancelledBy(EVALUATE_CLONE_RUN_OPERATION, options.signal));
      const path = directory === "" ? name : `${directory}/${name}`;
      const excludedBy = exclude.filter((declared) =>
        isCloneTreePathExcluded(path, [declared]),
      );
      if (excludedBy.length > 0) {
        for (const declared of excludedBy) matched.add(declared);
        continue;
      }
      if (!nameIsText) {
        unreadable.push({ path, detail: NAME_NOT_TEXT });
        continue;
      }
      const absolute = join(absoluteDirectory, name);
      try {
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isSymbolicLink()) {
          const text = await readlink(absolute);
          files.push({
            path,
            kind: "symlink",
            sha256: sha256Hex(text),
            bytes: Buffer.byteLength(text),
          });
          const cause = await linkCause(path, absolute, text);
          if (cause !== undefined) unsafeLinks.push({ path, cause });
        } else if (entry.isFile())
          files.push({
            path,
            kind: "file",
            ...(await hashFile(absolute, options.readFile)),
          });
      } catch (cause: unknown) {
        failed(path, cause);
      }
    }
  }
  files.sort(byPath);
  return ok({
    sha256: cloneTreeSha256(files),
    files,
    exclude: exclude.filter((declared) => matched.has(declared)),
    unsafeLinks: unsafeLinks.toSorted(byPath),
    unreadable: unreadable.toSorted(byPath),
  });
};

/** The files of a directory of original material, with what could not be read. */
export interface OriginalMaterialSnapshot {
  /** Regular files by `/`-separated path under the directory, also those reached through links. */
  readonly files: readonly {
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
  }[];
  readonly unreadable: readonly CloneTreeUnreadable[];
}

/**
 * Hash every regular file under a directory of material taken from the
 * original. Unlike the clone tree, links are followed: a linked file or
 * directory is read by its real path, each real directory once, because
 * material that is not read cannot show a copy. A link that cannot be
 * resolved and an entry that cannot be read are returned in `unreadable`.
 */
export const digestOriginalMaterial = async (
  directory: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Result<OriginalMaterialSnapshot, AnalysisError>> => {
  const files: {
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
  }[] = [];
  const unreadable: CloneTreeUnreadable[] = [];
  const visited = new Set<string>();
  const pending: { readonly real: string; readonly shown: string }[] = [];
  const enter = async (path: string, shown: string): Promise<void> => {
    const real = await realpath(path);
    if (visited.has(real)) return;
    visited.add(real);
    pending.push({ real, shown });
  };
  try {
    await enter(directory, "");
  } catch (cause: unknown) {
    return ok({
      files,
      unreadable: [{ path: ".", detail: errorMessage(cause) }],
    });
  }
  for (;;) {
    const next = pending.pop();
    if (next === undefined) break;
    let entries: Awaited<ReturnType<typeof readEntries>>;
    try {
      entries = await readEntries(next.real);
    } catch (cause: unknown) {
      unreadable.push({ path: next.shown || ".", detail: errorMessage(cause) });
      continue;
    }
    for (const { entry, name, nameIsText } of entries) {
      if (options.signal?.aborted === true)
        return err(cancelledBy(EVALUATE_CLONE_RUN_OPERATION, options.signal));
      const path = next.shown === "" ? name : `${next.shown}/${name}`;
      if (!nameIsText) {
        unreadable.push({ path, detail: NAME_NOT_TEXT });
        continue;
      }
      const absolute = join(next.real, name);
      try {
        if (entry.isDirectory()) await enter(absolute, path);
        else if (entry.isFile())
          files.push({ path, ...(await hashFile(absolute)) });
        else if (entry.isSymbolicLink()) {
          const target = await realpath(absolute);
          const kind = await stat(target);
          if (kind.isDirectory()) await enter(target, path);
          else if (kind.isFile())
            files.push({ path, ...(await hashFile(target)) });
        }
      } catch (cause: unknown) {
        if (!isVanished(cause) || entry.isSymbolicLink())
          unreadable.push({
            path,
            detail: entry.isSymbolicLink()
              ? `the link cannot be followed: ${errorMessage(cause)}`
              : errorMessage(cause),
          });
      }
    }
  }
  return ok({
    files: files.toSorted(byPath),
    unreadable: unreadable.toSorted(byPath),
  });
};
