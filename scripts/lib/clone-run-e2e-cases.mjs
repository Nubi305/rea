import assert from "node:assert/strict";
import {
  access,
  appendFile,
  copyFile,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  MAIN_SCENARIO,
  ORIGINAL_NAME,
  addFixtureScenario,
  assertNotDone,
  captureComplete,
  compareMain,
  describeGate,
  distinctCommands,
  evidenceFile,
  initArguments,
  isCapture,
  reasonsOf,
  sideOf,
  withdrawScenario,
} from "./clone-run-e2e-context.mjs";

const OVERSIZE_SCENARIO = "export";
const OVERSIZE_STEP = "export-all";

/**
 * Spellings of this machine that are not the text `127.0.0.1`. Given the
 * original's port, each names the original's own server.
 */
const LOOPBACK_ALIASES = ["localhost.", "[::ffff:127.0.0.1]"];

/**
 * The cases about the folder itself: captures, Evidence files, the clone's
 * tree and the target. They run first and leave a run that is `done`, plus
 * (from the oversize case on) the state its successor names.
 */
export const EVIDENCE_CASES = [
  {
    name: "one capture per side: not done",
    run: async (context) => {
      const first = await context.evaluate();
      for (const side of ["original", "clone"]) {
        const item = first.gate.next.find(
          (candidate) => isCapture(candidate) && sideOf(candidate) === side,
        );
        assert.ok(
          item,
          `no capture command for the ${side}: ${describeGate(first)}`,
        );
        await context.capture(item);
      }
      const result = await context.evaluate();
      assertNotDone(result, "evidence_missing");
      return `exit 1, ${result.gate.summary} (evidence_missing)`;
    },
  },
  {
    name: "matching clone: evaluate-clone-run --exit-code exits 0",
    run: async (context) => {
      const result = await context.follow(({ exit }) => exit === 0);
      assert.equal(result.exit, 0, describeGate(result));
      assert.equal(result.gate.verdict, "done");
      assert.deepEqual(
        Object.values(result.gate.checks),
        Array.from({ length: 8 }, () => "pass"),
      );
      const { steps, evidence } = result.gate.counts;
      const scenario = JSON.parse(
        await readFile(
          join(context.run, "scenarios", `${MAIN_SCENARIO}.json`),
          "utf8",
        ),
      );
      // Every step the scenario has, and the start REA adds, was compared.
      assert.deepEqual(steps, {
        unchanged: scenario.actions.length + 1,
        changed: 0,
        unknown: 0,
        unstable: 0,
      });
      // The clone words its pages its own way: every declared rename, the
      // reworded About paragraphs among them, replaced text that was compared.
      const { renames, volatile_fields: honoured } = result.gate.declared;
      const declared = JSON.parse(
        await readFile(join(context.run, "intended-differences.json"), "utf8"),
      );
      assert.deepEqual(
        renames.map(({ from }) => from),
        declared.renames.map(({ from }) => from),
      );
      for (const { from, values } of renames)
        assert.ok(values > 0, `the rename of ${from} replaced nothing`);
      assert.ok(honoured > declared.volatile_fields.length);
      context.passGate = result.gate;
      const compared = await compareMain(context);
      assert.equal(compared.exit, 0, JSON.stringify(compared.comparison));
      assert.equal(compared.comparison.verdict, "unchanged");
      return `exit 0, ${steps.unchanged} steps unchanged, ${evidence.admitted} captures admitted, ${renames.length} renames applied, ${honoured} volatile fields honoured from ${declared.volatile_fields.length} declarations; compare-scenario-behavior --exit-code exits 0`;
    },
  },
  {
    name: "one line appended to a clone file after a pass: stale",
    run: async (context) => {
      const file = join(context.cloneRoot, "views.mjs");
      const before = await readFile(file);
      await appendFile(file, "// edited after the captures\n");
      const result = await context.evaluate();
      assertNotDone(result, "evidence_stale");
      await writeFile(file, before);
      await context.expectDone("after the edit was reverted");
      return `exit 1, ${result.gate.summary} (evidence_stale)`;
    },
  },
  {
    name: "an edited Evidence file: rejected",
    run: async (context) => {
      const bundle = JSON.parse(
        await readFile(
          evidenceFile(context, "clone", MAIN_SCENARIO, "run-1.json"),
          "utf8",
        ),
      );
      bundle.records[0].parameters.actions[0].path = "/api/topics?edited=1";
      await writeFile(
        evidenceFile(context, "clone", MAIN_SCENARIO, "edited.json"),
        JSON.stringify(bundle),
      );
      const result = await context.evaluate();
      assertNotDone(result, "evidence_rejected_integrity");
      await context.remove(result.gate, "evidence_rejected_integrity");
      await context.expectDone("after the edited file was removed");
      return `exit 1, ${result.gate.summary} (evidence_rejected_integrity)`;
    },
  },
  {
    name: "a capture taken from the other side's address: rejected",
    run: async (context) => {
      await copyFile(
        evidenceFile(context, "original", MAIN_SCENARIO, "run-1.json"),
        evidenceFile(context, "clone", MAIN_SCENARIO, "from-original.json"),
      );
      const result = await context.evaluate();
      assertNotDone(result, "evidence_rejected_address");
      await context.remove(result.gate, "evidence_rejected_address");
      await context.expectDone("after the misplaced capture was removed");
      return `exit 1, ${result.gate.summary} (evidence_rejected_address)`;
    },
  },
  {
    name: "the original's name left in the clone: forbidden name",
    run: async (context) => {
      const file = join(context.cloneRoot, "NOTICE.txt");
      await writeFile(file, `A port of ${ORIGINAL_NAME}.\n`);
      const result = await context.evaluate();
      assertNotDone(result, "clean_room_forbidden_name");
      await rm(file);
      await context.expectDone("after the name was removed");
      return `exit 1, ${result.gate.summary} (clean_room_forbidden_name)`;
    },
  },
  {
    name: "the original's own address under a loopback alias as the clone's address: refused at init and by the referee",
    run: async (context) => {
      const targetFile = join(context.run, "target.json");
      const before = await readFile(targetFile, "utf8");
      const seen = [];
      for (const host of LOOPBACK_ALIASES) {
        const alias = `http://${host}:${context.sites.original.port}`;
        // The run folder itself was created by these flags with the clone's
        // real address, so the address is all that this refusal can be about.
        const directory = join(context.root, "alias-run");
        const refused = await context.rea(
          initArguments(context, directory, alias),
        );
        assert.equal(refused.exit, 1, refused.stdout);
        const refusal = JSON.parse(refused.stdout);
        assert.equal(refusal.code, "invalid_request", refused.stdout);
        assert.equal(refusal.verdict, undefined, refused.stdout);
        await assert.rejects(access(directory), `${alias}: init wrote a run`);
        // A run that passed, retargeted so that both sides are one server.
        const target = JSON.parse(before);
        target.clone.address = alias;
        await writeFile(targetFile, JSON.stringify(target));
        const result = await context.evaluate();
        assertNotDone(result, "addresses_not_distinct");
        assert.equal(result.gate.checks.scope, "fail", describeGate(result));
        seen.push(alias);
      }
      await writeFile(targetFile, before);
      await context.expectDone("after target.json was restored");
      return `${seen.join(" and ")}: init-clone-run exits 1 and writes nothing; in target.json, exit 1, not done (addresses_not_distinct)`;
    },
  },
  {
    name: "a link in the clone that leaves the clone root for a target that does not exist: flagged",
    run: async (context) => {
      const link = join(context.cloneRoot, "vendored.mjs");
      const target = "../absent-elsewhere/board.mjs";
      await assert.rejects(access(join(context.cloneRoot, target)));
      await symlink(target, link);
      const result = await context.evaluate();
      assertNotDone(result, "clone_symlink_outside_root");
      await rm(link);
      await context.expectDone("after the link was removed");
      return `exit 1, ${result.gate.summary} (clone_symlink_outside_root)`;
    },
  },
  {
    name: "one capture per side with a reply over the body limit: compare-scenario-behavior --exit-code exits 2",
    run: async (context) => {
      await addFixtureScenario(context, OVERSIZE_SCENARIO);
      const first = await context.evaluate();
      const pending = distinctCommands(first.gate.next.filter(isCapture));
      context.secondCaptures = [];
      for (const side of ["original", "clone"]) {
        const [now, later] = pending.filter((item) => sideOf(item) === side);
        assert.ok(
          later,
          `two capture commands for the ${side}: ${describeGate(first)}`,
        );
        await context.capture(now);
        context.secondCaptures.push(later);
      }
      const compared = await context.rea([
        "compare-scenario-behavior",
        "--left",
        evidenceFile(context, "original", OVERSIZE_SCENARIO, "run-1.json"),
        "--right",
        evidenceFile(context, "clone", OVERSIZE_SCENARIO, "run-1.json"),
        "--differences",
        join(context.run, "intended-differences.json"),
        "--scenario",
        OVERSIZE_SCENARIO,
        "--exit-code",
      ]);
      assert.equal(compared.exit, 2, compared.stdout);
      const comparison = JSON.parse(compared.stdout);
      assert.equal(comparison.verdict, "unknown");
      const step = comparison.steps.find(
        ({ step_id: id }) => id === OVERSIZE_STEP,
      );
      assert.equal(step?.status, "unknown", compared.stdout);
      assert.ok(
        step.findings.some(
          ({ dimension, category }) =>
            dimension === "body" && category === "not-recorded",
        ),
        compared.stdout,
      );
      return `exit 2, verdict unknown, step ${OVERSIZE_STEP} body not-recorded`;
    },
  },
  {
    name: "two captures with no reset between them: dirty start state",
    run: async (context) => {
      for (const item of context.secondCaptures)
        await context.capture(item, { reset: false });
      const result = await context.evaluate();
      assertNotDone(result, "start_state_dirty");
      await context.remove(result.gate, "start_state_dirty");
      return `exit 1, ${result.gate.summary} (start_state_dirty)`;
    },
  },
  {
    name: "two captures per side with a reply no capture recorded: not done (unknown)",
    run: async (context) => {
      const result = await context.follow(captureComplete);
      assertNotDone(result, "parity_unknown");
      assert.deepEqual(reasonsOf(result.gate), ["parity_unknown"]);
      const item = result.gate.next.find(
        ({ reason, step_id: id }) =>
          reason === "parity_unknown" && id === OVERSIZE_STEP,
      );
      assert.ok(item, describeGate(result));
      await withdrawScenario(context, OVERSIZE_SCENARIO);
      await context.expectDone("after the oversize scenario was withdrawn");
      return `exit 1, ${result.gate.summary} (parity_unknown at ${OVERSIZE_STEP})`;
    },
  },
];
