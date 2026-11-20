import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { createEvidenceBundle } from "../../domain/evidenceBundle.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import type { ScenarioBehaviorComparison } from "../../domain/scenarioBehaviorComparison.js";
import {
  compareScenarioBehaviorCaptures,
  describeScenarioBehavior,
  readScenarioBehaviorCapture,
} from "./ScenarioBehaviorComparisonService.js";
import {
  LEFT,
  RIGHT,
  captureEvidence,
  compare,
  create,
  list,
  note,
  readCapture,
  stepOf,
  type Call,
  type Reply,
  type Step,
} from "./scenarioBehaviorCapture.fixture.js";

/**
 * Regressions from the proof round of clone runs: every way a wrong clone
 * compared `unchanged`, every way a correct clone compared `changed`, and
 * beside each relaxation the neighbouring wrong case that must still differ.
 */

/** A step's status and its findings as `dimension/category side pointer-or-request`. */
const brief = (comparison: ScenarioBehaviorComparison, id: string) => {
  const step = stepOf(comparison, id);
  return [
    step.status,
    ...step.findings.map(
      ({ dimension, category, side, pointer, request }) =>
        `${dimension}/${category} ${side ?? "-"} ${pointer ?? request ?? "-"}`,
    ),
  ];
};

const read = (reply: Reply, id = "read"): Step[] => [
  list,
  { id, calls: [{ line: "GET /api/thing", reply }] },
];
const json = (value: JsonValue, id?: string): Step[] =>
  read({ json: value }, id);

it("finds an array and an object with index-like keys different", async () => {
  const array = json({ items: ["x", "y"] });
  const object = json({ items: { "0": "x", "1": "y" } });
  const twice = await compare([array, array], [object, object]);
  expect(twice.verdict).toBe("changed");
  expect(stepOf(twice, "read").findings).toEqual([
    {
      dimension: "body",
      category: "value",
      request: "GET /api/thing#1",
      pointer: "/items",
      expected: '["x","y"]',
      actual: '{"0":"x","1":"y"}',
      side: null,
    },
  ]);
  expect((await compare([array], [object])).verdict).toBe("changed");
  expect((await compare([object, object], [array])).verdict).toBe("changed");
  const root = await compare(
    [json(["x", "y"]), json(["x", "y"])],
    [json({ "0": "x", "1": "y" })],
  );
  expect(brief(root, "read")).toEqual(["changed", "body/value - "]);
});

it("reads requests the capture itself omitted as unknown on every step, never as no requests", async () => {
  const steps = [list, create(note())];
  const whole = await readCapture(LEFT, steps);
  const cut = await readCapture(LEFT, steps, { omittedRequests: 3 });
  const cutRight = await readCapture(RIGHT, steps, { omittedRequests: 3 });
  // A capture that left requests out cannot fingerprint its start state.
  expect(cut.fingerprint_sha256).toBeNull();
  const compared = compareScenarioBehaviorCaptures({
    left: [cut, cut],
    right: [cutRight, cutRight],
    renames: [],
    volatile_fields: [],
  });
  if (!compared.ok) throw compared.error;
  expect(compared.value.verdict).toBe("unknown");
  expect(compared.value.summary).toMatchObject({ unknown: 3, unchanged: 0 });
  expect(stepOf(compared.value, "create-note").findings).toEqual([
    {
      dimension: "request",
      category: "not-recorded",
      request: "requests the capture omitted",
      pointer: null,
      expected:
        "3 request events omitted by the capture (max-network-transactions)",
      actual: null,
      side: "left",
    },
    expect.objectContaining({ category: "not-recorded", side: "right" }),
  ]);
  // One side's omission is that side's gap; the other side's requests are known.
  const oneSided = compareScenarioBehaviorCaptures({
    left: [whole, whole],
    right: [cutRight],
    renames: [],
    volatile_fields: [],
  });
  if (!oneSided.ok) throw oneSided.error;
  expect(brief(oneSided.value, "create-note")).toEqual([
    "unknown",
    "request/not-recorded right requests the capture omitted",
  ]);
});

it("never lets a request body no capture recorded equal no body or another lost body", async () => {
  const upload = (call: Partial<Call>): Step[] => [
    list,
    {
      id: "upload",
      calls: [
        { line: "POST /api/upload", reply: { json: { ok: true } }, ...call },
      ],
    },
  ];
  const lost = upload({ sendLost: true });
  const sent = upload({ send: { blob: "aaaa" } });
  // Both sides lost it: two unknowns, not agreement.
  expect(brief(await compare([lost, lost], [lost, lost]), "upload")).toEqual([
    "unknown",
    "request/not-recorded left POST /api/upload#1",
    "request/not-recorded right POST /api/upload#1",
  ]);
  // One side lost it: unknown on that side, never a difference from absence.
  expect(brief(await compare([lost], [sent]), "upload")).toEqual([
    "unknown",
    "request/not-recorded left POST /api/upload#1",
  ]);
  expect(brief(await compare([sent, sent], [lost]), "upload")).toEqual([
    "unknown",
    "request/not-recorded right POST /api/upload#1",
  ]);
  // A request that sent nothing is recorded as that, and differs from one that sent a body.
  const bare = upload({});
  expect((await compare([bare, bare], [bare, bare])).verdict).toBe("unchanged");
  expect(brief(await compare([bare, bare], [sent, sent]), "upload")).toEqual([
    "changed",
    "request/value - POST /api/upload#1",
  ]);
  // A body recorded in one capture does not stand in for the one another capture lost.
  expect(brief(await compare([sent, lost], [sent, sent]), "upload")).toEqual([
    "unstable",
    "request/repeats-differ left POST /api/upload#1",
  ]);
});

it("counts the left's observations of a reply, not its captures, before calling a value steady", async () => {
  const made = (createdAt: string): Step[] =>
    json({ createdAt, slug: "hello" });
  const lostBody = read({ lost: "body-read-failed" });
  const left = [made("2026-11-20T01:00:00.000Z"), lostBody];
  const right = [
    made("2027-02-03T04:05:06.007Z"),
    made("2027-02-03T04:05:07.008Z"),
  ];
  // Two left captures, one observed reply: a clock that differs is not shown steady.
  for (const volatile_fields of [
    [],
    [{ step_id: "read", pointer: "/createdAt" }],
  ]) {
    const comparison = await compare(left, right, { volatile_fields });
    expect(stepOf(comparison, "read")).toMatchObject({
      status: "unknown",
      findings: [
        {
          dimension: "body",
          category: "single-observation",
          pointer: "/createdAt",
          side: "left",
        },
      ],
    });
  }
  // A second observed reply that agrees makes the same clock a difference.
  const steady = await compare([left[0]!, left[0]!, lostBody], right);
  expect(stepOf(steady, "read").status).toBe("changed");
});

it("calls a request line the left never repeats unstable, and still contradicts a steady request set", async () => {
  const poll = (nonce: number, id = "poll", extra: Call[] = []): Step[] => [
    list,
    {
      id,
      calls: [
        { line: `GET /api/poll?_=${String(nonce)}`, reply: { json: 1 } },
        ...extra,
      ],
    },
  ];
  for (const id of ["poll", "setup-poll"]) {
    const comparison = await compare(
      [poll(1, id), poll(2, id)],
      [poll(3, id), poll(4, id)],
    );
    expect(comparison.verdict).toBe("unknown");
    expect(brief(comparison, id)).toEqual([
      "unstable",
      "request/repeats-differ left GET /api/poll?_=1#1",
      "request/repeats-differ left GET /api/poll?_=2#1",
      "request/repeats-differ right GET /api/poll?_=3#1",
      "request/repeats-differ right GET /api/poll?_=4#1",
    ]);
  }
  // A clone that sends one fixed line is still not held against a varying original.
  expect(
    brief(await compare([poll(1), poll(2)], [poll(9), poll(9)]), "poll"),
  ).toEqual([
    "unstable",
    "request/repeats-differ left GET /api/poll?_=1#1",
    "request/repeats-differ left GET /api/poll?_=2#1",
    "request/repeats-differ left GET /api/poll?_=9#1",
  ]);
  // The left sending the same requests in every capture is contradicted by a request the right adds.
  const added = await compare([poll(1), poll(1)], [poll(3), poll(3)]);
  expect(brief(added, "poll")).toEqual([
    "changed",
    "request/value - GET /api/poll?_=1#1",
    "request/value - GET /api/poll?_=3#1",
  ]);
  // A request the left sends in every capture and the right never sends stays a difference beside a varying one.
  const steadyCall: Call = { line: "DELETE /api/item/1", status: 204 };
  const dropped = await compare(
    [poll(1, "poll", [steadyCall]), poll(2, "poll", [steadyCall])],
    [poll(3), poll(4)],
  );
  expect(stepOf(dropped, "poll").status).toBe("changed");
});

it("calls a side unstable when one capture has a status or text another lacks", async () => {
  const answered = read({ json: { ok: true } });
  const unanswered: Step[] = [
    list,
    { id: "read", calls: [{ line: "GET /api/thing", status: null }] },
  ];
  expect(
    brief(await compare([answered, answered], [unanswered, answered]), "read"),
  ).toEqual(["unstable", "status/repeats-differ right GET /api/thing#1"]);
  const silent: Step[] = [list, { ...answered[1]!, text: null }];
  expect(
    brief(await compare([answered, silent], [answered, answered]), "read"),
  ).toEqual(["unstable", "text/repeats-differ left -"]);
  // What the side did record is still compared: a lost status does not hide a wrong one.
  const failing: Step[] = [
    list,
    { id: "read", calls: [{ line: "GET /api/thing", status: 500 }] },
  ];
  expect(
    stepOf(await compare([answered, unanswered], [failing, failing]), "read")
      .status,
  ).toBe("changed");
});

it("compares a download like any reply and skips only the markup of a page", async () => {
  const visit = (call: Partial<Call>, page = "/"): Step[] => [
    list,
    {
      id: "export",
      page,
      calls: [{ line: "GET /export.csv", type: "document", ...call }],
    },
  ];
  const csv = (text: string) => visit({ reply: { text, media: "text/csv" } });
  const original = csv("id,total\n1,100\n");
  expect((await compare([original, original], [original])).verdict).toBe(
    "unchanged",
  );
  expect(
    brief(
      await compare([original, original], [csv("id;total\n1;999\n")]),
      "export",
    ),
  ).toEqual(["changed", "body/value - "]);
  // A download whose body no capture holds is unknown on each side, never a match.
  const lost = visit({ reply: { lost: "body-read-failed" } });
  expect(brief(await compare([lost, lost], [lost, lost]), "export")).toEqual([
    "unknown",
    "body/not-recorded left GET /export.csv#1",
    "body/not-recorded right GET /export.csv#1",
  ]);
  // Markup is the application's own source: two pages differ only in what they show.
  const page = (html: string) => visit({ reply: { html } });
  expect(
    (await compare([page("<p>a"), page("<p>a")], [page("<div>b")])).verdict,
  ).toBe("unchanged");
  // A page too large for the capture is still the page the step ended on.
  const large = visit({ reply: { lost: "body-size-limit" } }, "/export.csv");
  expect((await compare([large, large], [large, large])).verdict).toBe(
    "unchanged",
  );
  // A page on one side and data on the other differ.
  expect(brief(await compare([page("<p>a")], [original]), "export")).toEqual([
    "changed",
    "body/value - GET /export.csv#1",
  ]);
  // A navigation on one side and a script request on the other is a different request.
  const fetched: Step[] = [
    list,
    {
      id: "export",
      calls: [
        { line: "GET /export.csv", reply: { text: "x", media: "text/csv" } },
      ],
    },
  ];
  expect(
    brief(await compare([csv("x"), csv("x")], [fetched, fetched]), "export"),
  ).toEqual(["changed", "request/value - GET /export.csv#1"]);
});

it("reports a right side that agrees with the left in one capture as unsteady only", async () => {
  const shown = (text: string, slug = "hello"): Step[] => [
    list,
    { ...create({ json: { slug } }), id: "setup-click", text },
  ];
  const idle = shown("idle");
  const done = shown("refreshed");
  // The snapshot of one right capture preceded the render: nothing shows the clone differs.
  const raced = await compare([done, done], [idle, done]);
  expect(raced.verdict).toBe("unknown");
  expect(stepOf(raced, "setup-click")).toEqual({
    step_id: "setup-click",
    kind: "setup",
    status: "unstable",
    findings: [
      {
        dimension: "text",
        category: "repeats-differ",
        request: null,
        pointer: null,
        expected: null,
        actual: '"idle" | "refreshed"',
        side: "right",
      },
    ],
  });
  // The order of the right captures does not matter, nor the number of left captures.
  expect(brief(await compare([done], [done, idle]), "setup-click")).toEqual([
    "unstable",
    "text/repeats-differ right -",
  ]);
  // A right side none of whose captures agrees is a difference, unsteady or not.
  expect(
    brief(await compare([done, done], [idle, shown("failed")]), "setup-click"),
  ).toEqual(["changed", "text/value - -", "text/repeats-differ right -"]);
  expect(
    stepOf(await compare([done, done], [idle, idle]), "setup-click").status,
  ).toBe("changed");
  // The same for a reply leaf.
  const leaf = await compare([done, done], [done, shown("refreshed", "other")]);
  expect(brief(leaf, "setup-click")).toEqual([
    "unstable",
    "body/repeats-differ right /slug",
  ]);
  expect(leaf.volatile_fields).toEqual([
    {
      step_id: "setup-click",
      side: "right",
      pointer: "/slug",
      declared: false,
      honoured: false,
    },
  ]);
  const wrong = await compare(
    [done, done],
    [shown("refreshed", "x"), shown("refreshed", "y")],
  );
  expect(brief(wrong, "setup-click")).toEqual([
    "changed",
    "body/value - /slug",
    "body/repeats-differ right /slug",
  ]);
});

it("compares each side without its own origin in on-screen text and reply values", async () => {
  const printed = (origin: string, shownOrigin = origin): Step[] => [
    list,
    {
      id: "read",
      text: `Share ${shownOrigin}/help with a friend`,
      calls: [
        {
          line: "POST /api/links",
          send: { returnTo: `${shownOrigin}/done` },
          reply: {
            json: { self: `${shownOrigin}/api/abs`, other: `${LEFT}0/x` },
          },
        },
        {
          line: "GET /robots.txt",
          reply: { text: `Sitemap: ${shownOrigin}/map` },
        },
      ],
    },
  ];
  const left = printed(LEFT);
  const comparison = await compare([left, left], [printed(RIGHT)]);
  expect(comparison.verdict).toBe("unchanged");
  // The table shows the placeholder, never an address.
  const table = describeScenarioBehavior([await readCapture(LEFT, left)]);
  expect(JSON.stringify(table)).toContain("{origin}/api/abs");
  expect(JSON.stringify(table)).toContain("Share {origin}/help");
  // Another port is another origin: only the side's own is replaced.
  expect(JSON.stringify(table)).toContain(`${LEFT}0/x`);
  // A clone that prints the original's address is not printing its own.
  const copied = await compare([left, left], [printed(RIGHT, LEFT)]);
  expect(brief(copied, "read")).toEqual([
    "changed",
    "text/value - -",
    "request/value - POST /api/links#1",
    "body/value - /self",
    "body/value - ",
  ]);
});

it("reads a declared leaf the left holds steadily as not shown volatile, never as a match", async () => {
  const today = (day: string): Step[] => json({ today: day, n: 1 });
  const left = [today("2026-11-20"), today("2026-11-20")];
  const volatile_fields = [{ step_id: "read", pointer: "/today" }];
  const later = await compare(left, [today("2026-11-21")], { volatile_fields });
  expect(later.verdict).toBe("unknown");
  expect(stepOf(later, "read").findings).toEqual([
    {
      dimension: "body",
      category: "declared-not-shown",
      request: "GET /api/thing#1",
      pointer: "/today",
      expected: '"2026-11-20"',
      actual: '"2026-11-21"',
      side: "left",
    },
  ]);
  // Without the declaration, or with a value of another layout, it is the clone's difference.
  expect(brief(await compare(left, [today("2026-11-21")]), "read")).toEqual([
    "changed",
    "body/value - /today",
  ]);
  expect(
    brief(
      await compare(left, [today("21 Nov 2026")], { volatile_fields }),
      "read",
    ),
  ).toEqual(["changed", "body/value - /today"]);
  // A declaration for every step of the scenario names this step too.
  const everywhere = await compare(left, [today("2026-11-21")], {
    volatile_fields: [{ step_id: "*", pointer: "/today" }],
  });
  expect(brief(everywhere, "read")).toEqual([
    "unknown",
    "body/declared-not-shown left /today",
  ]);
  // It is honoured, like any declaration, only where the left's repeats differ.
  const varying = await compare(
    [today("2026-11-20"), today("2026-11-21")],
    [today("2026-11-22")],
    { volatile_fields: [{ step_id: "*", pointer: "/today" }] },
  );
  expect(varying.verdict).toBe("unchanged");
});

it("honours a declared list pattern at every index once the left shows it varying", async () => {
  const items = (...ids: string[]): Step[] =>
    json(ids.map((id) => ({ id, kind: "bee" })));
  const left = [items("a", "b", "c"), items("c", "b", "a")];
  const volatile_fields = [{ step_id: "read", pointer: "/*/id" }];
  const shuffled = await compare(left, [items("b", "c", "a")], {
    volatile_fields,
  });
  expect(shuffled.verdict).toBe("unchanged");
  expect(shuffled.volatile_fields).toEqual([
    {
      step_id: "read",
      side: "left",
      pointer: "/*/id",
      declared: true,
      honoured: true,
    },
  ]);
  // Undeclared, the same captures are not a match.
  expect((await compare(left, [items("b", "c", "a")])).verdict).not.toBe(
    "unchanged",
  );
  // An extra item, a value of another shape and an undeclared field are still differences.
  for (const right of [
    items("b", "c", "a", "d"),
    items("b", "long id", "a"),
    json([
      { id: "b", kind: "bee" },
      { id: "c", kind: "wasp" },
      { id: "a", kind: "bee" },
    ]),
  ])
    expect(
      stepOf(await compare(left, [right], { volatile_fields }), "read").status,
    ).toBe("changed");
});

it("compares a text reply that is JSON on both sides by its values", async () => {
  const text = (body: string): Step[] =>
    read({ text: body, media: "text/json" });
  const left = text('{"a":1,"b":[1,2]}');
  expect(
    (await compare([left, left], [text('{ "b": [1, 2], "a": 1 }')])).verdict,
  ).toBe("unchanged");
  expect(
    brief(await compare([left, left], [text('{"a":1,"b":[1,3]}')]), "read"),
  ).toEqual(["changed", "body/value - /b/1"]);
  // Text that is not JSON on one side is compared whole, and never equals JSON.
  expect(
    brief(await compare([left, left], [text('{"a":1,"b":[1,2]} ok')]), "read"),
  ).toEqual(["changed", "body/value - "]);
  expect(
    stepOf(await compare([text("a b"), text("a b")], [text("a  b")]), "read")
      .status,
  ).toBe("changed");
});

it("names the differing items of two lists of one length by position", async () => {
  const parcels = (uid: string, createdAt: string, weight = 2): Step[] =>
    json({
      items: [
        {
          uid: "pc_1",
          recipient: "M. Marlow",
          createdAt: "2026-01-01T00:00:00.000Z",
          weight: 1,
        },
        { uid, recipient: "M. Marlow", createdAt, weight },
      ],
    });
  const first = parcels("pc_aaaa", "2026-11-20T04:54:20.484Z");
  const second = parcels("pc_bbbb", "2026-11-20T04:54:45.074Z");
  // Two captures of one application: a generated key never makes the list itself differ.
  const preview = await compare([first], [second]);
  expect(brief(preview, "read")).toEqual([
    "changed",
    "body/value - /items/1/uid",
    "body/single-observation left /items/*/createdAt",
  ]);
  // With the leaves declared and the left showing them vary, the list compares.
  const volatile_fields = ["/items/*/uid", "/items/*/createdAt"].map(
    (pointer) => ({ step_id: "read", pointer }),
  );
  const third = parcels("pc_cccc", "2026-11-21T09:00:00.000Z");
  expect(
    (await compare([first, second], [third], { volatile_fields })).verdict,
  ).toBe("unchanged");
  // A steady field of the same item is still contradicted, at its own position.
  const heavier = await compare(
    [first, second],
    [parcels("pc_cccc", "2026-11-21T09:00:00.000Z", 3)],
    { volatile_fields },
  );
  expect(brief(heavier, "read")).toEqual([
    "changed",
    "body/value - /items/1/weight",
  ]);
  // Lists of different lengths keep the differ's own finding.
  const shorter = await compare(
    [first, first],
    [json({ items: [{ uid: "pc_1" }] })],
  );
  expect(
    stepOf(shorter, "read").findings.map(({ category }) => category),
  ).toContain("length");
  // A reordered list of scalars differs at each position that changed.
  const order = await compare(
    [json({ t: ["a", "b"] })],
    [json({ t: ["b", "a"] })],
  );
  expect(brief(order, "read")).toEqual([
    "changed",
    "body/value - /t/0",
    "body/value - /t/1",
  ]);
});

it("reports one on-screen text difference once, and judges unsteady text at every step", async () => {
  const page = (text: string, last = text): Step[] => [
    { ...list, text },
    { id: "read-1", text, calls: [{ line: "GET /api/a", reply: { json: 1 } }] },
    { id: "read-2", text, calls: [{ line: "GET /api/b", reply: { json: 2 } }] },
    { id: "open", text: last },
  ];
  const original = page("About Acme");
  const reworded = page("About the product");
  const comparison = await compare([original, original], [reworded, reworded]);
  // REA's own first step shows another text, so the difference first appears at the fingerprint step.
  expect(comparison.verdict).toBe("changed");
  expect(
    comparison.steps.map(({ step_id, status }) => [step_id, status]),
  ).toEqual([
    ["scenario_start", "unchanged"],
    ["fp-notes", "changed"],
    ["read-1", "unchanged"],
    ["read-2", "unchanged"],
    ["open", "unchanged"],
  ]);
  expect(comparison.limitations).toEqual([
    "The on-screen text difference at step fp-notes is listed there only: 3 later steps show the same text on both sides and carry no finding of their own for it.",
  ]);
  // A step whose text changes on either side is judged again.
  const moved = await compare(
    [original, original],
    [page("About the product", "Saved"), page("About the product", "Saved")],
  );
  expect(brief(moved, "open")).toEqual(["changed", "text/value - -"]);
  // Text one side's captures disagree on is never carried: every step that shows it is unstable.
  const ticking = await compare(
    [page("10:00:01"), page("10:00:02")],
    [reworded, reworded],
  );
  expect(
    ticking.steps
      .slice(1)
      .map(({ status, findings }) => [
        status,
        findings.map(({ category }) => category),
      ]),
  ).toEqual(Array.from({ length: 4 }, () => ["unstable", ["repeats-differ"]]));
  expect(ticking.limitations).toEqual([]);
});

it("names a difference inside an empty container once, without a finding for the container", async () => {
  expect(
    brief(await compare([json({}), json({})], [json({ a: 1 })]), "read"),
  ).toEqual(["changed", "body/extra-field - /a"]);
  expect(brief(await compare([json({ n: null })], [json({})]), "read")).toEqual(
    ["changed", "body/missing-field - /n"],
  );
});

it("says whether a volatile declaration exists apart from whether it took effect", async () => {
  const made = (ids: string[]): Step[] =>
    json({ items: ids.map((id) => ({ id })) });
  const comparison = await compare(
    [made(["a", "b"]), made(["a", "b"])],
    [made(["a", "y"]), made(["a", "z"])],
    { volatile_fields: [{ step_id: "read", pointer: "/items/*/id" }] },
  );
  // Declared, steady on the left, and the right varies within the shape: the lead is told the declaration exists.
  expect(brief(comparison, "read")).toEqual([
    "unknown",
    "body/declared-not-shown left /items/*/id",
  ]);
  expect(comparison.volatile_fields).toEqual([
    {
      step_id: "read",
      side: "right",
      pointer: "/items/*/id",
      declared: true,
      honoured: false,
    },
  ]);
});

it("counts a rename only for values that are compared", async () => {
  const visit = (name: string, outcome?: "failed"): Step[] => [
    list,
    {
      id: "open",
      text: "board",
      ...(outcome === undefined ? {} : { outcome }),
      calls: [
        {
          line: "GET /board",
          type: "document",
          reply: { html: `<h1>${name}` },
        },
        { line: "GET /api/name", reply: { json: { name } } },
      ],
    },
  ];
  const renames = [{ from: "Acme", to: "Zenith" }];
  const left = [visit("Acme"), visit("Acme"), visit("Acme", "failed")];
  const comparison = await compare(left, [visit("Zenith")], { renames });
  // One reply value in each of the two completed captures: not the markup, not the capture that failed.
  expect(comparison.renames_applied).toEqual([
    { from: "Acme", to: "Zenith", values: 2 },
  ]);
});

it("bounds the volatile fields listed for a step and counts the rest", async () => {
  const keyed = (seed: string): Step[] =>
    json(
      Object.fromEntries(
        Array.from({ length: 30 }, (_, index) => [
          `k${String(index)}`,
          `${seed}${String(index)}`,
        ]),
      ),
    );
  const comparison = await compare([keyed("a"), keyed("b")], [keyed("c")]);
  expect(comparison.volatile_fields).toHaveLength(20);
  expect(comparison.limitations).toContain(
    "Step read has 10 more volatile fields than the 20 listed.",
  );
  expect(stepOf(comparison, "read").status).toBe("unstable");
});

it("refuses a bundle of several records with what this command accepts", async () => {
  const root = await createTestTempDirectory("rea-scenario-behavior-");
  const file = join(root, "two.json");
  await writeFile(
    file,
    JSON.stringify(
      createEvidenceBundle([
        captureEvidence(LEFT, [list]),
        captureEvidence(LEFT, [list, create(note())]),
      ]),
    ),
  );
  const refused = await readScenarioBehaviorCapture(file);
  expect(!refused.ok && refused.error.userMessage).toBe(
    `${file} is an Evidence bundle that does not hold exactly one record. Pass a file holding one capture: capture-browser-scenario --evidence_output writes one per capture.`,
  );
});

it("shows a JSON string a request sent as JSON, and a body it could not record as not recorded", async () => {
  const table = describeScenarioBehavior([
    await readCapture(LEFT, [
      list,
      {
        id: "send",
        calls: [
          { line: "POST /api/a", send: "text" },
          { line: "POST /api/b", sendLost: true },
        ],
      },
    ]),
  ]);
  expect(
    table.steps[2]?.transactions.map(({ request_body: body }) => body),
  ).toEqual([{ kind: "json", value: "text" }, { kind: "not-recorded" }]);
});
