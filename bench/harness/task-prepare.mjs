#!/usr/bin/env node
// Prepares task-benchmark cells: for each task a workspace for the agent
// under test (throwaway home with the skill installed, a `rea` shim for the
// checkout under test, the task's inputs built from their sources) and the
// prompt the agent receives. A task that observes a page gets its server
// started from a private copy outside the workspace.
//
//   node bench/harness/task-prepare.mjs --root <dir> --rea <checkout> --client <id>
//        [--task <id>]... [--tag <text>] [--node <node>] [--minutes <n>]
//        [--port <n>] [--forbid <path>]... [--browser <path>]
//
// One cell per task: <root>/<task id> is the workspace and
// <root>/<task id>.cell holds the prompt and the cell description.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildInputs, missingInputTools } from "./lib/inputs.mjs";
import { checkoutFacts } from "./lib/proc.mjs";
import { taskPrompt } from "./lib/prompts.mjs";
import { startNodeService } from "./lib/service.mjs";
import {
  BENCH_ROOT,
  fillPlaceholders,
  listTaskIds,
  loadTask,
  versionAtLeast,
} from "./lib/tasks.mjs";
import { createWorkspace, writeCell } from "./lib/workspace.mjs";

const USAGE = `usage: task-prepare.mjs --root <dir> --rea <checkout> --client <id>
       [--task <id>]... [--tag <text>] [--node <node>] [--minutes <n>]
       [--port <n>] [--forbid <path>]... [--browser <path>]`;

const options = () => {
  const { values } = parseArgs({
    options: {
      root: { type: "string" },
      rea: { type: "string" },
      client: { type: "string" },
      task: { type: "string", multiple: true },
      tag: { type: "string" },
      node: { type: "string", default: process.execPath },
      minutes: { type: "string", default: "20" },
      port: { type: "string", default: "5330" },
      forbid: { type: "string", multiple: true, default: [] },
      browser: {
        type: "string",
        default:
          process.env.REA_BROWSER_EXECUTABLE ?? "/opt/pw-browsers/chromium",
      },
    },
  });
  if (!values.root || !values.rea || !values.client) throw new Error(USAGE);
  return values;
};

// The page's server runs from a private copy: the agent is asked what the
// page does, not what its source says.
const startService = async (task, paths, port) => {
  const site = join(paths.cell, "site");
  cpSync(join(task.dir, dirname(task.service.script)), site, {
    recursive: true,
  });
  const service = await startNodeService({
    script: join(site, task.service.script.split("/").at(-1)),
    port,
    healthPath: task.service.health_path,
    recordFile: join(paths.cell, "service.json"),
    logFile: join(paths.cell, "service.log"),
  });
  return {
    address: service.address,
    port,
    record_file: join(paths.cell, "service.json"),
  };
};

const prepareTask = async (task, values, port) => {
  const { paths, rea, skill, forbidden } = createWorkspace({
    workspace: join(values.root, task.id),
    checkout: values.rea,
    node: values.node,
    client: values.client,
    benchRepository: resolve(BENCH_ROOT, ".."),
    forbid: values.forbid,
  });
  const inputDir = join(paths.workspace, "input");
  mkdirSync(inputDir);
  const inputFiles = buildInputs(task.inputs, {
    taskDir: task.dir,
    outDir: inputDir,
  });
  const service =
    task.service === undefined ? null : await startService(task, paths, port);
  const id = values.tag === undefined ? task.id : `${task.id}.${values.tag}`;
  const description = {
    kind: "task",
    id,
    label: `bench:task:${id}`,
    created_at: new Date().toISOString(),
    task: task.id,
    floor: task.floor === true,
    question: fillPlaceholders(task.question, {
      input: inputDir,
      address: service?.address ?? "",
    }),
    input_dir: inputDir,
    input_files: inputFiles,
    answer_file: join(paths.workspace, "answer.json"),
    answer_fields: task.answer.fields,
    service,
    skill_dir: skill.skill_dir,
    skill,
    rea,
    browser: task.needs_browser === true ? values.browser : null,
    minutes: Number(values.minutes),
    forbidden,
    off_limits: forbidden
      .filter((root) => root.kind !== "cell-private")
      .map((root) => root.path),
  };
  const prompt = taskPrompt({
    ...description,
    workspace: paths.workspace,
    cell_dir: paths.cell,
  });
  return writeCell(paths, prompt, description);
};

// Why a task cannot be prepared with this node and these tools, or null.
const blocker = (task, rea) => {
  const missing = missingInputTools(task.inputs);
  if (missing.length > 0) return `needs ${missing.join(", ")} on PATH`;
  const minimum = task.requires?.rea_node;
  if (minimum !== undefined && !versionAtLeast(rea.node_version, minimum))
    return `REA answers it only on Node ${minimum} or newer; --node is ${rea.node_version}`;
  return null;
};

const main = async () => {
  const values = options();
  mkdirSync(values.root, { recursive: true });
  const prepared = [];
  const skipped = [];
  let port = Number(values.port);
  const rea = checkoutFacts(values.rea, values.node);
  for (const id of values.task ?? listTaskIds()) {
    const task = loadTask(id);
    const reason = blocker(task, rea);
    if (reason !== null) {
      skipped.push({ task: id, reason });
      continue;
    }
    const cell = await prepareTask(task, values, port);
    if (cell.service !== null) port += 1;
    prepared.push({
      cell: cell.id,
      label: cell.label,
      workspace: cell.workspace,
      prompt_file: cell.prompt_file,
      service: cell.service?.address ?? null,
    });
  }
  console.log(
    JSON.stringify({ root: resolve(values.root), prepared, skipped }, null, 1),
  );
  if (skipped.length > 0) process.exitCode = 2;
};

await main();
