import { expect, it } from "vitest";

import {
  scenarioFindingStatus,
  type ScenarioBehaviorFinding,
} from "../scenarioBehaviorComparison.js";
import {
  CLONE_RUN_PREPARED_STEP_GATES,
  CLONE_RUN_STEP_FINDING_LIMIT,
  cloneRunBlockingFindings,
  cloneRunBlockingStatus,
  cloneRunGapShared,
  cloneRunStepFindingsCut,
  volatileDeclarationCovers,
} from "./cloneRunStepGate.js";

const finding = (
  category: string,
  rest: Partial<ScenarioBehaviorFinding> = {},
): ScenarioBehaviorFinding => ({
  dimension: "body",
  category,
  request: "GET /api/plan#1",
  pointer: "/plan",
  expected: null,
  actual: null,
  side: null,
  ...rest,
});

const PREPARED = ["setup", "fingerprint"] as const;

/** The categories the comparer reads as a gap or as one side disagreeing with itself. */
const GAPS = [
  "not-recorded",
  "single-observation",
  "declared-not-shown",
  "not-completed",
  "other-origin",
];
const REPEATS = ["repeats-differ", "undeclared-volatile"];

it("gives every category the comparer does not read as a difference a row, and reads every other as one", () => {
  // A gap or repeat category without a row would block by default; a row for a category the comparer reads otherwise would be stale.
  for (const category of [...GAPS, ...REPEATS]) {
    expect(scenarioFindingStatus({ category })).not.toBe("changed");
    expect(CLONE_RUN_PREPARED_STEP_GATES[category]).toBeDefined();
  }
  for (const [category, gate] of Object.entries(
    CLONE_RUN_PREPARED_STEP_GATES,
  )) {
    const status = scenarioFindingStatus({ category });
    if (!GAPS.includes(category) && !REPEATS.includes(category)) {
      expect(status).toBe("changed");
      expect(gate).toBe("blocks");
    }
    // Only one side disagreeing with itself is ungated outright.
    if (gate === "ungated") expect(status).toBe("unstable");
  }
});

it("blocks a behaviour step on every finding", () => {
  for (const category of [...GAPS, ...REPEATS, "value", "length"]) {
    const findings = [finding(category, { side: "left" })];
    expect(cloneRunBlockingFindings("behavior", findings)).toEqual(findings);
  }
});

it("blocks a setup or fingerprint step wherever the original is steady and the clone differs", () => {
  for (const kind of PREPARED) {
    const blocks = (found: ScenarioBehaviorFinding): boolean =>
      cloneRunBlockingFindings(kind, [found]).length === 1;
    // A difference between the sides, by the comparer's own categories and the differ's.
    for (const category of ["value", "status", "shape", "missing-step"])
      expect(blocks(finding(category))).toBe(true);
    for (const category of ["type", "length", "order", "missing", "extra"])
      expect(blocks(finding(category))).toBe(true);
    // A category nobody has named yet blocks until it is given a row.
    expect(blocks(finding("a-category-of-tomorrow"))).toBe(true);
    // The original gave one value over its replies and the clone another: a declaration does not turn that into a gap.
    expect(
      blocks(
        finding("declared-not-shown", {
          side: "left",
          expected: '"free"',
          actual: '"enterprise"',
        }),
      ),
    ).toBe(true);
    // One observation of the original that no capture of the clone agrees with.
    expect(
      blocks(
        finding("single-observation", {
          side: "left",
          expected: '"free"',
          actual: '"enterprise"',
        }),
      ),
    ).toBe(true);
    // A step that did not complete compares nothing, on either side.
    for (const side of ["left", "right"] as const)
      expect(
        blocks(
          finding("not-completed", {
            dimension: "step",
            request: null,
            pointer: null,
            side,
          }),
        ),
      ).toBe(true);
    // One side disagreeing with itself shows no steady difference.
    for (const side of ["left", "right"] as const)
      expect(blocks(finding("repeats-differ", { side }))).toBe(false);
    expect(blocks(finding("undeclared-volatile", { side: "left" }))).toBe(
      false,
    );
  }
});

it("lets a gap pass on a setup or fingerprint step only when both sides show it", () => {
  const body = (side: "left" | "right" | null, request = "GET /export.csv#1") =>
    finding("not-recorded", { side, request, pointer: null });
  const origin = (side: "left" | "right", request: string) =>
    finding("other-origin", {
      dimension: "request",
      side,
      request,
      pointer: null,
    });
  for (const kind of PREPARED) {
    const blocking = (found: readonly ScenarioBehaviorFinding[]) =>
      cloneRunBlockingFindings(kind, found);
    // A download, or a reply over the limit on both sides: no capture can hold it.
    expect(blocking([body("left"), body("right")])).toEqual([]);
    // Recorded on one side and never on the other: a reply over the limit on one side only, or a side that does not answer.
    expect(blocking([body("right")])).toEqual([body("right")]);
    expect(blocking([body("left")])).toEqual([body("left")]);
    // The same gap of another request, or of another dimension, is not the same gap.
    expect(blocking([body("left"), body("right", "GET /other#1")])).toHaveLength(
      2,
    );
    expect(
      blocking([
        body("left"),
        finding("not-recorded", {
          dimension: "status",
          side: "right",
          request: "GET /export.csv#1",
          pointer: null,
        }),
      ]),
    ).toHaveLength(2);
    // A gap that names no side cannot be shown to be shared.
    expect(blocking([body(null), body("right")])).toHaveLength(2);
    // A third party both pages talk to, whatever the request lines.
    expect(
      blocking([
        origin("left", "GET https://stats.example/beacon?t=1#1"),
        origin("right", "GET https://stats.example/beacon?t=2#1"),
      ]),
    ).toEqual([]);
    // A server only one side talks to: the clone's own, or one the clone leaves out.
    const cloneOnly = origin("right", "GET http://127.0.0.1:4631/api/notes#1");
    expect(
      blocking([origin("left", "GET https://stats.example/b#1"), cloneOnly]),
    ).toEqual([origin("left", "GET https://stats.example/b#1"), cloneOnly]);
    expect(blocking([cloneOnly])).toEqual([cloneOnly]);
    // A request that does not read as a request line is only ever its own origin.
    expect(
      blocking([origin("left", "fetch request#1"), origin("right", "odd")]),
    ).toHaveLength(2);
  }
  expect(cloneRunGapShared(body("left"), [body("left"), body("right")])).toBe(
    true,
  );
  expect(cloneRunGapShared(body("left"), [body("left")])).toBe(false);
});

it("does not let an unsteady finding stand in front of one that blocks", () => {
  const unsteady = finding("repeats-differ", { side: "left", pointer: "/at" });
  const held = finding("declared-not-shown", { side: "left" });
  for (const kind of PREPARED) {
    expect(cloneRunBlockingFindings(kind, [unsteady, held])).toEqual([held]);
    expect(cloneRunBlockingFindings(kind, [unsteady])).toEqual([]);
  }
  // The item is filed under the worst status of what blocks, never under "unchanged".
  expect(cloneRunBlockingStatus([held])).toBe("unknown");
  expect(cloneRunBlockingStatus([unsteady, finding("value")])).toBe("changed");
  expect(cloneRunBlockingStatus([])).toBe("unknown");
});

it("reads a full finding list as one that may have been cut", () => {
  const listed = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      finding("undeclared-volatile", { side: "left", pointer: `/f${index}` }),
    );
  expect(
    cloneRunStepFindingsCut(listed(CLONE_RUN_STEP_FINDING_LIMIT - 1)),
  ).toBe(false);
  expect(cloneRunStepFindingsCut(listed(CLONE_RUN_STEP_FINDING_LIMIT))).toBe(
    true,
  );
});

it("matches a declaration to the pattern a finding reports, erring towards a match", () => {
  expect(volatileDeclarationCovers("/items/*/id", "/items/*/id")).toBe(true);
  expect(volatileDeclarationCovers("/items/0/id", "/items/*/id")).toBe(true);
  expect(volatileDeclarationCovers("/plan", "/plan")).toBe(true);
  expect(volatileDeclarationCovers("/plan", "/plans")).toBe(false);
  expect(volatileDeclarationCovers("/items/*/id", "/items/*/name")).toBe(
    false,
  );
  expect(volatileDeclarationCovers("/items", "/items/*/id")).toBe(false);
});
