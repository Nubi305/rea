import type { ApplicationNode } from "../javascript/javascriptApplicationGraphSchemas.js";
import type { JsonValue } from "../jsonValue.js";
import { summaryFinding, type SummaryFinding } from "./summaryFindings.js";

type Observation = ApplicationNode["observations"][number];

const text = (value: JsonValue | undefined): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** `call:fetch` reads as `fetch`; other mechanisms are kept as recorded. */
const mechanismName = (observation: Observation): string => {
  const mechanism = text(observation.properties.mechanism) ?? "unknown";
  return mechanism.startsWith("call:") ? mechanism.slice(5) : mechanism;
};

/** How far a row can be trusted, when it is less than an exact observation. */
const qualifiers = (observation: Observation): string => {
  const notes: string[] = [];
  if (observation.properties.interpretation === "candidate")
    notes.push("candidate");
  if (observation.properties.resolution === "partial") notes.push("partial");
  if (observation.evidence.state !== "observed")
    notes.push(observation.evidence.state);
  return notes.length === 0 ? "" : ` (${[...new Set(notes)].join(", ")})`;
};

/** Observed rows first, then inferred ones, each in retained order. */
const observedFirst = (
  rows: readonly { readonly line: string; readonly observed: boolean }[],
): string[] => [
  ...new Set([
    ...rows.filter((row) => row.observed).map((row) => row.line),
    ...rows.filter((row) => !row.observed).map((row) => row.line),
  ]),
];

const observationsOf = (
  nodes: readonly ApplicationNode[],
  kinds: ReadonlySet<string>,
  line: (node: ApplicationNode, observation: Observation) => string,
): string[] =>
  observedFirst(
    nodes.flatMap((node) =>
      kinds.has(node.kind)
        ? node.observations.map((observation) => ({
            line: line(node, observation),
            observed:
              observation.evidence.state === "observed" &&
              observation.properties.interpretation !== "candidate",
          }))
        : [],
    ),
  );

export const ENDPOINT_KINDS = new Set(["endpoint"]);
export const IPC_KINDS = new Set(["ipc-channel", "ipc-handler"]);
export const ENTRY_KINDS = new Set([
  "electron-main",
  "electron-preload",
  "electron-renderer",
  "electron-utility",
  "worker",
  "service-worker",
]);

const label = (observation: Observation): string =>
  text(observation.properties.value) ??
  text(observation.properties.channel) ??
  text(observation.properties.resolved_path) ??
  text(observation.properties.declared_path) ??
  text(observation.properties.path) ??
  observation.label ??
  "(unnamed)";

/** The facts views that page each finding; the summary names the same ones. */
export const JAVASCRIPT_FINDING_VIEWS = {
  endpoints: () => factsView(ENDPOINT_KINDS, ["mechanism", "value"]),
  ipc_channels: () => factsView(IPC_KINDS, ["channel", "value", "mechanism"]),
  entry_points: () =>
    factsView(ENTRY_KINDS, ["resolved_path", "declared_path", "mechanism"]),
};

const factsView = (
  kinds: ReadonlySet<string>,
  propertyKeys: readonly string[],
) => ({
  kind: "javascript-facts",
  where: { kinds: [...kinds] },
  property_keys: [...propertyKeys],
});

/**
 * The application's first findings: the endpoints it requests, its IPC
 * channels and its entry points, one line each, with the view that pages
 * every recorded observation of that kind.
 */
export const javascriptSummaryFindings = (
  nodes: readonly ApplicationNode[],
): SummaryFinding[] => [
  summaryFinding(
    "endpoints",
    observationsOf(
      nodes,
      ENDPOINT_KINDS,
      (_node, observation) =>
        `${mechanismName(observation)} ${label(observation)}${qualifiers(observation)}`,
    ),
    JAVASCRIPT_FINDING_VIEWS.endpoints(),
  ),
  summaryFinding(
    "ipc_channels",
    observationsOf(
      nodes,
      IPC_KINDS,
      (node, observation) =>
        `${node.kind} ${mechanismName(observation)} ${label(observation)}${qualifiers(observation)}`,
    ),
    JAVASCRIPT_FINDING_VIEWS.ipc_channels(),
  ),
  summaryFinding(
    "entry_points",
    observationsOf(
      nodes,
      ENTRY_KINDS,
      (node, observation) =>
        `${node.kind} ${label(observation)}${qualifiers(observation)}`,
    ),
    JAVASCRIPT_FINDING_VIEWS.entry_points(),
  ),
];
