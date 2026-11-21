import { z } from "zod";
import { retainedEvidenceReferenceSchema } from "../evidenceReference.js";
import { jsonObjectSchema, type JsonValue } from "../jsonValue.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import type { Result } from "../result.js";
import { NATIVE_INVENTORY_OPERATIONS } from "../native/nativeInventory.js";
import { NATIVE_OBSERVATION_OPERATIONS } from "../native/nativeObservation.js";
import {
  analysisViewRequestSchema,
  type AnalysisViewRequest,
} from "./analysisViewRequest.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import { JAVASCRIPT_FINDING_VIEWS } from "./javascriptSummaryFindings.js";

/** At most this many views are named by one summary. */
export const SUMMARY_NAMED_VIEW_LIMIT = 6;

/** Rows a named page asks for: enough to read, small enough to stay cheap. */
const NAMED_PAGE_ROWS = 20;

/**
 * One view of the summarised record, as the inspect_analysis_view arguments
 * that run as written against the retained parent, with the number of rows
 * the view pages.
 */
export const summaryNamedViewSchema = z.strictObject({
  rows: z.int().nonnegative(),
  arguments: z.strictObject({
    source: retainedEvidenceReferenceSchema,
    view: jsonObjectSchema,
  }),
});
export type SummaryNamedView = z.output<typeof summaryNamedViewSchema>;

type ViewInput = Readonly<Record<string, JsonValue>>;

const collection =
  (kind: string) =>
  (name: string, extra: ViewInput = {}): ViewInput => ({
    kind,
    collection: name,
    ...extra,
    limit: NAMED_PAGE_ROWS,
  });
const facet =
  (kind: string) =>
  (name: string): ViewInput => ({
    kind,
    facet: name,
    limit: NAMED_PAGE_ROWS,
  });

const javascriptFacts = (
  kinds: readonly string[],
  propertyKeys: readonly string[],
): ViewInput => ({
  kind: "javascript-facts",
  where: { kinds: [...kinds] },
  property_keys: [...propertyKeys],
  limit: NAMED_PAGE_ROWS,
});

/** A finding's view, asking for one named page of rows. */
const paged = (view: ViewInput): ViewInput => ({
  ...view,
  limit: NAMED_PAGE_ROWS,
});

const inventory = collection("inventory");
const elf = collection("elf-dependencies");
const loadImage = collection("native-load-image");
const beam = collection("beam");
const devicetree = collection("devicetree");
const go = collection("go");
const rust = collection("rust");
const desktop = collection("desktop-application");
const wasm = facet("wasm");
const macho = facet("macho");
const ib = collection("interface-builder");
const managed = collection("managed");
const members = collection("managed-members");
const jni = collection("android-jni");
const dart = collection("dart-aot");
const il2cpp = collection("il2cpp-metadata");
const apk = collection("apk-signature");
const model = collection("model-artifact");
const gpu = collection("gpu-code-objects");
const matches = collection("function-matches");
const sourceToBundle = collection("source-to-bundle");
const apiContract = collection("api-contract");
const graphql = collection("graphql-contract");
const trace = collection("playwright-trace");
const comparison = collection("endpoint-comparison");
const feature = collection("feature-trace");
const nativeFeature = collection("native-feature-trace");
const scenario = collection("browser-scenario");
const pcap = facet("pcap");
const webBundle = collection("web-bundle");
const routes = collection("javascript-routes");
const nativeFacet = facet("native");

const NATIVE_FUNCTION_VIEWS = [
  nativeFacet("pseudocode"),
  nativeFacet("callees"),
  nativeFacet("callers"),
  nativeFacet("referenced_strings"),
  nativeFacet("assembly"),
  nativeFacet("outgoing_references"),
];

/**
 * The views each parent operation offers, most useful first. A candidate is
 * named only when it runs against the summarised record and returns rows, so
 * a list may hold views that some records of the operation do not have.
 */
const CANDIDATES = new Map<string, readonly ViewInput[]>([
  [
    "analyze_javascript_application",
    [
      paged(JAVASCRIPT_FINDING_VIEWS.endpoints()),
      paged(JAVASCRIPT_FINDING_VIEWS.ipc_channels()),
      paged(JAVASCRIPT_FINDING_VIEWS.entry_points()),
      routes("routes"),
      {
        kind: "javascript",
        collection: "modules",
        projection: "references",
        limit: NAMED_PAGE_ROWS,
      },
      javascriptFacts(["storage"], ["value"]),
    ],
  ],
  ["analyze_web_bundle", [webBundle("endpoints"), webBundle("inferences")]],
  [
    "inspect_web_network_capture",
    [
      { kind: "capture", limit: NAMED_PAGE_ROWS },
      { kind: "api-surface", limit: NAMED_PAGE_ROWS },
      { kind: "environment-manifest" },
      collection("protobuf")("bodies"),
    ],
  ],
  [
    "inspect_pcap_capture",
    [
      pcap("endpoints"),
      pcap("http-uris"),
      pcap("dns-queries"),
      pcap("tls-sni"),
      pcap("protocols"),
      pcap("unattributed-addresses"),
    ],
  ],
  [
    "inspect_artifact",
    [inventory("occurrences"), inventory("nodes"), inventory("edges")],
  ],
  [
    "inventory_artifact",
    [inventory("occurrences"), inventory("nodes"), inventory("edges")],
  ],
  [
    "capture_browser_scenario",
    [scenario("transactions"), scenario("steps"), scenario("events")],
  ],
  [
    "inspect_binary_layout",
    [
      {
        kind: "page",
        collection: "symbols",
        offset: 0,
        limit: NAMED_PAGE_ROWS,
      },
      {
        kind: "page",
        collection: "sections",
        offset: 0,
        limit: NAMED_PAGE_ROWS,
      },
      { kind: "facet", facet: "mitigations" },
      { kind: "facet", facet: "linkage" },
    ],
  ],
  ["analyze_function", NATIVE_FUNCTION_VIEWS],
  ["procedure_pseudo_code", [nativeFacet("pseudocode")]],
  ...NATIVE_INVENTORY_OPERATIONS.map(
    (operation) =>
      [
        operation,
        [{ kind: "native-inventory", limit: NAMED_PAGE_ROWS }],
      ] as const,
  ),
  ...NATIVE_OBSERVATION_OPERATIONS.map(
    (operation) =>
      [
        operation,
        [
          { kind: "native-observation", limit: NAMED_PAGE_ROWS },
          { kind: "native-context", facet: "overview" },
        ],
      ] as const,
  ),
  [
    "procedure_references",
    [
      collection("native-procedure-references")("references"),
      collection("native-procedure-references")("unresolved_calls"),
    ],
  ],
  [
    "inspect_native_instruction",
    [
      collection("native-instruction-references")("references"),
      collection("native-instruction-references")("incoming_references"),
    ],
  ],
  [
    "trace_feature",
    [
      nativeFeature("matches"),
      nativeFeature("references"),
      nativeFeature("unknowns"),
    ],
  ],
  [
    "inspect_erlang_beam",
    [
      beam("exports"),
      beam("imports"),
      beam("lambdas"),
      beam("atoms"),
      beam("chunks"),
    ],
  ],
  [
    "inspect_devicetree",
    [
      devicetree("nodes"),
      devicetree("properties"),
      devicetree("references"),
      devicetree("reservations"),
    ],
  ],
  [
    "inspect_native_exports",
    [
      collection("native-exports")("exports"),
      collection("native-exports")("issues"),
    ],
  ],
  [
    "inspect_elf_dependencies",
    [
      elf("needed"),
      elf("imports"),
      elf("versions"),
      elf("definitions"),
      elf("maxima"),
      elf("issues"),
    ],
  ],
  [
    "inspect_native_load_image",
    [
      loadImage("entry_points"),
      loadImage("sections"),
      loadImage("mappings"),
      loadImage("source_files"),
      loadImage("relocations"),
      loadImage("checks"),
    ],
  ],
  ["inspect_python_pyc", [collection("python-pyc")("code_objects")]],
  [
    "inspect_go_binary",
    [go("dependencies"), go("settings"), go("string_literals")],
  ],
  ["inspect_rust_binary", [rust("packages"), rust("edges")]],
  [
    "inspect_desktop_application",
    [
      desktop("components"),
      desktop("candidates"),
      desktop("files"),
      desktop("next_probes"),
      desktop("omissions"),
    ],
  ],
  [
    "inspect_wasm_artifact",
    [
      wasm("exports"),
      wasm("imports"),
      wasm("sections"),
      wasm("candidates"),
      wasm("glue"),
    ],
  ],
  [
    "inspect_macho",
    [
      macho("entrypoints"),
      macho("dependencies"),
      macho("imports"),
      macho("exports"),
      macho("segments"),
      macho("load_commands"),
    ],
  ],
  [
    "decode_interface_builder",
    [ib("documents"), ib("nodes"), ib("edges"), ib("coverage")],
  ],
  ["inspect_evm_interface", [facet("evm")("functions")]],
  [
    "inspect_managed_artifact",
    [managed("references"), managed("resources"), managed("attributes")],
  ],
  [
    "inspect_managed_members",
    [
      members("types"),
      members("methods"),
      members("fields"),
      members("user_strings"),
      members("call_edges"),
      members("member_refs"),
    ],
  ],
  [
    "inspect_android_package",
    [
      { kind: "android", facet: "components", limit: NAMED_PAGE_ROWS },
      { kind: "android", facet: "manifest", limit: 4096 },
    ],
  ],
  [
    "inspect_android_jni_bindings",
    [jni("bindings"), jni("declarations"), jni("libraries"), jni("candidates")],
  ],
  [
    "inspect_dart_aot",
    [dart("package_uris"), dart("dart_uris"), dart("class_like_tokens")],
  ],
  [
    "inspect_il2cpp_metadata",
    [
      il2cpp("images"),
      il2cpp("types"),
      il2cpp("methods"),
      il2cpp("string_literals"),
      il2cpp("method_addresses"),
      il2cpp("fields"),
    ],
  ],
  ["inspect_apk_signature", [apk("signers"), apk("digests"), apk("lineage")]],
  [
    "inspect_model_artifact",
    [model("tensors"), model("metadata"), model("types")],
  ],
  [
    "inspect_gpu_code_objects",
    [gpu("kernels"), gpu("objects"), gpu("targets")],
  ],
  [
    "match_native_functions",
    [matches("matches"), matches("functions"), matches("byte-sources")],
  ],
  [
    "compare_source_to_bundle",
    [sourceToBundle("mappings"), sourceToBundle("candidates")],
  ],
  [
    "inspect_api_contract",
    [
      apiContract("operations"),
      apiContract("diagnostics"),
      apiContract("path-item-references"),
      graphql("types"),
      graphql("fields"),
      graphql("definitions"),
    ],
  ],
  [
    "inspect_playwright_trace",
    [trace("events"), trace("streams"), trace("members"), trace("diagnostics")],
  ],
  [
    "compare_static_and_observed_endpoints",
    [
      comparison("matches"),
      comparison("static-endpoints"),
      comparison("observed-groups"),
    ],
  ],
  [
    "trace_application_feature",
    [
      feature("paths"),
      feature("nodes"),
      feature("edges"),
      feature("seed_matches"),
      feature("native_handoffs"),
    ],
  ],
  ["batch_decompile", [collection("batch-decompile")("items")]],
  ["trace_web_source_location", [collection("source-location")("matches")]],
]);

/** Arrays recorded at the top of the provider's raw result, each a recorded-array page. */
const recordedArrayCandidates = (parent: AnalysisViewParent): ViewInput[] => {
  const raw = parent.rawResult;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
  return Object.entries(raw)
    .filter(([, value]) => Array.isArray(value) && value.length > 0)
    .map(([key]) => ({
      kind: "recorded-array",
      path: [key],
      limit: NAMED_PAGE_ROWS,
    }));
};

/** The view candidates of one parent, most useful first. */
export const summaryViewCandidates = (
  parent: AnalysisViewParent,
): readonly ViewInput[] => [
  ...(CANDIDATES.get(parent.operation) ?? []),
  ...recordedArrayCandidates(parent),
];

/**
 * Name the views that run against this parent and return rows, most useful
 * first. `project` is the same projection inspect_analysis_view runs, so a
 * named view is one the caller can run as written.
 */
export const nameSummaryViews = (
  parent: AnalysisViewParent,
  project: (view: AnalysisViewRequest) => Result<
    {
      readonly coverage: {
        readonly examined: number;
        readonly total: number | null;
      } | null;
    },
    AnalysisError
  >,
): SummaryNamedView[] => {
  const named: SummaryNamedView[] = [];
  for (const candidate of summaryViewCandidates(parent)) {
    if (named.length >= SUMMARY_NAMED_VIEW_LIMIT) break;
    const request = analysisViewRequestSchema.safeParse(candidate);
    if (!request.success) continue;
    const projected = project(request.data);
    const coverage = projected.ok ? projected.value.coverage : null;
    if (coverage === null || coverage.examined === 0) continue;
    named.push({
      rows: coverage.total ?? coverage.examined,
      arguments: {
        source: { kind: "retained-evidence", evidence_id: parent.evidenceId },
        view: candidate,
      },
    });
  }
  return named;
};
