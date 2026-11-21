// A clone-benchmark application: bench/clone/apps/<id>/ with its public
// facts (app.json), its source (original/) and its author's secrets
// (hidden/). bench/clone/README.md is the layout this file reads.
import { cpSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runShell } from "./proc.mjs";
import { BENCH_ROOT } from "./tasks.mjs";

export const APPS_ROOT = join(BENCH_ROOT, "clone", "apps");

const readJson = (file) => {
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  return JSON.parse(readFileSync(file, "utf8"));
};

// rules.json names its scenarios as a list of ids (the file is <id>.json) or
// as a map from id to file name.
const scenarioFiles = (rules) =>
  Array.isArray(rules.scenarios)
    ? rules.scenarios.map((id) => [id, `${id}.json`])
    : Object.entries(rules.scenarios ?? {});

const loadScenario = (hiddenDir, id, file) => {
  const document = readJson(join(hiddenDir, file));
  if (!Array.isArray(document.actions))
    throw new Error(`${file} has no actions`);
  return {
    id,
    file: join(hiddenDir, file),
    step_ids: document.actions.map((action) => action.step_id),
  };
};

const checkRule = (rule, scenarios) => {
  if (typeof rule.id !== "string" || !Array.isArray(rule.cases))
    throw new Error(`a rule needs an id and cases: ${JSON.stringify(rule.id)}`);
  for (const { scenario, step_ids: stepIds } of rule.cases) {
    const known = scenarios.find((item) => item.id === scenario);
    if (known === undefined)
      throw new Error(`rule ${rule.id} cites unknown scenario ${scenario}`);
    for (const step of stepIds)
      if (!known.step_ids.includes(step))
        throw new Error(`rule ${rule.id}: ${scenario} has no step ${step}`);
  }
  if (rule.cases.every((item) => item.step_ids.length === 0))
    throw new Error(`rule ${rule.id} cites no step`);
};

/** Read and check one application; throws on anything the layout forbids. */
export const loadApp = (id, root = APPS_ROOT) => {
  const dir = join(root, id);
  const facts = readJson(join(dir, "app.json"));
  if (facts.id !== id) throw new Error(`${dir}/app.json has id ${facts.id}`);
  if (!Array.isArray(facts.product_names) || facts.product_names.length === 0)
    throw new Error(`${id}: app.json needs product_names`);
  if (typeof facts.public_description !== "string")
    throw new Error(`${id}: app.json needs public_description`);
  if (!existsSync(join(dir, "original", "ctl.sh")))
    throw new Error(`${id}: original/ctl.sh is missing`);
  const hiddenDir = join(dir, "hidden");
  const rules = readJson(join(hiddenDir, "rules.json"));
  const scenarios = scenarioFiles(rules).map(([scenario, file]) =>
    loadScenario(hiddenDir, scenario, file),
  );
  if (scenarios.length === 0)
    throw new Error(`${id}: rules.json names no scenario`);
  if (!Array.isArray(rules.rules) || rules.rules.length === 0)
    throw new Error(`${id}: rules.json holds no rules`);
  for (const rule of rules.rules) checkRule(rule, scenarios);
  const differencesFile = join(
    hiddenDir,
    rules.differences ?? "heldout-differences.json",
  );
  const differences = readJson(differencesFile);
  if ((differences.renames ?? []).length > 0)
    throw new Error(`${id}: the hidden differences file may not hold renames`);
  return {
    id,
    dir,
    original_dir: join(dir, "original"),
    hidden_dir: hiddenDir,
    product_names: facts.product_names,
    public_description: facts.public_description,
    scenarios,
    rules: rules.rules,
    differences,
  };
};

/** The ids of every application directory that has an app.json. */
export const listAppIds = (root = APPS_ROOT) =>
  readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(root, entry.name, "app.json")),
    )
    .map((entry) => entry.name)
    .sort();

/** A private copy of an application's source, without what an earlier run left. */
export const copyOriginal = (app, target) => {
  cpSync(app.original_dir, target, {
    recursive: true,
    filter: (source) => !source.split("/").includes(".run"),
  });
  return join(target, "ctl.sh");
};

/**
 * Run a verb of an original's control script on a port. `reset` gives a
 * clean start; every verb returns when its work is done.
 */
export const controlOriginal = (ctl, port, verb) => {
  const result = runShell(`PORT=${port} bash ${JSON.stringify(ctl)} ${verb}`, {
    timeoutMs: 60_000,
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout}${result.stderr}`.trim(),
  };
};

/**
 * The differences a held-out comparison declares: the author's volatile
 * fields plus one rename per product name to the clone's name, longest name
 * first so that a name inside another is not replaced early.
 */
export const heldoutDifferences = (app, cloneName) => ({
  renames: [...app.product_names]
    .sort((left, right) => right.length - left.length)
    .filter((name) => name !== cloneName)
    .map((name) => ({ from: name, to: cloneName, reason: "product name" })),
  volatile_fields: app.differences.volatile_fields ?? [],
});
