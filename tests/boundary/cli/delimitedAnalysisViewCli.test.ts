import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { ARTIFACT_COMPARISON_EXAMPLE } from "../../../src/contracts/artifactComparisonExample.js";
import { analysisViewCaptureEvidence } from "../../fixtures/analysisView.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "shows how to export inventory rows in command help",
  async ({ cli }) => {
    const result = await cli.run({
      arguments: ["inspect-analysis-view", "--help"],
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--format csv");
    expect(result.stdout).toContain("--format tsv");
    expect(result.stdout).toContain("--filter-output normalized_result.items");
    expect(result.stdout).toContain("--columns logical_path,artifact_id");
  },
);

cliTest(
  "exports selected artifact inventory columns through the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-delimited-view-cli-");
    const request = join(root, "view.json");
    const parent = ARTIFACT_COMPARISON_EXAMPLE.left;
    await writeFile(
      request,
      JSON.stringify({
        source: { kind: "inline", evidence: parent },
        view: {
          kind: "inventory",
          collection: "occurrences",
          fields: ["logical_path", "artifact_id"],
        },
      }),
    );

    for (const format of ["csv", "tsv"] as const) {
      const delimiter = format === "csv" ? "," : "\t";
      const result = await cli.run({
        arguments: [
          "inspect-analysis-view",
          request,
          "--format",
          format,
          "--filter-output",
          "normalized_result.items",
          "--columns",
          "logical_path,artifact_id",
        ],
      });
      expect(result.exitCode).toBe(0);
      const lineEnding = format === "csv" ? "\r\n" : "\n";
      const metadataEnd = result.stdout.indexOf(lineEnding);
      const [header, row] = result.stdout
        .slice(metadataEnd + lineEnding.length)
        .trimEnd()
        .split(/\r?\n/u);
      expect(
        JSON.parse(
          result.stdout
            .slice(0, metadataEnd)
            .slice("# rea-delimited-v1 ".length),
        ),
      ).toMatchObject({
        format,
        selected_path: ["normalized_result", "items"],
        coverage: { total: 1, exhausted: true },
        provenance: {
          parent_evidence_id: parent.evidence_id,
          parent_operation: "inventory_artifact",
        },
      });
      expect(header).toBe(["logical_path", "artifact_id"].join(delimiter));
      expect(row?.split(delimiter)).toEqual([
        ".",
        expect.stringMatching(/^art_[a-f0-9]{64}$/u),
      ]);
    }
  },
);

cliTest(
  "exports nested capture record fields as CSV columns by dotted path",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-delimited-capture-cli-");
    const request = join(root, "view.json");
    await writeFile(
      request,
      JSON.stringify({
        source: { kind: "inline", evidence: analysisViewCaptureEvidence() },
        view: { kind: "capture", offset: 0, limit: 2 },
      }),
    );
    const result = await cli.run({
      arguments: [
        "inspect-analysis-view",
        request,
        "--format",
        "csv",
        "--filter-output",
        "normalized_result.items",
        "--columns",
        "ordinal,reported.request.method,reported.response.status",
      ],
    });
    expect(result.exitCode, result.stdout).toBe(0);
    const lines = result.stdout.split("\r\n");
    expect(lines.slice(1, 4)).toEqual([
      "ordinal,reported.request.method,reported.response.status",
      "0,GET,200",
      "1,GET,404",
    ]);
  },
);
