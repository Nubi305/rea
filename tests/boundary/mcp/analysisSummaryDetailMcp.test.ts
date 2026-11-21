import { cliTest } from "../../support/cli/cliFixture.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { byteEntropySummaryViewResultSchema } from "../../../src/domain/analysisView/analysisViewResult.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";

import { BinaryLayoutService } from "../../../src/application/binaryDiagnostics/BinaryLayoutService.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { ok } from "../../../src/domain/result.js";
import { createServer } from "../../../src/server/createServer.js";
import { analysisViewLayoutFixture } from "../../fixtures/analysisView.js";
import { BINARY_LAYOUT_TEST_PROVIDER } from "../../fixtures/binaryDiagnostics/layout.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";

const contract = toolContract("analyze_javascript_application");

const connect = async (
  retainsEvidence: boolean,
  binaryLayout?: BinaryLayoutService,
) => {
  const session = createTestBinarySession(() => {
    throw new Error("JavaScript analysis must not start a deep provider");
  });
  const server = createServer(
    retainsEvidence
      ? { kind: "session", session }
      : {
          kind: "fixed",
          analysis: {
            execute: () => {
              throw new Error("JavaScript analysis must not use a target");
            },
          },
        },
    binaryLayout === undefined ? {} : { binaryLayout },
  );
  const client = new Client(
    { name: "analysis-summary-detail", version: "1" },
    { jsonSchemaValidator: createMcpSchemaValidation() },
  );
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
};

const application = async () => {
  const root = await createTestTempDirectory("rea-summary-detail-");
  await writeFile(
    join(root, "main.js"),
    'import { helper } from "./util.js";\nexport const greet = (name) => helper(name);\n',
  );
  await writeFile(
    join(root, "util.js"),
    "export const helper = (value) => value.toUpperCase();\n",
  );
  return { input_path: root, format: "directory" };
};

const textBytes = (content: unknown): number => {
  const [first] = Array.isArray(content) ? content : [];
  if (first?.type !== "text") throw new Error("Missing MCP text result");
  return Buffer.byteLength(String(first.text));
};

it("returns the summary of complete Evidence retained for later views", async () => {
  const client = await connect(true);
  const input = await application();
  const complete = await client.callTool({
    name: contract.name,
    arguments: input,
  });
  expect(complete.isError).not.toBe(true);
  const completeEvidence = contract.outputSchema.parse(
    complete.structuredContent,
  );
  expect(completeEvidence.operation).toBe("analyze_javascript_application");

  const summary = await client.callTool({
    name: contract.name,
    arguments: { ...input, detail: "summary" },
  });
  expect(summary.isError).not.toBe(true);
  const summaryEvidence = contract.outputSchema.parse(
    summary.structuredContent,
  );
  expect(summaryEvidence).toMatchObject({
    operation: "inspect_analysis_view",
    evidence_links: [completeEvidence.evidence_id],
    normalized_result: {
      kind: "summary",
      parent_evidence_id: completeEvidence.evidence_id,
      parent_operation: "analyze_javascript_application",
    },
  });
  expect(textBytes(summary.content)).toBeLessThan(textBytes(complete.content));

  // The summary names the views of its record as arguments that run as written.
  const named = (
    summaryEvidence.normalized_result as {
      readonly views?: readonly { readonly arguments: unknown }[];
    }
  ).views;
  expect(named?.length).toBeGreaterThan(0);
  const first = await client.callTool({
    name: "inspect_analysis_view",
    arguments: named![0]!.arguments as Record<string, unknown>,
  });
  expect(first.isError).not.toBe(true);
  expect(
    parseEvidence(first.structuredContent).normalized_result,
  ).toMatchObject({
    parent_evidence_id: completeEvidence.evidence_id,
    coverage: { examined: expect.any(Number) },
  });
  expect(
    (
      parseEvidence(first.structuredContent).normalized_result as {
        readonly coverage: { readonly examined: number };
      }
    ).coverage.examined,
  ).toBeGreaterThan(0);

  const modules = await client.callTool({
    name: "inspect_analysis_view",
    arguments: {
      source: {
        kind: "retained-evidence",
        evidence_id: completeEvidence.evidence_id,
      },
      view: { kind: "page", collection: "modules", offset: 0, limit: 8 },
    },
  });
  expect(modules.isError).not.toBe(true);
  expect(modules.structuredContent).toMatchObject({
    normalized_result: {
      kind: "page",
      parent_evidence_id: completeEvidence.evidence_id,
      items: expect.arrayContaining([
        expect.objectContaining({ kind: "javascript-module", path: "main.js" }),
        expect.objectContaining({ kind: "javascript-module", path: "util.js" }),
      ]),
    },
  });
});

/** Every string of every `limitations` array in a value, with repeats. */
const limitationSentences = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(limitationSentences);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, member]) =>
    key === "limitations" && Array.isArray(member)
      ? [
          ...member.filter((entry) => typeof entry === "string"),
          ...member.flatMap(limitationSentences),
        ]
      : limitationSentences(member),
  );
};

it("states each limitation sentence once per reply and keeps every sentence reachable", async () => {
  const client = await connect(true);
  const input = await application();
  const complete = await client.callTool({
    name: contract.name,
    arguments: input,
  });
  const parent = parseEvidence(complete.structuredContent);
  // The record's sentences: what a summary of it has always stated.
  const recorded = new Set(
    (
      parent.normalized_result as unknown as {
        readonly limitations: readonly string[];
        readonly graph: { readonly limitations: readonly string[] };
        readonly semantic_graph: { readonly limitations: readonly string[] };
      }
    ).limitations,
  );
  const result = parent.normalized_result as unknown as {
    readonly graph: { readonly limitations: readonly string[] };
    readonly semantic_graph: { readonly limitations: readonly string[] };
  };
  for (const sentence of [
    ...parent.limitations,
    ...result.graph.limitations,
    ...result.semantic_graph.limitations,
  ])
    recorded.add(sentence);

  const summary = await client.callTool({
    name: contract.name,
    arguments: { ...input, detail: "summary" },
  });
  const summaryEvidence = parseEvidence(summary.structuredContent);
  const summaryResult = summaryEvidence.normalized_result as unknown as {
    readonly views: readonly { readonly arguments: Record<string, unknown> }[];
    readonly unknowns: readonly string[];
    readonly summary: Record<string, unknown>;
  };
  // A block whose counts are all zero is left out: this is no Electron app.
  expect(summaryResult.summary).not.toHaveProperty("electron");
  const view = await client.callTool({
    name: "inspect_analysis_view",
    arguments: summaryResult.views[0]!.arguments,
  });
  expect(view.isError).not.toBe(true);
  const viewEvidence = parseEvidence(view.structuredContent);

  const reachable = new Set<string>();
  for (const reply of [summaryEvidence, viewEvidence]) {
    const stated = [
      ...limitationSentences(reply),
      ...(reply.normalized_result as { unknowns: string[] }).unknowns,
    ];
    // Each sentence of the record appears once in a reply, at most.
    for (const sentence of recorded)
      expect(
        stated.filter((entry) => entry === sentence).length,
        sentence,
      ).toBeLessThanOrEqual(1);
    for (const sentence of stated) reachable.add(sentence);
  }
  // Nothing the record states became unreachable over the session.
  for (const sentence of recorded) expect(reachable).toContain(sentence);
  // The later view gives the count and where the sentences are.
  expect(viewEvidence.normalized_result).toMatchObject({
    limitations: expect.arrayContaining([
      expect.stringMatching(
        new RegExp(
          `^${String(recorded.size)} limitations of parent ${parent.evidence_id} were stated with its summary ${summaryEvidence.evidence_id} on this connection`,
          "u",
        ),
      ),
    ]),
  });
  expect(viewEvidence.limitations).toEqual([
    expect.stringMatching(
      /^\d+ limitations? of this view: normalized_result\.limitations\.$/u,
    ),
  ]);
});

it("refuses summary detail when the server cannot retain the complete Evidence", async () => {
  const client = await connect(false);
  const failure = parseMcpToolError(
    await client.callTool({
      name: contract.name,
      arguments: { ...(await application()), detail: "summary" },
    }),
  );
  expect(failure.error).toMatchObject({
    code: "capability_unavailable",
    message: expect.stringContaining("detail complete"),
  });
});

it("returns the summary of retained binary layout Evidence", async () => {
  const layout = analysisViewLayoutFixture();
  const client = await connect(
    true,
    new BinaryLayoutService({
      inspectAndClose(input, options) {
        return this.inspect(input, options);
      },
      identity: BINARY_LAYOUT_TEST_PROVIDER,
      inspect: () => Promise.resolve(ok(layout)),
    }),
  );
  const layoutContract = toolContract("inspect_binary_layout");
  const summary = await client.callTool({
    name: layoutContract.name,
    arguments: { path: layout.artifact.path, detail: "summary" },
  });
  expect(summary.isError).not.toBe(true);
  const evidence = layoutContract.outputSchema.parse(summary.structuredContent);
  expect(evidence).toMatchObject({
    operation: "inspect_analysis_view",
    normalized_result: {
      kind: "summary",
      parent_operation: "inspect_binary_layout",
    },
  });
  const [parentId] = evidence.evidence_links;
  const sections = await client.callTool({
    name: "inspect_analysis_view",
    arguments: {
      source: { kind: "retained-evidence", evidence_id: parentId },
      view: { kind: "page", collection: "sections", offset: 0, limit: 8 },
    },
  });
  expect(sections.isError).not.toBe(true);
  expect(sections.structuredContent).toMatchObject({
    normalized_result: {
      kind: "page",
      parent_evidence_id: parentId,
      items: [
        expect.objectContaining({
          index: 0,
          name: expect.objectContaining({ display: ".text" }),
        }),
        expect.objectContaining({
          index: 1,
          name: expect.objectContaining({ display: ".text" }),
        }),
        expect.objectContaining({
          index: 2,
          name: expect.objectContaining({ display: ".data" }),
        }),
      ],
    },
  });
});

cliTest(
  "retains complete entropy Evidence, summarizes runs and matches CLI JSON",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-entropy-summary-");
    const path = join(root, "bytes");
    await writeFile(path, Buffer.alloc(65536));
    const client = await connect(true);
    const input = { path, block_size: 256, offset: 7, length: 32769 };
    const complete = await client.callTool({
      name: "inspect_byte_entropy",
      arguments: input,
    });
    expect(complete.isError).not.toBe(true);
    const evidence = parseEvidence(complete.structuredContent);
    const cliResult = await cli.run({
      arguments: [
        "inspect-byte-entropy",
        path,
        "--block-size",
        "256",
        "--offset",
        "7",
        "--length",
        "32769",
        "--json",
      ],
      environment: process.env,
    });
    expect(cliResult.exitCode).toBe(0);
    expect(cliResult.signal).toBeNull();
    const cliEvidence = parseEvidence(cliResult.json);
    expect(cliEvidence.normalized_result).toEqual(evidence.normalized_result);
    expect(cliEvidence.evidence_id).toBe(evidence.evidence_id);
    const summary = await client.callTool({
      name: "inspect_byte_entropy",
      arguments: { ...input, detail: "summary" },
    });
    expect(summary.isError).not.toBe(true);
    const view = byteEntropySummaryViewResultSchema.parse(
      parseEvidence(summary.structuredContent).normalized_result,
    );
    expect(view).toMatchObject({
      parent_evidence_id: evidence.evidence_id,
      summary: {
        file_entropy: 0,
        block_count: 129,
        run_count: 1,
        top_runs: [{ offset: 7, length: 32769, classification: "low" }],
      },
    });
    const retained = await client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source: {
          kind: "retained-evidence",
          evidence_id: view.parent_evidence_id,
        },
        view: { kind: "summary" },
      },
    });
    expect(retained.isError).not.toBe(true);
    expect(parseEvidence(retained.structuredContent).normalized_result).toEqual(
      view,
    );
    expect(textBytes(summary.content)).toBeLessThan(
      textBytes(complete.content),
    );
    expect(
      (
        await client.callTool({
          name: "inspect_analysis_view",
          arguments: {
            source: {
              kind: "retained-evidence",
              evidence_id: view.parent_evidence_id,
            },
            view: { kind: "page", collection: "sections", offset: 0, limit: 1 },
          },
        })
      ).isError,
    ).toBe(true);
    const fixed = await connect(false);
    expect(
      (
        await fixed.callTool({
          name: "inspect_byte_entropy",
          arguments: { path, detail: "summary" },
        })
      ).isError,
    ).toBe(true);
  },
);
