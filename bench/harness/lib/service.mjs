// Local servers the harness starts and must stop: the page a task observes,
// and addresses it waits for. A process is stopped only when it is the one
// this harness recorded: same pid and same start time.
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

/** Start time of a process in clock ticks since boot, or null when it is gone. */
const processStartTime = (pid) => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // The command name may hold spaces and parentheses; fields follow the last ")".
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return fields[19] ?? null;
  } catch {
    return null;
  }
};

/** Whether something accepts TCP connections on 127.0.0.1:port. */
export const portOpen = (port) =>
  new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const settle = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1000, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });

/** Wait until an address answers HTTP with any status; false when it never does. */
export const waitForHttp = async (url, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const reply = await fetch(url, { signal: AbortSignal.timeout(2000) });
      await reply.arrayBuffer();
      return true;
    } catch {
      await sleep(150);
    }
  }
  return false;
};

/** Wait until nothing listens on a port; false when something still does. */
export const waitForPortFree = async (port, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portOpen(port))) return true;
    await sleep(150);
  }
  return false;
};

/**
 * Start `node script` detached on a port and record it in `recordFile`.
 * Refuses a port that is already taken.
 */
export const startNodeService = async (service) => {
  const { script, port, healthPath, recordFile, logFile } = service;
  if (await portOpen(port))
    throw new Error(`port ${port} is already taken; nothing was started`);
  const log = openSync(logFile, "a");
  const child = spawn(process.execPath, [script], {
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();
  const record = {
    pid: child.pid,
    start_time: processStartTime(child.pid),
    port,
    script,
  };
  writeFileSync(recordFile, `${JSON.stringify(record, null, 1)}\n`);
  const address = `http://127.0.0.1:${port}`;
  if (!(await waitForHttp(`${address}${healthPath}`))) {
    await stopRecordedService(recordFile);
    throw new Error(`${script} did not answer on ${address}; see ${logFile}`);
  }
  return { ...record, address };
};

/**
 * Stop the process a record file names, if it is still that process.
 * Returns what was done: "stopped", "not-running" or "not-ours".
 */
export const stopRecordedService = async (recordFile) => {
  if (!existsSync(recordFile)) return "not-running";
  const record = JSON.parse(readFileSync(recordFile, "utf8"));
  const startTime = processStartTime(record.pid);
  if (startTime === null) {
    rmSync(recordFile, { force: true });
    return "not-running";
  }
  if (startTime !== record.start_time) return "not-ours";
  process.kill(record.pid, "SIGTERM");
  for (let tries = 0; tries < 50; tries++) {
    if (processStartTime(record.pid) !== record.start_time) break;
    await sleep(100);
  }
  if (processStartTime(record.pid) === record.start_time)
    process.kill(record.pid, "SIGKILL");
  await waitForPortFree(record.port);
  rmSync(recordFile, { force: true });
  return "stopped";
};

/** The pids that listen on 127.0.0.1:port, as lsof reports them. */
const listenersOn = (port) => {
  try {
    return execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter((line) => line !== "")
      .map(Number);
  } catch {
    return [];
  }
};

/**
 * End whatever still listens on a port. Only for a port the caller saw free
 * before it started something there: then the listener is the caller's.
 */
export const endListeners = async (port) => {
  for (const pid of listenersOn(port)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process ended between the listing and the signal.
    }
  }
  if (await waitForPortFree(port, 5000)) return true;
  for (const pid of listenersOn(port)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // As above.
    }
  }
  return waitForPortFree(port, 5000);
};
