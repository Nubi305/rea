import { describe, expect, it } from "vitest";

import {
  probeCallToAction,
  probeCommand,
  shellWord,
  withProbeCommands,
} from "../../../src/cli/probeCommands.js";

const context = {
  commands: [],
  cliName: "rea",
  recordedCommands: {
    "inspect-web-network-capture": "captures",
    "inspect-with-objdump": "debug",
    "inspect-api-contract": "application",
    "inspect-sqlite-database": "artifact",
    "extract-artifact": "artifact",
    "analyze-javascript-application": "javascript",
  },
};

describe("probeCommand", () => {
  it.each([
    [
      "inspect_web_network_capture",
      { capture_path: "/w/c.har", format: "har" },
      "rea inspect-web-network-capture /w/c.har har",
    ],
    [
      "inspect_with_objdump",
      { path: "/w/a", operation: "disassemble", symbol: "verify_key" },
      "rea inspect-with-objdump /w/a disassemble --symbol verify_key",
    ],
    [
      "inspect_api_contract",
      { path: "/w/s.graphql", format: "graphql-sdl" },
      "rea inspect-api-contract /w/s.graphql --contract-format graphql-sdl",
    ],
    [
      "gdb_console",
      { executable: "/w/a", command: "x/s ADDRESS" },
      "rea debug-with-gdb 'x/s ADDRESS' --executable /w/a",
    ],
    ["open_binary", { path: "/w/a" }, "rea analyze /w/a"],
    [
      "analyze_javascript_application",
      { input_path: "/w/my app" },
      "rea analyze-javascript-application '/w/my app'",
    ],
    [
      "inspect_sqlite_database",
      { path: "/w/app.db" },
      "rea inspect-sqlite-database /w/app.db",
    ],
  ])(
    "spells %s as a command that runs as printed",
    (operation, call, command) => {
      expect(probeCommand(operation, call, context)).toBe(command);
    },
  );

  it("prints no command it cannot spell", () => {
    expect(
      probeCommand(
        "inspect_sqlite_database",
        { path: "/a", table: "t" },
        context,
      ),
    ).toBe(undefined);
    expect(probeCommand("no_such_tool", { path: "/a" }, context)).toBe(
      undefined,
    );
    expect(probeCommand("extract_artifact", {}, context)).toBe(undefined);
    expect(
      probeCommand(
        "extract_artifact",
        {},
        { ...context, targetPath: "/w/a.zip" },
      ),
    ).toBe("rea extract-artifact /w/a.zip");
  });

  it("quotes only what the shell would split", () => {
    expect(shellWord("/tmp/it's here")).toBe("'/tmp/it'\\''s here'");
  });
});

describe("withProbeCommands", () => {
  it("adds commands to probes in results and refusals, and keeps the rest", () => {
    const result = {
      caller_input_path: "/w/a.zip",
      normalized_result: {
        next_probes: [{ operation: "extract_artifact", arguments: {} }],
        unexplored_branches: [
          {
            next_probe: {
              operation: "open_binary",
              rationale: "needs an extracted member",
            },
          },
        ],
      },
    };
    expect(withProbeCommands(result, context)).toEqual({
      ...result,
      normalized_result: {
        ...result.normalized_result,
        next_probes: [
          {
            operation: "extract_artifact",
            command: "rea extract-artifact /w/a.zip",
          },
        ],
      },
    });
    const unchanged = { normalized_result: { rows: [1, 2, 3] } };
    expect(withProbeCommands(unchanged, context)).toBe(unchanged);
  });
});

describe("probeCallToAction", () => {
  it("prints a result's next probes after it, from the full record or its summary", () => {
    const probe = {
      operation: "inspect_binary_hardening",
      arguments: { path: "/w/keyd" },
      rationale: "RELRO, PIE, NX, canaries, RPATH.",
    };
    const expected = {
      description: "Next probes:",
      commands: [
        {
          command: "rea inspect-binary-hardening /w/keyd",
          description: "RELRO, PIE, NX, canaries, RPATH.",
        },
      ],
    };
    const hardening = {
      ...context,
      recordedCommands: { "inspect-binary-hardening": "binary" },
    };
    expect(
      probeCallToAction(
        { normalized_result: { next_probes: [probe] } },
        hardening,
      ),
    ).toEqual(expected);
    expect(
      probeCallToAction(
        {
          normalized_result: {
            summary: {
              inspection: { unexplored_branches: [{ next_probe: probe }] },
            },
          },
        },
        hardening,
      ),
    ).toEqual(expected);
    expect(probeCallToAction({ normalized_result: {} }, hardening)).toBe(
      undefined,
    );
  });
});
