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
const run = createVerifierRun();
const proof = await verifyCloneRun(executable, (line) => {
  process.stdout.write(`${line}\n`);
});
process.stdout.write(
  `${JSON.stringify({ ...proof, verifier_run: await completeVerifierRun(run) })}\n`,
);
if (!proof.verified) process.exitCode = 1;
