import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  FIXTURES,
  addFixtureScenario,
  applyMutant,
  assertNotDone,
  describeGate,
  parityOf,
  readJson,
  reasonsOf,
  settled,
  stepStatuses,
} from "./clone-run-e2e-context.mjs";

const BOARD_SCENARIO = "board";
const PAGE_STEP = "where-page";
const FACTS_STEP = "board-facts";
const SETUP_FACTS_STEP = `setup-${FACTS_STEP}`;

/** Rewrite one authored JSON file of the run; the result puts it back as it was. */
const rewrite = async (file, change) => {
  const before = await readFile(file, "utf8");
  await writeFile(
    file,
    `${JSON.stringify(change(JSON.parse(before)), null, 2)}\n`,
  );
  return () => writeFile(file, before);
};

const declare = (context, fields) =>
  rewrite(join(context.run, "intended-differences.json"), (declared) => ({
    ...declared,
    volatile_fields: [...declared.volatile_fields, ...fields],
  }));

/** The one worklist item for a reply field of the board scenario. */
const itemAt = (result, reason, stepId, pointer) => {
  const item = result.gate.next.find(
    (candidate) =>
      candidate.reason === reason &&
      candidate.step_id === stepId &&
      candidate.dimension === "body" &&
      candidate.pointer === pointer,
  );
  assert.ok(
    item,
    `no ${reason} item at ${stepId} ${pointer}: ${describeGate(result)}`,
  );
  return item;
};

/** What the gate says a declared pointer of the board scenario did. */
const declarationOf = (result, pointer) =>
  result.gate.declared.volatile_declarations.find(
    (entry) => entry.scenario === BOARD_SCENARIO && entry.pointer === pointer,
  );

/**
 * What a team does to hide a failing step: name it `setup-`, drop the
 * obligation that cites it, and declare the differing field volatile. The
 * result puts the three files back.
 */
const hideFailingStep = async (context) => {
  const restores = [
    await rewrite(
      join(context.run, "scenarios", `${BOARD_SCENARIO}.json`),
      (scenario) => ({
        ...scenario,
        actions: scenario.actions.map((action) =>
          action.step_id === FACTS_STEP
            ? { ...action, step_id: SETUP_FACTS_STEP }
            : action,
        ),
      }),
    ),
    await rewrite(
      join(context.run, "obligations", `${BOARD_SCENARIO}.json`),
      ({ obligations }) => ({
        obligations: obligations.filter(
          ({ cases }) =>
            !cases.some(({ step_ids: ids }) => ids.includes(FACTS_STEP)),
        ),
      }),
    ),
    await declare(context, [
      {
        scenario: BOARD_SCENARIO,
        step_id: SETUP_FACTS_STEP,
        pointer: "/plan",
        reason: "declared so that the difference is not compared",
      },
    ]),
  ];
  return async () => {
    for (const restore of restores.toReversed()) await restore();
  };
};

/**
 * The cases about declarations and addresses, on a scenario whose replies
 * hold values made anew for every request and the application's own address.
 * Each starts from a run that is `done` and leaves one. Before the second fix
 * round every mutant here read `done`.
 */
export const DECLARED_CASES = [
  {
    name: "an application that prints its own address, with and without the scheme, cloned correctly: done",
    run: async (context) => {
      await addFixtureScenario(context, BOARD_SCENARIO);
      const { volatile_fields: fields } = await readJson(
        join(FIXTURES, "run", "board-differences.json"),
      );
      await declare(context, fields);
      const result = await context.follow(({ exit }) => exit === 0);
      assert.equal(result.exit, 0, describeGate(result));
      assert.equal(result.gate.verdict, "done", describeGate(result));
      const parity = await parityOf(context, BOARD_SCENARIO);
      assert.equal(parity.verdict, "unchanged", JSON.stringify(parity));
      // Each side printed its own address on the page and in the reply. The
      // original's was read as the clone's: the origin, then the bare host and port.
      const { original, clone } = context.sites;
      const applied = parity.addresses_applied ?? [];
      assert.deepEqual(
        applied.map(({ from, to }) => ({ from, to })),
        [
          { from: original.origin, to: clone.origin },
          {
            from: new URL(original.origin).host,
            to: new URL(clone.origin).host,
          },
        ],
        JSON.stringify(parity),
      );
      // Both declarations were honoured, and only where the original varies.
      for (const { pointer } of fields) {
        const effect = declarationOf(result, pointer);
        const stated = JSON.stringify(result.gate.declared);
        assert.equal(effect?.honoured_steps, 1, stated);
        assert.equal(effect?.not_shown_steps, 0, stated);
      }
      return `exit 0, ${result.gate.summary}; ${applied
        .map(
          ({ from, to, values }) => `${from} read as ${to} in ${values} values`,
        )
        .join(
          ", ",
        )}; ${fields.map(({ pointer }) => pointer).join(" and ")} honoured`;
    },
  },
  {
    name: "mutant: steadily wrong at a list position the original holds steady, under a declared * pointer whose other position varies: not done (unknown)",
    run: async (context) => {
      const revert = await applyMutant(context, "steady-session");
      const result = await context.follow(settled(FACTS_STEP));
      assertNotDone(result, "parity_unknown");
      assert.deepEqual(reasonsOf(result.gate), ["parity_unknown"]);
      // The finding names the declared pattern; the two values name the position.
      const item = itemAt(
        result,
        "parity_unknown",
        FACTS_STEP,
        "/sessions/*/id",
      );
      assert.equal(item.expected, '"seed-session"', describeGate(result));
      assert.equal(item.actual, '"lost-session"', describeGate(result));
      // Honoured at the position that varies, held back at the steady one.
      const declared = declarationOf(result, "/sessions/*/id");
      assert.equal(declared?.not_shown_steps, 1, describeGate(result));
      const { steps } = await parityOf(context, BOARD_SCENARIO);
      const step = steps.find(({ step_id: id }) => id === FACTS_STEP);
      assert.equal(step.status, "unknown", JSON.stringify(step));
      assert.deepEqual(
        step.findings.map(({ category }) => category),
        ["declared-not-shown"],
        JSON.stringify(step),
      );
      await revert();
      await context.expectDone("after the mutant was reverted");
      return `exit 1, ${result.gate.summary}; step ${FACTS_STEP} body ${item.pointer}: at the second position the original gave ${item.expected} in every capture, the clone ${item.actual} (declared-not-shown)`;
    },
  },
  {
    name: "mutant: a list answered as an object keyed by position, every value beneath it declared volatile: changed",
    run: async (context) => {
      const revert = await applyMutant(context, "tokens-as-object");
      const result = await context.follow(settled());
      assertNotDone(result, "parity_changed");
      assert.deepEqual(reasonsOf(result.gate), ["parity_changed"]);
      const item = itemAt(result, "parity_changed", FACTS_STEP, "/tokens");
      assert.ok(item.expected.startsWith("["), item.expected);
      assert.ok(item.actual.startsWith('{"0":'), item.actual);
      await revert();
      await context.expectDone("after the mutant was reverted");
      return `exit 1, ${result.gate.summary}; step ${FACTS_STEP} body /tokens: the original gave an array, the clone an object with keys "0" and "1"`;
    },
  },
  {
    name: "mutant: the literal text {origin} where the original prints its own address: changed",
    run: async (context) => {
      const revert = await applyMutant(context, "address-placeholder");
      const result = await context.follow(settled());
      assertNotDone(result, "parity_changed");
      assert.deepEqual(reasonsOf(result.gate), ["parity_changed"]);
      // On screen at the page step and in the reply at the request step.
      const statuses = await stepStatuses(context, BOARD_SCENARIO);
      assert.equal(statuses[PAGE_STEP], "changed", JSON.stringify(statuses));
      assert.equal(statuses[FACTS_STEP], "changed", JSON.stringify(statuses));
      const item = itemAt(result, "parity_changed", FACTS_STEP, "/address");
      assert.equal(item.role, "builder", describeGate(result));
      assert.equal(item.actual, '"{origin}/api/board"', describeGate(result));
      await revert();
      await context.expectDone("after the mutant was reverted");
      return `exit 1, ${result.gate.summary}; steps ${PAGE_STEP} (on-screen text) and ${FACTS_STEP} (body /address, the clone gave ${item.actual}) changed`;
    },
  },
  {
    name: "mutant: a failing step renamed setup- with its steady wrong value declared volatile: not done, and stalled when the worklist is followed",
    run: async (context) => {
      const revert = await applyMutant(context, "plan-other");
      const failing = await context.follow(settled());
      assertNotDone(failing, "parity_changed");
      itemAt(failing, "parity_changed", FACTS_STEP, "/plan");

      const restore = await hideFailingStep(context);
      const hidden = await context.follow(settled(SETUP_FACTS_STEP));
      assertNotDone(hidden, "parity_unknown");
      assert.deepEqual(reasonsOf(hidden.gate), ["parity_unknown"]);
      const item = itemAt(hidden, "parity_unknown", SETUP_FACTS_STEP, "/plan");
      assert.equal(item.expected, '"free"', describeGate(hidden));
      assert.equal(item.actual, '"team"', describeGate(hidden));
      // The gate names the declaration that held the difference back, and the step is not let through.
      assert.equal(
        declarationOf(hidden, "/plan")?.not_shown_steps,
        1,
        JSON.stringify(hidden.gate.declared),
      );
      assert.equal(hidden.gate.counts.ungated_steps, 0, describeGate(hidden));
      // The item's own remedy, one more capture of the original, never ends in done.
      const followed = await context.follow(({ exit }) => exit !== 1, 6);
      assert.equal(followed.exit, 2, describeGate(followed));
      assert.equal(followed.gate.verdict, "stalled", describeGate(followed));

      await restore();
      await revert();
      await context.expectDone(
        "after the scenario, the declaration and the clone were put back",
      );
      return `as a behaviour step: exit 1, ${failing.gate.summary} (parity_changed at ${FACTS_STEP} /plan); renamed ${SETUP_FACTS_STEP} with /plan declared volatile: exit 1, ${hidden.gate.summary} (parity_unknown, the original gave ${item.expected}, the clone ${item.actual}); after the worklist's captures: exit 2, ${followed.gate.verdict}`;
    },
  },
];
