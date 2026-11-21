import { cliCommand, cliCommands } from "../../../src/cli/commandRegistry.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createCli } from "../../../src/cli.js";
import {
  cliCommandOptionNames,
  createCliInventory,
} from "../../../scripts/lib/catalog-cli.mjs";

type CliInstance = ReturnType<typeof createCli>;

const serve = async (
  cli: CliInstance,
  argv: readonly string[],
): Promise<{ readonly stdout: string; readonly exitCode: number }> => {
  let stdout = "";
  let exitCode = 0;
  await cli.serve([...argv], {
    env: {},
    exit: (code) => {
      exitCode = code;
    },
    stdout: (text) => {
      stdout += text;
    },
  });
  return { stdout, exitCode };
};

const registeredAliases = (
  cli: CliInstance,
  command: string,
): Record<string, unknown> => {
  const entry = cliCommand(cli, command)?.definition;
  const alias: unknown =
    entry === undefined ? undefined : Reflect.get(entry, "alias");
  return typeof alias === "object" && alias !== null ? { ...alias } : {};
};

describe("CLI option aliases", () => {
  it("rejects an empty primary command inventory", () => {
    expect(() => createCliInventory([])).toThrow(
      "REA exposed no primary CLI commands",
    );
  });

  it("register only single-character short flags", async () => {
    const cli = createCli({});
    const invalid: string[] = [];
    const undescribed: string[] = [];
    for (const command of createCliInventory(cliCommands(cli)).primary) {
      for (const [option, short] of Object.entries(
        registeredAliases(cli, command),
      ))
        if (typeof short !== "string" || short.length !== 1)
          invalid.push(`${command} ${option}: ${String(short)}`);
      // Incur parses `-abc` as stacked one-letter flags, so help must never
      // advertise a multi-letter single-dash spelling.
      const help = await serve(cli, [command, "--help"]);
      expect(help.exitCode, `${command} --help`).toBe(0);
      expect(help.stdout, `${command} --help`).not.toBe("");
      for (const match of help.stdout.matchAll(/(?:^|[\s,])-([a-z][\w-]+)/gmu))
        invalid.push(`${command} help: -${match[1] ?? ""}`);
      const options = /^Options:\n((?: {2}.*\n?)*)/mu.exec(help.stdout)?.[1];
      const entry = cliCommand(cli, command)?.definition;
      expect(entry, `${command} registration`).toBeDefined();
      const schema: unknown = entry && Reflect.get(entry, "options");
      if (schema !== undefined)
        expect(schema, `${command} options schema`).toBeInstanceOf(z.ZodObject);
      if (cliCommandOptionNames(cliCommands(cli), command).length > 0) {
        expect(options, `${command} --help options`).toBeDefined();
        expect(options, `${command} --help option entries`).toMatch(/^  --/mu);
      }
      for (const line of options?.split("\n") ?? [])
        if (/^ {2}--\S+(?: <[^>]+>)?\s*$/u.test(line))
          undescribed.push(`${command} ${line.trim()}`);
    }
    expect(invalid).toEqual([]);
    expect(undescribed).toEqual([]);
  });

  it("accepts kebab-case long options without registered aliases", async () => {
    const cli = createCli({});
    const result = await serve(cli, [
      "inspect-plist",
      "/nonexistent/REA.app",
      "--relative-path",
      "Contents/Info.plist",
      "--json",
    ]);
    expect(result.stdout).not.toContain("Unknown flag");
    expect(result.stdout).toContain("/nonexistent/REA.app");
  });

  it("accepts the kebab spelling of a snake_case option", async () => {
    const cli = createCli({});
    const result = await serve(cli, [
      "inspect-artifact",
      "/nonexistent/REA.app",
      "--detail",
      "summary",
      "--evidence-output",
      "/nonexistent/evidence.json",
      "--json",
    ]);
    expect(result.stdout).not.toContain("Unknown flag");
    expect(result.stdout).not.toContain("--evidence-output");
  });

  it("refuses both spellings of a snake_case option with different values", async () => {
    const cli = createCli({});
    const result = await serve(cli, [
      "inspect-artifact",
      "/nonexistent/REA.app",
      "--evidence_output",
      "/nonexistent/a.json",
      "--evidence-output",
      "/nonexistent/b.json",
      "--json",
    ]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      code: "UNKNOWN",
      message:
        "Conflicting values for --evidence_output and its spelling --evidence-output; give the option once.",
    });
  });

  it("names the nearest flag of the command for an unknown flag", async () => {
    const cli = createCli({});
    const result = await serve(cli, [
      "inspect-artifact",
      "/nonexistent/REA.app",
      "--detial",
      "summary",
      "--json",
    ]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      code: "UNKNOWN",
      message: "Unknown flag: --detial. Did you mean --detail?",
    });
  });

  it("keeps today's text when no flag is near", async () => {
    const cli = createCli({});
    const result = await serve(cli, [
      "inspect-artifact",
      "/nonexistent/REA.app",
      "--no-such-flag",
      "--json",
    ]);
    expect(JSON.parse(result.stdout)).toEqual({
      code: "UNKNOWN",
      message: "Unknown flag: --no-such-flag",
    });
  });

  it("names no flag when redaction changed the typed flag", async () => {
    const cli = createCli({});
    const capture = [
      "inspect-web-network-capture",
      "/nonexistent/capture.har",
      "har",
    ];
    const plain = await serve(cli, [
      ...capture,
      "--sensitive-valeu",
      "x",
      "--json",
    ]);
    expect(JSON.parse(plain.stdout)).toEqual({
      code: "UNKNOWN",
      message:
        "Unknown flag: --sensitive-valeu. Did you mean --sensitive-value?",
    });
    const redacted = await serve(cli, [
      ...capture,
      "--sensitive-value",
      "valeu",
      "--sensitive-valeu",
      "x",
      "--json",
    ]);
    expect(JSON.parse(redacted.stdout)).toEqual({
      code: "UNKNOWN",
      message: "Unknown flag: --sensitive-[REDACTED]",
    });
  });
});
