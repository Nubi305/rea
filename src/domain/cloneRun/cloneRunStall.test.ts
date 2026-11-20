import { describe, expect, it } from "vitest";

import type { CloneRunJournalEntry } from "./cloneRunSchemas.js";
import { cloneRunStall, type CloneRunStallState } from "./cloneRunStall.js";

const digest = (letter: string): string => letter.repeat(64);

/** A state by three letters: findings, clone tree, admitted Evidence. */
const state = (
  letters: string,
  options: { readonly judged?: boolean; readonly awaitsCapture?: boolean } = {},
): CloneRunStallState => ({
  judged: options.judged ?? true,
  failuresSha256: digest(letters.charAt(0)),
  cloneTreeSha256: digest(letters.charAt(1)),
  evidenceSha256: digest(letters.charAt(2)),
  awaitsCapture: options.awaitsCapture ?? false,
});

const line = (letters: string, judged = true): CloneRunJournalEntry => ({
  schema: "rea.clone-run.journal/1",
  at: "2026-01-01T00:00:00.000Z",
  round: 0,
  judged,
  verdict: "not_done",
  failures_sha256: digest(letters.charAt(0)),
  clone_tree_sha256: digest(letters.charAt(1)),
  evidence_sha256: digest(letters.charAt(2)),
});

describe("the stall rule", () => {
  it("counts the same state evaluated twice, in sequence or at once, as one round and one attempt", () => {
    const first = cloneRunStall([], state("abc"), 8);
    expect(first).toMatchObject({
      round: 1,
      attempts: 1,
      repeated: false,
      stalled: null,
      record: true,
    });
    // In sequence: the journal's last line is this state, so nothing is recorded.
    expect(cloneRunStall([line("abc")], state("abc"), 8)).toMatchObject({
      round: 1,
      attempts: 1,
      stalled: null,
      record: false,
    });
    // At once: two evaluations both appended the line before either saw the other's.
    expect(
      cloneRunStall([line("abc"), line("abc")], state("abc"), 8),
    ).toMatchObject({ round: 1, attempts: 1, repeated: false, stalled: null });
  });

  it("does not stall when a state is left through an unjudged evaluation and entered again", () => {
    const journal = [line("abc"), line("xbz", false)];
    const back = cloneRunStall(journal, state("abc"), 8);
    expect(back).toMatchObject({
      round: 1,
      attempts: 1,
      repeated: false,
      stalled: null,
      // The last line is the unjudged one, so the return is recorded, and still counts once.
      record: true,
    });
    expect(
      cloneRunStall([...journal, line("abc")], state("abc"), 8),
    ).toMatchObject({ round: 1, attempts: 1, stalled: null, record: false });
    // An unjudged evaluation is no round and no attempt.
    expect(
      cloneRunStall([line("abc")], state("xbz", { judged: false }), 8),
    ).toMatchObject({ round: 1, attempts: 0, stalled: null, record: true });
  });

  it("does not stall on the first try of the referee's own remedy, one more capture", () => {
    const asked = { awaitsCapture: true };
    // The capture the worklist asked for was taken and the data is still missing.
    const once = cloneRunStall([line("abc")], state("abd", asked), 8);
    expect(once).toMatchObject({
      round: 1,
      attempts: 2,
      repeated: true,
      stalled: null,
    });
    expect(once.outlook).toContain("attempt 2 of 3");
    // A second capture that changes nothing is the team going round.
    expect(
      cloneRunStall([line("abc"), line("abd")], state("abe", asked), 8),
    ).toMatchObject({ round: 1, attempts: 3, stalled: "no_progress" });
    // Without a finding that asks for Evidence, new captures with the same findings stall at once.
    expect(cloneRunStall([line("abc")], state("abd"), 8)).toMatchObject({
      round: 1,
      attempts: 2,
      repeated: true,
      stalled: "no_progress",
    });
  });

  it("starts a round only when the clone tree changes, and a new count when the findings change", () => {
    // Captures and authored-file edits on one tree never use up a round.
    const journal = [line("abc"), line("dbe"), line("fbg"), line("hbi")];
    expect(cloneRunStall(journal, state("jbk"), 2)).toMatchObject({
      round: 1,
      attempts: 1,
      stalled: null,
    });
    // A changed clone with the same findings is a new round, not a repeat.
    expect(cloneRunStall([line("abc")], state("axy"), 8)).toMatchObject({
      round: 2,
      attempts: 1,
      repeated: false,
      stalled: null,
    });
    // Findings seen before on this tree from other Evidence count, also when others came between.
    expect(
      cloneRunStall([line("abc"), line("dbe")], state("abf"), 8),
    ).toMatchObject({ round: 1, attempts: 2, stalled: "no_progress" });
    // A reverted clone is a new round with its own count.
    expect(
      cloneRunStall([line("abc"), line("axy")], state("abz"), 8),
    ).toMatchObject({ round: 3, attempts: 1, stalled: null });
  });

  it("reads stalled at the round limit, judged or not, and says so before it is reached", () => {
    const journal = [line("abc"), line("axd")];
    expect(cloneRunStall(journal, state("aye"), 3)).toMatchObject({
      round: 3,
      stalled: "round_limit",
    });
    expect(
      cloneRunStall(
        [...journal, line("aye")],
        state("ayf", { judged: false }),
        3,
      ),
    ).toMatchObject({ round: 3, attempts: 0, stalled: "round_limit" });
    const before = cloneRunStall([line("abc")], state("axd"), 3);
    expect(before).toMatchObject({ round: 2, stalled: null });
    expect(before.outlook).toContain("round 3, the limit");
  });

  it("says the round, whether it was judged and what would stall the next evaluation", () => {
    const judged = cloneRunStall([], state("abc"), 8).outlook;
    expect(judged).toContain("Round 1 of 8, judged, attempt 1 of 2");
    expect(judged).toContain(
      "The next judged evaluation that finds the same blocking findings on the same clone tree from other Evidence",
    );
    const unjudged = cloneRunStall([], state("abc", { judged: false }), 8);
    expect(unjudged.outlook).toContain("Not judged");
    expect(unjudged.outlook).toContain("0 of 8 rounds used");
    expect(
      cloneRunStall([], state("abc", { awaitsCapture: true }), 8).outlook,
    ).toContain("One round of new captures with the same findings is expected");
  });

  it("ignores what is not a journal line and never trusts a line's own round", () => {
    const forged = { ...line("abc"), round: 99 };
    expect(cloneRunStall([forged], state("abc"), 8)).toMatchObject({
      round: 1,
      attempts: 1,
      stalled: null,
    });
  });
});
