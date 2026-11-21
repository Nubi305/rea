import type { JsonValue } from "../domain/jsonValue.js";
import { isRecord } from "../kernel/isRecord.js";
import type { CallToAction } from "./outputEnvelope.js";
import {
  cliCommandForOperation,
  type CliCommandEntry,
} from "./commandRegistry.js";

/**
 * The CLI form of a next probe. `inspect_artifact`, a target refusal and a
 * missing provider name each next step as an operation and its contract
 * arguments, which an MCP client calls as given. The CLI owns command
 * spellings, so it prints `command` in place of the arguments: the call as
 * a command line that runs as printed.
 */

type Arguments = Readonly<Record<string, string>>;

const SHELL_SAFE = /^[\w@%+=:,./-]+$/u;

/** One shell word, quoted only when it needs to be. */
export const shellWord = (value: string): string =>
  SHELL_SAFE.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;

const PATH_FIELDS = ["path", "input_path", "capture_path"] as const;

// Positional arguments and options after the path, by operation; fields not
// listed here leave the probe without a command rather than with a wrong one.
const TRAILING: Readonly<
  Record<
    string,
    {
      readonly fields: readonly string[];
      readonly words: (call: Arguments) => readonly string[] | undefined;
    }
  >
> = {
  inspect_web_network_capture: {
    fields: ["format"],
    words: ({ format }) => (format === undefined ? undefined : [format]),
  },
  inspect_evm_interface: {
    fields: ["encoding"],
    words: ({ encoding }) => (encoding === undefined ? undefined : [encoding]),
  },
  inspect_with_objdump: {
    fields: ["operation", "symbol"],
    words: ({ operation, symbol }) =>
      operation === undefined
        ? undefined
        : [operation, ...(symbol === undefined ? [] : ["--symbol", symbol])],
  },
  inspect_api_contract: {
    fields: ["format"],
    words: ({ format }) =>
      format === undefined ? [] : ["--contract-format", format],
  },
  recover_javascript_sources: {
    fields: ["output_directory"],
    words: ({ output_directory: output }) =>
      output === undefined ? undefined : [output],
  },
};

/** The command that runs one probe, or undefined when the CLI cannot spell it. */
export const probeCommand = (
  operation: string,
  call: Arguments,
  context: {
    readonly commands: readonly CliCommandEntry[];
    readonly cliName: string;
    readonly recordedCommands?: Readonly<Record<string, string>> | undefined;
    /** The inspected path, for a tool that reads the open session's target. */
    readonly targetPath?: string | undefined;
  },
): string | undefined => {
  const words = (name: string, rest: readonly string[]) =>
    [context.cliName, name, ...rest.map(shellWord)].join(" ");
  if (operation === "gdb_console")
    return call.command === undefined || call.executable === undefined
      ? undefined
      : words("debug-with-gdb", [
          call.command,
          "--executable",
          call.executable,
        ]);
  const pathField = PATH_FIELDS.find((field) => call[field] !== undefined);
  const path = pathField === undefined ? context.targetPath : call[pathField];
  if (path === undefined) return undefined;
  // A deep provider opens a file for `analyze` on the CLI.
  if (operation === "open_binary")
    return Object.keys(call).every((field) => field === "path")
      ? words("analyze", [path])
      : undefined;
  const trailing = TRAILING[operation];
  const known = new Set<string>([...PATH_FIELDS, ...(trailing?.fields ?? [])]);
  if (Object.keys(call).some((field) => !known.has(field))) return undefined;
  const rest = trailing === undefined ? [] : trailing.words(call);
  if (rest === undefined) return undefined;
  const command = cliCommandForOperation(
    operation,
    context.commands,
    context.cliName,
    context.recordedCommands,
  );
  if (command === undefined) return undefined;
  return words(command.slice(context.cliName.length + 1), [path, ...rest]);
};

const callArguments = (value: JsonValue | undefined): Arguments | undefined =>
  isRecord(value) &&
  Object.values(value).every((field) => typeof field === "string")
    ? (value as Arguments)
    : undefined;

const PROBE_KEYS: ReadonlySet<string> = new Set([
  "next_probes",
  "next_probe",
  "without_provider",
]);

// Probes sit a few levels down (result, summary view, error details); a
// bounded walk keeps a large record's rows out of it.
const MAX_DEPTH = 8;

/** The caller's path of a result, for probes of session-bound tools. */
const targetPathOf = (value: JsonValue): string | undefined => {
  if (!isRecord(value)) return undefined;
  for (const record of [value, value.summary, value.error]) {
    if (!isRecord(record)) continue;
    if (typeof record.caller_input_path === "string")
      return record.caller_input_path;
  }
  return undefined;
};

/**
 * Add `command` to every next probe in a CLI output that has an operation
 * and arguments the CLI can spell. Returns the same value when none changes.
 */
export const withProbeCommands = (
  output: JsonValue,
  context: Omit<Parameters<typeof probeCommand>[2], "targetPath">,
): JsonValue => {
  const targetPath = targetPathOf(output);
  const withCommand = (probe: JsonValue): JsonValue => {
    if (!isRecord(probe) || typeof probe.operation !== "string") return probe;
    if (typeof probe.command === "string") return probe;
    const call = callArguments(probe.arguments);
    if (call === undefined) return probe;
    const command = probeCommand(probe.operation, call, {
      ...context,
      targetPath,
    });
    if (command === undefined) return probe;
    // The command carries every argument, so the CLI prints it instead.
    const { arguments: _spelled, ...rest } = probe;
    return { ...rest, command };
  };
  const visit = (value: JsonValue, depth: number): JsonValue => {
    if (depth > MAX_DEPTH || value === null || typeof value !== "object")
      return value;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== Array.prototype)
      return value;
    if (Array.isArray(value)) {
      let changed = false;
      const items = value.map((item) => {
        const next = visit(item, depth + 1);
        if (next !== item) changed = true;
        return next;
      });
      return changed ? items : value;
    }
    let changed = false;
    const entries = Object.entries(value).map(([key, item]) => {
      let next: JsonValue;
      if (!PROBE_KEYS.has(key)) next = visit(item, depth + 1);
      else if (!Array.isArray(item)) next = withCommand(item);
      else {
        const probes = item.map(withCommand);
        next = probes.some((probe, index) => probe !== item[index])
          ? probes
          : item;
      }
      if (next !== item) changed = true;
      return [key, next] as const;
    });
    return changed ? Object.fromEntries(entries) : value;
  };
  return visit(output, 0);
};

/** Where a result keeps its next probes: in full, and in its summary view. */
const resultProbes = (output: JsonValue): readonly JsonValue[] => {
  if (!isRecord(output) || !isRecord(output.normalized_result)) return [];
  const result = output.normalized_result;
  if (Array.isArray(result.next_probes)) return result.next_probes;
  const summary = isRecord(result.summary) ? result.summary : undefined;
  const inspection =
    summary !== undefined && isRecord(summary.inspection)
      ? summary.inspection
      : undefined;
  return inspection !== undefined &&
    Array.isArray(inspection.unexplored_branches)
    ? inspection.unexplored_branches.flatMap((branch) =>
        isRecord(branch) && branch.next_probe !== undefined
          ? [branch.next_probe]
          : [],
      )
    : [];
};

/**
 * The next probes of a successful result as commands to print after it, each
 * with its rationale; undefined when the result names none the CLI can
 * spell. The result itself stays the retained Evidence.
 */
export const probeCallToAction = (
  output: JsonValue,
  context: Omit<Parameters<typeof probeCommand>[2], "targetPath">,
): CallToAction | undefined => {
  const targetPath = targetPathOf(output);
  const commands = resultProbes(output).flatMap((probe) => {
    if (!isRecord(probe) || typeof probe.operation !== "string") return [];
    const call = callArguments(probe.arguments);
    if (call === undefined) return [];
    const command = probeCommand(probe.operation, call, {
      ...context,
      targetPath,
    });
    if (command === undefined) return [];
    return [
      typeof probe.rationale === "string"
        ? { command, description: probe.rationale }
        : { command },
    ];
  });
  return commands.length === 0
    ? undefined
    : { description: "Next probes:", commands };
};
