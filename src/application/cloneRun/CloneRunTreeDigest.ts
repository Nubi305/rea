import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Result } from "../../domain/result.js";

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

const notImplemented = (name: string): never => {
  throw new Error(`${name} is not implemented yet`);
};

/**
 * The digest of a file list: `digestCanonicalValue` of
 * `{ tree: "rea.clone-tree/1", files: [[path, kind, sha256], ...] }` in path
 * order. Sizes, modes and times are not part of it.
 */
export const cloneTreeSha256 = (files: readonly CloneTreeFile[]): string => {
  void files;
  return notImplemented("cloneTreeSha256");
};

/** Whether a relative path falls under a declared exclude, compared on whole leading segments. */
export const isCloneTreePathExcluded = (
  path: string,
  exclude: readonly string[],
): boolean => {
  void path;
  void exclude;
  return notImplemented("isCloneTreePathExcluded");
};

/**
 * Read every file under the clone root except the declared excludes and
 * digest the tree. The root is symlink-resolved first; links inside it are
 * recorded by their text and never followed, and entries that are neither
 * regular files, directories nor links are skipped. A root that is absent or
 * not a directory is a refusal the referee reports as `clone_root_missing`.
 */
export const digestCloneTree = (
  root: string,
  exclude: readonly string[],
  options: { readonly signal?: AbortSignal } = {},
): Promise<Result<CloneTreeSnapshot, AnalysisError>> => {
  void root;
  void exclude;
  void options;
  return notImplemented("digestCloneTree");
};
