import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { CloneRunGate } from "../../domain/cloneRun/cloneRunSchemas.js";
import type { Result } from "../../domain/result.js";
import type {
  ScenarioBehaviorCaptureFacts,
  ScenarioBehaviorComparer,
} from "../../domain/scenarioBehaviorComparison.js";
import type { CloneTreeSnapshot } from "./CloneRunTreeDigest.js";

/**
 * The referee: recompute every check of a clone run from authenticated
 * Evidence and the clone's current files, and issue the verdict and worklist.
 * Contract: docs/specs/reconstruction/clone-runs/spec.md, "What done means".
 *
 * It never starts, stops or resets a target, and it never reads its own
 * outputs as a source of a pass.
 */

/** What the verdict cannot establish; `gate.json` repeats these lines. */
export const CLONE_RUN_RESIDUAL_TRUST: readonly string[] = [
  "The authorisation statement is recorded as given; REA cannot verify it.",
  "Evidence integrity is a content digest, not a signature: it detects an edited file, not Evidence forged with REA's own algorithm.",
  "A capture is bound to an address, not to what answered there: REA cannot prove which program, or which build of the clone, was serving when it was captured.",
  "Clone Evidence is bound to the tree digest its capture input was rendered for and that digest equals the tree now; an edit that was reverted between the two is not visible.",
  "Excluded clone paths are neither digested nor checked for copied files or names.",
  "REA does not reset targets; a clean start is inferred from the fingerprint steps only.",
  "The journal is the referee's own output; removing it can hide a stall and cannot produce a pass.",
];

/** What the referee is given instead of reaching for it, so tests supply fakes. */
export interface CloneRunEvaluationDependencies<
  Capture extends ScenarioBehaviorCaptureFacts,
> {
  /** The comparer; production passes `SCENARIO_BEHAVIOR_COMPARER`. */
  readonly comparer: ScenarioBehaviorComparer<Capture>;
  /** Production passes `digestCloneTree`. */
  readonly digestTree: (
    root: string,
    exclude: readonly string[],
    options?: { readonly signal?: AbortSignal },
  ) => Promise<Result<CloneTreeSnapshot, AnalysisError>>;
  readonly now: () => Date;
}

/**
 * Evaluate one run folder and write the referee's outputs. A missing run
 * directory or `target.json` is a refusal; every other problem is a blocking
 * finding in the returned gate.
 */
export const evaluateCloneRun = <Capture extends ScenarioBehaviorCaptureFacts>(
  runDirectory: string,
  dependencies: CloneRunEvaluationDependencies<Capture>,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Result<CloneRunGate, AnalysisError>> => {
  void runDirectory;
  void dependencies;
  void options;
  throw new Error("evaluateCloneRun is not implemented yet");
};
