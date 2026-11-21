import { describe, expect, it } from "vitest";

import { createCli } from "../../../src/cli.js";
import { cliCommands } from "../../../src/cli/commandRegistry.js";
import {
  HELP_FAMILIES,
  HELP_START_COMMANDS,
} from "../../../src/cli/helpFamilies.js";
import {
  commandsByFamily,
  listedDescription,
  OTHER_HELP_FAMILY,
} from "../../../src/cli/helpIndex.js";

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

describe("root help index", () => {
  it("fits the budget and names every family and start command", async () => {
    const { stdout, exitCode } = await serve(["--help"]);
    expect(exitCode).toBe(0);
    expect(Buffer.byteLength(stdout)).toBeLessThanOrEqual(3_000);
    const lines = stdout.split("\n");
    for (const { id, summary } of HELP_FAMILIES)
      expect(
        lines.some(
          (line) => line.startsWith(`  ${id} `) && line.endsWith(summary),
        ),
        id,
      ).toBe(true);
    for (const { usage } of HELP_START_COMMANDS)
      expect(stdout).toContain(usage);
    expect((await serve([])).stdout).toBe(stdout);
    expect((await serve(["help"])).stdout).toBe(stdout);
  });

  it("puts every registered command in a named family", () => {
    const families = commandsByFamily(cli);
    expect(families.get(OTHER_HELP_FAMILY) ?? []).toEqual([]);
    const listed = [...families.values()].flat().map(({ name }) => name);
    expect(listed.toSorted()).toEqual(
      cliCommands(cli)
        .map(({ name }) => name)
        .toSorted(),
    );
    for (const { id } of HELP_FAMILIES)
      expect(families.get(id)?.length, id).toBeGreaterThan(0);
  });

  it("starts from commands that exist", () => {
    const names = new Set(cliCommands(cli).map(({ name }) => name));
    for (const { usage } of HELP_START_COMMANDS)
      expect(names.has(usage.split(" ")[0]!), usage).toBe(true);
  });
});

describe("rea help <topic>", () => {
  it("lists one family with one line per command", async () => {
    const { stdout, exitCode } = await serve(["help", "clone-run"]);
    expect(exitCode).toBe(0);
    const families = commandsByFamily(cli);
    for (const { name } of families.get("clone-run")!)
      expect(stdout).toMatch(new RegExp(`^  ${name} `, "mu"));
    for (const line of stdout.split("\n"))
      expect(line.length).toBeLessThanOrEqual(160);
  });

  it("keeps every command and the global options reachable", async () => {
    const all = await serve(["help", "all"]);
    for (const { name } of cliCommands(cli))
      expect(all.stdout).toMatch(new RegExp(`^  ${name} `, "mu"));
    const options = await serve(["help", "options"]);
    for (const flag of [
      "--filter-output",
      "--format",
      "--json",
      "--schema",
      "--token-limit",
      "--token-offset",
      "--token-count",
      "--full-output",
      "--timings",
      "--llms",
    ])
      expect(options.stdout).toContain(flag);
    expect((await serve(["help", "decompile"])).stdout).toBe(
      (await serve(["decompile", "--help"])).stdout,
    );
  });

  it("answers an unknown topic with the closest name and the families", async () => {
    const { stdout, exitCode } = await serve(["help", "nativ"]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("Did you mean 'native'?");
    expect(stdout).toContain("Families: start, artifact");
  });

  it("keeps unknown-command suggestions", async () => {
    const { stdout, exitCode } = await serve(["decompil"]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("decompile");
  });
});

describe("command help", () => {
  it("names where the global options are instead of listing them", async () => {
    const { stdout } = await serve(["inspect-artifact", "--help"]);
    expect(stdout).not.toContain("Global Options:");
    expect(stdout).toContain("rea help options");
    expect(stdout).toContain("--evidence_output");
  });
});

it("lists the first sentence of a long description", () => {
  expect(listedDescription("Read code. Then more.")).toBe("Read code");
  expect(listedDescription("x".repeat(150))).toHaveLength(100);
  expect(listedDescription(undefined)).toBe("");
});

describe("rea help <words>", () => {
  it("searches command names and one-line descriptions for words that name no page", async () => {
    const openapi = await serve(["help", "openapi"]);
    expect(openapi.exitCode).toBe(0);
    expect(openapi.stdout).toContain("inspect-api-contract");
    expect(openapi.stdout).not.toContain("open-jeb-project");
    const dwarf = await serve([
      "help",
      "debug",
      "information",
      "source",
      "files",
    ]);
    expect(dwarf.exitCode).toBe(0);
    expect(dwarf.stdout.split("\n")).toContainEqual(
      expect.stringMatching(/^ {2}inspect-dwarf-units /u),
    );
  });

  it("keeps the page a first word names when the rest matches no command", async () => {
    expect(
      (await serve(["help", "native", "qzxv", "zzyy", "wwqq"])).stdout,
    ).toBe((await serve(["help", "native"])).stdout);
  });

  it("answers words that match nothing with the families", async () => {
    const { stdout, exitCode } = await serve(["help", "qzxv"]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("UNKNOWN_HELP_TOPIC");
  });
});
