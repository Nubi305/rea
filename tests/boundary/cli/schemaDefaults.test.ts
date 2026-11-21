import { describe, expect, it } from "vitest";

import { createCli } from "../../../src/cli.js";
import { selectSchemaKinds } from "../../../src/cli/schemaKindSelection.js";

const cli = createCli({});

const serve = async (arguments_: readonly string[]) => {
  let stdout = "";
  let exitCode = 0;
  await cli.serve([...arguments_], {
    env: {},
    stdout: (text) => {
      stdout += text;
    },
    exit: (code) => {
      exitCode = code;
    },
  });
  return { stdout, exitCode };
};

describe("--schema", () => {
  it("prints compact JSON by default and keeps explicit formats", async () => {
    const compact = await serve(["inspect-byte-entropy", "--schema"]);
    expect(compact.exitCode).toBe(0);
    expect(compact.stdout).toBe(
      `${JSON.stringify(JSON.parse(compact.stdout))}\n`,
    );
    const toon = await serve([
      "inspect-byte-entropy",
      "--schema",
      "--format",
      "toon",
    ]);
    expect(toon.stdout).not.toBe(compact.stdout);
    expect(toon.stdout).toContain("options:");
  });

  it("prints one view kind in a few kilobytes and names the rest", async () => {
    const whole = await serve(["inspect-analysis-view", "--schema"]);
    const one = await serve([
      "inspect-analysis-view",
      "--schema",
      "--schema-kind",
      "javascript-routes",
    ]);
    expect(one.exitCode).toBe(0);
    expect(Buffer.byteLength(one.stdout)).toBeLessThanOrEqual(6_000);
    expect(Buffer.byteLength(whole.stdout)).toBeGreaterThan(
      20 * Buffer.byteLength(one.stdout),
    );
    expect(one.stdout).toContain('"const":"javascript-routes"');
    expect(one.stdout).not.toContain('"const":"web-bundle"');
    // The source union is stubbed with its kinds, one flag away.
    expect(one.stdout).toContain("retained-evidence, inline");
    const two = await serve([
      "inspect-analysis-view",
      "--schema",
      "--schema-kind=javascript-routes,retained-evidence",
    ]);
    expect(two.stdout).toContain('"const":"retained-evidence"');
  });

  it("refuses an unknown kind with the kinds it has", async () => {
    const result = await serve([
      "inspect-analysis-view",
      "--schema",
      "--schema-kind",
      "no-such-view",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("UNKNOWN_SCHEMA_KIND");
    expect(result.stdout).toContain("javascript-routes");
  });
});

it("keeps unions inside a selected alternative whole", () => {
  const inner = {
    oneOf: [
      { properties: { kind: { const: "x" } } },
      { properties: { kind: { const: "y" } } },
    ],
  };
  const schema = {
    oneOf: [
      { properties: { kind: { const: "a" }, nested: inner } },
      { properties: { kind: { const: "b" } } },
    ],
  };
  const { schema: selected, matched } = selectSchemaKinds(
    schema,
    new Set(["a"]),
  );
  expect(matched).toEqual(new Set(["a"]));
  expect(selected).toEqual({ oneOf: [schema.oneOf[0]] });
});
