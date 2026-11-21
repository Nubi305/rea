// Running REA and other commands one at a time, with a timeout on each.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const MAX_BUFFER = 512 * 1024 * 1024;

/**
 * The environment every REA process gets: a throwaway home under the
 * section's root, and nothing inherited that could change what REA prints
 * except PATH and the browser settings the caller passed.
 */
export const reaEnvironment = (root, extra = {}) => {
  const home = join(root, "home");
  const tmp = join(root, "tmp");
  mkdirSync(home, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    TMPDIR: tmp,
    NO_COLOR: "1",
    ...extra,
  };
};

/** Run a command to completion; never throws for a non-zero exit. */
export const run = (command, args, options = {}) => {
  const started = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.stdin ?? "",
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: MAX_BUFFER,
    killSignal: "SIGKILL",
  });
  return {
    stdout: result.stdout?.toString("utf8") ?? "",
    stderr: result.stderr?.toString("utf8") ?? "",
    exit: result.status,
    signal: result.signal ?? null,
    timedOut: result.error?.code === "ETIMEDOUT",
    error: result.error === undefined ? undefined : String(result.error),
    ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
  };
};

/** Run `rea <args>` from the checkout being measured. */
export const runRea = (context, args, options = {}) =>
  run(context.node, [context.reaScript, ...args], options);
