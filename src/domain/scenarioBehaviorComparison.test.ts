import { expect, it } from "vitest";

import type { JsonValue } from "./jsonValue.js";
import {
  jsonLeaves,
  judgeReplyLeaves,
  orderScenarioFindings,
  renameScenarioText,
  replyBodyExpected,
  scenarioBehaviorExitCode,
  scenarioBehaviorVerdict,
  scenarioBehaviorVolatileFieldSchema,
  scenarioFindingStatus,
  scenarioStartState,
  scenarioStepKind,
  scenarioStepStatus,
  volatilePointerMatches,
  volatilePointerPattern,
  volatileValueShape,
} from "./scenarioBehaviorComparison.js";

/** Judge replies given as JSON, with the declared pointers of one step. */
const judge = (
  left: readonly JsonValue[],
  right: readonly JsonValue[],
  declared: readonly string[] = [],
) =>
  judgeReplyLeaves(left.map(jsonLeaves), right.map(jsonLeaves), (leaf) =>
    declared.some((pointer) => volatilePointerMatches(pointer, leaf.path)),
  ).map(({ pointer, outcome, varies }) => ({ pointer, outcome, varies }));

it("reads a step's part from its id", () => {
  expect(scenarioStepKind("fp-notes")).toBe("fingerprint");
  expect(scenarioStepKind("setup-open")).toBe("setup");
  expect(scenarioStepKind("scenario_start")).toBe("setup");
  expect(scenarioStepKind("rea-tree-0")).toBe("reserved");
  expect(scenarioStepKind("create-empty-title")).toBe("behavior");
});

it("never lets missing data or one capture read as a match", () => {
  expect(scenarioBehaviorVerdict(["unchanged", "unknown"])).toBe("unknown");
  expect(scenarioBehaviorVerdict(["unstable", "unchanged"])).toBe("unknown");
  expect(scenarioBehaviorVerdict(["unknown", "changed"])).toBe("changed");
  expect(scenarioBehaviorVerdict(["unchanged"])).toBe("unchanged");
  expect(scenarioBehaviorExitCode("unchanged")).toBe(0);
  expect(scenarioBehaviorExitCode("changed")).toBe(1);
  expect(scenarioBehaviorExitCode("unknown")).toBe(2);
  expect(scenarioStartState(["a", "a"])).toBe("clean");
  expect(scenarioStartState(["a", null, "a"])).toBe("clean");
  expect(scenarioStartState(["a", "b"])).toBe("dirty");
  expect(scenarioStartState(["a", "a", "b"])).toBe("dirty");
  expect(scenarioStartState(["a"])).toBe("unknown");
  expect(scenarioStartState(["a", null])).toBe("unknown");
  expect(scenarioStartState([])).toBe("unknown");
});

it("expects no body where a reply cannot carry one", () => {
  expect(replyBodyExpected("GET", 200)).toBe(true);
  expect(replyBodyExpected("POST", 422)).toBe(true);
  expect(replyBodyExpected("head", 200)).toBe(false);
  expect(replyBodyExpected("GET", 204)).toBe(false);
  expect(replyBodyExpected("GET", 302)).toBe(false);
  expect(replyBodyExpected("GET", 304)).toBe(false);
});

it("keeps the type and layout of a volatile value comparable", () => {
  expect(volatileValueShape("2026-11-20T01:00:00.000Z")).toBe(
    volatileValueShape("2027-01-02T23:59:59.5Z"),
  );
  expect(volatileValueShape("3f2a9c1e-0000-4000-8000-000000000001")).toBe(
    "string:x-x-x-x-x",
  );
  expect(volatileValueShape("2026-11-20T01:00:00Z")).not.toBe(
    volatileValueShape(1_795_000_000),
  );
  expect(volatileValueShape(7)).toBe("number");
  expect(volatileValueShape(null)).toBe("null");
  expect(volatileValueShape([])).toBe("array");
  expect(volatileValueShape({})).toBe("object");
});

it("lets a volatile declaration name one leaf only", () => {
  const accepts = (pointer: string) =>
    scenarioBehaviorVolatileFieldSchema.safeParse({
      step_id: "create",
      pointer,
    }).success;
  expect(accepts("/createdAt")).toBe(true);
  expect(accepts("/items/*/id")).toBe(true);
  expect(accepts("")).toBe(false);
  expect(accepts("createdAt")).toBe(false);
});

it("folds findings to the worst status and lists the worst first", () => {
  expect(scenarioFindingStatus({ category: "not-recorded" })).toBe("unknown");
  expect(scenarioFindingStatus({ category: "single-observation" })).toBe(
    "unknown",
  );
  expect(scenarioFindingStatus({ category: "declared-not-shown" })).toBe(
    "unknown",
  );
  expect(scenarioFindingStatus({ category: "not-completed" })).toBe("unknown");
  expect(scenarioFindingStatus({ category: "other-origin" })).toBe("unknown");
  expect(scenarioFindingStatus({ category: "repeats-differ" })).toBe(
    "unstable",
  );
  expect(scenarioFindingStatus({ category: "undeclared-volatile" })).toBe(
    "unstable",
  );
  for (const category of ["value", "status", "missing-step", "shape"])
    expect(scenarioFindingStatus({ category })).toBe("changed");
  expect(scenarioStepStatus([])).toBe("unchanged");
  expect(scenarioStepStatus([{ category: "not-recorded" }])).toBe("unknown");
  expect(
    scenarioStepStatus([
      { category: "not-recorded" },
      { category: "repeats-differ" },
    ]),
  ).toBe("unstable");
  expect(
    scenarioStepStatus([
      { category: "repeats-differ" },
      { category: "value" },
      { category: "not-recorded" },
    ]),
  ).toBe("changed");
  expect(
    orderScenarioFindings([
      { category: "not-recorded" },
      { category: "repeats-differ" },
      { category: "value" },
      { category: "other-origin" },
    ]).map(({ category }) => category),
  ).toEqual(["value", "repeats-differ", "not-recorded", "other-origin"]);
});

it("reads a JSON value as leaves that tell an array item from an object member of the same spelling", () => {
  const leaves = (value: JsonValue) =>
    jsonLeaves(value).map(({ pointer, path }) => [pointer, path]);
  // The pointer alone is the same for both; the path is not.
  expect(leaves({ items: ["x"] })).toEqual([["/items/0", ["items", 0]]]);
  expect(leaves({ items: { "0": "x" } })).toEqual([
    ["/items/0", ["items", "0"]],
  ]);
});

it("never judges an array equal to an object with index-like keys", () => {
  const pairs: readonly (readonly [JsonValue, JsonValue])[] = [
    [{ items: ["x", "y"] }, { items: { "0": "x", "1": "y" } }],
    [["x", "y"], { "0": "x", "1": "y" }],
    [{ rows: [{ tags: ["a"] }] }, { rows: [{ tags: { "0": "a" } }] }],
  ];
  for (const [array, object] of pairs) {
    const judged = [
      ...judge([array, array], [object, object]),
      ...judge([object], [array]),
    ];
    expect(judged.length).toBeGreaterThan(0);
    expect(judged.every(({ outcome }) => outcome === "changed")).toBe(true);
  }
  // The same container kinds with the same values are still equal.
  expect(judge([{ items: ["x"] }], [{ items: ["x"] }])).toEqual([]);
});

it("compares the kinds of containers before any declaration, and tells the difference at the container", () => {
  const kinds = (
    left: readonly JsonValue[],
    right: readonly JsonValue[],
    declared: readonly string[],
  ) =>
    judgeReplyLeaves(left.map(jsonLeaves), right.map(jsonLeaves), (leaf) =>
      declared.some((pointer) => volatilePointerMatches(pointer, leaf.path)),
    ).map((judgement) => [
      judgement.pointer,
      judgement.outcome,
      judgement.kinds,
    ]);
  const recast = (
    pointer: string,
    expected: "array" | "object",
    actual: "array" | "object",
    outcome = "changed",
  ) => [[pointer, outcome, { pointer, expected, actual }]];
  // Every leaf beneath varies on the left and is declared: the list is still not an object.
  expect(
    kinds(
      [{ ids: ["a", "b"] }, { ids: ["c", "d"] }],
      [{ ids: { "0": "e", "1": "f" } }, { ids: { "0": "g", "1": "h" } }],
      ["/ids/*"],
    ),
  ).toEqual(recast("/ids", "array", "object"));
  // The other way round, declared by its index, and at the root.
  expect(
    kinds([{ m: { "0": "a" } }, { m: { "0": "b" } }], [{ m: ["x"] }], ["/m/0"]),
  ).toEqual(recast("/m", "object", "array"));
  expect(
    kinds([[{ id: "a" }], [{ id: "b" }]], [{ "0": { id: "z" } }], ["/*/id"]),
  ).toEqual(recast("", "array", "object"));
  // The outermost container that differs stands for everything inside it.
  expect(kinds([[["a"]]], [{ "0": { "0": "a" } }], [])).toEqual(
    recast("", "array", "object"),
  );
  // A list that is empty in one left repeat is a list in both: an empty object is another kind, whatever is declared.
  const sometimesEmpty = [{ a: ["x1"] }, { a: [] }];
  expect(kinds(sometimesEmpty, [{ a: {} }], ["/a", "/a/*"])).toEqual(
    recast("/a", "array", "object"),
  );
  expect(kinds([{ a: [] }], [{ a: { k: 1 } }], [])).toEqual(
    recast("/a", "array", "object"),
  );
  // The control: an empty list on the right is covered by the same declarations.
  expect(
    kinds(sometimesEmpty, [{ a: [] }], ["/a", "/a/*"]).map(
      ([pointer, outcome]) => [pointer, outcome],
    ),
  ).toEqual([
    ["/a/0", "honoured"],
    ["/a", "honoured"],
  ]);
  // A side whose own repeats answer with either kind disagrees with itself, declared or not.
  const either = [{ items: ["x"] }, { items: { "0": "x" } }];
  for (const declared of [[], ["/items/0"], ["/items/*"]]) {
    expect(kinds(either, [], declared)).toEqual(
      recast("/items", "array", "object", "left-unsteady"),
    );
    expect(kinds(either, [{ items: ["y"] }], declared)).toEqual(
      recast("/items", "array", "object", "left-unsteady"),
    );
    expect(kinds([either[0]!, either[0]!], either, declared)).toEqual(
      recast("/items", "array", "object", "right-unsteady"),
    );
  }
});

it("compares the presence, JSON type and layout of an honoured leaf as far as the left's own values share them", () => {
  const outcome = (
    left: readonly JsonValue[],
    right: JsonValue,
    pointer: string,
  ) => judge(left, [right], [pointer]).map((judged) => judged.outcome);
  // Held in one left repeat only: the right may lack it, and may not hold another JSON type or layout.
  const sometimes = [{ n: 1, at: "2026-01-01" }, { n: 1 }];
  expect(outcome(sometimes, { n: 1 }, "/at")).toEqual(["honoured"]);
  expect(outcome(sometimes, { n: 1, at: "2027-12-31" }, "/at")).toEqual([
    "honoured",
  ]);
  expect(outcome(sometimes, { n: 1, at: 12_345 }, "/at")).toEqual(["shape"]);
  expect(outcome(sometimes, { n: 1, at: "soon" }, "/at")).toEqual(["shape"]);
  // null or a text on the left covers either of the two, never a number or a list.
  const nullable = [{ at: null }, { at: "2026-01-01" }];
  expect(outcome(nullable, { at: null }, "/at")).toEqual(["honoured"]);
  expect(outcome(nullable, { at: "any text" }, "/at")).toEqual(["honoured"]);
  expect(outcome(nullable, { at: 7 }, "/at")).toEqual(["shape"]);
  expect(outcome(nullable, { at: [] }, "/at")).toEqual(["shape"]);
  // Held in every left repeat with layouts that differ: any text is covered, a right reply without the leaf is not.
  const free = [
    { n: 1, note: "a b" },
    { n: 1, note: "c-d e" },
  ];
  expect(outcome(free, { n: 1, note: "x y z" }, "/note")).toEqual(["honoured"]);
  expect(outcome(free, { n: 1, note: 5 }, "/note")).toEqual(["shape"]);
  expect(outcome(free, { n: 1 }, "/note")).toEqual(["shape"]);
});

it("reads a JSON value as leaves in document order, with the pattern a declaration would use", () => {
  expect(
    jsonLeaves({ a: [1, { "b/c": null }], d: {}, e: [] }).map((leaf) => [
      leaf.pointer,
      leaf.value,
    ]),
  ).toEqual([
    ["/a/0", 1],
    ["/a/1/b~1c", null],
    ["/d", {}],
    ["/e", []],
  ]);
  expect(jsonLeaves("text")).toEqual([
    { pointer: "", path: [], value: "text" },
  ]);
  expect(volatilePointerPattern(["items", 3, "id"])).toBe("/items/*/id");
  expect(volatilePointerMatches("/items/*/id", ["items", 3, "id"])).toBe(true);
  expect(volatilePointerMatches("/items/3/id", ["items", 3, "id"])).toBe(true);
  // A `*` stands for an array index, never for a field name.
  expect(volatilePointerMatches("/items/*/id", ["items", "x", "id"])).toBe(
    false,
  );
  // A container declaration never reaches the leaves beneath it.
  expect(volatilePointerMatches("/items", ["items", 3, "id"])).toBe(false);
});

it("calls a leaf changed only when the left holds it steadily", () => {
  expect(
    judge(
      [{ slug: "hello-world" }, { slug: "hello-world" }],
      [{ slug: "hello_world" }, { slug: "hello_world" }],
    ),
  ).toEqual([{ pointer: "/slug", outcome: "changed", varies: [] }]);
  // Equal everywhere: nothing to report.
  expect(judge([{ a: 1 }, { a: 1 }], [{ a: 1 }])).toEqual([]);
  // A missing or an extra field is a difference at that leaf.
  expect(judge([{ a: 1, b: 2 }], [{ a: 1, c: 3 }])).toEqual([
    { pointer: "/b", outcome: "changed", varies: [] },
    { pointer: "/c", outcome: "changed", varies: [] },
  ]);
  // An absent member and null are not the same reply.
  expect(judge([{}], [{ a: null }])).toEqual([
    { pointer: "", outcome: "changed", varies: [] },
    { pointer: "/a", outcome: "changed", varies: [] },
  ]);
  // A right side none of whose repeats agrees with the left is a difference, steady or not.
  expect(judge([{ n: 1 }, { n: 1 }], [{ n: 3 }, { n: 2 }])).toEqual([
    { pointer: "/n", outcome: "changed", varies: ["right"] },
  ]);
});

it("calls a right side that agrees with the left in one repeat unsteady, not changed", () => {
  expect(judge([{ n: 1 }, { n: 1 }], [{ n: 1 }, { n: 2 }])).toEqual([
    { pointer: "/n", outcome: "right-unsteady", varies: ["right"] },
  ]);
  // The same with one left reply, and for a leaf only one right repeat holds.
  expect(judge([{ n: 1 }], [{ n: 2 }, { n: 1 }])).toEqual([
    { pointer: "/n", outcome: "right-unsteady", varies: ["right"] },
  ]);
  expect(judge([{}, {}], [{}, { extra: 1 }])).toEqual([
    { pointer: "", outcome: "right-unsteady", varies: ["right"] },
    { pointer: "/extra", outcome: "right-unsteady", varies: ["right"] },
  ]);
});

it("calls what the left's own repeats disagree on unstable, never changed", () => {
  expect(
    judge(
      [
        { at: "10:00", n: 1 },
        { at: "10:01", n: 1 },
      ],
      [{ at: "x", n: 1 }],
    ),
  ).toEqual([{ pointer: "/at", outcome: "unstable", varies: ["left"] }]);
  // A leaf present in one repeat and absent in another disagrees.
  expect(judge([{ items: [1] }, { items: [1, 2] }], [{ items: [1] }])).toEqual([
    { pointer: "/items/1", outcome: "unstable", varies: ["left"] },
  ]);
});

it("honours a volatile declaration only where the left varies, and still compares the shape", () => {
  const left = [
    { id: "a1b2", createdAt: "2026-11-20T01:00:00.000Z", slug: "s" },
    { id: "c3d4", createdAt: "2026-11-20T01:00:05.250Z", slug: "s" },
  ];
  const declared = ["/id", "/createdAt", "/slug"];
  expect(
    judge(
      left,
      [{ id: "ffff", createdAt: "2027-01-01T00:00:00.000Z", slug: "s" }],
      declared,
    ),
  ).toEqual([
    { pointer: "/id", outcome: "honoured", varies: ["left"] },
    { pointer: "/createdAt", outcome: "honoured", varies: ["left"] },
  ]);
  // Another layout, another type and an absent leaf all break the shape.
  expect(
    judge(left, [{ id: 7, createdAt: "yesterday", slug: "s" }], declared),
  ).toEqual([
    { pointer: "/id", outcome: "shape", varies: ["left"] },
    { pointer: "/createdAt", outcome: "shape", varies: ["left"] },
  ]);
  expect(judge(left, [{ id: "ffff", slug: "s" }], declared)).toEqual([
    { pointer: "/id", outcome: "honoured", varies: ["left"] },
    { pointer: "/createdAt", outcome: "shape", varies: ["left"] },
  ]);
  // Declared, steady on the left and differing within its shape: not shown volatile, never a match.
  const right = { id: "ffff", createdAt: "2027-01-01T00:00:00.000Z" };
  expect(judge(left, [{ ...right, slug: "other" }], declared)).toContainEqual({
    pointer: "/slug",
    outcome: "declared-not-shown",
    varies: [],
  });
  // Another shape, an absent leaf or no declaration leave it a difference.
  for (const [slug, names] of [
    [{ slug: "two words" }, declared],
    [{ slug: 7 }, declared],
    [{}, declared],
    [{ slug: "other" }, ["/id", "/createdAt"]],
  ] as const)
    expect(judge(left, [{ ...right, ...slug }], names)).toContainEqual({
      pointer: "/slug",
      outcome: "changed",
      varies: [],
    });
  // A declaration on the container covers none of its leaves.
  expect(
    judge(
      [{ note: { id: "a" } }, { note: { id: "b" } }],
      [{ note: { id: "c" } }],
      ["/note"],
    ),
  ).toEqual([{ pointer: "/note/id", outcome: "unstable", varies: ["left"] }]);
  // With one left reply nothing varies, so nothing is honoured: a declared leaf is unknown, another a difference.
  expect(judge([left[0]!], [{ ...left[0]!, id: "ffff" }], declared)).toEqual([
    { pointer: "/id", outcome: "single-observation", varies: [] },
  ]);
  expect(judge([left[0]!], [{ ...left[0]!, id: "ffff" }])).toEqual([
    { pointer: "/id", outcome: "changed", varies: [] },
  ]);
});

it("honours a declared pattern only at the positions where the left's own repeats differ", () => {
  // A fresh item and a seeded one: the pattern varies at position 0 and is steady at position 1.
  const left = [
    [{ id: "u-1" }, { id: "seed-1" }],
    [{ id: "u-2" }, { id: "seed-1" }],
  ];
  const wrong = [
    [{ id: "u-3" }, { id: "WRONG-9" }],
    [{ id: "u-4" }, { id: "WRONG-9" }],
  ];
  expect(judge(left, wrong, ["/*/id"])).toEqual([
    { pointer: "/0/id", outcome: "honoured", varies: ["left", "right"] },
    { pointer: "/1/id", outcome: "declared-not-shown", varies: [] },
  ]);
  // Declared by its position or by the pattern, the steady position reads the same.
  expect(judge(left, wrong, ["/0/id", "/1/id"])).toEqual(
    judge(left, wrong, ["/*/id"]),
  );
  // Only the varying position declared: the steady one is a difference.
  expect(judge(left, wrong, ["/0/id"])).toContainEqual({
    pointer: "/1/id",
    outcome: "changed",
    varies: [],
  });
  // A right side that holds the steady value there is equal.
  expect(
    judge(left, [[{ id: "u-3" }, { id: "seed-1" }]], ["/*/id"]),
  ).toEqual([{ pointer: "/0/id", outcome: "honoured", varies: ["left"] }]);
  // A list in varying order: the position where two captures coincide is not covered by its neighbours.
  const shuffled = [
    [{ id: "a" }, { id: "b" }, { id: "c" }],
    [{ id: "c" }, { id: "b" }, { id: "a" }],
  ];
  const right = [[{ id: "b" }, { id: "c" }, { id: "a" }]];
  expect(judge(shuffled, right, ["/*/id"])).toEqual([
    { pointer: "/0/id", outcome: "honoured", varies: ["left"] },
    { pointer: "/1/id", outcome: "declared-not-shown", varies: [] },
    { pointer: "/2/id", outcome: "honoured", varies: ["left"] },
  ]);
  // Undeclared, or of another shape, the coinciding position is a difference.
  expect(judge(shuffled, right)).toContainEqual({
    pointer: "/1/id",
    outcome: "changed",
    varies: [],
  });
  expect(
    judge(shuffled, [[{ id: "b" }, { id: 7 }, { id: "a" }]], ["/*/id"]),
  ).toContainEqual({ pointer: "/1/id", outcome: "changed", varies: [] });
  // An item the left never holds is a difference.
  expect(
    judge(shuffled, [[...right[0]!, { id: "d" }]], ["/*/id"]),
  ).toContainEqual({ pointer: "/3/id", outcome: "changed", varies: [] });
});

it("renames every occurrence in declaration order and counts the values it changed", () => {
  const renames = [
    { from: "Acme", to: "Zenith" },
    { from: "Zenith Notes", to: "Jotter" },
  ];
  const counts: number[] = [];
  expect(renameScenarioText("Acme Notes by Acme", renames, counts)).toBe(
    "Jotter by Zenith",
  );
  expect(renameScenarioText("acme", renames, counts)).toBe("acme");
  expect(counts).toEqual([1, 1]);
  // A replacement is literal text, not a pattern.
  expect(renameScenarioText("a", [{ from: "a", to: "$&$&" }], [])).toBe("$&$&");
});
