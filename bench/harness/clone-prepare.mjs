#!/usr/bin/env node
// Prepares one clone-benchmark cell: a workspace for the agent under test
// (throwaway home with the skill installed, a `rea` shim for the checkout
// under test, empty clone and run folders), the original started from a
// private copy outside that workspace, and the prompt the agent receives.
//
//   node bench/harness/clone-prepare.mjs --app <id> --workspace <dir>
//        --rea <checkout> --client <id> --clone-name <name>
//        --original-port <n> --clone-port <n>
//        [--id <cell id>] [--cell-dir <dir>] [--node <node>] [--minutes <n>]
//        [--forbid <path>]... [--agent <label>] [--spare-ports <text>] [--browser <path>]
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_AGENT_LABEL, checkAgentLabel } from "./lib/agent-label.mjs";
import { controlOriginal, copyOriginal, loadApp } from "./lib/clone-app.mjs";
import { clonePrompt } from "./lib/prompts.mjs";
import { portOpen } from "./lib/service.mjs";
import { BENCH_ROOT } from "./lib/tasks.mjs";
import { createWorkspace, writeCell } from "./lib/workspace.mjs";

const USAGE = `usage: clone-prepare.mjs --app <id> --workspace <dir> --rea <checkout> --client <id>
       --clone-name <name> --original-port <n> --clone-port <n>
       [--id <cell id>] [--cell-dir <dir>] [--node <node>] [--minutes <n>]
       [--forbid <path>]... [--agent <label>] [--spare-ports <text>] [--browser <path>]`;

const REQUIRED = [
  "app",
  "workspace",
  "rea",
  "client",
  "clone-name",
  "original-port",
  "clone-port",
];

const options = () => {
  const { values } = parseArgs({
    options: {
      app: { type: "string" },
      workspace: { type: "string" },
      rea: { type: "string" },
      client: { type: "string" },
      "clone-name": { type: "string" },
      "original-port": { type: "string" },
      "clone-port": { type: "string" },
      id: { type: "string" },
      "cell-dir": { type: "string" },
      node: { type: "string", default: process.execPath },
      minutes: { type: "string", default: "80" },
      forbid: { type: "string", multiple: true, default: [] },
      agent: { type: "string", default: DEFAULT_AGENT_LABEL },
      "spare-ports": { type: "string" },
      browser: {
        type: "string",
        default:
          process.env.REA_BROWSER_EXECUTABLE ?? "/opt/pw-browsers/chromium",
      },
    },
  });
  if (REQUIRED.some((key) => values[key] === undefined)) throw new Error(USAGE);
  return values;
};

// The agent is given one command for the original, with the cell's port in
// it, so that no call of the control script can start it on another port.
const writeControl = (cellDir, ctl, port) => {
  const control = join(cellDir, "original-ctl.sh");
  writeFileSync(
    control,
    `#!/bin/sh\n# Controls this cell's original: start | stop | reset | health\nPORT=${port} exec bash '${ctl}' "$@"\n`,
  );
  chmodSync(control, 0o755);
  return control;
};

const startOriginal = async (app, paths, port) => {
  if (await portOpen(port))
    throw new Error(`port ${port} is taken: the original was not started`);
  const ctl = copyOriginal(app, join(paths.cell, "original"));
  const control = writeControl(paths.cell, ctl, port);
  const started = controlOriginal(ctl, port, "reset");
  const health = controlOriginal(ctl, port, "health");
  if (!started.ok || !health.ok)
    throw new Error(
      `the original did not start on port ${port}: ${started.output} ${health.output}`,
    );
  return { control, ctl, health: health.output };
};

const main = async () => {
  const values = options();
  const app = loadApp(values.app);
  const originalPort = Number(values["original-port"]);
  const clonePort = Number(values["clone-port"]);
  const { paths, rea, skill, forbidden } = createWorkspace({
    workspace: values.workspace,
    cellDir: values["cell-dir"],
    checkout: values.rea,
    node: values.node,
    client: values.client,
    benchRepository: resolve(BENCH_ROOT, ".."),
    forbid: values.forbid,
  });
  const cloneRoot = join(paths.workspace, "clone");
  const runDir = join(paths.workspace, "run");
  mkdirSync(cloneRoot);
  mkdirSync(runDir);
  const original = await startOriginal(app, paths, originalPort);
  forbidden.at(-1).allow_running = [original.control, original.ctl];
  const id = values.id ?? `${app.id}-${rea.commit_short ?? rea.version}`;
  const address = `http://127.0.0.1:${originalPort}`;
  const description = {
    kind: "clone",
    id,
    agent: checkAgentLabel(values.agent),
    label: `bench:clone:${id}`,
    created_at: new Date().toISOString(),
    app: app.id,
    product_names: app.product_names,
    public_description: app.public_description.replaceAll("{address}", address),
    original: { address, port: originalPort, control: original.control },
    clone: {
      name: values["clone-name"],
      root: cloneRoot,
      port: clonePort,
      address: `http://127.0.0.1:${clonePort}`,
    },
    run_dir: runDir,
    skill_dir: skill.skill_dir,
    skill,
    rea,
    browser: values.browser,
    minutes: Number(values.minutes),
    spare_ports: values["spare-ports"] ?? null,
    forbidden,
    off_limits: forbidden
      .filter((root) => root.kind !== "cell-private")
      .map((root) => root.path),
  };
  const prompt = clonePrompt({
    ...description,
    workspace: paths.workspace,
    cell_dir: paths.cell,
  });
  const cell = writeCell(paths, prompt, description);
  console.log(
    JSON.stringify(
      {
        cell: cell.id,
        label: cell.label,
        workspace: cell.workspace,
        cell_file: paths.cell_file,
        prompt_file: paths.prompt_file,
        original: `${address} (${original.health})`,
        rea: `${rea.checkout} @ ${rea.commit_short} on ${rea.node_version}`,
        skill_dir: skill.skill_dir,
        layout_problems: app.layout_problems,
      },
      null,
      1,
    ),
  );
};

await main();
