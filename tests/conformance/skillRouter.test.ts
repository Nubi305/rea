import { readFile, readdir } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve } from "node:path";

import { estimateTokenCount } from "tokenx";
import { beforeAll, describe, expect, it } from "vitest";

import {
  CONTENTS_LABEL,
  CONTENTS_MIN_LINES,
  contentsHeadings,
  packagedSkillFile,
} from "../../scripts/lib/skill-contents.mjs";
import {
  FORK_CORRECTIONS,
  ROUTE_REFERENCES,
  portSkillRoutes,
  skillSections,
} from "../../scripts/lib/skill-routes.mjs";
import { searchGuidanceWithReader } from "../../src/application/GuidanceAccess.js";
import { MANAGED_SKILL_FILES } from "../../src/application/SetupSkill.js";
import { CLI_COMMAND_NAMES } from "../../src/contracts/catalog/catalogIdentity.js";
import { PROMPT_CONTRACTS } from "../../src/contracts/promptContracts.js";
import { TOOL_CONTRACTS } from "../../src/contracts/toolContracts.js";
import {
  advertisedInputJsonSchema,
  advertisedOutputJsonSchema,
} from "../../src/contracts/toolSchemaMetadata.js";
import { CLONE_RUN_REASON_CODES } from "../../src/domain/cloneRun/cloneRunSchemas.js";
import { ArtifactResourceScope } from "../../src/resources/ArtifactResourceScope.js";

// The skill is a router: a short body that every trigger loads, and
// references an agent reads one section at a time. This file guards the
// size and shape of the body, that every tool and command the skill names
// exists, that no link leaves the package, that long references ship with a
// contents list, and that the route references are upstream's text as the
// port script produces it.
const SKILL_ROOT = ".agents/skills/reverse-engineer-anything";
const CURSOR_ROOT = ".cursor-plugin/skills/reverse-engineer-anything";
const RECORDED_UPSTREAM = "scripts/skill-routes/upstream-SKILL.md";

// Decision 1 and 9 of the skill package: estimated with tokenx, the
// estimator REA ships.
const BODY_MAX_LINES = 150;
const BODY_MAX_TOKENS = 1800;
const FIRST_STEPS_MAX_TOKENS = 800;
const DESCRIPTION_MAX_CHARACTERS = 1024;
// Long references with no headings, so no contents list can be generated
// from them. Upstream writes this one as paragraphs; giving it headings is an
// edit to upstream's text.
const WITHOUT_HEADINGS: ReadonlySet<string> = new Set([
  "references/evidence-workflows.md",
]);

type SkillFiles = ReadonlyMap<string, string>;

const readSkill = async (root: string): Promise<Map<string, string>> => {
  const files = new Map<string, string>();
  const walk = async (prefix: string): Promise<void> => {
    for (const entry of await readdir(join(root, prefix), {
      withFileTypes: true,
    })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else
        files.set(
          path,
          (await readFile(join(root, path), "utf8")).replaceAll("\r\n", "\n"),
        );
    }
  };
  await walk("");
  return files;
};

const splitSkill = (text: string): { frontmatter: string; body: string } => {
  const match = /^---\n[\s\S]*?\n---\n/u.exec(text);
  return match === null
    ? { frontmatter: "", body: text }
    : { frontmatter: match[0], body: text.slice(match[0].length) };
};

const bodyLines = (body: string): string[] => {
  const lines = body.split("\n");
  return body.endsWith("\n") ? lines.slice(0, -1) : lines;
};

const sectionOf = (body: string, heading: string): string => {
  const start = body.indexOf(`\n## ${heading}\n`);
  if (start === -1) return "";
  const end = body.indexOf("\n## ", start + 1);
  return body.slice(start, end === -1 ? undefined : end);
};

/** Code spans and fenced blocks: where the skill names tools and commands. */
const codeText = (text: string): string[] => [
  ...[...text.matchAll(/```[^\n]*\n([\s\S]*?)```/gu)].map(
    (match) => match[1] ?? "",
  ),
  ...[...text.replaceAll(/```[\s\S]*?```/gu, "").matchAll(/`([^`\n]+)`/gu)].map(
    (match) => match[1] ?? "",
  ),
];

/** GitHub's heading anchor. */
const slug = (heading: string): string =>
  heading
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replaceAll(/\s/gu, "-");

const anchors = (text: string): ReadonlySet<string> =>
  new Set(
    [...text.matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*$/gmu)].map((match) =>
      slug(match[1] ?? ""),
    ),
  );

interface Catalogue {
  readonly tools: ReadonlySet<string>;
  /** Tools that have a CLI command of the same name with hyphens. */
  readonly cliTools: ReadonlySet<string>;
  readonly prompts: ReadonlySet<string>;
  readonly commands: ReadonlySet<string>;
  /** First words of tool names: a snake_case span starting with one claims to be a tool. */
  readonly verbs: ReadonlySet<string>;
  /** Members and values of every advertised schema, and clone-run reason codes. */
  readonly members: ReadonlySet<string>;
}

const catalogue = (): Catalogue => {
  const members = new Set<string>(CLONE_RUN_REASON_CODES);
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) collect(item);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "properties" && typeof value === "object" && value !== null)
        for (const name of Object.keys(value)) members.add(name);
      if (key === "enum" && Array.isArray(value))
        for (const item of value)
          if (typeof item === "string") members.add(item);
      if (key === "const" && typeof value === "string") members.add(value);
      collect(value);
    }
  };
  for (const contract of TOOL_CONTRACTS) {
    collect(advertisedInputJsonSchema(contract));
    collect(advertisedOutputJsonSchema(contract));
  }
  const commands = new Set(CLI_COMMAND_NAMES);
  return {
    tools: new Set(TOOL_CONTRACTS.map(({ name }) => name)),
    cliTools: new Set(
      TOOL_CONTRACTS.map(({ name }) => name).filter((name) =>
        commands.has(name.replaceAll("_", "-")),
      ),
    ),
    prompts: new Set(PROMPT_CONTRACTS.map(({ name }) => name)),
    commands,
    verbs: new Set(TOOL_CONTRACTS.map(({ name }) => name.split("_")[0] ?? "")),
    members,
  };
};

/** Tool names and `rea` commands a file names that this build does not have. */
const unknownNames = (text: string, known: Catalogue): string[] => {
  const unknown = new Set<string>();
  for (const code of codeText(text)) {
    for (const match of code.matchAll(/\brea ([a-z][a-z0-9-]*)/gu))
      if (!known.commands.has(match[1] ?? "")) unknown.add(`rea ${match[1]}`);
    const span = code.trim();
    if (
      /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/u.test(span) &&
      known.verbs.has(span.split("_")[0] ?? "") &&
      !known.tools.has(span) &&
      !known.prompts.has(span) &&
      !known.members.has(span)
    )
      unknown.add(span);
  }
  return [...unknown];
};

/** Problems with the shipped form of a skill file's links. */
const linkIssues = (path: string, text: string, files: SkillFiles): string[] =>
  [...text.matchAll(/\]\(([^)\s]+)\)/gu)].flatMap((match) => {
    const target = match[1] ?? "";
    if (/^[a-z][a-z0-9+.-]*:|^\/\//iu.test(target))
      return [`${path}: link leaves the package: ${target}`];
    const [file = "", anchor] = target.split("#");
    const resolved =
      file === ""
        ? path
        : relative(".", normalize(join(dirname(path), file))).replaceAll(
            "\\",
            "/",
          );
    const content = files.get(resolved);
    if (resolved.startsWith("..") || content === undefined)
      return [`${path}: link to a file outside the skill: ${target}`];
    if (anchor !== undefined && !anchors(content).has(anchor))
      return [`${path}: link to a missing heading: ${target}`];
    return [];
  });

/** Everything the guard checks, over the authored skill files. */
const guardIssues = (files: SkillFiles, known: Catalogue): string[] => {
  const issues: string[] = [];
  const skill = files.get("SKILL.md") ?? "";
  const { frontmatter, body } = splitSkill(skill);
  const lines = bodyLines(body);
  const tokens = estimateTokenCount(body);
  if (lines.length > BODY_MAX_LINES)
    issues.push(`body is ${lines.length} lines, over ${BODY_MAX_LINES}`);
  if (tokens > BODY_MAX_TOKENS)
    issues.push(`body is ${tokens} estimated tokens, over ${BODY_MAX_TOKENS}`);
  const description = /^description: (.*)$/mu.exec(frontmatter)?.[1] ?? "";
  if (description === "" || description.length > DESCRIPTION_MAX_CHARACTERS)
    issues.push(
      `description is ${description.length} characters, not 1 to ${DESCRIPTION_MAX_CHARACTERS}`,
    );
  const firstSteps = sectionOf(body, "First step")
    .split("\n")
    .filter((line) => line.startsWith("- "));
  if (firstSteps.length === 0) issues.push("no first-step list");
  const last = firstSteps.at(-1);
  if (last !== undefined) {
    const end = body.indexOf(last) + last.length;
    const before = estimateTokenCount(body.slice(0, end));
    if (before > FIRST_STEPS_MAX_TOKENS)
      issues.push(
        `the first steps end after ${before} estimated tokens, over ${FIRST_STEPS_MAX_TOKENS}`,
      );
  }
  // A tool without a CLI command of its own name needs its CLI form, or a
  // statement that it has none, in a paragraph of the body about the CLI.
  const cliParagraphs = body
    .split(/\n\s*\n/u)
    .filter((paragraph) => paragraph.includes("CLI"));
  for (const code of codeText(body)) {
    const name = code.trim();
    if (
      known.tools.has(name) &&
      !known.cliTools.has(name) &&
      !cliParagraphs.some((paragraph) => paragraph.includes(`\`${name}\``))
    )
      issues.push(`SKILL.md names ${name} without its CLI form`);
  }
  for (const [path, text] of files) {
    if (!path.endsWith(".md")) continue;
    for (const name of unknownNames(text, known))
      issues.push(`${path} names ${name}, which this build does not have`);
    const shipped = packagedSkillFile(path, text);
    issues.push(...linkIssues(path, shipped, files));
    if (
      path.startsWith("references/") &&
      bodyLines(text).length > CONTENTS_MIN_LINES &&
      !WITHOUT_HEADINGS.has(path)
    ) {
      const list = contentsHeadings(text)
        .map(({ level, title }) => `${level === 3 ? "  " : ""}- ${title}`)
        .join("\n");
      if (!shipped.startsWith(`${CONTENTS_LABEL}\n\n${list}\n\n`))
        issues.push(
          `${path} does not ship with a contents list of its headings`,
        );
    }
  }
  return issues;
};

describe("skill router", () => {
  let files: Map<string, string>;
  let known: Catalogue;

  beforeAll(async () => {
    files = await readSkill(resolve(SKILL_ROOT));
    known = catalogue();
  }, 60_000);

  it("passes the guard", () => {
    expect(guardIssues(files, known)).toEqual([]);
  });

  it("fails the guard for a tool that does not exist", () => {
    const mutated = new Map(files);
    mutated.set(
      "SKILL.md",
      `${files.get("SKILL.md") ?? ""}\nStart with \`inspect_firmware_magic\`.\n`,
    );
    expect(guardIssues(mutated, known)).toEqual([
      "SKILL.md names inspect_firmware_magic, which this build does not have",
    ]);
  });

  it("fails the guard for 200 pasted lines", () => {
    const mutated = new Map(files);
    const pasted = (files.get(ROUTE_REFERENCES.formats) ?? "")
      .split("\n")
      .slice(0, 200)
      .join("\n");
    mutated.set("SKILL.md", `${files.get("SKILL.md") ?? ""}\n${pasted}\n`);
    expect(guardIssues(mutated, known)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^body is \d+ lines, over 150$/u),
        expect.stringMatching(/^body is \d+ estimated tokens, over 1800$/u),
      ]),
    );
  });

  it("installs every file of the skill", () => {
    expect([...MANAGED_SKILL_FILES].sort()).toEqual([...files.keys()].sort());
  });

  it("ships the Cursor plugin copy in its packaged form", async () => {
    const cursor = await readSkill(resolve(CURSOR_ROOT));
    expect([...cursor.keys()].sort()).toEqual([...files.keys()].sort());
    for (const [path, text] of files)
      expect(cursor.get(path), path).toBe(packagedSkillFile(path, text));
  });
});

describe("skill route references", () => {
  let files: Map<string, string>;
  let upstream: string;

  beforeAll(async () => {
    files = await readSkill(resolve(SKILL_ROOT));
    upstream = await readFile(resolve(RECORDED_UPSTREAM), "utf8");
  });

  it("are what the port script makes of the recorded upstream SKILL.md", () => {
    const { files: ported, notes } = portSkillRoutes(upstream);
    expect(notes).toEqual([]);
    for (const [path, text] of Object.entries(ported))
      expect(files.get(path), path).toBe(text);
  });

  it("keep every line of upstream's body, after the fork corrections", () => {
    const ported = Object.values(portSkillRoutes(upstream).files).join("\n");
    let corrected = upstream;
    for (const { find, replace } of FORK_CORRECTIONS)
      corrected = corrected.replace(find, replace);
    const { preamble, sections } = skillSections(corrected);
    const lost = [preamble, ...sections.map(({ text }) => text)]
      .join("\n")
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.startsWith("# "))
      .filter(
        (line) => !ported.includes(line.replaceAll("](references/", "](")),
      );
    expect(lost).toEqual([]);
  });

  it("are each found by a guidance search for their heading", async () => {
    const resources = new ArtifactResourceScope();
    const missing: string[] = [];
    try {
      const reader = (path: string): Promise<string> =>
        Promise.resolve(packagedSkillFile(path, files.get(path) ?? ""));
      for (const guide of [ROUTE_REFERENCES.routes, ROUTE_REFERENCES.formats])
        for (const match of (files.get(guide) ?? "").matchAll(/^## (.+)$/gmu)) {
          const heading = match[1] ?? "";
          const query = heading
            .replace(/: `[a-z0-9_]+`$/u, "")
            .replaceAll(/[`()]/gu, " ");
          const result = await searchGuidanceWithReader(
            { query, limit: 8 },
            reader,
            resources,
          );
          if (!result.ok) throw result.error;
          const found =
            result.value.status === "matches" &&
            result.value.matches.some(
              (item) => item.guide === guide && item.heading === heading,
            );
          if (!found) missing.push(`${guide}: ${heading}`);
        }
    } finally {
      await resources.close();
    }
    expect(missing).toEqual([]);
  }, 60_000);
});
