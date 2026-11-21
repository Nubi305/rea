import assert from "node:assert/strict";
import { copyFile, cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startSite } from "./clone-run-e2e-sites.mjs";

export const FIXTURES = fileURLToPath(
  new URL("../../tests/fixtures/cloneRun/", import.meta.url),
);
export const ORIGINAL_NAME = "Quillbrook";
export const CLONE_NAME = "Tidewater";
export const MAIN_SCENARIO = "topics";

const shellQuote = (text) => `'${text.replaceAll("'", "'\\''")}'`;

export const reasonsOf = (gate) => gate.blocking.map(({ reason }) => reason);

export const describeGate = ({ exit, gate }) =>
  `exit ${exit}, ${gate.summary}; blocking ${JSON.stringify(gate.blocking)}; next ${JSON.stringify(
    gate.next.map(({ reason, side, step_id, pointer, message }) => ({
      reason,
      side,
      step_id,
      pointer,
      message,
    })),
  )}`;

export const isCapture = ({ command }) =>
  command.includes(" capture-browser-scenario ");
const isRemoval = ({ command }) => command.startsWith("rm ");
export const sideOf = ({ side, command }) =>
  side ?? /\/rendered\/(original|clone)\//u.exec(command)?.[1];
export const distinctCommands = (items) => [
  ...new Map(items.map((item) => [item.command, item])).values(),
];

/**
 * The run is not done for this reason and no other verdict: exit 1 is
 * `not_done`, where a stalled run exits 2 and a refusal has no verdict.
 */
export const assertNotDone = (result, reason) => {
  assert.equal(result.exit, 1, describeGate(result));
  assert.equal(result.gate.verdict, "not_done", describeGate(result));
  assert.ok(reasonsOf(result.gate).includes(reason), describeGate(result));
};

/** Every capture the worklist asked for was taken and admitted, from clean starts. */
export const captureComplete = ({ gate }) =>
  !reasonsOf(gate).some(
    (reason) =>
      reason.startsWith("evidence_") || reason.startsWith("start_state_"),
  );

/**
 * Captures are complete and no step lacks data another capture could still
 * supply, apart from the steps named: a reply body is sometimes lost in every
 * capture of a side, and the worklist then asks for one more.
 */
export const settled =
  (...expectedUnknown) =>
  (result) =>
    captureComplete(result) &&
    !result.gate.next.some(
      ({ reason, step_id: id, step_ids: ids }) =>
        reason === "parity_unknown" &&
        (ids ?? [id]).some((step) => !expectedUnknown.includes(step)),
    );

export const readJson = async (file) =>
  JSON.parse(await readFile(file, "utf8"));

/** The comparison the referee wrote for a scenario, every step included. */
export const parityOf = (context, scenario) =>
  readJson(join(context.run, "parity", `${scenario}.json`));

/** Each step's status in the comparison the referee wrote for a scenario. */
export const stepStatuses = async (context, scenario) =>
  Object.fromEntries(
    (await parityOf(context, scenario)).steps.map(({ step_id: id, status }) => [
      id,
      status,
    ]),
  );

/** Run owned commands, reading an exit status as a result and anything else as a failure. */
const commandRunner = (commands, signal) => {
  const env = {
    ...process.env,
    REA_LOG_LEVEL: "silent",
    HOPPER_LAUNCHER_PATH: "/rea-unconfigured-provider/hopper",
  };
  return async (command, args) => {
    try {
      const { stdout } = await commands.exec(command, args, {
        env,
        signal,
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
};

const startSites = async (cloneRoot) => {
  const original = await startSite(
    join(FIXTURES, "original", "server.mjs"),
    "startOriginal",
  );
  try {
    return {
      original,
      clone: await startSite(join(cloneRoot, "server.mjs"), "startBoard"),
    };
  } catch (cause) {
    await original.close();
    throw cause;
  }
};

/**
 * The team's loop over one run folder: evaluate, run the worklist's own
 * commands, evaluate again.
 */
const teamLoop = (context) => ({
  evaluate: async () => {
    const result = await context.rea([
      "evaluate-clone-run",
      context.run,
      "--exit-code",
    ]);
    const gate = JSON.parse(result.stdout);
    assert.ok(
      typeof gate.verdict === "string",
      `the referee refused: ${result.stdout}`,
    );
    return { exit: result.exit, gate };
  },
  /** Run a worklist command exactly as the referee printed it. */
  shell: async (command) => {
    const result = await context.exec("/bin/sh", ["-c", command]);
    assert.equal(
      result.exit,
      0,
      `worklist command failed: ${command}\n${result.stderr ?? ""}`,
    );
  },
  /** Reset the side, then run the capture command of a worklist item. */
  capture: async (item, { reset = true } = {}) => {
    if (reset) await context.sites[sideOf(item)].restart();
    await context.shell(item.command);
  },
  /**
   * Evaluate, run each distinct capture command of the worklist after
   * resetting its side, evaluate again. Reply bodies are sometimes lost, so
   * the number of captures is the referee's to say, within a bound.
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
    const stated = `${after}: expected done again; ${describeGate(result)}`;
    assert.equal(result.exit, 0, stated);
    assert.equal(result.gate.verdict, "done", stated);
  },
});

/**
 * Everything one verification run shares: the folder, both servers and the command owner.
 * @param {object} owned
 * @param {string} owned.executable Chromium executable the capture inputs launch.
 * @param {string} owned.entrypoint The CLI script the commands run.
 * @param {{ path: string }} owned.root
 * @param {{ exec: Function }} owned.commands
 * @param {AbortSignal} [owned.signal] Stops the command in hand when the run is interrupted.
 */
export const createContext = async ({
  executable,
  entrypoint,
  root,
  commands,
  signal,
}) => {
  const cloneRoot = join(root.path, "clone");
  await cp(join(FIXTURES, "clone"), cloneRoot, { recursive: true });
  const exec = commandRunner(commands, signal);
  const context = {
    executable,
    root: root.path,
    run: join(root.path, "run"),
    cloneRoot,
    sites: await startSites(cloneRoot),
    reaCommand: `${shellQuote(process.execPath)} ${shellQuote(entrypoint)}`,
    exec,
    rea: (args) => exec(process.execPath, [entrypoint, ...args, "--json"]),
  };
  return Object.assign(context, teamLoop(context));
};

/** The flags of `init-clone-run` for this run, with the clone served at `cloneAddress`. */
export const initArguments = (context, directory, cloneAddress) => [
  "init-clone-run",
  directory,
  "--original",
  context.sites.original.origin,
  "--clone",
  cloneAddress,
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
  // A round is a judged clone tree. This one folder judges the matching
  // clone, seven mutants and the clone again after each, more trees than the
  // default of 8 allows a team before every result reads stalled.
  "--max-rounds",
  "30",
];

export const addFixtureScenario = async (context, scenario) => {
  for (const kind of ["scenarios", "obligations"])
    await copyFile(
      join(FIXTURES, "run", kind, `${scenario}.json`),
      join(context.run, kind, `${scenario}.json`),
    );
};

export const withdrawScenario = async (context, scenario) => {
  for (const kind of ["scenarios", "obligations"])
    await rm(join(context.run, kind, `${scenario}.json`));
};

/** Create the run folder and give it the main scenario and the fixture's declared differences. */
export const initialise = async (context) => {
  const created = await context.rea(
    initArguments(context, context.run, context.sites.clone.origin),
  );
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

/** The captures the referee admitted for one side of a scenario, as its admission record lists them. */
const admitted = async (context, side, scenario) => {
  const record = JSON.parse(
    await readFile(
      join(context.run, "records", side, `${scenario}.json`),
      "utf8",
    ),
  );
  return record.files
    .filter(({ status }) => status === "admitted")
    .map(({ file }) => join(context.run, file));
};

/** `rea compare-scenario-behavior --exit-code` over the admitted captures of the main scenario. */
export const compareMain = async (context) => {
  const files = async (flag, side) =>
    (await admitted(context, side, MAIN_SCENARIO)).flatMap((file) => [
      flag,
      file,
    ]);
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

export const evidenceFile = (context, side, scenario, name) =>
  join(context.run, "evidence", side, scenario, name);

/**
 * Turn the clone into the mutant a fixture file describes, by its one
 * replacement. The result puts the file back as it was, which also returns
 * the clone tree to the digest its earlier captures were taken for.
 */
export const applyMutant = async (context, name) => {
  const change = JSON.parse(
    await readFile(join(FIXTURES, "mutant", `${name}.json`), "utf8"),
  );
  const file = join(context.cloneRoot, change.file);
  const source = await readFile(file, "utf8");
  assert.equal(
    source.split(change.find).length,
    2,
    `the mutant ${name} applies once`,
  );
  await writeFile(file, source.replace(change.find, change.replace));
  return () => writeFile(file, source);
};
