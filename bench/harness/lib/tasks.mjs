// Task definitions: reading bench/tasks/<id>/task.json and judging an answer
// file against a task's expected facts. A fact is right or wrong; nothing here
// gives partial credit.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** bench/, the directory that holds harness/, tasks/, clone/ and results/. */
export const BENCH_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
export const TASKS_ROOT = join(BENCH_ROOT, "tasks");

const CHECKS = ["equals", "one_of", "set_equals", "list_equals"];

const requireText = (task, key) => {
  if (typeof task[key] !== "string" || task[key].trim() === "")
    throw new Error(`task ${task.id}: ${key} must be a non-empty string`);
};

const validateFact = (task, fact) => {
  if (!CHECKS.includes(fact.check))
    throw new Error(`task ${task.id}: fact ${fact.id} has no known check`);
  if (!(fact.field in task.answer.fields))
    throw new Error(
      `task ${task.id}: fact ${fact.id} reads a field the answer does not have`,
    );
  if (fact.value === undefined)
    throw new Error(`task ${task.id}: fact ${fact.id} has no expected value`);
};

const validateTask = (task, directory) => {
  for (const key of ["id", "title", "question"]) requireText(task, key);
  if (task.id !== directory)
    throw new Error(`task ${task.id} is in a directory named ${directory}`);
  if (!Array.isArray(task.inputs))
    throw new Error(`task ${task.id}: inputs must be a list`);
  if (typeof task.answer?.fields !== "object" || task.answer.fields === null)
    throw new Error(`task ${task.id}: answer.fields is missing`);
  if (!Array.isArray(task.facts) || task.facts.length === 0)
    throw new Error(`task ${task.id}: facts must be a non-empty list`);
  for (const fact of task.facts) validateFact(task, fact);
  if (typeof task.first_command?.expected !== "string")
    throw new Error(`task ${task.id}: first_command.expected is missing`);
  return task;
};

/** One task by id, with `dir` set to its directory. */
export const loadTask = (id, root = TASKS_ROOT) => {
  const file = join(root, id, "task.json");
  if (!existsSync(file)) throw new Error(`no task ${id} under ${root}`);
  const task = validateTask(JSON.parse(readFileSync(file, "utf8")), id);
  return { ...task, dir: join(root, id) };
};

/** The ids of every task, in directory order. */
export const listTaskIds = (root = TASKS_ROOT) =>
  readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(root, entry.name, "task.json")),
    )
    .map((entry) => entry.name)
    .sort();

/** Replace `{name}` by `values.name` wherever a string holds one. */
export const fillPlaceholders = (value, values) => {
  if (typeof value === "string")
    return value.replaceAll(/\{([a-z_]+)\}/gu, (whole, name) =>
      name in values ? String(values[name]) : whole,
    );
  if (Array.isArray(value))
    return value.map((item) => fillPlaceholders(item, values));
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        fillPlaceholders(item, values),
      ]),
    );
  return value;
};

// "12" and 12 are one answer, " a  b " and "a b" are one answer; a fact that
// sets ignore_case also folds letter case. Nothing else is forgiven.
const normalScalar = (value, fact) => {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return value;
  const text = value.trim().replaceAll(/\s+/gu, " ");
  return fact.ignore_case === true ? text.toLowerCase() : text;
};

const sameScalar = (actual, expected, fact) =>
  normalScalar(actual, fact) === normalScalar(expected, fact);

const sameList = (actual, expected, fact) =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  expected.every((item, index) => sameScalar(actual[index], item, fact));

const sameSet = (actual, expected, fact) => {
  if (!Array.isArray(actual)) return false;
  const key = (item) => JSON.stringify(normalScalar(item, fact));
  const left = new Set(actual.map(key));
  const right = new Set(expected.map(key));
  return (
    left.size === actual.length &&
    left.size === right.size &&
    [...right].every((item) => left.has(item))
  );
};

const factHolds = (actual, fact) => {
  if (actual === undefined || actual === null) return false;
  if (fact.check === "set_equals") return sameSet(actual, fact.value, fact);
  if (fact.check === "list_equals") return sameList(actual, fact.value, fact);
  if (fact.check === "one_of")
    return fact.value.some((option) => sameScalar(actual, option, fact));
  return Array.isArray(fact.value)
    ? sameList(actual, fact.value, fact)
    : sameScalar(actual, fact.value, fact);
};

/**
 * Judge an answer (the parsed answer file, or null when there is none or it
 * is not a JSON object) against every expected fact of a task.
 */
export const judgeAnswer = (task, answer) => {
  const usable =
    typeof answer === "object" && answer !== null && !Array.isArray(answer);
  const facts = task.facts.map((fact) => ({
    id: fact.id,
    field: fact.field,
    right: usable && factHolds(answer[fact.field], fact),
    expected: fact.value,
    answered: usable ? (answer[fact.field] ?? null) : null,
  }));
  const right = facts.filter((fact) => fact.right).length;
  return {
    answer_readable: usable,
    facts,
    facts_right: right,
    facts_total: facts.length,
    right: right === facts.length,
  };
};

/** Whether a version such as "v24.22.3" is at least a minimum such as "24.15.0". */
export const versionAtLeast = (version, minimum) => {
  const parts = (text) => text.replace(/^v/u, "").split(".").map(Number);
  const [have, need] = [parts(version), parts(minimum)];
  for (let index = 0; index < need.length; index++) {
    if ((have[index] ?? 0) > need[index]) return true;
    if ((have[index] ?? 0) < need[index]) return false;
  }
  return true;
};

// Commands an agent runs to find its way, not to answer the request.
const DISCOVERY = new Set([
  "guidance",
  "setup",
  "doctor",
  "capabilities",
  "providers",
  "guided-workflows",
  "mcp",
]);

/**
 * The first REA command an agent ran to work on the request, against the one
 * the task expects. Help, schema and guidance calls before it are counted,
 * not judged. `result` is "expected", "accepted" (a first step the task also
 * allows), "other" or "none" (the agent ran no working REA command).
 */
export const firstCommandOf = (task, invocations) => {
  const working = (item) =>
    item.mode === "run" &&
    item.command !== null &&
    !DISCOVERY.has(item.command);
  const index = invocations.findIndex(working);
  const first = index === -1 ? null : invocations[index];
  const { expected, also_accepted: accepted = [] } = task.first_command;
  const flags = task.first_command.economical_flags;
  const result =
    first === null
      ? expected === "(none)"
        ? "expected"
        : "none"
      : first.command === expected
        ? "expected"
        : accepted.includes(first.command)
          ? "accepted"
          : "other";
  return {
    expected,
    also_accepted: accepted,
    first_invocation: invocations[0]?.key ?? null,
    first_working_command: first?.command ?? null,
    first_working_text: first?.text ?? null,
    result,
    economical:
      flags === undefined || first === null
        ? null
        : flags.some((flag) => first.text.includes(flag)),
    rea_calls_before_it: index === -1 ? invocations.length : index,
  };
};
