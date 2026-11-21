import { expect, it } from "vitest";
import {
  analysisViewCaptureEvidence,
  analysisViewCaptureFixture,
} from "../../../tests/fixtures/analysisView.js";
import { webNetworkCaptureSchema } from "../webNetworkCapture.js";
import { projectAnalysisView } from "./analysisView.js";
import { EVERY_RECORD_LIMITATIONS } from "./webNetworkCaptureView.js";

const SHARED = "HAR text without an encoding declaration is producer-decoded.";
const OWN = "This record's body is truncated.";

const page = (detail: "preview" | "complete") => {
  const fixture = analysisViewCaptureFixture();
  const capture = webNetworkCaptureSchema.parse({
    ...fixture,
    records: fixture.records.map((record, index) => ({
      ...record,
      limitations: index === 2 ? [SHARED, OWN] : [SHARED],
    })),
  });
  const evidence = analysisViewCaptureEvidence(capture);
  const projected = projectAnalysisView(
    {
      evidenceId: evidence.evidence_id,
      operation: evidence.operation,
      predicateType: evidence.predicate_type,
      normalizedResult: evidence.normalized_result,
      subject: evidence.subject,
      limitations: evidence.limitations,
    },
    { kind: "capture", detail, offset: 0, limit: 4 },
  );
  if (!projected.ok) throw projected.error;
  if (projected.value.kind !== "capture") throw new Error("Not a capture page");
  return projected.value;
};

it("states a record limitation every previewed record carries once per page", () => {
  const preview = page("preview");
  const stated = [
    ...preview.limitations,
    ...preview.items.flatMap((item) => item.limitations),
  ];
  expect(stated.filter((sentence) => sentence === SHARED)).toHaveLength(1);
  expect(preview.limitations).toEqual(
    expect.arrayContaining([EVERY_RECORD_LIMITATIONS, SHARED]),
  );
  // A record's own limitation stays on that record.
  expect(preview.items.map((item) => item.limitations)).toEqual([
    [],
    [],
    [OWN],
    [],
  ]);
});

it("keeps complete records as recorded", () => {
  const complete = page("complete");
  expect(
    complete.items.every((item) => item.limitations.includes(SHARED)),
  ).toBe(true);
  expect(complete.limitations).not.toContain(EVERY_RECORD_LIMITATIONS);
});
