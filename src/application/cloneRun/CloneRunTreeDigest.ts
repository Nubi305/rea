import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readlink, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";

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

/** The clone tree as one evaluation read it. */
export interface CloneTreeSnapshot {
  /** `cloneTreeSha256` of `files`. */
  readonly sha256: string;
  /** Sorted by path in UTF-16 code-unit order; excluded paths are absent. */
  readonly files: readonly CloneTreeFile[];
  /** The excludes that applied, as declared. */
  readonly exclude: readonly string[];
  /**
   * Paths of symlinks whose fully resolved target lies outside the clone root
   * or under an exclude. What such a link serves can change without the
   * digest changing, so the referee blocks on each
   * (`clone_symlink_outside_root`). A dangling link is not listed.
   */
  readonly symlinksOutsideRoot: readonly string[];
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
 * order. Sizes, modes and times are not part of it.
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

/** A walk failure that names the path it happened at. */
class CloneTreeReadFailure extends Error {
  constructor(
    readonly path: string,
    override readonly cause: unknown,
  ) {
    super(`Could not read ${path}`, { cause });
  }
}

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
): Promise<{ readonly sha256: string; readonly bytes: number }> => {
  const hash = createHash("sha256");
  let bytes = 0;
  await readCloneTreeFile(path, (chunk) => {
    hash.update(chunk);
    bytes += chunk.length;
    return undefined;
  });
  return { sha256: hash.digest("hex"), bytes };
};

/**
 * Read every file under the clone root except the declared excludes and
 * digest the tree. The root is symlink-resolved first; links inside it are
 * recorded by their text and never followed, and entries that are neither
 * regular files, directories nor links are skipped. A root that is absent or
 * not a directory is a refusal the referee reports as `clone_root_missing`.
 *
 * Files are hashed one at a time as streams, so memory does not grow with the
 * tree; the cost is one read of every non-excluded byte per evaluation.
 */
export const digestCloneTree = async (
  root: string,
  exclude: readonly string[],
  options: { readonly signal?: AbortSignal } = {},
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
  const symlinksOutsideRoot: string[] = [];
  const pending: string[] = [""];
  try {
    for (;;) {
      const directory = pending.pop();
      if (directory === undefined) break;
      const absoluteDirectory = join(resolvedRoot, directory);
      const entries = await readdir(absoluteDirectory, {
        withFileTypes: true,
      }).catch((cause: unknown) => {
        throw new CloneTreeReadFailure(absoluteDirectory, cause);
      });
      for (const entry of entries) {
        if (options.signal?.aborted === true)
          return err(cancelledBy(EVALUATE_CLONE_RUN_OPERATION, options.signal));
        const path =
          directory === "" ? entry.name : `${directory}/${entry.name}`;
        if (isCloneTreePathExcluded(path, exclude)) continue;
        const absolute = join(absoluteDirectory, entry.name);
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
            const target = await realpath(absolute).catch(() => undefined);
            if (
              target !== undefined &&
              (!isPathWithinRoot(resolvedRoot, target) ||
                isCloneTreePathExcluded(
                  relative(resolvedRoot, target).split(sep).join("/"),
                  exclude,
                ))
            )
              symlinksOutsideRoot.push(path);
          } else if (entry.isFile())
            files.push({ path, kind: "file", ...(await hashFile(absolute)) });
        } catch (cause: unknown) {
          throw new CloneTreeReadFailure(absolute, cause);
        }
      }
    }
  } catch (cause: unknown) {
    if (cause instanceof CloneTreeReadFailure)
      return err(readFailure(cause.path, cause.cause));
    throw cause;
  }
  files.sort(byPath);
  return ok({
    sha256: cloneTreeSha256(files),
    files,
    exclude: [...exclude],
    symlinksOutsideRoot: symlinksOutsideRoot.toSorted(),
  });
};
