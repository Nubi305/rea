import { z } from "zod";
import type { Logger } from "pino";

import { logCliCommand } from "../cliLogging.js";
import { CLI_COMMANDS } from "../contracts/cliCommandNames.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import {
  CLONE_RUN_DEFAULT_EXCLUDES,
  CLONE_RUN_DEFAULT_LIMITS,
  CLONE_RUN_PATHS,
  cloneRunExitCode,
} from "../domain/cloneRun/cloneRunSchemas.js";
import { shellQuote } from "../domain/desktop/shellQuote.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { localPathStringSchema } from "../domain/localPath.js";
import { scenarioBehaviorExitCode } from "../domain/scenarioBehaviorComparison.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { CURRENT_ENTRYPOINT_PATH } from "../process/CurrentEntrypointPath.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { registerCliCommand } from "./commandRegistry.js";
import { cliDecimalField } from "./options.js";
import type { CliInstance } from "./types.js";

/**
 * The three clone-run commands: the behaviour comparer, the run-folder
 * scaffold and the referee. CLI-only, like `environment-compare`.
 * Contract: docs/specs/reconstruction/clone-runs/spec.md, "Commands".
 */

/** Same envelope label as the other application workflow commands. */
const cliError = (error: AnalysisError): JsonValue => ({
  error: "Application workflow failed",
  ...projectAnalysisError(error),
});

/**
 * The one way to gate on a verdict. `caution` is what a reader of this
 * command's output most easily gets wrong.
 */
const exitCodeOption = (meaning: string, caution = "") =>
  z
    .boolean()
    .default(false)
    .describe(
      `Exit by verdict: ${meaning}. Without it a completed command exits 0 whatever the verdict. Write the flag bare. After = only true (on) and false (off, as --no-exit-code) are read; any other value, such as 1, 0, no or an empty one, is refused as an argument error and never read as off. A refusal, an unknown flag included, exits 1 either way and its JSON has no verdict member${caution}`,
    );

interface CompareArguments {
  readonly left: readonly string[];
  readonly right: readonly string[];
  readonly differences?: string | undefined;
  readonly scenario?: string | undefined;
  readonly detail: "summary" | "complete";
  readonly exitCode: boolean;
}

/** Compare the captures and, when asked, exit by the verdict; a refusal is the command's output. */
const compareScenarioBehaviorCommand = async (
  input: CompareArguments,
  signal: AbortSignal,
): Promise<JsonValue> => {
  const { compareScenarioBehaviorFiles } =
    await import("../application/scenarioBehavior/ScenarioBehaviorComparisonService.js");
  const compared = await compareScenarioBehaviorFiles({
    left: input.left.map((path) => absoluteCallerPath(path)),
    right: input.right.map((path) => absoluteCallerPath(path)),
    differences:
      input.differences === undefined
        ? undefined
        : absoluteCallerPath(input.differences),
    scenario: input.scenario,
    detail: input.detail,
    signal,
  });
  if (!compared.ok) return cliError(compared.error);
  if (input.exitCode)
    process.exitCode = scenarioBehaviorExitCode(compared.value.verdict);
  return compared.value as unknown as JsonValue;
};

const captureFile = (side: string) =>
  z
    .array(localPathStringSchema)
    .min(1)
    .describe(
      `Required. Capture Evidence JSON of the ${side} side: a file capture-browser-scenario wrote with --evidence_output, or its JSON output. Repeat once per capture of the same scenario; two or more show what varies between runs`,
    );

const registerCompareCommand = (cli: CliInstance, logger: Logger): void => {
  registerCliCommand(cli, CLI_COMMANDS.compareScenarioBehavior, {
    description:
      "Compare what one browser scenario did at two addresses, such as an application (left) and a rebuild of it (right). Steps are aligned by step id. Where the left prints its own address (its origin, or its bare host and port), that address is read as the right's, and addresses_applied counts those values; no other address is treated as equal. Each step is unchanged, changed, unknown (data missing on either side, which never counts as a match) or unstable (a side's own repeats disagree), judged on step outcome, requests, status, each field of a JSON reply by JSON pointer, page address and on-screen text. The result's verdict is changed, unknown or unchanged, and each finding gives the dimension, pointer, expected (left) and actual (right) value",
    options: z.object({
      left: captureFile("left"),
      right: captureFile("right"),
      differences: localPathStringSchema
        .optional()
        .describe(
          'Declared differences JSON, the intended-differences.json of a clone run: {"renames": [{"from", "to", "reason"}], "volatile_fields": [{"scenario", "step_id", "pointer", "reason"}]}. A rename replaces text on the left before comparing. A volatile field names one reply leaf by JSON pointer (* for any list position) at one step, or at every step with step_id "*"; it is honoured only where the left side\'s own repeats differ, and that leaf is then compared by shape only',
        ),
      scenario: z
        .string()
        .optional()
        .describe(
          "Scenario id whose volatile fields apply; required when the differences file names more than one scenario",
        ),
      detail: z
        .enum(["summary", "complete"])
        .default("summary")
        .describe(
          "summary lists the steps that are not unchanged; complete lists every step. Counts cover every step either way",
        ),
      exitCode: exitCodeOption("0 unchanged, 1 changed, 2 unknown"),
    }),
    run: ({ options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.compareScenarioBehavior, () =>
          compareScenarioBehaviorCommand(options, signal),
        ),
      ),
  });
};

const teamCommand = (purpose: string) =>
  z
    .string()
    .min(1)
    .optional()
    .describe(
      `Shell command that ${purpose}. Recorded in target.json for the team and repeated in worklist messages; REA never runs it`,
    );

const initOptions = z.object({
  // Plain text here: the run-folder owner parses and normalizes both origins with the target schema.
  original: z
    .string()
    .min(1)
    .describe(
      "Required. Address of the running original: one HTTP(S) origin without a path, such as http://127.0.0.1:4000",
    ),
  clone: z
    .string()
    .min(1)
    .describe(
      "Required. Address the clone is served at. It must be another server than the original's: on one port, two hosts that resolve to a common address are one address, and every loopback name or address, 0.0.0.0 and this machine's own interface addresses are one host. A host that does not resolve is refused when the ports are equal",
    ),
  cloneRoot: localPathStringSchema.describe(
    "Required. Directory of the clone's source. It may not exist yet. The run directory must be outside it",
  ),
  cloneName: z
    .string()
    .min(1)
    .describe(
      "Required. The clone's own product name. It must not contain an original name",
    ),
  originalName: z
    .array(z.string().min(3))
    .min(1)
    .describe(
      "Required. A product or brand name of the original, three characters or more, that must not appear in the clone's files; repeat per name. Choose distinctive names: one that also occurs in a route or field name can never be satisfied",
    ),
  authorization: z
    .string()
    .min(1)
    .describe(
      "Required. Why the team may study the original, such as ownership or written permission. Recorded as given; REA cannot verify it",
    ),
  statedBy: z
    .string()
    .min(1)
    .optional()
    .describe("The person who made the authorization statement"),
  browser: localPathStringSchema
    .optional()
    .describe(
      "Chromium executable the capture inputs launch; default REA_BROWSER_EXECUTABLE, refused when neither is set",
    ),
  browserNoSandbox: z
    .boolean()
    .optional()
    .describe(
      "Prefix worklist capture commands with REA_BROWSER_NO_SANDBOX=true; default whether that variable is true now",
    ),
  exclude: z
    .array(z.string().min(1))
    .optional()
    .describe(
      `Path under the clone root left out of the clone tree digest and the clean-room checks, such as a database or log the clone writes while it runs; repeat per path. A relative path of whole /-separated segments, with no pattern characters, backslash or .. segment. The summary of every verdict lists the excludes that matched a path, because neither staleness nor the clean-room check covers them. Replaces the default ${CLONE_RUN_DEFAULT_EXCLUDES.join(" and ")}`,
    ),
  material: z
    .array(localPathStringSchema)
    .optional()
    .describe(
      `Directory of files taken from the original, absolute or relative to the run directory; no clone file may equal one of them. Repeat per directory. Replaces the default ${CLONE_RUN_PATHS.scout}`,
    ),
  originalStart: teamCommand("starts the original"),
  originalReset: teamCommand("returns the original to its clean start state"),
  originalStop: teamCommand("stops the original"),
  originalHealth: teamCommand("reports whether the original is up"),
  cloneStart: teamCommand("starts the clone"),
  cloneReset: teamCommand("returns the clone to its clean start state"),
  cloneStop: teamCommand("stops the clone"),
  cloneHealth: teamCommand("reports whether the clone is up"),
  reaCommand: z
    .string()
    .min(1)
    .optional()
    .describe(
      "How worklist commands spell this CLI, such as `npx rea-agents` or `node /path/to/rea.mjs`; default rea",
    ),
  maxRounds: cliDecimalField(
    z
      .int()
      .min(1)
      .optional()
      .describe(
        `Rounds after which a run that is not done reads stalled. A round is one clone tree judged with every capture admitted; new captures and edits to authored files use up none; default ${String(CLONE_RUN_DEFAULT_LIMITS.max_rounds)}`,
      ),
  ),
  captureTimeoutSeconds: cliDecimalField(
    z
      .int()
      .min(1)
      .optional()
      .describe(
        `Outer timeout of each worklist capture command; default ${String(CLONE_RUN_DEFAULT_LIMITS.capture_timeout_seconds)}`,
      ),
  ),
});

/** Scaffold the run folder from the flags; a refusal is the command's output. */
const initCloneRunCommand = async (
  directory: string,
  options: z.output<typeof initOptions>,
  environment: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal,
): Promise<JsonValue> => {
  const browser = options.browser ?? environment.REA_BROWSER_EXECUTABLE;
  if (browser === undefined || browser === "")
    return cliError(
      new AnalysisInputError(
        CLI_COMMANDS.initCloneRun,
        {
          conformsToInputContract: true,
          userMessage:
            "No Chromium executable is named. Pass --browser with its absolute path, or set REA_BROWSER_EXECUTABLE.",
          remediationAction:
            "Pass --browser <path to a Chromium executable> and run the command again.",
        },
        [
          {
            path: ["browser"],
            reason: "missing_argument",
            message:
              "The capture inputs of a run launch this browser; REA installs none.",
          },
        ],
      ),
    );
  const { initCloneRun } =
    await import("../application/cloneRun/CloneRunWorkspace.js");
  const created = await initCloneRun(
    {
      runDirectory: directory,
      originalAddress: options.original,
      cloneAddress: options.clone,
      cloneRoot: options.cloneRoot,
      cloneName: options.cloneName,
      originalNames: options.originalName,
      authorization: options.authorization,
      statedBy: options.statedBy,
      browserExecutable: browser,
      noSandbox:
        options.browserNoSandbox ??
        environment.REA_BROWSER_NO_SANDBOX === "true",
      exclude: options.exclude,
      material: options.material,
      originalCommands: {
        start: options.originalStart,
        reset: options.originalReset,
        stop: options.originalStop,
        health: options.originalHealth,
      },
      cloneCommands: {
        start: options.cloneStart,
        reset: options.cloneReset,
        stop: options.cloneStop,
        health: options.cloneHealth,
      },
      reaCommand: options.reaCommand,
      maxRounds: options.maxRounds,
      captureTimeoutSeconds: options.captureTimeoutSeconds,
    },
    { signal },
  );
  return created.ok
    ? (created.value as unknown as JsonValue)
    : cliError(created.error);
};

const registerInitCommand = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  registerCliCommand(cli, CLI_COMMANDS.initCloneRun, {
    description:
      "Create the run folder a team works from while it rebuilds a web application as new code under a new name, and that evaluate-clone-run judges. Writes target.json (both addresses, the clone root, the names that must not appear in the clone, the recorded authorization), intended-differences.json with one rename per original name, waivers.json, the empty directories and examples/ with a valid example of each file an agent writes: scenarios/<id>.json twice (request steps, and page steps), obligations/<area>.json, unknowns/<role>-<n>.json and a crawl capture input for the scout. Nothing is overwritten and no target is started. The result's next is the referee's first worklist for the new folder: do it, then run evaluate-clone-run and follow its worklist",
    args: z.object({
      directory: localPathStringSchema.describe(
        "Run folder to create; must be absent or empty, and outside the clone root",
      ),
    }),
    options: initOptions,
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.initCloneRun, () =>
          initCloneRunCommand(args.directory, options, environment, signal),
        ),
      ),
  });
};

/**
 * How this process was started, as a shell prefix that starts this CLI again:
 * the runtime and the absolute script it was given (`CURRENT_ENTRYPOINT_PATH`).
 * The referee prints its worklist commands with it only when `target.json`
 * cannot be read for the run's own spelling, so the command still runs as
 * printed.
 */
export const cliInvocation = (
  runtime: string,
  script: string | undefined,
): string | undefined =>
  script === undefined || script === ""
    ? undefined
    : `${shellQuote(runtime)} ${shellQuote(script)}`;

/** Run the referee and, when asked, exit by its verdict; a refusal is the command's output. */
const evaluateCloneRunCommand = async (
  directory: string,
  exitCode: boolean,
  signal: AbortSignal,
): Promise<JsonValue> => {
  const [
    { evaluateCloneRun },
    { digestCloneTree },
    { readCloneRunStepFailure },
    { SCENARIO_BEHAVIOR_COMPARER },
  ] = await Promise.all([
    import("../application/cloneRun/CloneRunEvaluation.js"),
    import("../application/cloneRun/CloneRunTreeDigest.js"),
    import("../application/cloneRun/CloneRunStepFailure.js"),
    import("../application/scenarioBehavior/ScenarioBehaviorComparisonService.js"),
  ]);
  const invokedAs = cliInvocation(process.execPath, CURRENT_ENTRYPOINT_PATH);
  const gate = await evaluateCloneRun(
    absoluteCallerPath(directory),
    {
      comparer: SCENARIO_BEHAVIOR_COMPARER,
      digestTree: digestCloneTree,
      now: () => new Date(),
      stepFailure: readCloneRunStepFailure,
      ...(invokedAs === undefined ? {} : { invokedAs }),
    },
    { signal },
  );
  if (!gate.ok) return cliError(gate.error);
  if (exitCode) process.exitCode = cloneRunExitCode(gate.value.verdict);
  return gate.value as unknown as JsonValue;
};

const registerEvaluateCommand = (cli: CliInstance, logger: Logger): void => {
  registerCliCommand(cli, CLI_COMMANDS.evaluateCloneRun, {
    description:
      "Referee a clone run: decide from capture Evidence REA recorded and authenticates, and from the clone's files as they are now, whether the clone behaves as the original. Prints the verdict (done, done_with_waivers, not_done or stalled), the eight checks, every blocking reason with its count, and next: at most ten items, each with the role that acts, the reason code, the file, a message naming the fix, and the exact command to run. stall gives the round and what would make the next evaluation read stalled; residual_trust, what a pass does not cover, is listed only with a pass. Loop: evaluate, do next, evaluate. Capture a side only from the rendered input this command wrote, after resetting that side, and evaluate before capturing the clone again after any edit to it. It reads the folder, rewrites its own outputs (rendered/, records/, behavior/, parity/, gate.json, journal.jsonl) and never reads a verdict from them; it never starts, stops or resets a target. No file an agent writes can produce a pass, and gate.json on disk is only a copy of the last verdict",
    args: z.object({
      directory: localPathStringSchema.describe(
        "Run folder that init-clone-run created",
      ),
    }),
    options: z.object({
      exitCode: exitCodeOption(
        "0 done or done_with_waivers, 1 not_done, 2 stalled",
        ". Gate on this exit status or on the verdict member, never on finding the word done in the output: not_done and the summary of a run that is not done contain it",
      ),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.evaluateCloneRun, () =>
          evaluateCloneRunCommand(args.directory, options.exitCode, signal),
        ),
      ),
  });
};

/** Register the behaviour comparer, the run-folder scaffold and the referee. */
export const registerCloneRunCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  registerCompareCommand(cli, logger);
  registerInitCommand(cli, logger, environment);
  registerEvaluateCommand(cli, logger);
};
