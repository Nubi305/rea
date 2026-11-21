import { summaryFinding, type SummaryFinding } from "./summaryFindings.js";

interface Occurrence {
  readonly logical_path: string;
  readonly artifact_id: string | null;
  readonly entry_kind: string;
  readonly declared_size?: number | null | undefined;
  readonly hash_status?: string | null | undefined;
}
interface Node {
  readonly artifact_id: string;
  readonly sha256?: string | null | undefined;
  readonly size?: number | null | undefined;
}

/**
 * An archive's entries with their sizes, largest first, one line each: path,
 * unpacked size, content SHA-256 and, for repeated content, the first entry
 * that holds the same bytes.
 */
export const artifactSummaryFindings = (
  occurrences: readonly Occurrence[],
  nodes: readonly Node[],
): SummaryFinding[] => {
  const byId = new Map(nodes.map((node) => [node.artifact_id, node]));
  const entries = occurrences
    .filter(
      (occurrence) =>
        occurrence.logical_path !== "." &&
        (occurrence.entry_kind === "file" || occurrence.entry_kind === "slice"),
    )
    .map((occurrence) => {
      const node =
        occurrence.artifact_id === null
          ? undefined
          : byId.get(occurrence.artifact_id);
      return {
        occurrence,
        size: node?.size ?? occurrence.declared_size ?? null,
        sha256: node?.sha256 ?? null,
      };
    })
    .sort(
      (left, right) =>
        (right.size ?? -1) - (left.size ?? -1) ||
        (left.occurrence.logical_path < right.occurrence.logical_path
          ? -1
          : left.occurrence.logical_path > right.occurrence.logical_path
            ? 1
            : 0),
    );
  const firstHolder = new Map<string, string>();
  const rows = entries.map(({ occurrence, size, sha256 }) => {
    const content = occurrence.artifact_id;
    const first = content === null ? undefined : firstHolder.get(content);
    if (content !== null && first === undefined)
      firstHolder.set(content, occurrence.logical_path);
    const hash =
      sha256 === null
        ? "sha256 unknown"
        : `sha256 ${sha256}${
            occurrence.hash_status === "verified" ||
            occurrence.hash_status === undefined ||
            occurrence.hash_status === null
              ? ""
              : ` (${occurrence.hash_status})`
          }`;
    return `${occurrence.logical_path} ${size === null ? "size unknown" : `${String(size)} B`} ${hash}${
      first === undefined ? "" : ` same content as ${first}`
    }`;
  });
  return [
    summaryFinding("entries_largest_first", rows, {
      kind: "inventory",
      collection: "occurrences",
      limit: 20,
    }),
  ];
};
