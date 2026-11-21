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
  ELSEWHERE,
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
 * Regressions from the proof rounds of clone runs: every way a wrong clone
 * compared `unchanged`, every way a correct clone compared `changed`, and
 * beside each relaxation the smallest wrong clone that could hide behind it,
 * with what it reads: `changed`, `unknown` or `unstable`, never `unchanged`.
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

it("finds a list and an object different whatever is declared volatile beneath them", async () => {
  const ids = (value: JsonValue): Step[] => json({ ids: value });
  const left = [ids(["0a1b", "2c3d"]), ids(["4e5f", "6a7b"])];
  // Generated ids: every leaf beneath the container varies on the left and is declared.
  const keyed = await compare(
    left,
    [ids({ "0": "8c9d", "1": "0e1f" }), ids({ "0": "2a3b", "1": "4c5d" })],
    { volatile_fields: [{ step_id: "read", pointer: "/ids/*" }] },
  );
  expect(keyed.verdict).toBe("changed");
  expect(stepOf(keyed, "read").findings).toEqual([
    {
      dimension: "body",
      category: "value",
      request: "GET /api/thing#1",
      pointer: "/ids",
      expected: '["0a1b","2c3d"]',
      actual: '{"0":"8c9d","1":"0e1f"}',
      side: null,
    },
  ]);
  // No declaration took effect beneath the container.
  expect(keyed.volatile_fields.map(({ honoured }) => honoured)).toEqual([
    false,
    false,
  ]);
  // The control: the same declaration is honoured for a list on both sides.
  const listed = await compare(left, [ids(["8c9d", "0e1f"])], {
    volatile_fields: [{ step_id: "read", pointer: "/ids/*" }],
  });
  expect(listed.verdict).toBe("unchanged");
  // The other way round, with the member declared by its name, and at the root.
  const member = await compare(
    [json({ m: { "0": "0a1b" } }), json({ m: { "0": "2c3d" } })],
    [json({ m: ["4e5f"] }), json({ m: ["6a7b"] })],
    { volatile_fields: [{ step_id: "read", pointer: "/m/0" }] },
  );
  expect(brief(member, "read")).toEqual(["changed", "body/value - /m"]);
  const root = await compare(
    [json([{ id: "0a1b" }]), json([{ id: "2c3d" }])],
    [json({ "0": { id: "4e5f" } })],
    { volatile_fields: [{ step_id: "*", pointer: "/*/id" }] },
  );
  expect(brief(root, "read")).toEqual(["changed", "body/value - "]);
  // A side that answers with either kind disagrees with itself: unstable, declared or not, never a match.
  const either = [
    ids(["0a1b", "2c3d"]),
    ids({ "0": "0a1b", "1": "2c3d" }),
  ];
  for (const volatile_fields of [
    [],
    [{ step_id: "read", pointer: "/ids/*" }],
  ]) {
    expect(
      brief(await compare(left, either, { volatile_fields }), "read"),
    ).toEqual(["unstable", "body/repeats-differ right /ids"]);
    expect(
      brief(await compare(either, [left[0]!], { volatile_fields }), "read"),
    ).toEqual(["unstable", "body/repeats-differ left /ids"]);
  }
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

it("reads the left's own address as the right's in text and bodies, through no placeholder a clone could print", async () => {
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
            json: {
              self: `${shownOrigin}/api/abs`,
              pages: [{ [`${LEFT}/key`]: `${shownOrigin}/p/2` }],
              other: `${LEFT}0/x`,
            },
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
  // Per left capture: the text, the request body, two reply values and the text body. Never a field name, never another port.
  expect(comparison.addresses_applied).toEqual([
    { from: LEFT, to: RIGHT, values: 10 },
  ]);
  expect(comparison.renames_applied).toEqual([]);
  // The table shows what the application gave at its own address.
  const table = describeScenarioBehavior([await readCapture(LEFT, left)]);
  expect(JSON.stringify(table)).toContain(`Share ${LEFT}/help`);
  // A clone that prints the original's address, or a template it never filled in, is not printing its own.
  for (const shownOrigin of [LEFT, "{origin}", ""]) {
    const copied = await compare([left, left], [printed(RIGHT, shownOrigin)]);
    expect(brief(copied, "read")).toEqual([
      "changed",
      "text/value - -",
      "request/value - POST /api/links#1",
      "body/value - /self",
      "body/value - /pages/0/http:~1~1127.0.0.1:4101~1key",
      "body/value - ",
    ]);
    // The finding shows the left value as it was compared: at the right's address.
    expect(stepOf(copied, "read").findings[2]).toMatchObject({
      expected: `"${RIGHT}/api/abs"`,
      actual: `"${shownOrigin}/api/abs"`,
    });
  }
  // Two captures of one address print one address: nothing is read as another.
  const same = compareScenarioBehaviorCaptures({
    left: [await readCapture(LEFT, left)],
    right: [await readCapture(LEFT, left)],
    renames: [],
    volatile_fields: [],
  });
  if (!same.ok) throw same.error;
  expect(same.value.verdict).toBe("unchanged");
  expect(same.value).not.toHaveProperty("addresses_applied");
});

it("reads the left's bare host and port as the right's, and no address that only resembles it", async () => {
  const hostOf = (origin: string): string => origin.replace("http://", "");
  const served = (shownHost: string, extra = "files.example:4101"): Step[] => [
    list,
    {
      id: "read",
      text: `Served from ${shownHost}`,
      calls: [
        {
          line: "GET /api/addr",
          reply: {
            json: {
              host: shownHost,
              socket: `ws://${shownHost}/live`,
              self: `http://${shownHost}/api/addr`,
              extra,
            },
          },
        },
      ],
    },
  ];
  const left = served(hostOf(LEFT));
  const comparison = await compare([left, left], [served(hostOf(RIGHT))]);
  expect(comparison.verdict).toBe("unchanged");
  // Per left capture: the text and two values by host and port, one value by origin.
  expect(comparison.addresses_applied).toEqual([
    { from: LEFT, to: RIGHT, values: 2 },
    { from: hostOf(LEFT), to: hostOf(RIGHT), values: 6 },
  ]);
  const wrong = async (right: Step[]) =>
    brief(await compare([left, left], [right, right]), "read");
  // A clone that prints the original's host and port, or its own port at another host.
  expect(await wrong(served(hostOf(LEFT)))).toEqual([
    "changed",
    "text/value - -",
    "body/value - /host",
    "body/value - /socket",
    "body/value - /self",
  ]);
  expect(await wrong(served("203.0.113.9:4202"))).toEqual([
    "changed",
    "text/value - -",
    "body/value - /host",
    "body/value - /socket",
    "body/value - /self",
  ]);
  // Another server's address is not the left's own: a longer port, a host that ends like it, the same port elsewhere.
  for (const [other, cloned] of [
    ["127.0.0.1:41019", "127.0.0.1:42029"],
    ["10.127.0.0.1:4101", "10.127.0.0.1:4202"],
    ["files.example:4101", "files.example:4202"],
  ] as const)
    expect(
      brief(
        await compare(
          [served(hostOf(LEFT), other), served(hostOf(LEFT), other)],
          [served(hostOf(RIGHT), cloned)],
        ),
        "read",
      ),
    ).toEqual(["changed", "body/value - /extra"]);
});

it("reads each left capture's own address as the right's first, and maps nothing on the right", async () => {
  const shown = (origin: string): Step[] => [
    list,
    { id: "read", text: `You are at ${origin}` },
  ];
  const compared = async (
    left: readonly string[],
    right: readonly string[],
  ): Promise<ScenarioBehaviorComparison> => {
    const read = (origins: readonly string[]) =>
      Promise.all(origins.map((origin) => readCapture(origin, shown(origin))));
    const result = compareScenarioBehaviorCaptures({
      left: await read(left),
      right: await read(right),
      renames: [],
      volatile_fields: [],
    });
    if (!result.ok) throw result.error;
    return result.value;
  };
  const twoLeft = await compared([LEFT, ELSEWHERE], [RIGHT, RIGHT]);
  expect(twoLeft.verdict).toBe("unchanged");
  expect(twoLeft.addresses_applied).toEqual([
    { from: LEFT, to: RIGHT, values: 1 },
    { from: ELSEWHERE, to: RIGHT, values: 1 },
  ]);
  expect(twoLeft.limitations).toEqual([
    `The left captures started at more than one origin; the own address of each is read as ${RIGHT}.`,
  ]);
  // A right side at two addresses prints two texts: it disagrees with itself and is never a match.
  const twoRight = await compared([LEFT, LEFT], [RIGHT, ELSEWHERE]);
  expect(brief(twoRight, "read")).toEqual([
    "unstable",
    "text/repeats-differ right -",
  ]);
  expect(twoRight.limitations).toContainEqual(
    expect.stringContaining("right captures started at more than one origin"),
  );
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

it("honours a `*` declaration only at the list positions where the left's own repeats differ", async () => {
  // A fresh item with a generated id at position 0, a seeded one at position 1.
  const items = (...ids: string[]): Step[] =>
    json({ items: ids.map((id) => ({ id, label: "item" })) });
  const left = [items("0a1b", "seed-1"), items("2c3d", "seed-1")];
  const wrong = [items("4e5f", "WRONG-9"), items("6a7b", "WRONG-9")];
  for (const step_id of ["read", "*"]) {
    const comparison = await compare(left, wrong, {
      volatile_fields: [{ step_id, pointer: "/items/*/id" }],
    });
    expect(comparison.verdict).toBe("unknown");
    expect(stepOf(comparison, "read").findings).toEqual([
      {
        dimension: "body",
        category: "declared-not-shown",
        request: "GET /api/thing#1",
        pointer: "/items/*/id",
        expected: '"seed-1"',
        actual: '"WRONG-9"',
        side: "left",
      },
    ]);
    expect(comparison.limitations).toEqual([
      'Reply lists are compared position by position, also under a declared "*" pointer: /items/*/id at step read differs between the sides at a position where the left\'s captures agree. A list whose order varies between captures has to be requested in a fixed order.',
    ]);
  }
  // Declared for the varying position only, the steady one is the clone's difference.
  expect(
    brief(
      await compare(left, wrong, {
        volatile_fields: [{ step_id: "read", pointer: "/items/0/id" }],
      }),
      "read",
    ),
  ).toEqual(["changed", "body/value - /items/1/id"]);
  // A value of another shape at the steady position is a difference under the pattern too.
  expect(
    brief(
      await compare(left, [items("4e5f", "seed 1")], {
        volatile_fields: [{ step_id: "read", pointer: "/items/*/id" }],
      }),
      "read",
    ),
  ).toEqual(["changed", "body/value - /items/1/id"]);
  // The clone that holds the steady value at the steady position compares.
  const right = await compare(left, [items("4e5f", "seed-1")], {
    volatile_fields: [{ step_id: "read", pointer: "/items/*/id" }],
  });
  expect(right.verdict).toBe("unchanged");
  expect(right.limitations).toEqual([
    expect.stringContaining("right side has one capture"),
  ]);
  expect(right.volatile_fields).toEqual([
    {
      step_id: "read",
      side: "left",
      pointer: "/items/*/id",
      declared: true,
      honoured: true,
    },
  ]);
});

it("judges a list in varying order position by position, declared or not", async () => {
  const items = (...ids: string[]): Step[] =>
    json(ids.map((id) => ({ id, kind: "bee" })));
  // The left's two orders coincide at position 1.
  const left = [items("a", "b", "c"), items("c", "b", "a")];
  const volatile_fields = [{ step_id: "read", pointer: "/*/id" }];
  const hint = expect.stringContaining(
    "/*/id at step read differs between the sides at a position where the left's captures agree",
  );
  // Declared: honoured where the left varies, not shown volatile where its captures coincide. Never a match.
  const shuffled = await compare(left, [items("b", "c", "a")], {
    volatile_fields,
  });
  expect(brief(shuffled, "read")).toEqual([
    "unknown",
    "body/declared-not-shown left /*/id",
  ]);
  expect(shuffled.limitations).toContainEqual(hint);
  // Undeclared: the coinciding position is a difference beside the unstable ones, with the same advice.
  const undeclared = await compare(left, [items("b", "c", "a")]);
  expect(brief(undeclared, "read")).toEqual([
    "changed",
    "body/value - /1/id",
    "body/undeclared-volatile left /*/id",
  ]);
  expect(undeclared.limitations).toContainEqual(hint);
  // A right side that agrees at the coinciding position compares once the pattern is declared.
  expect(
    (await compare(left, [items("x", "b", "y")], { volatile_fields })).verdict,
  ).toBe("unchanged");
  // An extra item, a value of another shape and an undeclared field are differences.
  for (const right of [
    items("b", "c", "a", "d"),
    items("x", "long id", "y"),
    json([
      { id: "x", kind: "bee" },
      { id: "b", kind: "wasp" },
      { id: "y", kind: "bee" },
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
