import { z } from "zod";

import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { readRecordedRequestLine } from "../../domain/analysisView/webNetworkRouteTemplates.js";
import { digestCanonicalValue } from "../../domain/canonicalDigest.js";
import { cloneRunIntendedDifferencesSchema } from "../../domain/cloneRun/cloneRunSchemas.js";
import { boundedList } from "../../domain/boundedList.js";
import { SHA256_PATTERN } from "../../domain/digests.js";
import { ellipsisExcerpt } from "../../domain/excerpt.js";
import { projectInputIssues } from "../../domain/inputIssueProjection.js";
import { equalJsonValues, type JsonValue } from "../../domain/jsonValue.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  COMPARED_RESOURCE_TYPES,
  SCENARIO_BEHAVIOR_OPERATION,
  jsonLeaves,
  judgeReplyLeaves,
  orderScenarioFindings,
  renameScenarioJson,
  renameScenarioText,
  replyBodyExpected,
  scenarioBehaviorVerdict,
  scenarioStartState,
  scenarioStepKind,
  scenarioStepStatus,
  volatilePointerMatches,
  volatilePointerPattern,
  type JsonLeaf,
  type ScenarioBehaviorCaptureFacts,
  type ScenarioBehaviorComparer,
  type ScenarioBehaviorComparison,
  type ScenarioBehaviorComparisonRequest,
  type ScenarioBehaviorDimension,
  type ScenarioBehaviorFinding,
  type ScenarioBehaviorRename,
  type ScenarioBehaviorTable,
  type ScenarioBehaviorVolatileField,
  type ScenarioStepKind,
} from "../../domain/scenarioBehaviorComparison.js";
import { readEvidenceFileSource } from "../analysisView/evidenceFileSource.js";
import { compareAnswers } from "../environment/environmentCompareDiff.js";
import { IdMap } from "../environment/environmentCompareIds.js";
import { probeRequests } from "../environment/environmentCompareProbe.js";
import {
  inputError,
  parseCaptureEvidence,
} from "../environment/environmentSource.js";
import { readJsonFile } from "../JsonFiles.js";

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

/** A reply or request body the capture recorded whole. */
type RecordedBody =
  | { readonly kind: "none" }
  | { readonly kind: "json"; readonly value: JsonValue }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "base64"; readonly encoded: string; readonly whole: true };

/** One compared request of a step with what the application answered. */
interface TransactionObservation {
  /** Request line and occurrence within the step, such as `POST /api/notes#1`. */
  readonly request: string;
  readonly method: string;
  readonly resource_type: string;
  readonly request_body: JsonValue | undefined;
  /** Null when no response was recorded. */
  readonly status: number | null;
  /** Null when no capture recorded the reply body whole; `none` is a recorded empty reply. */
  readonly reply: RecordedBody | null;
}

/** A compared request that cannot be compared: sent elsewhere, or without a usable request line. */
interface TransactionGap {
  readonly category: "other-origin" | "not-recorded";
  readonly request: string;
}

/** What one capture observed at one step, without its address. */
interface StepObservation {
  readonly step_id: string;
  readonly kind: ScenarioStepKind;
  readonly action: string;
  readonly outcome: "completed" | "failed" | "cancelled";
  /** Path, query and fragment at the start origin, a whole URL elsewhere, null when redacted. */
  readonly page_address: string | null;
  /** Accessibility text after the step; null when not selected or not recorded whole. */
  readonly text: string | null;
  readonly transactions: readonly TransactionObservation[];
  readonly gaps: readonly TransactionGap[];
}

/** Per-step observations of one capture; opaque to consumers. */
export interface ScenarioBehaviorObservations {
  readonly steps: readonly StepObservation[];
  /** Transactions of resource types that are not compared. */
  readonly ignored_transactions: number;
}

/**
 * One authenticated capture as the comparer holds it. Consumers read only the
 * `ScenarioBehaviorCaptureFacts` members; the rest belongs to this module.
 */
export interface ScenarioBehaviorCapture extends ScenarioBehaviorCaptureFacts {
  /** Per-step observations this module derived; opaque to consumers. */
  readonly observations: ScenarioBehaviorObservations;
}

const COMPARED: ReadonlySet<string> = new Set(COMPARED_RESOURCE_TYPES);
/** Findings kept per step; the most severe are kept and the rest counted in `limitations`. */
const STEP_FINDING_LIMIT = 20;
const VALUE_CHARS = 120;
/** Characters of equal text shown before the first difference of two on-screen texts. */
const TEXT_CONTEXT_CHARS = 30;
/** Reply bodies larger than this are left out of the behaviour table, not out of the comparison. */
const TABLE_BODY_LIMIT_BYTES = 8 * 1024;

const refusal = (
  path: readonly (string | number)[],
  message: string,
): AnalysisError =>
  inputError(
    SCENARIO_BEHAVIOR_OPERATION,
    [{ path, reason: "invalid_value", message }],
    message,
  );

const parametersSchema = z.object({
  start_url: z.object({ url: z.string() }),
  actions: z.array(z.object({ step_id: z.string().min(1) })),
  scenario_sha256: z.string().regex(SHA256_PATTERN).optional(),
});

const requestLine = (request: {
  readonly method: string;
  readonly path: string;
  readonly query: string | null;
}): string => `${request.method} ${request.path}${request.query ?? ""}`;

/** The step's address without the application's origin; another origin keeps its whole URL. */
const pageAddress = (
  url: {
    readonly url: string;
    readonly origin: string | null;
    readonly redacted: boolean;
  },
  startOrigin: string,
): string | null =>
  url.redacted
    ? null
    : url.origin === startOrigin && url.url.startsWith(startOrigin)
      ? url.url.slice(startOrigin.length)
      : url.url;

/** What the fingerprint steps observed, or null when any observation of theirs is missing. */
const fingerprint = (steps: readonly StepObservation[]): string | null => {
  const opening = steps.filter((step) => step.kind === "fingerprint");
  if (opening.length === 0) return null;
  const observed: JsonValue[] = [];
  for (const step of opening) {
    if (
      step.outcome !== "completed" ||
      step.page_address === null ||
      step.text === null ||
      step.gaps.length > 0
    )
      return null;
    const transactions: JsonValue[] = [];
    for (const transaction of step.transactions) {
      const compared = transaction.resource_type !== "document";
      if (transaction.status === null) return null;
      if (compared && transaction.reply === null) return null;
      transactions.push({
        request: transaction.request,
        request_body:
          transaction.request_body === undefined
            ? null
            : [transaction.request_body],
        status: transaction.status,
        reply: compared ? transaction.reply : null,
      });
    }
    observed.push({
      step_id: step.step_id,
      page_address: step.page_address,
      text: step.text,
      transactions,
    });
  }
  return digestCanonicalValue(
    { fingerprint: "rea.scenario-fingerprint/1", steps: observed },
    "Scenario fingerprint",
  );
};

/**
 * Read and authenticate one capture-browser-scenario Evidence file, a record
 * or a bundle holding exactly one capture record. An edited file, another
 * operation's Evidence or a capture without step ids is refused.
 */
export const readScenarioBehaviorCapture = async (
  file: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Result<ScenarioBehaviorCapture, AnalysisError>> => {
  const evidence = await readEvidenceFileSource(file, options, undefined, {
    operation: SCENARIO_BEHAVIOR_OPERATION,
    path: ["capture"],
  });
  if (!evidence.ok) return evidence;
  const parsed = parseCaptureEvidence(
    SCENARIO_BEHAVIOR_OPERATION,
    evidence.value,
    "manifest",
  );
  if (!parsed.ok) return parsed;
  const { scenario, records } = parsed.value;
  if (scenario === null)
    return err(
      refusal(
        ["capture", "operation"],
        `${file} is a network capture without scenario steps. Compare capture-browser-scenario Evidence, whose steps carry the ids the comparison aligns by.`,
      ),
    );
  const parameters = parametersSchema.safeParse(scenario.parameters);
  if (!parameters.success)
    return err(
      refusal(
        ["capture", "parameters"],
        `${file} does not record the scenario it ran (start_url and actions with step ids), so its steps cannot be aligned.`,
      ),
    );
  const startOrigin = scenario.startOrigin;
  const { steps: probed, unobserved } = probeRequests(records, {
    origin: startOrigin,
    stepIds: scenario.recordSteps,
  });
  const byOrdinal = new Map(records.map((record) => [record.ordinal, record]));
  const transactions = new Map<string, TransactionObservation[]>();
  const gaps = new Map<string, TransactionGap[]>();
  const occurrences = new Map<string, number>();
  const occurrence = (stepId: string, line: string): string => {
    const key = `${stepId}\n${line}`;
    const count = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, count);
    return `${line}#${String(count)}`;
  };
  const replyBodies: ScenarioBehaviorCaptureFacts["reply_bodies"][number][] =
    [];
  let ignored = 0;
  for (const probe of probed) {
    const body = byOrdinal
      .get(probe.ordinal)
      ?.binary_fields.find(
        (field) =>
          field.pointer === "/response/content/text" &&
          field.state === "retained",
      );
    const line = requestLine(probe.request);
    if (body?.state === "retained")
      replyBodies.push({
        request: line,
        sha256: body.sha256,
        bytes: body.bytes,
      });
    const step = scenario.recordSteps.get(probe.ordinal);
    if (step === undefined || !COMPARED.has(step.resource_type)) {
      ignored += 1;
      continue;
    }
    const live = probe.live;
    const status = live?.status ?? null;
    const reply: RecordedBody | null =
      live === undefined || status === null
        ? null
        : !replyBodyExpected(probe.request.method, status)
          ? { kind: "none" }
          : live.unobserved === true || live.body.kind === "cut"
            ? null
            : live.body.kind === "base64"
              ? live.body.whole
                ? { kind: "base64", encoded: live.body.encoded, whole: true }
                : null
              : live.body;
    const list = transactions.get(step.step_id) ?? [];
    list.push({
      request: occurrence(step.step_id, line),
      method: probe.request.method,
      resource_type: step.resource_type,
      request_body: probe.request.body,
      status,
      reply,
    });
    transactions.set(step.step_id, list);
  }
  for (const { ordinal, reason } of unobserved) {
    // A request without an answer is among the probed requests above.
    if (reason === "no-response") continue;
    const step = scenario.recordSteps.get(ordinal);
    if (step === undefined || !COMPARED.has(step.resource_type)) {
      ignored += 1;
      continue;
    }
    const line = readRecordedRequestLine(
      byOrdinal.get(ordinal)?.reported,
      true,
      () => true,
    );
    const list = gaps.get(step.step_id) ?? [];
    list.push(
      reason === "other-origin" && line?.kind === "line"
        ? {
            category: "other-origin",
            request: occurrence(
              step.step_id,
              `${line.method} ${line.origin}${line.path}${line.query ?? ""}`,
            ),
          }
        : {
            category: "not-recorded",
            request: occurrence(step.step_id, `${step.resource_type} request`),
          },
    );
    gaps.set(step.step_id, list);
  }
  const steps = scenario.steps.map((step): StepObservation => {
    const accessibility = step.artifacts.accessibility;
    return {
      step_id: step.step_id,
      kind: scenarioStepKind(step.step_id),
      action: step.action,
      outcome: step.status,
      page_address: pageAddress(step.after_url, startOrigin),
      text:
        accessibility.state === "captured" ? accessibility.value.text : null,
      transactions: transactions.get(step.step_id) ?? [],
      gaps: gaps.get(step.step_id) ?? [],
    };
  });
  return ok({
    file,
    evidence_id: parsed.value.evidenceId,
    start_origin: startOrigin,
    scenario_sha256: parameters.data.scenario_sha256 ?? null,
    definition: {
      start_url: parameters.data.start_url.url,
      step_ids: parameters.data.actions.map((action) => action.step_id),
    },
    steps: steps.map(({ step_id, outcome }) => ({ step_id, outcome })),
    fingerprint_sha256: fingerprint(steps),
    reply_bodies: replyBodies,
    observations: { steps, ignored_transactions: ignored },
  });
};

const shown = (value: JsonValue | undefined): string =>
  value === undefined
    ? "<absent>"
    : ellipsisExcerpt(JSON.stringify(value), VALUE_CHARS);

/** A whole body as leaves; a body that is not JSON is one leaf no JSON leaf can equal. */
const bodyLeaves = (body: RecordedBody): readonly JsonLeaf[] => {
  if (body.kind === "json") return jsonLeaves(body.value);
  const value: JsonValue =
    body.kind === "text"
      ? { "text body": body.text }
      : body.kind === "base64"
        ? { "binary body": body.encoded }
        : { "no body": true };
  return [{ pointer: "", path: [], value }];
};

const renameBody = (
  body: RecordedBody,
  renames: readonly ScenarioBehaviorRename[],
  counts: number[],
): RecordedBody =>
  body.kind === "json"
    ? { kind: "json", value: renameScenarioJson(body.value, renames, counts) }
    : body.kind === "text"
      ? { kind: "text", text: renameScenarioText(body.text, renames, counts) }
      : body;

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

type Side = "left" | "right";

/** What the comparison of one step collects. */
interface StepContext {
  readonly findings: ScenarioBehaviorFinding[];
  readonly volatile: ScenarioBehaviorComparison["volatile_fields"];
  readonly stepId: string;
  /** Whether a volatile declaration names this reply leaf of this step. */
  readonly declared: (leaf: JsonLeaf) => boolean;
  /** Whether the left side has repeats, so a value can be shown to be steady. */
  readonly leftRepeated: boolean;
}

const finding = (
  dimension: ScenarioBehaviorDimension,
  category: string,
  rest: Partial<Omit<ScenarioBehaviorFinding, "dimension" | "category">> = {},
): ScenarioBehaviorFinding => ({
  dimension,
  category,
  request: null,
  pointer: null,
  expected: null,
  actual: null,
  side: null,
  ...rest,
});

/** Both values of a side that disagrees with itself, in that side's member. */
const sideValues = (
  side: Side,
  text: string,
): Pick<ScenarioBehaviorFinding, "expected" | "actual" | "side"> =>
  side === "left"
    ? { expected: text, actual: null, side }
    : { expected: null, actual: text, side };

/**
 * Compare one recorded value per capture across both sides. A value no
 * capture of a side recorded is a gap; a value the left's repeats disagree on
 * is unstable and is not compared; otherwise any right repeat that differs
 * from the left's steady value is a difference.
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
  }
  const [expected, unsteady] = distinct(sides.left, compare.equal);
  if (expected === undefined || unsteady !== undefined) return;
  const actual = sides.right.find((value) => !compare.equal(expected, value));
  if (actual !== undefined)
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

/** Whether a differ difference at `outer` is about the leaf at `pointer`. */
const covers = (outer: string, pointer: string): boolean =>
  outer === "" || pointer === outer || pointer.startsWith(`${outer}/`);

/** Compare the reply bodies of one matched transaction: exactly by leaf, with the differ naming what it sees. */
const compareReplies = (
  context: StepContext,
  request: string,
  left: readonly RecordedBody[],
  right: readonly RecordedBody[],
): void => {
  const judgements = judgeReplyLeaves(
    left.map(bodyLeaves),
    right.map(bodyLeaves),
    context.declared,
  );
  const patterns = new Set<string>();
  for (const judgement of judgements) {
    const pattern = volatilePointerPattern(judgement.path);
    const honoured =
      judgement.outcome === "honoured" || judgement.outcome === "shape";
    for (const side of judgement.varies)
      if (
        !context.volatile.some(
          (field) =>
            field.step_id === context.stepId &&
            field.side === side &&
            field.pointer === pattern &&
            field.declared === honoured,
        )
      )
        context.volatile.push({
          step_id: context.stepId,
          side,
          pointer: pattern,
          declared: honoured,
        });
    if (judgement.outcome === "shape")
      context.findings.push(
        finding("body", "shape", {
          request,
          pointer: judgement.pointer,
          expected: shown(judgement.expected),
          actual: shown(judgement.actual),
        }),
      );
    // One finding per declarable pattern, so a list of varying items is one line of work.
    const repeats = (side: Side, values: string): void => {
      if (patterns.has(`${side}${pattern}`)) return;
      patterns.add(`${side}${pattern}`);
      context.findings.push(
        finding("body", "undeclared-volatile", {
          request,
          pointer: pattern,
          ...sideValues(side, values),
        }),
      );
    };
    if (judgement.outcome === "unstable")
      repeats(
        "left",
        `${shown(judgement.expected)} | ${shown(judgement.other)}`,
      );
    if (judgement.outcome === "changed" && judgement.varies.includes("right"))
      repeats("right", shown(judgement.actual));
  }
  const changed = judgements.filter(({ outcome }) => outcome === "changed");
  const named = new Set<string>();
  const reported = new Set<string>();
  const leftBody = left[0];
  if (leftBody !== undefined && changed.length > 0)
    for (const rightBody of right) {
      // Statuses are compared in their own dimension.
      const { differences } = compareAnswers(
        { status: 0, body: leftBody },
        { status: 0, body: rightBody },
        new IdMap(),
      );
      for (const difference of differences) {
        const about = changed.filter((judgement) =>
          covers(difference.pointer, judgement.pointer),
        );
        // What the left's repeats disagree on is unstable or honoured, never a difference.
        if (about.length === 0) continue;
        for (const judgement of about) named.add(judgement.pointer);
        const key = `${difference.category}\n${difference.pointer}`;
        if (reported.has(key)) continue;
        reported.add(key);
        context.findings.push(
          finding("body", difference.category, {
            request,
            pointer: difference.pointer,
            expected: difference.live ?? null,
            actual: difference.env ?? null,
          }),
        );
      }
    }
  for (const judgement of changed) {
    if (named.has(judgement.pointer)) continue;
    const values = {
      request,
      pointer: judgement.pointer,
      expected: shown(judgement.expected),
      actual: shown(judgement.actual),
    };
    // The differ treats this pair as equal (two clocks of one format, an absent body and null).
    // Repeats of the left show the value is steady, so it is contradicted; one capture cannot.
    context.findings.push(
      context.leftRepeated
        ? finding("body", "value", values)
        : finding("body", "not-recorded", { ...values, side: "left" }),
    );
  }
};

/** Compare one transaction present on both sides. */
const compareTransaction = (
  context: StepContext,
  request: string,
  left: readonly TransactionObservation[],
  right: readonly TransactionObservation[],
): void => {
  const body = (value: JsonValue | undefined): JsonValue[] =>
    value === undefined ? [] : [value];
  compareRecorded<JsonValue[]>(
    context,
    { dimension: "request", category: "value", request },
    {
      left: left.map((transaction) => body(transaction.request_body)),
      right: right.map((transaction) => body(transaction.request_body)),
    },
    {
      equal: equalJsonValues,
      show: ([value]) => shown(value),
    },
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
  if (left[0]?.resource_type === "document") return;
  const replies = (side: Side): RecordedBody[] | undefined => {
    const answered = (side === "left" ? left : right).filter(
      (transaction) => transaction.status !== null,
    );
    // An unanswered request is already a gap in the status dimension.
    if (answered.length === 0) return undefined;
    const recorded = answered.flatMap(({ reply }) =>
      reply === null ? [] : [reply],
    );
    if (recorded.length === 0)
      context.findings.push(finding("body", "not-recorded", { request, side }));
    return recorded;
  };
  const leftReplies = replies("left");
  const rightReplies = replies("right");
  if (
    leftReplies !== undefined &&
    rightReplies !== undefined &&
    leftReplies.length > 0 &&
    rightReplies.length > 0
  )
    compareReplies(context, request, leftReplies, rightReplies);
};

/** Compare the completed captures of one step on every dimension but the step's own outcome. */
const compareObservations = (
  context: StepContext,
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
  compareRecorded(
    context,
    { dimension: "text", category: "value", request: null },
    {
      left: left.map((step) => step.text),
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
        finding("request", gap.category, { request: gap.request, side }),
      );
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
    // A request the left's own repeats disagree on is unstable above, not a difference.
    else if (found.left.length === sides.left.length)
      context.findings.push(
        finding("request", "value", { request, expected: request }),
      );
    else if (found.left.length === 0)
      context.findings.push(
        finding("request", "value", { request, actual: request }),
      );
  }
};

/** The step's own outcome across a side's captures, then everything its completed captures observed. */
const compareStep = (
  context: StepContext,
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

/** Apply the renames to everything of a left step that renames cover. */
const renameStep = (
  step: StepObservation,
  renames: readonly ScenarioBehaviorRename[],
  counts: number[],
): StepObservation =>
  renames.length === 0
    ? step
    : {
        ...step,
        text:
          step.text === null
            ? null
            : renameScenarioText(step.text, renames, counts),
        transactions: step.transactions.map((transaction) => ({
          ...transaction,
          request_body:
            transaction.request_body === undefined
              ? undefined
              : renameScenarioJson(transaction.request_body, renames, counts),
          reply:
            transaction.reply === null
              ? null
              : renameBody(transaction.reply, renames, counts),
        })),
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
  const stepsOf = (
    captures: readonly ScenarioBehaviorCapture[],
    stepId: string,
  ): StepObservation[] =>
    captures.flatMap((capture) =>
      capture.observations.steps.filter((step) => step.step_id === stepId),
    );
  const volatile: ScenarioBehaviorComparison["volatile_fields"] = [];
  const limitations: string[] = [];
  const steps = leftIds.value.map(
    (stepId): ScenarioBehaviorComparison["steps"][number] => {
      const kind = scenarioStepKind(stepId);
      const declarations = request.volatile_fields.filter(
        (field: ScenarioBehaviorVolatileField) => field.step_id === stepId,
      );
      const context: StepContext = {
        findings: [],
        volatile,
        stepId,
        // Declarations do not apply to the fingerprint: it shows the start state as it is.
        declared: (leaf) =>
          kind !== "fingerprint" &&
          declarations.some((field) =>
            volatilePointerMatches(field.pointer, leaf.path),
          ),
        leftRepeated: request.left.length > 1,
      };
      if (!rightIds.value.includes(stepId))
        context.findings.push(
          finding("step", "missing-step", { expected: stepId }),
        );
      else
        compareStep(
          context,
          stepsOf(request.left, stepId).map((step) =>
            renameStep(step, request.renames, counts),
          ),
          stepsOf(request.right, stepId),
        );
      const findings = boundedList(
        orderScenarioFindings(context.findings),
        STEP_FINDING_LIMIT,
      );
      if (findings.omitted > 0)
        limitations.push(
          `Step ${stepId} has ${String(findings.omitted)} more findings than the ${String(STEP_FINDING_LIMIT)} most severe listed.`,
        );
      return {
        step_id: stepId,
        kind,
        // The status is the worst of all findings, listed or not.
        status: scenarioStepStatus(context.findings),
        findings: [...findings.items],
      };
    },
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
        `The ${side} captures started at more than one origin; each is compared without its own.`,
      );
    if (captures.length === 1)
      limitations.push(
        `The ${side} side has one capture: a reply body it lost stays unknown${side === "left" ? ", and no value of it is shown to be steady or volatile" : ""}. Add a repeat.`,
      );
  }
  const count = (
    status: ScenarioBehaviorComparison["steps"][number]["status"],
  ) => steps.filter((step) => step.status === status).length;
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
    renames_applied: request.renames.flatMap((rename, index) => {
      const values = counts[index] ?? 0;
      return values === 0 ? [] : [{ from: rename.from, to: rename.to, values }];
    }),
    limitations,
  });
};

type TableBody =
  ScenarioBehaviorTable["steps"][number]["transactions"][number]["reply"];

const tableBody = (body: RecordedBody | null): TableBody => {
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
 * Every value is the first one a capture recorded; a document's reply is the
 * original's own markup and is never copied into the table.
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
        const document = transaction.resource_type === "document";
        if (!document && replies.length > 1)
          for (const judgement of judgeReplyLeaves(
            replies.map(bodyLeaves),
            [],
            () => false,
          ))
            volatile.add(volatilePointerPattern(judgement.path));
        return {
          request: transaction.request,
          request_body: tableBody(
            transaction.request_body === undefined
              ? { kind: "none" }
              : typeof transaction.request_body === "string"
                ? { kind: "text", text: transaction.request_body }
                : { kind: "json", value: transaction.request_body },
          ),
          status:
            same.find(({ status }) => status !== null)?.status ??
            transaction.status,
          reply: document
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
