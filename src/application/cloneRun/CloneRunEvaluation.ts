import { stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";

import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  cancelledBy,
} from "../../domain/analysisErrorCore.js";
import { boundedList } from "../../domain/boundedList.js";
import { digestCanonicalValue } from "../../domain/canonicalDigest.js";
import {
  CLEAN_ROOM_MIN_IDENTICAL_BYTES,
  CLONE_RUN_CHECKS,
  CLONE_RUN_DEFAULT_LIMITS,
  CLONE_RUN_NEXT_LIMIT,
  CLONE_RUN_PATHS,
  CLONE_RUN_REASON_CODES,
  CLONE_RUN_SIDES,
  EVALUATE_CLONE_RUN_OPERATION,
  cloneNameConflict,
  cloneRunAddressIdentity,
  cloneRunReasonCheck,
  cloneRunReasonRole,
  type CloneRunAdmissionRecord,
  type CloneRunCheck,
  type CloneRunEvidenceStatus,
  type CloneRunGate,
  type CloneRunJournalEntry,
  type CloneRunNextItem,
  type CloneRunObligation,
  type CloneRunReasonCode,
  type CloneRunScenario,
  type CloneRunSide,
  type CloneRunTarget,
  type CloneRunVerdict,
} from "../../domain/cloneRun/cloneRunSchemas.js";
import { shellQuote } from "../../domain/desktop/shellQuote.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  CLONE_TREE_STEP_PREFIX,
  scenarioStartState,
  scenarioStepKind,
  type ScenarioBehaviorCaptureFacts,
  type ScenarioBehaviorComparer,
  type ScenarioBehaviorComparison,
  type ScenarioBehaviorFinding,
  type ScenarioBehaviorTable,
  type ScenarioStepStatus,
} from "../../domain/scenarioBehaviorComparison.js";
import { errorMessage } from "../../kernel/errorMessage.js";
import {
  cloneFilesNamingOriginal,
  identicalCloneFiles,
  type OriginalFileSource,
} from "./CloneRunCleanRoom.js";
import type { CloneTreeSnapshot } from "./CloneRunTreeDigest.js";
import {
  cloneRunCaptureCommand,
  cloneRunEvaluateCommand,
  cloneRunFolderInsideClone,
  loadCloneRunWorkspace,
  readCloneRunJournal,
  renderCloneRunScenario,
  writeCloneRunOutputs,
  type CloneRunWorkspace,
  type RenderedCloneRunScenario,
} from "./CloneRunWorkspace.js";

/**
 * The referee: recompute every check of a clone run from authenticated
 * Evidence and the clone's current files, and issue the verdict and worklist.
 * Contract: docs/specs/reconstruction/clone-runs/spec.md, "What done means".
 *
 * It never starts, stops or resets a target, and it never reads its own
 * outputs as a source of a pass.
 */

/**
 * What the verdict cannot establish; `gate.json` repeats these lines. The
 * specification's "Trust" section holds the same list, in the same order.
 */
export const CLONE_RUN_RESIDUAL_TRUST: readonly string[] = [
  "The authorisation statement is recorded as given; REA cannot verify it.",
  "target.json, the scenarios and the declarations are the team's own statements: the verdict is about the addresses, clone root, excludes, names and material that target.json declares now, and anyone who can edit it can retarget the run.",
  "The verdict covers only the steps the scenarios contain. REA cannot tell whether they exercise every rule of the original, nor whether an obligation's statement describes the steps it cites; deleting a failing step or an unknown file leaves no trace.",
  "Evidence integrity is an unkeyed content digest: it catches an edited or misplaced file, not Evidence forged by recomputing the digest with REA's own code.",
  "A capture is bound to an address, not to what answered there: REA cannot prove which program or which build of the clone was serving, nor that it did not pass requests on to another server.",
  "Clone Evidence is bound to the tree digest its capture input was rendered for and that digest equals the tree now; an edit that was reverted between the two is not visible.",
  "Excluded clone paths are neither digested nor checked for copied files or names.",
  "Renames and volatile fields are declarations: a rename can declare away any difference in on-screen text or a string value, and an honoured volatile field is compared by shape only. The gate lists those that took effect.",
  "A waiver's person and reason are recorded as given.",
  "The copied-file check knows the original's files only from the declared material and from reply bodies its captures recorded, 64 KiB each at most; the name check knows only the declared names.",
  "REA does not reset targets; a clean start is inferred from the fingerprint steps only.",
  "The journal is the referee's own output; removing it can hide a stall and cannot produce a pass.",
];

/** What the referee is given instead of reaching for it, so tests supply fakes. */
export interface CloneRunEvaluationDependencies<
  Capture extends ScenarioBehaviorCaptureFacts,
> {
  /** The comparer; production passes `SCENARIO_BEHAVIOR_COMPARER`. */
  readonly comparer: ScenarioBehaviorComparer<Capture>;
  /** Production passes `digestCloneTree`. */
  readonly digestTree: (
    root: string,
    exclude: readonly string[],
    options?: { readonly signal?: AbortSignal },
  ) => Promise<Result<CloneTreeSnapshot, AnalysisError>>;
  readonly now: () => Date;
}

/** One blocking finding; each becomes one worklist item and counts once in `blocking`. */
interface Finding {
  readonly reason: CloneRunReasonCode;
  readonly file: string;
  readonly command: string;
  readonly message: string;
  readonly side?: CloneRunSide | undefined;
  readonly scenario?: string | undefined;
  readonly step_id?: string | undefined;
  readonly obligation?: string | undefined;
  readonly dimension?: CloneRunNextItem["dimension"];
  readonly pointer?: string | undefined;
  readonly expected?: string | undefined;
  readonly actual?: string | undefined;
}

interface AdmittedCapture<Capture> {
  /** Absolute path of the Evidence file. */
  readonly file: string;
  readonly capture: Capture;
}

/** One side of one scenario after rendering and admission. */
interface SideState<Capture> {
  readonly rendered: RenderedCloneRunScenario;
  readonly admitted: readonly AdmittedCapture<Capture>[];
  readonly record: CloneRunAdmissionRecord;
  /** The next capture command of this side and scenario, each call with a free run number. */
  readonly nextCaptureCommand: () => string;
  /** One capture command shared by every item that one more capture would serve. */
  readonly sharedCaptureCommand: () => string;
}

interface ScenarioState<Capture> {
  readonly id: string;
  readonly scenario: CloneRunScenario;
  readonly sides: Partial<Record<CloneRunSide, SideState<Capture>>>;
  comparison?: ScenarioBehaviorComparison;
}

const SHA256 = /^[0-9a-f]{64}$/u;

/** Categories the comparer gives a finding that is missing data, or a side disagreeing with itself. */
const UNKNOWN_CATEGORIES: ReadonlySet<string> = new Set([
  "not-recorded",
  "not-completed",
  "other-origin",
]);
const UNSTABLE_CATEGORIES: ReadonlySet<string> = new Set([
  "repeats-differ",
  "undeclared-volatile",
]);

const findingStatus = (finding: ScenarioBehaviorFinding): ScenarioStepStatus =>
  UNKNOWN_CATEGORIES.has(finding.category)
    ? "unknown"
    : UNSTABLE_CATEGORIES.has(finding.category)
      ? "unstable"
      : "changed";

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

const runRelative = (run: string, path: string): string => {
  const value = relative(run, path);
  return value.startsWith("..") || isAbsolute(value)
    ? path
    : value.split(sep).join("/");
};

const resetHint = (target: CloneRunTarget, side: CloneRunSide): string => {
  const { reset } = target[side].commands;
  return reset === null
    ? `Reset the ${side} to its clean start before each capture (target.json records no reset command)`
    : `Reset the ${side} before each capture with: ${reset}`;
};

const removeCommand = (files: readonly string[]): string =>
  `rm ${files.map(shellQuote).join(" ")}`;

const where = (finding: ScenarioBehaviorFinding): string =>
  `${finding.dimension}${
    finding.pointer === null || finding.pointer === ""
      ? ""
      : ` ${finding.pointer}`
  }${finding.request === null ? "" : ` of ${finding.request}`}`;

const digestOrNull = (value: string | null): string | null =>
  value !== null && SHA256.test(value) ? value : null;

/** Read, authenticate and classify every Evidence file of one side and scenario, in path order. */
const admitSide = async <Capture extends ScenarioBehaviorCaptureFacts>(
  context: {
    readonly run: string;
    readonly target: CloneRunTarget;
    readonly comparer: ScenarioBehaviorComparer<Capture>;
    readonly signal: AbortSignal | undefined;
  },
  side: CloneRunSide,
  scenarioId: string,
  scenario: CloneRunScenario,
  rendered: RenderedCloneRunScenario,
  treeSha256: string | null,
  files: readonly string[],
): Promise<
  Result<
    {
      readonly admitted: readonly AdmittedCapture<Capture>[];
      readonly record: CloneRunAdmissionRecord;
    },
    AnalysisError
  >
> => {
  const { address } = context.target[side];
  const admitted: AdmittedCapture<Capture>[] = [];
  const counted = new Map<string, string>();
  const entries: CloneRunAdmissionRecord["files"][number][] = [];
  for (const file of files) {
    if (context.signal?.aborted === true)
      return err(cancelledBy(EVALUATE_CLONE_RUN_OPERATION, context.signal));
    const shown = runRelative(context.run, file);
    const read = await context.comparer.readCapture(
      file,
      context.signal === undefined ? {} : { signal: context.signal },
    );
    if (!read.ok) {
      if (read.error instanceof AnalysisCancelledError) return read;
      entries.push({
        file: shown,
        status: "rejected_integrity",
        evidence_id: null,
        start_origin: null,
        scenario_sha256: null,
        bound_clone_tree_sha256: null,
        detail: `REA could not authenticate this file as one browser scenario capture: ${
          read.error.userMessage ?? read.error.message
        }`,
      });
      continue;
    }
    const capture = read.value;
    const last = capture.definition.step_ids.at(-1);
    const bound =
      last?.startsWith(CLONE_TREE_STEP_PREFIX) === true
        ? digestOrNull(last.slice(CLONE_TREE_STEP_PREFIX.length))
        : null;
    const facts = {
      file: shown,
      evidence_id: capture.evidence_id,
      start_origin: capture.start_origin,
      scenario_sha256: digestOrNull(capture.scenario_sha256),
      bound_clone_tree_sha256: bound,
    };
    const classify = (): {
      readonly status: CloneRunEvidenceStatus;
      readonly detail: string | null;
    } => {
      let definitionOrigin: string | null;
      try {
        definitionOrigin = new URL(capture.definition.start_url).origin;
      } catch {
        definitionOrigin = null;
      }
      if (capture.start_origin !== address || definitionOrigin !== address)
        return {
          status: "rejected_address",
          detail: `Captured at ${capture.start_origin}; the ${side}'s address is ${address}`,
        };
      if (capture.scenario_sha256 === rendered.scenarioSha256) {
        const earlier = counted.get(capture.evidence_id);
        if (earlier === undefined) return { status: "admitted", detail: null };
        return {
          status: "duplicate",
          detail: `The same Evidence as ${earlier}; a copied capture is not a repeat`,
        };
      }
      if (side === "clone" && bound !== null && bound !== treeSha256) {
        const then = renderCloneRunScenario(
          scenarioId,
          scenario,
          context.target,
          { side: "clone", cloneTreeSha256: bound },
        );
        if (then.ok && then.value.scenarioSha256 === capture.scenario_sha256)
          return {
            status: "stale",
            detail: `Captured for clone tree ${bound}; the clone's files have changed since`,
          };
      }
      return {
        status: "scenario_mismatch",
        detail:
          "The capture replays another scenario, another version of this one, or other capture settings",
      };
    };
    const { status, detail } = classify();
    if (status === "admitted") {
      counted.set(capture.evidence_id, shown);
      admitted.push({ file, capture });
    }
    entries.push({ ...facts, status, detail });
  }
  return ok({
    admitted,
    record: {
      schema: "rea.clone-run.admission/1",
      side,
      scenario: scenarioId,
      address,
      expected_scenario_sha256: rendered.scenarioSha256,
      clone_tree_sha256: side === "clone" ? treeSha256 : null,
      files: entries,
    },
  });
};

/** A source of run numbers that skips every existing `run-N.json`, stale ones included. */
const runNumbers = (files: readonly string[]): (() => number) => {
  const taken = new Set(files.map((file) => basename(file)));
  let next = 0;
  return () => {
    do next += 1;
    while (taken.has(`run-${next}.json`));
    return next;
  };
};

/** The finding of a step that is not `unchanged`, shown by its most severe observation. */
const parityFinding = <Capture extends ScenarioBehaviorCaptureFacts>(
  context: {
    readonly run: string;
    readonly target: CloneRunTarget;
    readonly evaluate: string;
  },
  state: ScenarioState<Capture>,
  stepId: string,
  status: Exclude<ScenarioStepStatus, "unchanged">,
  observations: readonly ScenarioBehaviorFinding[],
): Finding => {
  const { target, run } = context;
  const scenario = state.id;
  const shown =
    observations.find((finding) => findingStatus(finding) === status) ??
    observations[0];
  const common = {
    scenario,
    step_id: stepId,
    ...(shown === undefined
      ? {}
      : {
          dimension: shown.dimension,
          ...(shown.pointer === null ? {} : { pointer: shown.pointer }),
          ...(shown.expected === null ? {} : { expected: shown.expected }),
          ...(shown.actual === null ? {} : { actual: shown.actual }),
        }),
  };
  const at = shown === undefined ? "its result" : where(shown);
  const behavior = `${CLONE_RUN_PATHS.behavior}/${scenario}.json`;
  if (status === "changed")
    return {
      ...common,
      reason: "parity_changed",
      side: "clone",
      file: target.clone.root,
      command: context.evaluate,
      message: `Step ${stepId} of scenario ${scenario} differs from the original at ${at}: the original gave ${
        shown?.expected ?? "(nothing)"
      }, the clone gave ${
        shown?.actual ?? "(nothing)"
      }. ${behavior} shows what the original does. Change the clone, restart it, have it captured again, then run the command.`,
    };
  const side: CloneRunSide = shown?.side === "right" ? "clone" : "original";
  if (status === "unknown") {
    const sideState = state.sides[side];
    if (shown?.category === "not-recorded" && sideState !== undefined)
      return {
        ...common,
        reason: "parity_unknown",
        side,
        file: `${CLONE_RUN_PATHS.evidence}/${side}/${scenario}`,
        command: sideState.sharedCaptureCommand(),
        message: `Step ${stepId} of scenario ${scenario}: ${at} was not recorded on the ${side}. Captures fold, so one more can supply it. ${resetHint(
          target,
          side,
        )}, then run the command and evaluate again. Data still missing after another capture will not arrive (a reply over the capture's 64 KiB body limit is never recorded): the prober then renames the step setup-${stepId} in ${CLONE_RUN_PATHS.scenarios}/${scenario}.json, and it no longer counts as behaviour.`,
      };
    return {
      ...common,
      reason: "parity_unknown",
      side,
      file: `${CLONE_RUN_PATHS.scenarios}/${scenario}.json`,
      command: context.evaluate,
      message: `Step ${stepId} of scenario ${scenario} cannot be compared: ${
        shown === undefined
          ? "the comparison reported no result for it"
          : `${shown.category} at ${at} on the ${side}`
      }. A step that did not complete, or that sends the browser or a request to another origin, proves nothing. Make the step complete on the ${side} at its own address, or have the prober change it in ${CLONE_RUN_PATHS.scenarios}/${scenario}.json; both sides are then captured again.`,
    };
  }
  if (side === "original") {
    const line =
      shown?.dimension === "body" &&
      shown.pointer !== null &&
      shown.pointer !== ""
        ? ` If the value differs by nature (a time, a generated id), add ${JSON.stringify(
            {
              scenario,
              step_id: stepId,
              pointer: shown.pointer,
              reason: "<why it varies>",
            },
          )} to volatile_fields in ${CLONE_RUN_PATHS.intendedDifferences}; its shape is still compared.`
        : "";
    return {
      ...common,
      reason: "parity_unstable",
      side,
      file: CLONE_RUN_PATHS.intendedDifferences,
      command: context.evaluate,
      message: `Step ${stepId} of scenario ${scenario}: ${at} differs between the original's own captures, so it cannot be held against the clone.${line} Otherwise the prober makes the step deterministic or renames it setup-${stepId}. Then run the command.`,
    };
  }
  return {
    ...common,
    reason: "parity_unstable",
    side,
    file: target.clone.root,
    command: context.evaluate,
    message: `Step ${stepId} of scenario ${scenario}: ${at} differs between the clone's own captures where the original holds one value. Make the clone deterministic (${run}/${behavior} shows the original), restart it, have it captured again, then run the command.`,
  };
};

const toNextItem = (finding: Finding): CloneRunNextItem => ({
  role: cloneRunReasonRole(finding.reason, finding.side),
  reason: finding.reason,
  file: finding.file,
  command: finding.command,
  message: finding.message,
  ...(finding.side === undefined ? {} : { side: finding.side }),
  ...(finding.scenario === undefined ? {} : { scenario: finding.scenario }),
  ...(finding.step_id === undefined ? {} : { step_id: finding.step_id }),
  ...(finding.obligation === undefined
    ? {}
    : { obligation: finding.obligation }),
  ...(finding.dimension === undefined ? {} : { dimension: finding.dimension }),
  ...(finding.pointer === undefined ? {} : { pointer: finding.pointer }),
  ...(finding.expected === undefined ? {} : { expected: finding.expected }),
  ...(finding.actual === undefined ? {} : { actual: finding.actual }),
});

/** Check order, then reason order, then scenario; steps keep the order they were found in. */
const worklistOrder = (findings: readonly Finding[]): readonly Finding[] => {
  const rank = (finding: Finding): readonly [number, number, string] => [
    CLONE_RUN_CHECKS.indexOf(cloneRunReasonCheck(finding.reason)),
    CLONE_RUN_REASON_CODES.indexOf(finding.reason),
    finding.scenario ?? "",
  ];
  return findings.toSorted((left, right) => {
    const [leftCheck, leftReason, leftScenario] = rank(left);
    const [rightCheck, rightReason, rightScenario] = rank(right);
    return (
      leftCheck - rightCheck ||
      leftReason - rightReason ||
      (leftScenario < rightScenario ? -1 : leftScenario > rightScenario ? 1 : 0)
    );
  });
};

/** Files under the declared material directories, by digest; an absent directory holds none. */
const materialSources = async <Capture extends ScenarioBehaviorCaptureFacts>(
  workspace: CloneRunWorkspace,
  target: CloneRunTarget,
  dependencies: CloneRunEvaluationDependencies<Capture>,
  signal: AbortSignal | undefined,
): Promise<Result<readonly OriginalFileSource[], AnalysisError>> => {
  const sources: OriginalFileSource[] = [];
  for (const declared of target.original.material) {
    const directory = isAbsolute(declared)
      ? declared
      : join(workspace.run, declared);
    const present = await stat(directory).then(
      (entry) => entry.isDirectory(),
      () => false,
    );
    if (!present) continue;
    const snapshot = await dependencies.digestTree(
      directory,
      [],
      signal === undefined ? {} : { signal },
    );
    if (!snapshot.ok) return snapshot;
    for (const file of snapshot.value.files)
      if (file.kind === "file")
        sources.push({
          sha256: file.sha256,
          source: `${declared}/${file.path}`,
        });
  }
  return ok(sources);
};

/**
 * Evaluate one run folder and write the referee's outputs. A missing run
 * directory or `target.json` is a refusal; every other problem is a blocking
 * finding in the returned gate. The checks do not wait for one another: the
 * original side is rendered, admitted and described before a clone exists.
 * A refusal of `comparer.compare` is returned as this call's refusal.
 */
export const evaluateCloneRun = async <
  Capture extends ScenarioBehaviorCaptureFacts,
>(
  runDirectory: string,
  dependencies: CloneRunEvaluationDependencies<Capture>,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Result<CloneRunGate, AnalysisError>> => {
  const { signal } = options;
  const signalOptions = signal === undefined ? {} : { signal };
  const { comparer } = dependencies;
  const loaded = await loadCloneRunWorkspace(runDirectory, signalOptions);
  if (!loaded.ok) return loaded;
  const workspace = loaded.value;
  const { run, target } = workspace;
  const evaluate = cloneRunEvaluateCommand(run, target?.rea_command ?? "rea");
  const findings: Finding[] = [];
  /** Whether each check was computed for everything it covers; a finding fails it either way. */
  const computed: Record<CloneRunCheck, boolean> = {
    scope: target !== null,
    inputs: true,
    evidence: false,
    clean_start: false,
    coverage: false,
    parity: false,
    clean_room: false,
    unknowns: true,
  };

  // inputs: every refused file, with its path, pointer and fix.
  for (const issue of workspace.issues)
    findings.push({
      reason: issue.reason,
      file: issue.file,
      command: evaluate,
      pointer: issue.pointer,
      message: `${issue.file}${issue.pointer === "" ? "" : ` ${issue.pointer}`}: ${issue.message}; ${issue.fix}`,
    });
  const refused = (reason: CloneRunReasonCode): boolean =>
    workspace.issues.some((issue) => issue.reason === reason);
  if (workspace.scenarios.size === 0 && !refused("scenario_invalid"))
    findings.push({
      reason: "no_scenarios",
      file: CLONE_RUN_PATHS.scenarios,
      command: evaluate,
      message: `${CLONE_RUN_PATHS.scenarios}/ holds no scenario. The prober writes ${CLONE_RUN_PATHS.scenarios}/<scenario>.json (${CLONE_RUN_PATHS.examples}/scenario.example.json is a valid example), then runs the command, which renders the capture inputs.`,
    });
  if (workspace.obligations.size === 0 && !refused("obligation_invalid"))
    findings.push({
      reason: "no_obligations",
      file: CLONE_RUN_PATHS.obligations,
      command: evaluate,
      message: `${CLONE_RUN_PATHS.obligations}/ holds no obligation file. The spec writer reads ${CLONE_RUN_PATHS.behavior}/ and writes ${CLONE_RUN_PATHS.obligations}/<area>.json (${CLONE_RUN_PATHS.examples}/obligations.example.json is a valid example), then runs the command.`,
    });

  // scope: what target.json declares, and the clone's files as they are now.
  let tree: CloneTreeSnapshot | null = null;
  if (target !== null) {
    const conflict = cloneNameConflict(
      target.clone.name,
      target.original.names,
    );
    if (conflict !== undefined)
      findings.push({
        reason: "target_invalid",
        file: CLONE_RUN_PATHS.target,
        command: evaluate,
        pointer: "/clone/name",
        message: `${CLONE_RUN_PATHS.target} /clone/name: the clone's name "${target.clone.name}" contains the original's name "${conflict}", which may not appear in the clone; choose a name that contains none of original.names.`,
      });
    if (
      cloneRunAddressIdentity(target.original.address) ===
      cloneRunAddressIdentity(target.clone.address)
    )
      findings.push({
        reason: "addresses_not_distinct",
        file: CLONE_RUN_PATHS.target,
        command: evaluate,
        pointer: "/clone/address",
        message: `${CLONE_RUN_PATHS.target}: the original (${target.original.address}) and the clone (${target.clone.address}) are one address, because every loopback name counts as one host. Serve the clone on another port and record that address in /clone/address.`,
      });
    let inside: boolean;
    try {
      inside = await cloneRunFolderInsideClone(run, target.clone.root);
    } catch (cause: unknown) {
      return err(
        new AnalysisInputError(EVALUATE_CLONE_RUN_OPERATION, {
          cause,
          conformsToInputContract: true,
          userMessage: `Could not resolve the clone root ${target.clone.root}: ${errorMessage(cause)}`,
          remediationAction:
            "Make the clone root readable, or correct clone.root in target.json.",
        }),
      );
    }
    if (inside)
      findings.push({
        reason: "run_folder_inside_clone",
        file: CLONE_RUN_PATHS.target,
        command: evaluate,
        pointer: "/clone/root",
        message: `The run folder ${run} is the clone root ${target.clone.root} or inside it. It holds material captured from the original, which must stay out of the clone's source: move the run folder outside the clone root, or correct /clone/root in ${CLONE_RUN_PATHS.target}.`,
      });
    const rootPresent = await stat(target.clone.root).then(
      (entry) => entry.isDirectory(),
      () => false,
    );
    if (!rootPresent)
      findings.push({
        reason: "clone_root_missing",
        file: target.clone.root,
        command: evaluate,
        message: `The clone root ${target.clone.root} does not exist. The builder creates the clone's source there from ${CLONE_RUN_PATHS.specs}/, ${CLONE_RUN_PATHS.obligations}/ and ${CLONE_RUN_PATHS.behavior}/, then runs the command.`,
      });
    else {
      const digested = await dependencies.digestTree(
        target.clone.root,
        target.clone.exclude,
        signalOptions,
      );
      if (!digested.ok) return digested;
      tree = digested.value;
      for (const link of tree.symlinksOutsideRoot)
        findings.push({
          reason: "clone_symlink_outside_root",
          file: join(target.clone.root, link),
          command: evaluate,
          message: `The clone's ${link} is a symlink that leads outside the clone root or under an excluded path, so what it serves can change without the tree digest changing. Remove the link or copy its target into the clone; a link the clone does not serve can be listed in clone.exclude in ${CLONE_RUN_PATHS.target}.`,
        });
    }
  }

  // Rendering and admission, per scenario and side. The original does not wait for a clone.
  const states: ScenarioState<Capture>[] = [];
  const records: CloneRunAdmissionRecord[] = [];
  const minCaptures =
    target?.limits.min_captures ?? CLONE_RUN_DEFAULT_LIMITS.min_captures;
  let everyScenarioRendered = target !== null && workspace.scenarios.size > 0;
  if (target !== null)
    for (const [id, scenario] of workspace.scenarios) {
      const file = `${CLONE_RUN_PATHS.scenarios}/${id}.json`;
      const original = renderCloneRunScenario(id, scenario, target, {
        side: "original",
      });
      // Without a clone tree the clone input is still rendered once, to report its issues.
      const clone = renderCloneRunScenario(id, scenario, target, {
        side: "clone",
        cloneTreeSha256: tree?.sha256 ?? "0".repeat(64),
      });
      const issues = original.ok
        ? clone.ok
          ? []
          : clone.error
        : original.error;
      if (!original.ok || !clone.ok) {
        everyScenarioRendered = false;
        for (const issue of issues)
          findings.push({
            reason: "scenario_invalid",
            scenario: id,
            file,
            command: evaluate,
            pointer: issue.pointer,
            message: `${issue.file}${issue.pointer === "" ? "" : ` ${issue.pointer}`}: ${issue.message}; ${issue.fix}`,
          });
        continue;
      }
      const state: ScenarioState<Capture> = { id, scenario, sides: {} };
      for (const side of CLONE_RUN_SIDES) {
        if (side === "clone" && tree === null) continue;
        const rendered = side === "original" ? original.value : clone.value;
        const files = workspace.evidence[side].get(id) ?? [];
        const admission = await admitSide(
          { run, target, comparer, signal },
          side,
          id,
          scenario,
          rendered,
          side === "clone" ? (tree?.sha256 ?? null) : null,
          files,
        );
        if (!admission.ok) return admission;
        const nextNumber = runNumbers(files);
        let shared: string | undefined;
        const nextCaptureCommand = (): string =>
          cloneRunCaptureCommand(run, target, side, id, nextNumber());
        state.sides[side] = {
          rendered,
          admitted: admission.value.admitted,
          record: admission.value.record,
          nextCaptureCommand,
          sharedCaptureCommand: () => (shared ??= nextCaptureCommand()),
        };
        records.push(admission.value.record);
      }
      states.push(state);
    }
  const bothSides = (state: ScenarioState<Capture>): boolean =>
    CLONE_RUN_SIDES.every(
      (side) => (state.sides[side]?.admitted.length ?? 0) >= minCaptures,
    );
  const originalAdmitted =
    everyScenarioRendered &&
    states.every(
      (state) => (state.sides.original?.admitted.length ?? 0) >= minCaptures,
    );
  const judged = everyScenarioRendered && states.every(bothSides);
  computed.evidence = everyScenarioRendered && tree !== null;
  computed.clean_start = judged;
  computed.parity = judged;
  computed.coverage = originalAdmitted && workspace.obligations.size > 0;
  computed.clean_room = originalAdmitted && tree !== null;

  // evidence and clean_start.
  const evidenceCounts = {
    admitted: 0,
    duplicate: 0,
    stale: 0,
    scenario_mismatch: 0,
    rejected: 0,
  };
  if (target !== null)
    for (const state of states)
      for (const side of CLONE_RUN_SIDES) {
        const sideState = state.sides[side];
        if (sideState === undefined) continue;
        const directory = `${CLONE_RUN_PATHS.evidence}/${side}/${state.id}`;
        const count = (status: CloneRunEvidenceStatus): number =>
          sideState.record.files.filter((file) => file.status === status)
            .length;
        evidenceCounts.admitted += count("admitted");
        evidenceCounts.duplicate += count("duplicate");
        evidenceCounts.stale += count("stale");
        evidenceCounts.scenario_mismatch += count("scenario_mismatch");
        for (const file of sideState.record.files) {
          if (
            file.status !== "rejected_integrity" &&
            file.status !== "rejected_address"
          )
            continue;
          evidenceCounts.rejected += 1;
          findings.push({
            reason: `evidence_${file.status}`,
            side,
            scenario: state.id,
            file: file.file,
            command: removeCommand([join(run, file.file)]),
            message: `${file.file} is not counted and blocks until it is removed. ${file.detail ?? ""}${
              file.status === "rejected_address"
                ? `. A capture counts only for the side whose address it was taken at; capture the ${side} from ${CLONE_RUN_PATHS.rendered}/${side}/${state.id}.json.`
                : ". An Evidence file is only ever written by capture-browser-scenario and never edited."
            }`,
          });
        }
        const admitted = sideState.admitted.length;
        if (admitted < minCaptures) {
          const stale = count("stale");
          const mismatched = count("scenario_mismatch");
          const reason =
            stale > 0
              ? "evidence_stale"
              : mismatched > 0
                ? "evidence_scenario_mismatch"
                : "evidence_missing";
          const have = `Scenario ${state.id} has ${admitted} of ${minCaptures} required captures of the ${side} (${directory}/)`;
          const message =
            reason === "evidence_stale"
              ? `${have}: ${plural(stale, "capture")} went stale because the clone's files changed after ${stale === 1 ? "it was" : "they were"} taken. Restart the clone so it serves its current files, then capture again. ${resetHint(target, side)}. A clone that writes files under its own root while it runs (a database, a log, a build cache) makes every capture stale: the lead lists those paths in clone.exclude in ${CLONE_RUN_PATHS.target}.`
              : reason === "evidence_scenario_mismatch"
                ? `${have}: ${plural(mismatched, "file")} there ${mismatched === 1 ? "replays" : "replay"} another scenario, an earlier version of this one or other capture settings and ${mismatched === 1 ? "is" : "are"} not counted. Capture again from the rendered input. ${resetHint(target, side)}.`
                : `${have}. ${resetHint(target, side)}, then run the command; a copy of a capture is not a repeat.`;
          for (let missing = admitted; missing < minCaptures; missing += 1)
            findings.push({
              reason,
              side,
              scenario: state.id,
              file: directory,
              command: sideState.nextCaptureCommand(),
              message,
            });
          continue;
        }
        const startState = scenarioStartState(
          sideState.admitted.map(({ capture }) => capture.fingerprint_sha256),
        );
        if (startState === "unknown")
          findings.push({
            reason: "start_state_unknown",
            side,
            scenario: state.id,
            file: directory,
            command: sideState.sharedCaptureCommand(),
            message: `Scenario ${state.id}: fewer than two captures of the ${side} recorded everything its fp- steps observe, so a clean start is not shown. ${resetHint(target, side)}, then run the command. If an fp- step can never be recorded whole (a reply over the 64 KiB body limit, a step that does not complete), the prober replaces it with one that reads the start state in a smaller reply.`,
          });
        if (startState === "dirty") {
          const groups = new Map<string, string[]>();
          for (const { file, capture } of sideState.admitted)
            if (capture.fingerprint_sha256 !== null)
              groups.set(capture.fingerprint_sha256, [
                ...(groups.get(capture.fingerprint_sha256) ?? []),
                file,
              ]);
          const sizes = [...groups.values()].map((group) => group.length);
          const largest = Math.max(...sizes);
          const tie = sizes.filter((size) => size === largest).length > 1;
          const keep = tie
            ? undefined
            : [...groups.values()].find((group) => group.length === largest);
          const remove = sideState.admitted
            .filter(
              ({ file, capture }) =>
                tie ||
                (capture.fingerprint_sha256 !== null &&
                  keep?.includes(file) !== true),
            )
            .map(({ file }) => file);
          findings.push({
            reason: "start_state_dirty",
            side,
            scenario: state.id,
            file: directory,
            command: removeCommand(remove),
            message: `Scenario ${state.id}: the fp- steps differ between the ${side}'s captures, so they did not all start from the same state; a capture was taken without a reset. Run the command to remove ${tie ? "them (no start state has a majority)" : "the captures outside the largest agreeing group"}, then evaluate again for the capture commands. ${resetHint(target, side)}.`,
          });
        }
      }

  // behavior: the original's table, as soon as one capture is admitted. parity: both sides.
  const behavior = new Map<string, ScenarioBehaviorTable>();
  const parity = new Map<string, ScenarioBehaviorComparison>();
  const stepCounts = { unchanged: 0, changed: 0, unknown: 0, unstable: 0 };
  let ungatedSteps = 0;
  let honouredVolatile = 0;
  const renamesApplied = new Map<
    string,
    { readonly from: string; readonly to: string; values: number }
  >();
  /** Status of every compared step, for `closed` entries. */
  const stepStatus = new Map<string, ScenarioStepStatus>();
  const stepKey = (scenario: string, stepId: string): string =>
    JSON.stringify([scenario, stepId]);
  if (target !== null)
    for (const state of states) {
      const original = state.sides.original;
      const clone = state.sides.clone;
      if (original !== undefined && original.admitted.length > 0)
        behavior.set(
          state.id,
          comparer.describe(original.admitted.map(({ capture }) => capture)),
        );
      if (original === undefined || clone === undefined || !bothSides(state))
        continue;
      const compared = comparer.compare({
        left: original.admitted.map(({ capture }) => capture),
        right: clone.admitted.map(({ capture }) => capture),
        renames: workspace.intendedDifferences.renames.map(({ from, to }) => ({
          from,
          to,
        })),
        volatile_fields: workspace.intendedDifferences.volatile_fields
          .filter((field) => field.scenario === state.id)
          .map(({ step_id, pointer }) => ({ step_id, pointer })),
      });
      if (!compared.ok) return compared;
      const comparison = compared.value;
      state.comparison = comparison;
      parity.set(state.id, comparison);
      for (const rename of comparison.renames_applied) {
        const key = JSON.stringify([rename.from, rename.to]);
        const entry = renamesApplied.get(key) ?? {
          from: rename.from,
          to: rename.to,
          values: 0,
        };
        entry.values += rename.values;
        renamesApplied.set(key, entry);
      }
      honouredVolatile += comparison.volatile_fields.filter(
        (field) => field.declared && field.side === "left",
      ).length;
      const reported = new Set<string>();
      for (const step of comparison.steps) {
        const kind = scenarioStepKind(step.step_id);
        if (kind === "reserved") continue;
        reported.add(step.step_id);
        stepCounts[step.status] += 1;
        stepStatus.set(stepKey(state.id, step.step_id), step.status);
        if (step.status === "unchanged") continue;
        // A difference blocks on every step; missing or unsteady data only on behaviour steps.
        if (step.status !== "changed" && kind !== "behavior") {
          ungatedSteps += 1;
          continue;
        }
        findings.push(
          parityFinding(
            { run, target, evaluate },
            state,
            step.step_id,
            step.status,
            step.findings,
          ),
        );
      }
      // A behaviour step the comparison does not report is missing data, never a match.
      for (const action of state.scenario.actions)
        if (
          scenarioStepKind(action.step_id) === "behavior" &&
          !reported.has(action.step_id)
        ) {
          stepCounts.unknown += 1;
          stepStatus.set(stepKey(state.id, action.step_id), "unknown");
          findings.push(
            parityFinding(
              { run, target, evaluate },
              state,
              action.step_id,
              "unknown",
              [],
            ),
          );
        }
    }

  // coverage: every behaviour step is cited, every citation names a step the original completed.
  const waivedObligations = new Set<string>();
  const waivedUnknowns = new Set<string>();
  const obligationById = new Map<string, CloneRunObligation>();
  for (const { obligations } of workspace.obligations.values())
    for (const obligation of obligations)
      if (!obligationById.has(obligation.id))
        obligationById.set(obligation.id, obligation);
  for (const waiver of workspace.waivers.waivers) {
    if (waiver.kind === "unknown" && workspace.unknowns.has(waiver.id))
      waivedUnknowns.add(waiver.id);
    if (
      waiver.kind === "obligation" &&
      obligationById.get(waiver.id)?.basis === "inferred"
    )
      waivedObligations.add(waiver.id);
  }
  const refusedScenarioFiles = new Set(
    workspace.issues
      .filter((issue) => issue.reason === "scenario_invalid")
      .map((issue) => issue.file),
  );
  const stateById = new Map(states.map((state) => [state.id, state]));
  const cited = new Set<string>();
  let obligationCount = 0;
  for (const [area, { obligations }] of workspace.obligations) {
    const file = `${CLONE_RUN_PATHS.obligations}/${area}.json`;
    for (const obligation of obligations) {
      obligationCount += 1;
      const unknownStep = (message: string, scenario?: string): void => {
        findings.push({
          reason: "obligation_step_unknown",
          obligation: obligation.id,
          scenario,
          file,
          command: evaluate,
          message: `${file}: obligation ${obligation.id} ${message}. An observed obligation cites behaviour steps the original completed; correct the case, or set basis to "inferred" for a rule no step shows.`,
        });
      };
      if (
        obligation.basis === "inferred" &&
        !waivedObligations.has(obligation.id)
      )
        findings.push({
          reason: "obligation_inferred",
          obligation: obligation.id,
          file,
          command: evaluate,
          message: `${file}: obligation ${obligation.id} is inferred, so no recorded step shows it. The prober adds a step that exercises it to a scenario; the spec writer then cites the step and sets basis to "observed". Or the lead accepts the gap by adding ${JSON.stringify(
            {
              kind: "obligation",
              id: obligation.id,
              person: "<name>",
              reason: "<why this gap is accepted>",
            },
          )} to waivers in ${CLONE_RUN_PATHS.waivers}.`,
        });
      for (const {
        scenario: scenarioId,
        step_ids: stepIds,
      } of obligation.cases) {
        const scenario = workspace.scenarios.get(scenarioId);
        if (scenario === undefined) {
          // A scenario file that is itself refused is reported there, once.
          if (
            !refusedScenarioFiles.has(
              `${CLONE_RUN_PATHS.scenarios}/${scenarioId}.json`,
            )
          )
            unknownStep(
              `cites scenario ${scenarioId}, and ${CLONE_RUN_PATHS.scenarios}/${scenarioId}.json does not exist`,
              scenarioId,
            );
          continue;
        }
        const captures = stateById.get(scenarioId)?.sides.original?.admitted;
        for (const stepId of stepIds) {
          if (!scenario.actions.some((action) => action.step_id === stepId)) {
            unknownStep(
              `cites step ${stepId}, which scenario ${scenarioId} does not have`,
              scenarioId,
            );
            continue;
          }
          const kind = scenarioStepKind(stepId);
          if (kind !== "behavior") {
            unknownStep(
              `cites ${stepId}, a ${kind} step of scenario ${scenarioId}; fp- and setup- steps cannot be cited`,
              scenarioId,
            );
            continue;
          }
          cited.add(stepKey(scenarioId, stepId));
          const incomplete = captures?.find(
            ({ capture }) =>
              capture.steps.find((step) => step.step_id === stepId)?.outcome !==
              "completed",
          );
          if (incomplete !== undefined)
            unknownStep(
              `cites step ${stepId} of scenario ${scenarioId}, which did not complete on the original in ${runRelative(run, incomplete.file)}`,
              scenarioId,
            );
        }
      }
    }
  }
  // While an obligation file is refused its citations are unread, so no step is called uncited.
  const obligationsRefused = refused("obligation_invalid");
  if (obligationsRefused) computed.coverage = false;
  for (const [id, scenario] of workspace.scenarios)
    for (const action of scenario.actions)
      if (
        !obligationsRefused &&
        scenarioStepKind(action.step_id) === "behavior" &&
        !cited.has(stepKey(id, action.step_id))
      )
        findings.push({
          reason: "step_uncited",
          scenario: id,
          step_id: action.step_id,
          file: CLONE_RUN_PATHS.obligations,
          command: evaluate,
          message: `Step ${action.step_id} of scenario ${id} is cited by no obligation. The spec writer reads ${CLONE_RUN_PATHS.behavior}/${id}.json and adds ${JSON.stringify(
            { scenario: id, step_ids: [action.step_id] },
          )} to the cases of the obligation it shows, in a file under ${CLONE_RUN_PATHS.obligations}/. A step that only prepares state is renamed setup-${action.step_id} by the prober instead.`,
        });

  // clean_room: no copied file, none of the original's names.
  if (target !== null && tree !== null) {
    const material = await materialSources(
      workspace,
      target,
      dependencies,
      signal,
    );
    if (!material.ok) return material;
    const replies: OriginalFileSource[] = states.flatMap((state) =>
      (state.sides.original?.admitted ?? []).flatMap(({ capture }) =>
        capture.reply_bodies
          .filter((body) => body.bytes >= CLEAN_ROOM_MIN_IDENTICAL_BYTES)
          .map((body) => ({
            sha256: body.sha256,
            source: `the original's reply to ${body.request}`,
          })),
      ),
    );
    for (const { path, source } of identicalCloneFiles(tree.files, [
      ...material.value,
      ...replies,
    ]))
      findings.push({
        reason: "clean_room_identical_file",
        file: join(target.clone.root, path),
        command: evaluate,
        message: `The clone's ${path} is byte-identical to ${source}. The clone is new code: write the file anew from ${CLONE_RUN_PATHS.specs}/ and ${CLONE_RUN_PATHS.behavior}/, then run the command. A third-party file both applications ship unchanged is listed in clone.exclude in ${CLONE_RUN_PATHS.target} by the lead.`,
      });
    let named: Awaited<ReturnType<typeof cloneFilesNamingOriginal>>;
    try {
      named = await cloneFilesNamingOriginal(
        target.clone.root,
        tree.files,
        target.original.names,
      );
    } catch (cause: unknown) {
      return err(
        new AnalysisInputError(EVALUATE_CLONE_RUN_OPERATION, {
          cause,
          conformsToInputContract: true,
          userMessage: `Could not read the clone's files for the name check: ${errorMessage(cause)}`,
          remediationAction:
            "Make the clone's files readable and unchanged while the referee runs, then evaluate again.",
        }),
      );
    }
    for (const { path, name, where: place } of named)
      findings.push({
        reason: "clean_room_forbidden_name",
        file: join(target.clone.root, path),
        command: evaluate,
        message: `The clone's ${path} contains the original's name "${name}" in its ${place === "path" ? "path" : "bytes"} (letter case is ignored). Replace it with the clone's own name "${target.clone.name}", then run the command.`,
      });
  }

  // unknowns: each is waived by a named person or closed by an observed obligation that passes.
  for (const [id, unknown] of workspace.unknowns) {
    if (waivedUnknowns.has(id)) continue;
    const closing = workspace.waivers.closed
      .filter((entry) => entry.unknown === id)
      .map((entry) => obligationById.get(entry.obligation))
      .filter((obligation) => obligation?.basis === "observed");
    const settled = closing.some(
      (obligation) =>
        obligation !== undefined &&
        obligation.cases.length > 0 &&
        obligation.cases.every((entry) =>
          entry.step_ids.every(
            (stepId) =>
              stepStatus.get(stepKey(entry.scenario, stepId)) === "unchanged",
          ),
        ),
    );
    if (settled) continue;
    const file = `${CLONE_RUN_PATHS.unknowns}/${id}.json`;
    findings.push({
      reason: "unknown_open",
      file,
      command: evaluate,
      message: `${file} is open: "${unknown.statement}"${
        closing.length > 0
          ? ` It is listed as closed, and the cited steps of the closing obligation are not all unchanged yet.`
          : ""
      } The lead settles it in ${CLONE_RUN_PATHS.waivers}: add ${JSON.stringify(
        {
          kind: "unknown",
          id,
          person: "<name>",
          reason: "<why this gap is accepted>",
        },
      )} to waivers, or once an observed obligation shows the answer add {"unknown":"${id}","obligation":"<obligation id>"} to closed.`,
    });
  }

  // The verdict: nothing but the findings above decides it.
  const ordered = worklistOrder(findings);
  const checks = Object.fromEntries(
    CLONE_RUN_CHECKS.map((check) => [
      check,
      findings.some((finding) => cloneRunReasonCheck(finding.reason) === check)
        ? "fail"
        : computed[check]
          ? "pass"
          : "not_evaluated",
    ]),
  ) as CloneRunGate["checks"];
  const notEvaluated = CLONE_RUN_CHECKS.filter(
    (check) => checks[check] === "not_evaluated",
  );
  const waivers = waivedUnknowns.size + waivedObligations.size;
  const passed = findings.length === 0 && notEvaluated.length === 0;

  const failuresSha256 = digestCanonicalValue(
    findings
      .map((finding) =>
        JSON.stringify([
          finding.reason,
          finding.scenario ?? "",
          finding.step_id ?? "",
          finding.pointer ?? "",
        ]),
      )
      .toSorted(),
    "Clone run findings",
  );
  const evidenceSha256 = digestCanonicalValue(
    states
      .flatMap((state) =>
        CLONE_RUN_SIDES.flatMap((side) =>
          (state.sides[side]?.admitted ?? []).map(({ capture }) =>
            JSON.stringify([side, state.id, capture.evidence_id]),
          ),
        ),
      )
      .toSorted(),
    "Clone run Evidence",
  );
  const journal = await readCloneRunJournal(run, signalOptions);
  const last = journal.at(-1);
  const treeSha256 = tree?.sha256 ?? null;
  const unchanged =
    last !== undefined &&
    last.judged === judged &&
    last.failures_sha256 === failuresSha256 &&
    last.clone_tree_sha256 === treeSha256 &&
    last.evidence_sha256 === evidenceSha256;
  const judgedBefore = journal.filter((entry) => entry.judged);
  const round = judgedBefore.length + (judged && !unchanged ? 1 : 0);
  // The judged round before this one: the last line when this evaluation adds a line, else the one before it.
  const previousJudged = judged
    ? unchanged
      ? judgedBefore.at(-2)
      : judgedBefore.at(-1)
    : undefined;
  const repeated =
    previousJudged !== undefined &&
    previousJudged.failures_sha256 === failuresSha256 &&
    previousJudged.clone_tree_sha256 === treeSha256;
  const maxRounds =
    target?.limits.max_rounds ?? CLONE_RUN_DEFAULT_LIMITS.max_rounds;
  const verdict: CloneRunVerdict = passed
    ? waivers > 0
      ? "done_with_waivers"
      : "done"
    : round >= maxRounds || repeated
      ? "stalled"
      : "not_done";
  const worklist = boundedList(ordered, CLONE_RUN_NEXT_LIMIT);
  const leftOut = worklist.omitted;
  const blocked =
    findings.length === 0
      ? `checks not evaluated: ${notEvaluated.join(", ")}`
      : `${plural(findings.length, "blocking finding")}${
          leftOut === 0
            ? ""
            : `; next lists the first ${CLONE_RUN_NEXT_LIMIT} and leaves out ${leftOut}`
        }`;
  const summary = passed
    ? waivers > 0
      ? `done with ${plural(waivers, "waiver")}`
      : "done"
    : verdict === "stalled"
      ? `stalled after ${plural(round, "judged round")} (${
          repeated
            ? "the last two had the same findings and the same clone tree"
            : `the limit is ${maxRounds}`
        }): ${blocked}`
      : `not done: ${blocked}`;
  const evaluatedAt = dependencies.now().toISOString();

  const gate: CloneRunGate = {
    schema: "rea.clone-run.gate/1",
    run,
    evaluated_at: evaluatedAt,
    verdict,
    summary,
    waivers,
    checks,
    target:
      target === null
        ? null
        : {
            original_address: target.original.address,
            clone_address: target.clone.address,
            clone_root: target.clone.root,
          },
    declared: {
      renames: [...renamesApplied.values()],
      volatile_fields: honouredVolatile,
    },
    blocking: CLONE_RUN_REASON_CODES.flatMap((reason) => {
      const count = findings.filter(
        (finding) => finding.reason === reason,
      ).length;
      return count === 0 ? [] : [{ reason, count }];
    }),
    next: worklist.items.map(toNextItem),
    counts: {
      scenarios: workspace.scenarios.size,
      obligations: obligationCount,
      cited_steps: cited.size,
      steps: stepCounts,
      ungated_steps: ungatedSteps,
      evidence: evidenceCounts,
    },
    clone_tree:
      tree === null
        ? null
        : {
            sha256: tree.sha256,
            files: tree.files.length,
            exclude: [...tree.exclude],
          },
    stall: { round, max_rounds: maxRounds, repeated },
    residual_trust: [...CLONE_RUN_RESIDUAL_TRUST],
  };
  const journalEntry: CloneRunJournalEntry | null = unchanged
    ? null
    : {
        schema: "rea.clone-run.journal/1",
        at: evaluatedAt,
        round,
        judged,
        verdict,
        failures_sha256: failuresSha256,
        clone_tree_sha256: treeSha256,
        evidence_sha256: evidenceSha256,
      };
  const rendered: {
    readonly side: CloneRunSide;
    readonly scenario: string;
    readonly document: JsonValue;
  }[] = states.flatMap((state) =>
    CLONE_RUN_SIDES.flatMap((side) => {
      const sideState = state.sides[side];
      return sideState === undefined
        ? []
        : [{ side, scenario: state.id, document: sideState.rendered.document }];
    }),
  );
  const written = await writeCloneRunOutputs(
    run,
    { gate, journalEntry, rendered, records, behavior, parity },
    signalOptions,
  );
  if (!written.ok) return written;
  return ok(gate);
};
