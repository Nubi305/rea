import { readEvidencePayload } from "./evidenceValidation.js";
import type { EvidenceIntegrityError } from "./evidenceErrors.js";
import { ok, type Result } from "./result.js";
import {
  canBorrowParsedJsonSnapshot,
  immutableJsonSnapshotMember,
} from "./immutableJson.js";
import {
  artifactDfuCrc32PairSchema,
  artifactIntegrityPairOf,
  artifactSha256PairSchema,
  artifactMd5PairSchema,
} from "./artifactIntegrity.js";
import { z } from "zod";

import {
  artifactInventoryResultSchema,
  type ArtifactInventoryResult,
} from "./artifactGraph.js";
import { digestCanonicalValue } from "./canonicalDigest.js";
import { isJavaScriptSourcePath } from "./javascript/javascriptArtifactFiles.js";
import { admitRawBinary } from "./rawBinary.js";
import { uniqueSorted } from "./canonicalOrdering.js";
import { evidenceSchema, parseEvidence, type Evidence } from "./evidence.js";
import { offsetText } from "./firmware/espImageStructures.js";
import { jsonValueSchema } from "./jsonValue.js";
import { prefixedDigestSchema } from "./../domain/digests.js";
import { nonEmptyTextSchema } from "./textSchemas.js";
import {
  elfRoutes,
  MACHO_ROUTES,
  pathProbes,
  PE_ROUTES,
  type ElfRouteFacts,
  type PathRoute,
} from "./pathInspectorRoutes.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const artifactIdSchema = prefixedDigestSchema("art");

const inspectionObservationSchema = z.strictObject({
  observation_id: prefixedDigestSchema("aio"),
  kind: z.enum([
    "root-manifest",
    "integrity",
    "container-header",
    "reconstruction",
  ]),
  subject: nonEmptyTextSchema,
  value: jsonValueSchema,
  evidence_id: evidenceIdSchema,
});

const inspectionHypothesisSchema = z.strictObject({
  hypothesis_id: prefixedDigestSchema("aih"),
  statement: nonEmptyTextSchema,
  confidence: z.enum(["medium", "low"]),
  basis_evidence_ids: z.array(evidenceIdSchema).min(1),
  limitation: nonEmptyTextSchema,
});

const inspectionContradictionBaseSchema = z.strictObject({
  contradiction_id: prefixedDigestSchema("aic"),
  statement: nonEmptyTextSchema,
  occurrence_id: prefixedDigestSchema("occ"),

  evidence_id: evidenceIdSchema,
});

const inspectionContradictionSchema = z.union([
  inspectionContradictionBaseSchema.extend(artifactSha256PairSchema.shape),
  inspectionContradictionBaseSchema.extend(artifactMd5PairSchema.shape),
  inspectionContradictionBaseSchema.extend(artifactDfuCrc32PairSchema.shape),
]);

const nextProbeSchema = z.strictObject({
  operation: nonEmptyTextSchema,
  /**
   * The contract arguments that run this probe on the inspected path; absent
   * when the probe reads a member extract_artifact must first write.
   */
  arguments: z.record(z.string(), z.string()).exactOptional(),
  rationale: nonEmptyTextSchema,
  authority: z.enum([
    "artifact-bytes",
    "managed-static-analysis",
    "native-analysis-provider",
    "ast-static-analysis",
  ]),
});

const unexploredBranchSchema = z.strictObject({
  branch_id: prefixedDigestSchema("aib"),
  reason: z.enum(["format-specific-analysis-required", "unknown-format"]),
  detail: nonEmptyTextSchema,
  next_probe: nextProbeSchema.nullable(),
  evidence_id: evidenceIdSchema,
});

/** Provider-neutral inspection result with its atomic source Evidence. */
export const artifactInspectionResultSchema = z.strictObject({
  inspection_id: prefixedDigestSchema("ai"),
  subject: z.strictObject({
    manifest_id: prefixedDigestSchema("agm"),
    root_artifact_id: artifactIdSchema,
    root_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    root_format: nonEmptyTextSchema,
  }),
  substeps: z
    .array(
      z.strictObject({
        substep_id: prefixedDigestSchema("ais"),
        operation: z.literal("inventory_artifact"),
        status: z.literal("completed"),
        evidence_id: evidenceIdSchema,
        evidence: evidenceSchema.safeExtend({
          operation: z.literal("inventory_artifact"),
          normalized_result: artifactInventoryResultSchema,
        }),
      }),
    )
    .min(1),
  observations: z.array(inspectionObservationSchema),
  hypotheses: z.array(inspectionHypothesisSchema),
  contradictions: z.array(inspectionContradictionSchema),
  unexplored_branches: z.array(unexploredBranchSchema),
  next_probes: z.array(nextProbeSchema),
  coverage: z.strictObject({
    status: z.enum(["complete-within-substeps", "partial", "truncated"]),
    substeps_completed: z.int().min(1),
    observations_retained: z.int().min(0),
    observations_omitted: z.int().min(0),
    hypotheses_retained: z.int().min(0),
    hypotheses_omitted: z.int().min(0),
    unexplored_branches_retained: z.int().min(0),
    unexplored_branches_omitted: z.int().min(0),
    next_probes_retained: z.int().min(0),
    next_probes_omitted: z.int().min(0),
  }),
  evidence_links: z.array(evidenceIdSchema).min(1),
  limitations: z.array(nonEmptyTextSchema),
});

export type ArtifactInspectionResult = z.infer<
  typeof artifactInspectionResultSchema
>;

/** Project one successful inventory Evidence record into an inspection report. */
/**
 * What the caller knows about the inspected path beyond its inventory: the
 * path its probes' commands name, and the ELF facts that order its inspectors.
 */
export interface ArtifactInspectionRouting {
  readonly path: string;
  readonly elf?: ElfRouteFacts;
}

export const createArtifactInspection = (
  inventoryInput: unknown,
  routing?: ArtifactInspectionRouting,
): ArtifactInspectionResult => {
  const inventoryEvidence = parseInventoryEvidence(inventoryInput);
  const inventory = artifactInventoryResultSchema.parse(
    inventoryEvidence.normalized_result,
  );
  const observations = allObservations(
    inventory,
    inventoryEvidence.evidence_id,
  );
  const hypotheses = allHypotheses(inventory, inventoryEvidence.evidence_id);
  const routes = probesFor(inventory, routing);
  const routed =
    routing === undefined
      ? { probes: routes.map(withoutRouteArguments), omitted: 0 }
      : pathProbes(routes, routing.path);
  const nextProbes: ArtifactInspectionResult["next_probes"] = [
    ...routed.probes,
  ];
  const branches = allUnexploredBranches(
    inventory,
    inventoryEvidence.evidence_id,
    nextProbes,
  );
  const retained = {
    observations,
    hypotheses,
    branches,
    probes: nextProbes,
  };
  const omissions = {
    observations: 0,
    hypotheses: 0,
    branches: 0,
    probes: routed.omitted,
  };
  const semantic = {
    subject: {
      manifest_id: inventory.manifest.manifest_id,
      root_artifact_id: inventory.manifest.root_artifact_id,
      root_sha256: inventory.manifest.root_sha256,
      root_format: inventory.manifest.root_format,
    },
    substeps: [
      {
        substep_id: `ais_${digestCanonicalValue(
          {
            operation: "inventory_artifact",
            evidence_id: inventoryEvidence.evidence_id,
          },
          "Artifact inspection",
        )}`,
        operation: "inventory_artifact" as const,
        status: "completed" as const,
        evidence_id: inventoryEvidence.evidence_id,
        evidence: inventoryEvidence,
      },
    ],
    observations: retained.observations,
    hypotheses: retained.hypotheses,
    contradictions: contradictions(inventory, inventoryEvidence.evidence_id),
    unexplored_branches: retained.branches,
    next_probes: retained.probes,
    coverage: {
      status: inspectionCoverage(inventory, omissions),
      substeps_completed: 1 as const,
      observations_retained: retained.observations.length,
      observations_omitted: omissions.observations,
      hypotheses_retained: retained.hypotheses.length,
      hypotheses_omitted: omissions.hypotheses,
      unexplored_branches_retained: retained.branches.length,
      unexplored_branches_omitted: omissions.branches,
      next_probes_retained: retained.probes.length,
      next_probes_omitted: omissions.probes,
    },
    evidence_links: [inventoryEvidence.evidence_id],
    limitations: uniqueSorted([
      ...inventory.limitations,
      "Inspection derives bounded static hypotheses and next probes; it does not execute the artifact or claim format-specific semantics.",
    ]),
  };
  return artifactInspectionResultSchema.parse({
    ...semantic,
    inspection_id: `ai_${digestCanonicalValue(semantic, "Artifact inspection")}`,
  });
};

const parseInventoryEvidence = (input: unknown): Evidence => {
  const evidence = parseEvidence(input);
  if (evidence.operation !== "inventory_artifact")
    throw new TypeError(
      "Artifact inspection substep requires inventory_artifact Evidence",
    );
  return evidence;
};

// Artifact, occurrence, and edge records stay in the nested inventory Evidence;
// restating each one here would repeat the complete graph in every result.
const allObservations = (
  inventory: ArtifactInventoryResult,
  evidenceId: string,
): ArtifactInspectionResult["observations"] => [
  observation(
    "root-manifest",
    inventory.manifest.root_artifact_id,
    inventory.manifest,
    evidenceId,
  ),
  ...inventory.integrity_contradictions.map((value) =>
    observation("integrity", value.contradiction_id, value, evidenceId),
  ),
  ...(inventory.ines === undefined
    ? []
    : [
        observation(
          "container-header",
          inventory.manifest.root_artifact_id,
          inventory.ines.header,
          evidenceId,
        ),
        observation(
          "reconstruction",
          inventory.manifest.root_artifact_id,
          inventory.ines.reconstruction,
          evidenceId,
        ),
      ]),
];

const observation = (
  kind: ArtifactInspectionResult["observations"][number]["kind"],
  subject: string,
  value: unknown,
  evidenceId: string,
): ArtifactInspectionResult["observations"][number] => {
  const semantic = {
    kind,
    subject,
    value: jsonValueSchema.parse(value),
    evidence_id: evidenceId,
  };
  return {
    observation_id: `aio_${digestCanonicalValue(semantic, "Artifact inspection")}`,
    ...semantic,
  };
};

const allHypotheses = (
  inventory: ArtifactInventoryResult,
  evidenceId: string,
): ArtifactInspectionResult["hypotheses"] => {
  const statements =
    inventory.manifest.root_format === "pe"
      ? [
          "The PE artifact may contain managed CLI metadata or native code; inventory bytes alone do not distinguish them.",
        ]
      : ["asar", "javascript-bundle"].includes(inventory.manifest.root_format)
        ? [
            "The artifact may contain a recoverable JavaScript application graph.",
          ]
        : [];
  return statements.map((statement) => {
    const semantic = {
      statement,
      confidence: "low" as const,
      basis_evidence_ids: [evidenceId],
      limitation:
        "Format classification proposes a bounded follow-up; it is not semantic proof.",
    };
    return {
      hypothesis_id: `aih_${digestCanonicalValue(semantic, "Artifact inspection")}`,
      ...semantic,
    };
  });
};

const contradictions = (
  inventory: ArtifactInventoryResult,
  evidenceId: string,
): ArtifactInspectionResult["contradictions"] =>
  inventory.integrity_contradictions.map((value) => {
    const semantic = {
      statement:
        value.logical_path === "."
          ? "The container's declared integrity contradicts its observed bytes."
          : `Declared integrity for ${value.logical_path} contradicts observed bytes.`,
      occurrence_id: value.occurrence_id,
      ...artifactIntegrityPairOf(value),
      evidence_id: evidenceId,
    };
    return {
      contradiction_id: `aic_${digestCanonicalValue(semantic, "Artifact inspection")}`,
      ...semantic,
    };
  });

const withoutRouteArguments = ({
  operation,
  rationale,
  authority,
}: PathRoute): ArtifactInspectionResult["next_probes"][number] => ({
  operation,
  rationale,
  authority,
});

const ROOT_FORMAT_ROUTES: Partial<
  Record<
    ArtifactInventoryResult["manifest"]["root_format"],
    readonly PathRoute[]
  >
> = {
  "mach-o": MACHO_ROUTES,
  "mach-o-universal": MACHO_ROUTES,
  pe: PE_ROUTES,
  apk: [
    {
      operation: "inspect_android_package",
      rationale: "Manifest, components and permissions, not executed.",
      authority: "artifact-bytes",
    },
    {
      operation: "inspect_apk_signature",
      rationale: "Signing schemes, signers and digests.",
      authority: "artifact-bytes",
    },
  ],
  uefi: [
    {
      operation: "inspect_uefi_firmware",
      rationale: "Firmware volumes, FFS files and sections.",
      authority: "artifact-bytes",
    },
    {
      operation: "inspect_uefi_nvram",
      rationale: "NVRAM variable stores.",
      authority: "artifact-bytes",
    },
  ],
};

/** A ZIP whose name or members say which inspector reads it. */
const zipRoutes = (
  inventory: ArtifactInventoryResult,
  path: string,
): readonly PathRoute[] => {
  const name = path.toLowerCase();
  const members = inventory.occurrences.map(({ logical_path }) =>
    logical_path.toLowerCase(),
  );
  if (name.endsWith(".nupkg"))
    return [
      {
        operation: "inspect_nuget_nupkg",
        rationale: "Package identity and dependency groups.",
        authority: "artifact-bytes",
      },
    ];
  if (name.endsWith(".saz"))
    return [
      {
        operation: "inspect_web_network_capture",
        pathField: "capture_path",
        fields: { format: "saz" },
        rationale: "Recorded Fiddler sessions, offline.",
        authority: "artifact-bytes",
      },
    ];
  if (members.some((member) => /(?:^|\/)[^/]*\.trace$/u.test(member)))
    return [
      {
        operation: "inspect_playwright_trace",
        rationale: "Saved Playwright trace events, offline.",
        authority: "artifact-bytes",
      },
    ];
  return [];
};

const parentDirectory = (path: string): string => {
  const index = path.replace(/\/+$/u, "").lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
};

const probesFor = (
  inventory: ArtifactInventoryResult,
  routing?: ArtifactInspectionRouting,
): readonly PathRoute[] => {
  const format = inventory.manifest.root_format;
  if (format === "elf" && routing?.elf !== undefined)
    return elfRoutes(routing.elf);
  const rootRoutes = ROOT_FORMAT_ROUTES[format];
  if (rootRoutes !== undefined) return rootRoutes;
  if (format === "zip" && routing !== undefined) {
    const routes = zipRoutes(inventory, routing.path);
    if (routes.length > 0) return routes;
  }
  // A single JavaScript file is read in the directory that holds it; the
  // application analyzer refuses a lone file.
  if (format === "javascript-bundle" && routing !== undefined)
    return [
      {
        operation: "analyze_javascript_application",
        path: parentDirectory(routing.path),
        pathField: "input_path",
        rationale:
          "Analyze the directory that holds the file; a lone file is refused.",
        authority: "ast-static-analysis",
      },
      {
        operation: "recover_javascript_sources",
        fields: { output_directory: `${routing.path}.recovered` },
        rationale: "Readable modules from a minified file (needs Wakaru).",
        authority: "ast-static-analysis",
      },
    ];
  // The JavaScript analyzer selects extracted files by source suffix, so a
  // main script such as `main` has no follow-up it can read.
  const extracted = extractedMemberProbes(inventory, format);
  if (extracted !== undefined) return extracted.map(unbound);
  return format === "directory"
    ? directoryProbes(inventory)
    : probesForFormat(format);
};

// These probes read a member that extract_artifact must first write, so
// they name no arguments for the inspected path.
const unbound = (route: PathRoute): PathRoute => ({ ...route, unbound: true });

const extractedMemberProbes = (
  inventory: ArtifactInventoryResult,
  format: ArtifactInventoryResult["manifest"]["root_format"],
): readonly PathRoute[] | undefined => {
  if (format === "node-sea")
    return inventory.occurrences.some(
      (row) =>
        row.format_metadata?.kind === "node-sea-entry" &&
        row.format_metadata.role === "main-script" &&
        isJavaScriptSourcePath(row.logical_path),
    )
      ? [
          {
            operation: "analyze_javascript_application",
            rationale:
              "Extract the SEA main script with extract_artifact, then analyze the extracted JavaScript application.",
            authority: "ast-static-analysis",
          },
        ]
      : [];
  if (
    format === "intel-hex" ||
    format === "srec" ||
    format === "uf2" ||
    format === "dfuse"
  )
    return inventory.occurrences.some(
      (row) =>
        row.format_metadata?.kind === "hex-record-region" ||
        row.format_metadata?.kind === "uf2-region" ||
        row.format_metadata?.kind === "dfuse-element",
    )
      ? [
          {
            operation: "open_binary",
            rationale:
              "Extract regions with extract_artifact, then open one with format raw-binary, a caller-chosen architecture, and entry_point set to the region start address (raw-binary maps file offset 0 at entry_point).",
            authority: "native-analysis-provider",
          },
        ]
      : [];
  if (format === "esp-image") return espFlashDumpProbes(inventory);
  if (format === "fit") return fitProbes(inventory);
  return undefined;
};

// An ESP image that its reader found at the start of a flash dump read from
// a later address is better read as that dump.
const espFlashDumpProbes = (
  inventory: ArtifactInventoryResult,
): ArtifactInspectionResult["next_probes"] => {
  const root = inventory.occurrences.find(
    ({ logical_path }) => logical_path === ".",
  )?.format_metadata;
  if (root?.kind !== "esp-image") return [];
  const dump = root.flash_dump;
  if (dump === null) return [];
  const offset = offsetText(dump.flash_offset);
  return [
    {
      operation: "open_binary",
      rationale: `Reopen the file with format esp-flash-image and flash_offset ${offset}, then inspect_artifact: it is a flash dump read from flash ${offset}, with a partition table at file offset ${offsetText(dump.table_file_offset)}.`,
      authority: "artifact-bytes",
    },
  ];
};

const fitProbes = (
  inventory: ArtifactInventoryResult,
): ArtifactInspectionResult["next_probes"] => {
  // Extraction keeps stored bytes, so only plain images are directly analyzable.
  const images = inventory.occurrences.flatMap((row) =>
    row.format_metadata?.kind === "fit-image" &&
    row.format_metadata.compression === "none" &&
    row.format_metadata.cipher_present === false
      ? [{ row, image: row.format_metadata }]
      : [],
  );
  let rawProbe: ArtifactInspectionResult["next_probes"][number] | undefined;
  for (const { row, image } of images) {
    if (row.declared_size === null) continue;
    if (image.entry !== null && image.entry !== image.load) continue;
    // An unavailable entry is not proof that the declaration was absent.
    if (image.unreadable_fields.includes("entry")) continue;
    const admitted = admitRawBinary({
      architecture: image.arch,
      entryPoint: image.load,
      fileBytes: row.declared_size,
    });
    if (!admitted.ok) continue;
    rawProbe = {
      operation: "open_binary",
      rationale: `Extract ${JSON.stringify(row.logical_path)} with extract_artifact, then open those uncompressed, unciphered bytes with format raw-binary, architecture ${admitted.value.architecture} and entry_point ${admitted.value.entryPoint}. This maps offset 0 and seeds analysis at that address; the declared entry is absent or equal to load.`,
      authority: "native-analysis-provider",
    };
    break;
  }
  return [
    ...(images.some(({ image }) => image.type === "flat_dt")
      ? [
          {
            operation: "inspect_devicetree",
            rationale:
              "Extract images with extract_artifact, then inspect uncompressed, unciphered flat_dt images with inspect_devicetree.",
            authority: "artifact-bytes" as const,
          },
        ]
      : []),
    ...(rawProbe === undefined ? [] : [rawProbe]),
  ];
};

// An application bundle directory is only a container, so its probes follow
// the formats it holds: a bundle of Mach-O executables is not a JavaScript tree.
// Formats are ordered so a repeated operation keeps its most general rationale.
const DIRECTORY_MEMBER_FORMATS: readonly ArtifactInventoryResult["manifest"]["root_format"][] =
  [
    "asar",
    "javascript-bundle",
    "mach-o-universal",
    "mach-o",
    "elf",
    "pe",
    "plist",
  ];

// A directory is the path these read; the other member probes read one file
// inside it, which the caller chooses.
const DIRECTORY_BOUND_OPERATIONS: ReadonlySet<string> = new Set([
  "analyze_javascript_application",
  "open_binary",
]);

const directoryProbes = (
  inventory: ArtifactInventoryResult,
): readonly PathRoute[] => {
  // JavaScript acquisition does not follow symlinks. Other probes retain
  // their own applicability rules; plist inspection follows readable links.
  const present = new Set(
    inventory.occurrences
      .filter(
        ({ entry_kind, artifact_format }) =>
          entry_kind !== "symlink" || artifact_format !== "javascript-bundle",
      )
      .map(({ artifact_format }) => artifact_format),
  );
  const members = DIRECTORY_MEMBER_FORMATS.filter((memberFormat) =>
    present.has(memberFormat),
  );
  const probes = members.flatMap(probesForFormat);
  return probes
    .filter(
      (probe, index) =>
        probes.findIndex(({ operation }) => operation === probe.operation) ===
        index,
    )
    .map((probe) =>
      DIRECTORY_BOUND_OPERATIONS.has(probe.operation) ? probe : unbound(probe),
    );
};

const probesForFormat = (
  format: ArtifactInventoryResult["manifest"]["root_format"],
): readonly PathRoute[] => {
  if (format === "bun-standalone")
    return [
      {
        operation: "extract_artifact",
        pathField: null,
        authority: "artifact-bytes",
        rationale:
          "Extract the stored module regions into a fresh owned directory, then inspect compatible source separately. Bytecode and source-map regions remain stored evidence; they are not decoded or executed.",
      },
    ];
  if (format === "deno-standalone")
    return [
      {
        operation: "extract_artifact",
        pathField: null,
        authority: "artifact-bytes",
        rationale:
          "Extract the stored virtual files into a fresh owned directory, then inspect compatible source separately. Environment-file values and CA certificate bytes remain in local Evidence with their counts and byte lengths, the npm snapshot stays undecoded, and the executable stays unrun.",
      },
    ];
  if (format === "dotnet-bundle")
    return [
      {
        operation: "extract_artifact",
        pathField: null,
        rationale:
          "Extract members into a fresh owned directory, then inspect candidate files separately; bundle declarations do not establish their format.",
        authority: "artifact-bytes",
      },
    ];
  if (["asar", "javascript-bundle"].includes(format))
    return [
      {
        operation: "analyze_javascript_application",
        pathField: "input_path",
        rationale:
          "Recover bounded JavaScript modules, source maps, Electron boundaries, and application relationships.",
        authority: "ast-static-analysis",
      },
    ];
  if (format === "pe")
    return [
      {
        operation: "inspect_managed_artifact",
        rationale:
          "Check execution-free CLI metadata before choosing a deep native provider.",
        authority: "managed-static-analysis",
      },
      {
        operation: "open_binary",
        rationale:
          "Open as native code only when managed inspection reports a native or mixed boundary.",
        authority: "native-analysis-provider",
      },
    ];
  if (["mach-o", "mach-o-universal", "elf"].includes(format))
    return [
      {
        operation: "open_binary",
        rationale:
          "Bind one deep native provider before function-level analysis.",
        authority: "native-analysis-provider",
      },
    ];
  if (format === "plist")
    return [
      {
        operation: "inspect_plist",
        rationale: "Parse property-list values without executing the artifact.",
        authority: "artifact-bytes",
      },
    ];
  return [];
};

const allUnexploredBranches = (
  inventory: ArtifactInventoryResult,
  evidenceId: string,
  nextProbes: ArtifactInspectionResult["next_probes"],
): ArtifactInspectionResult["unexplored_branches"] => {
  const branches: ArtifactInspectionResult["unexplored_branches"] = [];
  branches.push(
    ...nextProbes.map((probe) =>
      branch(
        "format-specific-analysis-required",
        `${probe.operation} was not run by provider-neutral artifact inspection.`,
        probe,
        evidenceId,
      ),
    ),
  );
  if (inventory.manifest.root_format === "unknown")
    branches.push(
      branch(
        "unknown-format",
        "Artifact bytes did not match an admitted format classifier.",
        null,
        evidenceId,
      ),
    );
  return branches;
};

const branch = (
  reason: ArtifactInspectionResult["unexplored_branches"][number]["reason"],
  detail: string,
  nextProbe: ArtifactInspectionResult["next_probes"][number] | null,
  evidenceId: string,
): ArtifactInspectionResult["unexplored_branches"][number] => {
  const semantic = {
    reason,
    detail,
    next_probe: nextProbe,
    evidence_id: evidenceId,
  };
  return {
    branch_id: `aib_${digestCanonicalValue(semantic, "Artifact inspection")}`,
    ...semantic,
  };
};

// A completed substep establishes only the coverage its producer examined, so
// unknown inventory traversal keeps the inspection partial, never complete.
const inspectionCoverage = (
  inventory: ArtifactInventoryResult,
  omissions: Readonly<Record<string, number>>,
): ArtifactInspectionResult["coverage"]["status"] => {
  if (Object.values(omissions).some((count) => count > 0)) return "truncated";
  if (inventory.coverage.status !== "complete") return "partial";
  return "complete-within-substeps";
};

/** Select source records from a typed inspection, preserving sealed child ownership. */
export const artifactInspectionSources = (
  inspection: ArtifactInspectionResult,
): readonly Evidence[] => {
  const substeps = immutableJsonSnapshotMember(inspection, "substeps");
  return Object.freeze(
    inspection.substeps.map((step, index) => {
      const ownedStep = immutableJsonSnapshotMember(substeps, String(index));
      immutableJsonSnapshotMember(ownedStep, "evidence");
      return step.evidence;
    }),
  );
};

/** Validate an unknown inspection before selecting its atomic source closure. */
export const readArtifactInspectionSources = (
  result: unknown,
): Result<readonly Evidence[], EvidenceIntegrityError> => {
  const parsed = readEvidencePayload(artifactInspectionResultSchema, result);
  if (!parsed.ok) return parsed;
  const inspection = canBorrowParsedJsonSnapshot(result, parsed.value)
    ? result
    : parsed.value;
  return ok(artifactInspectionSources(inspection));
};
