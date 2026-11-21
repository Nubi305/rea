/**
 * The answer budget's policy for one CLI process: which limit applies, where
 * it came from, the unflagged format, how a printed command spells REA, and
 * which digest paths may quote the target.
 *
 * Resolved once at the process entry (contract section 2); everything below
 * the entry takes the resolved policy as an argument that defaults to off.
 */
import { posix, win32 } from "node:path";

import { invokingPackageRunner } from "../../application/ClientRegistrationIdentity.js";
import { toolReturnsTargetContent } from "../../contracts/toolEffects.js";
import {
  DEFAULT_OUTPUT_BUDGET_BYTES,
  outputBudgetFromEnvironment,
  parseOutputBudget,
  type OutputBudgetSetting,
} from "../../domain/outputBudget.js";
import { err, ok, type Result } from "../../domain/result.js";
import { MINIMUM_TOKEN_LIMIT, tokenLimitBytes } from "./tokenBound.js";

/**
 * What standard output is, read once by the launcher (contract section 3):
 * `terminal` (a TTY), `capture` (a regular file that is also standard error),
 * `file` (a regular file of its own), `other` (pipe, socket, device, unknown).
 */
export type StdoutKind = "terminal" | "capture" | "file" | "other";

/** Where the limit in force came from. */
export type OutputBudgetSource =
  | "--output-budget"
  | "REA_OUTPUT_BUDGET"
  | "--token-limit"
  | "default"
  | "agent-marker";

/**
 * Environment variables whose presence says an agent's shell started this
 * process. They keep the default budget on when standard output is a file of
 * its own (ruling 1). Each is listed with its source in
 * `docs/design/rea-limit-inventory.md`; add a client's variable only when its
 * documentation or source states that its shell tool sets it.
 */
export const AGENT_MARKERS: readonly string[] = [
  "REA_AGENT",
  "CLAUDECODE",
  "GEMINI_CLI",
  "CODEX_SANDBOX_NETWORK_DISABLED",
];

export interface OutputBudgetPolicyInput {
  /** The raw `--output-budget` value, when the flag was given. */
  readonly flag?: string | undefined;
  /** The process environment (only the budget and marker variables are read). */
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly stdoutKind: StdoutKind;
  /** `--token-limit`, when given. */
  readonly tokenLimit?: number | undefined;
  /** `--token-offset`, when given: an explicit window is its own limit. */
  readonly tokenOffset?: number | undefined;
}

/** The resolved policy. `active: false` restores today's stdout exactly. */
export type OutputBudgetPolicy =
  | {
      readonly active: false;
      readonly stdoutKind: StdoutKind;
      readonly unflaggedFormat: "toon";
    }
  | {
      readonly active: true;
      readonly stdoutKind: StdoutKind;
      /** Rendered bytes a result may take (with `--token-limit`, `floor(1.3 N)` or the flag's n, whichever is smaller). */
      readonly limitBytes: number;
      /** Counted tokens a result may take, under `--token-limit`. */
      readonly tokenLimit?: number;
      /** True when `limitBytes` is a byte limit of its own (not only the token limit's shadow). */
      readonly bytesLimited: boolean;
      readonly source: OutputBudgetSource;
      /** The marker variable that kept the budget on for a file of its own. */
      readonly agentMarker?: string;
      /** A line to write before a digest that goes to a file (ruling 1). */
      readonly fileNotice?: string;
      readonly unflaggedFormat: "json" | "toon";
    };

export interface OutputBudgetPolicyError {
  readonly kind: "invalid-flag" | "invalid-environment" | "token-limit";
  readonly message: string;
}

/** The policy of a process that never resolved one (in-process drivers, tests). */
export const OUTPUT_BUDGET_OFF: OutputBudgetPolicy = {
  active: false,
  stdoutKind: "other",
  unflaggedFormat: "toon",
};

const agentMarker = (
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined =>
  AGENT_MARKERS.find((name) => {
    const value = environment[name];
    return value !== undefined && value !== "";
  });

/** The line a digest written to a file under an agent marker begins with. */
export const agentFileNotice = (marker: string): string =>
  `rea: ${marker} is set, so this file holds a digest of the result. For every byte, pass --output-budget off.`;

/**
 * Resolve the budget (contract section 2, first match wins):
 * 1. `--output-budget off`; 2. `--output-budget <n>`; 3. `REA_OUTPUT_BUDGET`;
 * 4. stdout a file of its own: off, unless an agent marker is set;
 * 5. the default, 6,000 bytes.
 * Rows 1 to 3 apply on every kind of stdout. `--token-limit N` without
 * `--token-offset` replaces the limit of rows 3 to 5 while the budget is on.
 */
export const resolveOutputBudget = (
  input: OutputBudgetPolicyInput,
): Result<OutputBudgetPolicy, OutputBudgetPolicyError> => {
  let setting: OutputBudgetSetting | undefined;
  let source: OutputBudgetSource | undefined;
  if (input.flag !== undefined) {
    const parsed = parseOutputBudget(input.flag, "--output-budget");
    if (!parsed.ok) return err({ kind: "invalid-flag", message: parsed.error });
    setting = parsed.value;
    source = "--output-budget";
  }
  // The environment is checked even when the flag wins, so a bad launch
  // setting is reported where it was made, not on the first call without a flag.
  const fromEnvironment = outputBudgetFromEnvironment(input.environment);
  if (!fromEnvironment.ok)
    return err({ kind: "invalid-environment", message: fromEnvironment.error });
  if (setting === undefined && fromEnvironment.value !== undefined) {
    setting = fromEnvironment.value;
    source = "REA_OUTPUT_BUDGET";
  }
  const off: OutputBudgetPolicy = {
    active: false,
    stdoutKind: input.stdoutKind,
    unflaggedFormat: "toon",
  };
  if (setting === "off") return ok(off);
  let marker: string | undefined;
  if (setting === undefined) {
    if (input.stdoutKind === "file") {
      marker = agentMarker(input.environment);
      if (marker === undefined) return ok(off);
      source = "agent-marker";
    } else source = "default";
    setting = DEFAULT_OUTPUT_BUDGET_BYTES;
  }
  const unflaggedFormat = input.stdoutKind === "terminal" ? "toon" : "json";
  const fileNotice =
    marker !== undefined
      ? { agentMarker: marker, fileNotice: agentFileNotice(marker) }
      : {};
  if (input.tokenLimit !== undefined && input.tokenOffset === undefined) {
    if (input.tokenLimit < MINIMUM_TOKEN_LIMIT)
      return err({
        kind: "token-limit",
        message: `--token-limit must be at least ${String(MINIMUM_TOKEN_LIMIT)} here: a digest needs 2048 bytes. To read less, select a part with --filter-output.`,
      });
    const flagBytes = source === "--output-budget" ? setting : undefined;
    const tokenBytes = tokenLimitBytes(input.tokenLimit);
    return ok({
      active: true,
      stdoutKind: input.stdoutKind,
      limitBytes:
        flagBytes === undefined ? tokenBytes : Math.min(flagBytes, tokenBytes),
      tokenLimit: input.tokenLimit,
      bytesLimited: flagBytes !== undefined && flagBytes < tokenBytes,
      source: "--token-limit",
      ...fileNotice,
      unflaggedFormat,
    });
  }
  return ok({
    active: true,
    stdoutKind: input.stdoutKind,
    limitBytes: setting,
    bytesLimited: true,
    source: source ?? "default",
    ...fileNotice,
    unflaggedFormat,
  });
};

/** How this process was started, as the launcher saw it. */
export interface CliInvocation {
  /** `process.execPath`. */
  readonly execPath: string;
  /** The script node ran (`process.argv[1]`). */
  readonly script: string;
}

/** The package this process belongs to, for a package-runner spelling. */
export interface CliPackageIdentity {
  readonly name: string;
  readonly version: string;
}

const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/u;

/**
 * One shell word. A word of safe characters is left bare (ids, plain paths);
 * anything else is single-quoted, as the repository's `shellQuote` quotes.
 */
export const shellWord = (value: string): string =>
  SAFE_WORD.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;

const LAUNCHER_NAMES = new Set(["rea", "rea-agents"]);

/**
 * The prefix a printed command starts with, spelled the way this process was
 * started so that it works as printed (contract 5.6).
 */
export const selfCommand = (
  invocation: CliInvocation | undefined,
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform,
  identity: CliPackageIdentity,
): string => {
  if (invocation === undefined) return "rea";
  const runner = invokingPackageRunner(environment, platform);
  if (runner === "npx") return `npx -y ${identity.name}@${identity.version}`;
  if (runner === "bunx") return `bunx ${identity.name}@${identity.version}`;
  const pathApi = platform === "win32" ? win32 : posix;
  const name = pathApi
    .basename(invocation.script)
    .replace(/\.(?:c|m)?js$|\.cmd$|\.exe$/iu, "");
  if (LAUNCHER_NAMES.has(name)) {
    const directory = pathApi.dirname(invocation.script);
    const searchPath =
      environment.PATH ?? (platform === "win32" ? environment.Path : undefined);
    const separator = platform === "win32" ? ";" : ":";
    const onPath = (searchPath ?? "")
      .split(separator)
      .some(
        (entry) =>
          entry !== "" && pathApi.resolve(entry) === pathApi.resolve(directory),
      );
    if (onPath) return name;
  }
  return `${shellWord(invocation.execPath)} ${shellWord(invocation.script)}`;
};

/** Commands whose results carry no text from the analysis target. */
const TARGET_FREE_COMMANDS: ReadonlySet<string> = new Set([
  "doctor",
  "providers",
  "capabilities",
  "setup",
  "update",
  "uninstall",
  "guidance",
  "guided-workflows",
  "instructions",
  "list-architectures",
  "list-objdump-architectures",
  "init-clone-run",
  "saved-output list",
  "saved-output clear",
]);

/**
 * Which digest paths may quote the target (contract 6.2): `true` for all of
 * `result` and `brief`, a list of paths, or `undefined` when none can.
 * `saved-output show` passes the command recorded with the saved file.
 */
export const targetText = (
  command: string,
): true | readonly string[] | undefined => {
  if (TARGET_FREE_COMMANDS.has(command)) return undefined;
  // The referee writes its commands, files, roles and reasons itself; only a
  // message may quote a value the applications returned.
  if (command === "evaluate-clone-run") return ["brief.worklist.message"];
  return toolReturnsTargetContent(command.replaceAll("-", "_"))
    ? true
    : undefined;
};
