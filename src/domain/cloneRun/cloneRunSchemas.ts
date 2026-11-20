import { z } from "zod";

import { browserOriginSchema } from "../browserObservation.js";
import { digestSchema } from "../digests.js";
import { jsonValueSchema } from "../jsonValue.js";
import {
  absoluteLocalPathStringSchema,
  localPathStringSchema,
} from "../localPath.js";
import { utcDateTimeSchema } from "../offsetDateTime.js";
import {
  FINGERPRINT_STEP_PREFIX,
  RESERVED_STEP_PREFIX,
  SCENARIO_BEHAVIOR_DIMENSIONS,
  SETUP_STEP_PREFIX,
  scenarioBehaviorRenameSchema,
  scenarioBehaviorVolatileFieldSchema,
  scenarioStepKind,
} from "../scenarioBehaviorComparison.js";
import { IDENTIFIER_PATTERN } from "../stringPatterns.js";

/**
 * Every file of a clone run folder and the referee's output.
 * Contract: docs/specs/reconstruction/clone-runs/spec.md.
 *
 * Files an agent writes carry no schema tag and never repeat their own file
 * name, so there is less to hand-write and nothing to keep in step; files the
 * referee writes carry a tag. Authored files are strict: an unknown member is
 * refused with its path.
 */

/** Operation names the two referee commands report. */
export const INIT_CLONE_RUN_OPERATION = "init-clone-run";
export const EVALUATE_CLONE_RUN_OPERATION = "evaluate-clone-run";

export const CLONE_RUN_ROLES = [
  "lead",
  "scout",
  "mapper",
  "prober",
  "spec_writer",
  "builder",
  "verifier",
] as const;
export type CloneRunRole = (typeof CLONE_RUN_ROLES)[number];

export const CLONE_RUN_SIDES = ["original", "clone"] as const;
export type CloneRunSide = (typeof CLONE_RUN_SIDES)[number];

/** The checks "done" requires, in the order the worklist reports them. */
export const CLONE_RUN_CHECKS = [
  "scope",
  "inputs",
  "evidence",
  "clean_start",
  "coverage",
  "parity",
  "clean_room",
  "unknowns",
] as const;
export type CloneRunCheck = (typeof CLONE_RUN_CHECKS)[number];

interface CloneRunReasonDefinition {
  readonly check: CloneRunCheck;
  /** The role that acts; a capture reason goes to the role that captures that side. */
  readonly role:
    | CloneRunRole
    | { readonly [Side in CloneRunSide]: CloneRunRole };
}

const CAPTURE_ROLES = { original: "prober", clone: "verifier" } as const;

/**
 * The single list of reason codes. Every blocking finding of the referee
 * carries exactly one; guidance and tests name codes from here only.
 */
export const CLONE_RUN_REASONS = {
  // scope
  target_invalid: { check: "scope", role: "lead" },
  addresses_not_distinct: { check: "scope", role: "lead" },
  run_folder_inside_clone: { check: "scope", role: "lead" },
  clone_root_missing: { check: "scope", role: "builder" },
  clone_symlink_outside_root: { check: "scope", role: "builder" },
  // inputs
  no_scenarios: { check: "inputs", role: "prober" },
  scenario_invalid: { check: "inputs", role: "prober" },
  no_obligations: { check: "inputs", role: "spec_writer" },
  obligation_invalid: { check: "inputs", role: "spec_writer" },
  unknown_invalid: { check: "inputs", role: "lead" },
  intended_differences_invalid: { check: "inputs", role: "lead" },
  waivers_invalid: { check: "inputs", role: "lead" },
  // evidence
  evidence_missing: { check: "evidence", role: CAPTURE_ROLES },
  evidence_stale: { check: "evidence", role: "verifier" },
  evidence_scenario_mismatch: { check: "evidence", role: CAPTURE_ROLES },
  evidence_rejected_integrity: { check: "evidence", role: CAPTURE_ROLES },
  evidence_rejected_address: { check: "evidence", role: CAPTURE_ROLES },
  // clean start
  start_state_dirty: { check: "clean_start", role: CAPTURE_ROLES },
  start_state_unknown: { check: "clean_start", role: CAPTURE_ROLES },
  // coverage
  step_uncited: { check: "coverage", role: "spec_writer" },
  obligation_step_unknown: { check: "coverage", role: "spec_writer" },
  obligation_inferred: { check: "coverage", role: "prober" },
  // parity
  parity_changed: { check: "parity", role: "builder" },
  parity_unknown: { check: "parity", role: CAPTURE_ROLES },
  parity_unstable: {
    check: "parity",
    role: { original: "lead", clone: "builder" },
  },
  // clean room
  clean_room_identical_file: { check: "clean_room", role: "builder" },
  clean_room_forbidden_name: { check: "clean_room", role: "builder" },
  // unknowns
  unknown_open: { check: "unknowns", role: "lead" },
} as const satisfies Readonly<Record<string, CloneRunReasonDefinition>>;

export type CloneRunReasonCode = keyof typeof CLONE_RUN_REASONS;

export const CLONE_RUN_REASON_CODES = Object.keys(
  CLONE_RUN_REASONS,
) as readonly CloneRunReasonCode[] as readonly [
  CloneRunReasonCode,
  ...CloneRunReasonCode[],
];

/** The role that acts on a reason; a side-dependent reason without a side goes to the lead. */
export const cloneRunReasonRole = (
  code: CloneRunReasonCode,
  side?: CloneRunSide,
): CloneRunRole => {
  const { role }: CloneRunReasonDefinition = CLONE_RUN_REASONS[code];
  if (typeof role === "string") return role;
  return side === undefined ? "lead" : role[side];
};

/** The check a reason fails. */
export const cloneRunReasonCheck = (code: CloneRunReasonCode): CloneRunCheck =>
  CLONE_RUN_REASONS[code].check;

export const CLONE_RUN_VERDICTS = [
  "done",
  "done_with_waivers",
  "not_done",
  "stalled",
] as const;
export type CloneRunVerdict = (typeof CLONE_RUN_VERDICTS)[number];

/** The `--exit-code` status of a verdict: 0 done (with or without waivers), 1 not done, 2 stalled. */
export const cloneRunExitCode = (verdict: CloneRunVerdict): 0 | 1 | 2 =>
  verdict === "done" || verdict === "done_with_waivers"
    ? 0
    : verdict === "stalled"
      ? 2
      : 1;

/** Defaults `init-clone-run` writes into `target.json`. */
export const CLONE_RUN_DEFAULT_LIMITS = Object.freeze({
  min_captures: 2,
  max_rounds: 8,
  capture_timeout_seconds: 120,
});
/** Clone paths left out of the tree digest and the clean-room checks unless the lead declares otherwise. */
export const CLONE_RUN_DEFAULT_EXCLUDES = [".git", "node_modules"] as const;
/** Files smaller than this are too short to identify a source; the byte-identity check skips them. */
export const CLEAN_ROOM_MIN_IDENTICAL_BYTES = 64;
/** At most this many worklist items are returned; `blocking` still counts every finding. */
export const CLONE_RUN_NEXT_LIMIT = 10;
/**
 * The placeholder a scenario writes at the start of a `goto` step's
 * `destination.url`, the one place it is replaced by the side's address.
 */
export const CLONE_RUN_ORIGIN_PLACEHOLDER = "{origin}";

/** Host names that all reach this machine. */
const LOOPBACK_HOST =
  /^(?:localhost|.+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\])$/u;

/**
 * What the two addresses of a run must differ in: scheme, port, and host with
 * every loopback name folded to one, so `localhost` and `127.0.0.1` on one
 * port are one address. Takes an origin `browserOriginSchema` accepted.
 */
export const cloneRunAddressIdentity = (origin: string): string => {
  const url = new URL(origin);
  const host = LOOPBACK_HOST.test(url.hostname) ? "loopback" : url.hostname;
  return `${url.protocol}//${host}:${url.port}`;
};

/** Names of the files and directories of a run folder, relative to its root. */
export const CLONE_RUN_PATHS = Object.freeze({
  target: "target.json",
  intendedDifferences: "intended-differences.json",
  waivers: "waivers.json",
  scenarios: "scenarios",
  obligations: "obligations",
  unknowns: "unknowns",
  specs: "specs",
  scout: "scout",
  examples: "examples",
  evidence: "evidence",
  rendered: "rendered",
  records: "records",
  behavior: "behavior",
  parity: "parity",
  journal: "journal.jsonl",
  gate: "gate.json",
});

const identifierSchema = z
  .string()
  .regex(
    IDENTIFIER_PATTERN,
    "Use letters, digits, '.', '_' and '-', starting with a letter",
  );

const commandSchema = z
  .string()
  .min(1)
  .nullable()
  .describe(
    "Shell command the team runs; REA records it and never executes it",
  );

const sideCommandsSchema = z.strictObject({
  start: commandSchema,
  reset: commandSchema,
  stop: commandSchema,
  health: commandSchema,
});

/** `target.json`: written once by `init-clone-run` from its flags; the lead may edit it. */
export const cloneRunTargetSchema = z.strictObject({
  schema: z.literal("rea.clone-run.target/1"),
  authorization: z.strictObject({
    statement: z
      .string()
      .min(1)
      .describe(
        "Why the team may study the original. REA records it and cannot verify it.",
      ),
    stated_by: z.string().min(1).nullable(),
    recorded_at: utcDateTimeSchema,
  }),
  original: z.strictObject({
    address: browserOriginSchema,
    names: z
      .array(z.string().min(3))
      .min(1)
      .describe(
        "The original's product and brand names; none may appear in the clone tree",
      ),
    material: z
      .array(localPathStringSchema)
      .describe(
        "Directories of files taken from the original, absolute or relative to the run folder",
      ),
    commands: sideCommandsSchema,
  }),
  clone: z.strictObject({
    address: browserOriginSchema,
    name: z.string().min(1),
    root: absoluteLocalPathStringSchema,
    exclude: z
      .array(z.string().min(1))
      .describe(
        "Paths relative to the clone root, matched on whole leading segments, left out of the tree digest and the clean-room checks",
      ),
    commands: sideCommandsSchema,
  }),
  browser: z.strictObject({
    executable_path: absoluteLocalPathStringSchema,
    no_sandbox: z.boolean(),
  }),
  rea_command: z
    .string()
    .min(1)
    .describe("How worklist commands spell the REA CLI, such as `rea`"),
  limits: z.strictObject({
    min_captures: z.int().min(2),
    max_rounds: z.int().min(1),
    capture_timeout_seconds: z.int().min(1),
  }),
});
export type CloneRunTarget = z.infer<typeof cloneRunTargetSchema>;

/**
 * The first original name the clone's own name contains, ignoring letter
 * case. Such a run can never pass the forbidden-name check, so
 * `init-clone-run` refuses it and the referee reports `target_invalid`.
 */
export const cloneNameConflict = (
  cloneName: string,
  originalNames: readonly string[],
): string | undefined => {
  const lowered = cloneName.toLowerCase();
  return originalNames.find((name) => lowered.includes(name.toLowerCase()));
};

/**
 * `scenarios/<scenario>.json`: one address-free scenario, named by its file.
 * `actions` are capture-browser-scenario actions; the referee renders them
 * per side and validates the result with the browser scenario schema, so
 * action errors are reported with that schema's own field diagnostics.
 *
 * The step-id rules are part of the schema, because a scenario that breaks
 * them could pass without proving anything: ids are unique, the `fp-` steps
 * come first and there is at least one, and at least one step is neither
 * `fp-` nor `setup-`.
 */
export const cloneRunScenarioSchema = z
  .strictObject({
    start_path: z
      .string()
      .regex(/^\//u, "Start with '/'")
      .describe("Path and optional query the browser opens first"),
    actions: z
      .array(
        z
          .object({
            step_id: identifierSchema.refine(
              (id) => !id.startsWith(RESERVED_STEP_PREFIX),
              `Step ids starting with '${RESERVED_STEP_PREFIX}' are reserved for REA`,
            ),
          })
          .catchall(jsonValueSchema),
      )
      .min(1),
  })
  .superRefine((scenario, context) => {
    const seen = new Set<string>();
    let fingerprints = 0;
    let behaviours = 0;
    let pastFingerprint = false;
    scenario.actions.forEach(({ step_id: id }, index) => {
      const issue = (message: string): void =>
        context.addIssue({
          code: "custom",
          path: ["actions", index, "step_id"],
          message,
        });
      if (seen.has(id)) issue(`Step id ${id} is used twice; ids are unique`);
      seen.add(id);
      const kind = scenarioStepKind(id);
      if (kind === "fingerprint") {
        fingerprints += 1;
        if (pastFingerprint)
          issue(
            `Move ${id} before the first step that is not '${FINGERPRINT_STEP_PREFIX}': the fingerprint reads the start state before anything changes it`,
          );
      } else pastFingerprint = true;
      if (kind === "behavior") behaviours += 1;
    });
    if (fingerprints === 0)
      context.addIssue({
        code: "custom",
        path: ["actions"],
        message: `Start with at least one '${FINGERPRINT_STEP_PREFIX}' step that reads the state a clean start shows, such as a list request`,
      });
    if (behaviours === 0)
      context.addIssue({
        code: "custom",
        path: ["actions"],
        message: `Add at least one step that is neither '${FINGERPRINT_STEP_PREFIX}' nor '${SETUP_STEP_PREFIX}': only such steps are cited and must match`,
      });
  });
export type CloneRunScenario = z.infer<typeof cloneRunScenarioSchema>;

/** One rule of the original's behaviour and the recorded steps that show it. */
export const cloneRunObligationSchema = z.strictObject({
  id: identifierSchema,
  statement: z.string().min(1),
  basis: z.enum(["observed", "inferred"]),
  cases: z.array(
    z.strictObject({
      scenario: identifierSchema,
      step_ids: z.array(identifierSchema).min(1),
    }),
  ),
});
export type CloneRunObligation = z.infer<typeof cloneRunObligationSchema>;

/**
 * `obligations/<area>.json`, named by its file. An observed obligation cites
 * at least one case.
 */
export const cloneRunObligationsSchema = z.strictObject({
  obligations: z
    .array(
      cloneRunObligationSchema.refine(
        (obligation) =>
          obligation.basis === "inferred" || obligation.cases.length > 0,
        {
          path: ["cases"],
          message:
            "An observed obligation cites at least one case; use basis inferred for a rule no step shows",
        },
      ),
    )
    .min(1),
});
export type CloneRunObligations = z.infer<typeof cloneRunObligationsSchema>;

/**
 * `unknowns/<role>-<n>.json`: a worker's proposal that something is not
 * established. The file name is its id and names the role that wrote it.
 */
export const cloneRunUnknownSchema = z.strictObject({
  statement: z.string().min(1),
});
export type CloneRunUnknown = z.infer<typeof cloneRunUnknownSchema>;

/** The role an unknown's file name starts with, or undefined when it is not `<role>-<n>`. */
export const cloneRunUnknownRole = (id: string): CloneRunRole | undefined => {
  const named = /^(.+)-[1-9][0-9]*$/u.exec(id)?.[1];
  return CLONE_RUN_ROLES.find((role) => role === named);
};

/**
 * `waivers.json`: only the lead writes it. A waiver names a person and a
 * reason; REA records both and cannot verify either. A waiver covers an
 * unknown proposal or an inferred obligation, never a parity finding.
 */
export const cloneRunWaiversSchema = z.strictObject({
  waivers: z.array(
    z.strictObject({
      kind: z.enum(["unknown", "obligation"]),
      id: identifierSchema.describe(
        "The unknown's id, or the id of an inferred obligation",
      ),
      person: z
        .string()
        .regex(/\S/u, "Name the person who accepts the gap")
        .describe("The named person who accepts the gap"),
      reason: z.string().regex(/\S/u, "Say why the gap is accepted"),
    }),
  ),
  /** Unknowns an obligation now settles; the obligation must be observed and its cited steps must pass. */
  closed: z.array(
    z.strictObject({ unknown: identifierSchema, obligation: identifierSchema }),
  ),
});
export type CloneRunWaivers = z.infer<typeof cloneRunWaiversSchema>;

/** `intended-differences.json`: only the lead writes it. */
export const cloneRunIntendedDifferencesSchema = z.strictObject({
  renames: z.array(
    scenarioBehaviorRenameSchema.extend({ reason: z.string().min(1) }),
  ),
  volatile_fields: z.array(
    scenarioBehaviorVolatileFieldSchema.extend({
      scenario: identifierSchema,
      reason: z.string().min(1),
    }),
  ),
});
export type CloneRunIntendedDifferences = z.infer<
  typeof cloneRunIntendedDifferencesSchema
>;

/** A schema failure of an authored file: where, what, and how to fix it. */
export const cloneRunFileIssueSchema = z.strictObject({
  file: z.string().min(1),
  /** JSON pointer of the offending member inside the file. */
  pointer: z.string(),
  message: z.string().min(1),
  fix: z.string().min(1),
});
export type CloneRunFileIssue = z.infer<typeof cloneRunFileIssueSchema>;

/**
 * `duplicate`: a second file holding an Evidence record already counted for
 * that side and scenario, so copying a capture cannot stand in for a repeat.
 */
export const CLONE_RUN_EVIDENCE_STATUSES = [
  "admitted",
  "duplicate",
  "stale",
  "scenario_mismatch",
  "rejected_integrity",
  "rejected_address",
] as const;
export type CloneRunEvidenceStatus =
  (typeof CLONE_RUN_EVIDENCE_STATUSES)[number];

/** `records/<side>/<scenario>.json`: what the referee decided about each Evidence file. Output only. */
export const cloneRunAdmissionRecordSchema = z.strictObject({
  schema: z.literal("rea.clone-run.admission/1"),
  side: z.enum(CLONE_RUN_SIDES),
  scenario: identifierSchema,
  address: z.string().min(1),
  /** REA's digest of the capture input the referee renders for this side now. */
  expected_scenario_sha256: digestSchema,
  /** The clone tree digest the expected input is bound to; null on the original side. */
  clone_tree_sha256: digestSchema.nullable(),
  files: z.array(
    z.strictObject({
      file: z.string().min(1),
      status: z.enum(CLONE_RUN_EVIDENCE_STATUSES),
      evidence_id: z.string().min(1).nullable(),
      start_origin: z.string().nullable(),
      scenario_sha256: digestSchema.nullable(),
      /** The tree digest named by the capture's own `rea-tree-` step. */
      bound_clone_tree_sha256: digestSchema.nullable(),
      detail: z.string().min(1).nullable(),
    }),
  ),
});
export type CloneRunAdmissionRecord = z.infer<
  typeof cloneRunAdmissionRecordSchema
>;

/** One thing to do next. Parity items carry the step and both values. */
export const cloneRunNextItemSchema = z.strictObject({
  role: z.enum(CLONE_RUN_ROLES),
  reason: z.enum(CLONE_RUN_REASON_CODES),
  /** The file or directory the role acts on. */
  file: z.string().min(1),
  /** The exact command to run, or to run after the edit this item asks for. */
  command: z.string().min(1),
  /** What is wrong, naming the path and the fix. */
  message: z.string().min(1),
  side: z.enum(CLONE_RUN_SIDES).optional(),
  scenario: z.string().optional(),
  step_id: z.string().optional(),
  obligation: z.string().optional(),
  dimension: z.enum(SCENARIO_BEHAVIOR_DIMENSIONS).optional(),
  pointer: z.string().optional(),
  /** The original's value. */
  expected: z.string().optional(),
  /** The clone's value. */
  actual: z.string().optional(),
});
export type CloneRunNextItem = z.infer<typeof cloneRunNextItemSchema>;

const checkStatusSchema = z.enum(["pass", "fail", "not_evaluated"]);

/** `gate.json` and the JSON of `rea evaluate-clone-run`: the verdict and the worklist. Output only. */
export const cloneRunGateSchema = z.strictObject({
  schema: z.literal("rea.clone-run.gate/1"),
  run: z.string().min(1),
  evaluated_at: utcDateTimeSchema,
  verdict: z.enum(CLONE_RUN_VERDICTS),
  /** One line, such as `done with 2 waivers` or `not done: 3 blocking findings`. */
  summary: z.string().min(1),
  waivers: z.int().min(0),
  checks: z.strictObject({
    scope: checkStatusSchema,
    inputs: checkStatusSchema,
    evidence: checkStatusSchema,
    clean_start: checkStatusSchema,
    coverage: checkStatusSchema,
    parity: checkStatusSchema,
    clean_room: checkStatusSchema,
    unknowns: checkStatusSchema,
  }),
  /** What `target.json` declared when this verdict was computed; null when it is refused. */
  target: z
    .strictObject({
      original_address: z.string().min(1),
      clone_address: z.string().min(1),
      clone_root: z.string().min(1),
    })
    .nullable(),
  /** Declarations that took effect: differences the team declared instead of matching. */
  declared: z.strictObject({
    /** Each rename that changed at least one compared value of the original, with how many. */
    renames: z.array(
      scenarioBehaviorRenameSchema.extend({ values: z.int().min(1) }),
    ),
    /** Reply fields whose value was not compared because a declaration was honoured. */
    volatile_fields: z.int().min(0),
  }),
  /** Every blocking reason with its total; `next` holds at most ten of them. */
  blocking: z.array(
    z.strictObject({
      reason: z.enum(CLONE_RUN_REASON_CODES),
      count: z.int().min(1),
    }),
  ),
  next: z.array(cloneRunNextItemSchema).max(CLONE_RUN_NEXT_LIMIT),
  counts: z.strictObject({
    scenarios: z.int().min(0),
    obligations: z.int().min(0),
    cited_steps: z.int().min(0),
    /** Every compared step of every judged scenario, by status. */
    steps: z.strictObject({
      unchanged: z.int().min(0),
      changed: z.int().min(0),
      unknown: z.int().min(0),
      unstable: z.int().min(0),
    }),
    /** Setup and fingerprint steps that are unknown or unstable: reported, not blocking. */
    ungated_steps: z.int().min(0),
    evidence: z.strictObject({
      admitted: z.int().min(0),
      duplicate: z.int().min(0),
      stale: z.int().min(0),
      scenario_mismatch: z.int().min(0),
      rejected: z.int().min(0),
    }),
  }),
  clone_tree: z
    .strictObject({
      sha256: digestSchema,
      files: z.int().min(0),
      /** The excludes that applied: these paths are neither digested nor checked. */
      exclude: z.array(z.string()),
    })
    .nullable(),
  stall: z.strictObject({
    round: z.int().min(0),
    max_rounds: z.int().min(1),
    /** The last two judged rounds had the same failures and the same clone tree. */
    repeated: z.boolean(),
  }),
  /** What this verdict cannot establish; fixed text from the specification. */
  residual_trust: z.array(z.string().min(1)),
});
export type CloneRunGate = z.infer<typeof cloneRunGateSchema>;

/** One line of `journal.jsonl`: an evaluation whose state differed from the line before. Output only. */
export const cloneRunJournalEntrySchema = z.strictObject({
  schema: z.literal("rea.clone-run.journal/1"),
  at: utcDateTimeSchema,
  /** Counts judged evaluations: every scenario had its captures on both sides. */
  round: z.int().min(0),
  judged: z.boolean(),
  verdict: z.enum(CLONE_RUN_VERDICTS),
  /** Digest of the sorted blocking findings (reason, scenario, step, pointer). */
  failures_sha256: digestSchema,
  clone_tree_sha256: digestSchema.nullable(),
  /** Digest of the sorted admitted Evidence ids. */
  evidence_sha256: digestSchema,
});
export type CloneRunJournalEntry = z.infer<typeof cloneRunJournalEntrySchema>;

/** The JSON of `rea init-clone-run`. */
export const cloneRunInitResultSchema = z.strictObject({
  run: z.string().min(1),
  created: z.array(z.string().min(1)),
  /** The files agents still write, each with its role and a valid example file. */
  authored: z.array(
    z.strictObject({
      file: z.string().min(1),
      role: z.enum(CLONE_RUN_ROLES),
      example: z.string().min(1),
    }),
  ),
  next: z.array(cloneRunNextItemSchema).max(CLONE_RUN_NEXT_LIMIT),
});
export type CloneRunInitResult = z.infer<typeof cloneRunInitResultSchema>;
