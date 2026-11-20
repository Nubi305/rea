import { z } from "zod";

import type { AnalysisError } from "./analysisErrorBase.js";
import { digestSchema } from "./digests.js";
import { escapeJsonPointerToken, jsonPointerTokens } from "./jsonPointer.js";
import {
  equalJsonValues,
  jsonValueSchema,
  type JsonValue,
} from "./jsonValue.js";
import type { Result } from "./result.js";

/**
 * Behaviour parity of one browser scenario captured against two addresses.
 * Contract: docs/specs/reconstruction/clone-runs/spec.md. The exported names
 * are shared by the comparer, the clone-run referee and the CLI.
 */

/** Operation name every refusal of the comparer reports. */
export const SCENARIO_BEHAVIOR_OPERATION = "compare-scenario-behavior";

/** The `step_id` of a volatile declaration that applies to every step of its scenario. */
export const EVERY_STEP = "*";

/** Steps with this prefix are the opening fingerprint of the start state. */
export const FINGERPRINT_STEP_PREFIX = "fp-";
/**
 * Steps with this prefix prepare state. They need no citation and may be
 * `unknown` or `unstable`; a `changed` one still blocks, so renaming a failing
 * step cannot hide a difference.
 */
export const SETUP_STEP_PREFIX = "setup-";
/** Step ids REA owns; an authored scenario cannot use the prefix. */
export const RESERVED_STEP_PREFIX = "rea-";
/**
 * The referee's last clone-side step is this prefix followed by the clone
 * tree's SHA-256, so authenticated Evidence names the tree its capture input
 * was rendered for. Present on one side only by design: never compared.
 */
export const CLONE_TREE_STEP_PREFIX = "rea-tree-";
/** The provider's own initial step (`browserScenarioValues.ts`); it is setup. */
const START_STEP_ID = "scenario_start";

export const SCENARIO_STEP_KINDS = [
  "fingerprint",
  "setup",
  "behavior",
  "reserved",
] as const;
export type ScenarioStepKind = (typeof SCENARIO_STEP_KINDS)[number];

/** How a step id takes part: the single interpretation of the id prefixes. */
export const scenarioStepKind = (stepId: string): ScenarioStepKind => {
  if (stepId.startsWith(RESERVED_STEP_PREFIX)) return "reserved";
  if (stepId.startsWith(FINGERPRINT_STEP_PREFIX)) return "fingerprint";
  if (stepId === START_STEP_ID || stepId.startsWith(SETUP_STEP_PREFIX))
    return "setup";
  return "behavior";
};

export const SCENARIO_STEP_STATUSES = [
  "unchanged",
  "changed",
  "unknown",
  "unstable",
] as const;
export type ScenarioStepStatus = (typeof SCENARIO_STEP_STATUSES)[number];

export const SCENARIO_BEHAVIOR_VERDICTS = [
  "unchanged",
  "changed",
  "unknown",
] as const;
export type ScenarioBehaviorVerdict =
  (typeof SCENARIO_BEHAVIOR_VERDICTS)[number];

/** What a finding is about; `step` is the step's own outcome (completed, failed, cancelled). */
export const SCENARIO_BEHAVIOR_DIMENSIONS = [
  "step",
  "request",
  "status",
  "body",
  "page_address",
  "text",
] as const;
export type ScenarioBehaviorDimension =
  (typeof SCENARIO_BEHAVIOR_DIMENSIONS)[number];

/** Resource types whose transactions are compared; every other type is counted as ignored. */
export const COMPARED_RESOURCE_TYPES = ["fetch", "xhr", "document"] as const;

/**
 * Whether a reply with this status carries a body the capture could record.
 * A HEAD reply, 204, 205, 304 and every redirect have none: the browser
 * refuses to read a redirect's body, so its absence is not missing data.
 */
export const replyBodyExpected = (method: string, status: number): boolean =>
  method.toUpperCase() !== "HEAD" &&
  status !== 204 &&
  status !== 205 &&
  !(status >= 300 && status <= 399);

export const SCENARIO_START_STATES = ["clean", "dirty", "unknown"] as const;
export type ScenarioStartState = (typeof SCENARIO_START_STATES)[number];

/**
 * How one side's captures started, from their fingerprints
 * (`ScenarioBehaviorCaptureFacts.fingerprint_sha256`). `dirty`: two recorded
 * fingerprints differ. `clean`: at least two were recorded and all are equal.
 * `unknown` otherwise, so one capture never shows a clean start.
 */
export const scenarioStartState = (
  fingerprints: readonly (string | null)[],
): ScenarioStartState => {
  const recorded = fingerprints.filter(
    (fingerprint): fingerprint is string => fingerprint !== null,
  );
  if (new Set(recorded).size > 1) return "dirty";
  return recorded.length >= 2 ? "clean" : "unknown";
};

/**
 * What is still compared of a reply value whose content is declared
 * volatile: its JSON type, and for a string its layout with every run of
 * ASCII letters and digits folded to `x`. Two timestamps of one format, two
 * UUIDs or two decimal ids share a shape; a timestamp and a number do not.
 */
export const volatileValueShape = (value: JsonValue): string => {
  if (typeof value === "string")
    return `string:${value.replaceAll(/[0-9A-Za-z]+/gu, "x")}`;
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
};

/** Volatile field entries kept per step in a comparison. */
export const STEP_VOLATILE_FIELD_LIMIT = 20;

/** A changed step outranks an unknown or unstable one; missing data never yields `unchanged`. */
export const scenarioBehaviorVerdict = (
  statuses: readonly ScenarioStepStatus[],
): ScenarioBehaviorVerdict => {
  if (statuses.includes("changed")) return "changed";
  return statuses.every((status) => status === "unchanged")
    ? "unchanged"
    : "unknown";
};

/** The `--exit-code` status of a verdict: 0 unchanged, 1 changed, 2 unknown. */
export const scenarioBehaviorExitCode = (
  verdict: ScenarioBehaviorVerdict,
): 0 | 1 | 2 => (verdict === "unchanged" ? 0 : verdict === "changed" ? 1 : 2);

/**
 * Finding categories that say a judgement cannot be made: the step is
 * `unknown`.
 *
 * - `not-recorded`: no capture recorded the data (a lost or oversize body, a
 *   request body that was sent and not recorded, requests the capture itself
 *   reports as omitted).
 * - `single-observation`: the value was recorded, but the left side observed
 *   it once, so it cannot be shown steady or volatile. One more capture of
 *   that side settles it.
 * - `declared-not-shown`: a leaf is declared volatile, the left's repeats
 *   agree at it and the right's value differs with the same shape. Capturing
 *   the left again may show it varying; withdrawing the declaration makes
 *   the difference `changed`.
 * - `not-completed`, `other-origin`: the step or request proves nothing.
 */
const GAP_CATEGORIES: ReadonlySet<string> = new Set([
  "not-recorded",
  "single-observation",
  "declared-not-shown",
  "not-completed",
  "other-origin",
]);
/**
 * The `request` of the `not-recorded` finding that stands for request events
 * the capture itself reports it omitted (its transaction limit). It names no
 * request line: no step's requests are then known to be all the step made,
 * and one more capture of the same scenario omits the same.
 */
export const SCENARIO_OMITTED_REQUESTS = "requests the capture omitted";

/**
 * Finding categories that say one side's repeats disagree: the step is
 * `unstable`. `undeclared-volatile` is a reply leaf the left's repeats
 * disagree on that no declaration names; `repeats-differ` is every other
 * disagreement of one side with itself.
 */
const REPEAT_CATEGORIES: ReadonlySet<string> = new Set([
  "repeats-differ",
  "undeclared-volatile",
]);

/**
 * What one finding makes of its step, read from its category alone: a gap is
 * `unknown`, a disagreement between one side's repeats is `unstable`, and
 * every other category is a difference between the sides.
 */
export const scenarioFindingStatus = (finding: {
  readonly category: string;
}): Exclude<ScenarioStepStatus, "unchanged"> =>
  GAP_CATEGORIES.has(finding.category)
    ? "unknown"
    : REPEAT_CATEGORIES.has(finding.category)
      ? "unstable"
      : "changed";

const STATUS_RANK: Readonly<Record<ScenarioStepStatus, number>> = {
  changed: 0,
  unstable: 1,
  unknown: 2,
  unchanged: 3,
};

/** A step's status is the worst of its findings: `changed`, then `unstable`, then `unknown`. */
export const scenarioStepStatus = (
  findings: readonly { readonly category: string }[],
): ScenarioStepStatus =>
  findings
    .map(scenarioFindingStatus)
    .reduce<ScenarioStepStatus>(
      (worst, status) =>
        STATUS_RANK[status] < STATUS_RANK[worst] ? status : worst,
      "unchanged",
    );

/** Findings with the most severe first, otherwise in the order found. */
export const orderScenarioFindings = <
  Finding extends { readonly category: string },
>(
  findings: readonly Finding[],
): Finding[] =>
  findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (left, right) =>
        STATUS_RANK[scenarioFindingStatus(left.finding)] -
          STATUS_RANK[scenarioFindingStatus(right.finding)] ||
        left.index - right.index,
    )
    .map(({ finding }) => finding);

/** One scalar or empty container of a JSON value; a number in `path` is an array index. */
export interface JsonLeaf {
  readonly pointer: string;
  readonly path: readonly (string | number)[];
  readonly value: JsonValue;
}

/**
 * Every leaf of a JSON value in document order. Two values are equal exactly
 * when their leaves are equal in pointer, `path` and value: the pointer alone
 * does not tell an array item from an object member named like its index.
 */
export const jsonLeaves = (root: JsonValue): JsonLeaf[] => {
  const leaves: JsonLeaf[] = [];
  const visit = (
    value: JsonValue,
    pointer: string,
    path: readonly (string | number)[],
  ): void => {
    if (value === null || typeof value !== "object") {
      leaves.push({ pointer, path, value });
      return;
    }
    const members: readonly (readonly [string | number, JsonValue])[] =
      Array.isArray(value)
        ? value.map((item, index) => [index, item] as const)
        : Object.entries(value);
    if (members.length === 0) leaves.push({ pointer, path, value });
    for (const [key, member] of members)
      visit(member, `${pointer}/${escapeJsonPointerToken(String(key))}`, [
        ...path,
        key,
      ]);
  };
  visit(root, "", []);
  return leaves;
};

/** A leaf's pointer with every array index replaced by `*`: the declaration that would cover each item. */
export const volatilePointerPattern = (
  path: readonly (string | number)[],
): string =>
  path
    .map((segment) =>
      typeof segment === "number"
        ? "/*"
        : `/${escapeJsonPointerToken(segment)}`,
    )
    .join("");

/**
 * Whether a volatile declaration names this leaf: segment for segment, a `*`
 * standing for one array index. A pointer to a container never matches the
 * leaves beneath it.
 */
export const volatilePointerMatches = (
  declared: string,
  path: readonly (string | number)[],
): boolean => {
  const tokens = jsonPointerTokens(declared);
  return (
    tokens.length === path.length &&
    tokens.every(
      (token, index) =>
        token === String(path[index]) ||
        (token === "*" && typeof path[index] === "number"),
    )
  );
};

/**
 * One reply leaf that is not the same everywhere. `varies` names each side
 * whose own repeats disagree at it (a leaf present in one repeat and absent
 * in another disagrees).
 *
 * - `honoured`: a declaration names the leaf and the left shows it varying:
 *   at the leaf itself, or, for a leaf the left holds in every repeat, at
 *   another leaf of the same pattern (`volatilePointerPattern`), so a list in
 *   varying order is covered at every index. The value is not compared.
 * - `shape`: honoured, the left's values share one shape and a right value
 *   has another or is absent.
 * - `unstable`: the left varies and no declaration names the leaf.
 * - `right-unsteady`: the left holds one value in every repeat, the right's
 *   repeats disagree and one of them equals the left's. The right disagrees
 *   with itself; nothing shows it differs from the left.
 * - `declared-not-shown`: a declaration names the leaf, the left's repeats
 *   agree at it, no leaf of its pattern varies on the left, and every right
 *   value differs from the left's only within its shape.
 * - `single-observation`: as `declared-not-shown`, with one left reply, which
 *   cannot show the leaf steady or volatile.
 * - `changed`: the left holds one value and no right repeat agrees with it,
 *   in none of the cases above.
 */
export interface ReplyLeafJudgement {
  readonly pointer: string;
  readonly path: readonly (string | number)[];
  readonly varies: readonly ("left" | "right")[];
  readonly outcome:
    | "honoured"
    | "shape"
    | "unstable"
    | "right-unsteady"
    | "declared-not-shown"
    | "single-observation"
    | "changed";
  /** A left value and a right value that show the judgement; undefined where the leaf is absent. */
  readonly expected: JsonValue | undefined;
  readonly actual: JsonValue | undefined;
  /** A second left value for a leaf the left varies at. */
  readonly other: JsonValue | undefined;
}

/** Whether two paths walk the same kinds of container: an array index and an object member spelled alike differ. */
const sameContainerKinds = (
  left: readonly (string | number)[],
  right: readonly (string | number)[],
): boolean =>
  left.length === right.length &&
  left.every((segment, index) => typeof segment === typeof right[index]);

const sameLeafValue = (
  left: JsonLeaf | undefined,
  right: JsonLeaf | undefined,
): boolean =>
  left === undefined || right === undefined
    ? left === right
    : sameContainerKinds(left.path, right.path) &&
      equalJsonValues(left.value, right.value);

/**
 * The index of the first right value whose shape differs from the one shape
 * the left's values share, or that is absent; -1 when every right value has
 * that shape or the left's values share none.
 */
const misshapenIndex = (
  leftValues: readonly (JsonLeaf | undefined)[],
  rightValues: readonly (JsonLeaf | undefined)[],
): number => {
  const shapes = new Set(
    leftValues.map((value) =>
      value === undefined ? undefined : volatileValueShape(value.value),
    ),
  );
  const [shape] = shapes;
  return shapes.size === 1 && shape !== undefined
    ? rightValues.findIndex(
        (value) =>
          value === undefined || volatileValueShape(value.value) !== shape,
      )
    : -1;
};

/** One pointer's values across every reply of both sides. */
interface LeafAcrossReplies {
  readonly leaf: JsonLeaf;
  readonly leftValues: readonly (JsonLeaf | undefined)[];
  readonly rightValues: readonly (JsonLeaf | undefined)[];
  readonly leftVaries: boolean;
  readonly rightVaries: boolean;
  /** Index of the first right value that is not the left's first, or -1. */
  readonly contradiction: number;
}

/** Judge a leaf the left holds in one value where a right repeat holds another. */
const judgeSteadyLeaf = (
  across: LeafAcrossReplies,
  facts: {
    readonly declared: boolean;
    /** Whether another leaf of this leaf's pattern varies on the left. */
    readonly patternVaries: boolean;
    readonly singleLeftReply: boolean;
  },
): Pick<ReplyLeafJudgement, "outcome" | "actual"> => {
  const { leftValues, rightValues } = across;
  const first = leftValues[0];
  const contradicting = rightValues[across.contradiction]?.value;
  const misshapen = misshapenIndex(leftValues, rightValues);
  // A leaf the left never holds is not shown to vary by its neighbours: an extra item is a difference.
  if (facts.declared && facts.patternVaries && first !== undefined)
    return misshapen === -1
      ? { outcome: "honoured", actual: contradicting }
      : { outcome: "shape", actual: rightValues[misshapen]?.value };
  if (rightValues.some((value) => sameLeafValue(value, first)))
    return { outcome: "right-unsteady", actual: contradicting };
  if (facts.declared && first !== undefined && misshapen === -1)
    return {
      outcome: facts.singleLeftReply
        ? "single-observation"
        : "declared-not-shown",
      actual: contradicting,
    };
  return { outcome: "changed", actual: contradicting };
};

/**
 * Compare the replies of one transaction exactly, leaf by leaf, across every
 * repeat of both sides. Each argument holds one leaf list per observed reply;
 * with no right reply only the left's own disagreements are judged. Leaves
 * that are equal everywhere are not returned.
 * No normalisation applies: only a value the left holds steadily can be
 * contradicted, and a declaration takes effect only where the left's own
 * repeats show the leaf, or another leaf of its pattern, varying.
 */
export const judgeReplyLeaves = (
  left: readonly (readonly JsonLeaf[])[],
  right: readonly (readonly JsonLeaf[])[],
  declared: (leaf: JsonLeaf) => boolean,
): ReplyLeafJudgement[] => {
  const index = (replies: readonly (readonly JsonLeaf[])[]) =>
    replies.map(
      (leaves) => new Map(leaves.map((leaf) => [leaf.pointer, leaf])),
    );
  const lefts = index(left);
  const rights = index(right);
  const order = new Map<string, JsonLeaf>();
  for (const leaves of [...left, ...right])
    for (const leaf of leaves)
      if (!order.has(leaf.pointer)) order.set(leaf.pointer, leaf);
  const uneven: LeafAcrossReplies[] = [];
  const variedPatterns = new Set<string>();
  for (const [pointer, leaf] of order) {
    const leftValues = lefts.map((reply) => reply.get(pointer));
    const rightValues = rights.map((reply) => reply.get(pointer));
    const first = leftValues[0];
    const leftVaries = leftValues.some((value) => !sameLeafValue(value, first));
    const contradiction = rightValues.findIndex(
      (value) => !sameLeafValue(value, first),
    );
    if (!leftVaries && contradiction === -1) continue;
    if (leftVaries) variedPatterns.add(volatilePointerPattern(leaf.path));
    uneven.push({
      leaf,
      leftValues,
      rightValues,
      leftVaries,
      rightVaries: rightValues.some(
        (value) => !sameLeafValue(value, rightValues[0]),
      ),
      contradiction,
    });
  }
  return uneven.map((across): ReplyLeafJudgement => {
    const { leaf, leftValues, rightValues, leftVaries } = across;
    const first = leftValues[0];
    const base = {
      pointer: leaf.pointer,
      path: leaf.path,
      varies: [
        ...(leftVaries ? (["left"] as const) : []),
        ...(across.rightVaries ? (["right"] as const) : []),
      ],
    };
    if (!leftVaries)
      return {
        ...base,
        expected: first?.value,
        other: undefined,
        ...judgeSteadyLeaf(across, {
          declared: declared(leaf),
          patternVaries: variedPatterns.has(volatilePointerPattern(leaf.path)),
          singleLeftReply: left.length === 1,
        }),
      };
    const leftOther = leftValues.find((value) => !sameLeafValue(value, first));
    const shown = {
      expected: first?.value ?? leftOther?.value,
      actual: rightValues[0]?.value,
      other: first === undefined ? undefined : leftOther?.value,
    };
    if (!declared(leaf)) return { ...base, outcome: "unstable", ...shown };
    const misshapen = misshapenIndex(leftValues, rightValues);
    return misshapen === -1
      ? { ...base, outcome: "honoured", ...shown }
      : {
          ...base,
          outcome: "shape",
          ...shown,
          actual: rightValues[misshapen]?.value,
        };
  });
};

/**
 * Replace every occurrence of each rename's `from`, case-sensitive, in
 * declaration order, each on the result of the one before. `counts[i]` grows
 * by one when rename `i` changed this text.
 */
export const renameScenarioText = (
  text: string,
  renames: readonly ScenarioBehaviorRename[],
  counts: number[],
): string => {
  let renamed = text;
  for (const [index, rename] of renames.entries()) {
    const next = renamed.replaceAll(rename.from, () => rename.to);
    if (next !== renamed) counts[index] = (counts[index] ?? 0) + 1;
    renamed = next;
  }
  return renamed;
};

/** Apply the renames to every string value of a JSON value, never to a field name. */
export const renameScenarioJson = (
  value: JsonValue,
  renames: readonly ScenarioBehaviorRename[],
  counts: number[],
): JsonValue => {
  if (renames.length === 0) return value;
  if (typeof value === "string")
    return renameScenarioText(value, renames, counts);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((item) => renameScenarioJson(item, renames, counts));
  return Object.fromEntries(
    Object.entries(value).map(([key, member]) => [
      key,
      renameScenarioJson(member, renames, counts),
    ]),
  );
};

/**
 * Text the clone replaces by declaration. Applied to the left side's
 * on-screen text, JSON string values and text bodies before comparison: every
 * occurrence, case-sensitive, in declaration order, each on the result of the
 * one before. Never to field names, paths, queries, statuses or addresses.
 */
export const scenarioBehaviorRenameSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string(),
});
export type ScenarioBehaviorRename = z.infer<
  typeof scenarioBehaviorRenameSchema
>;

/**
 * A reply leaf declared to differ between repeats; a `*` segment stands for
 * any one array index. The pointer names a leaf exactly: it never covers the
 * values beneath an object or array, and the whole body (the empty pointer)
 * cannot be declared. The step id `*` (`EVERY_STEP`) names every step of the
 * scenario.
 */
export const scenarioBehaviorVolatileFieldSchema = z.strictObject({
  step_id: z.string().min(1),
  pointer: z
    .string()
    .regex(
      /^(?:\/(?:[^~/]|~0|~1)*)+$/u,
      "Use an RFC 6901 JSON pointer to one field, such as /createdAt or /items/*/id",
    ),
});
export type ScenarioBehaviorVolatileField = z.infer<
  typeof scenarioBehaviorVolatileFieldSchema
>;

const sideSchema = z.enum(["left", "right"]);

/** One observed difference or gap at a step. Values are JSON text cut to 120 characters. */
export const scenarioBehaviorFindingSchema = z.strictObject({
  dimension: z.enum(SCENARIO_BEHAVIOR_DIMENSIONS),
  /**
   * The differ's category, or the comparer's own: `not-recorded`,
   * `single-observation`, `declared-not-shown`, `not-completed`,
   * `other-origin`, `repeats-differ`, `undeclared-volatile`, `missing-step`,
   * `shape`, `value`. `scenarioFindingStatus` reads the step status from it.
   */
  category: z.string().min(1),
  /** Request line and occurrence within the step, such as `POST /api/notes#1`; null for step-level facts. */
  request: z.string().nullable(),
  /**
   * JSON pointer into the reply body; null outside the `body` dimension. A
   * `*` segment stands for every array index: `undeclared-volatile`,
   * `repeats-differ`, `single-observation` and `declared-not-shown` findings
   * name the pattern a declaration would use, once per pattern.
   */
  pointer: z.string().nullable(),
  /** Left value. */
  expected: z.string().nullable(),
  /** Right value. */
  actual: z.string().nullable(),
  /** The side that lacks data or disagrees with itself; null for a cross-side difference. */
  side: sideSchema.nullable(),
});
export type ScenarioBehaviorFinding = z.infer<
  typeof scenarioBehaviorFindingSchema
>;

const comparedSideSchema = z.strictObject({
  origin: z.string().min(1),
  captures: z.array(
    z.strictObject({
      file: z.string().min(1),
      evidence_id: z.string().min(1),
      scenario_sha256: digestSchema.nullable(),
      /** Captures of one side with equal fingerprints started from the same state. */
      fingerprint_sha256: digestSchema.nullable(),
    }),
  ),
  /** `scenarioStartState` of this side's fingerprints. */
  start_state: z.enum(SCENARIO_START_STATES),
  /** Transactions of resource types that are not compared (scripts, styles, images, fonts). */
  ignored_transactions: z.int().min(0),
});

/** The comparer's result: the JSON of `rea compare-scenario-behavior` and of `parity/<scenario>.json`. */
export const scenarioBehaviorComparisonSchema = z.strictObject({
  comparison: z.literal("scenario-behavior"),
  verdict: z.enum(SCENARIO_BEHAVIOR_VERDICTS),
  left: comparedSideSchema,
  right: comparedSideSchema,
  summary: z.strictObject({
    steps: z.int().min(0),
    unchanged: z.int().min(0),
    changed: z.int().min(0),
    unknown: z.int().min(0),
    unstable: z.int().min(0),
  }),
  /** Every left-side step in scenario order; summary detail omits unchanged steps. */
  steps: z.array(
    z.strictObject({
      step_id: z.string().min(1),
      kind: z.enum(SCENARIO_STEP_KINDS),
      status: z.enum(SCENARIO_STEP_STATUSES),
      findings: z.array(scenarioBehaviorFindingSchema),
    }),
  ),
  /**
   * Reply leaves seen to differ between one side's repeats, by pattern; at
   * most `STEP_VOLATILE_FIELD_LIMIT` per step, the rest counted in
   * `limitations`.
   */
  volatile_fields: z.array(
    z.strictObject({
      step_id: z.string().min(1),
      side: sideSchema,
      pointer: z.string(),
      /** Whether a volatile declaration names this pointer at this step. */
      declared: z.boolean(),
      /** Whether that declaration took effect: the values were not compared. */
      honoured: z.boolean(),
    }),
  ),
  /** Each declared rename that changed at least one left value that was compared, with how many. */
  renames_applied: z.array(
    scenarioBehaviorRenameSchema.extend({ values: z.int().min(1) }),
  ),
  limitations: z.array(z.string().min(1)),
});
export type ScenarioBehaviorComparison = z.infer<
  typeof scenarioBehaviorComparisonSchema
>;

const recordedBodySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("json"), value: jsonValueSchema }),
  z.strictObject({ kind: z.literal("text"), text: z.string() }),
  z.strictObject({ kind: z.literal("none") }),
  /** Recorded but left out of the table: binary, or over the table's body limit. */
  z.strictObject({ kind: z.literal("omitted"), reason: z.string().min(1) }),
  /** No capture recorded it; the reply is unknown, not empty. */
  z.strictObject({ kind: z.literal("not-recorded") }),
]);

/** One side's observed behaviour per step, without addresses: `behavior/<scenario>.json`. */
export const scenarioBehaviorTableSchema = z.strictObject({
  table: z.literal("scenario-behavior"),
  captures: z.int().min(1),
  steps: z.array(
    z.strictObject({
      step_id: z.string().min(1),
      kind: z.enum(SCENARIO_STEP_KINDS),
      action: z.string().min(1),
      outcome: z.enum(["completed", "failed", "cancelled"]),
      /** Path, query and fragment after the step; null when not recorded. */
      page_address: z.string().nullable(),
      /** Accessibility text after the step; null when not recorded. */
      text: z.string().nullable(),
      transactions: z.array(
        z.strictObject({
          request: z.string().min(1),
          request_body: recordedBodySchema,
          status: z.int().nullable(),
          reply: recordedBodySchema,
        }),
      ),
      /** Reply pointers whose values differed between the captures. */
      volatile_pointers: z.array(z.string()),
    }),
  ),
});
export type ScenarioBehaviorTable = z.infer<typeof scenarioBehaviorTableSchema>;

/**
 * What an admitting caller reads from one authenticated capture. Every member
 * comes from the Evidence record REA authenticated, never from the file name.
 */
export interface ScenarioBehaviorCaptureFacts {
  /** Path the capture was read from, as the caller spelled it. */
  readonly file: string;
  readonly evidence_id: string;
  /** `normalized_result.scenario.start_origin`: the origin the browser started at. */
  readonly start_origin: string;
  /** `parameters.scenario_sha256`: REA's digest of the scenario it ran. */
  readonly scenario_sha256: string | null;
  /** `parameters.start_url.url` and the ids of `parameters.actions`, in order. */
  readonly definition: {
    readonly start_url: string;
    readonly step_ids: readonly string[];
  };
  /** `normalized_result.steps`, in order, including `scenario_start`. */
  readonly steps: readonly {
    readonly step_id: string;
    readonly outcome: "completed" | "failed" | "cancelled";
  }[];
  /**
   * Digest of everything the `fp-` steps observed, in every compared
   * dimension, without the address. A `request` step observes its reply, not
   * the page behind it, so its on-screen text is left out. Null when the
   * capture has no `fp-` step, one did not complete, or one lacks an
   * observation (no response, a body that was expected and not recorded, a
   * request body or requests the capture did not record, text or page address
   * not recorded).
   */
  readonly fingerprint_sha256: string | null;
  /**
   * Every reply body the capture recorded from its start origin, whatever the
   * resource type: the original's own served files, for the clean-room check.
   */
  readonly reply_bodies: readonly {
    /** Request line, such as `GET /app.js`. */
    readonly request: string;
    readonly sha256: string;
    readonly bytes: number;
  }[];
}

/** One comparison: at least one capture per side, with the declarations that apply. */
export interface ScenarioBehaviorComparisonRequest<
  Capture extends ScenarioBehaviorCaptureFacts,
> {
  readonly left: readonly Capture[];
  readonly right: readonly Capture[];
  readonly renames: readonly ScenarioBehaviorRename[];
  readonly volatile_fields: readonly ScenarioBehaviorVolatileField[];
}

/**
 * The comparer as its consumers depend on it. The clone-run referee takes
 * this as an injected dependency, so its tests supply a fake with captures of
 * their own shape.
 */
export interface ScenarioBehaviorComparer<
  Capture extends ScenarioBehaviorCaptureFacts,
> {
  /** Read and authenticate one capture Evidence file (record or bundle). */
  readonly readCapture: (
    file: string,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<Result<Capture, AnalysisError>>;
  /**
   * Compare the two sides; complete detail, every left-side step. Refused
   * when a side is empty or its captures do not list the same step ids in the
   * same order.
   */
  readonly compare: (
    request: ScenarioBehaviorComparisonRequest<Capture>,
  ) => Result<ScenarioBehaviorComparison, AnalysisError>;
  /** One side's behaviour table from its captures. */
  readonly describe: (captures: readonly Capture[]) => ScenarioBehaviorTable;
}
