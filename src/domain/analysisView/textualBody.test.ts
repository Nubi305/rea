import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { scenarioCaptureEvidence } from "../../../tests/fixtures/browserScenarioCapture.js";
import { projectAnalysisView } from "./analysisView.js";
import { isTextualMediaType } from "./textualBody.js";

const contentBodies = (collection: "events" | "transactions") => {
  const evidence = scenarioCaptureEvidence();
  const projected = projectAnalysisView(
    {
      evidenceId: evidence.evidence_id,
      operation: evidence.operation,
      predicateType: evidence.predicate_type,
      normalizedResult: evidence.normalized_result,
      subject: evidence.subject,
      limitations: evidence.limitations,
    },
    {
      kind: "browser-scenario",
      collection,
      event_kinds: ["network-content"],
      offset: 0,
      limit: 64,
    },
  );
  if (!projected.ok) throw projected.error;
  if (projected.value.kind !== "browser-scenario")
    throw new Error("Not a browser-scenario page");
  const items = projected.value.items;
  const rows =
    items.collection === "events"
      ? items.rows
      : items.collection === "transactions"
        ? items.rows.flatMap((row) => row.events)
        : [];
  return rows.flatMap(({ event }) =>
    event.kind === "network-content" && event.body.state === "captured"
      ? [event.body]
      : [],
  );
};

it.each(["events", "transactions"] as const)(
  "states a captured JSON body as text in %s pages, with the recorded digest",
  (collection) => {
    const bodies = contentBodies(collection);
    const login = bodies.find(
      (body) => "text" in body && body.text === '{"id":2,"login":"probe"}',
    );
    expect(login).toMatchObject({
      encoding: "utf-8",
      media_type: expect.stringContaining("json"),
      bytes: 24,
      sha256: createHash("sha256")
        .update('{"id":2,"login":"probe"}')
        .digest("hex"),
    });
    expect(login).not.toHaveProperty("content");
  },
);

it("keeps base64 for bytes that are not text", () => {
  const binary = contentBodies("events").find(
    (body) => "content" in body && body.content === "//4AQQ==",
  );
  expect(binary).toMatchObject({ encoding: "base64", bytes: 4 });
});

it.each([
  ["application/json; charset=utf-8", true],
  ["application/problem+json", true],
  ["text/html", true],
  ["application/x-www-form-urlencoded", true],
  ["image/png", false],
  ["application/octet-stream", false],
  [null, false],
] as const)("treats %s as textual: %s", (mediaType, textual) => {
  expect(isTextualMediaType(mediaType)).toBe(textual);
});
