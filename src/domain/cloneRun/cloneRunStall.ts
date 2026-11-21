import type { CloneRunJournalEntry } from "./cloneRunSchemas.js";

/**
 * The stall rule of a clone run, as a pure function over the journal and the
 * state of the evaluation in hand.
 * Contract: docs/reference/clone-runs.md, "Stall".
 *
 * `stalled` means the team acted and nothing improved. It can only replace
 * `not_done`: the journal is the referee's own output and never yields a pass.
 */

/** What one evaluation found, as the journal records it. */
export interface CloneRunStallState {
  /** Every scenario had its captures admitted on both sides. */
  readonly judged: boolean;
  readonly failuresSha256: string;
  readonly cloneTreeSha256: string | null;
  readonly evidenceSha256: string;
  /**
   * A blocking finding carries a capture or removal command of the referee's
   * own: its prescribed remedy is other Evidence, so one round of new
   * captures with the same findings is the remedy being tried, not a stall.
   */
  readonly awaitsCapture: boolean;
  /**
   * What kept an evaluation that is not judged from being judged, as the
   * outlook words it: the check that did not get as far as comparing.
   * Without it the outlook names captures that are not admitted yet.
   */
  readonly notJudgedBecause?: string;
}

export interface CloneRunStall {
  /** Judged clone trees so far, this evaluation included. */
  readonly round: number;
  /** Judged states of this clone tree with these findings, this one included; 0 when not judged. */
  readonly attempts: number;
  readonly repeated: boolean;
  /** Why a result that is not a pass reads `stalled`, or null when it reads `not_done`. */
  readonly stalled: "round_limit" | "no_progress" | null;
  /** Whether the state differs from the journal's last line, so a line is appended. */
  readonly record: boolean;
  /** What would make the next evaluation read `stalled`, for a result that is not a pass. */
  readonly outlook: string;
}

type JudgedState = Pick<
  CloneRunStallState,
  "failuresSha256" | "cloneTreeSha256" | "evidenceSha256"
>;

const sameState = (left: JudgedState, right: JudgedState): boolean =>
  left.failuresSha256 === right.failuresSha256 &&
  left.cloneTreeSha256 === right.cloneTreeSha256 &&
  left.evidenceSha256 === right.evidenceSha256;

/** Judged attempts with one set of findings on one clone tree before the result reads `stalled`. */
const ATTEMPT_LIMIT = 2;
/** The same when the referee itself asked for other Evidence: its remedy is tried once first. */
const ATTEMPT_LIMIT_AWAITING_CAPTURE = 3;

/**
 * Where a run stands. The rule, in the order the properties are tested:
 *
 * - Only judged lines count. Evaluating one state again, at once or later, is
 *   the same attempt of the same round: adjacent equal lines are one, and a
 *   state equal to the last judged one adds nothing, also when unjudged
 *   evaluations lie in between.
 * - A round is a judged clone tree: a judged evaluation starts one when the
 *   tree differs from the last judged tree. New captures and edits to the
 *   authored files never use up a round.
 * - Within a round, an attempt is a judged state with these findings from
 *   Evidence not judged with them before. The second attempt reads `stalled`
 *   (the team acted on the Evidence or the authored files, and the findings
 *   and the clone are what they were); the third when a finding itself asks
 *   for other Evidence, so the referee's own remedy does not stall on its
 *   first try.
 * - Reaching `maxRounds` reads `stalled`, judged or not.
 */
export const cloneRunStall = (
  journal: readonly CloneRunJournalEntry[],
  state: CloneRunStallState,
  maxRounds: number,
): CloneRunStall => {
  const last = journal.at(-1);
  const record =
    last === undefined ||
    last.judged !== state.judged ||
    !sameState(
      {
        failuresSha256: last.failures_sha256,
        cloneTreeSha256: last.clone_tree_sha256,
        evidenceSha256: last.evidence_sha256,
      },
      state,
    );
  const judged: JudgedState[] = journal
    .filter((entry) => entry.judged)
    .map((entry) => ({
      failuresSha256: entry.failures_sha256,
      cloneTreeSha256: entry.clone_tree_sha256,
      evidenceSha256: entry.evidence_sha256,
    }));
  if (state.judged) judged.push(state);
  let round = 0;
  /** The judged states of the current round, in order. */
  let current: JudgedState[] = [];
  for (const entry of judged) {
    const previous = current.at(-1);
    if (previous === undefined) round += 1;
    else if (previous.cloneTreeSha256 !== entry.cloneTreeSha256) {
      round += 1;
      current = [];
    }
    current.push(entry);
  }
  const attempts = state.judged
    ? new Set(
        current
          .filter((entry) => entry.failuresSha256 === state.failuresSha256)
          .map((entry) => entry.evidenceSha256),
      ).size
    : 0;
  const limit = state.awaitsCapture
    ? ATTEMPT_LIMIT_AWAITING_CAPTURE
    : ATTEMPT_LIMIT;
  const stalled =
    round >= maxRounds
      ? "round_limit"
      : attempts >= limit
        ? "no_progress"
        : null;
  return {
    round,
    attempts,
    repeated: attempts >= ATTEMPT_LIMIT,
    stalled,
    record,
    outlook: outlook(state, { round, attempts, limit, stalled }, maxRounds),
  };
};

const outlook = (
  state: CloneRunStallState,
  stall: {
    readonly round: number;
    readonly attempts: number;
    readonly limit: number;
    readonly stalled: CloneRunStall["stalled"];
  },
  maxRounds: number,
): string => {
  const { round, attempts, limit, stalled } = stall;
  if (stalled === "round_limit")
    return `Round ${round} of ${maxRounds}: the limit of judged clone trees is reached, so every result that is not a pass reads stalled. The lead reports the remaining findings, or raises limits.max_rounds in target.json.`;
  if (stalled === "no_progress")
    return `Round ${round} of ${maxRounds}, judged: these same blocking findings were judged ${attempts} times on this clone tree, each time from other Evidence. It reads not_done again as soon as a finding or the clone's files change; evaluating again without a change stays stalled.`;
  const nextRound =
    round + 1 >= maxRounds
      ? ` The next changed clone tree is round ${round + 1}, the limit, and reads stalled unless it passes.`
      : "";
  if (!state.judged)
    return `Not judged: ${state.notJudgedBecause ?? "a scenario lacks admitted captures on a side"}, so this evaluation counts as no round and no attempt (${round} of ${maxRounds} rounds used). Evaluating again is free.${nextRound}`;
  const left = limit - attempts;
  return `Round ${round} of ${maxRounds}, judged, attempt ${attempts} of ${limit} with these findings on this clone tree. Evaluating this state again is free. ${
    left === 1
      ? "The next judged evaluation that finds the same blocking findings on the same clone tree from other Evidence (captures added or removed) reads stalled"
      : "One round of new captures with the same findings is expected, because a finding asks for other Evidence; the same findings on the same clone tree after a second change of Evidence read stalled"
  }. A changed clone tree starts a new round, and changed findings a new count.${nextRound}`;
};
