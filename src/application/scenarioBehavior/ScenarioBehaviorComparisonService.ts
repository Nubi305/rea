import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Result } from "../../domain/result.js";
import type {
  ScenarioBehaviorCaptureFacts,
  ScenarioBehaviorComparer,
  ScenarioBehaviorComparison,
  ScenarioBehaviorComparisonRequest,
  ScenarioBehaviorTable,
} from "../../domain/scenarioBehaviorComparison.js";

/**
 * Behaviour comparison of browser scenario captures.
 * Contract: docs/specs/reconstruction/clone-runs/spec.md, "The comparer".
 *
 * Reuses the capture owners instead of reading Evidence JSON itself:
 * `readEvidenceFileSource` authenticates the file, `parseCaptureEvidence`
 * (purpose "manifest", which keeps request bodies) validates the capture,
 * `probeRequests` yields each request with its answer and step id, and
 * `compareAnswers` is the differ.
 *
 * Three behaviours of those owners must not leak into a verdict (each was
 * observed on real captures; see the specification's verified facts):
 * `probeRequests` picks the origin with the most JSON-like records, so this
 * module passes the capture's start origin instead; `compareAnswers` notices
 * a missing or oversized body on its first argument only and treats clocks of
 * one format as equal, so missing data is classified on both sides before it
 * is called and an exact comparison runs beside it; and a redirect reply is
 * marked unobserved although it has no body (`replyBodyExpected`).
 */

/**
 * One authenticated capture as the comparer holds it. Consumers read only the
 * `ScenarioBehaviorCaptureFacts` members; the rest belongs to this module.
 */
export interface ScenarioBehaviorCapture extends ScenarioBehaviorCaptureFacts {
  /** Per-step observations this module derived; opaque to consumers. */
  readonly observations: unknown;
}

const notImplemented = (name: string): never => {
  throw new Error(`${name} is not implemented yet`);
};

/**
 * Read and authenticate one capture-browser-scenario Evidence file, a record
 * or a bundle holding exactly one capture record. An edited file, another
 * operation's Evidence or a capture without step ids is refused.
 */
export const readScenarioBehaviorCapture = (
  file: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Result<ScenarioBehaviorCapture, AnalysisError>> => {
  void file;
  void options;
  return notImplemented("readScenarioBehaviorCapture");
};

/**
 * Compare already read captures; complete detail, every left-side step.
 * Refused when a side is empty or its captures list different step ids.
 */
export const compareScenarioBehaviorCaptures = (
  request: ScenarioBehaviorComparisonRequest<ScenarioBehaviorCapture>,
): Result<ScenarioBehaviorComparison, AnalysisError> => {
  void request;
  return notImplemented("compareScenarioBehaviorCaptures");
};

/** One side's behaviour table: what the builders read instead of Evidence. */
export const describeScenarioBehavior = (
  captures: readonly ScenarioBehaviorCapture[],
): ScenarioBehaviorTable => {
  void captures;
  return notImplemented("describeScenarioBehavior");
};

/** The comparer the referee and the CLI inject. */
export const SCENARIO_BEHAVIOR_COMPARER: ScenarioBehaviorComparer<ScenarioBehaviorCapture> =
  {
    readCapture: readScenarioBehaviorCapture,
    compare: compareScenarioBehaviorCaptures,
    describe: describeScenarioBehavior,
  };

/** What `rea compare-scenario-behavior` passes after parsing its flags. */
export interface ScenarioBehaviorFilesRequest {
  /** Capture Evidence files of the left side, at least one. */
  readonly left: readonly string[];
  /** Capture Evidence files of the right side, at least one. */
  readonly right: readonly string[];
  /** An intended-differences file; its renames and volatile fields apply. */
  readonly differences?: string | undefined;
  /** The scenario whose volatile fields apply; required with `differences` when the file names several. */
  readonly scenario?: string | undefined;
  /** `summary` omits unchanged steps. */
  readonly detail: "summary" | "complete";
  readonly signal?: AbortSignal | undefined;
}

/** Read every file, compare, and project the requested detail. */
export const compareScenarioBehaviorFiles = (
  request: ScenarioBehaviorFilesRequest,
): Promise<Result<ScenarioBehaviorComparison, AnalysisError>> => {
  void request;
  return notImplemented("compareScenarioBehaviorFiles");
};
