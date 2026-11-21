// The referee's verdict on a run folder, recomputed on a copy so that the
// agent's folder stays as the agent left it.
import { cpSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseJson, runRea } from "./proc.mjs";

const EVALUATE_TIMEOUT_MS = 300_000;

/** The verdict the agent's own last evaluation left in the run folder. */
export const recordedVerdict = (runDir) => {
  const file = join(runDir, "gate.json");
  if (!existsSync(file)) return null;
  const gate = parseJson(readFileSync(file, "utf8"));
  return gate === null
    ? null
    : {
        verdict: gate.verdict ?? null,
        summary: gate.summary ?? null,
        evaluated_at: gate.evaluated_at ?? null,
      };
};

/**
 * Run `evaluate-clone-run --exit-code` of one checkout on a copy of the run
 * folder. Exit 0 is done or done_with_waivers, 1 not_done, 2 stalled; a
 * refusal also exits 1 and carries no verdict.
 */
export const evaluateCopy = (runDir, rea, copyDir, browser) => {
  if (!existsSync(join(runDir, "target.json")))
    return {
      evaluated_with: rea.commit_short,
      verdict: null,
      exit_status: null,
      problem: "the run folder has no target.json: no run was started",
    };
  cpSync(runDir, copyDir, { recursive: true });
  const result = runRea(
    rea.checkout,
    ["evaluate-clone-run", copyDir, "--exit-code", "--json"],
    {
      node: rea.node,
      timeoutMs: EVALUATE_TIMEOUT_MS,
      env: { REA_BROWSER_EXECUTABLE: browser, REA_BROWSER_NO_SANDBOX: "true" },
    },
  );
  const gate = parseJson(result.stdout);
  return {
    evaluated_with: rea.commit_short,
    verdict: gate?.verdict ?? null,
    exit_status: result.status,
    summary: gate?.summary ?? null,
    checks: gate?.checks ?? null,
    blocking: gate?.blocking ?? null,
    waivers: gate?.waivers ?? null,
    stdout_bytes: Buffer.byteLength(result.stdout),
    problem:
      gate?.verdict === undefined
        ? result.timed_out
          ? "the evaluation timed out"
          : `no verdict: ${result.stdout.slice(0, 300)}`
        : null,
  };
};

const countFiles = (directory) => {
  if (!existsSync(directory)) return 0;
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) total += countFiles(join(directory, entry.name));
    else if (entry.isFile()) total += 1;
  }
  return total;
};

/** Capture Evidence files the run folder holds now, per side. */
export const evidenceFiles = (runDir) => ({
  original: countFiles(join(runDir, "evidence", "original")),
  clone: countFiles(join(runDir, "evidence", "clone")),
});

const readTarget = (runDir) => {
  const file = join(runDir, "target.json");
  return existsSync(file) ? (parseJson(readFileSync(file, "utf8")) ?? {}) : {};
};

const resetCommand = (commands) =>
  commands.reset ??
  (commands.start && commands.stop
    ? `${commands.stop}; ${commands.start}`
    : null);

/**
 * How the clone is restarted and stopped: the commands the run's own
 * target.json records, unless the caller gives others.
 */
export const cloneControl = (runDir, cell, overrides) => {
  const clone = readTarget(runDir).clone ?? {};
  const commands = clone.commands ?? {};
  const reset = overrides.reset ?? resetCommand(commands);
  const stop = overrides.stop ?? commands.stop ?? null;
  const address =
    overrides.address ?? clone.address ?? cell.clone?.address ?? null;
  if (reset === null || stop === null || address === null) return null;
  return {
    reset,
    stop,
    address,
    port: Number(new URL(address).port),
    source: overrides.reset === undefined ? "target.json" : "given",
  };
};
