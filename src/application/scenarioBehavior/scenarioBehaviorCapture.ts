import { z } from "zod";

import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import { mediaTypeEssence } from "../../domain/analysisView/recordedMediaType.js";
import { digestCanonicalValue } from "../../domain/canonicalDigest.js";
import { SHA256_PATTERN } from "../../domain/digests.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import { err, ok, type Result } from "../../domain/result.js";
import type { WebNetworkCaptureRecord } from "../../domain/webNetworkCapture.js";
import {
  COMPARED_RESOURCE_TYPES,
  SCENARIO_BEHAVIOR_OPERATION,
  replyBodyExpected,
  scenarioStepKind,
  type ScenarioBehaviorCaptureFacts,
  type ScenarioStepKind,
} from "../../domain/scenarioBehaviorComparison.js";
import { readEvidenceFileSource } from "../analysisView/evidenceFileSource.js";
import {
  probeRequests,
  recordedRequestBody,
  type RecordedRequestBodyValue,
} from "../environment/environmentCompareProbe.js";
import {
  inputError,
  parseCaptureEvidence,
} from "../environment/environmentSource.js";

/**
 * One browser scenario capture as the behaviour comparer reads it.
 * Contract: docs/specs/reconstruction/clone-runs/spec.md, "The comparer".
 *
 * Reuses the capture owners instead of reading Evidence JSON itself:
 * `readEvidenceFileSource` authenticates the file, `parseCaptureEvidence`
 * (purpose "manifest", which keeps request bodies) validates the capture and
 * states its steps, record steps and omissions, `probeRequests` yields each
 * request with its answer and parsed request line, and `recordedRequestBody`
 * tells a request that sent nothing from one whose body was not recorded.
 *
 * Two behaviours of those owners must not leak into a verdict (each was
 * observed on real captures; see the specification's verified facts):
 * `probeRequests` picks the origin with the most JSON-like records, so this
 * module passes the capture's start origin instead; and a redirect reply is
 * marked unobserved although it has no body (`replyBodyExpected`).
 */

/** A reply body the capture recorded whole. */
export type RecordedBody =
  | { readonly kind: "none" }
  | { readonly kind: "json"; readonly value: JsonValue }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "base64"; readonly encoded: string; readonly whole: true };

/** A request body the capture recorded, or the recorded fact that none was sent. */
export type SentBody = Exclude<
  RecordedRequestBodyValue,
  { readonly kind: "not-recorded" }
>;

/** One compared request of a step with what the application answered. */
export interface TransactionObservation {
  /** Request line and occurrence within the step, such as `POST /api/notes#1`. */
  readonly request: string;
  readonly method: string;
  readonly resource_type: string;
  /** Null when a body was sent, or may have been, and the capture did not record it. */
  readonly request_body: SentBody | null;
  /** Null when no response was recorded. */
  readonly status: number | null;
  /** Null when the capture did not record the reply body whole; `none` is a recorded empty reply. */
  readonly reply: RecordedBody | null;
  /**
   * Whether the reply is the markup of a page the browser displayed: a
   * `document` reply of an HTML media type, or one whose media type the
   * capture lost and whose address is the step's page address. Markup is the
   * application's own source and is not compared; what it shows is compared
   * as on-screen text. Every other reply, a downloaded file included, is data.
   */
  readonly markup: boolean;
}

/** A compared request that cannot be compared: sent elsewhere, without a usable request line, or omitted by the capture. */
interface TransactionGap {
  readonly category: "other-origin" | "not-recorded";
  readonly request: string;
  /** What the capture states about the gap, when it states more than the request. */
  readonly detail?: string;
}

/** What one capture observed at one step, without its address. */
export interface StepObservation {
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
interface ScenarioBehaviorObservations {
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
/** What stands for a capture's own start origin wherever the application prints it. */
const OWN_ORIGIN_PLACEHOLDER = "{origin}";
const HTML_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "text/html",
  "application/xhtml+xml",
]);

/** A refusal of the comparer that names one input. */
export const scenarioBehaviorRefusal = (
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

/**
 * Replace the capture's own origin in a text by the placeholder, as a page
 * address loses it, so an application that prints its own address compares
 * equal at two addresses. The origin is replaced only where it ends: a longer
 * host or another port is another origin.
 */
const withoutOwnOrigin = (startOrigin: string): ((text: string) => string) => {
  const pattern = new RegExp(
    `${startOrigin.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![\\w-]|:\\d|\\.[\\w-])`,
    "gu",
  );
  return (text) =>
    text.includes(startOrigin)
      ? text.replaceAll(pattern, OWN_ORIGIN_PLACEHOLDER)
      : text;
};

/** Apply `map` to every string value of a JSON value, never to a field name. */
const mapJsonStrings = (
  value: JsonValue,
  map: (text: string) => string,
): JsonValue => {
  if (typeof value === "string") return map(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((item) => mapJsonStrings(item, map));
  return Object.fromEntries(
    Object.entries(value).map(([key, member]) => [
      key,
      mapJsonStrings(member, map),
    ]),
  );
};

const mapBodyStrings = <
  Body extends
    | { readonly kind: "json"; readonly value: JsonValue }
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "none" | "base64" },
>(
  body: Body,
  map: (text: string) => string,
): Body =>
  body.kind === "json"
    ? { ...body, value: mapJsonStrings(body.value, map) }
    : body.kind === "text"
      ? { ...body, text: map(body.text) }
      : body;

/** Methods a browser sends without a body, whatever headers the capture lists for the request (Fetch standard). */
const BODILESS_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/** The body a request sent, or null when one was sent, or may have been, and the capture did not record it. */
const sentBody = (
  record: WebNetworkCaptureRecord | undefined,
  method: string,
): SentBody | null => {
  const sent =
    record === undefined
      ? ({ kind: "not-recorded" } as const)
      : recordedRequestBody(record);
  if (sent.kind !== "not-recorded") return sent;
  // A redirected GET lists the Content-Type of the POST before it, so the record cannot state that it sent nothing.
  return BODILESS_METHODS.has(method.toUpperCase()) ? { kind: "none" } : null;
};

/** What the fingerprint steps observed, or null when any observation of theirs is missing. */
const fingerprint = (steps: readonly StepObservation[]): string | null => {
  const opening = steps.filter((step) => step.kind === "fingerprint");
  if (opening.length === 0) return null;
  const observed: JsonValue[] = [];
  for (const step of opening) {
    // A request step observes its reply; the page behind it is not what it probes.
    const text = step.action === "request" ? "" : step.text;
    if (
      step.outcome !== "completed" ||
      step.page_address === null ||
      text === null ||
      step.gaps.length > 0
    )
      return null;
    const transactions: JsonValue[] = [];
    for (const transaction of step.transactions) {
      if (transaction.status === null || transaction.request_body === null)
        return null;
      if (!transaction.markup && transaction.reply === null) return null;
      transactions.push({
        request: transaction.request,
        request_body: transaction.request_body,
        status: transaction.status,
        reply: transaction.markup ? null : transaction.reply,
      });
    }
    observed.push({
      step_id: step.step_id,
      page_address: step.page_address,
      text,
      transactions,
    });
  }
  return digestCanonicalValue(
    { fingerprint: "rea.scenario-fingerprint/2", steps: observed },
    "Scenario fingerprint",
  );
};

/** Whether a refusal is the evidence reader's "this bundle does not hold exactly one record". */
const isRecordSelectionRefusal = (error: AnalysisError): boolean =>
  error instanceof AnalysisInputError &&
  error.issues.some(
    (issue) =>
      issue.path.length === 2 &&
      issue.path[0] === "capture" &&
      issue.path[1] === "evidence_id",
  );

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
  if (!evidence.ok)
    // This command has no record selector, so the reader's "select one with" remedy does not apply.
    return isRecordSelectionRefusal(evidence.error)
      ? err(
          scenarioBehaviorRefusal(
            ["capture"],
            `${file} is an Evidence bundle that does not hold exactly one record. Pass a file holding one capture: capture-browser-scenario --evidence_output writes one per capture.`,
          ),
        )
      : evidence;
  const parsed = parseCaptureEvidence(
    SCENARIO_BEHAVIOR_OPERATION,
    evidence.value,
    "manifest",
  );
  if (!parsed.ok) return parsed;
  const { scenario, records } = parsed.value;
  if (scenario === null)
    return err(
      scenarioBehaviorRefusal(
        ["capture", "operation"],
        `${file} is a network capture without scenario steps. Compare capture-browser-scenario Evidence, whose steps carry the ids the comparison aligns by.`,
      ),
    );
  const parameters = parametersSchema.safeParse(scenario.parameters);
  if (!parameters.success)
    return err(
      scenarioBehaviorRefusal(
        ["capture", "parameters"],
        `${file} does not record the scenario it ran (start_url and actions with step ids), so its steps cannot be aligned.`,
      ),
    );
  const startOrigin = scenario.startOrigin;
  const ownOrigin = withoutOwnOrigin(startOrigin);
  const pages = new Map(
    scenario.steps.map((step) => [
      step.step_id,
      pageAddress(step.after_url, startOrigin),
    ]),
  );
  const {
    steps: probed,
    unobserved,
    lines,
  } = probeRequests(records, { origin: startOrigin });
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
    const record = byOrdinal.get(probe.ordinal);
    const body = record?.binary_fields.find(
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
    const sent = sentBody(record, probe.request.method);
    const parsedLine = lines.get(probe.ordinal);
    const mediaType =
      parsedLine?.kind === "line" ? mediaTypeEssence(parsedLine.rawMime) : null;
    const page = pages.get(step.step_id);
    const list = transactions.get(step.step_id) ?? [];
    list.push({
      request: occurrence(step.step_id, line),
      method: probe.request.method,
      resource_type: step.resource_type,
      request_body: sent === null ? null : mapBodyStrings(sent, ownOrigin),
      status,
      reply: reply === null ? null : mapBodyStrings(reply, ownOrigin),
      markup:
        step.resource_type === "document" &&
        (mediaType === null
          ? // The capture lost the media type with the body: the page the step ended on is markup.
            reply === null &&
            page !== null &&
            page !== undefined &&
            page.split("#")[0] ===
              `${probe.request.path}${probe.request.query ?? ""}`
          : HTML_MEDIA_TYPES.has(mediaType)),
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
    const line = lines.get(ordinal);
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
  // An omitted request event names no step, so no step's requests are known to be all it made.
  const omitted = scenario.omissions.by_kind.filter(
    ({ kind }) => kind === "request",
  );
  const omission: readonly TransactionGap[] =
    omitted.length === 0
      ? []
      : [
          {
            category: "not-recorded",
            request: "requests the capture omitted",
            detail: `${String(omitted.reduce((sum, { count }) => sum + count, 0))} request events omitted by the capture (${[...new Set(omitted.flatMap(({ reasons }) => reasons))].join(", ")})`,
          },
        ];
  const steps = scenario.steps.map((step): StepObservation => {
    const accessibility = step.artifacts.accessibility;
    return {
      step_id: step.step_id,
      kind: scenarioStepKind(step.step_id),
      action: step.action,
      outcome: step.status,
      page_address: pages.get(step.step_id) ?? null,
      text:
        accessibility.state === "captured"
          ? ownOrigin(accessibility.value.text)
          : null,
      transactions: transactions.get(step.step_id) ?? [],
      gaps: [...(gaps.get(step.step_id) ?? []), ...omission],
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
