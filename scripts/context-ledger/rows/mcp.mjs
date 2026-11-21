// MCP rows: the catalogue and instructions a client holds, the ten-call task
// with default arguments and with a summary asked each time, the default
// status and evidence-bundle calls, and a one-row page. A port of the audit's
// census-mcp 01-census.mjs, 07-task.mjs, 14-bundle-default.mjs and
// 15-paging.mjs.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildMcpInputs } from "../lib/inputs.mjs";
import { openMcp } from "../lib/mcp-client.mjs";
import { reaEnvironment } from "../lib/process.mjs";
import { sumUnits } from "../lib/units.mjs";
import { measuredRow, skippedRow } from "../lib/rows.mjs";

const retained = (id) => ({ kind: "retained-evidence", evidence_id: id });

/** A session that measures the text of each tool result it receives. */
const session = async (context, layout, label) => {
  const mcp = await openMcp({
    rea: context.reaScript,
    node: context.node,
    cwd: layout.work,
    env: layout.env,
  });
  const calls = [];
  return {
    mcp,
    calls,
    call: async (tool, args, note) => {
      const result = await mcp.call(tool, args);
      context.keep(`mcp/${label}-${calls.length + 1}-${tool}.txt`, result.text);
      calls.push({
        tool,
        note,
        outcome: result.protocolError
          ? `protocol error ${result.protocolError.code}`
          : result.isError
            ? "isError"
            : "ok",
        ...context.count(result.text),
      });
      return result;
    },
  };
};

const parentOf = (result) =>
  result.structured?.normalized_result?.parent_evidence_id ??
  result.structured?.evidence_id;

/** The audit's ten calls: understand a small app, its API and a native helper. */
const tenCalls = async (context, layout, mode) => {
  const summary = mode === "summary" ? { detail: "summary" } : {};
  // The audit's file names (frugal, naive): the path is part of the reply.
  const bundle = join(
    layout.out,
    `bundle-${mode === "summary" ? "frugal" : "naive"}.json`,
  );
  rmSync(bundle, { force: true });
  const s = await session(context, layout, `ten-${mode}`);
  try {
    const inputs = layout.inputs;
    await s.call(
      "search_guidance",
      { query: "javascript application endpoints" },
      "find guidance",
    );
    await s.call(
      "open_binary",
      { path: join(inputs, "app.zip") },
      "open the package",
    );
    await s.call("inspect_artifact", { ...summary }, "inventory");
    const js = await s.call(
      "analyze_javascript_application",
      { input_path: join(inputs, "app"), ...summary },
      "static JavaScript graph",
    );
    await s.call(
      "inspect_analysis_view",
      {
        source: retained(parentOf(js)),
        view: { kind: "page", collection: "modules", offset: 0, limit: 20 },
      },
      "page modules from retained Evidence",
    );
    const har = await s.call(
      "inspect_web_network_capture",
      { capture_path: join(inputs, "capture.har"), format: "har", ...summary },
      "HAR",
    );
    await s.call(
      "compare_static_and_observed_endpoints",
      {
        application: retained(parentOf(js)),
        capture: retained(parentOf(har)),
        origin: "https://api.notes.example",
      },
      "static against observed endpoints",
    );
    await s.call(
      "inspect_api_contract",
      { path: join(inputs, "openapi.json") },
      "OpenAPI",
    );
    await s.call(
      "inspect_binary_hardening",
      { path: join(inputs, "hello") },
      "native helper hardening",
    );
    await s.call("export_evidence_bundle", { path: bundle }, "save Evidence");
  } finally {
    await s.mcp.close();
  }
  return s.calls;
};

const callUnits = (calls) =>
  sumUnits(calls.map(({ bytes, tokenx, o200k }) => ({ bytes, tokenx, o200k })));

const catalogueRows = async (context, layout) => {
  const mcp = await openMcp({
    rea: context.reaScript,
    node: context.node,
    cwd: layout.work,
    env: layout.env,
  });
  const tools = [];
  try {
    let cursor;
    do {
      const page = await mcp.request(
        "tools/list",
        cursor === undefined ? {} : { cursor },
      );
      tools.push(...(page.result?.tools ?? []));
      cursor = page.result?.nextCursor;
    } while (cursor !== undefined);
  } finally {
    await mcp.close();
  }
  const visible = tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    input_schema: tool.inputSchema ?? { type: "object" },
  }));
  return [
    measuredRow("mcp.catalogue", {
      units: context.count(JSON.stringify({ tools })),
      detail: { tools: tools.length },
    }),
    measuredRow("mcp.catalogue.model-visible", {
      units: context.count(JSON.stringify(visible)),
      detail: { tools: tools.length },
    }),
    measuredRow("mcp.instructions", {
      units: context.count(mcp.initialize?.instructions ?? ""),
    }),
  ];
};

const statusRow = async (context, layout) => {
  const s = await session(context, layout, "status");
  try {
    await s.call("binary_session", {}, "default (summary), no target");
  } finally {
    await s.mcp.close();
  }
  return measuredRow("mcp.status.default", { units: callUnits(s.calls) });
};

const bundleRow = async (context, layout) => {
  const s = await session(context, layout, "bundle");
  try {
    const inputs = layout.inputs;
    await s.call("open_binary", { path: join(inputs, "app.zip") }, "(setup)");
    await s.call("inspect_artifact", { detail: "summary" }, "(setup)");
    await s.call(
      "analyze_javascript_application",
      { input_path: join(inputs, "app"), detail: "summary" },
      "(setup)",
    );
    await s.call(
      "inspect_web_network_capture",
      {
        capture_path: join(inputs, "capture.har"),
        format: "har",
        detail: "summary",
      },
      "(setup)",
    );
    await s.call(
      "get_evidence_bundle",
      { detail: "summary" },
      "detail summary",
    );
    await s.call("get_evidence_bundle", { detail: "links" }, "detail links");
    await s.call("get_evidence_bundle", {}, "default");
  } finally {
    await s.mcp.close();
  }
  const last = s.calls.at(-1);
  return measuredRow("mcp.bundle.default", {
    units: callUnits([last]),
    detail: { outcome: last.outcome },
  });
};

const pageRow = async (context, layout) => {
  const s = await session(context, layout, "page");
  try {
    const js = await s.call(
      "analyze_javascript_application",
      { input_path: join(layout.inputs, "app"), detail: "summary" },
      "(setup)",
    );
    await s.call(
      "inspect_analysis_view",
      {
        source: retained(parentOf(js)),
        view: { kind: "page", collection: "modules", offset: 0, limit: 1 },
      },
      "modules offset 0 limit 1",
    );
  } finally {
    await s.mcp.close();
  }
  const last = s.calls.at(-1);
  return measuredRow("mcp.page.one-row", {
    units: callUnits([last]),
    detail: { outcome: last.outcome },
  });
};

const tenCallRow = async (context, layout, mode) => {
  const calls = await tenCalls(context, layout, mode);
  return measuredRow(`mcp.ten-calls.${mode}`, {
    units: callUnits(calls),
    detail: {
      calls: calls.map(({ tool, note, outcome, bytes, tokenx, o200k }) => ({
        tool,
        note,
        outcome,
        bytes,
        tokenx,
        o200k,
      })),
    },
  });
};

export const MCP_ROWS = [
  "mcp.ten-calls.default",
  "mcp.ten-calls.summary",
  "mcp.status.default",
  "mcp.bundle.default",
  "mcp.page.one-row",
  "mcp.catalogue",
  "mcp.catalogue.model-visible",
  "mcp.instructions",
];

/** Run the MCP rows the selection asks for. */
export const mcpRows = async (context, wanted) => {
  const root = join(context.work, "mcp");
  const layout = {
    inputs: join(root, "inputs"),
    work: join(root, "work"),
    out: join(root, "out"),
    env: reaEnvironment(root),
  };
  mkdirSync(layout.work, { recursive: true });
  mkdirSync(layout.out, { recursive: true });
  const { missing } = buildMcpInputs(layout.inputs);
  const rows = [];
  const needsElf = new Set(["mcp.ten-calls.default", "mcp.ten-calls.summary"]);
  const steps = [
    ["mcp.ten-calls.default", () => tenCallRow(context, layout, "default")],
    ["mcp.ten-calls.summary", () => tenCallRow(context, layout, "summary")],
    ["mcp.status.default", () => statusRow(context, layout)],
    ["mcp.bundle.default", () => bundleRow(context, layout)],
    ["mcp.page.one-row", () => pageRow(context, layout)],
  ];
  for (const [id, step] of steps) {
    if (!wanted(id)) continue;
    if (needsElf.has(id) && missing.length > 0) {
      rows.push(
        skippedRow(
          id,
          `input not built: ${missing.map((m) => m.reason).join("; ")}`,
        ),
      );
      continue;
    }
    context.progress(id);
    rows.push(await step());
  }
  if (MCP_ROWS.slice(5).some(wanted)) {
    context.progress("mcp.catalogue");
    rows.push(
      ...(await catalogueRows(context, layout)).filter((row) => wanted(row.id)),
    );
  }
  return rows;
};
