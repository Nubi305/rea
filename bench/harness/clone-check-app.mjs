#!/usr/bin/env node
// Checks a clone-benchmark application against the layout in
// bench/clone/README.md and proves its held-out scenarios: two instances of
// the original are replayed against each other through the judge checkout,
// and every step must come out unchanged, so every rule must agree.
//
//   node bench/harness/clone-check-app.mjs --app <id> --judge <checkout>
//        --ports <a>,<b> [--apps <directory>] [--clone-source <directory>]
//        [--mutant] [--node <node>] [--keep]
//
// --apps names another directory of applications than bench/clone/apps: one
// that is still being brought in can be checked where it is. A missing
// app.json is then reported and does not stop the replay.
//
// The second instance can be something else than the original:
// --clone-source runs it from another directory (a copy whose markup was
// changed, say), and must still agree on every rule; --mutant runs the
// original with hidden/selftest-mutant.json applied, and must disagree on
// exactly the rules that file names and agree on every other.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  APPS_ROOT,
  applyMutant,
  controlOriginal,
  copyOriginal,
  copySource,
  loadApp,
} from "./lib/clone-app.mjs";
import { replayHeldout } from "./lib/heldout.mjs";
import { checkoutFacts } from "./lib/proc.mjs";
import { portOpen } from "./lib/service.mjs";

const USAGE =
  "usage: clone-check-app.mjs --app <id> --judge <checkout> --ports <a>,<b> [--apps <directory>] [--clone-source <directory> | --mutant] [--node <node>] [--keep]";

const options = () => {
  const { values } = parseArgs({
    options: {
      app: { type: "string" },
      judge: { type: "string" },
      ports: { type: "string" },
      apps: { type: "string" },
      "clone-source": { type: "string" },
      mutant: { type: "boolean", default: false },
      node: { type: "string", default: process.execPath },
      browser: {
        type: "string",
        default:
          process.env.REA_BROWSER_EXECUTABLE ?? "/opt/pw-browsers/chromium",
      },
      keep: { type: "boolean", default: false },
    },
  });
  const ports = (values.ports ?? "").split(",").map(Number);
  if (
    !values.app ||
    !values.judge ||
    ports.length !== 2 ||
    ports.some(Number.isNaN) ||
    (values.mutant && values["clone-source"] !== undefined)
  )
    throw new Error(USAGE);
  return { ...values, ports };
};

const side = (ctl, port) => ({
  ctl,
  port,
  address: `http://127.0.0.1:${port}`,
  reset: async () => {
    const result = controlOriginal(ctl, port, "reset");
    return { ok: result.ok, detail: result.output };
  },
});

// Steps no rule cites are replayed and counted but decide no rule. The
// fingerprint and setup steps are meant to be among them; a behaviour step
// in this list is one the rules file forgot.
const uncitedSteps = (app) =>
  app.scenarios.flatMap((scenario) => {
    const cited = new Set(
      app.rules.flatMap((rule) =>
        rule.cases
          .filter((item) => item.scenario === scenario.id)
          .flatMap((item) => item.step_ids),
      ),
    );
    return scenario.step_ids
      .filter((step) => !cited.has(step))
      .map((step) => `${scenario.id}/${step}`);
  });

const main = async () => {
  const values = options();
  const app = loadApp(values.app, values.apps ?? APPS_ROOT, true);
  const judge = checkoutFacts(values.judge, values.node);
  for (const port of values.ports)
    if (await portOpen(port))
      throw new Error(`port ${port} is taken; nothing was started`);
  const workDir = mkdtempSync(join(tmpdir(), `rea-bench-check-${app.id}-`));
  const right = join(workDir, "right");
  const source = values["clone-source"];
  const rightCtl =
    source === undefined
      ? copyOriginal(app, right)
      : copySource(resolve(source), right);
  const breaks = values.mutant ? applyMutant(app, right) : [];
  const sides = {
    original: side(copyOriginal(app, join(workDir, "left")), values.ports[0]),
    clone: side(rightCtl, values.ports[1]),
  };
  let report;
  try {
    report = await replayHeldout({
      app,
      judge,
      sides,
      cloneName: "Benchmark Mirror",
      workDir,
      browser: values.browser,
      declareRenames: false,
    });
  } finally {
    for (const item of Object.values(sides))
      controlOriginal(item.ctl, item.port, "stop");
    if (!values.keep) rmSync(workDir, { recursive: true, force: true });
  }
  const disagree = report.rules
    .filter((rule) => rule.result === "disagrees")
    .map((rule) => rule.id)
    .sort();
  const expected = [...breaks].sort();
  const ok =
    app.layout_problems.length === 0 &&
    report.captures_failed === 0 &&
    report.steps.steps > 0 &&
    (values.mutant
      ? JSON.stringify(disagree) === JSON.stringify(expected) &&
        report.rules_agree === report.rules_total - expected.length
      : report.steps.unchanged === report.steps.steps &&
        report.rules_agree === report.rules_total);
  console.log(
    JSON.stringify(
      {
        app: app.id,
        judge: { commit: judge.commit_short, version: judge.version },
        second_instance: values.mutant
          ? "the original with hidden/selftest-mutant.json applied"
          : (source ?? "the original"),
        ok,
        rules_expected_to_disagree: expected,
        layout_problems: app.layout_problems,
        scenario_steps_no_rule_cites: uncitedSteps(app),
        ...report,
      },
      null,
      1,
    ),
  );
  if (!ok) process.exitCode = 1;
};

await main();
