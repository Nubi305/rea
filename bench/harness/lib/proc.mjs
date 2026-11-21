// Running a REA checkout and plain shell commands with a deadline. Nothing
// here interprets REA's output: callers do.
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

/** The CLI entry of a built checkout; throws when the checkout is not built. */
export const reaEntry = (checkout) => {
  const entry = join(checkout, "scripts", "rea.mjs");
  if (!existsSync(entry)) throw new Error(`${checkout} has no scripts/rea.mjs`);
  if (!existsSync(join(checkout, "dist")))
    throw new Error(`${checkout} is not built (no dist/)`);
  return entry;
};

const gitHead = (checkout) => {
  try {
    return execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

const nodeVersion = (node) =>
  execFileSync(node, ["--version"], { encoding: "utf8" }).trim();

/** What identifies the build a number was measured on. */
export const checkoutFacts = (checkout, node = process.execPath) => {
  reaEntry(checkout);
  const manifest = JSON.parse(
    readFileSync(join(checkout, "package.json"), "utf8"),
  );
  const commit = gitHead(checkout);
  return {
    checkout,
    commit,
    commit_short: commit === null ? null : commit.slice(0, 8),
    version: manifest.version,
    node,
    node_version: nodeVersion(node),
  };
};

/**
 * Run one REA command of a checkout. A deadline that passes reads as
 * `timed_out`, never as a failed command.
 */
export const runRea = (checkout, args, options = {}) => {
  const {
    node = process.execPath,
    env = {},
    timeoutMs = 120_000,
    cwd,
  } = options;
  const started = performance.now();
  const result = spawnSync(node, [reaEntry(checkout), ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  return {
    args,
    status: result.status,
    timed_out: result.error?.code === "ETIMEDOUT",
    error: result.error === undefined ? null : String(result.error.message),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ms: Math.round(performance.now() - started),
  };
};

/** Run a shell command line the way a person would type it, with a deadline. */
export const runShell = (command, options = {}) => {
  const { env = {}, timeoutMs = 60_000, cwd } = options;
  const result = spawnSync("bash", ["-c", command], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  return {
    command,
    status: result.status,
    timed_out: result.error?.code === "ETIMEDOUT",
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

/** JSON a command printed, or null when it printed something else. */
export const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * Run a control command (start, stop or reset of an application) with its
 * output sent to a log file. A command that leaves a server behind returns
 * when the shell does, because no pipe is left open to wait on.
 */
export const runControl = (command, logFile, timeoutMs = 90_000) => {
  const log = openSync(logFile, "a");
  try {
    const result = spawnSync("bash", ["-c", command], {
      stdio: ["ignore", log, log],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    return {
      command,
      status: result.status,
      timed_out: result.error?.code === "ETIMEDOUT",
    };
  } finally {
    closeSync(log);
  }
};
