import { ellipsisExcerpt } from "../../domain/excerpt.js";
import { parseExactJson } from "../../domain/exactJsonNumber.js";
import { jsonPointerTokens } from "../../domain/jsonPointer.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import {
  jsonLeaves,
  judgeReplyLeaves,
  volatilePointerPattern,
  type JsonContainerKind,
  type JsonLeaf,
  type ReplyLeafJudgement,
  type ScenarioBehaviorComparison,
  type ScenarioBehaviorDimension,
  type ScenarioBehaviorFinding,
} from "../../domain/scenarioBehaviorComparison.js";
import {
  compareAnswers,
  type Difference,
} from "../environment/environmentCompareDiff.js";
import { IdMap } from "../environment/environmentCompareIds.js";
import type { RecordedBody } from "./scenarioBehaviorCapture.js";

/**
 * Reply body comparison of one matched transaction.
 * Contract: docs/specs/reconstruction/clone-runs/spec.md, "The comparer".
 *
 * `judgeReplyLeaves` decides, exactly and by position, which leaves differ
 * and what each difference is. `compareAnswers` is the differ that names a
 * difference between two bodies. Two of its behaviours must not leak into a
 * verdict (each was observed on real captures): it treats clocks of one
 * format as equal, so a leaf it does not name is still a difference when the
 * left holds it steadily; and it pairs the items of two lists by a key it
 * infers, which for lists of one length reports a `length` or `order` of the
 * whole list where single values differ, so those are named by position here.
 */

export type Side = "left" | "right";

type VolatileField = ScenarioBehaviorComparison["volatile_fields"][number];

/** What the comparison of one step collects. */
export interface StepContext {
  readonly findings: ScenarioBehaviorFinding[];
  /** Record one reply pattern seen to differ between a side's repeats; repeats of an entry are ignored. */
  readonly volatile: (field: Omit<VolatileField, "step_id">) => void;
  /** Whether a volatile declaration names this reply leaf at this step. */
  readonly declared: (path: readonly (string | number)[]) => boolean;
  /** Whether declarations take effect at this step: never at a fingerprint step. */
  readonly declarationsApply: boolean;
  /**
   * Record a list pattern with a position where the left's repeats agree and
   * a right repeat differs, while the pattern is declared volatile there or
   * varies on the left at another position: a list in varying order reads so.
   */
  readonly steadyListPosition: (pattern: string) => void;
}

const VALUE_CHARS = 120;

export const shown = (value: JsonValue | undefined): string =>
  value === undefined
    ? "<absent>"
    : ellipsisExcerpt(JSON.stringify(value), VALUE_CHARS);

export const finding = (
  dimension: ScenarioBehaviorDimension,
  category: string,
  rest: Partial<Omit<ScenarioBehaviorFinding, "dimension" | "category">> = {},
): ScenarioBehaviorFinding => ({
  dimension,
  category,
  request: null,
  pointer: null,
  expected: null,
  actual: null,
  side: null,
  ...rest,
});

/** Both values of a side that disagrees with itself, in that side's member. */
export const sideValues = (
  side: Side,
  text: string,
): Pick<ScenarioBehaviorFinding, "expected" | "actual" | "side"> =>
  side === "left"
    ? { expected: text, actual: null, side }
    : { expected: null, actual: text, side };

/** A whole body as leaves; a body that is not JSON is one leaf no JSON leaf can equal. */
export const bodyLeaves = (body: RecordedBody): readonly JsonLeaf[] => {
  if (body.kind === "json") return jsonLeaves(body.value);
  const value: JsonValue =
    body.kind === "text"
      ? { "text body": body.text }
      : body.kind === "base64"
        ? { "binary body": body.encoded }
        : { "no body": true };
  return [{ pointer: "", path: [], value }];
};

/** A text body whose whole text is one JSON object or array, as that JSON; anything else unchanged. */
const textAsJson = (body: RecordedBody): RecordedBody => {
  if (body.kind !== "text") return body;
  const start = body.text.trimStart()[0];
  if (start !== "{" && start !== "[") return body;
  const value = parseExactJson(body.text);
  return value === undefined || value === null || typeof value !== "object"
    ? body
    : { kind: "json", value };
};

/**
 * Read text replies as JSON when every reply of both sides is JSON: a body
 * served under a text media type that is a JSON object or array on both sides
 * differs by its values, not by key order or spacing. One reply that is not
 * JSON leaves every text reply text, so text is never matched against JSON.
 */
export const repliesAsJson = (
  left: readonly RecordedBody[],
  right: readonly RecordedBody[],
): { left: readonly RecordedBody[]; right: readonly RecordedBody[] } => {
  const all = [...left, ...right];
  if (!all.some((body) => body.kind === "text")) return { left, right };
  const read = { left: left.map(textAsJson), right: right.map(textAsJson) };
  return [...read.left, ...read.right].every((body) => body.kind === "json")
    ? read
    : { left, right };
};

/** Whether a differ difference at `outer` is about the leaf at `pointer`. */
const covers = (outer: string, pointer: string): boolean =>
  outer === "" || pointer === outer || pointer.startsWith(`${outer}/`);

const isEmptyContainer = (value: JsonValue | undefined): boolean =>
  value !== undefined &&
  value !== null &&
  typeof value === "object" &&
  Object.keys(value).length === 0;

/** The value a JSON pointer names in a body, or undefined when the body is not JSON or holds none. */
const valueAt = (
  body: RecordedBody,
  pointer: string,
): JsonValue | undefined => {
  if (body.kind !== "json") return undefined;
  let value: JsonValue | undefined = body.value;
  for (const token of jsonPointerTokens(pointer)) {
    if (value === null || typeof value !== "object") return undefined;
    value = Array.isArray(value)
      ? /^(?:0|[1-9]\d*)$/u.test(token)
        ? value[Number(token)]
        : undefined
      : Object.hasOwn(value, token)
        ? value[token]
        : undefined;
  }
  return value;
};

/** The first container of `kind` that `pointer` names in the bodies. */
const containerAt = (
  bodies: readonly RecordedBody[],
  pointer: string,
  kind: JsonContainerKind,
): JsonValue | undefined =>
  bodies
    .map((body) => valueAt(body, pointer))
    .find(
      (value) =>
        value !== undefined &&
        value !== null &&
        typeof value === "object" &&
        Array.isArray(value) === (kind === "array"),
    );

/**
 * The lists of one length the differ compared by an inferred pairing: it
 * reported their `length` (not every item paired) or `order`. Their items are
 * compared by position instead.
 */
const positionalLists = (
  differences: readonly Difference[],
  left: RecordedBody,
  right: RecordedBody,
): string[] =>
  differences
    .filter(({ category, pointer }) => {
      if (category !== "length" && category !== "order") return false;
      const leftList = valueAt(left, pointer);
      const rightList = valueAt(right, pointer);
      return (
        Array.isArray(leftList) &&
        Array.isArray(rightList) &&
        leftList.length === rightList.length
      );
    })
    .map(({ pointer }) => pointer);

/**
 * Whether the differ treats the two values of a leaf as equal when asked
 * about that leaf alone under its own field name (two clocks of one format).
 */
const differNormalises = (judgement: ReplyLeafJudgement): boolean => {
  if (judgement.expected === undefined || judgement.actual === undefined)
    return false;
  const field =
    judgement.path.findLast(
      (segment): segment is string => typeof segment === "string",
    ) ?? "value";
  return (
    compareAnswers(
      {
        status: 0,
        body: { kind: "json", value: { [field]: judgement.expected } },
      },
      {
        status: 0,
        body: { kind: "json", value: { [field]: judgement.actual } },
      },
      new IdMap(),
    ).differences.length === 0
  );
};

/**
 * Name every leaf the left holds steadily and the right contradicts: with the
 * differ's own category where it reports the difference, by position
 * otherwise. A leaf the differ treats as equal is still a difference when the
 * left observed it more than once; one observation cannot show it steady.
 * Returns the pointers of the leaves reported as differences.
 */
const nameChangedLeaves = (
  context: StepContext,
  request: string,
  replies: {
    readonly left: readonly RecordedBody[];
    readonly right: readonly RecordedBody[];
  },
  changed: readonly ReplyLeafJudgement[],
): ReadonlySet<string> => {
  const leftBody = replies.left[0];
  const named = new Set<string>();
  if (leftBody === undefined || changed.length === 0) return named;
  const reported = new Set<string>();
  const positional = new Set<string>();
  for (const rightBody of replies.right) {
    // Statuses are compared in their own dimension.
    const { differences } = compareAnswers(
      { status: 0, body: leftBody },
      { status: 0, body: rightBody },
      new IdMap(),
    );
    const lists = positionalLists(differences, leftBody, rightBody);
    for (const list of lists) positional.add(list);
    for (const difference of differences) {
      if (lists.some((list) => covers(list, difference.pointer))) continue;
      const about = changed.filter(
        (judgement) =>
          covers(difference.pointer, judgement.pointer) ||
          // An empty or absent container is one leaf; what the other side holds inside it is named beneath it.
          ((judgement.expected === undefined ||
            judgement.actual === undefined ||
            isEmptyContainer(judgement.expected) ||
            isEmptyContainer(judgement.actual)) &&
            covers(judgement.pointer, difference.pointer)),
      );
      // What the left's repeats disagree on is unstable or honoured, never a difference.
      if (about.length === 0) continue;
      for (const judgement of about) named.add(judgement.pointer);
      const key = `${difference.category}\n${difference.pointer}`;
      if (reported.has(key)) continue;
      reported.add(key);
      context.findings.push(
        finding("body", difference.category, {
          request,
          pointer: difference.pointer,
          expected: difference.live ?? null,
          actual: difference.env ?? null,
        }),
      );
    }
  }
  const single = replies.left.length === 1;
  const patterns = new Set<string>();
  for (const judgement of changed) {
    if (named.has(judgement.pointer)) continue;
    const values = {
      request,
      expected: shown(judgement.expected),
      actual: shown(judgement.actual),
    };
    // Outside a list compared by position, an unnamed leaf is one the differ treated as equal.
    const normalised = [...positional].some(
      (list) => list !== judgement.pointer && covers(list, judgement.pointer),
    )
      ? differNormalises(judgement)
      : true;
    if (!single || !normalised) {
      named.add(judgement.pointer);
      context.findings.push(
        finding("body", "value", { ...values, pointer: judgement.pointer }),
      );
      continue;
    }
    // One left reply cannot show the value steady, so the differ's doubt stands: once per pattern.
    const pattern = volatilePointerPattern(judgement.path);
    if (patterns.has(pattern)) continue;
    patterns.add(pattern);
    context.findings.push(
      finding("body", "single-observation", {
        ...values,
        pointer: pattern,
        side: "left",
      }),
    );
  }
  return named;
};

/**
 * Compare the reply bodies of one matched transaction: exactly by leaf, with
 * the differ naming what it sees. A container that is a list in one reply and
 * an object in another is told at the container, whatever it holds and
 * whatever is declared there.
 */
export const compareReplies = (
  context: StepContext,
  request: string,
  left: readonly RecordedBody[],
  right: readonly RecordedBody[],
): void => {
  const replies = repliesAsJson(left, right);
  const judgements = judgeReplyLeaves(
    replies.left.map(bodyLeaves),
    replies.right.map(bodyLeaves),
    (leaf) => context.declarationsApply && context.declared(leaf.path),
  );
  // One finding per declarable pattern, so a list of varying items is one line of work.
  const patterns = new Set<string>();
  const once = (
    category: string,
    pattern: string,
    values: Partial<ScenarioBehaviorFinding>,
  ): void => {
    const key = `${category}\n${values.side ?? ""}\n${pattern}`;
    if (patterns.has(key)) return;
    patterns.add(key);
    context.findings.push(
      finding("body", category, { request, pointer: pattern, ...values }),
    );
  };
  const leftVaried = new Set(
    judgements
      .filter(({ varies }) => varies.includes("left"))
      .map(({ path }) => volatilePointerPattern(path)),
  );
  /** Whether a leaf lies in a list whose items are declared volatile there or differ between the left's repeats at another position. */
  const inVaryingList = (judgement: ReplyLeafJudgement): boolean => {
    const pattern = volatilePointerPattern(judgement.path);
    return (
      pattern !== judgement.pointer &&
      (leftVaried.has(pattern) ||
        (context.declarationsApply && context.declared(judgement.path)))
    );
  };
  for (const judgement of judgements) {
    const pattern = volatilePointerPattern(judgement.path);
    const { outcome, kinds } = judgement;
    // A container that is a list in one reply and an object in another is told once, for all it holds.
    if (kinds !== undefined) {
      const held = (side: Side, kind: JsonContainerKind): string =>
        shown(containerAt(replies[side], kinds.pointer, kind));
      if (outcome === "changed")
        once("value", kinds.pointer, {
          expected: held("left", kinds.expected),
          actual: held("right", kinds.actual),
        });
      else {
        const side: Side = outcome === "left-unsteady" ? "left" : "right";
        once(
          "repeats-differ",
          kinds.pointer,
          sideValues(
            side,
            `${held(side, kinds.expected)} | ${held(side, kinds.actual)}`,
          ),
        );
      }
      continue;
    }
    for (const side of judgement.varies)
      context.volatile({
        side,
        pointer: pattern,
        declared: context.declared(judgement.path),
        honoured: outcome === "honoured" || outcome === "shape",
      });
    const expected = shown(judgement.expected);
    const actual = shown(judgement.actual);
    if (outcome === "shape")
      context.findings.push(
        finding("body", "shape", {
          request,
          pointer: judgement.pointer,
          expected,
          actual,
        }),
      );
    else if (outcome === "unstable")
      once(
        "undeclared-volatile",
        pattern,
        sideValues("left", `${expected} | ${shown(judgement.other)}`),
      );
    else if (
      outcome === "declared-not-shown" ||
      outcome === "single-observation"
    )
      once(outcome, pattern, { expected, actual, side: "left" });
    else if (outcome === "right-unsteady")
      once(
        "repeats-differ",
        pattern,
        sideValues("right", `${expected} | ${actual}`),
      );
    if (
      (outcome === "declared-not-shown" || outcome === "right-unsteady") &&
      inVaryingList(judgement)
    )
      context.steadyListPosition(pattern);
  }
  const changed = judgements.filter(
    ({ outcome, kinds }) => outcome === "changed" && kinds === undefined,
  );
  const differences = nameChangedLeaves(context, request, replies, changed);
  for (const judgement of changed) {
    const pattern = volatilePointerPattern(judgement.path);
    // A right side that is a difference and also disagrees with itself is told so; one the left cannot yet judge is not.
    if (
      judgement.varies.includes("right") &&
      differences.has(judgement.pointer)
    )
      once(
        "repeats-differ",
        pattern,
        sideValues("right", shown(judgement.actual)),
      );
    // Both sides hold the leaf: an item the left never holds is not a matter of order.
    if (
      inVaryingList(judgement) &&
      judgement.expected !== undefined &&
      judgement.actual !== undefined
    )
      context.steadyListPosition(pattern);
  }
};
