import { expect, it } from "vitest";
import { ArtifactResourceScope } from "../resources/ArtifactResourceScope.js";
import { RegularFileCleanupFailure } from "../filesystem/OwnedRegularFile.js";
import { MANAGED_SKILL_FILES } from "./SetupSkill.js";
import { searchGuidanceOutputSchema } from "../contracts/guidanceContracts.js";
import { RetainedRegularFileCleanupFailure } from "../process/RegularFileRead.js";
import { sha256Hex } from "../kernel/sha256Hex.js";
import {
  readGuidanceSectionWithReader,
  searchGuidanceWithReader,
} from "./GuidanceAccess.js";

const moduleGuide = `# JavaScript applications\n\n## Read a module without repeating analysis\n\nFor an exact JavaScript module (javascript-module), select its source path and module identity:\n\n\`\`\`json\n{"node_id":"module:main.js","kind":"javascript-module"}\n\`\`\`\n`;
const guideFixture = async (path: string): Promise<string> =>
  path === "references/javascript-applications.md"
    ? moduleGuide
    : `# ${path}\n\nGeneral module guidance for pagination.\n`;

const valueOf = async (
  request: ReturnType<typeof searchGuidanceWithReader>,
) => {
  const result = await request;
  if (!result.ok) throw result.error;
  return searchGuidanceOutputSchema.parse(result.value);
};

it("ranks a focused JavaScript module section and retrieves it with its locator", async () => {
  const resources = new ArtifactResourceScope();
  const result = await valueOf(
    searchGuidanceWithReader(
      { query: "exact JavaScript module" },
      guideFixture,
      resources,
    ),
  );
  expect(result.status).toBe("matches");
  if (result.status !== "matches") throw new Error("Expected guide matches");
  expect(result.matches[0]).toMatchObject({
    guide: "references/javascript-applications.md",
    heading: "Read a module without repeating analysis",
    matched: "3 of 3: exact, javascript, module",
    context: expect.stringContaining("javascript-module"),
  });
  const selected = result.matches[0];
  if (selected === undefined) throw new Error("Expected selected guidance");
  const retrieved = await readGuidanceSectionWithReader(
    { locator: selected.locator },
    guideFixture,
    resources,
  );
  if (!retrieved.ok) throw retrieved.error;
  expect(retrieved.value).toMatchObject({
    status: "section",
    source: "installed_rea_guidance",
    guide: selected.guide,
    heading: selected.heading,
    locator: selected.locator,
    content: expect.stringContaining('"node_id":"module:main.js"'),
  });
});

it("returns an honest no-match result and rejects empty queries and invalid bounds", async () => {
  const resources = new ArtifactResourceScope();
  expect(
    await valueOf(
      searchGuidanceWithReader(
        { query: "unlikely qzxv term" },
        guideFixture,
        resources,
      ),
    ),
  ).toMatchObject({
    status: "no_matches",
    total_matches: 0,
    message: expect.stringContaining("does not indicate"),
  });
  expect(
    await valueOf(
      searchGuidanceWithReader(
        { query: "how do I frobnicate qzxv" },
        guideFixture,
        resources,
      ),
    ),
  ).toMatchObject({
    status: "no_matches",
    total_matches: 0,
  });
  expect(
    await searchGuidanceWithReader({ query: "  " }, guideFixture, resources),
  ).toMatchObject({ ok: false });
  expect(
    await searchGuidanceWithReader(
      { query: "x".repeat(2049) },
      guideFixture,
      resources,
    ),
  ).toMatchObject({ ok: false });
  expect(
    await searchGuidanceWithReader(
      { query: "module", limit: 21 },
      guideFixture,
      resources,
    ),
  ).toMatchObject({ ok: false });
});

it("does not treat Markdown headings inside fenced code as section boundaries", async () => {
  const result = await valueOf(
    searchGuidanceWithReader(
      { query: "phantom-heading-token" },
      async (path) =>
        `${await guideFixture(path)}\n\n\`\`\`markdown\n# phantom-heading-token\n\`\`\`\n`,
      new ArtifactResourceScope(),
    ),
  );
  expect(result.status).toBe("matches");
  if (result.status !== "matches") throw new Error("Expected guide matches");
  expect(result.matches.map(({ heading }) => heading)).not.toContain(
    "phantom-heading-token",
  );
});

it("refuses an oversized guide bundle instead of indexing partial content", async () => {
  const result = await searchGuidanceWithReader(
    { query: "module" },
    async (path) =>
      path === "SKILL.md" ? "x".repeat(4_194_305) : guideFixture(path),
    new ArtifactResourceScope(),
  );
  expect(result).toMatchObject({
    ok: true,
    value: { status: "bundle_unavailable" },
  });
});

it("paginates deterministically without losing, duplicating, or reordering matches", async () => {
  const readGuide = guideFixture;
  const first = await valueOf(
    searchGuidanceWithReader(
      { query: "module", limit: 2 },
      readGuide,
      new ArtifactResourceScope(),
    ),
  );
  const repeat = await valueOf(
    searchGuidanceWithReader(
      { query: "module", limit: 2 },
      readGuide,
      new ArtifactResourceScope(),
    ),
  );
  expect(first).toEqual(repeat);
  if (first.status !== "matches") throw new Error("Expected guide matches");
  expect(first.has_more).toBe(true);
  const all = first.matches.map(({ locator }) => locator);
  let cursor = first.next_cursor;
  while (cursor !== undefined) {
    const page = await valueOf(
      searchGuidanceWithReader(
        { query: "module", limit: 2, cursor },
        readGuide,
        new ArtifactResourceScope(),
      ),
    );
    if (page.status !== "matches") throw new Error("Expected guide matches");
    all.push(...page.matches.map(({ locator }) => locator));
    cursor = page.next_cursor;
  }
  const complete = await valueOf(
    searchGuidanceWithReader(
      { query: "module", limit: 20 },
      readGuide,
      new ArtifactResourceScope(),
    ),
  );
  if (complete.status !== "matches") throw new Error("Expected guide matches");
  expect(new Set(all).size).toBe(all.length);
  expect(all).toEqual(complete.matches.map(({ locator }) => locator));
});

it("rejects malformed locators and reports changed or missing installed guides", async () => {
  const resources = new ArtifactResourceScope();
  const search = await valueOf(
    searchGuidanceWithReader(
      { query: "exact JavaScript module" },
      guideFixture,
      resources,
    ),
  );
  if (search.status !== "matches") throw new Error("Expected guide matches");
  expect(
    await readGuidanceSectionWithReader(
      { locator: "../../outside.md" },
      guideFixture,
      resources,
    ),
  ).toMatchObject({ ok: false });
  const changedReader = async (path: string) =>
    `${await guideFixture(path)}\nChanged after search.\n`;
  const stale = await readGuidanceSectionWithReader(
    { locator: search.matches[0]?.locator },
    changedReader,
    resources,
  );
  expect(stale).toMatchObject({ ok: true, value: { status: "stale_locator" } });
  const firstPage = await valueOf(
    searchGuidanceWithReader(
      { query: "module", limit: 1 },
      guideFixture,
      resources,
    ),
  );
  if (firstPage.status !== "matches" || firstPage.next_cursor === undefined)
    throw new Error("Expected a continuation token");
  expect(
    await searchGuidanceWithReader(
      { query: "module", limit: 1, cursor: firstPage.next_cursor },
      changedReader,
      resources,
    ),
  ).toMatchObject({ ok: true, value: { status: "stale_continuation" } });
  expect(
    await searchGuidanceWithReader(
      { query: "different query", cursor: firstPage.next_cursor },
      guideFixture,
      resources,
    ),
  ).toMatchObject({ ok: false });
  expect(
    await searchGuidanceWithReader(
      { query: "module", cursor: "garbage" },
      guideFixture,
      resources,
    ),
  ).toMatchObject({ ok: false });
  const missingReader = async (): Promise<string> => {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  };
  expect(
    await searchGuidanceWithReader(
      { query: "module" },
      missingReader,
      resources,
    ),
  ).toMatchObject({ ok: true, value: { status: "bundle_unavailable" } });
  expect(
    await readGuidanceSectionWithReader(
      { locator: search.matches[0]?.locator },
      missingReader,
      resources,
    ),
  ).toMatchObject({ ok: true, value: { status: "bundle_unavailable" } });
});

it("returns cleanup failures separately and retains their owner until retry succeeds", async () => {
  const resources = new ArtifactResourceScope();
  let failRelease = true;
  const failure = new RegularFileCleanupFailure({
    path: "guidance file handle",
    owner: {
      close: async () => {
        if (failRelease) throw new Error("descriptor close failed");
      },
    } as never,
    outcome: { kind: "failed", cause: new Error("guide read failed") },
    cleanupCause: new Error("descriptor close failed"),
  });
  const retainedFailure = new RetainedRegularFileCleanupFailure(failure);
  resources.retain(retainedFailure.cleanupOwner);
  const result = await searchGuidanceWithReader(
    { query: "module" },
    async () => {
      throw retainedFailure;
    },
    resources,
  );
  if (result.ok) throw new Error("Expected a retained cleanup failure");
  expect(result.error).toMatchObject({ cleanupIncomplete: true });
  expect(result.error.cleanupResources).toEqual(["guidance file handle"]);
  expect(resources.hasPending).toBe(true);
  failRelease = false;
  await resources.close();
  expect(resources.hasPending).toBe(false);
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(result.error.cleanupResources).toEqual([]);

  const freshResources = new ArtifactResourceScope();
  freshResources.retain({
    kind: "lease",
    resource: "unrelated pending resource",
    lease: { release: async () => undefined },
  });
  expect(
    await searchGuidanceWithReader(
      { query: "module" },
      async () => {
        throw new Error("guide is unreadable");
      },
      freshResources,
    ),
  ).toMatchObject({
    ok: true,
    value: { status: "bundle_unavailable" },
  });
  await freshResources.close();
});

it("uses only the fixed managed guide inventory for injected reads", async () => {
  const requested: string[] = [];
  await searchGuidanceWithReader(
    { query: "module" },
    async (path) => {
      requested.push(path);
      return guideFixture(path);
    },
    new ArtifactResourceScope(),
  );
  expect(requested).toEqual([...MANAGED_SKILL_FILES]);
});

const nestedGuide = [
  "# Native guide",
  "",
  "Overview of native work.",
  "",
  "## Apple app resources",
  "",
  "Switch provider bundles here.",
  "",
  "## Native targets",
  "",
  "Annotations in Ghidra last until close.",
  "",
  "### Function annotations in Ghidra",
  "",
  "Rename functions; annotations last until close.",
  "",
  "## Combined recovery",
  "",
  "Recovery steps.",
  "",
  "### Step alpha",
  "",
  "Use alphaword here.",
  "",
  "### Step beta",
  "",
  "Use betaword here.",
  "",
].join("\n");
const nestedReader = async (path: string): Promise<string> =>
  path === "references/native-and-artifacts.md"
    ? nestedGuide
    : `# ${path}\n\nUnrelated guidance.\n`;
const matchesFor = async (query: string, limit = 20) => {
  const result = await valueOf(
    searchGuidanceWithReader(
      { query, limit },
      nestedReader,
      new ArtifactResourceScope(),
    ),
  );
  if (result.status !== "matches") throw new Error(`No matches: ${query}`);
  return result.matches;
};

const readSection = async (locator: string | undefined) => {
  const result = await readGuidanceSectionWithReader(
    { locator },
    nestedReader,
    new ArtifactResourceScope(),
  );
  if (!result.ok) throw result.error;
  return result.value;
};

it("ranks by covered query words, shows the count and needs more than half of them", async () => {
  const matches = await matchesFor("switch provider annotations");
  expect(matches[0]).toMatchObject({
    heading: "Apple app resources",
    matched: "2 of 3: switch, provider",
    locator: expect.stringMatching(
      /^references\/native-and-artifacts\.md#1\.[a-f0-9]{8}$/u,
    ),
  });
  // Two words of four is not more than half: no section qualifies.
  const none = await valueOf(
    searchGuidanceWithReader(
      { query: "alphaword betaword deltaword epsilonword" },
      nestedReader,
      new ArtifactResourceScope(),
    ),
  );
  expect(none.status).toBe("no_matches");
});

it("weighs heading words above words in the text", async () => {
  const matches = await matchesFor("annotations close");
  expect(matches.map(({ heading }) => heading).slice(0, 2)).toEqual([
    "Function annotations in Ghidra",
    "Native targets",
  ]);
  expect(matches[0]?.context).toBe(
    "Rename functions; annotations last until close.",
  );
});

it("returns three matches by default", async () => {
  const result = await valueOf(
    searchGuidanceWithReader(
      { query: "native ghidra recovery annotations" },
      nestedReader,
      new ArtifactResourceScope(),
    ),
  );
  if (result.status !== "matches") throw new Error("Expected matches");
  expect(result.limit).toBe(3);
  expect(result.matches.length).toBeLessThanOrEqual(3);
});

it("reads a whole guide's short locator as its introduction and sections", async () => {
  const [guide] = await matchesFor("overview");
  expect(guide).toMatchObject({ heading: "Native guide" });
  const read = await readSection(guide?.locator);
  if (read.status !== "section") throw new Error("Expected a section");
  expect(read.content).toContain("Overview of native work.");
  expect(read.content).toContain("- Combined recovery: references/");
  expect(read.content).not.toContain("Use betaword here.");
  expect(guide?.content_length).toBe(
    read.content.split("\n\nSections")[0]?.length,
  );
});

it("finds a section by its keyword line and an identifier spelled exactly", async () => {
  const reader = async (path: string): Promise<string> =>
    path === "SKILL.md"
      ? [
          "# REA",
          "",
          "## Mentions",
          "",
          "A zebra, and a stale evidence note.",
          "",
          "## Keyworded",
          "",
          "<!-- keywords: zebra -->",
          "",
          "Body text.",
          "",
          "## Code",
          "",
          "Reason `evidence_stale` means the clone changed.",
          "",
        ].join("\n")
      : `# ${path}\n\nUnrelated guidance.\n`;
  const search = async (query: string) => {
    const result = await valueOf(
      searchGuidanceWithReader({ query }, reader, new ArtifactResourceScope()),
    );
    if (result.status !== "matches") throw new Error(`No matches: ${query}`);
    return result.matches.map(({ heading }) => heading);
  };
  expect((await search("zebra"))[0]).toBe("Keyworded");
  expect((await search("evidence_stale"))[0]).toBe("Code");
});

it("lists the guides and their headings with locators that read", async () => {
  const all = await readSection("contents");
  if (all.status !== "contents") throw new Error("Expected contents");
  const native = all.guides.find(
    ({ guide }) => guide === "references/native-and-artifacts.md",
  );
  expect(
    native?.sections.map(({ heading, depth }) => [heading, depth]),
  ).toEqual([
    ["Native guide", 0],
    ["Apple app resources", 1],
    ["Native targets", 1],
    ["Combined recovery", 1],
  ]);
  const one = await readSection("contents:references/native-and-artifacts.md");
  if (one.status !== "contents") throw new Error("Expected contents");
  expect(one.guides).toHaveLength(1);
  expect(one.guides[0]?.sections.map(({ heading }) => heading)).toContain(
    "Step beta",
  );
  const step = one.guides[0]?.sections.find(
    ({ heading }) => heading === "Step beta",
  );
  expect(await readSection(step?.locator)).toMatchObject({
    status: "section",
    content: "### Step beta\n\nUse betaword here.",
  });
  expect(
    await readGuidanceSectionWithReader(
      { locator: "contents:../outside.md" },
      nestedReader,
      new ArtifactResourceScope(),
    ),
  ).toMatchObject({ ok: false });
});

it("still reads a locator in the earlier long form", async () => {
  const result = await valueOf(
    searchGuidanceWithReader(
      { query: "betaword" },
      nestedReader,
      new ArtifactResourceScope(),
    ),
  );
  if (result.status !== "matches") throw new Error("Expected matches");
  const content = "### Step beta\n\nUse betaword here.";
  const long = `rea-guide-v1.${Buffer.from(
    JSON.stringify({
      v: 1,
      bundle: result.bundle_sha256,
      guide: "references/native-and-artifacts.md",
      ordinal: 6,
      section: sha256Hex(content),
    }),
  ).toString("base64url")}`;
  expect(await readSection(long)).toMatchObject({ status: "section", content });
  // The long form of a whole guide still reads the whole guide.
  const root = `rea-guide-v1.${Buffer.from(
    JSON.stringify({
      v: 1,
      bundle: result.bundle_sha256,
      guide: "references/native-and-artifacts.md",
      ordinal: 0,
      section: sha256Hex(nestedGuide.trim()),
    }),
  ).toString("base64url")}`;
  expect(await readSection(root)).toMatchObject({
    status: "section",
    content: nestedGuide.trim(),
  });
});
