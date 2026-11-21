#!/usr/bin/env node
// Proves the scorers without a model. Every check has a known-good and a
// known-bad case whose score is worked out by hand in bench/harness/selftest/.
//
//   node bench/harness/selftest.mjs [--judge <checkout> --ports <a>,<b>]
//        [--client <id>] [--app <id>] [--node <node>] [--keep]
//
// Without --judge it checks the readers, the task scorer (synthetic
// transcripts, hand-written answer files) and the workflow scripts (with a
// stand-in for the workflow tool). With --judge and two free ports it
// also runs the clone scorer on an application against an exact copy of
// itself, which must agree on every rule, and against the copy with one rule
// broken, which must disagree on exactly that rule. With --client as well
// it prepares a task cell and a clone cell for real and scores them with
// this script standing in for the agent.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadApp } from "./lib/clone-app.mjs";
import { checkoutFacts } from "./lib/proc.mjs";
import { checkCloneScorer } from "./selftest/clone-scorer.mjs";
import { results } from "./selftest/kit.mjs";
import {
  checkFacts,
  checkRuleBreaks,
  checkShellReader,
} from "./selftest/readers.mjs";
import { checkPreparedCells } from "./selftest/prepared.mjs";
import { checkTaskScorer } from "./selftest/task-scorer.mjs";
import { checkWorkflows } from "./selftest/workflows.mjs";

const { values } = parseArgs({
  options: {
    judge: { type: "string" },
    ports: { type: "string" },
    app: { type: "string", default: "varnholt" },
    node: { type: "string", default: process.execPath },
    browser: {
      type: "string",
      default:
        process.env.REA_BROWSER_EXECUTABLE ?? "/opt/pw-browsers/chromium",
    },
    client: { type: "string" },
    keep: { type: "boolean", default: false },
  },
});

const work = mkdtempSync(join(tmpdir(), "rea-bench-selftest-"));
try {
  checkShellReader();
  checkRuleBreaks();
  checkFacts();
  checkTaskScorer(work);
  await checkWorkflows();
  if (values.judge === undefined) {
    console.log(
      "skip clone scorer and prepared cells: pass --judge <checkout> --ports <a>,<b> [--client <id>] to run them",
    );
  } else {
    const settings = {
      app: loadApp(values.app),
      judge: checkoutFacts(values.judge, values.node),
      ports: (values.ports ?? "").split(",").map(Number),
      browser: values.browser,
      client: values.client,
    };
    checkCloneScorer(work, settings);
    if (values.client === undefined)
      console.log("skip prepared cells: pass --client <id> to run them");
    else await checkPreparedCells(work, settings);
  }
} finally {
  if (!values.keep) rmSync(work, { recursive: true, force: true });
}

const failed = results.filter((item) => !item.ok);
console.log(
  `${results.length - failed.length} of ${results.length} checks passed`,
);
if (failed.length > 0) process.exitCode = 1;
