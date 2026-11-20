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
  type CloneRunRole,
  type CloneRunScenario,
  type CloneRunSide,
  type CloneRunTarget,
  type CloneRunVerdict,
} from "../../domain/cloneRun/cloneRunSchemas.js";
import {
  cloneRunStall,
  type CloneRunStall,
} from "../../domain/cloneRun/cloneRunStall.js";
import { shellQuote } from "../../domain/desktop/shellQuote.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  CLONE_TREE_STEP_PREFIX,
  SCENARIO_OMITTED_REQUESTS,
  scenarioFindingStatus,
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
import {
  SYSTEM_HOST_RESOLVER,
  cloneRunAddressConflict,
  type CloneRunHostResolver,
} from "./CloneRunAddressResolution.js";
import {
  digestOriginalMaterial,
  type CloneTreeSnapshot,
  type CloneTreeUnsafeLink,
} from "./CloneRunTreeDigest.js";
import {
  cloneRunCaptureCommand,
  cloneRunEvaluateCommand,
  cloneRunFolderInsideClone,
  loadCloneRunWorkspace,
  readCloneRunJournal,
  renderCloneRunScenario,
  writeCloneRunOutputs,
  type CloneRunEvidenceEntry,
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
  "The verdict covers only the steps the scenarios contain. REA cannot tell whether they exercise every rule of the original, nor whether an obligation's statement describes the steps it cites; deleting a failing step, a capture or an unknown file leaves no trace.",
  "Evidence integrity is an unkeyed content digest: it catches an edited or misplaced file, not Evidence forged by recomputing the digest with REA's own code.",
  "A capture is bound to an address, not to what answered there: REA cannot prove which program or which build of the clone was serving, nor that it did not pass requests on to another server. The two addresses are checked to differ by port or by resolved host; a proxy or a port forward between them is not detected.",
  "Clone Evidence is bound to the tree digest its capture input was rendered for and that digest equals the tree now; an edit that was reverted between the two is not visible. The digest covers the path and bytes of every regular file and the text of every link; file modes, empty directories and special files (a FIFO, a socket, a device) are not part of it.",
  "Excluded clone paths are not digested, so an edit there never makes a capture stale, and they are not checked for copied files or names. The summary names them whenever an exclude matched.",
  "Renames and volatile fields are declarations: a rename can declare away any difference in on-screen text or a string value, and an honoured volatile field is compared by shape only. The gate lists those that took effect.",
  "A waiver's person and reason are recorded as given.",
  "The clean-room check covers names and identical files only: no declared name of the original in the clone, and no clone file byte-identical to a file of the declared material or to a reply body a capture recorded, 64 KiB each at most. It does not detect rewritten, reformatted or paraphrased code.",
  "REA does not reset targets; a clean start is inferred from the fingerprint steps only.",
  "The journal is the referee's own output; removing it can hide a stall and cannot produce a pass.",
  "A step is compared on its outcome, its requests, their statuses, fetched reply bodies, the page address and the accessibility text only. Appearance, styles, images, fonts, response headers, the document title and timing are not compared.",
  "Text inside an iframe and the text of alert, confirm and prompt dialogs are not compared.",
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
  /** How host names resolve for the address check; production uses the system resolver. */
  readonly hostResolver?: CloneRunHostResolver;
}

/**
 * One worklist item. It counts once in `blocking`, or once per step when it
 * stands for several steps with one and the same finding (`step_ids`).
 */
interface Finding {
  readonly reason: CloneRunReasonCode;
  /** The role that acts, where the finding knows better than its reason's default. */
  readonly role?: CloneRunRole;
  /**
   * The command is a capture or a removal of captures: the referee's own
   * remedy is other Evidence, which the stall rule lets the team try once.
   */
  readonly awaitsCapture?: boolean;
  readonly step_ids?: readonly string[] | undefined;
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
  files: readonly CloneRunEvidenceEntry[],
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
  for (const { path: file, kind } of files) {
    if (context.signal?.aborted === true)
      return err(cancelledBy(EVALUATE_CLONE_RUN_OPERATION, context.signal));
    const shown = runRelative(context.run, file);
    if (kind !== "file") {
      // Never read through: a directory or a link here is not a capture, and its name is taken.
      entries.push({
        file: shown,
        status: "rejected_integrity",
        evidence_id: null,
        start_origin: null,
        scenario_sha256: null,
        bound_clone_tree_sha256: null,
        detail: `This is ${
          kind === "directory"
            ? "a directory"
            : kind === "link"
              ? "a symbolic link"
              : "not a regular file"
        }, not a file capture-browser-scenario wrote`,
      });
      continue;
    }
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

/** A source of run numbers that skips every existing `run-N.json`: stale captures, directories and links included. */
const runNumbers = (
  files: readonly CloneRunEvidenceEntry[],
): (() => number) => {
  const taken = new Set(files.map(({ path }) => basename(path)));
  let next = 0;
  return () => {
    do next += 1;
    while (taken.has(`run-${next}.json`));
    return next;
  };
};

/** "Step a", or "Steps a, b and c" for steps that share one finding. */
const stepsLabel = (stepIds: readonly string[]): string => {
  const [first = "", ...rest] = stepIds;
  if (rest.length === 0) return `Step ${first}`;
  const listed = stepIds.slice(0, 5);
  const more = stepIds.length - listed.length;
  return more > 0
    ? `Steps ${listed.join(", ")} and ${more} more (${stepIds.length} steps with this same finding)`
    : `Steps ${listed.slice(0, -1).join(", ")} and ${listed.at(-1) ?? ""}`;
};

/** What a difference without recorded values is, by the comparer's category. */
const CATEGORY_TEXT: Readonly<Record<string, string>> = {
  order: "the items are the same and come in another order",
  length: "the number of items differs",
  "missing-step": "the clone's captures have no such step",
};

/** Both sides of a difference, never two placeholders: a side without a value is said to have none. */
const sidesText = (shown: ScenarioBehaviorFinding | undefined): string => {
  const expected = shown?.expected ?? null;
  const actual = shown?.actual ?? null;
  if (expected !== null && actual !== null)
    return `the original gave ${expected}, the clone gave ${actual}`;
  if (expected !== null)
    return `the original gave ${expected} and the clone has nothing there`;
  if (actual !== null)
    return `the clone gave ${actual} and the original has nothing there`;
  if (shown === undefined) return "the comparison recorded no values";
  return (
    CATEGORY_TEXT[shown.category] ??
    `a difference of kind "${shown.category}", for which the comparison recorded no values`
  );
};

const escapePattern = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * The renames that alone turn the original's value into the clone's: every
 * place the two differ is a spelling of one of the original's names (letter
 * case ignored) or the original's address, replaced by one text throughout.
 * Undefined when the values differ in any other way, so a real difference is
 * never offered as a declaration.
 */
export const renamesThatSettle = (
  expected: string,
  actual: string,
  needles: readonly string[],
): readonly { readonly from: string; readonly to: string }[] | undefined => {
  if (needles.length === 0 || expected === actual) return undefined;
  const source = needles.map(escapePattern).join("|");
  const named = new RegExp(source, "iu");
  const matches = [...expected.matchAll(new RegExp(source, "giu"))];
  if (matches.length === 0) return undefined;
  const renames = new Map<string, string>();
  let inExpected = 0;
  let inActual = 0;
  for (const [index, match] of matches.entries()) {
    const literal = expected.slice(inExpected, match.index);
    if (!actual.startsWith(literal, inActual)) return undefined;
    inActual += literal.length;
    inExpected = match.index + match[0].length;
    const next = matches[index + 1];
    const following = expected.slice(inExpected, next?.index);
    // Two names with nothing between them cannot be told apart in the clone's value.
    if (next !== undefined && following === "") return undefined;
    const end =
      next === undefined
        ? actual.length - following.length
        : actual.indexOf(following, inActual);
    if (end < inActual) return undefined;
    const to = actual.slice(inActual, end);
    const from = match[0];
    if (to === "" || to === from || named.test(to)) return undefined;
    if ((renames.get(from) ?? to) !== to) return undefined;
    renames.set(from, to);
    inActual = end;
  }
  return actual.slice(inActual) === expected.slice(inExpected)
    ? [...renames].map(([from, to]) => ({ from, to }))
    : undefined;
};

const ONE_AT_A_TIME =
  "something else was talking to the instance during a capture (one capture at a time per side)";

/** Where and why a side's step did not complete, from the outcomes its captures recorded. */
const incompleteStep = <Capture extends ScenarioBehaviorCaptureFacts>(
  run: string,
  state: ScenarioState<Capture>,
  side: CloneRunSide,
): string => {
  for (const { file, capture } of state.sides[side]?.admitted ?? []) {
    const failed = capture.steps.find((step) => step.outcome === "failed");
    if (failed === undefined) continue;
    const action = state.scenario.actions.find(
      (entry) => entry.step_id === failed.step_id,
    )?.action;
    return ` Step ${failed.step_id} failed on the ${side} in ${runRelative(run, file)}, and every step after a failed one is cancelled.${
      action === "request"
        ? ` ${failed.step_id} is a request step: it fails when the application answers with a redirect (a 3xx reply, which a request step does not follow), with a status outside its expected_status, or after the page has left the ${side}'s address. A redirect is reached through the page (a form or a link), or the step requests the redirect's target instead.`
        : ` ${failed.step_id} is ${action === undefined ? "the start of the scenario" : `a ${String(action)} step`}: it fails when the page it needs did not load, its locator matched nothing in time, or a reply it waits for did not answer 2xx.`
    }`;
  }
  return "";
};

/** The worklist item for steps of one scenario that share one finding and are not `unchanged`. */
const parityFinding = <Capture extends ScenarioBehaviorCaptureFacts>(
  context: {
    readonly run: string;
    readonly target: CloneRunTarget;
    readonly evaluate: string;
  },
  state: ScenarioState<Capture>,
  stepIds: readonly [string, ...string[]],
  status: Exclude<ScenarioStepStatus, "unchanged">,
  shown: ScenarioBehaviorFinding | undefined,
): Finding => {
  const { target, run } = context;
  const scenario = state.id;
  const [stepId] = stepIds;
  const steps = stepsLabel(stepIds);
  const several = stepIds.length > 1;
  const common = {
    scenario,
    step_id: stepId,
    ...(several ? { step_ids: stepIds } : {}),
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
  const scenarioFile = `${CLONE_RUN_PATHS.scenarios}/${scenario}.json`;
  const asSetup = several
    ? `renames them with the setup- prefix (setup-${stepId}, …)`
    : `renames it setup-${stepId}`;
  if (status === "changed") {
    const differs = `${steps} of scenario ${scenario} ${several ? "differ" : "differs"} from the original at ${at}: ${sidesText(shown)}.`;
    const renames =
      shown?.expected == null || shown.actual == null
        ? undefined
        : renamesThatSettle(shown.expected, shown.actual, [
            ...target.original.names,
            target.original.address,
          ]);
    if (renames !== undefined)
      return {
        ...common,
        reason: "parity_changed",
        role: "lead",
        side: "clone",
        file: CLONE_RUN_PATHS.intendedDifferences,
        command: context.evaluate,
        message: `${differs} The two values are equal once ${renames
          .map(({ from, to }) => `"${from}" reads "${to}"`)
          .join(
            " and ",
          )}: the original's name or address in a spelling no declared rename covers (renames are case-sensitive). If that is the intended difference, the lead adds ${renames
          .map((rename) =>
            JSON.stringify({ ...rename, reason: "<why the clone differs>" }),
          )
          .join(
            " and ",
          )} to renames in ${CLONE_RUN_PATHS.intendedDifferences}, then runs the command. The clone is not changed for this: it may not print the original's name.`,
      };
    return {
      ...common,
      reason: "parity_changed",
      side: "clone",
      file: target.clone.root,
      command: context.evaluate,
      message: `${differs} ${behavior} shows what the original does. Change the clone, restart it, have it captured again, then run the command.`,
    };
  }
  const side: CloneRunSide = shown?.side === "right" ? "clone" : "original";
  if (status === "unknown") {
    const original = state.sides.original;
    if (shown?.category === "declared-not-shown" && original !== undefined)
      return {
        ...common,
        reason: "parity_unknown",
        role: "prober",
        awaitsCapture: true,
        side: "original",
        file: `${CLONE_RUN_PATHS.evidence}/original/${scenario}`,
        command: original.sharedCaptureCommand(),
        message: `${steps} of scenario ${scenario}: ${at} is declared volatile in ${CLONE_RUN_PATHS.intendedDifferences}, but the original's captures all gave ${shown.expected ?? "one value"} and the clone gave ${shown.actual ?? "another"}. A declaration is honoured only where the original's own captures differ, so nothing was ignored and nothing is held against the clone yet. A value that changes by the day or the hour looks steady in captures taken together: capture the original again now. ${resetHint(target, "original")}, then run the command and evaluate again. If the original still gives one value, the lead removes the entry from volatile_fields, and the difference is then the builder's to fix.`,
      };
    if (
      shown?.category === "not-recorded" &&
      shown.request === SCENARIO_OMITTED_REQUESTS
    )
      return {
        ...common,
        reason: "parity_unknown",
        role: "prober",
        side,
        file: scenarioFile,
        command: context.evaluate,
        message: `${steps} of scenario ${scenario} cannot be compared: the ${side}'s capture left out part of what the scenario did (${
          shown.expected ?? shown.actual ?? "request events omitted"
        }), so no step's requests are known to be all it made. Another capture of the same scenario leaves out the same, so no capture command is given: the prober splits ${scenarioFile} into shorter scenarios that each stay within the capture's limit; both sides are then captured again.`,
      };
    const sideState = state.sides[side];
    if (
      (shown?.category === "not-recorded" ||
        shown?.category === "single-observation") &&
      sideState !== undefined
    )
      return {
        ...common,
        reason: "parity_unknown",
        awaitsCapture: true,
        side,
        file: `${CLONE_RUN_PATHS.evidence}/${side}/${scenario}`,
        command: sideState.sharedCaptureCommand(),
        message:
          shown.category === "single-observation"
            ? `${steps} of scenario ${scenario}: only one capture of the ${side} recorded ${at}, so whether the ${side} holds that value steadily cannot be judged. One more capture settles it. ${resetHint(
                target,
                side,
              )}, then run the command and evaluate again.`
            : `${steps} of scenario ${scenario}: ${at} was not recorded on the ${side}. ${
                shown.dimension === "body"
                  ? "Captures fold, so one more can supply it."
                  : "One more capture may record it; only a reply body is supplied by another capture, so once a capture records it the next evaluation asks for the captures without it to be removed."
              } ${resetHint(
                target,
                side,
              )}, then run the command and evaluate again. Data still missing after another capture will not arrive (a body over the capture's 64 KiB body limit is never recorded, nor is the body of a download): the prober then ${asSetup} in ${scenarioFile}, and it no longer counts as behaviour.`,
      };
    if (shown?.category === "not-completed")
      return {
        ...common,
        reason: "parity_unknown",
        side,
        file: scenarioFile,
        command: context.evaluate,
        message: `${steps} of scenario ${scenario} cannot be compared: ${several ? "they" : "it"} did not complete on the ${side} (${shown.expected ?? shown.actual ?? "not completed"}).${incompleteStep(run, state, side)} A step that did not complete proves nothing. The prober changes the scenario in ${scenarioFile} so the step completes on the ${side} at its own address; both sides are then captured again.`,
      };
    return {
      ...common,
      reason: "parity_unknown",
      side,
      file: scenarioFile,
      command: context.evaluate,
      message: `${steps} of scenario ${scenario} cannot be compared: ${
        shown === undefined
          ? "the comparison reported no result for it"
          : `${shown.category} at ${at} on the ${side}`
      }. A step that sends the browser or a request to another origin, or whose data is missing, proves nothing. Make the step stay on the ${side}'s own address, or have the prober change it in ${scenarioFile}; both sides are then captured again.`,
    };
  }
  if (side === "original") {
    // A request line only the clone sent, where the original's own request lines vary: the finding carries the clone's line as its right value.
    const cloneOnlyRequest =
      shown?.dimension === "request" &&
      shown.request !== null &&
      shown.actual !== null;
    const differs = cloneOnlyRequest
      ? `${steps} of scenario ${scenario}: the clone sent ${shown.request ?? ""}, which no capture of the original sent, but the original's own captures do not send the same requests as each other at ${several ? "these steps" : "this step"}, so the difference cannot be held against the clone.`
      : `${steps} of scenario ${scenario}: ${at} differs between the original's own captures${
          shown?.expected == null ? "" : ` (${shown.expected})`
        }, so it cannot be held against the clone.`;
    const declarable =
      shown?.dimension === "body" &&
      shown.pointer !== null &&
      shown.pointer !== "";
    if (declarable)
      return {
        ...common,
        reason: "parity_unstable",
        role: "lead",
        side,
        file: CLONE_RUN_PATHS.intendedDifferences,
        command: context.evaluate,
        message: `${differs} Either the value differs by nature (a time, a generated id), or ${ONE_AT_A_TIME}. If it differs by nature, the lead adds ${JSON.stringify(
          {
            scenario,
            step_id: stepId,
            pointer: shown.pointer,
            reason: "<why it varies>",
          },
        )} to volatile_fields in ${CLONE_RUN_PATHS.intendedDifferences} (step_id "*" covers every step of the scenario); its shape is still compared. If it should be steady, the prober removes the original's captures of this scenario and captures again, one at a time. Then run the command.`,
      };
    return {
      ...common,
      reason: "parity_unstable",
      role: "prober",
      side,
      file: scenarioFile,
      command: context.evaluate,
      message: `${differs} ${
        shown?.dimension === "body"
          ? "A text reply cannot be declared volatile: only one field of a JSON reply can."
          : `Only a field of a JSON reply can be declared volatile, not ${shown?.dimension === "text" ? "on-screen text" : `a ${shown?.dimension ?? "step"} difference`}.`
      } Either the original varies here by nature${
        cloneOnlyRequest
          ? " (a generated id, a nonce or a time in the request line)"
          : ""
      }, the snapshot was taken before the page settled, one capture lacks what another recorded, or ${ONE_AT_A_TIME}. If it should be steady, the prober first removes the original's captures of this scenario and captures again, one at a time. If the difference returns, the prober makes the step deterministic in ${scenarioFile} (a wait_for before it, a page without the varying part) or ${asSetup}, which stops it counting as behaviour. Then run the command; both sides are captured again after a scenario change.`,
    };
  }
  const clone = state.sides.clone;
  return {
    ...common,
    reason: "parity_unstable",
    role: "verifier",
    awaitsCapture: true,
    side,
    file: `${CLONE_RUN_PATHS.evidence}/clone/${scenario}`,
    command: removeCommand((clone?.admitted ?? []).map(({ file }) => file)),
    message: `${steps} of scenario ${scenario}: ${at} differs between the clone's own captures${
      shown?.actual == null ? "" : ` (${shown.actual})`
    } where the original holds one value${
      shown?.expected == null ? "" : ` (${shown.expected})`
    }. Nothing says yet that the clone is wrong: a snapshot may have been taken before the page settled, or ${ONE_AT_A_TIME}. Captures fold, so a new capture cannot outvote an old one: the verifier runs the command to remove the clone's captures of this scenario, evaluates for the capture commands and captures again, one at a time. ${resetHint(target, "clone")}. Only if the same difference returns is it the builder's (make the clone answer the same every time; ${behavior} shows the original) or the prober's (a wait_for before the step in ${scenarioFile}).`,
  };
};

const toNextItem = (finding: Finding): CloneRunNextItem => ({
  role: finding.role ?? cloneRunReasonRole(finding.reason, finding.side),
  reason: finding.reason,
  file: finding.file,
  command: finding.command,
  message: finding.message,
  ...(finding.side === undefined ? {} : { side: finding.side }),
  ...(finding.scenario === undefined ? {} : { scenario: finding.scenario }),
  ...(finding.step_id === undefined ? {} : { step_id: finding.step_id }),
  ...(finding.step_ids === undefined
    ? {}
    : { step_ids: [...finding.step_ids] }),
  ...(finding.obligation === undefined
    ? {}
    : { obligation: finding.obligation }),
  ...(finding.dimension === undefined ? {} : { dimension: finding.dimension }),
  ...(finding.pointer === undefined ? {} : { pointer: finding.pointer }),
  ...(finding.expected === undefined ? {} : { expected: finding.expected }),
  ...(finding.actual === undefined ? {} : { actual: finding.actual }),
});

/** How many blocking findings one worklist item stands for. */
const findingCount = (finding: Finding): number =>
  finding.step_ids?.length ?? 1;

/**
 * Check order, then reason order, then scenario; steps keep the order they
 * were found in. While no scenario exists the missing clone root comes after
 * the input reasons: the first thing a new run needs is a scenario, and a
 * builder has nothing to build from before one is captured.
 */
const worklistOrder = (
  findings: readonly Finding[],
  noScenario: boolean,
): readonly Finding[] => {
  const inputs = CLONE_RUN_CHECKS.indexOf("inputs");
  const rank = (finding: Finding): readonly [number, number, string] => [
    noScenario && finding.reason === "clone_root_missing"
      ? inputs + 0.5
      : CLONE_RUN_CHECKS.indexOf(cloneRunReasonCheck(finding.reason)),
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

/**
 * Files under the declared material directories, by digest, with a finding
 * for everything declared that was not read: material the referee did not
 * read cannot show a copy, so it is never counted as clean.
 */
const materialSources = async (
  workspace: CloneRunWorkspace,
  target: CloneRunTarget,
  evaluate: string,
  signal: AbortSignal | undefined,
): Promise<
  Result<
    {
      readonly sources: readonly OriginalFileSource[];
      readonly findings: readonly Finding[];
    },
    AnalysisError
  >
> => {
  const sources: OriginalFileSource[] = [];
  const findings: Finding[] = [];
  for (const [index, declared] of target.original.material.entries()) {
    const directory = isAbsolute(declared)
      ? declared
      : join(workspace.run, declared);
    const pointer = `/original/material/${index}`;
    const unread = (what: string): void => {
      findings.push({
        reason: "target_invalid",
        file: CLONE_RUN_PATHS.target,
        command: evaluate,
        pointer,
        message: `${CLONE_RUN_PATHS.target} ${pointer}: ${what}, so the copied-file check cannot read it and does not count it as clean. Material is where files taken from the original are kept; correct the path, create the directory (an empty one is fine) or remove the entry, then run the command.`,
      });
    };
    const present = await stat(directory).then(
      (entry) => entry.isDirectory(),
      () => false,
    );
    if (!present) {
      unread(`the material directory ${declared} does not exist`);
      continue;
    }
    const snapshot = await digestOriginalMaterial(
      directory,
      signal === undefined ? {} : { signal },
    );
    if (!snapshot.ok) return snapshot;
    for (const { path, detail } of snapshot.value.unreadable)
      unread(`${declared}/${path} could not be read (${detail})`);
    for (const file of snapshot.value.files)
      sources.push({ sha256: file.sha256, source: `${declared}/${file.path}` });
  }
  return ok({ sources, findings });
};

const UNSAFE_LINK_TEXT: Readonly<Record<CloneTreeUnsafeLink["cause"], string>> =
  {
    outside: "that leads outside the clone root",
    excluded: "that leads under an excluded path",
    unresolved:
      "that cannot be resolved now (its target is absent, or the links loop)",
  };

/** The fp- steps whose observations differ between one side's own captures, by dimension. */
const fingerprintDifferences = <Capture extends ScenarioBehaviorCaptureFacts>(
  comparer: ScenarioBehaviorComparer<Capture>,
  captures: readonly Capture[],
): readonly (ScenarioBehaviorFinding & { readonly step_id: string })[] => {
  // The side against itself: every finding is a disagreement between its own repeats.
  const compared = comparer.compare({
    left: captures,
    right: captures,
    renames: [],
    volatile_fields: [],
  });
  if (!compared.ok) return [];
  return compared.value.steps
    .filter((step) => scenarioStepKind(step.step_id) === "fingerprint")
    .flatMap((step) =>
      step.findings
        .filter((finding) => scenarioFindingStatus(finding) === "unstable")
        .map((finding) => ({ ...finding, step_id: step.step_id })),
    );
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
  options: {
    readonly signal?: AbortSignal;
    /** False to compute the gate without writing any output: `init-clone-run` asks for the first worklist this way. */
    readonly writeOutputs?: boolean;
  } = {},
): Promise<Result<CloneRunGate, AnalysisError>> => {
  const { signal } = options;
  const signalOptions = signal === undefined ? {} : { signal };
  const { comparer } = dependencies;
  const loaded = await loadCloneRunWorkspace(runDirectory, signalOptions);
  if (!loaded.ok) return loaded;
  const workspace = loaded.value;
  const { run, target } = workspace;
  const evaluate = cloneRunEvaluateCommand(run, workspace.reaCommand);
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
    const sameAddress = await cloneRunAddressConflict(
      target.original.address,
      target.clone.address,
      dependencies.hostResolver ?? SYSTEM_HOST_RESOLVER,
    );
    if (sameAddress !== undefined)
      findings.push({
        reason: "addresses_not_distinct",
        file: CLONE_RUN_PATHS.target,
        command: evaluate,
        pointer: "/clone/address",
        message: `${CLONE_RUN_PATHS.target}: ${sameAddress.message} Serve the clone on another port and record that address in /clone/address${
          sameAddress.relation === "unknown"
            ? ", or write each address with an IP address or a name this machine resolves"
            : ""
        }, then run the command.`,
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
      for (const link of tree.unsafeLinks)
        findings.push({
          reason: "clone_symlink_outside_root",
          file: join(target.clone.root, link.path),
          command: evaluate,
          message: `The clone's ${link.path} is a symlink ${UNSAFE_LINK_TEXT[link.cause]}, so what it serves can change without the tree digest changing. Remove the link or copy its target into the clone; a link the clone does not serve can be listed in clone.exclude in ${CLONE_RUN_PATHS.target}. Then run the command.`,
        });
      for (const entry of tree.unreadable)
        findings.push({
          reason: "clone_path_unreadable",
          file: join(target.clone.root, entry.path),
          command: evaluate,
          message: `The clone's ${entry.path} could not be read (${entry.detail}), so the tree digest and the clean-room check do not cover it. Make it readable, rename it or remove it; a path the clone does not serve can be listed in clone.exclude in ${CLONE_RUN_PATHS.target}. Then run the command.`,
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
          const rejected = join(run, file.file);
          const isDirectory = (
            workspace.evidence[side].get(state.id) ?? []
          ).some(
            (entry) => entry.path === rejected && entry.kind === "directory",
          );
          findings.push({
            reason: `evidence_${file.status}`,
            side,
            scenario: state.id,
            file: file.file,
            awaitsCapture: true,
            command: isDirectory
              ? `rm -r ${shellQuote(rejected)}`
              : removeCommand([rejected]),
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
              awaitsCapture: true,
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
            awaitsCapture: true,
            command: sideState.sharedCaptureCommand(),
            message: `Scenario ${state.id}: fewer than two captures of the ${side} recorded everything its fp- steps observe, so a clean start is not shown. ${resetHint(target, side)}, then run the command. If an fp- step can never be recorded whole (a reply over the 64 KiB body limit, a step that does not complete), the prober replaces it with one that reads the start state in a smaller reply.`,
          });
        const differences =
          startState === "dirty"
            ? fingerprintDifferences(
                comparer,
                sideState.admitted.map(({ capture }) => capture),
              )
            : [];
        const [textDifference] = differences;
        if (
          startState === "dirty" &&
          textDifference !== undefined &&
          differences.every((finding) => finding.dimension === "text")
        ) {
          // Nothing the fp- steps request differs: the page shows text that varies by itself.
          const scenarioFile = `${CLONE_RUN_PATHS.scenarios}/${state.id}.json`;
          findings.push({
            reason: "start_state_dirty",
            role: "prober",
            side,
            scenario: state.id,
            step_id: textDifference.step_id,
            dimension: "text",
            ...(textDifference.expected === null
              ? {}
              : { expected: textDifference.expected }),
            file: scenarioFile,
            command: evaluate,
            message: `Scenario ${state.id}: the on-screen text at ${textDifference.step_id} differs between the ${side}'s captures${
              textDifference.expected === null
                ? ""
                : ` (${textDifference.expected})`
            }, and nothing else its fp- steps observe does. That is text that varies by itself (a clock, a counter), not a start state that was not reset, so removing captures or resetting again changes nothing. The prober changes ${scenarioFile}: start_path names a page without the varying text, or the fp- steps become request steps that read the state (a list request). Then run the command; both sides are captured again.`,
          });
        } else if (startState === "dirty") {
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
            awaitsCapture: true,
            command: removeCommand(remove),
            message: `Scenario ${state.id}: what the fp- steps observe differs between the ${side}'s captures, so they did not all start from the same state: a capture was taken without a reset, or ${ONE_AT_A_TIME}. Run the command to remove ${tie ? "them (no start state has a majority)" : "the captures outside the largest agreeing group"}, then evaluate again for the capture commands. ${resetHint(target, side)}.`,
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
        (field) => field.honoured && field.side === "left",
      ).length;
      const reported = new Set<string>();
      /** Steps that share one finding become one worklist item, in the order first found. */
      const groups = new Map<
        string,
        {
          readonly stepIds: [string, ...string[]];
          readonly status: Exclude<ScenarioStepStatus, "unchanged">;
          readonly shown: ScenarioBehaviorFinding | undefined;
        }
      >();
      const report = (
        stepId: string,
        status: Exclude<ScenarioStepStatus, "unchanged">,
        observations: readonly ScenarioBehaviorFinding[],
      ): void => {
        const shown =
          observations.find(
            (finding) => scenarioFindingStatus(finding) === status,
          ) ?? observations[0];
        const key = JSON.stringify([status, shown ?? stepId]);
        const group = groups.get(key);
        if (group === undefined)
          groups.set(key, { stepIds: [stepId], status, shown });
        else group.stepIds.push(stepId);
      };
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
        report(step.step_id, step.status, step.findings);
      }
      // A behaviour step the comparison does not report is missing data, never a match.
      for (const action of state.scenario.actions)
        if (
          scenarioStepKind(action.step_id) === "behavior" &&
          !reported.has(action.step_id)
        ) {
          stepCounts.unknown += 1;
          stepStatus.set(stepKey(state.id, action.step_id), "unknown");
          report(action.step_id, "unknown", []);
        }
      for (const { stepIds, status, shown } of groups.values())
        findings.push(
          parityFinding(
            { run, target, evaluate },
            state,
            stepIds,
            status,
            shown,
          ),
        );
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
    const material = await materialSources(workspace, target, evaluate, signal);
    if (!material.ok) return material;
    findings.push(...material.value.findings);
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
      ...material.value.sources,
      ...replies,
    ]))
      findings.push({
        reason: "clean_room_identical_file",
        file: join(target.clone.root, path),
        command: evaluate,
        message: `The clone's ${path} is byte-identical to ${source} (the clean-room check covers names and identical files only). The clone is new code: write the file anew from ${CLONE_RUN_PATHS.specs}/ and ${CLONE_RUN_PATHS.behavior}/, then run the command. A third-party file both applications ship unchanged is listed in clone.exclude in ${CLONE_RUN_PATHS.target} by the lead.`,
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
        message: `The clone's ${path} contains the original's name "${name}" in its ${place === "path" ? "path" : place === "link" ? "link text" : "bytes"} (letter case is ignored; the clean-room check covers names and identical files only). Replace it with the clone's own name "${target.clone.name}", then run the command.`,
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
  const ordered = worklistOrder(findings, workspace.scenarios.size === 0);
  const total = findings.reduce(
    (sum, finding) => sum + findingCount(finding),
    0,
  );
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

  // One line per blocking finding: what blocks and where, so two findings of one reason are two.
  const failuresSha256 = digestCanonicalValue(
    findings
      .flatMap((finding) =>
        (finding.step_ids ?? [finding.step_id ?? ""]).map((stepId) =>
          JSON.stringify([
            finding.reason,
            finding.side ?? "",
            finding.file,
            finding.scenario ?? "",
            stepId,
            finding.obligation ?? "",
            finding.pointer ?? "",
          ]),
        ),
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
  const treeSha256 = tree?.sha256 ?? null;
  const maxRounds =
    target?.limits.max_rounds ?? CLONE_RUN_DEFAULT_LIMITS.max_rounds;
  const stall: CloneRunStall = cloneRunStall(
    await readCloneRunJournal(run, signalOptions),
    {
      judged,
      failuresSha256,
      cloneTreeSha256: treeSha256,
      evidenceSha256,
      awaitsCapture: findings.some((finding) => finding.awaitsCapture === true),
    },
    maxRounds,
  );
  const verdict: CloneRunVerdict = passed
    ? waivers > 0
      ? "done_with_waivers"
      : "done"
    : stall.stalled === null
      ? "not_done"
      : "stalled";
  const worklist = boundedList(ordered, CLONE_RUN_NEXT_LIMIT);
  const leftOut =
    total -
    worklist.items.reduce((sum, finding) => sum + findingCount(finding), 0);
  const blocked =
    findings.length === 0
      ? `checks not evaluated: ${notEvaluated.join(", ")}`
      : `${plural(total, "blocking finding")}${
          leftOut === 0
            ? ""
            : `; next lists the first ${CLONE_RUN_NEXT_LIMIT} and leaves out ${leftOut}`
        }`;
  // An exclude in force is said next to the verdict: those paths can change without any capture going stale.
  const excluded = tree?.exclude ?? [];
  const excludedNote =
    excluded.length === 0
      ? ""
      : `; ${plural(excluded.length, "clone path")} ${excluded.length === 1 ? "is" : "are"} excluded and ${excluded.length === 1 ? "is" : "are"} covered neither by staleness nor by the clean-room check (${excluded.join(", ")})`;
  const summary = `${
    passed
      ? waivers > 0
        ? `done with ${plural(waivers, "waiver")}`
        : "done"
      : verdict === "stalled"
        ? `stalled after ${plural(stall.round, "judged round")} (${
            stall.stalled === "no_progress"
              ? `the same findings were judged ${stall.attempts} times on the same clone tree`
              : `the limit is ${maxRounds}`
          }): ${blocked}`
        : `not done: ${blocked}`
  }${excludedNote}`;
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
      const count = findings
        .filter((finding) => finding.reason === reason)
        .reduce((sum, finding) => sum + findingCount(finding), 0);
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
    stall: {
      round: stall.round,
      max_rounds: maxRounds,
      judged,
      attempts: stall.attempts,
      repeated: stall.repeated,
      outlook: passed ? null : stall.outlook,
    },
    // The limits are read next to a pass; a worklist does not repeat them every round.
    residual_trust: passed ? [...CLONE_RUN_RESIDUAL_TRUST] : [],
  };
  const journalEntry: CloneRunJournalEntry | null = stall.record
    ? {
        schema: "rea.clone-run.journal/1",
        at: evaluatedAt,
        round: stall.round,
        judged,
        verdict,
        failures_sha256: failuresSha256,
        clone_tree_sha256: treeSha256,
        evidence_sha256: evidenceSha256,
      }
    : null;
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
  if (options.writeOutputs === false) return ok(gate);
  const written = await writeCloneRunOutputs(
    run,
    {
      gate,
      derived: target !== null,
      journalEntry,
      rendered,
      records,
      behavior,
      parity,
    },
    signalOptions,
  );
  if (!written.ok) return written;
  return ok(gate);
};
