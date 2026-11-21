// Replaying an application's held-out scenarios against two addresses and
// judging its hidden rules, through one pinned REA checkout (the judge). The
// judge renders the capture inputs in a throwaway run folder, captures each
// scenario twice per side from a clean start, and compares.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { heldoutDifferences } from "./clone-app.mjs";
import { parseJson, runRea } from "./proc.mjs";

const CAPTURES_PER_SIDE = 2;
const CAPTURE_TIMEOUT_MS = 150_000;
const SIDES = ["original", "clone"];
// The throwaway folder needs a clone name that holds no product name; the
// name the comparison renames to is the cell's, not this one.
const THROWAWAY_CLONE_NAME = "Held-out replay";

const judgeEnvironment = (browser) => ({
  REA_BROWSER_EXECUTABLE: browser,
  REA_BROWSER_NO_SANDBOX: "true",
});

// A throwaway run folder is the judge's own way to turn an address-free
// scenario into a capture input for each side.
const renderInputs = (replay) => {
  const { app, judge, sides, workDir, browser } = replay;
  const run = join(workDir, "heldout-run");
  const emptyClone = join(workDir, "empty-clone-root");
  mkdirSync(emptyClone, { recursive: true });
  const options = { node: judge.node, env: judgeEnvironment(browser) };
  const init = runRea(
    judge.checkout,
    [
      "init-clone-run",
      run,
      "--original",
      sides.original.address,
      "--clone",
      sides.clone.address,
      "--clone-root",
      emptyClone,
      "--clone-name",
      THROWAWAY_CLONE_NAME,
      ...app.product_names.flatMap((name) => ["--original-name", name]),
      "--authorization",
      "Benchmark scoring: held-out scenarios replayed against both applications.",
      "--stated-by",
      "benchmark harness",
      "--json",
    ],
    options,
  );
  if (init.status !== 0)
    throw new Error(
      `the judge could not create ${run}: ${init.stdout.slice(0, 400)}`,
    );
  for (const scenario of app.scenarios)
    copyFileSync(scenario.file, join(run, "scenarios", `${scenario.id}.json`));
  // The verdict of this evaluation is of no interest: it writes rendered/.
  runRea(judge.checkout, ["evaluate-clone-run", run, "--json"], options);
  return run;
};

const captureOnce = async (replay, run, capture) => {
  const { judge, sides, browser } = replay;
  const { scenario, side, number } = capture;
  const reset = await sides[side].reset();
  if (!reset.ok)
    return {
      scenario: scenario.id,
      side,
      number,
      ok: false,
      evidence: null,
      problem: `reset failed: ${reset.detail}`,
    };
  const directory = join(run, "evidence", side, scenario.id);
  mkdirSync(directory, { recursive: true });
  const evidence = join(directory, `run-${number}.json`);
  const result = runRea(
    judge.checkout,
    [
      "capture-browser-scenario",
      join(run, "rendered", side, `${scenario.id}.json`),
      "--detail",
      "summary",
      "--evidence_output",
      evidence,
      "--json",
    ],
    {
      node: judge.node,
      env: judgeEnvironment(browser),
      timeoutMs: CAPTURE_TIMEOUT_MS,
    },
  );
  const ok = result.status === 0;
  return {
    scenario: scenario.id,
    side,
    number,
    ok,
    evidence: ok ? evidence : null,
    problem: ok
      ? null
      : result.timed_out
        ? "the capture timed out"
        : `capture exit ${result.status}: ${result.stdout.slice(0, 300)}`,
  };
};

const compareScenario = (replay, scenario, captures, differencesFile) => {
  const files = (side) =>
    captures
      .filter(
        (item) =>
          item.side === side && item.scenario === scenario.id && item.ok,
      )
      .map((item) => item.evidence);
  const [left, right] = [files("original"), files("clone")];
  if (left.length === 0 || right.length === 0)
    return { status: null, comparison: null, problem: "a side has no capture" };
  const result = runRea(
    replay.judge.checkout,
    [
      "compare-scenario-behavior",
      ...left.flatMap((file) => ["--left", file]),
      ...right.flatMap((file) => ["--right", file]),
      "--differences",
      differencesFile,
      "--scenario",
      scenario.id,
      "--detail",
      "complete",
      "--exit-code",
      "--json",
    ],
    { node: replay.judge.node },
  );
  const comparison = parseJson(result.stdout);
  return comparison?.comparison === "scenario-behavior"
    ? { status: result.status, comparison, problem: null }
    : {
        status: result.status,
        comparison: null,
        problem: `the comparison failed: ${result.stdout.slice(0, 300)}`,
      };
};

const scenarioReport = (scenario, compared, captures) => {
  const { comparison } = compared;
  const steps = comparison === null ? [] : comparison.steps;
  return {
    id: scenario.id,
    compared: comparison !== null,
    problem: compared.problem,
    exit_status: compared.status,
    verdict: comparison?.verdict ?? null,
    start_state:
      comparison === null
        ? null
        : {
            original: comparison.left.start_state,
            clone: comparison.right.start_state,
          },
    captures: captures
      .filter((item) => item.scenario === scenario.id)
      .map(({ side, number, ok, problem }) => ({ side, number, ok, problem })),
    steps: comparison?.summary ?? {
      steps: 0,
      unchanged: 0,
      changed: 0,
      unknown: 0,
      unstable: 0,
    },
    steps_not_unchanged: steps
      .filter((step) => step.status !== "unchanged")
      .map((step) => ({
        step_id: step.step_id,
        status: step.status,
        findings: step.findings.slice(0, 3).map((finding) => ({
          dimension: finding.dimension,
          category: finding.category,
          pointer: finding.pointer,
          side: finding.side,
        })),
      })),
    limitations: comparison?.limitations ?? [],
    step_status: Object.fromEntries(
      steps.map((step) => [step.step_id, step.status]),
    ),
  };
};

// agrees: every cited step unchanged. disagrees: a cited step changed.
// undecided: none changed, and one is unknown, unstable or was not compared.
const judgeRule = (rule, scenarios) => {
  const steps = rule.cases.flatMap(({ scenario, step_ids: stepIds }) => {
    const report = scenarios.find((item) => item.id === scenario);
    return stepIds.map((step) => ({
      scenario,
      step_id: step,
      status: report?.step_status[step] ?? "not-compared",
    }));
  });
  const has = (status) => steps.some((step) => step.status === status);
  const result = has("changed")
    ? "disagrees"
    : steps.every((step) => step.status === "unchanged")
      ? "agrees"
      : "undecided";
  return {
    id: rule.id,
    difficulty: rule.difficulty ?? null,
    result,
    steps_not_unchanged: steps.filter((step) => step.status !== "unchanged"),
    steps_cited: steps.length,
  };
};

const count = (items, result) =>
  items.filter((item) => item.result === result).length;

/**
 * Replay every held-out scenario of `app` and judge its rules.
 *
 * `replay` is `{ app, judge: { checkout, node }, sides: { original, clone },
 * cloneName, workDir, browser, declareRenames? }`; a side is `{ address,
 * reset }` where `reset()` restarts that application clean and resolves to
 * `{ ok, detail }`.
 */
export const replayHeldout = async (replay) => {
  const { app, cloneName, workDir } = replay;
  const run = renderInputs(replay);
  const differencesFile = join(workDir, "heldout-differences.json");
  const differences = heldoutDifferences(app, cloneName);
  // Two instances of one application carry one name: nothing is renamed.
  if (replay.declareRenames === false) differences.renames = [];
  writeFileSync(differencesFile, `${JSON.stringify(differences, null, 1)}\n`);
  const captures = [];
  for (const scenario of app.scenarios)
    for (let number = 1; number <= CAPTURES_PER_SIDE; number++)
      for (const side of SIDES)
        captures.push(
          await captureOnce(replay, run, { scenario, side, number }),
        );
  const scenarios = app.scenarios.map((scenario) =>
    scenarioReport(
      scenario,
      compareScenario(replay, scenario, captures, differencesFile),
      captures,
    ),
  );
  const rules = app.rules.map((rule) => judgeRule(rule, scenarios));
  const total = (key) =>
    scenarios.reduce((sum, item) => sum + item.steps[key], 0);
  return {
    differences: {
      volatile_fields: differences.volatile_fields.length,
      renames: differences.renames.map(({ from, to }) => ({ from, to })),
    },
    captures_taken: captures.length,
    captures_failed: captures.filter((item) => !item.ok).length,
    steps: {
      steps: total("steps"),
      unchanged: total("unchanged"),
      changed: total("changed"),
      unknown: total("unknown"),
      unstable: total("unstable"),
    },
    rules_total: rules.length,
    rules_agree: count(rules, "agrees"),
    rules_disagree: count(rules, "disagrees"),
    rules_undecided: count(rules, "undecided"),
    scenarios: scenarios.map(({ step_status: _stepStatus, ...rest }) => rest),
    rules,
  };
};
