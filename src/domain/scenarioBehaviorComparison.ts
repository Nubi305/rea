import { z } from "zod";

import type { AnalysisError } from "./analysisErrorBase.js";
import { digestSchema } from "./digests.js";
import { jsonValueSchema, type JsonValue } from "./jsonValue.js";
import type { Result } from "./result.js";

/**
 * Behaviour parity of one browser scenario captured against two addresses.
 * Contract: docs/specs/reconstruction/clone-runs/spec.md. The exported names
 * are shared by the comparer, the clone-run referee and the CLI.
 */

/** Operation name every refusal of the comparer reports. */
export const SCENARIO_BEHAVIOR_OPERATION = "compare-scenario-behavior";

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
 * cannot be declared.
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
   * `not-completed`, `missing-step`, `other-origin`, `repeats-differ`,
   * `undeclared-volatile`, `shape`.
   */
  category: z.string().min(1),
  /** Request line and occurrence within the step, such as `POST /api/notes#1`; null for step-level facts. */
  request: z.string().nullable(),
  /** JSON pointer into the reply body; null outside the `body` dimension. */
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
  /** Reply leaves seen to differ between one side's repeats, with whether a declaration covers them. */
  volatile_fields: z.array(
    z.strictObject({
      step_id: z.string().min(1),
      side: sideSchema,
      pointer: z.string(),
      declared: z.boolean(),
    }),
  ),
  /** Each declared rename that changed at least one compared left value, with how many. */
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
   * dimension, without the address. Null when the capture has no `fp-` step,
   * one did not complete, or one lacks an observation (no response, a body
   * that was expected and not recorded, text or page address not recorded).
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
