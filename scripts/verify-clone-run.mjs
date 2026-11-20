#!/usr/bin/env node
import { access } from "node:fs/promises";
import { verifyCloneRun } from "./lib/clone-run-e2e.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";

const executable = process.env.REA_BROWSER_EXECUTABLE;
if (executable === undefined || executable === "")
  throw new Error(
    "verify:clone-run requires REA_BROWSER_EXECUTABLE pointing to an installed Chrome-family browser",
  );
// The referee's worklist commands are POSIX shell lines (`timeout`, `rm`), and this verifier runs them as printed.
if (process.platform === "win32")
  throw new Error("verify:clone-run needs a POSIX shell with timeout and rm");
await access(executable);
// An interruption stops the command in hand and skips the remaining cases, so
// the verifier's own cleanup releases the servers, the browser and the root.
const interruption = new AbortController();
for (const name of /** @type {const} */ (["SIGINT", "SIGTERM"]))
  process.once(name, () => {
    interruption.abort(
      new Error(`verify:clone-run was interrupted by ${name}`),
    );
  });
const run = createVerifierRun();
const proof = await verifyCloneRun(
  executable,
  (line) => {
    process.stdout.write(`${line}\n`);
  },
  { signal: interruption.signal },
);
process.stdout.write(
  `${JSON.stringify({ ...proof, verifier_run: await completeVerifierRun(run) })}\n`,
);
if (!proof.verified) process.exitCode = 1;
