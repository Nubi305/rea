import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { expect } from "vitest";

import { evidenceFileBytes } from "../../../src/application/environment/environmentEvidenceBytes.js";
import { parseEvidence, type Evidence } from "../../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { environmentBuildReportSchema } from "../../../src/domain/environmentBundleExport.js";
import { webScriptExportResultSchema } from "../../../src/domain/webScriptExport.js";
import {
  scenarioCaptureEvidence,
  scenarioCaptureFixture,
} from "../../fixtures/browserScenarioCapture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { scriptCaptureEvidenceFixture } from "../../fixtures/webScriptCapture.js";
import { cliTest } from "../../support/cli/cliFixture.js";

/** The file `--detail summary --evidence_output <file>` saves: a bundle of the command's records. */
const saveBundle = async (
  root: string,
  name: string,
  records: readonly Evidence[],
): Promise<string> => {
  const path = join(root, name);
  await writeFile(path, JSON.stringify(createEvidenceBundle(records)));
  return path;
};

/** A second capture of the same scenario with its own identity. */
const laterCapture = (): Evidence =>
  scenarioCaptureEvidence({ ...scenarioCaptureFixture(), duration_ms: 77 });

const refusalMessage = (json: unknown): string =>
  String((json as { message?: unknown }).message);

cliTest(
  "environment-build reads the capture bundle --evidence_output saves and ships its one record",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-saved-capture-build-");
    const capture = scenarioCaptureEvidence();
    const bundle = await saveBundle(root, "crawl.json", [capture]);
    const record = join(root, "record.json");
    await writeFile(record, evidenceFileBytes(capture));

    const planned = await cli.run({
      arguments: ["environment-build", bundle, "--dry-run", "--json"],
    });
    expect(planned.exitCode, planned.stderr).toBe(0);
    const fromRecord = await cli.run({
      arguments: ["environment-build", record, "--dry-run", "--json"],
    });
    expect(fromRecord.exitCode, fromRecord.stderr).toBe(0);
    const plan = environmentBuildReportSchema.parse(planned.json);
    expect(plan.capture).toMatchObject({
      evidence_id: capture.evidence_id,
      operation: "capture_browser_scenario",
      input: "evidence",
    });
    // The bundle and its one record plan the same environment, file for file.
    expect({ ...plan, name: null, warnings: null, files: null }).toEqual({
      ...environmentBuildReportSchema.parse(fromRecord.json),
      name: null,
      warnings: null,
      files: null,
    });

    const output = join(root, "built");
    const built = await cli.run({
      arguments: [
        "environment-build",
        bundle,
        output,
        "--name",
        "crawl",
        "--json",
      ],
    });
    expect(built.exitCode, built.stderr).toBe(0);
    const shipped = await readFile(join(output, "envs/crawl/evidence.json"));
    expect(shipped.equals(evidenceFileBytes(capture))).toBe(true);
    expect(
      parseEvidence(JSON.parse(shipped.toString("utf8"))).evidence_id,
    ).toBe(capture.evidence_id);
  },
);

cliTest(
  "export-web-scripts reads the capture bundle --evidence_output saves and links its one record",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-saved-capture-scripts-");
    const capture = scriptCaptureEvidenceFixture();
    const bundle = await saveBundle(root, "crawl.json", [capture]);
    const exported = await cli.run({
      arguments: [
        "export-web-scripts",
        bundle,
        join(root, "scripts"),
        "--json",
      ],
    });
    expect(exported.exitCode, exported.stderr).toBe(0);
    const evidence = parseEvidence(exported.json);
    expect(evidence.evidence_links).toEqual([capture.evidence_id]);
    expect(evidence.subject.identity).toMatchObject({
      sha256: createHash("sha256")
        .update(await readFile(bundle))
        .digest("hex"),
    });
    const result = webScriptExportResultSchema.parse(
      evidence.normalized_result,
    );
    expect(result.capture_kind).toBe("browser-scenario");
    expect(result.scripts.map(({ content }) => content.state)).toEqual([
      "exported",
    ]);
  },
);

cliTest(
  "both commands refuse a bundle that does not hold one capture, saying it is a bundle and how many it holds",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-saved-capture-refuse-");
    const first = scenarioCaptureEvidence();
    const second = laterCapture();
    expect(second.evidence_id).not.toBe(first.evidence_id);
    const two = await saveBundle(root, "two.json", [first, second]);
    const none = await saveBundle(root, "none.json", []);
    for (const [file, held] of [
      [two, "holding 2 capture records"],
      [none, "holding 0 capture records"],
    ] as const) {
      const build = await cli.run({
        arguments: ["environment-build", file, "--dry-run", "--json"],
      });
      expect(build.exitCode, build.stdout).toBe(1);
      expect(refusalMessage(build.json)).toContain(
        `${file} is an Evidence bundle ${held}`,
      );
      expect(refusalMessage(build.json)).toContain(
        "exactly one inspect_web_network_capture or capture_browser_scenario record",
      );
      const scripts = await cli.run({
        arguments: [
          "export-web-scripts",
          file,
          join(root, "scripts"),
          "--json",
        ],
      });
      expect(scripts.exitCode, scripts.stdout).toBe(1);
      expect(refusalMessage(scripts.json)).toContain(
        `${file} is an Evidence bundle ${held}`,
      );
      expect(refusalMessage(scripts.json)).toContain(
        "exactly one inspect_web_page or capture_browser_scenario record",
      );
    }
  },
);
