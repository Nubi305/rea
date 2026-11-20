import { fileURLToPath } from "node:url";

import { PrivateRuntimeRoot } from "../../dist/process/PrivateRuntimeRoot.js";
import { EVIDENCE_CASES } from "./clone-run-e2e-cases.mjs";
import { createContext, initialise } from "./clone-run-e2e-context.mjs";
import { MUTANT_CASES } from "./clone-run-e2e-mutant-cases.mjs";
import { runCloneRunCases } from "./clone-run-e2e-runner.mjs";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";
import { createPackageVerifierCommands } from "./verify-package-commands.mjs";

/** The acceptance cases, in the order one run folder lives through them. */
const CASES = [...EVIDENCE_CASES, ...MUTANT_CASES];

/**
 * Drive the three clone-run commands against the fixture original, its
 * renamed clone and the clone's mutants with a real browser, and report one
 * line per acceptance case. A failed case stops the run, and so does the
 * signal: the command in hand is stopped, the remaining cases read `not run`,
 * and the servers, the commands' processes and the private root are released
 * either way.
 * @param {string} executable Chromium executable the capture inputs launch.
 * @param {(line: string) => void} report
 * @param {{ signal?: AbortSignal, entrypoint?: string }} [options]
 */
export async function verifyCloneRun(
  executable,
  report,
  {
    signal,
    entrypoint = fileURLToPath(new URL("../rea.mjs", import.meta.url)),
  } = {},
) {
  let root;
  let commands;
  let context;
  const proof = async () => {
    root = await PrivateRuntimeRoot.create({ prefix: "rea-clone-run-e2e-" });
    commands = await createPackageVerifierCommands({ workspace: root });
    signal?.throwIfAborted();
    context = await createContext({
      executable,
      entrypoint,
      root,
      commands,
      signal,
    });
    signal?.throwIfAborted();
    await initialise(context);
    return runCloneRunCases(CASES, context, report, signal);
  };
  // The owner stops its commands' processes before removing the root; the fixture servers stop with their workers.
  return withVerifierCleanup(proof, [
    () => (commands === undefined ? root?.close() : commands.close()),
    () => context?.sites.original.close(),
    () => context?.sites.clone.close(),
  ]);
}
