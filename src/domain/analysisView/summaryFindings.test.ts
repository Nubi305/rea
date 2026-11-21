import { describe, expect, it } from "vitest";
import type { Evidence } from "../evidence.js";
import {
  analysisViewCaptureEvidence,
  analysisViewCaptureFixture,
} from "../../../tests/fixtures/analysisView.js";
import { scenarioCaptureEvidence } from "../../../tests/fixtures/browserScenarioCapture.js";
import { projectAnalysisView } from "./analysisView.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import { captureSummaryFindings } from "./captureSummaryFindings.js";
import { artifactSummaryFindings } from "./artifactSummaryFindings.js";
import { javascriptSummaryFindings } from "./javascriptSummaryFindings.js";
import type { ApplicationNode } from "../javascript/javascriptApplicationGraphSchemas.js";
import {
  SUMMARY_FINDING_ROWS,
  summaryFinding,
  type SummaryFinding,
} from "./summaryFindings.js";

const parentOf = (evidence: Evidence): AnalysisViewParent => ({
  evidenceId: evidence.evidence_id,
  operation: evidence.operation,
  predicateType: evidence.predicate_type,
  normalizedResult: evidence.normalized_result,
  rawResult: evidence.raw_result,
  parameters: evidence.parameters,
  subject: evidence.subject,
  limitations: evidence.limitations,
});

const findingsOf = (evidence: Evidence): readonly SummaryFinding[] => {
  const summary = projectAnalysisView(parentOf(evidence), { kind: "summary" });
  if (!summary.ok) throw summary.error;
  if (summary.value.kind !== "summary") throw new Error("Not a summary");
  // Findings lead the summary, ahead of its counts.
  expect(Object.keys(summary.value).slice(0, 3)).toEqual([
    "kind",
    "view",
    "findings",
  ]);
  return summary.value.findings ?? [];
};

describe("summary findings", () => {
  it("states a capped number of rows, the count left out and the view that pages them", () => {
    const rows = Array.from({ length: 27 }, (_, index) => `row ${index}`);
    expect(summaryFinding("rows", rows, { kind: "capture" })).toEqual({
      name: "rows",
      rows: rows.slice(0, SUMMARY_FINDING_ROWS),
      total: 27,
      omitted: 27 - SUMMARY_FINDING_ROWS,
      view: { kind: "capture" },
    });
  });

  it("lists a capture's requests failed first, then slowest first", () => {
    const capture = analysisViewCaptureFixture();
    const [finding] = findingsOf(analysisViewCaptureEvidence(capture));
    expect(finding?.name).toBe("requests_failed_first_then_slowest");
    // The finding points at the named view that pages every record.
    expect(finding?.view).toBe(0);
    // Record 1 is the fixture's 404; records without a response follow it.
    expect(finding?.rows[0]).toMatch(/^#1 GET \S+ 404/u);
    const statuses = finding!.rows.map((row) => row.split(" ")[3]);
    const firstSuccess = statuses.findIndex((status) => status === "200");
    expect(
      statuses
        .slice(firstSuccess)
        .every((status) => status !== undefined && Number(status) < 400),
    ).toBe(true);
    expect(finding?.total).toBe(finding!.rows.length + finding!.omitted);
  });

  it("orders requests that succeeded by time, slowest first", () => {
    const record = (ordinal: number, status: number, time: number) => ({
      ordinal,
      reported: {
        time,
        request: { method: "GET", url: `https://a.test/${ordinal}` },
        response: { status },
      },
    });
    const [finding] = captureSummaryFindings([
      record(0, 200, 10),
      record(1, 500, 5),
      record(2, 200, 90),
      record(3, 0, 1),
    ]);
    // Every address shares one origin: it is stated once.
    expect(finding?.origin).toBe("https://a.test");
    expect(finding?.rows).toEqual([
      "#1 GET /1 500 5ms",
      "#3 GET /3 no-response 1ms",
      "#2 GET /2 200 90ms",
      "#0 GET /0 200 10ms",
    ]);
  });

  it("lists an archive's entries largest first with size, digest and repeated content", () => {
    const occurrence = (
      logical_path: string,
      artifact_id: string | null,
      entry_kind = "file",
    ) => ({ logical_path, artifact_id, entry_kind, hash_status: "verified" });
    const [finding] = artifactSummaryFindings(
      [
        occurrence(".", "art_root"),
        occurrence("docs", null, "directory"),
        occurrence("b.txt", "art_small"),
        occurrence("a.bin", "art_large"),
        occurrence("c.txt", "art_small"),
      ],
      [
        { artifact_id: "art_root", sha256: "0".repeat(64), size: 900 },
        { artifact_id: "art_small", sha256: "1".repeat(64), size: 4 },
        { artifact_id: "art_large", sha256: "2".repeat(64), size: 70 },
      ],
    );
    expect(finding).toEqual({
      name: "entries_largest_first",
      rows: [
        `a.bin 70 B sha256 ${"2".repeat(64)}`,
        `b.txt 4 B sha256 ${"1".repeat(64)}`,
        `c.txt 4 B sha256 ${"1".repeat(64)} same content as b.txt`,
      ],
      total: 3,
      omitted: 0,
      view: { kind: "inventory", collection: "occurrences", limit: 20 },
    });
  });

  it("gives a browser scenario's steps with each request's method, address and status", () => {
    const [finding] = findingsOf(scenarioCaptureEvidence());
    expect(finding?.name).toBe("steps");
    expect(finding?.rows[0]).toMatch(/^step 0 \S+ \S+ completed/u);
    expect(finding?.rows.join("\n")).toMatch(/(GET|POST) \/\S* \d{3}/u);
  });

  it("lists the endpoints an application requests, observed before inferred", () => {
    const observation = (
      properties: Record<string, string>,
      state: "observed" | "inferred",
    ) =>
      ({
        label: null,
        properties,
        evidence: { state },
      }) as unknown as ApplicationNode["observations"][number];
    const node = (
      kind: string,
      observations: ApplicationNode["observations"],
    ) => ({ kind, observations }) as unknown as ApplicationNode;
    const findings = javascriptSummaryFindings([
      node("endpoint", [
        observation(
          {
            mechanism: "call:t.get",
            value: "weight",
            interpretation: "candidate",
          },
          "inferred",
        ),
        observation({ mechanism: "call:fetch", value: "/api/a" }, "observed"),
      ]),
      node("endpoint", [
        observation(
          { mechanism: "call:WebSocket", value: "wss://live.test/x" },
          "observed",
        ),
      ]),
      node("ipc-channel", [
        observation(
          { mechanism: "ipcMain.handle", channel: "save" },
          "observed",
        ),
      ]),
    ]);
    expect(findings.map((finding) => [finding.name, finding.rows])).toEqual([
      [
        "endpoints",
        [
          "fetch /api/a",
          "WebSocket wss://live.test/x",
          "t.get weight (candidate, inferred)",
        ],
      ],
      ["ipc_channels", ["ipc-channel ipcMain.handle save"]],
      ["entry_points", []],
    ]);
  });
});
