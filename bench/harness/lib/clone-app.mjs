// A clone-benchmark application: bench/clone/apps/<id>/ with its public
// facts (app.json), its source (original/) and its author's secrets
// (hidden/). bench/clone/README.md is the layout this file reads.
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { runShell } from "./proc.mjs";
import { BENCH_ROOT } from "./tasks.mjs";

export const APPS_ROOT = join(BENCH_ROOT, "clone", "apps");

const readJson = (file) => {
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  return JSON.parse(readFileSync(file, "utf8"));
};

// The selectors a held-out scenario may use besides a role locator: role and
// ARIA attributes, and the browser's text selector (`text="exact text"` or
// `text=/pattern/`), which finds an element by what it shows on screen. All
// are behaviour a clone can be asked to match. An id, a class, a tag or a
// data attribute is the original's markup.
const PORTABLE_SELECTOR =
  /^(?:(?:\s*\[(?:role|aria-[a-z]+)(?:[~|^$*]?=[^\]]*)?\])+\s*|text="(?:[^"\\]|\\.)+"|text=\/(?:(?!>>).)+\/[imsu]*)$/u;

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
    markup_bound: document.actions
      .filter(
        (action) =>
          action.locator?.kind === "css" &&
          !PORTABLE_SELECTOR.test(action.locator.selector),
      )
      .map(
        (action) =>
          `${id}/${action.step_id} finds an element by ${JSON.stringify(action.locator.selector)}: a clean-room clone will not have that markup, the step fails there and no later step runs`,
      ),
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

// app.json, or what stands in for it while an application is being brought
// in: the product name its rules file gives, and a note of what is missing.
const publicFacts = (dir, id, hiddenRules, factsOptional) => {
  const file = join(dir, "app.json");
  if (!existsSync(file) && factsOptional)
    return {
      product_names: [hiddenRules.application],
      public_description: null,
      layout_problems: ["app.json is missing"],
    };
  const facts = readJson(file);
  if (facts.id !== id) throw new Error(`${file} has id ${facts.id}`);
  if (!Array.isArray(facts.product_names) || facts.product_names.length === 0)
    throw new Error(`${id}: app.json needs product_names`);
  if (typeof facts.public_description !== "string")
    throw new Error(`${id}: app.json needs public_description`);
  return { ...facts, layout_problems: [] };
};

/**
 * Read and check one application; throws on anything the layout forbids.
 * With `factsOptional` a missing app.json is noted instead (the self-check
 * of an application that is still being brought in).
 */
export const loadApp = (id, root = APPS_ROOT, factsOptional = false) => {
  const dir = join(root, id);
  if (!existsSync(join(dir, "original", "ctl.sh")))
    throw new Error(`${id}: original/ctl.sh is missing`);
  const hiddenDir = join(dir, "hidden");
  const rules = readJson(join(hiddenDir, "rules.json"));
  const facts = publicFacts(dir, id, rules, factsOptional);
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
    layout_problems: [
      ...facts.layout_problems,
      ...scenarios.flatMap((scenario) => scenario.markup_bound),
    ],
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
export const copySource = (source, target) => {
  cpSync(source, target, {
    recursive: true,
    filter: (path) => !path.slice(source.length).split("/").includes(".run"),
  });
  return join(target, "ctl.sh");
};

export const copyOriginal = (app, target) =>
  copySource(app.original_dir, target);

/**
 * Break one rule in a copy of the original: `hidden/selftest-mutant.json`
 * names a file, a text to find and its replacement, and the rules that must
 * then disagree. Returns those rules.
 */
export const applyMutant = (app, directory) => {
  const mutant = readJson(join(app.hidden_dir, "selftest-mutant.json"));
  const file = join(directory, mutant.file);
  const source = readFileSync(file, "utf8");
  if (!source.includes(mutant.find))
    throw new Error(`${mutant.file} does not hold ${mutant.find}`);
  writeFileSync(file, source.replaceAll(mutant.find, mutant.replace));
  return mutant.breaks;
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
