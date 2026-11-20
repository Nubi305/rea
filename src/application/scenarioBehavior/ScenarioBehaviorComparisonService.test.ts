import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import {
  analysisViewCaptureEvidence,
  analysisViewNativeEvidence,
} from "../../../tests/fixtures/analysisView.js";
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
  scenarioBehaviorTableSchema,
  type ScenarioBehaviorComparison,
  type ScenarioBehaviorRename,
  type ScenarioBehaviorVolatileField,
} from "../../domain/scenarioBehaviorComparison.js";
import { createBrowserScenarioEvidence } from "../BrowserScenarioEvidence.js";
import {
  compareScenarioBehaviorCaptures,
  compareScenarioBehaviorFiles,
  describeScenarioBehavior,
  readScenarioBehaviorCapture,
  type ScenarioBehaviorCapture,
} from "./ScenarioBehaviorComparisonService.js";

const LEFT = "http://127.0.0.1:4101";
const RIGHT = "http://127.0.0.1:4202";
const ELSEWHERE = "http://127.0.0.1:4303";

/** What a recorded reply holds: JSON, text, a body the capture lost, or one over its limit. */
type Reply =
  | { readonly json: JsonValue }
  | { readonly text: string }
  | { readonly lost: "body-read-failed" | "body-size-limit" };

/** One request a step made; `at` sends it to another origin, `status` null leaves it unanswered. */
interface Call {
  readonly line: string;
  readonly type?: string;
  readonly at?: string;
  readonly status?: number | null;
  readonly reply?: Reply;
  readonly send?: JsonValue;
}

/** One scenario step as a capture records it. */
interface Step {
  readonly id: string;
  readonly outcome?: "failed" | "cancelled";
  /** The page address after the step: a path at the capture's origin, or a whole URL. */
  readonly page?: string;
  /** Accessibility text; null when the capture did not record it. */
  readonly text?: string | null;
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

const replyBody = (reply: Reply | undefined) => {
  if (reply === undefined) return { state: "not_requested" };
  if ("json" in reply)
    return recorded(JSON.stringify(reply.json), "application/json", false);
  if ("text" in reply) return recorded(reply.text, "text/plain", false);
  return reply.lost === "body-size-limit"
    ? {
        state: "unavailable",
        reason: reply.lost,
        message: "over the limit",
        limit_bytes: 65_536,
        observed_bytes: 102_410,
      }
    : { state: "unavailable", reason: reply.lost, message: "lost" };
};

/** A capture of `steps` at `origin`, after REA's own first step, as authenticated Evidence. */
const captureEvidence = (origin: string, steps: readonly Step[]): Evidence => {
  const all: readonly Step[] = [
    {
      id: "scenario_start",
      calls: [{ line: "GET /", type: "document", reply: { text: "<p>app" } }],
    },
    ...steps,
  ];
  const items: unknown[] = [];
  let transactions = 0;
  for (const [stepIndex, step] of all.entries())
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
        header_names: [],
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
      if (call.send !== undefined)
        items.push(
          content(
            "request",
            recorded(JSON.stringify(call.send), "application/json", true),
          ),
        );
      if (call.status === null) continue;
      items.push(event("response", call.status ?? 200));
      items.push(content("response", replyBody(call.reply)));
    }
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
        action: index === 0 ? "goto_start" : "request",
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
      dropped: 0,
      items,
      omissions: {
        by_kind: [],
        network_transactions: [],
        network_transaction_range: null,
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
const readCapture = async (
  origin: string,
  steps: readonly Step[],
): Promise<ScenarioBehaviorCapture> => {
  const root = await createTestTempDirectory("rea-scenario-behavior-");
  files += 1;
  const file = join(root, `run-${String(files)}.json`);
  await writeFile(
    file,
    JSON.stringify(createEvidenceBundle([captureEvidence(origin, steps)])),
  );
  const capture = await readScenarioBehaviorCapture(file);
  if (!capture.ok) throw capture.error;
  return capture.value;
};

interface Declarations {
  readonly renames?: readonly ScenarioBehaviorRename[];
  readonly volatile_fields?: readonly ScenarioBehaviorVolatileField[];
}

/** Compare captures of the given step lists: one list per capture, per side. */
const compare = async (
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

const stepOf = (comparison: ScenarioBehaviorComparison, id: string) => {
  const step = comparison.steps.find(({ step_id }) => step_id === id);
  if (step === undefined) throw new Error(`no step ${id}`);
  return step;
};

const list: Step = {
  id: "fp-notes",
  calls: [{ line: "GET /api/notes", reply: { json: [] } }],
};
const create = (reply: Reply | undefined, status = 201): Step => ({
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
const note = (slug = "hello-world"): Reply => ({
  json: { title: "Hello World", slug, tags: ["a", "b"] },
});

it("finds two addresses unchanged when every dimension of every step matches", async () => {
  const steps = [list, create(note())];
  const comparison = await compare([steps, steps], [steps, steps]);
  expect(comparison.verdict).toBe("unchanged");
  expect(comparison.summary).toEqual({
    steps: 3,
    unchanged: 3,
    changed: 0,
    unknown: 0,
    unstable: 0,
  });
  expect(comparison.steps.map(({ step_id, kind }) => [step_id, kind])).toEqual([
    ["scenario_start", "setup"],
    ["fp-notes", "fingerprint"],
    ["create-note", "behavior"],
  ]);
  expect(comparison.left.origin).toBe(LEFT);
  expect(comparison.right.origin).toBe(RIGHT);
  expect(comparison.left.start_state).toBe("clean");
  expect(comparison.right.start_state).toBe("clean");
  expect(comparison.limitations).toEqual([]);
});

it("reports a reply difference with its JSON pointer and both values", async () => {
  const original = [list, create(note())];
  const mutant = [list, create(note("hello_world"))];
  const comparison = await compare([original, original], [mutant, mutant]);
  expect(comparison.verdict).toBe("changed");
  expect(stepOf(comparison, "create-note")).toEqual({
    step_id: "create-note",
    kind: "behavior",
    status: "changed",
    findings: [
      {
        dimension: "body",
        category: "value",
        request: "POST /api/notes#1",
        pointer: "/slug",
        expected: '"hello-world"',
        actual: '"hello_world"',
        side: null,
      },
    ],
  });
  // One capture per side is enough to see a difference the differ itself reports.
  expect((await compare([original], [mutant])).verdict).toBe("changed");
});

it("reports a differing status, request, page address, on-screen text and step outcome", async () => {
  const left: Step[] = [
    list,
    create(note()),
    { id: "open", page: "/notes/1", text: "Hello World\nSaved" },
    { id: "delete", calls: [{ line: "DELETE /api/notes/1", status: 204 }] },
    { id: "last" },
  ];
  const right: Step[] = [
    list,
    {
      ...create({ json: { error: "title_taken" } }, 409),
      calls: [
        {
          line: "POST /api/notes",
          status: 409,
          send: { title: "hello world" },
          reply: { json: { error: "title_taken" } },
        },
      ],
    },
    { id: "open", page: "/notes/1?edit=1", text: "Hello World\nDraft" },
    { id: "delete", calls: [{ line: "DELETE /api/notes/2", status: 204 }] },
    { id: "last", outcome: "failed" },
  ];
  const comparison = await compare([left, left], [right, right]);
  const findings = (id: string) =>
    stepOf(comparison, id).findings.map(
      ({ dimension, category, request, expected, actual }) => ({
        dimension,
        category,
        request,
        expected,
        actual,
      }),
    );
  expect(findings("create-note")).toEqual([
    {
      dimension: "request",
      category: "value",
      request: "POST /api/notes#1",
      expected: '{"title":"Hello World"}',
      actual: '{"title":"hello world"}',
    },
    {
      dimension: "status",
      category: "status",
      request: "POST /api/notes#1",
      expected: "201",
      actual: "409",
    },
    expect.objectContaining({ dimension: "body", category: "missing-field" }),
    expect.objectContaining({ dimension: "body", category: "missing-field" }),
    expect.objectContaining({ dimension: "body", category: "missing-field" }),
    expect.objectContaining({ dimension: "body", category: "extra-field" }),
  ]);
  expect(findings("open")).toEqual([
    {
      dimension: "page_address",
      category: "value",
      request: null,
      expected: '"/notes/1"',
      actual: '"/notes/1?edit=1"',
    },
    {
      dimension: "text",
      category: "value",
      request: null,
      expected: '"Hello World\\nSaved"',
      actual: '"Hello World\\nDraft"',
    },
  ]);
  // Transactions match by request line; an unmatched one is a difference on each side.
  expect(findings("delete")).toEqual([
    {
      dimension: "request",
      category: "value",
      request: "DELETE /api/notes/1#1",
      expected: "DELETE /api/notes/1#1",
      actual: null,
    },
    {
      dimension: "request",
      category: "value",
      request: "DELETE /api/notes/2#1",
      expected: null,
      actual: "DELETE /api/notes/2#1",
    },
  ]);
  expect(findings("last")).toEqual([
    {
      dimension: "step",
      category: "value",
      request: null,
      expected: "completed",
      actual: "failed",
    },
  ]);
  expect(comparison.summary).toMatchObject({ changed: 4, unchanged: 2 });
});

it("never lets a reply body no capture recorded count as a match, on either side", async () => {
  const whole = [list, create(note())];
  const lost = [list, create({ lost: "body-read-failed" })];
  for (const [left, right, side] of [
    [[lost], [whole], "left"],
    [[whole], [lost], "right"],
    [[whole, whole], [lost, lost], "right"],
  ] as const) {
    const comparison = await compare(left, right);
    expect(comparison.verdict).toBe("unknown");
    expect(stepOf(comparison, "create-note")).toMatchObject({
      status: "unknown",
      findings: [
        {
          dimension: "body",
          category: "not-recorded",
          request: "POST /api/notes#1",
          side,
        },
      ],
    });
  }
  // Repeats fold: a second capture that recorded the body resolves it.
  expect((await compare([lost, whole, whole], [lost, whole])).verdict).toBe(
    "unchanged",
  );
  // A reply over the capture's body limit is never recorded, however many captures.
  const large = [list, create({ lost: "body-size-limit" })];
  expect((await compare([large, large], [large, large])).verdict).toBe(
    "unknown",
  );
  // A lost body does not hide a difference in what was recorded.
  const mutant = await compare(
    [whole, whole],
    [
      [list, create({ lost: "body-read-failed" }, 500)],
      [list, create(note("x"), 500)],
    ],
  );
  expect(stepOf(mutant, "create-note").status).toBe("changed");
});

it("reads an unanswered request, unrecorded text and an unfinished step as unknown", async () => {
  const steps = (variant: Partial<Step>, call?: Partial<Call>): Step[] => [
    list,
    {
      id: "create-note",
      calls: [{ line: "POST /api/notes", reply: note(), ...call }],
      ...variant,
    },
    { id: "after" },
  ];
  const good = steps({});
  const category = async (left: Step[], right: Step[]) => {
    const comparison = await compare([left, left], [right, right]);
    const step = stepOf(comparison, "create-note");
    return [
      step.status,
      ...step.findings.map(
        ({ dimension, category: found, side }) =>
          `${dimension} ${found} ${String(side)}`,
      ),
    ];
  };
  expect(await category(good, steps({}, { status: null }))).toEqual([
    "unknown",
    "status not-recorded right",
  ]);
  expect(await category(steps({ text: null }), good)).toEqual([
    "unknown",
    "text not-recorded left",
  ]);
  expect(await category(steps({ outcome: "failed" }), good)).toEqual([
    "unknown",
    "step not-completed left",
  ]);
  expect(await category(good, steps({ outcome: "cancelled" }))).toEqual([
    "unknown",
    "step not-completed right",
  ]);
});

it("expects no body of a redirect, a 204 or a HEAD reply", async () => {
  const steps: Step[] = [
    list,
    {
      id: "moved",
      calls: [
        {
          line: "GET /old",
          status: 302,
          reply: { lost: "body-read-failed" },
        },
        { line: "DELETE /api/notes/1", status: 204 },
        { line: "HEAD /api/notes", reply: { lost: "body-read-failed" } },
      ],
    },
  ];
  expect((await compare([steps, steps], [steps, steps])).verdict).toBe(
    "unchanged",
  );
});

it("calls a step unstable when one side's repeats disagree, and never changed for the left's own disagreement", async () => {
  const steady = [list, create(note())];
  const other = [list, { ...create(note("hello-world-2")), text: "again" }];
  const comparison = await compare([steady, other], [steady, steady]);
  expect(comparison.verdict).toBe("unknown");
  expect(stepOf(comparison, "create-note")).toMatchObject({
    status: "unstable",
    findings: [
      {
        dimension: "text",
        category: "repeats-differ",
        expected: '"screen create-note" | "again"',
        actual: null,
        side: "left",
      },
      {
        dimension: "body",
        category: "undeclared-volatile",
        pointer: "/slug",
        expected: '"hello-world" | "hello-world-2"',
        side: "left",
      },
    ],
  });
  expect(comparison.volatile_fields).toEqual([
    { step_id: "create-note", side: "left", pointer: "/slug", declared: false },
  ]);
  // The right disagreeing with itself contradicts the left's steady value as well.
  const right = await compare([steady, steady], [steady, other]);
  expect(
    stepOf(right, "create-note").findings.map(
      ({ category, side }) => `${category} ${String(side)}`,
    ),
  ).toEqual([
    "value null",
    "value null",
    "repeats-differ right",
    "undeclared-volatile right",
  ]);
  expect(stepOf(right, "create-note").status).toBe("changed");
  // A request only some repeats made is unstable too.
  const extra: Step = {
    ...create(note()),
    calls: [...create(note()).calls!, { line: "GET /api/late" }],
  };
  const requests = await compare([steady, [list, extra]], [steady, steady]);
  expect(stepOf(requests, "create-note")).toMatchObject({
    status: "unstable",
    findings: [
      {
        dimension: "request",
        category: "repeats-differ",
        request: "GET /api/late#1",
        expected: "sent in 1 of 2 captures",
        side: "left",
      },
    ],
  });
});

it("does not match a step one side lacks, and never compares REA's own steps", async () => {
  const left = [list, create(note()), { id: "only-left" }];
  const right = [
    list,
    create(note()),
    { id: "only-right" },
    { id: `rea-tree-${"a".repeat(64)}` },
  ];
  const comparison = await compare([left, left], [right, right]);
  expect(comparison.verdict).toBe("changed");
  expect(stepOf(comparison, "only-left")).toEqual({
    step_id: "only-left",
    kind: "behavior",
    status: "changed",
    findings: [
      {
        dimension: "step",
        category: "missing-step",
        request: null,
        pointer: null,
        expected: "only-left",
        actual: null,
        side: null,
      },
    ],
  });
  expect(comparison.steps.map(({ step_id }) => step_id)).toEqual([
    "scenario_start",
    "fp-notes",
    "create-note",
    "only-left",
  ]);
  expect(comparison.limitations).toEqual([
    "Steps only the right side has are not compared: only-right.",
  ]);
});

it("applies declared renames to the left's text and string values, and counts them", async () => {
  const left: Step[] = [
    list,
    {
      id: "create-note",
      text: "Acme Notes\nHello",
      calls: [
        {
          line: "POST /api/notes",
          send: { owner: "Acme" },
          reply: { json: { Acme: "by Acme", n: 1 } },
        },
        { line: "GET /about", reply: { text: "Acme Notes 1.0" } },
      ],
    },
  ];
  const right: Step[] = [
    list,
    {
      id: "create-note",
      text: "Jotter\nHello",
      calls: [
        {
          line: "POST /api/notes",
          send: { owner: "Zenith" },
          reply: { json: { Acme: "by Zenith", n: 1 } },
        },
        { line: "GET /about", reply: { text: "Jotter 1.0" } },
      ],
    },
  ];
  const renames = [
    { from: "Acme Notes", to: "Jotter" },
    { from: "Acme", to: "Zenith" },
  ];
  const renamed = await compare([left, left], [right, right], { renames });
  expect(renamed.verdict).toBe("unchanged");
  // Two captures, each with one on-screen text and one text body, then one request and one reply value.
  expect(renamed.renames_applied).toEqual([
    { from: "Acme Notes", to: "Jotter", values: 4 },
    { from: "Acme", to: "Zenith", values: 4 },
  ]);
  // Without the declaration the same captures differ, and a rename that changes nothing is not listed.
  const undeclared = await compare([left, left], [right, right], {
    renames: [{ from: "Nothing", to: "Else" }],
  });
  expect(stepOf(undeclared, "create-note").status).toBe("changed");
  expect(undeclared.renames_applied).toEqual([]);
});

it("honours a volatile field only where the left's repeats differ, counts it, and still compares its shape", async () => {
  const made = (id: string, createdAt: JsonValue, slug = "hello"): Step[] => [
    list,
    create({ json: { id, createdAt, slug } }),
  ];
  const left = [
    made("0a1b2c3d", "2026-11-20T01:00:00.000Z"),
    made("4e5f6a7b", "2026-11-20T01:00:09.125Z"),
  ];
  const right = [
    made("99999999", "2027-02-03T04:05:06.007Z"),
    made("aaaaaaaa", "2027-02-03T04:05:07.008Z"),
  ];
  const volatile_fields = [
    { step_id: "create-note", pointer: "/id" },
    { step_id: "create-note", pointer: "/createdAt" },
    { step_id: "create-note", pointer: "/slug" },
  ];
  const honoured = await compare(left, right, { volatile_fields });
  expect(honoured.verdict).toBe("unchanged");
  expect(honoured.volatile_fields).toEqual([
    { step_id: "create-note", side: "left", pointer: "/id", declared: true },
    { step_id: "create-note", side: "right", pointer: "/id", declared: true },
    {
      step_id: "create-note",
      side: "left",
      pointer: "/createdAt",
      declared: true,
    },
    {
      step_id: "create-note",
      side: "right",
      pointer: "/createdAt",
      declared: true,
    },
  ]);
  // Undeclared, the same captures are unstable: the lead has a declaration to make.
  const undeclared = await compare(left, right);
  expect(stepOf(undeclared, "create-note").status).toBe("unstable");
  expect(undeclared.volatile_fields.every(({ declared }) => !declared)).toBe(
    true,
  );
  // A declared field that is steady on the left is compared like any other.
  const mutant = await compare(
    left,
    [made("99999999", "2027-02-03T04:05:06.007Z", "HELLO")],
    { volatile_fields },
  );
  expect(stepOf(mutant, "create-note")).toMatchObject({
    status: "changed",
    findings: [{ category: "value", pointer: "/slug" }],
  });
  // An honoured value of another layout or type is a difference of shape.
  const misshapen = await compare(left, [made("99999999", 1_800_000_000)], {
    volatile_fields,
  });
  expect(stepOf(misshapen, "create-note")).toMatchObject({
    status: "changed",
    findings: [
      {
        category: "shape",
        pointer: "/createdAt",
        expected: '"2026-11-20T01:00:00.000Z"',
        actual: "1800000000",
      },
    ],
  });
});

it("does not let two clocks of one format or two ids stand in for equality", async () => {
  const made = (createdAt: string): Step[] => [
    list,
    create({ json: { createdAt, slug: "hello" } }),
  ];
  const early = made("2026-11-20T01:00:00.000Z");
  const late = made("2027-02-03T04:05:06.007Z");
  // The left holds the value steadily, so another clock contradicts it.
  const steady = await compare([early, early], [late, late]);
  expect(stepOf(steady, "create-note")).toMatchObject({
    status: "changed",
    findings: [
      {
        dimension: "body",
        category: "value",
        pointer: "/createdAt",
        expected: '"2026-11-20T01:00:00.000Z"',
        actual: '"2027-02-03T04:05:06.007Z"',
        side: null,
      },
    ],
  });
  // One left capture cannot show whether the value is steady: unknown, never a match.
  const single = await compare([early], [late, late]);
  expect(single.verdict).toBe("unknown");
  expect(stepOf(single, "create-note")).toMatchObject({
    status: "unknown",
    findings: [
      { category: "not-recorded", pointer: "/createdAt", side: "left" },
    ],
  });
  expect(single.limitations).toContainEqual(
    expect.stringContaining("left side has one capture"),
  );
  // Declarations do not apply to the fingerprint: a varying start state is dirty and unstable.
  const stamped = (at: string): Step[] => [
    {
      id: "fp-notes",
      calls: [{ line: "GET /api/notes", reply: { json: { at } } }],
    },
    create(note()),
  ];
  const dirty = await compare(
    [stamped("10:00"), stamped("10:01")],
    [stamped("10:02"), stamped("10:02")],
    { volatile_fields: [{ step_id: "fp-notes", pointer: "/at" }] },
  );
  expect(dirty.left.start_state).toBe("dirty");
  expect(dirty.right.start_state).toBe("clean");
  expect(stepOf(dirty, "fp-notes").status).toBe("unstable");
});

it("compares at the start origin only", async () => {
  const steps = (at: string | undefined, page: string): Step[] => [
    list,
    {
      id: "create-note",
      page,
      calls: [
        { line: "POST /api/notes", reply: note() },
        {
          line: "GET /api/profile",
          reply: { json: { plan: "free" } },
          ...(at === undefined ? {} : { at }),
        },
        // Another server's script is not compared at all.
        { line: "GET /cdn/lib.js", type: "script", at: ELSEWHERE },
      ],
    },
  ];
  const own = steps(undefined, "/notes");
  const forwarded = steps(ELSEWHERE, "/notes");
  const comparison = await compare([own, own], [forwarded, forwarded]);
  expect(stepOf(comparison, "create-note")).toMatchObject({
    status: "changed",
    findings: [
      {
        dimension: "request",
        category: "value",
        request: "GET /api/profile#1",
        actual: null,
      },
      {
        dimension: "request",
        category: "other-origin",
        request: `GET ${ELSEWHERE}/api/profile#1`,
        side: "right",
      },
    ],
  });
  // Both sides calling another server is unknown, not a match.
  const both = await compare([forwarded, forwarded], [forwarded, forwarded]);
  expect(stepOf(both, "create-note").status).toBe("unknown");
  expect(both.left.ignored_transactions).toBe(2);
  // A page that left the start origin keeps its whole address, so it cannot match a page that stayed.
  const left = await compare(
    [own, own],
    [steps(undefined, `${ELSEWHERE}/notes`)],
  );
  expect(stepOf(left, "create-note")).toMatchObject({
    status: "changed",
    findings: [
      {
        dimension: "page_address",
        expected: '"/notes"',
        actual: `"${ELSEWHERE}/notes"`,
      },
    ],
  });
});

it("lists the most severe findings of a step and counts the rest", async () => {
  const wide = (value: number): Step[] => [
    list,
    create({
      json: Object.fromEntries(
        Array.from({ length: 25 }, (_, index) => [`f${String(index)}`, value]),
      ),
    }),
  ];
  const comparison = await compare([wide(1), wide(1)], [wide(2), wide(2)]);
  expect(stepOf(comparison, "create-note").findings).toHaveLength(20);
  expect(comparison.limitations).toEqual([
    "Step create-note has 5 more findings than the 20 most severe listed.",
  ]);
});

it("refuses an empty side and captures that are not repeats of one scenario", async () => {
  const one = await readCapture(LEFT, [list, create(note())]);
  const other = await readCapture(LEFT, [list, { id: "another" }]);
  const refused = (
    left: ScenarioBehaviorCapture[],
    right: ScenarioBehaviorCapture[],
  ) => {
    const compared = compareScenarioBehaviorCaptures({
      left,
      right,
      renames: [],
      volatile_fields: [],
    });
    return compared.ok ? "compared" : compared.error.userMessage;
  };
  expect(refused([], [one])).toBe(
    "Name at least one capture for the left side.",
  );
  expect(refused([one], [])).toBe(
    "Name at least one capture for the right side.",
  );
  expect(refused([one], [one, other])).toMatch(
    /do not list the same step ids in the same order/u,
  );
});

it("reads a record or a bundle and states the facts admission needs", async () => {
  const root = await createTestTempDirectory("rea-scenario-behavior-");
  const evidence = captureEvidence(LEFT, [
    list,
    create(note()),
    { id: `rea-tree-${"b".repeat(64)}` },
  ]);
  const record = join(root, "record.json");
  const bundle = join(root, "bundle.json");
  await writeFile(record, JSON.stringify(evidence));
  await writeFile(bundle, JSON.stringify(createEvidenceBundle([evidence])));
  const read = await readScenarioBehaviorCapture(record);
  const fromBundle = await readScenarioBehaviorCapture(bundle);
  if (!read.ok || !fromBundle.ok) throw new Error("capture refused");
  const { observations: _, ...facts } = read.value;
  expect(facts).toEqual({
    file: record,
    evidence_id: evidence.evidence_id,
    start_origin: LEFT,
    scenario_sha256: (evidence.parameters as { scenario_sha256: string })
      .scenario_sha256,
    definition: {
      start_url: `${LEFT}/`,
      step_ids: ["fp-notes", "create-note", `rea-tree-${"b".repeat(64)}`],
    },
    steps: [
      { step_id: "scenario_start", outcome: "completed" },
      { step_id: "fp-notes", outcome: "completed" },
      { step_id: "create-note", outcome: "completed" },
      { step_id: `rea-tree-${"b".repeat(64)}`, outcome: "completed" },
    ],
    fingerprint_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    reply_bodies: [
      {
        request: "GET /",
        sha256: createHash("sha256").update("<p>app").digest("hex"),
        bytes: 6,
      },
      { request: "GET /api/notes", sha256: expect.any(String), bytes: 2 },
      { request: "POST /api/notes", sha256: expect.any(String), bytes: 61 },
    ],
  });
  expect(fromBundle.value.evidence_id).toBe(evidence.evidence_id);
  expect(fromBundle.value.fingerprint_sha256).toBe(
    read.value.fingerprint_sha256,
  );
});

it("gives equal fingerprints to equal start states at any address, and none when an observation is missing", async () => {
  const fingerprint = async (origin: string, steps: readonly Step[]) =>
    (await readCapture(origin, steps)).fingerprint_sha256;
  const clean = await fingerprint(LEFT, [list, create(note())]);
  expect(await fingerprint(RIGHT, [list, create(note("other"))])).toBe(clean);
  const dirty: Step = {
    id: "fp-notes",
    calls: [{ line: "GET /api/notes", reply: { json: [{ id: 1 }] } }],
  };
  expect(await fingerprint(LEFT, [dirty])).not.toBe(clean);
  for (const missing of [
    { ...list, text: null },
    { ...list, outcome: "failed" as const },
    { ...list, calls: [{ line: "GET /api/notes", status: null }] },
    {
      ...list,
      calls: [{ line: "GET /api/notes", reply: { lost: "body-read-failed" } }],
    } satisfies Step,
    { ...list, calls: [{ line: "GET /api/notes", at: ELSEWHERE }] },
  ])
    expect(await fingerprint(LEFT, [missing])).toBeNull();
  // No fingerprint step, no fingerprint.
  expect(await fingerprint(LEFT, [create(note())])).toBeNull();
  const comparison = await compare(
    [[list], [dirty]],
    [[list], [{ ...list, text: null }]],
  );
  expect(comparison.left.start_state).toBe("dirty");
  expect(comparison.right.start_state).toBe("unknown");
});

it("refuses an edited file, a network capture without steps and another operation's Evidence", async () => {
  const root = await createTestTempDirectory("rea-scenario-behavior-");
  const file = join(root, "run-1.json");
  await writeFile(
    file,
    JSON.stringify(
      createEvidenceBundle([captureEvidence(LEFT, [list, create(note())])]),
    ),
  );
  const edited = join(root, "edited.json");
  await writeFile(
    edited,
    (await readFile(file, "utf8")).replaceAll(LEFT, RIGHT),
  );
  expect((await readScenarioBehaviorCapture(edited)).ok).toBe(false);
  const refusal = async (name: string, evidence: Evidence) => {
    const path = join(root, name);
    await writeFile(path, JSON.stringify(evidence));
    const read = await readScenarioBehaviorCapture(path);
    return read.ok ? "read" : read.error.userMessage;
  };
  expect(await refusal("har.json", analysisViewCaptureEvidence())).toMatch(
    /is a network capture without scenario steps/u,
  );
  expect(await refusal("native.json", analysisViewNativeEvidence())).toBe(
    "The evidence file is not web network capture or browser scenario Evidence.",
  );
  expect(
    (await readScenarioBehaviorCapture(join(root, "absent.json"))).ok,
  ).toBe(false);
});

it("describes one side's behaviour without its address or its markup", async () => {
  const made = (id: string): Step[] => [
    list,
    create({ json: { id, slug: "hello" } }),
    {
      id: "big",
      calls: [{ line: "GET /api/big", reply: { text: "x".repeat(9000) } }],
    },
    { id: `rea-tree-${"c".repeat(64)}` },
  ];
  const table = scenarioBehaviorTableSchema.parse(
    describeScenarioBehavior([
      await readCapture(LEFT, [
        list,
        create({ lost: "body-read-failed" }),
        made("")[2]!,
        made("")[3]!,
      ]),
      await readCapture(LEFT, made("0a1b")),
      await readCapture(LEFT, made("2c3d")),
    ]),
  );
  expect(JSON.stringify(table)).not.toContain(LEFT);
  expect(table.captures).toBe(3);
  expect(table.steps).toEqual([
    {
      step_id: "scenario_start",
      kind: "setup",
      action: "goto_start",
      outcome: "completed",
      page_address: "/",
      text: "screen scenario_start",
      transactions: [
        {
          request: "GET /#1",
          request_body: { kind: "none" },
          status: 200,
          reply: { kind: "omitted", reason: "document" },
        },
      ],
      volatile_pointers: [],
    },
    expect.objectContaining({ step_id: "fp-notes", kind: "fingerprint" }),
    {
      step_id: "create-note",
      kind: "behavior",
      action: "request",
      outcome: "completed",
      page_address: "/notes?sort=new#top",
      text: "screen create-note",
      transactions: [
        {
          request: "POST /api/notes#1",
          request_body: { kind: "json", value: { title: "Hello World" } },
          status: 201,
          // The first capture lost the body; a repeat supplies it.
          reply: { kind: "json", value: { id: "0a1b", slug: "hello" } },
        },
      ],
      volatile_pointers: ["/id"],
    },
    expect.objectContaining({
      step_id: "big",
      transactions: [
        expect.objectContaining({
          reply: {
            kind: "omitted",
            reason: "9000 bytes, over the table's 8192",
          },
        }),
      ],
    }),
  ]);
});

it("compares files with the declarations of one scenario and omits unchanged steps from the summary", async () => {
  const root = await createTestTempDirectory("rea-scenario-behavior-");
  const write = async (name: string, value: unknown): Promise<string> => {
    const path = join(root, name);
    await writeFile(path, JSON.stringify(value));
    return path;
  };
  const made = (origin: string, id: string, name: string) =>
    createEvidenceBundle([
      captureEvidence(origin, [
        list,
        { ...create({ json: { id, slug: "hello" } }), text: name },
      ]),
    ]);
  const left = [
    await write("left-1.json", made(LEFT, "0a1b", "Acme")),
    await write("left-2.json", made(LEFT, "2c3d", "Acme")),
  ];
  const right = [
    await write("right-1.json", made(RIGHT, "4e5f", "Zenith")),
    await write("right-2.json", made(RIGHT, "6a7b", "Zenith")),
  ];
  const differences = await write("intended-differences.json", {
    renames: [{ from: "Acme", to: "Zenith", reason: "product name" }],
    volatile_fields: [
      {
        scenario: "notes",
        step_id: "create-note",
        pointer: "/id",
        reason: "random id",
      },
      {
        scenario: "other",
        step_id: "create-note",
        pointer: "/slug",
        reason: "another scenario's",
      },
    ],
  });
  const run = async (
    options: Partial<Parameters<typeof compareScenarioBehaviorFiles>[0]>,
  ) =>
    compareScenarioBehaviorFiles({
      left,
      right,
      detail: "summary",
      ...options,
    });
  const undeclared = await run({});
  if (!undeclared.ok) throw undeclared.error;
  expect(undeclared.value.verdict).toBe("changed");
  expect(undeclared.value.summary).toMatchObject({ steps: 3, unchanged: 2 });
  expect(undeclared.value.steps.map(({ step_id }) => step_id)).toEqual([
    "create-note",
  ]);
  const declared = await run({ differences, scenario: "notes" });
  if (!declared.ok) throw declared.error;
  expect(declared.value.verdict).toBe("unchanged");
  expect(declared.value.steps).toEqual([]);
  expect(declared.value.renames_applied).toEqual([
    { from: "Acme", to: "Zenith", values: 2 },
  ]);
  const complete = await run({
    differences,
    scenario: "notes",
    detail: "complete",
  });
  expect(complete.ok && complete.value.steps.length).toBe(3);
  const ambiguous = await run({ differences });
  expect(!ambiguous.ok && ambiguous.error.userMessage).toMatch(
    /declares volatile fields for notes, other\. Pass --scenario/u,
  );
  const invalid = await run({
    differences: await write("bad.json", { renames: [{ from: "", to: "x" }] }),
  });
  expect(!invalid.ok && invalid.error.userMessage).toMatch(
    /is not an intended-differences file/u,
  );
  const unreadable = await run({ left: [join(root, "absent.json")] });
  expect(unreadable.ok).toBe(false);
});
