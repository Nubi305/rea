import { expect, it } from "vitest";

import {
  cloneRunBlockingFindings,
  cloneRunStepFindingsCut,
} from "../../domain/cloneRun/cloneRunStepGate.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import {
  ELSEWHERE,
  compare,
  list,
  stepOf,
  type Call,
  type Reply,
  type Step,
} from "../scenarioBehavior/scenarioBehaviorCapture.fixture.js";

/**
 * The referee's step gate against what the comparer really emits: for each
 * row of the table in `cloneRunStepGate.ts`, captures built as a real capture
 * records them, compared by the real comparer, and the question of whether a
 * `setup-` step is blocked by the result. A wrong clone must not get past the
 * gate by a prefix, a declaration or a scenario edit.
 */

const SETUP = "setup-read-plan";

const setup = (calls: readonly Call[], rest: Partial<Step> = {}): Step[] => [
  list,
  { id: SETUP, calls, ...rest },
];
const plan = (reply: Reply): Step[] =>
  setup([{ line: "GET /api/plan", reply }]);
const json = (value: JsonValue): Step[] => plan({ json: value });

/** The categories the comparer lists for the setup step, and those the gate blocks on. */
const gated = async (
  left: readonly (readonly Step[])[],
  right: readonly (readonly Step[])[],
  declared: readonly string[] = [],
) => {
  const step = stepOf(
    await compare(left, right, {
      volatile_fields: declared.map((pointer) => ({
        step_id: SETUP,
        pointer,
      })),
    }),
    SETUP,
  );
  return {
    status: step.status,
    listed: step.findings.map(({ category }) => category),
    blocking: cloneRunBlockingFindings("setup", step.findings).map(
      ({ category }) => category,
    ),
    cut: cloneRunStepFindingsCut(step.findings),
  };
};

it("blocks a setup step whose steady wrong reply field is declared volatile", async () => {
  const free = json({ plan: "free" });
  const enterprise = json({ plan: "enterprise" });
  // Without the declaration it is a difference; with it, a difference waiting for one more capture.
  expect(await gated([free, free], [enterprise, enterprise])).toMatchObject({
    status: "changed",
    blocking: ["value"],
  });
  expect(
    await gated([free, free], [enterprise, enterprise], ["/plan"]),
  ).toMatchObject({ status: "unknown", blocking: ["declared-not-shown"] });
  // One reply of the original recorded and one lost: one observation, which the clone contradicts.
  expect(
    await gated(
      [free, plan({ lost: "body-read-failed" })],
      [enterprise, enterprise],
      ["/plan"],
    ),
  ).toMatchObject({ status: "unknown", blocking: ["single-observation"] });
  // The declaration is honoured where the original really varies: nothing blocks, and a clone of another shape still does.
  const varying = [json({ plan: "a1" }), json({ plan: "b2" })];
  expect(
    await gated(
      varying,
      [json({ plan: "c3" }), json({ plan: "d4" })],
      ["/plan"],
    ),
  ).toMatchObject({ status: "unchanged", blocking: [] });
  expect(
    await gated(varying, [json({ plan: 7 }), json({ plan: 7 })], ["/plan"]),
  ).toMatchObject({ status: "changed", blocking: ["shape"] });
});

it("lets a setup step be unsteady, and lack what no capture of either side holds", async () => {
  const one = json({ at: "2026-01-01T00:00:00Z", plan: "free" });
  const two = json({ at: "2026-01-02T00:00:00Z", plan: "free" });
  // The original's own replies disagree and nothing names the field.
  expect(await gated([one, two], [one, one])).toMatchObject({
    status: "unstable",
    blocking: [],
  });
  // The clone disagrees with itself and one of its captures agrees with the original.
  expect(await gated([one, one], [one, two])).toMatchObject({
    status: "unstable",
    blocking: [],
  });
  // A body over the capture's limit on both sides: the stated exit for data a capture cannot record.
  const over = plan({ lost: "body-size-limit" });
  expect(await gated([over, over], [over, over])).toMatchObject({
    status: "unknown",
    listed: ["not-recorded", "not-recorded"],
    blocking: [],
  });
});

it("blocks a setup step on a gap only one side shows", async () => {
  const free = json({ plan: "free" });
  const over = plan({ lost: "body-size-limit" });
  // The clone's reply is over the limit where the original's is recorded: the padded wrong reply.
  expect(await gated([free, free], [over, over])).toMatchObject({
    status: "unknown",
    blocking: ["not-recorded"],
  });
  expect(await gated([over, over], [free, free])).toMatchObject({
    status: "unknown",
    blocking: ["not-recorded"],
  });
  // The clone never answers where the original does.
  const silent = setup([{ line: "GET /api/plan", status: null }]);
  expect((await gated([free, free], [silent, silent])).blocking).toContain(
    "not-recorded",
  );
  // The clone sends a request to a server the original does not talk to at this step.
  const elsewhere: Call = {
    line: "GET /api/plan-source",
    at: ELSEWHERE,
    reply: { json: {} },
  };
  const own: Call = { line: "GET /api/plan", reply: { json: { plan: "x" } } };
  expect(
    await gated(
      [setup([own]), setup([own])],
      [setup([own, elsewhere]), setup([own, elsewhere])],
    ),
  ).toMatchObject({ status: "unknown", blocking: ["other-origin"] });
  // Both pages talk to that server: nothing shows the sides differing there.
  expect(
    await gated(
      [setup([own, elsewhere]), setup([own, elsewhere])],
      [setup([own, elsewhere]), setup([own, elsewhere])],
    ),
  ).toMatchObject({ status: "unknown", blocking: [] });
});

it("blocks a setup step that did not complete on the original, whatever the clone did", async () => {
  const failed = setup([], { outcome: "failed" });
  const answered = json({ plan: "enterprise" });
  expect(await gated([failed, failed], [answered, answered])).toMatchObject({
    status: "unknown",
    blocking: ["not-completed"],
  });
  expect(await gated([failed, failed], [failed, failed])).toMatchObject({
    status: "unknown",
    blocking: ["not-completed"],
  });
});

it("sees that the comparer cut a list in which a blocking finding was left out", async () => {
  // Twenty-five fields the original's replies disagree on outrank the one declared field it holds steady.
  const fields = (seed: string, steady: string): JsonValue => ({
    ...Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [
        `f${String(index)}`,
        `${seed}${String(index)}`,
      ]),
    ),
    plan: steady,
  });
  const result = await gated(
    [json(fields("a", "free")), json(fields("b", "free"))],
    [json(fields("a", "enterprise")), json(fields("a", "enterprise"))],
    ["/plan"],
  );
  expect(result.status).toBe("unstable");
  // The difference held back by the declaration is not among the listed findings,
  expect(result.listed).not.toContain("declared-not-shown");
  expect(result.blocking).toEqual([]);
  // so the referee has to read a full list as cut. This fails if the comparer's limit moves away from the referee's.
  expect(result.cut).toBe(true);
});
