import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MANAGED_SKILL_FILES } from "../../src/application/SetupSkill.js";
import { CLI_COMMAND_NAMES } from "../../src/contracts/catalog/catalogIdentity.js";
import {
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
  cloneRunObligationsSchema,
  cloneRunReasonRole,
  cloneRunScenarioSchema,
  cloneRunTargetSchema,
  cloneRunUnknownSchema,
  cloneRunWaiversSchema,
  type CloneRunReasonCode,
} from "../../src/domain/cloneRun/cloneRunSchemas.js";
import {
  SCENARIO_BEHAVIOR_OPERATION,
  scenarioBehaviorComparisonSchema,
  scenarioBehaviorTableSchema,
} from "../../src/domain/scenarioBehaviorComparison.js";

// The playbook teaches agents to act on the referee's output, so every
// command, reason code and member it names must be one the code defines.
const PLAYBOOK = "references/clone-runs.md";
const PLAYBOOK_PATH = `.agents/skills/reverse-engineer-anything/${PLAYBOOK}`;
const REFERENCE_PATH = "docs/reference/clone-runs.md";

const CLONE_RUN_COMMANDS = [
  SCENARIO_BEHAVIOR_OPERATION,
  INIT_CLONE_RUN_OPERATION,
  EVALUATE_CLONE_RUN_OPERATION,
];
// The three commands are CLI-only: they are registered by name, and the
// domain's operation constants are the names they are registered under.
const KNOWN_COMMANDS: ReadonlySet<string> = new Set([
  ...CLI_COMMAND_NAMES,
  ...CLONE_RUN_COMMANDS,
]);
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
  ])
    collect(z.toJSONSchema(schema, { unrepresentable: "any", io: "input" }));
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

/** The roles a reason reaches: one, or one per side for a capture reason. */
const actingRoles = (code: CloneRunReasonCode): ReadonlySet<string> =>
  new Set(CLONE_RUN_SIDES.map((side) => cloneRunReasonRole(code, side)));

describe("clone run playbook", () => {
  it("is installed with the skill and routed from it", async () => {
    expect(MANAGED_SKILL_FILES).toContain(PLAYBOOK);
    const skill = await readFile(
      resolve(".agents/skills/reverse-engineer-anything/SKILL.md"),
      "utf8",
    );
    expect(skill).toContain(`(${PLAYBOOK})`);
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

describe.each([PLAYBOOK_PATH, REFERENCE_PATH])("%s", (path) => {
  it("names only commands the CLI has, and each clone-run command", async () => {
    const commands = namedCommands(await readProse(path));
    expect(commands.filter((command) => !KNOWN_COMMANDS.has(command))).toEqual(
      [],
    );
    expect(commands).toEqual(expect.arrayContaining(CLONE_RUN_COMMANDS));
  });

  it("names only reason codes, members and values the contract defines", async () => {
    const defined = contractNames();
    expect(
      namedIdentifiers(await readProse(path)).filter(
        (name) => !REASON_CODES.has(name) && !defined.has(name),
      ),
    ).toEqual([]);
  });
});

describe("clone run reference", () => {
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
