import { describe, expect, it } from "vitest";

import { scriptCaptureEvidenceFixture } from "../../tests/fixtures/webScriptCapture.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { createEvidence, type Evidence } from "../domain/evidence.js";
import { createEvidenceBundle } from "../domain/evidenceBundle.js";
import { EvidenceIntegrityError } from "../domain/evidenceErrors.js";
import { unknownTarget } from "../domain/targetIdentity.js";
import { savedBundleCapture } from "./EvidenceBundleCapture.js";

const SITE = {
  operation: "export_web_scripts",
  path: ["capture_path"],
  captureOperations: ["inspect_web_page", "capture_browser_scenario"],
} as const;

const provider = { id: "fixture", name: "Fixture", version: "1" };

/** A second capture record of the same operation, with its own identity. */
const otherCapture = (): Evidence =>
  createEvidence(unknownTarget("not-observed"), provider, {
    operation: "capture_browser_scenario",
    parameters: { run: 2 },
    result: scriptCaptureEvidenceFixture().normalized_result,
  });

const note = (): Evidence =>
  createEvidence(unknownTarget("not-observed"), provider, {
    operation: "observe",
    parameters: {},
    result: { observed: true },
  });

/** A bundle as a file holds it: plain JSON, re-read from text. */
const saved = (records: readonly Evidence[]): unknown =>
  JSON.parse(JSON.stringify(createEvidenceBundle(records)));

const refusal = (records: readonly Evidence[]) => {
  const selected = savedBundleCapture(saved(records), "/run/crawl.json", SITE);
  if (selected === undefined || selected.ok)
    throw new Error("Expected a refusal");
  return projectAnalysisError(selected.error);
};

describe("savedBundleCapture", () => {
  it("selects the one capture record of a saved bundle, beside records of other operations", () => {
    const capture = scriptCaptureEvidenceFixture();
    for (const records of [[capture], [note(), capture]]) {
      const selected = savedBundleCapture(
        saved(records),
        "/run/crawl.json",
        SITE,
      );
      if (selected === undefined || !selected.ok)
        throw new Error("Expected the capture record");
      expect(selected.value.evidence_id).toBe(capture.evidence_id);
      expect(selected.value.normalized_result).toEqual(
        capture.normalized_result,
      );
    }
  });

  it("leaves one Evidence record and a normalized result to the command's own reader", () => {
    const capture = scriptCaptureEvidenceFixture();
    expect(
      savedBundleCapture(capture, "/run/crawl.json", SITE),
    ).toBeUndefined();
    expect(
      savedBundleCapture(capture.normalized_result, "/run/crawl.json", SITE),
    ).toBeUndefined();
  });

  it("refuses a bundle of several captures, naming the count, the records and what to pass", () => {
    const first = scriptCaptureEvidenceFixture();
    const second = otherCapture();
    const refused = refusal([first, second]);
    expect(refused).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "export_web_scripts",
        issues: [{ path: ["capture_path"], reason: "invalid_value" }],
      },
    });
    expect(refused.message).toContain(
      "/run/crawl.json is an Evidence bundle holding 2 capture records",
    );
    expect(refused.message).toContain(first.evidence_id);
    expect(refused.message).toContain(second.evidence_id);
    expect(refused.message).toContain(
      "exactly one inspect_web_page or capture_browser_scenario record",
    );
    expect(refused.message).toContain("--evidence_output");
  });

  it("refuses a bundle without a capture, naming what it holds instead", () => {
    const other = note();
    const refused = refusal([other]);
    expect(refused.message).toContain(
      "is an Evidence bundle holding 0 capture records among its 1 record",
    );
    expect(refused.message).toContain(`${other.evidence_id} (observe)`);
    expect(refusal([]).message).toContain(
      "is an Evidence bundle holding 0 capture records.",
    );
  });

  it("refuses an edited bundle through the bundle owner, not as a capture count", () => {
    const edited = saved([scriptCaptureEvidenceFixture()]) as {
      records: { normalized_result: { limitations: string[] } }[];
    };
    edited.records[0]?.normalized_result.limitations.push("edited");
    const selected = savedBundleCapture(edited, "/run/crawl.json", SITE);
    if (selected === undefined || selected.ok)
      throw new Error("Expected a refusal");
    expect(selected.error).toBeInstanceOf(EvidenceIntegrityError);
    expect(projectAnalysisError(selected.error).message).not.toContain(
      "capture records",
    );
  });
});
