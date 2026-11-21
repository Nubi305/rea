import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { boundedList } from "../../domain/boundedList.js";
import { cloneRunIntendedDifferencesSchema } from "../../domain/cloneRun/cloneRunSchemas.js";
import { projectInputIssues } from "../../domain/inputIssueProjection.js";
import { equalJsonValues } from "../../domain/jsonValue.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  EVERY_STEP,
  SCENARIO_BEHAVIOR_OPERATION,
  STEP_VOLATILE_FIELD_LIMIT,
  judgeReplyLeaves,
  orderScenarioFindings,
  renameScenarioText,
  scenarioBehaviorVerdict,
  scenarioStartState,
  scenarioStepKind,
  scenarioStepStatus,
  volatilePointerMatches,
  volatilePointerPattern,
  type ScenarioBehaviorComparer,
  type ScenarioBehaviorComparison,
  type ScenarioBehaviorComparisonRequest,
  type ScenarioBehaviorDimension,
  type ScenarioBehaviorRename,
  type ScenarioBehaviorTable,
  type ScenarioBehaviorVolatileField,
} from "../../domain/scenarioBehaviorComparison.js";
import { inputError } from "../environment/environmentSource.js";
import { readJsonFile } from "../JsonFiles.js";
import {
  mapBodyStrings,
  ownAddressReader,
  type OwnAddressReader,
} from "./scenarioBehaviorAddress.js";
import {
  readScenarioBehaviorCapture,
  scenarioBehaviorRefusal as refusal,
  type RecordedBody,
  type ScenarioBehaviorCapture,
  type SentBody,
  type StepObservation,
  type TransactionObservation,
} from "./scenarioBehaviorCapture.js";
import {
  bodyLeaves,
  compareReplies,
  finding,
  repliesAsJson,
  shown,
  sideValues,
  type Side,
  type StepContext,
} from "./scenarioBehaviorReplies.js";

/**
 * Behaviour comparison of browser scenario captures.
 * Contract: docs/specs/reconstruction/clone-runs/spec.md, "The comparer".
 *
 * `scenarioBehaviorCapture.ts` reads one capture into per-step observations;
 * `scenarioBehaviorReplies.ts` compares the reply bodies of one transaction.
 * This module aligns the steps of two sides, compares every other dimension
 * and assembles the result and the behaviour table.
 */

export { readScenarioBehaviorCapture, type ScenarioBehaviorCapture };

/** Findings kept per step; the most severe are kept and the rest counted in `limitations`. */
const STEP_FINDING_LIMIT = 20;
/** Characters of equal text shown before the first difference of two on-screen texts. */
const TEXT_CONTEXT_CHARS = 30;
/** Reply bodies larger than this are left out of the behaviour table, not out of the comparison. */
const TABLE_BODY_LIMIT_BYTES = 8 * 1024;

/** A request whose reply body a capture recorded whole. */
type RepliedTransaction = TransactionObservation & {
  readonly reply: RecordedBody;
};

/**
 * A left value as it is compared: the capture's own address read as the
 * right side's, then the declared renames. Applied at the point a value is
 * compared, so only compared values are counted.
 */
interface LeftValues {
  readonly text: (step: StepObservation) => string | null;
  readonly sent: (transaction: TransactionObservation) => SentBody | null;
  readonly reply: (transaction: RepliedTransaction) => RecordedBody;
}

const leftValues = (
  addresses: OwnAddressReader,
  renames: readonly ScenarioBehaviorRename[],
  counts: number[],
): LeftValues => {
  const text = (value: string, origin: string): string =>
    renameScenarioText(addresses.text(value, origin), renames, counts);
  const body = <Body extends SentBody | RecordedBody>(
    value: Body,
    origin: string,
  ): Body =>
    renames.length === 0 && !addresses.applies(origin)
      ? value
      : mapBodyStrings(value, (string) => text(string, origin));
  return {
    text: (step) =>
      step.text === null ? null : text(step.text, step.start_origin),
    sent: ({ request_body: sent, start_origin: origin }) =>
      sent === null ? null : body(sent, origin),
    reply: ({ reply, start_origin: origin }) => body(reply, origin),
  };
};

/** What the comparison of one step needs beyond what the reply comparison does. */
interface ComparisonContext extends StepContext {
  readonly left: LeftValues;
  /**
   * Whether this step's on-screen text is, in every capture, the previous
   * step's, whose difference between the sides is already reported there.
   */
  readonly textCarried: boolean;
}

/** The step ids a comparison aligns by: REA's own steps are never compared. */
const comparedStepIds = (capture: ScenarioBehaviorCapture): string[] =>
  capture.observations.steps
    .filter((step) => step.kind !== "reserved")
    .map((step) => step.step_id);

const distinct = <Value>(
  values: readonly Value[],
  equal: (left: Value, right: Value) => boolean,
): Value[] => {
  const kept: Value[] = [];
  for (const value of values)
    if (!kept.some((other) => equal(other, value))) kept.push(value);
  return kept;
};

/**
 * Compare one value per capture across both sides; null is a value the
 * capture did not record. A value no capture of a side recorded is a gap. A
 * side whose captures disagree, in what they recorded or in whether they
 * recorded it, is unstable. The left's one recorded value is contradicted
 * only when no right capture agrees with it: a right side that agrees in one
 * capture and not in another disagrees with itself, which is its only
 * finding.
 */
const compareRecorded = <Value>(
  context: StepContext,
  where: {
    readonly dimension: ScenarioBehaviorDimension;
    readonly category: string;
    readonly request: string | null;
  },
  values: {
    readonly left: readonly (Value | null)[];
    readonly right: readonly (Value | null)[];
  },
  compare: {
    readonly equal: (left: Value, right: Value) => boolean;
    readonly show: (value: Value, other: Value) => string;
  },
): void => {
  const { dimension, request } = where;
  const recorded = (side: Side): Value[] =>
    values[side].filter((value): value is Value => value !== null);
  const sides = { left: recorded("left"), right: recorded("right") };
  for (const side of ["left", "right"] as const) {
    const [first, second] = distinct(sides[side], compare.equal);
    if (first === undefined)
      context.findings.push(
        finding(dimension, "not-recorded", { request, side }),
      );
    else if (second !== undefined)
      context.findings.push(
        finding(dimension, "repeats-differ", {
          request,
          ...sideValues(
            side,
            `${compare.show(first, second)} | ${compare.show(second, first)}`,
          ),
        }),
      );
    // Only a reply body is supplied by another capture; here a capture without the value disagrees with one that has it.
    else if (sides[side].length < values[side].length)
      context.findings.push(
        finding(dimension, "repeats-differ", {
          request,
          ...sideValues(
            side,
            `recorded in ${String(sides[side].length)} of ${String(values[side].length)} captures`,
          ),
        }),
      );
  }
  const [expected, unsteady] = distinct(sides.left, compare.equal);
  if (expected === undefined || unsteady !== undefined) return;
  const differing = sides.right.filter(
    (value) => !compare.equal(expected, value),
  );
  const [actual] = differing;
  if (actual === undefined || differing.length < sides.right.length) return;
  context.findings.push(
    finding(dimension, where.category, {
      request,
      expected: compare.show(expected, actual),
      actual: compare.show(actual, expected),
    }),
  );
};

const exact = <Value extends string | number>(
  left: Value,
  right: Value,
): boolean => left === right;

/** A text from shortly before where it first differs from the other, so the excerpt shows the difference. */
const textAtDifference = (text: string, other: string): string => {
  let index = 0;
  while (index < text.length && text[index] === other[index]) index += 1;
  const start = Math.max(0, index - TEXT_CONTEXT_CHARS);
  return shown(`${start > 0 ? "…" : ""}${text.slice(start)}`);
};

const sameSentBody = (left: SentBody, right: SentBody): boolean =>
  left.kind === "json" && right.kind === "json"
    ? equalJsonValues(left.value, right.value)
    : left.kind === "text" && right.kind === "text"
      ? left.text === right.text
      : left.kind === right.kind;

const shownSentBody = (body: SentBody): string =>
  shown(
    body.kind === "json"
      ? body.value
      : body.kind === "text"
        ? body.text
        : undefined,
  );

/** How a request was made: a navigation's reply is a page or a download, a script's is data. */
const requestKind = (transaction: TransactionObservation): string =>
  transaction.resource_type === "document"
    ? "document request"
    : "fetch or xhr request";

/**
 * One side's answered requests whose reply a capture recorded, a gap when
 * none was recorded, or undefined when no request was answered: that is
 * already a gap in the status dimension.
 */
const recordedReplies = (
  context: StepContext,
  request: string,
  side: Side,
  transactions: readonly TransactionObservation[],
): RepliedTransaction[] | undefined => {
  const answered = transactions.filter(
    (transaction) => transaction.status !== null,
  );
  if (answered.length === 0) return undefined;
  const recorded = answered.flatMap((transaction) =>
    transaction.reply === null
      ? []
      : [{ ...transaction, reply: transaction.reply }],
  );
  if (recorded.length === 0)
    context.findings.push(finding("body", "not-recorded", { request, side }));
  return recorded;
};

/** Compare one transaction present on both sides. */
const compareTransaction = (
  context: ComparisonContext,
  request: string,
  left: readonly TransactionObservation[],
  right: readonly TransactionObservation[],
): void => {
  compareRecorded(
    context,
    { dimension: "request", category: "value", request },
    { left: left.map(requestKind), right: right.map(requestKind) },
    { equal: exact, show: (value) => shown(value) },
  );
  compareRecorded<SentBody>(
    context,
    { dimension: "request", category: "value", request },
    {
      left: left.map(context.left.sent),
      right: right.map((transaction) => transaction.request_body),
    },
    { equal: sameSentBody, show: shownSentBody },
  );
  compareRecorded(
    context,
    { dimension: "status", category: "status", request },
    {
      left: left.map((transaction) => transaction.status),
      right: right.map((transaction) => transaction.status),
    },
    { equal: exact, show: String },
  );
  // A capture that recorded the reply as a page settles it for its side's repeats.
  const markup = {
    left: left.some((transaction) => transaction.markup),
    right: right.some((transaction) => transaction.markup),
  };
  // Page markup is the application's own source: what it shows is compared as on-screen text.
  if (markup.left && markup.right) return;
  if (markup.left !== markup.right) {
    const data: Side = markup.left ? "right" : "left";
    // Only whether the data was recorded matters here: nothing of it is compared, so nothing is read through `context.left`.
    const replies = recordedReplies(
      context,
      request,
      data,
      data === "left" ? left : right,
    );
    // Recorded data where the other side shows a page is a difference; unrecorded data is the gap reported above.
    if (replies !== undefined && replies.length > 0)
      context.findings.push(
        finding("body", "value", {
          request,
          expected: markup.left ? "an HTML page" : "a reply that is not a page",
          actual: markup.left ? "a reply that is not a page" : "an HTML page",
        }),
      );
    return;
  }
  const leftReplies = recordedReplies(context, request, "left", left);
  const rightReplies = recordedReplies(context, request, "right", right);
  // A left reply is read as it is compared only when the right has one to compare it with.
  if (
    leftReplies !== undefined &&
    rightReplies !== undefined &&
    leftReplies.length > 0 &&
    rightReplies.length > 0
  )
    compareReplies(
      context,
      request,
      leftReplies.map(context.left.reply),
      rightReplies.map(({ reply }) => reply),
    );
};

/** Compare the requests the completed captures of one step made, by request line. */
const compareRequests = (
  context: ComparisonContext,
  left: readonly StepObservation[],
  right: readonly StepObservation[],
): void => {
  const requests = (steps: readonly StepObservation[]) =>
    steps.map(
      (step) =>
        new Map(
          step.transactions.map((transaction) => [
            transaction.request,
            transaction,
          ]),
        ),
    );
  const sides = { left: requests(left), right: requests(right) };
  const keys = new Set(
    [...sides.left, ...sides.right].flatMap((map) => [...map.keys()]),
  );
  // Only a request set the left sends in every capture can be contradicted by a request the right adds.
  const leftSteady = sides.left.every((map) =>
    [...keys].every(
      (request) =>
        map.has(request) || !sides.left.some((other) => other.has(request)),
    ),
  );
  for (const request of keys) {
    const present = (side: Side): TransactionObservation[] =>
      sides[side].flatMap((map) => {
        const transaction = map.get(request);
        return transaction === undefined ? [] : [transaction];
      });
    const found = { left: present("left"), right: present("right") };
    for (const side of ["left", "right"] as const)
      if (found[side].length > 0 && found[side].length < sides[side].length)
        context.findings.push(
          finding("request", "repeats-differ", {
            request,
            ...sideValues(
              side,
              `sent in ${String(found[side].length)} of ${String(sides[side].length)} captures`,
            ),
          }),
        );
    if (found.left.length > 0 && found.right.length > 0)
      compareTransaction(context, request, found.left, found.right);
    // A request only some left captures sent is unstable above, not a difference.
    else if (found.left.length === sides.left.length)
      context.findings.push(
        finding("request", "value", { request, expected: request }),
      );
    else if (found.left.length === 0 && leftSteady)
      context.findings.push(
        finding("request", "value", { request, actual: request }),
      );
    // The left's own request lines vary, so this line contradicts nothing; a line only some right captures sent is listed above.
    else if (
      found.left.length === 0 &&
      found.right.length === sides.right.length
    )
      context.findings.push(
        finding("request", "repeats-differ", {
          request,
          expected: "the left captures do not send the same requests",
          actual: request,
          side: "left",
        }),
      );
  }
};

/** Compare the completed captures of one step on every dimension but the step's own outcome. */
const compareObservations = (
  context: ComparisonContext,
  left: readonly StepObservation[],
  right: readonly StepObservation[],
): void => {
  compareRecorded(
    context,
    { dimension: "page_address", category: "value", request: null },
    {
      left: left.map((step) => step.page_address),
      right: right.map((step) => step.page_address),
    },
    { equal: exact, show: (value) => shown(value) },
  );
  if (!context.textCarried)
    compareRecorded(
      context,
      { dimension: "text", category: "value", request: null },
      {
        left: left.map(context.left.text),
        right: right.map((step) => step.text),
      },
      { equal: exact, show: textAtDifference },
    );
  for (const [side, steps] of [
    ["left", left],
    ["right", right],
  ] as const)
    for (const gap of distinct(
      steps.flatMap((step) => step.gaps),
      (one, other) =>
        one.category === other.category && one.request === other.request,
    ))
      context.findings.push(
        finding("request", gap.category, {
          request: gap.request,
          ...(gap.detail === undefined
            ? { side }
            : sideValues(side, gap.detail)),
        }),
      );
  compareRequests(context, left, right);
};

/** The step's own outcome across a side's captures, then everything its completed captures observed. */
const compareStep = (
  context: ComparisonContext,
  left: readonly StepObservation[],
  right: readonly StepObservation[],
): void => {
  const outcomes = (steps: readonly StepObservation[]) =>
    distinct(
      steps.map((step) => step.outcome),
      exact,
    );
  const leftOutcomes = outcomes(left);
  const rightOutcomes = outcomes(right);
  for (const [side, found] of [
    ["left", leftOutcomes],
    ["right", rightOutcomes],
  ] as const)
    if (found.length > 1)
      context.findings.push(
        finding("step", "repeats-differ", sideValues(side, found.join(" | "))),
      );
  const [leftOutcome] = leftOutcomes;
  const [rightOutcome] = rightOutcomes;
  if (leftOutcomes.length === 1 && leftOutcome !== "completed")
    context.findings.push(
      finding("step", "not-completed", sideValues("left", leftOutcome ?? "")),
    );
  if (rightOutcomes.length === 1 && rightOutcome === "cancelled")
    context.findings.push(
      finding("step", "not-completed", sideValues("right", rightOutcome)),
    );
  if (
    leftOutcomes.length === 1 &&
    leftOutcome === "completed" &&
    rightOutcomes.includes("failed")
  )
    context.findings.push(
      finding("step", "value", { expected: "completed", actual: "failed" }),
    );
  const completed = (steps: readonly StepObservation[]) =>
    steps.filter((step) => step.outcome === "completed");
  if (completed(left).length > 0 && completed(right).length > 0)
    compareObservations(context, completed(left), completed(right));
};

const comparedSide = (
  captures: readonly ScenarioBehaviorCapture[],
): ScenarioBehaviorComparison["left"] => ({
  origin: captures[0]?.start_origin ?? "",
  captures: captures.map((capture) => ({
    file: capture.file,
    evidence_id: capture.evidence_id,
    scenario_sha256: capture.scenario_sha256,
    fingerprint_sha256: capture.fingerprint_sha256,
  })),
  start_state: scenarioStartState(
    captures.map((capture) => capture.fingerprint_sha256),
  ),
  ignored_transactions: captures.reduce(
    (count, capture) => count + capture.observations.ignored_transactions,
    0,
  ),
});

/** The step ids every capture of a side lists, or a refusal naming the first capture that differs. */
const sideStepIds = (
  side: Side,
  captures: readonly ScenarioBehaviorCapture[],
): Result<string[], AnalysisError> => {
  const [first, ...rest] = captures;
  if (first === undefined)
    return err(
      refusal([side], `Name at least one capture for the ${side} side.`),
    );
  const ids = comparedStepIds(first);
  const other = rest.find(
    (capture) => comparedStepIds(capture).join("\n") !== ids.join("\n"),
  );
  return other === undefined
    ? ok(ids)
    : err(
        refusal(
          [side],
          `${other.file} and ${first.file} do not list the same step ids in the same order, so they are not repeats of one scenario. Capture each side from one scenario file.`,
        ),
      );
};

type ComparedStep = ScenarioBehaviorComparison["steps"][number];
type VolatileField = ScenarioBehaviorComparison["volatile_fields"][number];

/** Each capture's steps by id, with the step observed before each. */
const stepsById = (
  captures: readonly ScenarioBehaviorCapture[],
): ReadonlyMap<
  string,
  { readonly step: StepObservation; readonly before?: StepObservation }
>[] =>
  captures.map(
    (capture) =>
      new Map(
        capture.observations.steps.map((step, index, steps) => {
          const before = steps[index - 1];
          return [
            step.step_id,
            before === undefined ? { step } : { step, before },
          ];
        }),
      ),
  );

/**
 * One on-screen text difference between the sides is reported once, at the
 * first step that shows the text. A later step carries it without a finding
 * of its own only when, in every capture of both sides, its text is exactly
 * the text of the step before it. A text that is unstable or was not
 * recorded is never carried: those are judged at every step, so a step that
 * could not be compared is never counted as compared.
 */
class TextCarry {
  readonly #captures: ReturnType<typeof stepsById>;
  readonly #carried: { readonly from: string; steps: number }[] = [];
  #previous: string | undefined;
  #open = false;

  constructor(captures: readonly ScenarioBehaviorCapture[]) {
    this.#captures = stepsById(captures);
  }

  /** Whether this step's text is the previous step's in every capture, and its difference was reported there. */
  carries(stepId: string): boolean {
    const previous = this.#previous;
    return (
      this.#open &&
      previous !== undefined &&
      this.#captures.every((steps) => {
        const found = steps.get(stepId);
        return (
          found?.before?.step_id === previous &&
          found.step.outcome === "completed" &&
          found.before.outcome === "completed" &&
          found.step.text !== null &&
          found.step.text === found.before.text
        );
      })
    );
  }

  /** Record what the comparison of a step made of its text. */
  compared(step: ComparedStep, carried: boolean, complete: boolean): void {
    const text = step.findings.filter(({ dimension }) => dimension === "text");
    if (carried) {
      const last = this.#carried.at(-1);
      if (last !== undefined) last.steps += 1;
    } else {
      // A step whose findings were cut may hold more than the one difference.
      this.#open =
        complete &&
        text.length === 1 &&
        text.every(({ category }) => category === "value");
      if (this.#open) this.#carried.push({ from: step.step_id, steps: 0 });
    }
    this.#previous = step.step_id;
  }

  limitations(): string[] {
    return this.#carried
      .filter(({ steps }) => steps > 0)
      .map(
        ({ from, steps }) =>
          `The on-screen text difference at step ${from} is listed there only: ${String(steps)} later steps show the same text on both sides and carry no finding of their own for it.`,
      );
  }
}

/** The findings and volatile fields of one step, bounded, with what was left out. */
const boundedStep = (
  stepId: string,
  context: Pick<StepContext, "findings">,
  volatile: readonly VolatileField[],
  limitations: string[],
): {
  readonly findings: ComparedStep["findings"];
  readonly volatile: readonly VolatileField[];
  readonly complete: boolean;
} => {
  const findings = boundedList(
    orderScenarioFindings(context.findings),
    STEP_FINDING_LIMIT,
  );
  if (findings.omitted > 0)
    limitations.push(
      `Step ${stepId} has ${String(findings.omitted)} more findings than the ${String(STEP_FINDING_LIMIT)} most severe listed.`,
    );
  const fields = boundedList(volatile, STEP_VOLATILE_FIELD_LIMIT);
  if (fields.omitted > 0)
    limitations.push(
      `Step ${stepId} has ${String(fields.omitted)} more volatile fields than the ${String(STEP_VOLATILE_FIELD_LIMIT)} listed.`,
    );
  return {
    findings: [...findings.items],
    volatile: fields.items,
    complete: findings.omitted === 0,
  };
};

/**
 * Compare already read captures; complete detail, every left-side step.
 * Refused when a side is empty or its captures list different step ids.
 */
export const compareScenarioBehaviorCaptures = (
  request: ScenarioBehaviorComparisonRequest<ScenarioBehaviorCapture>,
): Result<ScenarioBehaviorComparison, AnalysisError> => {
  const leftIds = sideStepIds("left", request.left);
  if (!leftIds.ok) return leftIds;
  const rightIds = sideStepIds("right", request.right);
  if (!rightIds.ok) return rightIds;
  const counts: number[] = [];
  // Both sides hold a capture here. The right's address is its first capture's; a second right origin is a limitation below.
  const addresses = ownAddressReader(request.right[0]?.start_origin ?? "");
  const left = leftValues(addresses, request.renames, counts);
  const stepsOf = (
    captures: readonly ScenarioBehaviorCapture[],
    stepId: string,
  ): StepObservation[] =>
    captures.flatMap((capture) =>
      capture.observations.steps.filter((step) => step.step_id === stepId),
    );
  const volatile: VolatileField[] = [];
  const limitations: string[] = [];
  const steadyListPositions: string[] = [];
  const carry = new TextCarry([...request.left, ...request.right]);
  const steps = leftIds.value.map((stepId): ComparedStep => {
    const kind = scenarioStepKind(stepId);
    const declarations = request.volatile_fields.filter(
      (field: ScenarioBehaviorVolatileField) =>
        field.step_id === stepId || field.step_id === EVERY_STEP,
    );
    const stepVolatile = new Map<string, VolatileField>();
    const shared = rightIds.value.includes(stepId);
    const textCarried = shared && carry.carries(stepId);
    const context: ComparisonContext = {
      findings: [],
      volatile: (field) => {
        const key = `${field.side}\n${field.pointer}\n${String(field.declared)}\n${String(field.honoured)}`;
        if (!stepVolatile.has(key))
          stepVolatile.set(key, { step_id: stepId, ...field });
      },
      declared: (path) =>
        declarations.some((field) =>
          volatilePointerMatches(field.pointer, path),
        ),
      // Declarations do not apply to the fingerprint: it shows the start state as it is.
      declarationsApply: kind !== "fingerprint",
      steadyListPosition: (pattern) => {
        const position = `${pattern} at step ${stepId}`;
        if (!steadyListPositions.includes(position))
          steadyListPositions.push(position);
      },
      left,
      textCarried,
    };
    if (!shared)
      context.findings.push(
        finding("step", "missing-step", { expected: stepId }),
      );
    else
      compareStep(
        context,
        stepsOf(request.left, stepId),
        stepsOf(request.right, stepId),
      );
    const bounded = boundedStep(
      stepId,
      context,
      [...stepVolatile.values()],
      limitations,
    );
    volatile.push(...bounded.volatile);
    const step: ComparedStep = {
      step_id: stepId,
      kind,
      // The status is the worst of all findings, listed or not.
      status: scenarioStepStatus(context.findings),
      findings: bounded.findings,
    };
    carry.compared(step, textCarried, shared && bounded.complete);
    return step;
  });
  limitations.push(...carry.limitations());
  const [steadyListPosition, ...otherListPositions] = steadyListPositions;
  if (steadyListPosition !== undefined)
    limitations.push(
      `Reply lists are compared position by position, also under a declared "*" pointer: ${steadyListPosition}${otherListPositions.length === 0 ? "" : ` (and ${String(otherListPositions.length)} more)`} differs between the sides at a position where the left's captures agree. A list whose order varies between captures has to be requested in a fixed order.`,
    );
  const rightOnly = rightIds.value.filter(
    (stepId) => !leftIds.value.includes(stepId),
  );
  if (rightOnly.length > 0)
    limitations.push(
      `Steps only the right side has are not compared: ${rightOnly.join(", ")}.`,
    );
  for (const [side, captures] of [
    ["left", request.left],
    ["right", request.right],
  ] as const) {
    if (new Set(captures.map((capture) => capture.start_origin)).size > 1)
      limitations.push(
        side === "left"
          ? `The left captures started at more than one origin; the own address of each is read as ${addresses.to}.`
          : `The right captures started at more than one origin; the left's own address is read as ${addresses.to}, the first's, so text that prints another right capture's own address differs from it.`,
      );
    if (captures.length === 1)
      limitations.push(
        `The ${side} side has one capture: a reply body it lost stays unknown${side === "left" ? ", and no value of it is shown to be steady or volatile" : ""}. Add a repeat.`,
      );
  }
  const count = (status: ComparedStep["status"]) =>
    steps.filter((step) => step.status === status).length;
  const addressesApplied = addresses.applied();
  return ok({
    comparison: "scenario-behavior",
    verdict: scenarioBehaviorVerdict(steps.map((step) => step.status)),
    left: comparedSide(request.left),
    right: comparedSide(request.right),
    summary: {
      steps: steps.length,
      unchanged: count("unchanged"),
      changed: count("changed"),
      unknown: count("unknown"),
      unstable: count("unstable"),
    },
    steps,
    volatile_fields: volatile,
    renames_applied: request.renames.flatMap((rename_, index) => {
      const values = counts[index] ?? 0;
      return values === 0
        ? []
        : [{ from: rename_.from, to: rename_.to, values }];
    }),
    ...(addressesApplied.length === 0
      ? {}
      : { addresses_applied: addressesApplied }),
    limitations,
  });
};

type TableBody =
  ScenarioBehaviorTable["steps"][number]["transactions"][number]["reply"];

const tableBody = (body: RecordedBody | SentBody | null): TableBody => {
  if (body === null) return { kind: "not-recorded" };
  if (body.kind === "base64") return { kind: "omitted", reason: "binary" };
  if (body.kind === "none") return body;
  const bytes = Buffer.byteLength(
    body.kind === "json" ? JSON.stringify(body.value) : body.text,
    "utf8",
  );
  return bytes > TABLE_BODY_LIMIT_BYTES
    ? {
        kind: "omitted",
        reason: `${String(bytes)} bytes, over the table's ${String(TABLE_BODY_LIMIT_BYTES)}`,
      }
    : body;
};

/**
 * One side's behaviour table: what the builders read instead of Evidence.
 * Every value is the first one a capture recorded, as the application gave
 * it: where it prints its own address, the table shows that side's, which a
 * comparison reads as the other side's (`addresses_applied`). A page address
 * is relative to the side's origin. A page's markup is the original's own
 * source and is never copied into the table.
 */
export const describeScenarioBehavior = (
  captures: readonly ScenarioBehaviorCapture[],
): ScenarioBehaviorTable => {
  const [first] = captures;
  if (first === undefined)
    throw new TypeError("A behaviour table needs at least one capture");
  const steps = first.observations.steps
    .filter((step) => step.kind !== "reserved")
    .map((step): ScenarioBehaviorTable["steps"][number] => {
      const repeats = captures.flatMap((capture) =>
        capture.observations.steps.filter(
          (other) => other.step_id === step.step_id,
        ),
      );
      const volatile = new Set<string>();
      const transactions = step.transactions.map((transaction) => {
        const same = repeats.flatMap((repeat) =>
          repeat.transactions.filter(
            (other) => other.request === transaction.request,
          ),
        );
        const replies = same.flatMap(({ reply }) =>
          reply === null ? [] : [reply],
        );
        // A repeat that recorded the reply as a page settles it: markup never enters the table.
        const markup = same.some((other) => other.markup);
        if (!markup && replies.length > 1)
          for (const judgement of judgeReplyLeaves(
            repliesAsJson(replies, []).left.map(bodyLeaves),
            [],
            () => false,
          ))
            volatile.add(volatilePointerPattern(judgement.path));
        const sent =
          same.find((other) => other.request_body !== null)?.request_body ??
          null;
        return {
          request: transaction.request,
          request_body: tableBody(sent),
          status:
            same.find(({ status }) => status !== null)?.status ??
            transaction.status,
          reply: markup
            ? ({ kind: "omitted", reason: "document" } as const)
            : tableBody(replies[0] ?? null),
        };
      });
      return {
        step_id: step.step_id,
        kind: step.kind,
        action: step.action,
        outcome: step.outcome,
        page_address:
          repeats.find((repeat) => repeat.page_address !== null)
            ?.page_address ?? null,
        text: repeats.find((repeat) => repeat.text !== null)?.text ?? null,
        transactions,
        volatile_pointers: [...volatile],
      };
    });
  return { table: "scenario-behavior", captures: captures.length, steps };
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

/** The declarations of an intended-differences file that apply to one scenario. */
const readDifferences = async (
  request: ScenarioBehaviorFilesRequest,
): Promise<
  Result<
    Pick<
      ScenarioBehaviorComparisonRequest<ScenarioBehaviorCapture>,
      "renames" | "volatile_fields"
    >,
    AnalysisError
  >
> => {
  if (request.differences === undefined)
    return ok({ renames: [], volatile_fields: [] });
  const read = await readJsonFile(
    request.differences,
    request.signal,
    undefined,
    SCENARIO_BEHAVIOR_OPERATION,
  );
  if (!read.ok) return read;
  const parsed = cloneRunIntendedDifferencesSchema.safeParse(read.value);
  if (!parsed.success)
    return err(
      inputError(
        SCENARIO_BEHAVIOR_OPERATION,
        projectInputIssues(parsed.error.issues, read.value).map((issue) => ({
          ...issue,
          path: ["differences", ...issue.path],
        })),
        `${request.differences} is not an intended-differences file: {"renames": [{"from", "to", "reason"}], "volatile_fields": [{"scenario", "step_id", "pointer", "reason"}]}.`,
      ),
    );
  const scenarios = [
    ...new Set(parsed.data.volatile_fields.map((field) => field.scenario)),
  ];
  if (request.scenario === undefined && scenarios.length > 1)
    return err(
      refusal(
        ["scenario"],
        `${request.differences} declares volatile fields for ${scenarios.join(", ")}. Pass --scenario with the one these captures replay.`,
      ),
    );
  return ok({
    renames: parsed.data.renames.map(({ from, to }) => ({ from, to })),
    volatile_fields: parsed.data.volatile_fields
      .filter(
        (field) =>
          request.scenario === undefined || field.scenario === request.scenario,
      )
      .map(({ step_id, pointer }) => ({ step_id, pointer })),
  });
};

/** Read every file, compare, and project the requested detail. */
export const compareScenarioBehaviorFiles = async (
  request: ScenarioBehaviorFilesRequest,
): Promise<Result<ScenarioBehaviorComparison, AnalysisError>> => {
  const differences = await readDifferences(request);
  if (!differences.ok) return differences;
  const read = async (
    files: readonly string[],
  ): Promise<Result<ScenarioBehaviorCapture[], AnalysisError>> => {
    const captures: ScenarioBehaviorCapture[] = [];
    for (const file of files) {
      const capture = await readScenarioBehaviorCapture(
        file,
        request.signal === undefined ? {} : { signal: request.signal },
      );
      if (!capture.ok) return capture;
      captures.push(capture.value);
    }
    return ok(captures);
  };
  const left = await read(request.left);
  if (!left.ok) return left;
  const right = await read(request.right);
  if (!right.ok) return right;
  const compared = compareScenarioBehaviorCaptures({
    left: left.value,
    right: right.value,
    ...differences.value,
  });
  if (!compared.ok || request.detail === "complete") return compared;
  return ok({
    ...compared.value,
    steps: compared.value.steps.filter((step) => step.status !== "unchanged"),
  });
};
