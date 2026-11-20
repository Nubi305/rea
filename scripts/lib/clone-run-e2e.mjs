import assert from "node:assert/strict";
import {
  appendFile,
  copyFile,
  cp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import { PrivateRuntimeRoot } from "../../dist/process/PrivateRuntimeRoot.js";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";
import { createPackageVerifierCommands } from "./verify-package-commands.mjs";

const FIXTURES = fileURLToPath(
  new URL("../../tests/fixtures/cloneRun/", import.meta.url),
);
const ORIGINAL_NAME = "Quillbrook";
const CLONE_NAME = "Tidewater";
const MAIN_SCENARIO = "topics";
const OVERSIZE_SCENARIO = "export";
const OVERSIZE_STEP = "export-all";

/**
 * Each fixture server runs in a worker thread, so a restart loads the clone's
 * files as they are now and no child process outlives the verifier.
 */
const SITE_WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
import(workerData.module)
  .then((module) => module[workerData.start]({ port: workerData.port }))
  .then((site) => parentPort.postMessage(site.origin));
`;

/** Serve one fixture on a loopback port it picks; `restart` returns it to its start state on the same port. */
const startSite = async (modulePath, start) => {
  let port = 0;
  const launch = () =>
    new Promise((resolve, reject) => {
      const worker = new Worker(SITE_WORKER, {
        eval: true,
        workerData: { module: pathToFileURL(modulePath).href, start, port },
      });
      worker.once("error", reject);
      worker.once("message", (origin) => resolve({ worker, origin }));
    });
  let current = await launch();
  const { origin } = current;
  port = Number(new URL(origin).port);
  return {
    origin,
    restart: async () => {
      await current.worker.terminate();
      current = await launch();
      assert.equal(current.origin, origin, "a restarted fixture kept its port");
    },
    close: () => current.worker.terminate(),
  };
};

const shellQuote = (text) => `'${text.replaceAll("'", "'\\''")}'`;

const reasonsOf = (gate) => gate.blocking.map(({ reason }) => reason);

const describeGate = ({ exit, gate }) =>
  `exit ${exit}, ${gate.summary}; blocking ${JSON.stringify(gate.blocking)}; next ${JSON.stringify(
    gate.next.map(({ reason, side, step_id, pointer, message }) => ({
      reason,
      side,
      step_id,
      pointer,
      message,
    })),
  )}`;

const isCapture = ({ command }) =>
  command.includes(" capture-browser-scenario ");
const isRemoval = ({ command }) => command.startsWith("rm ");
const sideOf = ({ side, command }) =>
  side ?? /\/rendered\/(original|clone)\//u.exec(command)?.[1];
const distinctCommands = (items) => [
  ...new Map(items.map((item) => [item.command, item])).values(),
];

/** Everything one verification run shares: the folder, both servers and the command owner. */
const createContext = async (executable, entrypoint, root, commands) => {
  const cloneRoot = join(root.path, "clone");
  await cp(join(FIXTURES, "clone"), cloneRoot, { recursive: true });
  const sites = {
    original: await startSite(
      join(FIXTURES, "original", "server.mjs"),
      "startOriginal",
    ),
    clone: undefined,
  };
  try {
    sites.clone = await startSite(join(cloneRoot, "server.mjs"), "startBoard");
  } catch (cause) {
    await sites.original.close();
    throw cause;
  }
  const environment = {
    ...process.env,
    REA_LOG_LEVEL: "silent",
    HOPPER_LAUNCHER_PATH: "/rea-unconfigured-provider/hopper",
  };
  const exec = async (command, args) => {
    try {
      const { stdout } = await commands.exec(command, args, {
        env: environment,
        timeout: 240_000,
        maxBuffer: 64 * 1024 * 1024,
      });
      return { exit: 0, stdout };
    } catch (cause) {
      if (
        !(cause instanceof Error) ||
        cause.name !== "VerifierCommandExitError"
      )
        throw cause;
      return {
        exit: cause.code,
        stdout: cause.snapshot.stdout.text,
        stderr: cause.snapshot.stderr.text,
      };
    }
  };
  const run = join(root.path, "run");
  const context = {
    executable,
    run,
    cloneRoot,
    sites,
    reaCommand: `${shellQuote(process.execPath)} ${shellQuote(entrypoint)}`,
    rea: (args) => exec(process.execPath, [entrypoint, ...args, "--json"]),
    /** Run a worklist command exactly as the referee printed it. */
    shell: async (command) => {
      const result = await exec("/bin/sh", ["-c", command]);
      assert.equal(
        result.exit,
        0,
        `worklist command failed: ${command}\n${result.stderr ?? ""}`,
      );
    },
    evaluate: async () => {
      const result = await context.rea([
        "evaluate-clone-run",
        run,
        "--exit-code",
      ]);
      const gate = JSON.parse(result.stdout);
      assert.ok(
        typeof gate.verdict === "string",
        `the referee refused: ${result.stdout}`,
      );
      return { exit: result.exit, gate };
    },
    /** Reset the side, then run the capture command of a worklist item. */
    capture: async (item, { reset = true } = {}) => {
      if (reset) await sites[sideOf(item)].restart();
      await context.shell(item.command);
    },
    /**
     * The team's loop: evaluate, run each distinct capture command of the
     * worklist after resetting its side, evaluate again. Reply bodies are
     * sometimes lost, so the number of captures is the referee's to say,
     * within a bound.
     */
    follow: async (until, maxCaptures = 12) => {
      let captures = 0;
      for (;;) {
        const result = await context.evaluate();
        if (until(result)) return result;
        const pending = distinctCommands(result.gate.next.filter(isCapture));
        if (pending.length === 0 || captures + pending.length > maxCaptures)
          return result;
        for (const item of pending) await context.capture(item);
        captures += pending.length;
      }
    },
    /** Run the removals the worklist asks for. */
    remove: async (gate, reason) => {
      const removals = distinctCommands(
        gate.next.filter((item) => item.reason === reason && isRemoval(item)),
      );
      assert.ok(removals.length > 0, `no removal command for ${reason}`);
      for (const { command } of removals) await context.shell(command);
    },
    expectDone: async (after) => {
      const result = await context.evaluate();
      assert.equal(
        result.exit,
        0,
        `${after}: expected done again; ${describeGate(result)}`,
      );
    },
  };
  return context;
};

/** The captures the referee admitted for one side of the main scenario, as its admission record lists them. */
const admitted = async (context, side) => {
  const record = JSON.parse(
    await readFile(
      join(context.run, "records", side, `${MAIN_SCENARIO}.json`),
      "utf8",
    ),
  );
  return record.files
    .filter(({ status }) => status === "admitted")
    .map(({ file }) => join(context.run, file));
};

/** `rea compare-scenario-behavior --exit-code` over the admitted captures of the main scenario. */
const compareMain = async (context) => {
  const files = async (flag, side) =>
    (await admitted(context, side)).flatMap((file) => [flag, file]);
  const compared = await context.rea([
    "compare-scenario-behavior",
    ...(await files("--left", "original")),
    ...(await files("--right", "clone")),
    "--differences",
    join(context.run, "intended-differences.json"),
    "--exit-code",
  ]);
  return { exit: compared.exit, comparison: JSON.parse(compared.stdout) };
};

const evidenceFile = (context, side, scenario, name) =>
  join(context.run, "evidence", side, scenario, name);

const addFixtureScenario = async (context, scenario) => {
  for (const kind of ["scenarios", "obligations"])
    await copyFile(
      join(FIXTURES, "run", kind, `${scenario}.json`),
      join(context.run, kind, `${scenario}.json`),
    );
};

const captureComplete = ({ gate }) =>
  !reasonsOf(gate).some(
    (reason) =>
      reason.startsWith("evidence_") || reason.startsWith("start_state_"),
  );

const initialise = async (context) => {
  const created = await context.rea([
    "init-clone-run",
    context.run,
    "--original",
    context.sites.original.origin,
    "--clone",
    context.sites.clone.origin,
    "--clone-root",
    context.cloneRoot,
    "--clone-name",
    CLONE_NAME,
    "--original-name",
    ORIGINAL_NAME,
    "--authorization",
    "The original is a fixture of this repository.",
    "--stated-by",
    "verify:clone-run",
    "--browser",
    context.executable,
    "--rea-command",
    context.reaCommand,
    // Every case below is a judged round of one run folder.
    "--max-rounds",
    "60",
  ]);
  assert.equal(created.exit, 0, created.stdout);
  await addFixtureScenario(context, MAIN_SCENARIO);
  const declared = JSON.parse(
    await readFile(join(FIXTURES, "run", "declared-differences.json"), "utf8"),
  );
  const path = join(context.run, "intended-differences.json");
  const scaffolded = JSON.parse(await readFile(path, "utf8"));
  // The longer text is renamed first: a later rename would no longer find it.
  await writeFile(
    path,
    `${JSON.stringify(
      {
        renames: [...declared.renames, ...scaffolded.renames],
        volatile_fields: declared.volatile_fields,
      },
      null,
      2,
    )}\n`,
  );
};

/** The acceptance cases, in the order one run folder lives through them. */
const CASES = [
  {
    name: "one capture per side: not done",
    run: async (context) => {
      const first = await context.evaluate();
      for (const side of ["original", "clone"]) {
        const item = first.gate.next.find(
          (candidate) => isCapture(candidate) && sideOf(candidate) === side,
        );
        assert.ok(
          item,
          `no capture command for the ${side}: ${describeGate(first)}`,
        );
        await context.capture(item);
      }
      const result = await context.evaluate();
      assert.equal(result.exit, 1, describeGate(result));
      assert.equal(result.gate.verdict, "not_done");
      assert.ok(
        reasonsOf(result.gate).includes("evidence_missing"),
        describeGate(result),
      );
      return `exit 1, ${result.gate.summary} (evidence_missing)`;
    },
  },
  {
    name: "matching clone: evaluate-clone-run --exit-code exits 0",
    run: async (context) => {
      const result = await context.follow(({ exit }) => exit === 0);
      assert.equal(result.exit, 0, describeGate(result));
      assert.equal(result.gate.verdict, "done");
      assert.deepEqual(
        Object.values(result.gate.checks),
        Array.from({ length: 8 }, () => "pass"),
      );
      assert.equal(result.gate.counts.steps.changed, 0);
      context.passGate = result.gate;
      const compared = await compareMain(context);
      assert.equal(compared.exit, 0, JSON.stringify(compared.comparison));
      assert.equal(compared.comparison.verdict, "unchanged");
      const { steps, evidence } = result.gate.counts;
      return `exit 0, ${steps.unchanged} steps unchanged, ${evidence.admitted} captures admitted, ${result.gate.declared.volatile_fields} volatile fields honoured; compare-scenario-behavior --exit-code exits 0`;
    },
  },
  {
    name: "one line appended to a clone file after a pass: stale",
    run: async (context) => {
      const file = join(context.cloneRoot, "views.mjs");
      const before = await readFile(file);
      await appendFile(file, "// edited after the captures\n");
      const result = await context.evaluate();
      assert.equal(result.exit, 1, describeGate(result));
      assert.ok(
        reasonsOf(result.gate).includes("evidence_stale"),
        describeGate(result),
      );
      await writeFile(file, before);
      await context.expectDone("after the edit was reverted");
      return `exit 1, ${result.gate.summary} (evidence_stale)`;
    },
  },
  {
    name: "an edited Evidence file: rejected",
    run: async (context) => {
      const bundle = JSON.parse(
        await readFile(
          evidenceFile(context, "clone", MAIN_SCENARIO, "run-1.json"),
          "utf8",
        ),
      );
      bundle.records[0].parameters.actions[0].path = "/api/topics?edited=1";
      await writeFile(
        evidenceFile(context, "clone", MAIN_SCENARIO, "edited.json"),
        JSON.stringify(bundle),
      );
      const result = await context.evaluate();
      assert.equal(result.exit, 1, describeGate(result));
      assert.ok(
        reasonsOf(result.gate).includes("evidence_rejected_integrity"),
        describeGate(result),
      );
      await context.remove(result.gate, "evidence_rejected_integrity");
      await context.expectDone("after the edited file was removed");
      return `exit 1, ${result.gate.summary} (evidence_rejected_integrity)`;
    },
  },
  {
    name: "a capture taken from the other side's address: rejected",
    run: async (context) => {
      await copyFile(
        evidenceFile(context, "original", MAIN_SCENARIO, "run-1.json"),
        evidenceFile(context, "clone", MAIN_SCENARIO, "from-original.json"),
      );
      const result = await context.evaluate();
      assert.equal(result.exit, 1, describeGate(result));
      assert.ok(
        reasonsOf(result.gate).includes("evidence_rejected_address"),
        describeGate(result),
      );
      await context.remove(result.gate, "evidence_rejected_address");
      await context.expectDone("after the misplaced capture was removed");
      return `exit 1, ${result.gate.summary} (evidence_rejected_address)`;
    },
  },
  {
    name: "the original's name left in the clone: forbidden name",
    run: async (context) => {
      const file = join(context.cloneRoot, "NOTICE.txt");
      await writeFile(file, `A port of ${ORIGINAL_NAME}.\n`);
      const result = await context.evaluate();
      assert.equal(result.exit, 1, describeGate(result));
      assert.ok(
        reasonsOf(result.gate).includes("clean_room_forbidden_name"),
        describeGate(result),
      );
      await rm(file);
      await context.expectDone("after the name was removed");
      return `exit 1, ${result.gate.summary} (clean_room_forbidden_name)`;
    },
  },
  {
    name: "one capture per side with a reply over the body limit: compare-scenario-behavior --exit-code exits 2",
    run: async (context) => {
      await addFixtureScenario(context, OVERSIZE_SCENARIO);
      const first = await context.evaluate();
      const pending = distinctCommands(first.gate.next.filter(isCapture));
      context.secondCaptures = [];
      for (const side of ["original", "clone"]) {
        const [now, later] = pending.filter((item) => sideOf(item) === side);
        assert.ok(
          later,
          `two capture commands for the ${side}: ${describeGate(first)}`,
        );
        await context.capture(now);
        context.secondCaptures.push(later);
      }
      const compared = await context.rea([
        "compare-scenario-behavior",
        "--left",
        evidenceFile(context, "original", OVERSIZE_SCENARIO, "run-1.json"),
        "--right",
        evidenceFile(context, "clone", OVERSIZE_SCENARIO, "run-1.json"),
        "--differences",
        join(context.run, "intended-differences.json"),
        "--scenario",
        OVERSIZE_SCENARIO,
        "--exit-code",
      ]);
      assert.equal(compared.exit, 2, compared.stdout);
      const comparison = JSON.parse(compared.stdout);
      assert.equal(comparison.verdict, "unknown");
      const step = comparison.steps.find(
        ({ step_id: id }) => id === OVERSIZE_STEP,
      );
      assert.equal(step?.status, "unknown", compared.stdout);
      assert.ok(
        step.findings.some(
          ({ dimension, category }) =>
            dimension === "body" && category === "not-recorded",
        ),
        compared.stdout,
      );
      return `exit 2, verdict unknown, step ${OVERSIZE_STEP} body not-recorded`;
    },
  },
  {
    name: "two captures with no reset between them: dirty start state",
    run: async (context) => {
      for (const item of context.secondCaptures)
        await context.capture(item, { reset: false });
      const result = await context.evaluate();
      assert.notEqual(result.exit, 0, describeGate(result));
      assert.ok(
        reasonsOf(result.gate).includes("start_state_dirty"),
        describeGate(result),
      );
      await context.remove(result.gate, "start_state_dirty");
      return `exit ${result.exit}, ${result.gate.summary} (start_state_dirty)`;
    },
  },
  {
    name: "two captures per side with a reply no capture recorded: not done (unknown)",
    run: async (context) => {
      const result = await context.follow(captureComplete);
      assert.notEqual(result.exit, 0, describeGate(result));
      assert.ok(captureComplete(result), describeGate(result));
      const item = result.gate.next.find(
        ({ reason, step_id: id }) =>
          reason === "parity_unknown" && id === OVERSIZE_STEP,
      );
      assert.ok(item, describeGate(result));
      for (const kind of ["scenarios", "obligations"])
        await rm(join(context.run, kind, `${OVERSIZE_SCENARIO}.json`));
      await context.expectDone("after the oversize scenario was withdrawn");
      return `exit ${result.exit}, ${result.gate.summary} (parity_unknown at ${OVERSIZE_STEP})`;
    },
  },
  {
    name: "mutant: exit 1 with a worklist item whose pointer ends in /slug",
    run: async (context) => {
      const change = JSON.parse(
        await readFile(join(FIXTURES, "mutant", "switch.json"), "utf8"),
      );
      const file = join(context.cloneRoot, change.file);
      const source = await readFile(file, "utf8");
      assert.equal(
        source.split(change.find).length,
        2,
        "the mutant switch applies once",
      );
      await writeFile(file, source.replace(change.find, change.replace));
      const result = await context.follow(captureComplete);
      assert.equal(result.exit, 1, describeGate(result));
      const item = result.gate.next.find(
        ({ reason, pointer }) =>
          reason === "parity_changed" && pointer?.endsWith("/slug"),
      );
      assert.ok(item, describeGate(result));
      context.mutantGate = result.gate;
      const compared = await compareMain(context);
      assert.equal(compared.exit, 1, JSON.stringify(compared.comparison));
      assert.equal(compared.comparison.verdict, "changed");
      return `exit 1, step ${item.step_id} ${item.dimension} ${item.pointer}: expected ${item.expected}, actual ${item.actual}; compare-scenario-behavior --exit-code exits 1`;
    },
  },
  {
    name: "a forged pass under the referee-only outputs, with a mutant clone: still not done",
    run: async (context) => {
      const gateFile = join(context.run, "gate.json");
      const parityFile = join(context.run, "parity", `${MAIN_SCENARIO}.json`);
      const parity = JSON.parse(await readFile(parityFile, "utf8"));
      await writeFile(
        gateFile,
        JSON.stringify({
          ...context.passGate,
          evaluated_at: new Date().toISOString(),
        }),
      );
      await writeFile(
        parityFile,
        JSON.stringify({
          ...parity,
          verdict: "unchanged",
          steps: parity.steps.map((step) => ({
            ...step,
            status: "unchanged",
            findings: [],
          })),
        }),
      );
      const result = await context.evaluate();
      assert.equal(result.exit, 1, describeGate(result));
      assert.equal(result.gate.verdict, "not_done");
      assert.deepEqual(result.gate.blocking, context.mutantGate.blocking);
      const rewritten = JSON.parse(await readFile(gateFile, "utf8"));
      assert.equal(rewritten.verdict, "not_done");
      return `exit 1, ${result.gate.summary}; gate.json and parity/ were recomputed`;
    },
  },
];

/**
 * Drive the three clone-run commands against the fixture original, its
 * renamed clone and the slug mutant with a real browser, and report one line
 * per acceptance case. A failed case stops the run, because each case starts
 * from the state the one before it left.
 * @param {string} executable Chromium executable the capture inputs launch.
 * @param {(line: string) => void} report
 * @param {string} [entrypoint]
 */
export async function verifyCloneRun(
  executable,
  report,
  entrypoint = fileURLToPath(new URL("../rea.mjs", import.meta.url)),
) {
  let root;
  let commands;
  let context;
  const proof = async () => {
    root = await PrivateRuntimeRoot.create({ prefix: "rea-clone-run-e2e-" });
    commands = await createPackageVerifierCommands({ workspace: root });
    context = await createContext(executable, entrypoint, root, commands);
    await initialise(context);
    const cases = [];
    let failed = false;
    for (const { name, run } of CASES) {
      if (failed) {
        report(`not run: ${name}`);
        cases.push({ name, outcome: "not-run" });
        continue;
      }
      const startedAt = performance.now();
      try {
        const detail = await run(context);
        report(`pass: ${name} -- ${detail}`);
        cases.push({
          name,
          outcome: "passed",
          detail,
          seconds: Math.round((performance.now() - startedAt) / 100) / 10,
        });
      } catch (cause) {
        failed = true;
        const reason = cause instanceof Error ? cause.message : String(cause);
        report(`FAIL: ${name} -- ${reason}`);
        cases.push({ name, outcome: "failed", reason });
      }
    }
    return { cases, verified: !failed };
  };
  // The owner stops its commands' processes before removing the root; the fixture servers stop with their workers.
  return withVerifierCleanup(proof, [
    () => (commands === undefined ? root?.close() : commands.close()),
    () => context?.sites.original.close(),
    () => context?.sites.clone?.close(),
  ]);
}
