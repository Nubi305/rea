// The workflow scripts, run with a stand-in for the workflow tool: no agent
// is launched. A script is the body of an async function that is given
// agent(), parallel(), log(), phase() and args, and begins with a literal
// `export const meta`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, same } from "./kit.mjs";

const WORKFLOWS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "workflows",
);
const AsyncFunction = (async () => {}).constructor;

const runScript = async (name, args) => {
  const source = readFileSync(join(WORKFLOWS, name), "utf8");
  if (!source.startsWith("export const meta = {"))
    throw new Error(`${name} does not begin with export const meta`);
  const calls = [];
  const agent = async (prompt, options) => {
    calls.push({ prompt, options });
    return { summary: `report of ${options.label}` };
  };
  const parallel = (thunks) => Promise.all(thunks.map((thunk) => thunk()));
  const body = new AsyncFunction(
    "tools",
    `const { agent, parallel, log, phase, args } = tools;\n${source.replace("export const meta", "const meta")}`,
  );
  const result = await body({
    agent,
    parallel,
    log: () => {},
    phase: () => {},
    args,
  });
  return { result, calls };
};

// The tool reads meta without running the script: it must be a literal.
const metaOf = (name) => {
  const source = readFileSync(join(WORKFLOWS, name), "utf8");
  const literal = source.slice(
    source.indexOf("{"),
    source.indexOf("\n};") === -1
      ? source.indexOf("\n}") + 2
      : source.indexOf("\n};") + 2,
  );
  return new Function(`"use strict"; return (${literal});`)();
};

const NAME = "bench-cells.js";

const checkAgents = async () => {
  const cells = [
    {
      kind: "clone",
      label: "bench:x:one",
      agent: "label-one",
      prompt: "first prompt",
      model: "model-one",
    },
    { kind: "task", label: "bench:x:two", prompt: "second prompt" },
  ];
  const { result, calls } = await runScript(NAME, { cells });
  same(
    "workflow: one agent per cell, under the cell's label, model and phase",
    calls.map((item) => [
      item.prompt,
      item.options.label,
      item.options.model ?? null,
      item.options.phase,
    ]),
    [
      ["first prompt", "bench:x:one", "model-one", "Clone"],
      ["second prompt", "bench:x:two", null, "Tasks"],
    ],
  );
  same(
    "workflow: a clone cell and a task cell report through their own schemas",
    calls.map((item) => item.options.schema.required.includes("outcome")),
    [true, false],
  );
  same(
    "workflow: the result names each cell and its agent label, never its model",
    result.map((item) => [
      item.label,
      item.kind,
      item.agent,
      item.report.summary,
      JSON.stringify(item).includes("model"),
    ]),
    [
      ["bench:x:one", "clone", "label-one", "report of bench:x:one", false],
      ["bench:x:two", "task", "unlabelled", "report of bench:x:two", false],
    ],
  );
};

const refuses = async (args) => {
  try {
    await runScript(NAME, args);
    return false;
  } catch {
    return true;
  }
};

export const checkWorkflows = async () => {
  await checkAgents();
  check("workflow: refuses to run without cells", await refuses({ cells: [] }));
  check(
    "workflow: refuses a cell of an unknown kind",
    await refuses({ cells: [{ kind: "other", label: "x", prompt: "y" }] }),
  );
  const meta = metaOf(NAME);
  same(
    "workflow: meta is a literal with the phases the script uses",
    [
      typeof meta.name,
      typeof meta.description,
      meta.phases.map((item) => item.title),
    ],
    ["string", "string", ["Clone", "Tasks"]],
  );
};
