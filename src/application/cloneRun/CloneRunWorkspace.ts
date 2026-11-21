import {
  appendFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { z } from "zod";

import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  type AnalysisInputIssue,
  cancelledBy,
} from "../../domain/analysisErrorCore.js";
import {
  browserScenarioSchema,
  type BrowserScenario,
} from "../../domain/browserScenario.js";
import { digestCanonicalValue } from "../../domain/canonicalDigest.js";
import {
  CLONE_RUN_DEFAULT_EXCLUDES,
  CLONE_RUN_DEFAULT_LIMITS,
  CLONE_RUN_EVERY_STEP,
  CLONE_RUN_ORIGIN_PLACEHOLDER,
  CLONE_RUN_PATHS,
  CLONE_RUN_ROLES,
  CLONE_RUN_SIDES,
  EVALUATE_CLONE_RUN_OPERATION,
  INIT_CLONE_RUN_OPERATION,
  cloneNameConflict,
  cloneRunIntendedDifferencesSchema,
  cloneRunJournalEntrySchema,
  cloneRunObligationsSchema,
  cloneRunScenarioSchema,
  cloneRunTargetSchema,
  cloneRunUnknownRole,
  cloneRunUnknownSchema,
  cloneRunWaiversSchema,
  type CloneRunAdmissionRecord,
  type CloneRunFileIssue,
  type CloneRunGate,
  type CloneRunInitResult,
  type CloneRunIntendedDifferences,
  type CloneRunJournalEntry,
  type CloneRunObligations,
  type CloneRunReasonCode,
  type CloneRunScenario,
  type CloneRunSide,
  type CloneRunTarget,
  type CloneRunUnknown,
  type CloneRunWaivers,
} from "../../domain/cloneRun/cloneRunSchemas.js";
import { shellQuote } from "../../domain/desktop/shellQuote.js";
import { EvidenceFileError } from "../../domain/evidenceErrors.js";
import { projectInputIssues } from "../../domain/inputIssueProjection.js";
import { escapeJsonPointerToken } from "../../domain/jsonPointer.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import { isPathWithinRoot } from "../../domain/localPath.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  CLONE_TREE_STEP_PREFIX,
  type ScenarioBehaviorComparison,
  type ScenarioBehaviorTable,
} from "../../domain/scenarioBehaviorComparison.js";
import { IDENTIFIER_PATTERN } from "../../domain/stringPatterns.js";
import { absoluteCallerPath } from "../../filesystem/callerPath.js";
import { errorMessage } from "../../kernel/errorMessage.js";
import { isRecord } from "../../kernel/isRecord.js";
import { ArtifactResourceScope, writeTextFile } from "../../resources/index.js";
import { readJsonFile } from "../JsonFiles.js";
import {
  SYSTEM_HOST_RESOLVER,
  cloneRunAddressConflict,
  type CloneRunHostResolver,
} from "./CloneRunAddressResolution.js";

/**
 * The run folder: scaffolding, reading the files agents write, rendering
 * capture inputs and writing the referee's outputs.
 * Contract: docs/specs/reconstruction/clone-runs/spec.md, "Run folder".
 */

/** One side's team commands, as flags give them; an omitted one is recorded as null. */
export interface CloneRunSideCommands {
  readonly start?: string | undefined;
  readonly reset?: string | undefined;
  readonly stop?: string | undefined;
  readonly health?: string | undefined;
}

/** What `rea init-clone-run` passes after parsing its flags. */
export interface CloneRunInitInput {
  readonly runDirectory: string;
  readonly originalAddress: string;
  readonly cloneAddress: string;
  readonly cloneRoot: string;
  readonly cloneName: string;
  readonly originalNames: readonly string[];
  readonly authorization: string;
  readonly statedBy?: string | undefined;
  readonly browserExecutable: string;
  readonly noSandbox: boolean;
  /** Replaces the default excludes when given. */
  readonly exclude?: readonly string[] | undefined;
  /** Replaces the default original material (`scout`) when given. */
  readonly material?: readonly string[] | undefined;
  readonly originalCommands?: CloneRunSideCommands | undefined;
  readonly cloneCommands?: CloneRunSideCommands | undefined;
  readonly reaCommand?: string | undefined;
  readonly maxRounds?: number | undefined;
  readonly captureTimeoutSeconds?: number | undefined;
}

/**
 * The authored-file examples `init-clone-run` writes; the specification shows
 * the same documents. `scenarioPages` is a second scenario that drives the
 * page: a `goto` with the `{origin}` placeholder, `fill`, `select_option`, a
 * `click` that waits for its reply with `save_response`, and `wait_for`.
 */
export const CLONE_RUN_EXAMPLES = Object.freeze({
  scenario: {
    file: `${CLONE_RUN_PATHS.examples}/scenario.example.json`,
    document: {
      start_path: "/",
      actions: [
        {
          step_id: "fp-notes",
          action: "request",
          method: "GET",
          path: "/api/notes",
          timeout_ms: 15000,
        },
        {
          step_id: "create-empty-title",
          action: "request",
          method: "POST",
          path: "/api/notes",
          json: { title: "   " },
          timeout_ms: 15000,
        },
      ],
    },
  },
  scenarioPages: {
    file: `${CLONE_RUN_PATHS.examples}/scenario-pages.example.json`,
    document: {
      start_path: "/",
      actions: [
        {
          step_id: "fp-notes",
          action: "request",
          method: "GET",
          path: "/api/notes",
          timeout_ms: 15000,
        },
        {
          step_id: "open-new-note",
          action: "goto",
          destination: { url: `${CLONE_RUN_ORIGIN_PLACEHOLDER}/notes/new` },
          wait_until: "load",
          timeout_ms: 15000,
        },
        {
          step_id: "setup-type-title",
          action: "fill",
          locator: { kind: "role", role: "textbox", name: "Title" },
          value: { source: "literal", value: "Field notes" },
          timeout_ms: 15000,
        },
        {
          step_id: "setup-choose-folder",
          action: "select_option",
          locator: { kind: "role", role: "combobox", name: "Folder" },
          value: { source: "literal", value: "inbox" },
          timeout_ms: 15000,
        },
        {
          step_id: "setup-save-note",
          action: "click",
          locator: { kind: "role", role: "button", name: "Save" },
          save_response: {
            method: "POST",
            path: "/api/notes",
            save: [{ name: "note", json_pointer: "/id" }],
          },
          timeout_ms: 15000,
        },
        {
          step_id: "note-saved-notice",
          action: "wait_for",
          locator: { kind: "css", selector: "[role=status]" },
          state: "visible",
          timeout_ms: 15000,
        },
      ],
    },
  },
  obligations: {
    file: `${CLONE_RUN_PATHS.examples}/obligations.example.json`,
    document: {
      obligations: [
        {
          id: "notes-title-required",
          statement:
            "Creating a note whose title is empty after trimming answers 422 with error title_required.",
          basis: "observed",
          cases: [{ scenario: "notes-api", step_ids: ["create-empty-title"] }],
        },
      ],
    },
  },
  unknown: {
    file: `${CLONE_RUN_PATHS.examples}/unknown.example.json`,
    document: {
      statement:
        "Whether titles are limited by characters or bytes was not probed.",
    },
  },
});

/** Where `init-clone-run` writes the crawl example. */
export const CLONE_RUN_CRAWL_EXAMPLE_FILE = `${CLONE_RUN_PATHS.examples}/crawl.example.json`;

/**
 * A complete `capture-browser-scenario` input for the scout's first crawl of
 * the original: `goto` steps in the run's browser, the accessibility text and
 * the address after each step, and request and reply bodies on. It is a
 * capture input, not a run scenario: the scout copies it to `scout/`, lists
 * the pages to visit and runs the capture command on it.
 */
export const cloneRunCrawlExample = (target: CloneRunTarget): JsonValue => ({
  browser: {
    mode: "launch",
    executable_path: target.browser.executable_path,
  },
  start_url: { url: `${target.original.address}/` },
  actions: [
    {
      step_id: "open-home",
      action: "goto",
      destination: { url: `${target.original.address}/` },
      wait_until: "load",
      timeout_ms: 15000,
    },
    {
      step_id: "open-second-page",
      action: "goto",
      destination: { url: `${target.original.address}/about` },
      wait_until: "load",
      timeout_ms: 15000,
    },
  ],
  capture: {
    after_each_step: ["url", "accessibility"],
    at_end: ["url", "accessibility"],
    network: {
      request_body: true,
      response_body: true,
      header_values: false,
    },
  },
});

/** Read the signal afresh: control-flow narrowing would keep an earlier answer across an await. */
const isAborted = (signal: AbortSignal | undefined): signal is AbortSignal =>
  signal?.aborted === true;

const encodeJson = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

const errnoCode = (cause: unknown): unknown =>
  typeof cause === "object" && cause !== null && "code" in cause
    ? cause.code
    : undefined;

const isAbsent = (cause: unknown): boolean => {
  const code = errnoCode(cause);
  return code === "ENOENT" || code === "ENOTDIR";
};

const refusal = (
  operation: string,
  userMessage: string,
  remediationAction: string,
  cause?: unknown,
): AnalysisInputError =>
  new AnalysisInputError(operation, {
    ...(cause === undefined ? {} : { cause }),
    conformsToInputContract: true,
    userMessage,
    remediationAction,
  });

/** The exact command that runs the referee, as every non-capture worklist item spells it. */
export const cloneRunEvaluateCommand = (
  run: string,
  reaCommand: string,
): string => `${reaCommand} evaluate-clone-run ${shellQuote(run)} --exit-code`;

/**
 * A path with every symlink resolved, also when its last segments do not
 * exist yet: the deepest existing ancestor is resolved and the rest appended.
 * Lexical containment (`isPathWithinRoot`) is only meaningful on such paths.
 */
export const resolveCloneRunPath = async (path: string): Promise<string> => {
  const rest: string[] = [];
  let current = absoluteCallerPath(path);
  for (;;) {
    try {
      return join(await realpath(current), ...rest.toReversed());
    } catch (cause: unknown) {
      const parent = dirname(current);
      if (!isAbsent(cause) || parent === current) throw cause;
      rest.push(basename(current));
      current = parent;
    }
  }
};

/** Whether the run folder is the clone root or inside it; both paths are symlink-resolved. */
export const cloneRunFolderInsideClone = async (
  run: string,
  cloneRoot: string,
): Promise<boolean> =>
  isPathWithinRoot(
    await resolveCloneRunPath(cloneRoot),
    await resolveCloneRunPath(run),
  );

const sideCommands = (
  commands: CloneRunSideCommands | undefined,
): CloneRunTarget["original"]["commands"] => ({
  start: commands?.start ?? null,
  reset: commands?.reset ?? null,
  stop: commands?.stop ?? null,
  health: commands?.health ?? null,
});

/**
 * Create the run folder and everything that follows from the flags. The
 * directory must be absent or empty and outside the clone root; nothing is
 * overwritten.
 */
export const initCloneRun = async (
  input: CloneRunInitInput,
  options: {
    readonly now?: () => Date;
    readonly signal?: AbortSignal;
    /** How host names resolve; production uses the system resolver. */
    readonly hostResolver?: CloneRunHostResolver;
  } = {},
): Promise<Result<CloneRunInitResult, AnalysisError>> => {
  const operation = INIT_CLONE_RUN_OPERATION;
  if (isAborted(options.signal))
    return err(cancelledBy(operation, options.signal));
  const run = absoluteCallerPath(input.runDirectory);
  const candidate = {
    schema: "rea.clone-run.target/1",
    authorization: {
      statement: input.authorization,
      stated_by: input.statedBy ?? null,
      recorded_at: (options.now ?? (() => new Date()))().toISOString(),
    },
    original: {
      address: input.originalAddress,
      names: [...input.originalNames],
      material: [...(input.material ?? [CLONE_RUN_PATHS.scout])],
      commands: sideCommands(input.originalCommands),
    },
    clone: {
      address: input.cloneAddress,
      name: input.cloneName,
      root: absoluteCallerPath(input.cloneRoot),
      exclude: [...(input.exclude ?? CLONE_RUN_DEFAULT_EXCLUDES)],
      commands: sideCommands(input.cloneCommands),
    },
    browser: {
      executable_path: absoluteCallerPath(input.browserExecutable),
      no_sandbox: input.noSandbox,
    },
    rea_command: input.reaCommand ?? "rea",
    limits: {
      ...CLONE_RUN_DEFAULT_LIMITS,
      ...(input.maxRounds === undefined ? {} : { max_rounds: input.maxRounds }),
      ...(input.captureTimeoutSeconds === undefined
        ? {}
        : { capture_timeout_seconds: input.captureTimeoutSeconds }),
    },
  };
  const parsed = cloneRunTargetSchema.safeParse(candidate);
  if (!parsed.success)
    return err(
      new AnalysisInputError(
        operation,
        {
          cause: parsed.error,
          userMessage: `The flags do not make a valid target.json: ${parsed.error.issues
            .map(
              (issue) =>
                `${issue.path.map(String).join(".")}: ${issue.message}`,
            )
            .join("; ")}`,
        },
        projectInputIssues(parsed.error.issues, candidate),
      ),
    );
  const target = parsed.data;
  const sameAddress = await cloneRunAddressConflict(
    target.original.address,
    target.clone.address,
    options.hostResolver ?? SYSTEM_HOST_RESOLVER,
  );
  if (sameAddress !== undefined)
    return err(
      refusal(
        operation,
        sameAddress.message,
        "Serve the clone on another port and pass that address as the clone's.",
      ),
    );
  const conflict = cloneNameConflict(target.clone.name, target.original.names);
  if (conflict !== undefined)
    return err(
      refusal(
        operation,
        `The clone's name "${target.clone.name}" contains the original's name "${conflict}", which may not appear in the clone.`,
        "Choose a clone name that contains none of the original's names.",
      ),
    );
  try {
    if (await cloneRunFolderInsideClone(run, target.clone.root))
      return err(
        refusal(
          operation,
          `The run folder ${run} is the clone root ${target.clone.root} or inside it. It holds material captured from the original, which must stay out of the clone's source.`,
          "Choose a run folder outside the clone root.",
        ),
      );
    const existing = await readdir(run).catch((cause: unknown) => {
      if (errnoCode(cause) === "ENOENT") return [];
      throw cause;
    });
    if (existing.length > 0)
      return err(
        refusal(
          operation,
          `The run folder ${run} is not empty. Nothing is overwritten.`,
          "Choose a directory that is absent or empty, or evaluate the existing run with evaluate-clone-run.",
        ),
      );
    await mkdir(run, { recursive: true });
    for (const directory of [
      CLONE_RUN_PATHS.scenarios,
      CLONE_RUN_PATHS.obligations,
      CLONE_RUN_PATHS.unknowns,
      CLONE_RUN_PATHS.specs,
      CLONE_RUN_PATHS.scout,
      CLONE_RUN_PATHS.examples,
      ...CLONE_RUN_SIDES.map((side) => join(CLONE_RUN_PATHS.evidence, side)),
    ])
      await mkdir(join(run, directory), { recursive: true });
  } catch (cause: unknown) {
    return err(
      refusal(
        operation,
        `Could not create the run folder ${run}: ${errorMessage(cause)}`,
        "Choose a directory this user can create and write.",
        cause,
      ),
    );
  }

  const resolvedRun = await realpath(run);
  const differences: CloneRunIntendedDifferences = {
    renames: target.original.names.map((from) => ({
      from,
      to: target.clone.name,
      reason: "product name",
    })),
    volatile_fields: [],
  };
  const waivers: CloneRunWaivers = { waivers: [], closed: [] };
  const files: readonly (readonly [string, unknown])[] = [
    [CLONE_RUN_PATHS.target, target],
    [CLONE_RUN_PATHS.intendedDifferences, differences],
    [CLONE_RUN_PATHS.waivers, waivers],
    ...Object.values(CLONE_RUN_EXAMPLES).map(
      ({ file, document }) => [file, document] as const,
    ),
    [CLONE_RUN_CRAWL_EXAMPLE_FILE, cloneRunCrawlExample(target)],
  ];
  const resources = new ArtifactResourceScope();
  const created: string[] = [];
  for (const [file, document] of files) {
    if (isAborted(options.signal))
      return err(cancelledBy(operation, options.signal));
    const written = await writeTextFile(
      encodeJson(document),
      join(resolvedRun, file),
      false,
      resources,
    );
    if (!written.ok) return written;
    created.push(file);
  }
  // The first worklist is the referee's own: one producer, so init and the first evaluation agree.
  const [
    { evaluateCloneRun },
    { digestCloneTree },
    { SCENARIO_BEHAVIOR_COMPARER },
  ] = await Promise.all([
    import("./CloneRunEvaluation.js"),
    import("./CloneRunTreeDigest.js"),
    import("../scenarioBehavior/ScenarioBehaviorComparisonService.js"),
  ]);
  const first = await evaluateCloneRun(
    resolvedRun,
    {
      comparer: SCENARIO_BEHAVIOR_COMPARER,
      digestTree: digestCloneTree,
      now: options.now ?? (() => new Date()),
      ...(options.hostResolver === undefined
        ? {}
        : { hostResolver: options.hostResolver }),
    },
    {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      writeOutputs: false,
    },
  );
  if (!first.ok) return first;
  return ok({
    run: resolvedRun,
    created,
    authored: [
      {
        file: `${CLONE_RUN_PATHS.scenarios}/<scenario>.json`,
        role: "prober",
        example: CLONE_RUN_EXAMPLES.scenario.file,
      },
      {
        file: `${CLONE_RUN_PATHS.scenarios}/<scenario>.json`,
        role: "prober",
        example: CLONE_RUN_EXAMPLES.scenarioPages.file,
      },
      {
        file: `${CLONE_RUN_PATHS.obligations}/<area>.json`,
        role: "spec_writer",
        example: CLONE_RUN_EXAMPLES.obligations.file,
      },
      {
        file: `${CLONE_RUN_PATHS.unknowns}/<role>-<n>.json`,
        example: CLONE_RUN_EXAMPLES.unknown.file,
      },
      {
        file: `${CLONE_RUN_PATHS.scout}/<crawl>.json`,
        role: "scout",
        example: CLONE_RUN_CRAWL_EXAMPLE_FILE,
      },
    ],
    next: first.value.next,
  });
};

/** A refused authored file, with the reason code the worklist reports it under. */
export interface CloneRunInputIssue extends CloneRunFileIssue {
  readonly reason: CloneRunReasonCode;
}

/** The files of a run folder that agents and the capture command write, parsed. */
export interface CloneRunWorkspace {
  /** Absolute, symlink-resolved run directory. */
  readonly run: string;
  /** Null when `target.json` is refused; `issues` then says why. */
  readonly target: CloneRunTarget | null;
  /** How worklist commands spell the CLI: `target.json`'s `rea_command`, also read from a refused file that still states one. */
  readonly reaCommand: string;
  /** Whether `target.json` stated that spelling; false when the file could not supply one and `reaCommand` is the default. */
  readonly reaCommandStated: boolean;
  /** Valid scenarios by id (the file's base name), in id order. */
  readonly scenarios: ReadonlyMap<string, CloneRunScenario>;
  /** Valid obligation files by area (the file's base name), in area order. */
  readonly obligations: ReadonlyMap<string, CloneRunObligations>;
  /** Valid unknowns by id (the file's base name, `<role>-<n>`). */
  readonly unknowns: ReadonlyMap<string, CloneRunUnknown>;
  readonly waivers: CloneRunWaivers;
  readonly intendedDifferences: CloneRunIntendedDifferences;
  /** Every non-hidden entry of `evidence/<side>/<scenario>/`, sorted by name; contents are not read here. */
  readonly evidence: Readonly<
    Record<CloneRunSide, ReadonlyMap<string, readonly CloneRunEvidenceEntry[]>>
  >;
  /** Every refused file; a refused file is absent from the maps above. */
  readonly issues: readonly CloneRunInputIssue[];
}

/**
 * One entry of an Evidence directory. Only a regular file can be a capture;
 * every other entry is listed too, so the referee rejects it by name and
 * never offers its name to a capture command.
 */
export interface CloneRunEvidenceEntry {
  /** Absolute path. */
  readonly path: string;
  readonly kind: "file" | "directory" | "link" | "other";
}

/** JSON pointer of a schema issue path. */
const pointerOf = (path: readonly (string | number)[]): string =>
  path.map((part) => `/${escapeJsonPointerToken(String(part))}`).join("");

const jsonText = (value: unknown): string => JSON.stringify(value);

/** What is wrong and how to fix it, from one projected schema issue. */
const issueText = (
  issue: AnalysisInputIssue,
): { readonly message: string; readonly fix: string } => {
  const expected =
    issue.expected === undefined
      ? ""
      : `: expected ${jsonText(issue.expected)}`;
  switch (issue.reason) {
    case "unknown_argument":
      return {
        message: "Unknown member",
        fix:
          issue.message ??
          "Remove it; the file accepts only the members its example shows",
      };
    case "missing_argument":
      return {
        message: `Required member is missing${expected}`,
        fix: "Add it",
      };
    case "invalid_type":
      return {
        message: `Wrong type${expected}`,
        fix: issue.message ?? "Use a value of the expected type",
      };
    case "out_of_range":
      return {
        message: `Out of range${
          issue.minimum === undefined ? "" : `, minimum ${issue.minimum}`
        }${issue.maximum === undefined ? "" : `, maximum ${issue.maximum}`}`,
        fix: issue.message ?? "Use a value inside the range",
      };
    default: {
      // Schema-authored messages read "<what is wrong>; <the fix>".
      const [what, ...fix] = (
        issue.message ?? `Invalid value${expected}`
      ).split("; ");
      return {
        message: what ?? "Invalid value",
        fix:
          fix.length > 0 ? fix.join("; ") : "Correct the value at this pointer",
      };
    }
  }
};

/** The line an observed obligation without a case needs, as the specification words it. */
const CASE_FIX =
  'add {"scenario": "<id>", "step_ids": ["<step>"]} or set basis to "inferred"';

interface AuthoredKind<Schema extends z.ZodType> {
  readonly reason: CloneRunReasonCode;
  readonly schema: Schema;
  /** A valid example the fix can point at. */
  readonly example: string | null;
}

const AUTHORED = {
  target: {
    reason: "target_invalid",
    schema: cloneRunTargetSchema,
    example: null,
  },
  scenario: {
    reason: "scenario_invalid",
    schema: cloneRunScenarioSchema,
    example: CLONE_RUN_EXAMPLES.scenario.file,
  },
  obligations: {
    reason: "obligation_invalid",
    schema: cloneRunObligationsSchema,
    example: CLONE_RUN_EXAMPLES.obligations.file,
  },
  unknown: {
    reason: "unknown_invalid",
    schema: cloneRunUnknownSchema,
    example: CLONE_RUN_EXAMPLES.unknown.file,
  },
  waivers: {
    reason: "waivers_invalid",
    schema: cloneRunWaiversSchema,
    example: null,
  },
  intendedDifferences: {
    reason: "intended_differences_invalid",
    schema: cloneRunIntendedDifferencesSchema,
    example: null,
  },
} as const satisfies Readonly<Record<string, AuthoredKind<z.ZodType>>>;

const withExample = (fix: string, example: string | null): string =>
  example === null ? fix : `${fix}; ${example} is a valid example`;

/** Parse one authored document; every schema issue becomes a file issue with pointer and fix. */
const parseAuthored = <Schema extends z.ZodType>(
  kind: AuthoredKind<Schema>,
  file: string,
  value: unknown,
  issues: CloneRunInputIssue[],
): z.infer<Schema> | undefined => {
  const parsed = kind.schema.safeParse(value);
  if (parsed.success) return parsed.data;
  for (const issue of projectInputIssues(parsed.error.issues, value)) {
    const text = issueText(issue);
    issues.push({
      reason: kind.reason,
      file,
      pointer: pointerOf(issue.path),
      message: text.message,
      fix: withExample(
        kind.reason === "obligation_invalid" && issue.path.at(-1) === "cases"
          ? CASE_FIX
          : text.fix,
        kind.example,
      ),
    });
  }
  return undefined;
};

type AuthoredRead =
  | { readonly kind: "value"; readonly value: unknown }
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable"; readonly message: string };

/** Read one authored JSON file through the repository's JSON file owner. */
const readAuthored = async (
  path: string,
  signal: AbortSignal | undefined,
): Promise<Result<AuthoredRead, AnalysisCancelledError>> => {
  const read = await readJsonFile(
    path,
    signal,
    undefined,
    EVALUATE_CLONE_RUN_OPERATION,
  );
  if (read.ok) return ok({ kind: "value", value: read.value });
  if (read.error instanceof AnalysisCancelledError) return err(read.error);
  if (read.error instanceof EvidenceFileError) {
    if (read.error.reason === "missing") return ok({ kind: "missing" });
    if (read.error.reason === "invalid-json")
      return ok({ kind: "unreadable", message: "The file is not valid JSON" });
    if (read.error.reason === "not-file")
      return ok({ kind: "unreadable", message: "This is not a regular file" });
  }
  return ok({
    kind: "unreadable",
    message: `The file could not be read: ${read.error.userMessage ?? read.error.message}`,
  });
};

/** Names of the entries of a directory that matter, sorted; an absent directory has none. */
const listEntries = async (
  directory: string,
  kind: "file" | "directory",
): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (cause: unknown) => {
      if (isAbsent(cause)) return [];
      throw cause;
    },
  );
  return entries
    .filter(
      (entry) =>
        !entry.name.startsWith(".") &&
        (kind === "file" ? entry.isFile() : entry.isDirectory()),
    )
    .map((entry) => entry.name)
    .toSorted();
};

/** Every non-hidden entry of an Evidence directory with its kind, sorted by name. */
const listEvidenceEntries = async (
  directory: string,
): Promise<readonly CloneRunEvidenceEntry[]> =>
  (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith("."))
    .toSorted((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )
    .map((entry) => ({
      path: join(directory, entry.name),
      kind: entry.isFile()
        ? "file"
        : entry.isDirectory()
          ? "directory"
          : entry.isSymbolicLink()
            ? "link"
            : "other",
    }));

const JSON_SUFFIX = ".json";

/** Load one directory of authored files named `<id>.json`. */
const loadAuthoredDirectory = async <Schema extends z.ZodType>(
  run: string,
  directory: string,
  kind: AuthoredKind<Schema>,
  issues: CloneRunInputIssue[],
  signal: AbortSignal | undefined,
  nameIssue: (id: string) => string | undefined,
): Promise<
  Result<
    {
      readonly valid: Map<string, z.infer<Schema>>;
      readonly seen: Set<string>;
    },
    AnalysisCancelledError
  >
> => {
  const valid = new Map<string, z.infer<Schema>>();
  const seen = new Set<string>();
  for (const name of await listEntries(join(run, directory), "file")) {
    const file = `${directory}/${name}`;
    const id = name.endsWith(JSON_SUFFIX)
      ? name.slice(0, -JSON_SUFFIX.length)
      : undefined;
    const badName =
      id === undefined || !IDENTIFIER_PATTERN.test(id)
        ? "The file name is not <id>.json with an id of letters, digits, '.', '_' and '-' starting with a letter"
        : nameIssue(id);
    if (id !== undefined) seen.add(id);
    if (id === undefined || badName !== undefined) {
      issues.push({
        reason: kind.reason,
        file,
        pointer: "",
        message: badName ?? "The file name is not <id>.json",
        fix: withExample(
          "Rename the file, or remove it if it does not belong here",
          kind.example,
        ),
      });
      continue;
    }
    const read = await readAuthored(join(run, file), signal);
    if (!read.ok) return read;
    if (read.value.kind === "missing") continue;
    if (read.value.kind === "unreadable") {
      issues.push({
        reason: kind.reason,
        file,
        pointer: "",
        message: read.value.message,
        fix: withExample("Write one JSON document", kind.example),
      });
      continue;
    }
    const parsed = parseAuthored(kind, file, read.value.value, issues);
    if (parsed !== undefined) valid.set(id, parsed);
  }
  return ok({ valid, seen });
};

/** Load one lead-owned file at the run root; an absent file declares nothing. */
const loadLeadFile = async <Schema extends z.ZodType>(
  run: string,
  file: string,
  kind: AuthoredKind<Schema>,
  empty: z.infer<Schema>,
  issues: CloneRunInputIssue[],
  signal: AbortSignal | undefined,
): Promise<Result<z.infer<Schema>, AnalysisCancelledError>> => {
  const read = await readAuthored(join(run, file), signal);
  if (!read.ok) return read;
  if (read.value.kind === "missing") return ok(empty);
  if (read.value.kind === "unreadable") {
    issues.push({
      reason: kind.reason,
      file,
      pointer: "",
      message: read.value.message,
      fix: `Write one JSON document such as ${jsonText(empty)}`,
    });
    return ok(empty);
  }
  return ok(parseAuthored(kind, file, read.value.value, issues) ?? empty);
};

/** The rules of check 2 that only the folder as a whole shows. */
const crossFileIssues = (
  workspace: Pick<
    CloneRunWorkspace,
    "scenarios" | "obligations" | "unknowns" | "waivers" | "intendedDifferences"
  >,
  seen: {
    readonly scenarios: ReadonlySet<string>;
    readonly unknowns: ReadonlySet<string>;
  },
  issues: CloneRunInputIssue[],
): void => {
  const basisById = new Map<string, "observed" | "inferred">();
  const firstFile = new Map<string, string>();
  for (const [area, { obligations }] of workspace.obligations) {
    const file = `${CLONE_RUN_PATHS.obligations}/${area}.json`;
    obligations.forEach((obligation, index) => {
      const earlier = firstFile.get(obligation.id);
      if (earlier !== undefined)
        issues.push({
          reason: "obligation_invalid",
          file,
          pointer: `/obligations/${index}/id`,
          message: `Obligation id ${obligation.id} is already used in ${earlier}`,
          fix: "Give each obligation its own id across all obligation files",
        });
      else {
        firstFile.set(obligation.id, file);
        basisById.set(obligation.id, obligation.basis);
      }
    });
  }
  workspace.waivers.waivers.forEach((waiver, index) => {
    const pointer = `/waivers/${index}/id`;
    if (waiver.kind === "unknown") {
      if (!seen.unknowns.has(waiver.id))
        issues.push({
          reason: "waivers_invalid",
          file: CLONE_RUN_PATHS.waivers,
          pointer,
          message: `The waiver names unknown ${waiver.id}, and ${CLONE_RUN_PATHS.unknowns}/${waiver.id}.json does not exist`,
          fix: "Name an existing unknown, or remove the waiver",
        });
      return;
    }
    const basis = basisById.get(waiver.id);
    if (basis !== "inferred")
      issues.push({
        reason: "waivers_invalid",
        file: CLONE_RUN_PATHS.waivers,
        pointer,
        message:
          basis === undefined
            ? `The waiver names obligation ${waiver.id}, which does not exist`
            : `The waiver names obligation ${waiver.id}, which is observed. Only an inferred obligation can be waived; a difference or missing data cannot`,
        fix: "Name an existing inferred obligation, or remove the waiver",
      });
  });
  workspace.waivers.closed.forEach((closed, index) => {
    if (!seen.unknowns.has(closed.unknown))
      issues.push({
        reason: "waivers_invalid",
        file: CLONE_RUN_PATHS.waivers,
        pointer: `/closed/${index}/unknown`,
        message: `The entry names unknown ${closed.unknown}, and ${CLONE_RUN_PATHS.unknowns}/${closed.unknown}.json does not exist`,
        fix: "Name an existing unknown, or remove the entry",
      });
    const basis = basisById.get(closed.obligation);
    if (basis !== "observed")
      issues.push({
        reason: "waivers_invalid",
        file: CLONE_RUN_PATHS.waivers,
        pointer: `/closed/${index}/obligation`,
        message:
          basis === undefined
            ? `The entry names obligation ${closed.obligation}, which does not exist`
            : `The entry names obligation ${closed.obligation}, which is inferred. Only an observed obligation settles an unknown`,
        fix: "Name an existing observed obligation, or remove the entry",
      });
  });
  workspace.intendedDifferences.volatile_fields.forEach((field, index) => {
    const scenario = workspace.scenarios.get(field.scenario);
    if (scenario === undefined) {
      // A scenario file that is itself refused is reported there, once.
      if (!seen.scenarios.has(field.scenario))
        issues.push({
          reason: "intended_differences_invalid",
          file: CLONE_RUN_PATHS.intendedDifferences,
          pointer: `/volatile_fields/${index}/scenario`,
          message: `The volatile field names scenario ${field.scenario}, and ${CLONE_RUN_PATHS.scenarios}/${field.scenario}.json does not exist`,
          fix: "Name an existing scenario, or remove the entry",
        });
      return;
    }
    if (
      field.step_id !== CLONE_RUN_EVERY_STEP &&
      !scenario.actions.some((action) => action.step_id === field.step_id)
    )
      issues.push({
        reason: "intended_differences_invalid",
        file: CLONE_RUN_PATHS.intendedDifferences,
        pointer: `/volatile_fields/${index}/step_id`,
        message: `The volatile field names step ${field.step_id}, which scenario ${field.scenario} does not have`,
        fix: `Name an existing step of that scenario, write "${CLONE_RUN_EVERY_STEP}" for every step, or remove the entry`,
      });
  });
};

/**
 * Read the authored files. A missing run directory or `target.json` is a
 * refusal; a file that fails its schema is an issue, never a refusal, so one
 * evaluation reports every broken file. Beyond the schemas it refuses what
 * only the folder shows: a base name that is not an identifier, an unknown
 * not named `<role>-<n>`, an obligation id used twice, a waiver or `closed`
 * entry that names nothing, and a volatile field whose scenario or step does
 * not exist (specification, "What done means", check 2).
 *
 * A file refused by its schema is absent from the maps. A file refused only
 * by a cross-file rule keeps its parsed content: the issue blocks, and the
 * entry that names nothing has no effect. An absent `waivers.json` or
 * `intended-differences.json` declares nothing.
 */
export const loadCloneRunWorkspace = async (
  runDirectory: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Result<CloneRunWorkspace, AnalysisError>> => {
  const operation = EVALUATE_CLONE_RUN_OPERATION;
  const { signal } = options;
  if (isAborted(signal)) return err(cancelledBy(operation, signal));
  const requested = absoluteCallerPath(runDirectory);
  const initRemedy =
    "Create the run folder with init-clone-run, or pass the directory it created.";
  let run: string;
  try {
    run = await realpath(requested);
    if (!(await lstat(run)).isDirectory())
      return err(
        refusal(operation, `${requested} is not a directory.`, initRemedy),
      );
  } catch (cause: unknown) {
    return err(
      refusal(
        operation,
        `The run folder ${requested} does not exist or cannot be read.`,
        initRemedy,
        cause,
      ),
    );
  }

  const issues: CloneRunInputIssue[] = [];
  const targetRead = await readAuthored(
    join(run, CLONE_RUN_PATHS.target),
    signal,
  );
  if (!targetRead.ok) return targetRead;
  if (targetRead.value.kind === "missing")
    return err(
      refusal(
        operation,
        `${run} has no ${CLONE_RUN_PATHS.target}, so it is not a clone run folder.`,
        initRemedy,
      ),
    );
  let target: CloneRunTarget | null = null;
  const stated =
    targetRead.value.kind === "value" && isRecord(targetRead.value.value)
      ? targetRead.value.value.rea_command
      : undefined;
  if (targetRead.value.kind === "unreadable")
    issues.push({
      reason: "target_invalid",
      file: CLONE_RUN_PATHS.target,
      pointer: "",
      message: targetRead.value.message,
      fix: "Restore the file init-clone-run wrote, or create a new run folder",
    });
  else
    target =
      parseAuthored(
        AUTHORED.target,
        CLONE_RUN_PATHS.target,
        targetRead.value.value,
        issues,
      ) ?? null;

  try {
    const scenarios = await loadAuthoredDirectory(
      run,
      CLONE_RUN_PATHS.scenarios,
      AUTHORED.scenario,
      issues,
      signal,
      () => undefined,
    );
    if (!scenarios.ok) return scenarios;
    const obligations = await loadAuthoredDirectory(
      run,
      CLONE_RUN_PATHS.obligations,
      AUTHORED.obligations,
      issues,
      signal,
      () => undefined,
    );
    if (!obligations.ok) return obligations;
    const unknowns = await loadAuthoredDirectory(
      run,
      CLONE_RUN_PATHS.unknowns,
      AUTHORED.unknown,
      issues,
      signal,
      (id) =>
        cloneRunUnknownRole(id) === undefined
          ? `An unknown is named <role>-<n>.json, where <role> is one of ${CLONE_RUN_ROLES.join(", ")} and <n> counts from 1`
          : undefined,
    );
    if (!unknowns.ok) return unknowns;
    const waivers = await loadLeadFile(
      run,
      CLONE_RUN_PATHS.waivers,
      AUTHORED.waivers,
      { waivers: [], closed: [] },
      issues,
      signal,
    );
    if (!waivers.ok) return waivers;
    const intendedDifferences = await loadLeadFile(
      run,
      CLONE_RUN_PATHS.intendedDifferences,
      AUTHORED.intendedDifferences,
      { renames: [], volatile_fields: [] },
      issues,
      signal,
    );
    if (!intendedDifferences.ok) return intendedDifferences;

    const evidence = {
      original: new Map<string, readonly CloneRunEvidenceEntry[]>(),
      clone: new Map<string, readonly CloneRunEvidenceEntry[]>(),
    };
    for (const side of CLONE_RUN_SIDES) {
      const sideDirectory = join(run, CLONE_RUN_PATHS.evidence, side);
      for (const scenario of await listEntries(sideDirectory, "directory"))
        evidence[side].set(
          scenario,
          await listEvidenceEntries(join(sideDirectory, scenario)),
        );
    }
    const statedCommand =
      target?.rea_command ??
      (typeof stated === "string" && stated.trim() !== "" ? stated : undefined);
    const workspace = {
      run,
      target,
      reaCommand: statedCommand ?? "rea",
      reaCommandStated: statedCommand !== undefined,
      scenarios: scenarios.value.valid,
      obligations: obligations.value.valid,
      unknowns: unknowns.value.valid,
      waivers: waivers.value,
      intendedDifferences: intendedDifferences.value,
      evidence,
      issues,
    };
    crossFileIssues(
      workspace,
      { scenarios: scenarios.value.seen, unknowns: unknowns.value.seen },
      issues,
    );
    return ok(workspace);
  } catch (cause: unknown) {
    return err(
      refusal(
        operation,
        `The run folder ${run} could not be read: ${errorMessage(cause)}`,
        "Make the run folder readable, then evaluate again.",
        cause,
      ),
    );
  }
};

/** A capture input the referee renders, and REA's digest of it. */
export interface RenderedCloneRunScenario {
  /** A capture-browser-scenario document, valid against the browser scenario schema. */
  readonly document: JsonValue;
  /** `digestCanonicalValue` of the parsed document: what the capture's Evidence records as `scenario_sha256`. */
  readonly scenarioSha256: string;
}

const originOf = (url: string): string | undefined => {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

/** How a `goto` names its page: the one spelling that renders for both sides. */
const GOTO_URL_FIX = `Write the URL as "${CLONE_RUN_ORIGIN_PLACEHOLDER}/<path>"; the placeholder is replaced by each side's address`;

/** One action with `{origin}` replaced at the start of a `goto` destination, its only place. */
const renderAction = (
  action: CloneRunScenario["actions"][number],
  address: string,
): JsonValue => {
  const { destination } = action;
  if (
    action.action !== "goto" ||
    !isRecord(destination) ||
    typeof destination.url !== "string" ||
    !destination.url.startsWith(CLONE_RUN_ORIGIN_PLACEHOLDER)
  )
    return action;
  return {
    ...action,
    destination: {
      ...destination,
      url: `${address}${destination.url.slice(CLONE_RUN_ORIGIN_PLACEHOLDER.length)}`,
    },
  };
};

/**
 * Render one scenario for one side. The clone side takes the clone tree
 * digest and ends with the `rea-tree-<digest>` step. `{origin}` is replaced
 * only at the start of a `goto` step's `destination.url`, and every rendered
 * `goto` must stay on the side's address; anything else is an issue against
 * `scenarios/<scenarioId>.json`. Pure: the same inputs give the same document
 * and digest.
 */
export const renderCloneRunScenario = (
  scenarioId: string,
  scenario: CloneRunScenario,
  target: CloneRunTarget,
  binding:
    | { readonly side: "original" }
    | { readonly side: "clone"; readonly cloneTreeSha256: string },
): Result<RenderedCloneRunScenario, readonly CloneRunFileIssue[]> => {
  const file = `${CLONE_RUN_PATHS.scenarios}/${scenarioId}.json`;
  const { address } = target[binding.side];
  const document: JsonValue = {
    browser: {
      mode: "launch",
      executable_path: target.browser.executable_path,
    },
    start_url: { url: `${address}${scenario.start_path}` },
    actions: [
      ...scenario.actions.map((action) => renderAction(action, address)),
      ...(binding.side === "clone"
        ? [
            {
              step_id: `${CLONE_TREE_STEP_PREFIX}${binding.cloneTreeSha256}`,
              action: "wait_for_timeout",
              duration_ms: 1,
            },
          ]
        : []),
    ],
    capture: {
      after_each_step: ["url", "accessibility"],
      at_end: ["url", "accessibility"],
      network: {
        request_body: true,
        response_body: true,
        header_values: false,
      },
    },
  };
  const parsed = browserScenarioSchema.safeParse(document);
  if (!parsed.success)
    return err(
      projectInputIssues(parsed.error.issues, document).map((issue) => {
        const text = issueText(issue);
        const [head] = issue.path;
        return {
          file,
          // The rendered document keeps the scenario's action indices.
          pointer:
            head === "actions"
              ? pointerOf(issue.path)
              : head === "start_url"
                ? "/start_path"
                : "",
          message: text.message,
          // A path or a relative URL in a goto fails the capture schema before the address check below.
          fix:
            head === "actions" &&
            issue.path[2] === "destination" &&
            issue.path[3] === "url"
              ? GOTO_URL_FIX
              : withExample(
                  `${text.fix}; the actions are capture-browser-scenario actions`,
                  CLONE_RUN_EXAMPLES.scenario.file,
                ),
        };
      }),
    );
  const rendered: BrowserScenario = parsed.data;
  const issues: CloneRunFileIssue[] = [];
  if (originOf(rendered.start_url.url) !== address)
    issues.push({
      file,
      pointer: "/start_path",
      message: `The start path takes the browser off the ${binding.side}'s address ${address}`,
      fix: "Use a path on the application, such as /",
    });
  rendered.actions.forEach((action, index) => {
    if (action.action !== "goto") return;
    if (originOf(action.destination.url) !== address)
      issues.push({
        file,
        pointer: `/actions/${index}/destination/url`,
        message: `A goto must stay on the ${binding.side}'s address ${address}; this one goes to ${action.destination.url}`,
        fix: GOTO_URL_FIX,
      });
  });
  if (issues.length > 0) return err(issues);
  return ok({
    document,
    scenarioSha256: digestCanonicalValue(rendered, "Browser scenario"),
  });
};

/**
 * The exact capture command of a worklist item: the side's rendered input,
 * the next free `run-N.json`, the outer timeout and the sandbox variable.
 */
export const cloneRunCaptureCommand = (
  run: string,
  target: CloneRunTarget,
  side: CloneRunSide,
  scenario: string,
  runNumber: number,
): string =>
  `${target.browser.no_sandbox ? "REA_BROWSER_NO_SANDBOX=true " : ""}timeout ${
    target.limits.capture_timeout_seconds
  } ${target.rea_command} capture-browser-scenario ${shellQuote(
    join(run, CLONE_RUN_PATHS.rendered, side, `${scenario}.json`),
  )} --detail summary --evidence_output ${shellQuote(
    join(
      run,
      CLONE_RUN_PATHS.evidence,
      side,
      scenario,
      `run-${runNumber}.json`,
    ),
  )} --json`;

/**
 * Everything one evaluation writes. No verdict ever reads these back. Output
 * files of scenarios that no longer exist are removed, so `rendered/` never
 * offers a capture input the referee would not admit.
 */
export interface CloneRunOutputs {
  readonly gate: CloneRunGate;
  /**
   * False when `target.json` is refused: nothing was rendered or compared, so
   * `rendered/`, `records/`, `behavior/` and `parity/` are left as they are
   * and only the gate and the journal line are written. No verdict reads
   * them, so keeping them is safe, and a builder keeps the behaviour tables
   * while the lead repairs the file.
   */
  readonly derived: boolean;
  /** Appended only when the state differs from the last line. */
  readonly journalEntry: CloneRunJournalEntry | null;
  readonly rendered: readonly {
    readonly side: CloneRunSide;
    readonly scenario: string;
    readonly document: JsonValue;
  }[];
  readonly records: readonly CloneRunAdmissionRecord[];
  /** The original's behaviour per scenario, as soon as one original capture is admitted. */
  readonly behavior: ReadonlyMap<string, ScenarioBehaviorTable>;
  readonly parity: ReadonlyMap<string, ScenarioBehaviorComparison>;
}

const lstatOrAbsent = (path: string) =>
  lstat(path).catch((cause: unknown) => {
    if (isAbsent(cause)) return undefined;
    throw cause;
  });

/** Make `path` a real directory of the run, replacing a file or link an agent left there. */
const ownDirectory = async (path: string): Promise<void> => {
  const existing = await lstatOrAbsent(path);
  if (existing !== undefined && !existing.isDirectory())
    await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
};

/** Make `path` free for a regular file: a directory or link in its place is removed, never written through. */
const ownFilePath = async (path: string): Promise<void> => {
  const existing = await lstatOrAbsent(path);
  if (existing !== undefined && !existing.isFile())
    await rm(path, { recursive: true, force: true });
};

/**
 * A hidden entry of an output directory is the staging directory of a write
 * in flight, possibly another evaluation's: two evaluations at once must not
 * remove each other's. No output is ever read back, so leaving one is safe.
 */
const isWriteInFlight = (entry: string): boolean => entry.startsWith(".");

/**
 * Replace the referee's own outputs, each file atomically, and append the
 * journal line. An output path that an agent turned into a directory or a
 * link is removed first, so the outputs always land inside the run folder and
 * a forged output never survives an evaluation. It also creates the empty
 * `evidence/<side>/<scenario>/` directory of every rendered input, because
 * the capture command writes there and does not create directories.
 */
export const writeCloneRunOutputs = async (
  run: string,
  outputs: CloneRunOutputs,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Result<undefined, AnalysisError>> => {
  const operation = EVALUATE_CLONE_RUN_OPERATION;
  const trees = new Map<string, Map<string, string>>(
    [
      CLONE_RUN_PATHS.behavior,
      CLONE_RUN_PATHS.parity,
      ...[CLONE_RUN_PATHS.rendered, CLONE_RUN_PATHS.records].flatMap(
        (directory) => CLONE_RUN_SIDES.map((side) => `${directory}/${side}`),
      ),
    ].map((directory) => [directory, new Map<string, string>()]),
  );
  const put = (directory: string, scenario: string, value: unknown): void => {
    trees.get(directory)?.set(`${scenario}${JSON_SUFFIX}`, encodeJson(value));
  };
  for (const { side, scenario, document } of outputs.rendered)
    put(`${CLONE_RUN_PATHS.rendered}/${side}`, scenario, document);
  for (const record of outputs.records)
    put(`${CLONE_RUN_PATHS.records}/${record.side}`, record.scenario, record);
  for (const [scenario, table] of outputs.behavior)
    put(CLONE_RUN_PATHS.behavior, scenario, table);
  for (const [scenario, comparison] of outputs.parity)
    put(CLONE_RUN_PATHS.parity, scenario, comparison);

  const resources = new ArtifactResourceScope();
  const write = async (
    path: string,
    text: string,
  ): Promise<Result<undefined, AnalysisError>> => {
    if (isAborted(options.signal))
      return err(cancelledBy(operation, options.signal));
    await ownFilePath(path);
    const written = await writeTextFile(text, path, true, resources);
    return written.ok ? ok(undefined) : written;
  };
  let current = run;
  try {
    for (const directory of outputs.derived
      ? [CLONE_RUN_PATHS.rendered, CLONE_RUN_PATHS.records]
      : []) {
      current = join(run, directory);
      await ownDirectory(current);
      const sides: readonly string[] = CLONE_RUN_SIDES;
      for (const entry of await readdir(current))
        if (!sides.includes(entry) && !isWriteInFlight(entry))
          await rm(join(current, entry), { recursive: true, force: true });
    }
    for (const [directory, files] of outputs.derived ? trees : []) {
      current = join(run, directory);
      await ownDirectory(current);
      for (const entry of await readdir(current))
        if (!files.has(entry) && !isWriteInFlight(entry))
          await rm(join(current, entry), { recursive: true, force: true });
      for (const [name, text] of files) {
        current = join(run, directory, name);
        const written = await write(current, text);
        if (!written.ok) return written;
      }
    }
    for (const { side, scenario } of outputs.rendered) {
      current = join(run, CLONE_RUN_PATHS.evidence, side, scenario);
      await mkdir(current, { recursive: true });
    }
    current = join(run, CLONE_RUN_PATHS.gate);
    const gate = await write(current, encodeJson(outputs.gate));
    if (!gate.ok) return gate;
    if (outputs.journalEntry !== null) {
      current = join(run, CLONE_RUN_PATHS.journal);
      await ownFilePath(current);
      // An interrupted append leaves a partial last line; the new entry starts its own line.
      const existing = await readFile(current).catch((cause: unknown) => {
        if (isAbsent(cause)) return undefined;
        throw cause;
      });
      const repair =
        existing !== undefined &&
        existing.length > 0 &&
        existing.at(-1) !== 0x0a
          ? "\n"
          : "";
      await appendFile(
        current,
        `${repair}${JSON.stringify(outputs.journalEntry)}\n`,
        { mode: 0o600 },
      );
    }
  } catch (cause: unknown) {
    return err(
      new EvidenceFileError("write", "io", {
        cause,
        path: current,
        userMessage: `Could not replace the referee's output ${current}: ${errorMessage(cause)}`,
      }),
    );
  }
  return ok(undefined);
};

/** The journal as written by earlier evaluations; unreadable lines are skipped. Used for stall detection only. */
export const readCloneRunJournal = async (
  run: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<readonly CloneRunJournalEntry[]> => {
  const path = join(run, CLONE_RUN_PATHS.journal);
  let text: string;
  try {
    // Never opened unless it is a regular file: reading a FIFO an agent left there would wait for a writer forever, and a link is not the referee's own output.
    if (!(await lstat(path)).isFile()) return [];
    text = await readFile(path, {
      encoding: "utf8",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line) => {
    if (line.trim() === "") return [];
    try {
      const parsed = cloneRunJournalEntrySchema.safeParse(JSON.parse(line));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
};
