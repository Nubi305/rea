import { describe, expect, it } from "vitest";
import {
  evidenceFileTarget,
  evidenceSubjectDisplay,
  type Evidence,
} from "../evidence.js";
import { ARTIFACT_COMPARISON_EXAMPLE } from "../../contracts/artifactComparisonExample.js";
import { NATIVE_INVENTORY_OPERATIONS } from "../native/nativeInventory.js";
import { NATIVE_OBSERVATION_OPERATIONS } from "../native/nativeObservation.js";
import {
  analysisViewCaptureEvidence,
  analysisViewJavaScriptEvidence,
  analysisViewLayoutEvidence,
  analysisViewNativeEvidence,
} from "../../../tests/fixtures/analysisView.js";
import { scenarioCaptureEvidence } from "../../../tests/fixtures/browserScenarioCapture.js";
import { projectAnalysisView } from "./analysisView.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import { inspectAnalysisViewInputSchema } from "./analysisViewRequest.js";
import {
  SUMMARY_NAMED_VIEW_LIMIT,
  summaryViewCandidates,
} from "./summaryNamedViews.js";

const artifactOf = (evidence: Evidence) => {
  const target = evidenceFileTarget(evidence);
  const display = evidenceSubjectDisplay(evidence);
  return target === undefined || display === undefined
    ? null
    : { path: display.local_path, sha256: target.sha256 };
};

const parentOf = (evidence: Evidence): AnalysisViewParent => ({
  artifact: artifactOf(evidence),
  evidenceId: evidence.evidence_id,
  operation: evidence.operation,
  predicateType: evidence.predicate_type,
  normalizedResult: evidence.normalized_result,
  rawResult: evidence.raw_result,
  parameters: evidence.parameters,
  subject: evidence.subject,
  limitations: evidence.limitations,
});

/** Operations whose summary has paged views, each with a parent the repository builds. */
const PARENTS: ReadonlyArray<readonly [string, () => Evidence]> = [
  ["analyze_javascript_application", () => analysisViewJavaScriptEvidence()],
  ["inspect_web_network_capture", () => analysisViewCaptureEvidence()],
  ["inventory_artifact", () => ARTIFACT_COMPARISON_EXAMPLE.left],
  ["capture_browser_scenario", () => scenarioCaptureEvidence()],
  ["inspect_binary_layout", () => analysisViewLayoutEvidence()],
  ["analyze_function", () => analysisViewNativeEvidence()],
];

/** Summary-capable parents whose records have no paged collection beyond the summary. */
const SUMMARY_ONLY = new Set([
  "inspect_byte_entropy",
  "trace_native_values",
  "inspect_nuget_nupkg",
  "frida_session_status",
  "gdb_console",
  "inspect_with_objdump",
  "inspect_android_class",
  "inspect_android_method",
]);

/** Every operation a retained summary can be projected from. */
const SUMMARY_PARENTS = [
  "inspect_native_load_image",
  "procedure_references",
  "procedure_pseudo_code",
  "batch_decompile",
  "analyze_function",
  "trace_feature",
  "inspect_macho",
  "inspect_devicetree",
  "inspect_elf_dependencies",
  "inspect_native_exports",
  "inspect_binary_layout",
  "inspect_artifact",
  "inventory_artifact",
  "decode_interface_builder",
  "inspect_desktop_application",
  "inspect_evm_interface",
  "inspect_go_binary",
  "inspect_il2cpp_metadata",
  "inspect_model_artifact",
  "inspect_gpu_code_objects",
  "inspect_rust_binary",
  "inspect_wasm_artifact",
  "inspect_apk_signature",
  "inspect_managed_artifact",
  "inspect_managed_members",
  "inspect_android_jni_bindings",
  "inspect_android_package",
  "inspect_pcap_capture",
  "inspect_dart_aot",
  "capture_browser_scenario",
  "inspect_playwright_trace",
  "compare_static_and_observed_endpoints",
  "inspect_web_network_capture",
  "match_native_functions",
  "analyze_javascript_application",
  "analyze_web_bundle",
  "inspect_python_pyc",
  "inspect_erlang_beam",
  "inspect_api_contract",
  "compare_source_to_bundle",
  "trace_application_feature",
  "trace_web_source_location",
  "inspect_native_instruction",
  ...NATIVE_INVENTORY_OPERATIONS,
  ...NATIVE_OBSERVATION_OPERATIONS,
];

describe("summary named views", () => {
  it.each(PARENTS)(
    "%s: the first named view is accepted as written and returns rows",
    (operation, evidence) => {
      const parent = parentOf(evidence());
      expect(parent.operation).toBe(operation);
      const summary = projectAnalysisView(parent, { kind: "summary" });
      if (!summary.ok) throw summary.error;
      if (summary.value.kind !== "summary") throw new Error("Not a summary");
      const views = summary.value.views ?? [];
      expect(views.length).toBeGreaterThan(0);
      expect(views.length).toBeLessThanOrEqual(SUMMARY_NAMED_VIEW_LIMIT);
      for (const named of views) {
        // The arguments are the complete inspect_analysis_view input.
        const input = inspectAnalysisViewInputSchema.parse(named.arguments);
        expect(input.source).toEqual({
          kind: "retained-evidence",
          evidence_id: parent.evidenceId,
        });
        const page = projectAnalysisView(parent, input.view);
        if (!page.ok) throw page.error;
        expect(page.value.coverage?.examined ?? 0).toBeGreaterThan(0);
        expect(
          page.value.coverage?.total ?? page.value.coverage?.examined,
        ).toBe(named.rows);
      }
    },
  );

  it.each(SUMMARY_PARENTS.filter((operation) => !SUMMARY_ONLY.has(operation)))(
    "%s: names candidate views that are complete inspect_analysis_view inputs",
    (operation) => {
      const candidates = summaryViewCandidates({
        evidenceId: `ev_${"a".repeat(64)}`,
        operation,
        predicateType: "rea.analysis",
        normalizedResult: null,
        limitations: [],
      });
      expect(candidates.length).toBeGreaterThan(0);
      for (const view of candidates)
        expect(
          inspectAnalysisViewInputSchema.safeParse({
            source: {
              kind: "retained-evidence",
              evidence_id: `ev_${"a".repeat(64)}`,
            },
            view,
          }).error,
        ).toBeUndefined();
    },
  );

  it("names no view that returns no rows", () => {
    const parent = parentOf(analysisViewCaptureEvidence());
    const summary = projectAnalysisView(parent, { kind: "summary" });
    if (!summary.ok || summary.value.kind !== "summary")
      throw new Error("Expected a summary");
    // The fixture capture has no protobuf bodies: that candidate is left out.
    expect(
      summary.value.views?.map((view) => view.arguments.view.kind),
    ).not.toContain("protobuf");
  });
});
