import {
  scenarioStepStatus,
  STEP_FINDING_LIMIT,
  type ScenarioBehaviorFinding,
  type ScenarioStepKind,
  type ScenarioStepStatus,
} from "../scenarioBehaviorComparison.js";

/**
 * Which comparer findings block a step of a clone run, by the step's kind.
 * Contract: docs/reference/clone-runs.md, "Parity on setup and fingerprint
 * steps".
 *
 * A behaviour step must be `unchanged`, so every finding blocks it. A `setup-`
 * or `fp-` step ("prepared" below) is not behaviour: it may be unsteady, and
 * it may lack data no capture of either side can record. Its prefix is the
 * team's own choice, though, so nothing that shows the clone differing from a
 * steady original, and nothing only one side shows, may depend on it: a
 * rename, alone or with a declaration or a scenario edit, must never turn a
 * blocking finding into a silent one.
 *
 * | category                                  | status   | behaviour | prepared | why |
 * | ----------------------------------------- | -------- | --------- | -------- | --- |
 * | `value`, `status`, `shape`,               | changed  | blocks    | blocks   | 1   |
 * | `missing-step`, every differ category     |          |           |          |     |
 * | `declared-not-shown`                      | unknown  | blocks    | blocks   | 2   |
 * | `single-observation`                      | unknown  | blocks    | blocks   | 3   |
 * | `not-completed`                           | unknown  | blocks    | blocks   | 4   |
 * | `other-origin`, on one side only          | unknown  | blocks    | blocks   | 5   |
 * | `other-origin`, on both sides             | unknown  | blocks    | ungated  | 6   |
 * | `not-recorded`, on one side only          | unknown  | blocks    | blocks   | 7   |
 * | `not-recorded`, on both sides             | unknown  | blocks    | ungated  | 8   |
 * | `repeats-differ`                          | unstable | blocks    | ungated  | 9   |
 * | `undeclared-volatile`                     | unstable | blocks    | ungated  | 10  |
 *
 * 1. The original holds one value and no capture of the clone agrees with
 *    it. A category this table does not name is read the same way, so a new
 *    one blocks on every step until it is given a row.
 * 2. The original held the field steady over two or more replies and the
 *    clone differs. The declaration was not honoured, so this is the
 *    difference `value` would report, waiting for one more capture of the
 *    original. Ungated, a rename plus a declaration would hide any reply
 *    difference.
 * 3. The comparer emits it only where no capture of the clone agrees with
 *    the one value the original recorded. One more capture of the original
 *    turns it into `value` or into instability; until then it is a
 *    difference not yet confirmed, not a gap.
 * 4. The comparer compares nothing of a step the original did not complete,
 *    not even whether the clone completed it: an original that steadily
 *    fails where the clone answers is a difference an `expected_status` edit
 *    could hide. A prepared step that completes on neither side prepares
 *    nothing, so no honest scenario needs it ungated.
 * 5. One side sent the browser or a request to an origin the other side's
 *    captures sent nothing to at this step: the sides do different things,
 *    and what was exchanged there is not compared.
 * 6. Both sides talk to that origin (a third party both pages load). Nothing
 *    shows the sides differing, and a third party's answer is outside what a
 *    capture compares.
 * 7. The captures of one side recorded the data and no capture of the other
 *    did: a reply over the capture's body limit on one side only, or a side
 *    that never answers. That is a difference between the sides, or a loss
 *    one more capture repairs; either way a prefix must not silence it.
 * 8. No capture of either side recorded the data (a download, a body over
 *    the capture's limit on both sides, request events both captures
 *    omitted). Nothing was observed to differ and no capture can observe it:
 *    this is the stated exit for data a capture cannot record. The step then
 *    proves nothing, as a deleted step would.
 * 9. One side's own captures disagree. For the clone it stands alone only
 *    when one capture of the clone agrees with the original, so no steady
 *    difference is shown; where none agrees the comparer reports the
 *    difference as well, which blocks. On an `fp-` step the clean-start
 *    check blocks it as `start_state_dirty`.
 * 10. The original's own replies disagree at the field and no declaration
 *    names it: there is no steady value for the clone to differ from.
 *
 * A prepared step whose finding list the comparer cut blocks as well
 * (`cloneRunStepFindingsCut`): the comparer keeps the most severe findings and
 * ranks every gap last, so a blocking gap, or the other side of a gap that
 * would otherwise read as shared, can be among those it left out.
 */
type CloneRunFindingGate = "blocks" | "ungated" | "ungated-on-both";

/**
 * What each named category does on a `setup-` or `fp-` step.
 * `ungated-on-both` is ungated only when the other side shows the same gap at
 * the step, and blocks otherwise.
 */
export const CLONE_RUN_PREPARED_STEP_GATES: Readonly<
  Record<string, CloneRunFindingGate>
> = {
  value: "blocks",
  status: "blocks",
  shape: "blocks",
  "missing-step": "blocks",
  "declared-not-shown": "blocks",
  "single-observation": "blocks",
  "not-completed": "blocks",
  "other-origin": "ungated-on-both",
  "not-recorded": "ungated-on-both",
  "repeats-differ": "ungated",
  "undeclared-volatile": "ungated",
};

/** Findings the comparer keeps per step. A step that lists this many may have had more. */
export const CLONE_RUN_STEP_FINDING_LIMIT = STEP_FINDING_LIMIT;

/** Whether the comparer may have left findings of this step out of its list. */
export const cloneRunStepFindingsCut = (
  findings: readonly ScenarioBehaviorFinding[],
): boolean => findings.length >= CLONE_RUN_STEP_FINDING_LIMIT;

/**
 * The origin an `other-origin` finding names: its request is
 * `<method> <origin><path>#<occurrence>`. A request that does not read as
 * one is its own origin, so it only equals the same request on the other side.
 */
const otherOrigin = (finding: ScenarioBehaviorFinding): string => {
  const address = finding.request?.split(" ")[1];
  try {
    return address === undefined
      ? (finding.request ?? "")
      : new URL(address).origin;
  } catch {
    return finding.request ?? "";
  }
};

/**
 * What a gap is about, so the same gap on the other side can be recognised:
 * the other origin for `other-origin` (request lines to a third party may
 * differ between captures), otherwise the dimension and the request.
 */
const gapSubject = (finding: ScenarioBehaviorFinding): string =>
  JSON.stringify(
    finding.category === "other-origin"
      ? [finding.category, otherOrigin(finding)]
      : [finding.category, finding.dimension, finding.request, finding.pointer],
  );

/**
 * Whether the other side shows the same gap at the step: for `not-recorded`
 * and `other-origin`, data neither side's captures hold. A gap that names no
 * side is never shared.
 */
export const cloneRunGapShared = (
  finding: ScenarioBehaviorFinding,
  findings: readonly ScenarioBehaviorFinding[],
): boolean => {
  if (finding.side === null) return false;
  const subject = gapSubject(finding);
  return findings.some(
    (other) =>
      other.side !== null &&
      other.side !== finding.side &&
      gapSubject(other) === subject,
  );
};

/**
 * The findings that block a step of this kind, in the order given; empty for
 * a step nothing blocks. Every finding blocks a behaviour step. On a `setup-`
 * or `fp-` step the table above decides, and a category it does not name
 * blocks.
 */
export const cloneRunBlockingFindings = (
  kind: ScenarioStepKind,
  findings: readonly ScenarioBehaviorFinding[],
): readonly ScenarioBehaviorFinding[] => {
  if (kind === "behavior") return findings;
  return findings.filter((finding) => {
    const gate = CLONE_RUN_PREPARED_STEP_GATES[finding.category] ?? "blocks";
    return gate === "ungated-on-both"
      ? !cloneRunGapShared(finding, findings)
      : gate === "blocks";
  });
};

/** The status a step's worklist item is filed under: the worst of the findings that block it. */
export const cloneRunBlockingStatus = (
  blocking: readonly ScenarioBehaviorFinding[],
): Exclude<ScenarioStepStatus, "unchanged"> => {
  const status = scenarioStepStatus(blocking);
  return status === "unchanged" ? "unknown" : status;
};

/**
 * Whether a finding reports a reply field a declaration names and was not
 * honoured at: the original held it in one value and the clone differs.
 */
export const isDeclarationNotShown = (
  finding: ScenarioBehaviorFinding,
): boolean =>
  finding.dimension === "body" &&
  (finding.category === "declared-not-shown" ||
    finding.category === "single-observation");

/**
 * Whether a volatile declaration's pointer can name a leaf of the pattern a
 * finding or a volatile field reports (`volatilePointerPattern`: every array
 * index reads `*`). Segment for segment; a `*` of the pattern is met by `*`
 * or by an index. It errs towards a match, so a declaration that had an
 * effect is never left out of the gate's list.
 */
export const volatileDeclarationCovers = (
  declared: string,
  pattern: string,
): boolean => {
  const declaredTokens = declared.split("/");
  const patternTokens = pattern.split("/");
  return (
    declaredTokens.length === patternTokens.length &&
    declaredTokens.every((token, index) => {
      const other = patternTokens[index];
      return (
        token === other ||
        (other === "*" && /^\d+$/u.test(token)) ||
        (token === "*" && other !== undefined && /^\d+$/u.test(other))
      );
    })
  );
};
