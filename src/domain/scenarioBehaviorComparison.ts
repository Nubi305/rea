import { z } from "zod";

import type { AnalysisError } from "./analysisErrorBase.js";
import { digestSchema } from "./digests.js";
import { jsonValueSchema } from "./jsonValue.js";
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
/** Steps with this prefix prepare state; they are compared and reported, never gated. */
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

/** Text the clone replaces by declaration: applied to the left side's on-screen text and JSON string values. */
export const scenarioBehaviorRenameSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string(),
});
export type ScenarioBehaviorRename = z.infer<
  typeof scenarioBehaviorRenameSchema
>;

/** A reply field declared to differ between repeats; `*` stands for any array index. */
export const scenarioBehaviorVolatileFieldSchema = z.strictObject({
  step_id: z.string().min(1),
  pointer: z
    .string()
    .regex(/^(?:\/(?:[^~/]|~0|~1)*)*$/u, "Use an RFC 6901 JSON pointer"),
});
export type ScenarioBehaviorVolatileField = z.infer<
  typeof scenarioBehaviorVolatileFieldSchema
>;

const sideSchema = z.enum(["left", "right"]);

/** One observed difference or gap at a step. Values are JSON text cut to 120 characters. */
export const scenarioBehaviorFindingSchema = z.strictObject({
  dimension: z.enum(SCENARIO_BEHAVIOR_DIMENSIONS),
  /** The differ's category, or the comparer's own: `not-recorded`, `not-completed`, `repeats-differ`, `undeclared-volatile`, `format`. */
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
    }),
  ),
  /** Whether the `fp-` steps agree exactly across this side's captures. */
  start_state: z.enum(["clean", "dirty", "single-capture", "no-fingerprint"]),
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
  /** Reply fields seen to differ between one side's repeats, with whether a declaration covers them. */
  volatile_fields: z.array(
    z.strictObject({
      step_id: z.string().min(1),
      side: sideSchema,
      pointer: z.string(),
      declared: z.boolean(),
    }),
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
  /** Compare the two sides; complete detail, every left-side step. */
  readonly compare: (
    request: ScenarioBehaviorComparisonRequest<Capture>,
  ) => ScenarioBehaviorComparison;
  /** One side's behaviour table from its captures. */
  readonly describe: (captures: readonly Capture[]) => ScenarioBehaviorTable;
}
