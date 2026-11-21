// Clone-loop rows on the measured checkout's own fixture pair
// (tests/fixtures/cloneRun): one scenario's loop of init, evaluations and the
// capture commands exactly as the referee prints them; a verdict with a
// ten-item worklist; the size of behavior/; and the playbook's one-step read.
// A port of the audit's census-cli-output scripts/cloneloop.mjs.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { reaEnvironment, run, runRea } from "../lib/process.mjs";
import { measuredRow, skippedRow } from "../lib/rows.mjs";
import { sumUnits } from "../lib/units.mjs";

const ORIGINAL_NAME = "Quillbrook";
const CLONE_NAME = "Tidewater";
const MAIN_SCENARIO = "topics";
const MAX_ROUNDS = 8;

const waitForServer = async (origin, child) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error(`fixture server exited (${child.exitCode})`);
    try {
      await fetch(origin, { signal: AbortSignal.timeout(1_000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`fixture server at ${origin} did not answer`);
};

/** One fixture server as a child process; restart returns it to its start state. */
const site = (context, script, port) => {
  const origin = `http://127.0.0.1:${port}`;
  let child;
  const start = async () => {
    child = spawn(context.node, [script], {
      env: { PATH: process.env.PATH, PORT: String(port) },
      stdio: "ignore",
    });
    await waitForServer(origin, child);
  };
  const stop = async () => {
    if (
      child === undefined ||
      child.exitCode !== null ||
      child.signalCode !== null
    )
      return;
    const gone = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await gone;
    clearTimeout(timer);
  };
  return {
    origin,
    start,
    stop,
    restart: async () => (await stop(), await start()),
  };
};

const directoryBytes = (directory) =>
  existsSync(directory)
    ? readdirSync(directory).reduce((total, name) => {
        const path = join(directory, name);
        const stat = statSync(path);
        return total + (stat.isDirectory() ? directoryBytes(path) : stat.size);
      }, 0)
    : 0;

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

const copyScenario = (fixtures, runDirectory, scenario) => {
  for (const kind of ["scenarios", "obligations"])
    copyFileSync(
      join(fixtures, "run", kind, `${scenario}.json`),
      join(runDirectory, kind, `${scenario}.json`),
    );
};

/** The fixture's declared differences plus the rename init scaffolded, as the repository's e2e run does. */
const declareDifferences = (fixtures, runDirectory) => {
  const path = join(runDirectory, "intended-differences.json");
  const declared = readJson(join(fixtures, "run", "declared-differences.json"));
  const scaffolded = readJson(path);
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        ...scaffolded,
        renames: [...(declared.renames ?? []), ...(scaffolded.renames ?? [])],
        volatile_fields: declared.volatile_fields ?? scaffolded.volatile_fields,
      },
      null,
      2,
    )}\n`,
  );
};

const isCapture = ({ command }) =>
  command?.includes(" capture-browser-scenario ") === true;
const sideOf = ({ side, command }) =>
  side ?? /\/rendered\/(original|clone)\//u.exec(command)?.[1];

/** Run the loop; returns every stdout an agent would read, in order. */
const loop = async (context, layout, sites) => {
  const outputs = [];
  const rea = (label, args) => {
    const result = runRea(context, [...args, "--json"], {
      cwd: layout.root,
      env: layout.env,
      timeoutMs: 240_000,
    });
    context.keep(`clone/${outputs.length + 1}-${label}.out`, result.stdout);
    outputs.push({ label, exit: result.exit, stdout: result.stdout });
    return result;
  };
  const init = rea("init-clone-run", [
    "init-clone-run",
    layout.run,
    "--original",
    sites.original.origin,
    "--clone",
    sites.clone.origin,
    "--clone-root",
    layout.cloneRoot,
    "--clone-name",
    CLONE_NAME,
    "--original-name",
    ORIGINAL_NAME,
    "--authorization",
    "The original is a fixture of this repository.",
    "--stated-by",
    "context-ledger",
    "--browser",
    context.browser,
    "--original-reset",
    "./sites.sh restart original",
    "--clone-reset",
    "./sites.sh restart clone",
  ]);
  if (init.exit !== 0)
    throw new Error(
      `init-clone-run failed: ${init.stdout.slice(0, 400)}${init.stderr.slice(0, 400)}`,
    );
  rea("evaluate-clone-run (empty folder)", [
    "evaluate-clone-run",
    layout.run,
    "--exit-code",
  ]);
  copyScenario(layout.fixtures, layout.run, MAIN_SCENARIO);
  declareDifferences(layout.fixtures, layout.run);
  let captures = 0;
  let verdict;
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const gate = JSON.parse(
      rea(`evaluate-clone-run round ${round}`, [
        "evaluate-clone-run",
        layout.run,
        "--exit-code",
      ]).stdout,
    );
    verdict = gate.verdict;
    if (verdict === "done" || verdict === "done_with_waivers") break;
    const pending = [
      ...new Map(
        (gate.next ?? []).filter(isCapture).map((item) => [item.command, item]),
      ).values(),
    ];
    if (pending.length === 0) break;
    for (const item of pending) {
      await sites[sideOf(item)].restart();
      captures += 1;
      const result = run("/bin/sh", ["-c", item.command], {
        cwd: layout.root,
        env: layout.env,
        timeoutMs: 300_000,
      });
      context.keep(
        `clone/${outputs.length + 1}-capture-${captures}.out`,
        result.stdout,
      );
      outputs.push({
        label: `capture ${captures} (${sideOf(item)})`,
        exit: result.exit,
        stdout: result.stdout,
      });
    }
  }
  return { outputs, verdict, captures };
};

/** A second folder with two more scenarios and a clone edited after capture. */
const tenItemVerdict = (context, layout) => {
  const runB = join(layout.root, "run-b");
  cpSync(layout.run, runB, { recursive: true });
  for (const scenario of ["download", "export"])
    copyScenario(layout.fixtures, runB, scenario);
  const edited = join(layout.cloneRoot, "server.mjs");
  writeFileSync(
    edited,
    `${readFileSync(edited, "utf8")}\n// edited after capture\n`,
  );
  const result = runRea(
    context,
    ["evaluate-clone-run", runB, "--exit-code", "--json"],
    { cwd: layout.root, env: layout.env },
  );
  context.keep("clone/run-b-evaluate.out", result.stdout);
  let items = null;
  try {
    items = JSON.parse(result.stdout).next?.length ?? null;
  } catch {
    items = null;
  }
  return measuredRow("clone.verdict.ten-items", {
    units: { ...context.count(result.stdout), chars: result.stdout.length },
    detail: {
      exit: result.exit,
      worklist_items: items,
      note: `the verdict lists ${items ?? "an unknown number of"} items (the audit's had ten)`,
    },
  });
};

const stepRead = (context, layout) => {
  const folder = join(layout.run, "evidence", "original", MAIN_SCENARIO);
  const first = existsSync(folder)
    ? readdirSync(folder)
        .filter((name) => name.endsWith(".json"))
        .sort()[0]
    : undefined;
  if (first === undefined)
    return skippedRow(
      "clone.step-read",
      "the loop left no original capture to read",
    );
  const view = {
    source: {
      kind: "evidence-file",
      path: `evidence/original/${MAIN_SCENARIO}/${first}`,
    },
    view: {
      kind: "browser-scenario",
      collection: "text",
      step_index: 1,
      artifact: "accessibility",
    },
  };
  const result = runRea(
    context,
    ["inspect-analysis-view", JSON.stringify(view), "--json"],
    { cwd: layout.run, env: layout.env },
  );
  context.keep("clone/step-read.out", result.stdout);
  return measuredRow("clone.step-read", {
    units: context.count(result.stdout),
    detail: { exit: result.exit },
  });
};

export const CLONE_ROWS = [
  "clone.loop.stdout",
  "clone.verdict.ten-items",
  "clone.behavior",
  "clone.step-read",
];

/** A `rea` on PATH, so printed commands read `rea ...` whatever the checkout's path. */
const reaShim = (context, root) => {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const shim = join(bin, "rea");
  writeFileSync(
    shim,
    `#!/bin/sh\nexec '${context.node}' '${context.reaScript}' "$@"\n`,
  );
  chmodSync(shim, 0o755);
  return bin;
};

export const cloneRows = async (context, wanted) => {
  const ids = CLONE_ROWS.filter(wanted);
  if (context.browser === undefined || !existsSync(context.browser))
    return ids.map((id) =>
      skippedRow(
        id,
        "no browser: pass --browser or set REA_BROWSER_EXECUTABLE",
      ),
    );
  const fixtures = join(context.checkout, "tests", "fixtures", "cloneRun");
  if (!existsSync(join(fixtures, "clone", "server.mjs")))
    return ids.map((id) => skippedRow(id, `${fixtures} has no fixture pair`));
  const root = join(context.work, "clone");
  const cloneRoot = join(root, "clone");
  cpSync(join(fixtures, "clone"), cloneRoot, { recursive: true });
  const bin = reaShim(context, root);
  // Chromium refuses a socket path over about 100 bytes, so the browser's
  // temporary files go to a short directory named after the work folder.
  const shortTmp = join(
    tmpdir(),
    `rea-ledger-${createHash("sha256").update(root).digest("hex").slice(0, 8)}`,
  );
  rmSync(shortTmp, { recursive: true, force: true });
  mkdirSync(shortTmp, { recursive: true });
  const layout = {
    root,
    run: join(root, "run"),
    cloneRoot,
    fixtures,
    env: reaEnvironment(root, {
      PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      REA_BROWSER_EXECUTABLE: context.browser,
      REA_BROWSER_NO_SANDBOX: process.env.REA_BROWSER_NO_SANDBOX ?? "true",
      TMPDIR: shortTmp,
    }),
  };
  const sites = {
    original: site(
      context,
      join(fixtures, "original", "server.mjs"),
      context.port,
    ),
    clone: site(context, join(cloneRoot, "server.mjs"), context.port + 1),
  };
  context.progress("clone loop (fixture pair, one scenario)");
  try {
    await sites.original.start();
    await sites.clone.start();
    const { outputs, verdict, captures } = await loop(context, layout, sites);
    const rows = [];
    if (wanted("clone.loop.stdout"))
      rows.push(
        measuredRow("clone.loop.stdout", {
          units: sumUnits(outputs.map(({ stdout }) => context.count(stdout))),
          detail: {
            verdict,
            captures,
            note: `verdict ${verdict} after ${captures} captures`,
            outputs: outputs.map(({ label, exit, stdout }) => ({
              label,
              exit,
              ...context.count(stdout),
            })),
          },
        }),
      );
    if (wanted("clone.behavior"))
      rows.push(
        measuredRow("clone.behavior", {
          value: directoryBytes(join(layout.run, "behavior")),
          units: {
            bytes: directoryBytes(join(layout.run, "behavior")),
            tokenx: null,
            o200k: null,
          },
        }),
      );
    if (wanted("clone.step-read")) rows.push(stepRead(context, layout));
    if (wanted("clone.verdict.ten-items"))
      rows.push(tenItemVerdict(context, layout));
    return rows;
  } finally {
    await sites.clone.stop();
    await sites.original.stop();
    rmSync(shortTmp, { recursive: true, force: true });
  }
};
