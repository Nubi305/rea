import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  MAIN_SCENARIO,
  addFixtureScenario,
  applyMutant,
  assertNotDone,
  captureComplete,
  compareMain,
  describeGate,
  reasonsOf,
  withdrawScenario,
} from "./clone-run-e2e-context.mjs";

const DOWNLOAD_SCENARIO = "download";
const DOWNLOAD_LINK_STEP = "download-link";
const DOWNLOAD_FETCH_STEP = "download-fetched";

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

/** The referee's own outputs for the main scenario, which no verdict reads back. */
const refereeOutputs = (context) => ({
  gate: join(context.run, "gate.json"),
  parity: join(context.run, "parity", `${MAIN_SCENARIO}.json`),
  records: join(context.run, "records", "clone", `${MAIN_SCENARIO}.json`),
  rendered: join(context.run, "rendered", "clone", `${MAIN_SCENARIO}.json`),
});

/** Each step's status in the comparison the referee wrote for a scenario. */
const stepStatuses = async (context, scenario) =>
  Object.fromEntries(
    (await readJson(join(context.run, "parity", `${scenario}.json`))).steps.map(
      ({ step_id: id, status }) => [id, status],
    ),
  );

/**
 * Captures are complete and no step lacks data another capture could still
 * supply, apart from the steps named: a reply body is sometimes lost in every
 * capture of a side, and the worklist then asks for one more.
 */
const settled =
  (...expectedUnknown) =>
  (result) =>
    captureComplete(result) &&
    !result.gate.next.some(
      ({ reason, step_id: id, step_ids: ids }) =>
        reason === "parity_unknown" &&
        (ids ?? [id]).some((step) => !expectedUnknown.includes(step)),
    );

/**
 * The cases about a clone that behaves differently. Each starts from a run
 * that is `done` and, from the forged pass on, leaves one.
 */
export const MUTANT_CASES = [
  {
    name: "mutant: exit 1 with a worklist item whose pointer ends in /slug",
    run: async (context) => {
      context.revertSlugMutant = await applyMutant(context, "slug-cut");
      const result = await context.follow(settled());
      assertNotDone(result, "parity_changed");
      const item = result.gate.next.find(
        ({ reason, pointer }) =>
          reason === "parity_changed" && pointer?.endsWith("/slug"),
      );
      assert.ok(item, describeGate(result));
      context.mutantGate = result.gate;
      const compared = await compareMain(context);
      assert.equal(compared.exit, 1, JSON.stringify(compared.comparison));
      assert.equal(compared.comparison.verdict, "changed");
      return `exit 1, step ${item.step_id} ${item.dimension} ${item.pointer}: expected ${item.expected}, actual ${item.actual}; compare-scenario-behavior --exit-code exits 1`;
    },
  },
  {
    name: "a pass forged in all four referee outputs, with a mutant clone: still not done",
    run: async (context) => {
      const files = refereeOutputs(context);
      const honest = {
        parity: await readJson(files.parity),
        records: await readJson(files.records),
        rendered: await readFile(files.rendered, "utf8"),
      };
      const forged = {
        gate: { ...context.passGate, evaluated_at: new Date().toISOString() },
        parity: {
          ...honest.parity,
          verdict: "unchanged",
          steps: honest.parity.steps.map((step) => ({
            ...step,
            status: "unchanged",
            findings: [],
          })),
        },
        // The captures of the matching clone, stale now, written back as admitted.
        records: {
          ...honest.records,
          files: honest.records.files.map((file) => ({
            ...file,
            status: "admitted",
            detail: null,
          })),
        },
        // A capture input that would send the clone's captures to the original.
        rendered: honest.rendered.replaceAll(
          context.sites.clone.origin,
          context.sites.original.origin,
        ),
      };
      assert.notDeepEqual(forged.records, honest.records);
      assert.notEqual(forged.rendered, honest.rendered);
      await writeFile(files.gate, JSON.stringify(forged.gate));
      await writeFile(files.parity, JSON.stringify(forged.parity));
      await writeFile(files.records, JSON.stringify(forged.records));
      await writeFile(files.rendered, forged.rendered);

      const result = await context.evaluate();
      assertNotDone(result, "parity_changed");
      assert.deepEqual(result.gate.blocking, context.mutantGate.blocking);
      // Each forged file is the referee's own again.
      const gate = await readJson(files.gate);
      assert.equal(gate.verdict, "not_done");
      assert.deepEqual(gate.blocking, context.mutantGate.blocking);
      assert.deepEqual(await readJson(files.parity), honest.parity);
      assert.deepEqual(await readJson(files.records), honest.records);
      assert.equal(await readFile(files.rendered, "utf8"), honest.rendered);

      await context.revertSlugMutant();
      await context.expectDone("after the mutant was reverted");
      return `exit 1, ${result.gate.summary}; gate.json, parity/, records/ and rendered/ were each read back as the referee computes them; done again once the clone was put right`;
    },
  },
  {
    name: "mutant: a list answered as an object keyed by position, where the original answers an array: changed",
    run: async (context) => {
      const revert = await applyMutant(context, "list-as-object");
      const result = await context.follow(settled());
      assertNotDone(result, "parity_changed");
      assert.deepEqual(reasonsOf(result.gate), ["parity_changed"]);
      const item = result.gate.next.find(
        ({ reason, dimension, pointer }) =>
          reason === "parity_changed" &&
          dimension === "body" &&
          pointer === "/items",
      );
      assert.ok(item, describeGate(result));
      // Same items at the same pointers; only the container's kind differs.
      assert.ok(item.expected.startsWith("["), item.expected);
      assert.ok(item.actual.startsWith('{"0":'), item.actual);
      const compared = await compareMain(context);
      assert.equal(compared.exit, 1, JSON.stringify(compared.comparison));
      assert.equal(compared.comparison.verdict, "changed");
      await revert();
      await context.expectDone("after the mutant was reverted");
      return `exit 1, ${result.gate.summary}; step ${item.step_id} body /items: the original gave an array, the clone an object with keys "0", "1", ...; compare-scenario-behavior --exit-code exits 1`;
    },
  },
  {
    name: "a file saved through a download link: its step is unknown and never a match; a clone that saves other content is changed at the request step that fetches the file",
    run: async (context) => {
      await addFixtureScenario(context, DOWNLOAD_SCENARIO);
      // The same file on both sides: no capture records what a download
      // link saved, so the link's step cannot pass, and the fetched copy matches.
      const same = await context.follow(settled(DOWNLOAD_LINK_STEP));
      assertNotDone(same, "parity_unknown");
      assert.deepEqual(reasonsOf(same.gate), ["parity_unknown"]);
      assert.ok(
        same.gate.next.some(
          ({ reason, step_id: id, dimension }) =>
            reason === "parity_unknown" &&
            id === DOWNLOAD_LINK_STEP &&
            dimension === "body",
        ),
        describeGate(same),
      );
      const before = await stepStatuses(context, DOWNLOAD_SCENARIO);
      assert.equal(before[DOWNLOAD_FETCH_STEP], "unchanged");
      assert.equal(before[DOWNLOAD_LINK_STEP], "unknown");

      const revert = await applyMutant(context, "download-separator");
      const different = await context.follow(settled(DOWNLOAD_LINK_STEP));
      assertNotDone(different, "parity_changed");
      assert.deepEqual(reasonsOf(different.gate), [
        "parity_changed",
        "parity_unknown",
      ]);
      const item = different.gate.next.find(
        ({ reason, step_id: id, dimension }) =>
          reason === "parity_changed" &&
          id === DOWNLOAD_FETCH_STEP &&
          dimension === "body",
      );
      assert.ok(item, describeGate(different));
      const after = await stepStatuses(context, DOWNLOAD_SCENARIO);
      assert.equal(after[DOWNLOAD_FETCH_STEP], "changed");
      assert.equal(after[DOWNLOAD_LINK_STEP], "unknown");

      await revert();
      await withdrawScenario(context, DOWNLOAD_SCENARIO);
      await context.expectDone("after the download scenario was withdrawn");
      return `same file: exit 1, ${same.gate.summary} (parity_unknown at ${DOWNLOAD_LINK_STEP}, ${DOWNLOAD_FETCH_STEP} unchanged); other content: exit 1, ${different.gate.summary} (parity_changed at ${DOWNLOAD_FETCH_STEP}, ${DOWNLOAD_LINK_STEP} still unknown)`;
    },
  },
];
