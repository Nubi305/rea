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

/**
 * What the verdict cannot establish; `gate.json` repeats these lines. The
 * specification's "Trust" section holds the same list, in the same order.
 */
export const CLONE_RUN_RESIDUAL_TRUST: readonly string[] = [
  "The authorisation statement is recorded as given; REA cannot verify it.",
  "target.json, the scenarios and the declarations are the team's own statements: the verdict is about the addresses, clone root, excludes, names and material that target.json declares now, and anyone who can edit it can retarget the run.",
  "The verdict covers only the steps the scenarios contain. REA cannot tell whether they exercise every rule of the original, nor whether an obligation's statement describes the steps it cites; deleting a failing step or an unknown file leaves no trace.",
  "Evidence integrity is an unkeyed content digest: it catches an edited or misplaced file, not Evidence forged by recomputing the digest with REA's own code.",
  "A capture is bound to an address, not to what answered there: REA cannot prove which program or which build of the clone was serving, nor that it did not pass requests on to another server.",
  "Clone Evidence is bound to the tree digest its capture input was rendered for and that digest equals the tree now; an edit that was reverted between the two is not visible.",
  "Excluded clone paths are neither digested nor checked for copied files or names.",
  "Renames and volatile fields are declarations: a rename can declare away any difference in on-screen text or a string value, and an honoured volatile field is compared by shape only. The gate lists those that took effect.",
  "A waiver's person and reason are recorded as given.",
  "The copied-file check knows the original's files only from the declared material and from reply bodies its captures recorded, 64 KiB each at most; the name check knows only the declared names.",
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
 * finding in the returned gate. The checks do not wait for one another: the
 * original side is rendered, admitted and described before a clone exists.
 * A refusal of `comparer.compare` is returned as this call's refusal.
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
