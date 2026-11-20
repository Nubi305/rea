import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { sanitizeBrowserUrl } from "../../domain/browserObservation.js";
import { browserScenarioSchema } from "../../domain/browserScenario.js";
import { browserScenarioCaptureSchema } from "../../domain/browserScenarioCapture.js";
import { DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS } from "../../domain/browserScenarioCaptureLimits.js";
import type { Evidence } from "../../domain/evidence.js";
import { createEvidenceBundle } from "../../domain/evidenceBundle.js";
import { jsonValueSchema, type JsonValue } from "../../domain/jsonValue.js";
import {
  scenarioBehaviorComparisonSchema,
  type ScenarioBehaviorComparison,
  type ScenarioBehaviorRename,
  type ScenarioBehaviorVolatileField,
} from "../../domain/scenarioBehaviorComparison.js";
import { createBrowserScenarioEvidence } from "../BrowserScenarioEvidence.js";
import {
  compareScenarioBehaviorCaptures,
  readScenarioBehaviorCapture,
  type ScenarioBehaviorCapture,
} from "./ScenarioBehaviorComparisonService.js";

/**
 * Browser scenario captures for the behaviour comparer's tests, built as a
 * real capture records them and read back through the comparer's own reader.
 */

export const LEFT = "http://127.0.0.1:4101";
export const RIGHT = "http://127.0.0.1:4202";
export const ELSEWHERE = "http://127.0.0.1:4303";

/** What a recorded reply holds: JSON, text of a media type, a page's markup, a body the capture lost, or one over its limit. */
export type Reply =
  | { readonly json: JsonValue }
  | { readonly text: string; readonly media?: string }
  | { readonly html: string }
  | { readonly lost: "body-read-failed" | "body-size-limit" };

/**
 * One request a step made; `at` sends it to another origin, `status` null
 * leaves it unanswered. `send` is the body it sent; `sendLost` a body it sent
 * that the capture did not record.
 */
export interface Call {
  readonly line: string;
  readonly type?: string;
  readonly at?: string;
  readonly status?: number | null;
  readonly reply?: Reply;
  readonly send?: JsonValue;
  readonly sendLost?: true;
}

/** What a capture states about its own events beyond those it kept. */
export interface CaptureOptions {
  /** Request events the capture omitted at its transaction limit. */
  readonly omittedRequests?: number;
}

/** One scenario step as a capture records it. */
export interface Step {
  readonly id: string;
  readonly outcome?: "failed" | "cancelled";
  /** The page address after the step: a path at the capture's origin, or a whole URL. */
  readonly page?: string;
  /** Accessibility text; null when the capture did not record it. */
  readonly text?: string | null;
  /** The step's action; a `request` step unless stated. */
  readonly action?: string;
  readonly calls?: readonly Call[];
}

const recorded = (content: string, mediaType: string, request: boolean) => {
  const bytes = Buffer.from(content, "utf8");
  return {
    state: "captured",
    representation: request
      ? "browser-exposed-request-bytes"
      : "playwright-response-body-bytes",
    encoding: "base64",
    content: bytes.toString("base64"),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    media_type: mediaType,
    redacted: false,
  };
};

const overLimit = {
  state: "unavailable",
  reason: "body-size-limit",
  message: "over the limit",
  limit_bytes: 65_536,
  observed_bytes: 102_410,
};

const replyBody = (reply: Reply | undefined) => {
  if (reply === undefined) return { state: "not_requested" };
  if ("json" in reply)
    return recorded(JSON.stringify(reply.json), "application/json", false);
  if ("html" in reply)
    return recorded(reply.html, "text/html; charset=utf-8", false);
  if ("text" in reply)
    return recorded(reply.text, reply.media ?? "text/plain", false);
  return reply.lost === "body-size-limit"
    ? overLimit
    : { state: "unavailable", reason: reply.lost, message: "lost" };
};

/** A request's body as a real capture records it: its bytes, the fact that the browser exposed none, or its loss. */
const requestBody = (call: Call) =>
  call.send !== undefined
    ? recorded(JSON.stringify(call.send), "application/json", true)
    : call.sendLost === true
      ? overLimit
      : { state: "not_exposed" };

/** The events of every call of `steps`, in order. */
const captureEvents = (origin: string, steps: readonly Step[]): unknown[] => {
  const items: unknown[] = [];
  let transactions = 0;
  for (const [stepIndex, step] of steps.entries())
    for (const call of step.calls ?? []) {
      const [method = "GET", path = "/"] = call.line.split(" ");
      transactions += 1;
      const event = (kind: string, status: number | null) => ({
        sequence: items.length + 1,
        step_index: stepIndex,
        transaction_id: `request-${String(transactions)}`,
        redirected_from_transaction_id: null,
        redirected_from_transaction_state: "root",
        method,
        url: sanitizeBrowserUrl(`${call.at ?? origin}${path}`),
        resource_type: call.type ?? "fetch",
        // A browser names the Content-Type of a body it sends.
        header_names:
          call.send !== undefined || call.sendLost === true
            ? ["content-type"]
            : [],
        kind,
        status,
        failure: null,
      });
      const content = (phase: string, body: unknown) => ({
        sequence: items.length + 1,
        step_index: stepIndex,
        kind: "network-content",
        transaction_id: `request-${String(transactions)}`,
        source_event_sequence: items.length,
        phase,
        headers: { state: "not_requested" },
        body,
      });
      items.push(event("request", null));
      items.push(content("request", requestBody(call)));
      if (call.status === null) continue;
      items.push(event("response", call.status ?? 200));
      items.push(content("response", replyBody(call.reply)));
    }
  return items;
};

/** A capture of `steps` at `origin`, after REA's own first step, as authenticated Evidence. */
export const captureEvidence = (
  origin: string,
  steps: readonly Step[],
  options: CaptureOptions = {},
): Evidence => {
  const all: readonly Step[] = [
    {
      id: "scenario_start",
      calls: [{ line: "GET /", type: "document", reply: { html: "<p>app" } }],
    },
    ...steps,
  ];
  const items = captureEvents(origin, all);
  const omitted = options.omittedRequests ?? 0;
  const capture = browserScenarioCaptureSchema.parse({
    browser: {
      mode: "launch",
      process_ownership: "provider-owned",
      cleanup: "terminated-owned-process",
      product: "Chromium",
      version: "fixture",
    },
    scenario: {
      start_origin: origin,
      action_count: steps.length,
      secret_references: [],
      network_content: {
        request_body: true,
        response_body: true,
        header_values: false,
      },
      event_families: ["network"],
      limits: DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS,
    },
    duration_ms: 1,
    steps: all.map((step, index) => {
      const text = step.text === undefined ? `screen ${step.id}` : step.text;
      const page = step.page ?? "/";
      const url = sanitizeBrowserUrl(
        page.startsWith("/") ? `${origin}${page}` : page,
      );
      return {
        step_index: index,
        step_id: step.id,
        action: index === 0 ? "goto_start" : (step.action ?? "request"),
        elapsed_ms: 0,
        before_url: url,
        after_url: url,
        event_sequence_start: 1,
        event_sequence_end: 0,
        artifacts: {
          screenshot: { state: "not_requested" },
          dom: { state: "not_requested" },
          accessibility:
            text === null
              ? { state: "not_requested" }
              : {
                  state: "captured",
                  value: {
                    sha256: createHash("sha256").update(text).digest("hex"),
                    bytes: Buffer.byteLength(text),
                    text,
                  },
                },
          url: { state: "not_requested" },
          history: { state: "not_requested" },
          storage: { state: "not_requested" },
        },
        completeness: {
          status: "complete",
          equality_eligible: true,
          missing_sections: [],
          truncated_sections: [],
        },
        status: step.outcome ?? "completed",
        error: step.outcome === undefined ? null : "step did not complete",
      };
    }),
    events: {
      retained: items.length,
      dropped: omitted,
      items,
      omissions: {
        by_kind:
          omitted === 0
            ? []
            : [
                {
                  kind: "request",
                  count: omitted,
                  reasons: ["max-network-transactions"],
                },
              ],
        network_transactions: [],
        network_transaction_range:
          omitted === 0
            ? null
            : {
                first_transaction_id: "request-1025",
                last_transaction_id: `request-${String(1024 + omitted)}`,
                count: omitted,
                reason: "max-network-transactions",
              },
      },
    },
    completeness: {
      status: "complete",
      equality_eligible: true,
      missing_sections: [],
      truncated_sections: [],
    },
    limitations: [],
  });
  return createBrowserScenarioEvidence(
    browserScenarioSchema.parse({
      browser: { mode: "launch", executable_path: process.execPath },
      start_url: { url: `${origin}/`, query: [] },
      actions: steps.map((step) => ({
        step_id: step.id,
        action: "wait_for_timeout",
        duration_ms: 1,
      })),
    }),
    { source: jsonValueSchema.parse(capture), facts: capture },
    { id: "fixture", name: "fixture", version: "1" },
  );
};

let files = 0;

/** Write Evidence as `capture-browser-scenario --evidence_output` does, and read it back through the comparer. */
export const readCapture = async (
  origin: string,
  steps: readonly Step[],
  options: CaptureOptions = {},
): Promise<ScenarioBehaviorCapture> => {
  const root = await createTestTempDirectory("rea-scenario-behavior-");
  files += 1;
  const file = join(root, `run-${String(files)}.json`);
  await writeFile(
    file,
    JSON.stringify(
      createEvidenceBundle([captureEvidence(origin, steps, options)]),
    ),
  );
  const capture = await readScenarioBehaviorCapture(file);
  if (!capture.ok) throw capture.error;
  return capture.value;
};

export interface Declarations {
  readonly renames?: readonly ScenarioBehaviorRename[];
  readonly volatile_fields?: readonly ScenarioBehaviorVolatileField[];
}

/** Compare captures of the given step lists: one list per capture, per side. */
export const compare = async (
  left: readonly (readonly Step[])[],
  right: readonly (readonly Step[])[],
  declarations: Declarations = {},
): Promise<ScenarioBehaviorComparison> => {
  const compared = compareScenarioBehaviorCaptures({
    left: await Promise.all(left.map((steps) => readCapture(LEFT, steps))),
    right: await Promise.all(right.map((steps) => readCapture(RIGHT, steps))),
    renames: declarations.renames ?? [],
    volatile_fields: declarations.volatile_fields ?? [],
  });
  if (!compared.ok) throw compared.error;
  return scenarioBehaviorComparisonSchema.parse(compared.value);
};

export const stepOf = (comparison: ScenarioBehaviorComparison, id: string) => {
  const step = comparison.steps.find(({ step_id }) => step_id === id);
  if (step === undefined) throw new Error(`no step ${id}`);
  return step;
};

export const list: Step = {
  id: "fp-notes",
  calls: [{ line: "GET /api/notes", reply: { json: [] } }],
};
export const create = (reply: Reply | undefined, status = 201): Step => ({
  id: "create-note",
  page: "/notes?sort=new#top",
  calls: [
    {
      line: "POST /api/notes",
      status,
      send: { title: "Hello World" },
      ...(reply === undefined ? {} : { reply }),
    },
  ],
});
export const note = (slug = "hello-world"): Reply => ({
  json: { title: "Hello World", slug, tags: ["a", "b"] },
});
