import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MANAGED_SKILL_FILES } from "../../src/application/SetupSkill.js";
import { createCli } from "../../src/cli.js";
import { cliCommand } from "../../src/cli/commandRegistry.js";
import { optionFlagName } from "../../src/cli/optionFields.js";
import {
  CLI_BUILTIN_FLAGS,
  OUTPUT_SWITCHES,
  VALUED_OUTPUT_FLAGS,
} from "../../src/cliBuiltinArguments.js";
import { CLI_COMMAND_NAMES } from "../../src/contracts/catalog/catalogIdentity.js";
import { inspectAnalysisViewInputSchema } from "../../src/domain/analysisView/analysisViewRequest.js";
import { browserScenarioSchema } from "../../src/domain/browserScenario.js";
import { BROWSER_SCENARIO_START_STEP_ID } from "../../src/domain/browserScenarioValues.js";
import {
  CLONE_RUN_CHECKS,
  CLONE_RUN_DEFAULT_EXCLUDES,
  CLONE_RUN_PATHS,
  CLONE_RUN_REASON_CODES,
  CLONE_RUN_ROLES,
  CLONE_RUN_SIDES,
  EVALUATE_CLONE_RUN_OPERATION,
  INIT_CLONE_RUN_OPERATION,
  cloneRunAdmissionRecordSchema,
  cloneRunGateSchema,
  cloneRunInitResultSchema,
  cloneRunIntendedDifferencesSchema,
  cloneRunJournalEntrySchema,
  cloneRunNextItemSchema,
  cloneRunExitCode,
  cloneRunObligationsSchema,
  cloneRunReasonCheck,
  cloneRunReasonRole,
  cloneRunScenarioSchema,
  cloneRunTargetSchema,
  cloneRunUnknownSchema,
  cloneRunWaiversSchema,
  type CloneRunReasonCode,
  type CloneRunRole,
} from "../../src/domain/cloneRun/cloneRunSchemas.js";
import {
  SCENARIO_BEHAVIOR_OPERATION,
  scenarioBehaviorComparisonSchema,
  scenarioBehaviorExitCode,
  scenarioBehaviorTableSchema,
} from "../../src/domain/scenarioBehaviorComparison.js";

// The playbook teaches agents to act on the referee's output, so every
// command, flag, reason code and member it names must be one the code
// defines, and every role it gives a reason to must be one the referee
// addresses.
const PLAYBOOK = "references/clone-runs.md";
const SKILL_PATH = ".agents/skills/reverse-engineer-anything/SKILL.md";
const PLAYBOOK_PATH = `.agents/skills/reverse-engineer-anything/${PLAYBOOK}`;
const REFERENCE_PATH = "docs/reference/clone-runs.md";
const SPEC_PATH = "docs/specs/reconstruction/clone-runs/spec.md";
const CLI_GUIDE_PATH = "docs/getting-started/cli.md";
const CLI_GUIDE_SECTION = "Rebuild a web application with a referee";

const CLONE_RUN_COMMANDS = [
  SCENARIO_BEHAVIOR_OPERATION,
  INIT_CLONE_RUN_OPERATION,
  EVALUATE_CLONE_RUN_OPERATION,
];
// The three commands are CLI-only and registered under the domain's operation
// constants, so the CLI's own name list is the whole of what a guide may name.
const KNOWN_COMMANDS: ReadonlySet<string> = new Set(CLI_COMMAND_NAMES);
const REASON_CODES: ReadonlySet<string> = new Set(CLONE_RUN_REASON_CODES);

const AUTHORED_SCHEMAS = [
  cloneRunScenarioSchema,
  cloneRunObligationsSchema,
  cloneRunUnknownSchema,
  cloneRunWaiversSchema,
  cloneRunIntendedDifferencesSchema,
];

/** Member names and enumerated values of every document of a clone run. */
const contractNames = (): ReadonlySet<string> => {
  const names = new Set<string>();
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) collect(item);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "properties" && typeof value === "object" && value !== null)
        for (const name of Object.keys(value)) names.add(name);
      if (key === "enum" && Array.isArray(value))
        for (const item of value) if (typeof item === "string") names.add(item);
      if (key === "const" && typeof value === "string") names.add(value);
      collect(value);
    }
  };
  for (const schema of [
    ...AUTHORED_SCHEMAS,
    cloneRunTargetSchema,
    cloneRunAdmissionRecordSchema,
    cloneRunNextItemSchema,
    cloneRunGateSchema,
    cloneRunJournalEntrySchema,
    cloneRunInitResultSchema,
    scenarioBehaviorComparisonSchema,
    scenarioBehaviorTableSchema,
    // A scenario's actions are capture-browser-scenario actions, so a guide may name those too.
    browserScenarioSchema,
  ])
    collect(z.toJSONSchema(schema, { unrepresentable: "any", io: "input" }));
  // The step REA itself runs first, and the paths a run excludes by default.
  names.add(BROWSER_SCENARIO_START_STEP_ID);
  for (const exclude of CLONE_RUN_DEFAULT_EXCLUDES) names.add(exclude);
  return names;
};

interface Prose {
  /** Inline code spans outside fenced blocks. */
  readonly spans: readonly string[];
  /** Fenced blocks by info string. */
  readonly blocks: readonly { readonly info: string; readonly text: string }[];
}

const readProse = async (path: string): Promise<Prose & { text: string }> => {
  const text = (await readFile(resolve(path), "utf8")).replaceAll("\r\n", "\n");
  const blocks: { info: string; text: string }[] = [];
  const outside = text.replaceAll(
    /^```([^\n]*)\n(.*?)^```$/gmsu,
    (_block, info: string, body: string) => {
      blocks.push({ info: info.trim(), text: body });
      return "";
    },
  );
  const spans = [...outside.matchAll(/`([^`]+)`/gu)].map((match) =>
    (match[1] ?? "").replaceAll(/\s+/gu, " "),
  );
  return { text, spans, blocks };
};

/** Every `rea <command>` written as code. */
const namedCommands = ({ spans, blocks }: Prose): string[] =>
  [...spans, ...blocks.map(({ text }) => text)].flatMap((code) =>
    [...code.matchAll(/(?<![\w./-])rea ([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/gu)].map(
      (match) => match[1] ?? "",
    ),
  );

/** A command written with `rea`, or a hyphenated CLI command name on its own. */
const COMMAND_PATTERN =
  /(?<![\w./<-])(?:rea ([a-z][a-z0-9]*(?:-[a-z0-9]+)*)|([a-z][a-z0-9]*(?:-[a-z0-9]+)+))(?![\w/.-])/gu;
const FLAG_PATTERN = /(?<![\w-])--[a-z][a-z0-9_-]*/gu;

/**
 * Every `--flag` written as code, with the command it is written after in
 * the same span or block, or `undefined` for a flag named on its own.
 */
const namedFlags = ({
  spans,
  blocks,
}: Prose): { readonly command: string | undefined; readonly flag: string }[] =>
  [...spans, ...blocks.map(({ text }) => text)].flatMap((code) => {
    const commands = [...code.matchAll(COMMAND_PATTERN)]
      .map((match) => ({
        index: match.index,
        name: match[1] ?? match[2] ?? "",
      }))
      .filter(({ name }) => KNOWN_COMMANDS.has(name));
    return [...code.matchAll(FLAG_PATTERN)].map((match) => ({
      command: commands.findLast(({ index }) => index < match.index)?.name,
      flag: match[0],
    }));
  });

const GLOBAL_FLAGS: ReadonlySet<string> = new Set([
  ...CLI_BUILTIN_FLAGS,
  ...OUTPUT_SWITCHES,
  ...VALUED_OUTPUT_FLAGS,
]);

/** The flags of each command, read from the option schema the dispatcher parses with. */
const commandFlags = (): ((command: string) => ReadonlySet<string>) => {
  const cli = createCli({});
  return (command) =>
    new Set(
      Object.keys(
        cliCommand(cli, command)?.definition.options?.shape ?? {},
      ).map((key) => `--${optionFlagName(key)}`),
    );
};

/** Flags a guide names that the command they are written with does not take. */
const unknownFlags = (prose: Prose): string[] => {
  const flagsOf = commandFlags();
  const named = [...new Set(namedCommands(prose))];
  return namedFlags(prose)
    .filter(
      ({ command, flag }) =>
        !GLOBAL_FLAGS.has(flag) &&
        !(command === undefined ? named : [command]).some((name) =>
          flagsOf(name).has(flag),
        ),
    )
    .map(({ command, flag }) => `${command ?? "(no command)"} ${flag}`);
};

/** Code spans that are one snake_case name: reason codes, members and values. */
const namedIdentifiers = ({ spans }: Prose): string[] =>
  spans.filter((span) => /^[a-z]+(?:_[a-z0-9]+)+$/u.test(span));

const section = (text: string, heading: string): string => {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`Missing section: ${heading}`);
  const end = text.indexOf("\n## ", start + 1);
  return text.slice(start, end === -1 ? undefined : end);
};

/** The role cards by role id, in the order the playbook gives them. */
const roleCards = (text: string): Map<string, string> =>
  new Map(
    section(text, "Role cards")
      .split(/\n(?=### )/u)
      .slice(1)
      .map((card) => {
        const title = card.slice("### ".length, card.indexOf("\n"));
        return [title.toLowerCase().replaceAll(" ", "_"), card] as const;
      }),
  );

/**
 * Roles the referee addresses a finding to beyond its reason's own role,
 * when the remedy is that role's: a difference a rename settles goes to the
 * lead, and instability of the original that no declaration can cover goes
 * to the prober. The referee sets these per finding and exports no list, so
 * this one is kept by hand beside the referee's own tests of each case.
 */
const ALSO_ADDRESSED: Partial<
  Record<CloneRunReasonCode, readonly CloneRunRole[]>
> = {
  parity_changed: ["lead"],
  parity_unstable: ["prober"],
};

/** The role a reason has on each side: one, or two for a capture reason. */
const ownRoles = (code: CloneRunReasonCode): ReadonlySet<string> =>
  new Set(CLONE_RUN_SIDES.map((side) => cloneRunReasonRole(code, side)));

/** Every role a finding with this reason can be addressed to. */
const actingRoles = (code: CloneRunReasonCode): ReadonlySet<string> =>
  new Set([...ownRoles(code), ...(ALSO_ADDRESSED[code] ?? [])]);

/** The roles a table cell names, as role ids. */
const rolesIn = (cell: string): ReadonlySet<string> =>
  new Set(
    CLONE_RUN_ROLES.filter((role) =>
      new RegExp(`\\b${role.replace("_", " ")}\\b`, "u").test(cell),
    ),
  );

/** The cells of each table row that has a code span in the given column. */
const tableRows = (text: string, codeColumn: number): string[][] =>
  text
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) =>
      line
        .slice(1, -1)
        .split(/(?<!\\)\|/u)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => /^`[a-z_]+`/u.test(cells[codeColumn] ?? ""));

const codesIn = (cell: string): CloneRunReasonCode[] =>
  [...cell.matchAll(/`([a-z_]+)`/gu)].flatMap((match) =>
    CLONE_RUN_REASON_CODES.filter((code) => code === match[1]),
  );

const oneLine = (text: string): string => text.replaceAll(/\s+/gu, " ");

describe("clone run playbook", () => {
  it("is installed with the skill and routed from it", async () => {
    expect(MANAGED_SKILL_FILES).toContain(PLAYBOOK);
    const skill = await readFile(resolve(SKILL_PATH), "utf8");
    expect(skill).toContain(`(${PLAYBOOK})`);
  });

  it("is the first route of the skill and is named in its description", async () => {
    const skill = await readFile(resolve(SKILL_PATH), "utf8");
    const description = /^description: (.*)$/mu.exec(skill)?.[1] ?? "";
    expect(description).toMatch(/rebuild \(clone\) a web application/u);
    const routes = section(skill, "Route the target first");
    const firstRoute = routes.slice(routes.indexOf("\n- "));
    expect(firstRoute.slice(0, firstRoute.indexOf("\n- ", 1))).toContain(
      `(${PLAYBOOK})`,
    );
  });

  it("states the exit status of each verdict as the code computes it", async () => {
    const { text } = await readProse(PLAYBOOK_PATH);
    expect(oneLine(text)).toContain(
      `Exit ${cloneRunExitCode("done")} is done, ${cloneRunExitCode("not_done")} is not done, ${cloneRunExitCode("stalled")} is stalled.`,
    );
  });

  it("writes only inputs that inspect-analysis-view and the declarations file accept", async () => {
    const { spans, blocks } = await readProse(PLAYBOOK_PATH);
    const viewInputs = blocks.flatMap(({ text }) =>
      [...text.matchAll(/rea inspect-analysis-view '([^']+)'/gu)].map(
        (match) => match[1] ?? "",
      ),
    );
    expect(viewInputs.length).toBeGreaterThan(0);
    for (const input of viewInputs) {
      // The CLI resolves an evidence-file path against the working directory before the contract reads it.
      const request = z
        .looseObject({ source: z.looseObject({ path: z.string() }) })
        .parse(JSON.parse(input));
      expect(
        inspectAnalysisViewInputSchema.safeParse({
          ...request,
          source: { ...request.source, path: resolve(request.source.path) },
        }).success,
        input,
      ).toBe(true);
    }
    const declarations = spans.filter((span) =>
      /^\{.*"pointer".*\}$/u.test(span),
    );
    expect(declarations.length).toBeGreaterThan(0);
    for (const entry of declarations)
      expect(
        cloneRunIntendedDifferencesSchema.safeParse({
          renames: [],
          volatile_fields: [JSON.parse(entry)],
        }).success,
        entry,
      ).toBe(true);
  });

  it("has one card for each role of the contract", async () => {
    const { text } = await readProse(PLAYBOOK_PATH);
    const cards = roleCards(text);
    expect([...cards.keys()]).toEqual([...CLONE_RUN_ROLES]);
    for (const [role, card] of cards)
      for (const part of [
        "- Reads:",
        "- Writes:",
        "- Commands:",
        "- Finished when",
        "- Typical mistakes:",
      ])
        expect(card, `${role} card lacks "${part}"`).toContain(part);
  });

  it("gives each reason code to the card of every role that acts on it, and to no other card", async () => {
    const { text } = await readProse(PLAYBOOK_PATH);
    const cards = roleCards(text);
    const roles = new Set(
      CLONE_RUN_REASON_CODES.flatMap((code) => [...actingRoles(code)]),
    );
    for (const role of roles)
      expect(cards.has(role), `no card for ${role}`).toBe(true);
    const misplaced: string[] = [];
    for (const code of CLONE_RUN_REASON_CODES)
      for (const [role, card] of cards) {
        const acts = actingRoles(code).has(role);
        if (card.includes(`\`${code}\``) !== acts)
          misplaced.push(
            acts
              ? `${role} card does not name ${code}`
              : `${role} card names ${code}, which another role acts on`,
          );
      }
    expect(misplaced).toEqual([]);
  });
});

describe.each([PLAYBOOK_PATH, REFERENCE_PATH, SPEC_PATH])("%s", (path) => {
  it("names only commands the CLI has, and each clone-run command", async () => {
    const commands = namedCommands(await readProse(path));
    expect(commands.filter((command) => !KNOWN_COMMANDS.has(command))).toEqual(
      [],
    );
    expect(commands).toEqual(expect.arrayContaining(CLONE_RUN_COMMANDS));
  });

  it("names only flags the command they are written with takes", async () => {
    expect(unknownFlags(await readProse(path))).toEqual([]);
  });
});

describe.each([PLAYBOOK_PATH, REFERENCE_PATH])("%s", (path) => {
  it("names only reason codes, members and values the contract defines", async () => {
    const defined = contractNames();
    expect(
      namedIdentifiers(await readProse(path)).filter(
        (name) => !REASON_CODES.has(name) && !defined.has(name),
      ),
    ).toEqual([]);
  });
});

describe("clone run section of the CLI guide", () => {
  it("names only commands and flags the CLI has, and each clone-run command", async () => {
    const guide = await readProse(CLI_GUIDE_PATH);
    const text = section(guide.text, CLI_GUIDE_SECTION);
    const prose: Prose = {
      spans: [...text.matchAll(/`([^`]+)`/gu)].map((match) =>
        oneLine(match[1] ?? ""),
      ),
      blocks: [],
    };
    const commands = namedCommands(prose);
    expect(commands.filter((command) => !KNOWN_COMMANDS.has(command))).toEqual(
      [],
    );
    expect(commands).toEqual(expect.arrayContaining(CLONE_RUN_COMMANDS));
    expect(unknownFlags(prose)).toEqual([]);
  });
});

describe("clone run specification", () => {
  it("gives each reason code its check and its roles in the reason table", async () => {
    const { text } = await readProse(SPEC_PATH);
    const rows = tableRows(section(text, "What done means"), 1);
    const listed = rows.flatMap(([, codes]) => codesIn(codes ?? ""));
    expect([...listed].sort()).toEqual([...CLONE_RUN_REASON_CODES].sort());
    const wrong: string[] = [];
    for (const [check, codes, role, also] of rows)
      for (const code of codesIn(codes ?? "")) {
        if (check !== cloneRunReasonCheck(code))
          wrong.push(`${code}: check ${String(check)}`);
        if (
          [...rolesIn(role ?? "")].sort().join() !==
          [...ownRoles(code)].sort().join()
        )
          wrong.push(`${code}: role ${String(role)}`);
        if (
          [...rolesIn(`${role ?? ""} ${also ?? ""}`)].sort().join() !==
          [...actingRoles(code)].sort().join()
        )
          wrong.push(`${code}: also addressed to ${String(also)}`);
      }
    expect(wrong).toEqual([]);
  });
});

describe("clone run reference", () => {
  it("gives each reason code its check and every role that acts on it", async () => {
    const { text } = await readProse(REFERENCE_PATH);
    const rows = tableRows(section(text, "What done means"), 0);
    expect(rows.flatMap(([code]) => codesIn(code ?? ""))).toEqual([
      ...CLONE_RUN_REASON_CODES,
    ]);
    const wrong: string[] = [];
    for (const [reason, check, role] of rows) {
      const [code] = codesIn(reason ?? "");
      if (code === undefined) continue;
      if (check !== cloneRunReasonCheck(code))
        wrong.push(`${code}: check ${String(check)}`);
      if (
        [...rolesIn(role ?? "")].sort().join() !==
        [...actingRoles(code)].sort().join()
      )
        wrong.push(`${code}: role ${String(role)}`);
      // A cell that splits the roles by side names each side's own role in that side's part.
      for (const side of CLONE_RUN_SIDES) {
        const part = (role ?? "")
          .split(",")
          .find((piece) => piece.includes(`(${side})`));
        if (
          part !== undefined &&
          !rolesIn(part).has(cloneRunReasonRole(code, side))
        )
          wrong.push(`${code}: ${side} role in ${String(role)}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(CLONE_RUN_CHECKS).toEqual(
      expect.arrayContaining([...new Set(rows.map(([, check]) => check))]),
    );
  });

  it("states the exit status of each verdict as the code computes it", async () => {
    const text = oneLine((await readProse(REFERENCE_PATH)).text);
    expect(text).toContain(
      `it exits \`${cloneRunExitCode("done")}\` for \`done\` or \`done_with_waivers\`, \`${cloneRunExitCode("not_done")}\` for \`not_done\` and \`${cloneRunExitCode("stalled")}\` for \`stalled\``,
    );
    expect(text).toContain(
      `the command exits \`${scenarioBehaviorExitCode("unchanged")}\` for \`unchanged\`, \`${scenarioBehaviorExitCode("changed")}\` for \`changed\` and \`${scenarioBehaviorExitCode("unknown")}\` for \`unknown\``,
    );
  });

  it("lists every reason code and every path of a run folder", async () => {
    const prose = await readProse(REFERENCE_PATH);
    expect(
      new Set(namedIdentifiers(prose).filter((name) => REASON_CODES.has(name))),
    ).toEqual(REASON_CODES);
    for (const path of Object.values(CLONE_RUN_PATHS))
      expect(prose.text, `run folder path ${path}`).toContain(`\`${path}`);
  });

  it("shows only authored-file and worklist examples the schemas accept", async () => {
    const { blocks } = await readProse(REFERENCE_PATH);
    const examples = blocks.filter(({ info }) => info === "json");
    expect(examples.length).toBeGreaterThan(0);
    for (const { text } of examples) {
      const document: unknown = JSON.parse(text);
      expect(
        [...AUTHORED_SCHEMAS, cloneRunNextItemSchema].filter(
          (schema) => schema.safeParse(document).success,
        ),
        text,
      ).toHaveLength(1);
    }
  });
});
