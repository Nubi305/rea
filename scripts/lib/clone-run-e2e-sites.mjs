import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

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

/** How long a fixture may take to report the address it serves. */
const START_DEADLINE_MS = 15_000;

/**
 * Start one fixture worker and wait for its address. A worker that fails,
 * exits before it reported, or stays silent past the deadline rejects, so a
 * fixture that cannot start fails the run instead of hanging it.
 * @param {{ module: string, start: string, port: number }} workerData
 * @param {number} deadlineMs
 * @returns {Promise<{ worker: Worker, origin: string }>}
 */
const launch = (workerData, deadlineMs) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(SITE_WORKER, { eval: true, workerData });
    const refuse = (/** @type {string} */ why) =>
      reject(new Error(`The fixture ${workerData.start} ${why}`));
    const timer = setTimeout(() => {
      void worker.terminate();
      refuse(`reported no address within ${deadlineMs} ms`);
    }, deadlineMs);
    worker.once("error", (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      // After the address arrived this settles nothing: the promise is resolved.
      refuse(`exited with code ${code} before it reported its address`);
    });
    worker.once("message", (origin) => {
      clearTimeout(timer);
      resolve({ worker, origin });
    });
  });

/**
 * Serve one fixture on a loopback port it picks; `restart` returns it to its
 * start state on the same port.
 * @param {string} modulePath
 * @param {string} start Name of the module's export that starts the server.
 * @param {{ deadlineMs?: number }} [options]
 */
export const startSite = async (
  modulePath,
  start,
  { deadlineMs = START_DEADLINE_MS } = {},
) => {
  const module = pathToFileURL(modulePath).href;
  let current = await launch({ module, start, port: 0 }, deadlineMs);
  const { origin } = current;
  const port = Number(new URL(origin).port);
  return {
    origin,
    port,
    restart: async () => {
      await current.worker.terminate();
      current = await launch({ module, start, port }, deadlineMs);
      assert.equal(current.origin, origin, "a restarted fixture kept its port");
    },
    close: () => current.worker.terminate(),
  };
};
