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
 * Steps with this prefix prepare state and need no citation. They are
 * compared like any other step. Which of their findings block a clone run is
 * the referee's rule (`CLONE_RUN_PREPARED_STEP_GATES`): every finding in
 * which the left is steady and the right differs does, so neither renaming a
 * failing step nor declaring its field volatile hides a difference.
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
/**
 * Findings kept per step in a comparison: the most severe are listed and the
 * rest are counted in `limitations`. A step that lists this many may have had
 * more, which is what the clone-run referee reads the limit for.
 */
export const STEP_FINDING_LIMIT = 20;

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
 *   the difference `changed`. A `*` declaration is judged position by
 *   position, so a list whose order varies between captures reads so at every
 *   position where the left's captures happen to agree: such a list has to be
 *   requested in a fixed order.
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
 * standing for one array index and never for an object member, whatever its
 * spelling (a member that is itself spelled `*` is named like any other). A
 * pointer to a container never matches the leaves beneath it.
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

/** The kind of container an array index or an object member lies in. */
export type JsonContainerKind = "array" | "object";

/**
 * A container that is a list in one reply and an object in another: its
 * pointer, the kind the left's first reply holds (`expected`) and the other.
 */
export interface ContainerKindDifference {
  readonly pointer: string;
  readonly expected: JsonContainerKind;
  readonly actual: JsonContainerKind;
}

/**
 * One reply leaf, or one container, that is not the same everywhere. `varies`
 * names each side whose own repeats disagree at it (a leaf present in one
 * repeat and absent in another disagrees).
 *
 * The kind of every container is compared first, for every reply of both
 * sides and before any declaration is consulted: of each container on the way
 * to a leaf and of each empty one. Such a judgement carries `kinds`, names
 * the outermost container that differs, and stands for everything at and
 * beneath it, so no declaration there covers a list answered as an object:
 *
 * - `left-unsteady`: the left's own repeats hold the container as a list and
 *   as an object.
 * - `changed`: the left's repeats agree on its kind and no right repeat that
 *   holds it agrees with them.
 * - `right-unsteady`: some right repeats agree with the left's kind and
 *   others do not.
 *
 * Every other judgement is about one leaf:
 *
 * - `honoured`: a declaration names the leaf and the left's own repeats
 *   differ at this very leaf. The value is not compared. A `*` in the
 *   declaration is honoured index by index: an index the left holds steady is
 *   not covered because another index varies.
 * - `shape`: honoured, and a right value is outside what the left's own
 *   values share: the leaf's presence, its JSON type, a string's layout.
 * - `unstable`: the left varies and no declaration names the leaf.
 * - `right-unsteady`: the left holds one value in every repeat, the right's
 *   repeats disagree and one of them equals the left's. The right disagrees
 *   with itself; nothing shows it differs from the left.
 * - `declared-not-shown`: a declaration names the leaf, the left's repeats
 *   agree at it, and every right value differs from the left's only within
 *   its shape.
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
    | "left-unsteady"
    | "right-unsteady"
    | "declared-not-shown"
    | "single-observation"
    | "changed";
  /** A left value and a right value that show the judgement; undefined where the leaf is absent, and for a container. */
  readonly expected: JsonValue | undefined;
  readonly actual: JsonValue | undefined;
  /** A second left value for a leaf the left varies at. */
  readonly other: JsonValue | undefined;
  /** Set when the judgement is about the kind of the container at `pointer`, not about a leaf's value. */
  readonly kinds?: ContainerKindDifference;
}

const containerKind = (segment: string | number): JsonContainerKind =>
  typeof segment === "number" ? "array" : "object";

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

/** The JSON type of a value: what stays comparable of values that share no layout. */
const volatileValueType = (value: JsonValue): string =>
  typeof value === "string" ? "string" : volatileValueShape(value);

/**
 * The index of the first right value that is outside what the left's own
 * values of a leaf share, or -1. Three things are compared, each only as far
 * as the left's repeats agree on it:
 *
 * - presence: where every left repeat holds the leaf, a right repeat without
 *   it is outside;
 * - shape: where the left's values share one `volatileValueShape`, a right
 *   value of another is outside;
 * - type: where they do not, a right value of a JSON type no left value has
 *   is outside, so `null` or a text on the left never covers a number.
 */
const misshapenIndex = (
  leftValues: readonly (JsonLeaf | undefined)[],
  rightValues: readonly (JsonLeaf | undefined)[],
): number => {
  const held = leftValues.flatMap((leaf) =>
    leaf === undefined ? [] : [leaf.value],
  );
  const shapes = new Set(held.map(volatileValueShape));
  const types = new Set(held.map(volatileValueType));
  return rightValues.findIndex((leaf) =>
    leaf === undefined
      ? held.length === leftValues.length
      : shapes.size === 1
        ? !shapes.has(volatileValueShape(leaf.value))
        : !types.has(volatileValueType(leaf.value)),
  );
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

type LeafVerdict = Pick<
  ReplyLeafJudgement,
  "outcome" | "expected" | "actual" | "other"
>;

interface ReplyContainer {
  readonly kind: JsonContainerKind;
  readonly path: readonly (string | number)[];
}

/**
 * Every container of one reply by pointer, outer before inner: each one on
 * the way to a leaf, whose kind the next path segment tells, and each leaf
 * that is itself an empty list or object.
 */
const replyContainers = (
  leaves: readonly JsonLeaf[],
): ReadonlyMap<string, ReplyContainer> => {
  const containers = new Map<string, ReplyContainer>();
  for (const leaf of leaves) {
    let pointer = "";
    for (const [index, segment] of leaf.path.entries()) {
      if (!containers.has(pointer))
        containers.set(pointer, {
          kind: containerKind(segment),
          path: leaf.path.slice(0, index),
        });
      pointer += `/${escapeJsonPointerToken(String(segment))}`;
    }
    const { value } = leaf;
    if (
      value !== null &&
      typeof value === "object" &&
      Object.keys(value).length === 0
    )
      containers.set(pointer, {
        kind: Array.isArray(value) ? "array" : "object",
        path: leaf.path,
      });
  }
  return containers;
};

/** Whether `pointer` names the container at `container` or something beneath it. */
const atOrBeneath = (container: string, pointer: string): boolean =>
  container === "" ||
  pointer === container ||
  pointer.startsWith(`${container}/`);

/**
 * Judge the kind of every container the left holds across every reply that
 * holds it: one judgement for the outermost container that is not of one
 * kind everywhere. No declaration is read.
 */
const judgeContainerKinds = (
  left: readonly (readonly JsonLeaf[])[],
  right: readonly (readonly JsonLeaf[])[],
): ReplyLeafJudgement[] => {
  const lefts = left.map(replyContainers);
  const rights = right.map(replyContainers);
  const kindsAt = (
    replies: readonly ReadonlyMap<string, ReplyContainer>[],
    pointer: string,
  ): JsonContainerKind[] =>
    replies.flatMap((reply) => {
      const container = reply.get(pointer);
      return container === undefined ? [] : [container.kind];
    });
  const order = new Map<string, ReplyContainer>();
  for (const reply of lefts)
    for (const [pointer, container] of reply)
      if (!order.has(pointer)) order.set(pointer, container);
  const judged: ReplyLeafJudgement[] = [];
  for (const [pointer, { kind: expected, path }] of order) {
    // An outer container is listed before the ones inside it, which it stands for.
    if (judged.some((outer) => atOrBeneath(outer.pointer, pointer))) continue;
    const leftOther = kindsAt(lefts, pointer).find((kind) => kind !== expected);
    const rightKinds = kindsAt(rights, pointer);
    const rightOther = rightKinds.find((kind) => kind !== expected);
    const actual = leftOther ?? rightOther;
    if (actual === undefined) continue;
    const outcome =
      leftOther !== undefined
        ? "left-unsteady"
        : rightKinds.includes(expected)
          ? "right-unsteady"
          : "changed";
    judged.push({
      pointer,
      path,
      varies:
        outcome === "changed"
          ? []
          : [outcome === "left-unsteady" ? "left" : "right"],
      outcome,
      expected: undefined,
      actual: undefined,
      other: undefined,
      kinds: { pointer, expected, actual },
    });
  }
  return judged;
};

/** Judge a leaf the left holds in one value where a right repeat holds another. */
const judgeSteadyLeaf = (
  across: LeafAcrossReplies,
  facts: { readonly declared: boolean; readonly singleLeftReply: boolean },
): Pick<ReplyLeafJudgement, "outcome" | "actual"> => {
  const { leftValues, rightValues } = across;
  const first = leftValues[0];
  const contradicting = rightValues[across.contradiction]?.value;
  if (rightValues.some((value) => sameLeafValue(value, first)))
    return { outcome: "right-unsteady", actual: contradicting };
  // A leaf the left never holds, or one the right holds in another shape or not at all, is a difference whatever is declared.
  if (
    facts.declared &&
    first !== undefined &&
    misshapenIndex(leftValues, rightValues) === -1
  )
    return {
      outcome: facts.singleLeftReply
        ? "single-observation"
        : "declared-not-shown",
      actual: contradicting,
    };
  return { outcome: "changed", actual: contradicting };
};

/** Judge a leaf that lies under no container of differing kinds. */
const judgeLeafValues = (
  across: LeafAcrossReplies,
  facts: { readonly declared: boolean; readonly singleLeftReply: boolean },
): LeafVerdict => {
  const { leftValues, rightValues } = across;
  const first = leftValues[0];
  if (!across.leftVaries)
    return {
      expected: first?.value,
      other: undefined,
      ...judgeSteadyLeaf(across, facts),
    };
  const leftOther = leftValues.find((value) => !sameLeafValue(value, first));
  const shown = {
    expected: first?.value ?? leftOther?.value,
    actual: rightValues[0]?.value,
    other: first === undefined ? undefined : leftOther?.value,
  };
  if (!facts.declared) return { outcome: "unstable", ...shown };
  const misshapen = misshapenIndex(leftValues, rightValues);
  return misshapen === -1
    ? { outcome: "honoured", ...shown }
    : { outcome: "shape", ...shown, actual: rightValues[misshapen]?.value };
};

/**
 * Compare the replies of one transaction exactly, across every repeat of both
 * sides: first the kind of every container, then every leaf that lies under
 * no container of differing kinds. Each argument holds one leaf list per
 * observed reply; with no right reply only the left's own disagreements are
 * judged. What is equal everywhere is not returned.
 * No normalisation applies: only a value the left holds steadily can be
 * contradicted, and a declaration takes effect only at a leaf the left's own
 * repeats show varying, never at another leaf of its pattern and never where
 * a list is answered as an object.
 */
export const judgeReplyLeaves = (
  left: readonly (readonly JsonLeaf[])[],
  right: readonly (readonly JsonLeaf[])[],
  declared: (leaf: JsonLeaf) => boolean,
): ReplyLeafJudgement[] => {
  const recast = judgeContainerKinds(left, right);
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
  const judgements: ReplyLeafJudgement[] = [...recast];
  for (const [pointer, leaf] of order) {
    if (recast.some((container) => atOrBeneath(container.pointer, pointer)))
      continue;
    const leftValues = lefts.map((reply) => reply.get(pointer));
    const rightValues = rights.map((reply) => reply.get(pointer));
    const first = leftValues[0];
    const leftVaries = leftValues.some((value) => !sameLeafValue(value, first));
    const contradiction = rightValues.findIndex(
      (value) => !sameLeafValue(value, first),
    );
    if (!leftVaries && contradiction === -1) continue;
    const rightVaries = rightValues.some(
      (value) => !sameLeafValue(value, rightValues[0]),
    );
    judgements.push({
      pointer,
      path: leaf.path,
      varies: [
        ...(leftVaries ? (["left"] as const) : []),
        ...(rightVaries ? (["right"] as const) : []),
      ],
      ...judgeLeafValues(
        {
          leaf,
          leftValues,
          rightValues,
          leftVaries,
          rightVaries,
          contradiction,
        },
        { declared: declared(leaf), singleLeftReply: left.length === 1 },
      ),
    });
  }
  return judgements;
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

/**
 * Text the clone replaces by declaration. Applied to the left side's
 * on-screen text, JSON string values and text bodies before comparison, after
 * the left's own address was read as the right's: every occurrence,
 * case-sensitive, in declaration order, each on the result of the one before.
 * Never to field names, paths, queries, statuses or page addresses.
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
 * scenario. Either `*` only says where the declaration may apply: it takes
 * effect at each step and each index where the left's own repeats differ.
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
   * name the pattern a declaration would use, once per pattern. A `value` or
   * `repeats-differ` finding about a container that is a list in one reply
   * and an object in another names that container and shows both.
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
  /**
   * The left side's own address read as the right side's, which needs no
   * declaration: each replaced form (the left's start origin, then its bare
   * `host:port`) that changed at least one left value that was compared, with
   * how many. Left out when none did: both sides started at one address, or
   * the left's application never prints its own.
   */
  addresses_applied: z
    .array(
      z.strictObject({
        from: z.string().min(1),
        to: z.string().min(1),
        values: z.int().min(1),
      }),
    )
    .min(1)
    .optional(),
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

/**
 * One side's observed behaviour per step: `behavior/<scenario>.json`. A page
 * address is relative to the side's origin; texts and bodies are as the
 * application gave them, its own address included where it prints it.
 */
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
   * dimension, with page addresses and request lines relative to the start
   * origin and every text and body as the application gave it: equal for
   * equal start states of one address. A `request` step observes its reply,
   * not the page behind it, so its on-screen text is left out. Null when the
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
