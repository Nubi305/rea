import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { boundedList, describeBoundedList } from "../domain/boundedList.js";
import {
  AnalysisInputError,
  type AnalysisInputIssue,
} from "../domain/analysisErrorCore.js";
import type { Evidence } from "../domain/evidence.js";
import { err, ok, type Result } from "../domain/result.js";
import { authenticateEvidenceBundleValue } from "./EvidenceBundleFiles.js";
import { evidenceFileEnvelopeKind } from "./EvidenceFileEnvelope.js";

/** The command that reads a saved capture, its file argument and the capture operations it reads. */
export interface SavedCaptureSite {
  readonly operation: string;
  /** Issue path of the capture file argument. */
  readonly path: AnalysisInputIssue["path"];
  /** Operations whose Evidence this command reads as a capture. */
  readonly captureOperations: readonly string[];
  /** Whether `value` is a sealed snapshot whose payloads the records may borrow. */
  readonly immutable?: boolean;
}

/** Identities listed in a refusal stay few, so a session bundle cannot grow the message. */
const LISTED_RECORDS = 4;

const listRecords = (records: readonly Evidence[]): string => {
  const listed = boundedList(records, LISTED_RECORDS);
  return describeBoundedList(
    {
      items: listed.items.map(
        (record) => `${record.evidence_id} (${record.operation})`,
      ),
      omitted: listed.omitted,
    },
    ", ",
  );
};

const plural = (count: number, noun: string): string =>
  `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

/** Says the file is a bundle, how many capture records it holds and what the command reads instead. */
const captureCountRefusal = (
  file: string,
  site: SavedCaptureSite,
  captures: readonly Evidence[],
  records: readonly Evidence[],
): AnalysisInputError => {
  const accepted = site.captureOperations.join(" or ");
  const held =
    captures.length > 0
      ? `: ${listRecords(captures)}`
      : records.length === 0
        ? ""
        : ` among its ${plural(records.length, "record")}: ${listRecords(records)}`;
  const message = `${file} is an Evidence bundle holding ${plural(captures.length, "capture record")}${held}. ${site.operation} reads one capture: pass a file that holds exactly one ${accepted} record, either the bundle one capture command saved with --evidence_output or that command's --format json output.`;
  return new AnalysisInputError(site.operation, { userMessage: message }, [
    {
      path: site.path,
      reason: "invalid_value",
      expected: `one ${accepted} record`,
      message,
    },
  ]);
};

/**
 * Read a saved capture that is an Evidence bundle, the form `--evidence_output`
 * writes: the bundle owner authenticates it, and its one capture record is the
 * capture. Returns undefined for any other value, which the command's own
 * record reader decides. The caller passes the value it already read, so the
 * bytes it hashes or copies are the bytes that were authenticated.
 */
export const savedBundleCapture = (
  value: unknown,
  file: string,
  site: SavedCaptureSite,
): Result<Evidence, AnalysisError> | undefined => {
  if (evidenceFileEnvelopeKind(value) !== "evidence-bundle") return undefined;
  const bundle = authenticateEvidenceBundleValue(value, file, {
    operation: site.operation,
    immutable: site.immutable === true,
  });
  if (!bundle.ok) return bundle;
  const { records } = bundle.value;
  const captures = records.filter((record) =>
    site.captureOperations.includes(record.operation),
  );
  const [only] = captures;
  return only !== undefined && captures.length === 1
    ? ok(only)
    : err(captureCountRefusal(file, site, captures, records));
};
