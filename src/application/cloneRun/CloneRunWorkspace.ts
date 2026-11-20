import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type {
  CloneRunFileIssue,
  CloneRunGate,
  CloneRunAdmissionRecord,
  CloneRunInitResult,
  CloneRunIntendedDifferences,
  CloneRunJournalEntry,
  CloneRunObligations,
  CloneRunReasonCode,
  CloneRunScenario,
  CloneRunSide,
  CloneRunTarget,
  CloneRunUnknown,
  CloneRunWaivers,
} from "../../domain/cloneRun/cloneRunSchemas.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import type { Result } from "../../domain/result.js";
import type {
  ScenarioBehaviorComparison,
  ScenarioBehaviorTable,
} from "../../domain/scenarioBehaviorComparison.js";

/**
 * The run folder: scaffolding, reading the files agents write, rendering
 * capture inputs and writing the referee's outputs.
 * Contract: docs/specs/reconstruction/clone-runs/spec.md, "Run folder".
 */

const notImplemented = (name: string): never => {
  throw new Error(`${name} is not implemented yet`);
};

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
 * Create the run folder and everything that follows from the flags. The
 * directory must be absent or empty and outside the clone root; nothing is
 * overwritten.
 */
export const initCloneRun = (
  input: CloneRunInitInput,
  options: {
    readonly now?: () => Date;
    readonly signal?: AbortSignal;
  } = {},
): Promise<Result<CloneRunInitResult, AnalysisError>> => {
  void input;
  void options;
  return notImplemented("initCloneRun");
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
  /** Valid scenarios by id (the file's base name), in id order. */
  readonly scenarios: ReadonlyMap<string, CloneRunScenario>;
  /** Valid obligation files by area (the file's base name), in area order. */
  readonly obligations: ReadonlyMap<string, CloneRunObligations>;
  /** Valid unknowns by id (the file's base name, `<role>-<n>`). */
  readonly unknowns: ReadonlyMap<string, CloneRunUnknown>;
  readonly waivers: CloneRunWaivers;
  readonly intendedDifferences: CloneRunIntendedDifferences;
  /** Evidence file paths under `evidence/<side>/<scenario>/`, sorted; contents are not read here. */
  readonly evidence: Readonly<
    Record<CloneRunSide, ReadonlyMap<string, readonly string[]>>
  >;
  /** Every refused file; a refused file is absent from the maps above. */
  readonly issues: readonly CloneRunInputIssue[];
}

/**
 * Read the authored files. A missing run directory or `target.json` is a
 * refusal; a file that fails its schema is an issue, never a refusal, so one
 * evaluation reports every broken file. Beyond the schemas it refuses what
 * only the folder shows: a base name that is not an identifier, an unknown
 * not named `<role>-<n>`, an obligation id used twice, a waiver or `closed`
 * entry that names nothing, and a volatile field whose scenario or step does
 * not exist (specification, "What done means", check 2).
 */
export const loadCloneRunWorkspace = (
  runDirectory: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Result<CloneRunWorkspace, AnalysisError>> => {
  void runDirectory;
  void options;
  return notImplemented("loadCloneRunWorkspace");
};

/** A capture input the referee renders, and REA's digest of it. */
export interface RenderedCloneRunScenario {
  /** A capture-browser-scenario document, valid against the browser scenario schema. */
  readonly document: JsonValue;
  /** `digestCanonicalValue` of the parsed document: what the capture's Evidence records as `scenario_sha256`. */
  readonly scenarioSha256: string;
}

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
  void scenarioId;
  void scenario;
  void target;
  void binding;
  return notImplemented("renderCloneRunScenario");
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
): string => {
  void run;
  void target;
  void side;
  void scenario;
  void runNumber;
  return notImplemented("cloneRunCaptureCommand");
};

/**
 * Everything one evaluation writes. No verdict ever reads these back. Output
 * files of scenarios that no longer exist are removed, so `rendered/` never
 * offers a capture input the referee would not admit.
 */
export interface CloneRunOutputs {
  readonly gate: CloneRunGate;
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

/** Replace the referee's own outputs, each file atomically, and append the journal line. */
export const writeCloneRunOutputs = (
  run: string,
  outputs: CloneRunOutputs,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Result<undefined, AnalysisError>> => {
  void run;
  void outputs;
  void options;
  return notImplemented("writeCloneRunOutputs");
};

/** The journal as written by earlier evaluations; unreadable lines are skipped. Used for stall detection only. */
export const readCloneRunJournal = (
  run: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<readonly CloneRunJournalEntry[]> => {
  void run;
  void options;
  return notImplemented("readCloneRunJournal");
};
