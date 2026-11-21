import { expect, it } from "vitest";
import { ArtifactResourceScope } from "../../src/resources/ArtifactResourceScope.js";
import {
  readGuidanceSection,
  searchGuidance,
} from "../../src/application/GuidanceAccess.js";

it("finds and retrieves the selected section from the generated package bundle", async () => {
  const resources = new ArtifactResourceScope();
  try {
    const result = await searchGuidance(
      { query: "exact JavaScript module" },
      resources,
    );
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject({
      status: "matches",
      source: "installed_rea_guidance",
      package: expect.stringMatching(/^rea-agents@/u),
    });
    if (result.value.status !== "matches")
      throw new Error("Expected guidance matches");
    const match = result.value.matches.find(
      ({ heading }) => heading === "Read a module without repeating analysis",
    );
    expect(match).toBeDefined();
    expect(result.value.matches[0]?.heading).toBe(
      "Read a module without repeating analysis",
    );
    expect(match).toMatchObject({
      guide: "references/javascript-applications.md",
      matched: "3 of 3: exact, javascript, module",
      context: expect.stringContaining("javascript-module"),
    });
    if (match === undefined) throw new Error("Expected selected guidance");

    const retrieved = await readGuidanceSection(
      { locator: match.locator },
      resources,
    );
    if (!retrieved.ok) throw retrieved.error;
    expect(retrieved.value).toMatchObject({
      status: "section",
      source: "installed_rea_guidance",
      guide: match.guide,
      heading: match.heading,
      locator: match.locator,
      content: expect.stringContaining("node_id"),
    });
  } finally {
    await resources.close();
  }
});

it("finds focused installed guidance for switching providers with annotations", async () => {
  const resources = new ArtifactResourceScope();
  try {
    const focused = await searchGuidance(
      { query: "Ghidra annotations" },
      resources,
    );
    if (!focused.ok) throw focused.error;
    if (focused.value.status !== "matches")
      throw new Error("Expected guidance matches");
    expect(focused.value.matches[0]).toMatchObject({
      heading: "Function annotations in Ghidra",
    });

    const switched = await searchGuidance(
      { query: "switch provider annotations", limit: 20 },
      resources,
    );
    if (!switched.ok) throw switched.error;
    if (switched.value.status !== "matches")
      throw new Error("Expected guidance matches");
    const match = switched.value.matches.find(
      ({ heading }) => heading === "Function annotations in Ghidra",
    );
    expect(match).toMatchObject({
      guide: "references/native-and-artifacts.md",
      matched: "3 of 3: switch, provider, annotations",
    });
    if (match === undefined) throw new Error("Expected Ghidra guidance");
    const read = await readGuidanceSection(
      { locator: match.locator },
      resources,
    );
    if (!read.ok) throw read.error;
    expect(read.value).toMatchObject({
      status: "section",
      heading: match.heading,
      content: expect.stringContaining("discard"),
    });
  } finally {
    await resources.close();
  }
});

type Accepted = readonly (readonly [RegExp, RegExp])[];

/** The skill router's own list of first steps, which several queries rightly reach. */
const FIRST_STEP = [/^SKILL\.md$/u, /^First step$/u] as const;

/**
 * The audit's twenty queries (census-skill 05-guidance.mjs) with the sections
 * an agent should land on first; any listed section counts. Each list was
 * chosen by reading the sections after the skill became a router and its
 * route list moved into one section per route under references/. The plan's
 * bar is at least 18 right first and no empty reply.
 */
const TWENTY: readonly (readonly [string, Accepted])[] = [
  [
    "clone a web application",
    [
      [/clone-runs/u, /./u],
      [/target-routes/u, /^Asked to rebuild or clone a web application/u],
    ],
  ],
  [
    "rebuild website and check it matches",
    [
      [/clone-runs/u, /./u],
      [/target-routes/u, /^Asked to rebuild or clone a web application/u],
    ],
  ],
  ["clone run prober", [[/clone-runs/u, /^Prober$/u]]],
  ["evidence_stale", [[/clone-runs/u, /^Verifier$/u]]],
  ["stalled what now", [[/clone-runs/u, /when to stop|The loop/u]]],
  [
    "decompile a function in a native binary",
    [
      [/target-routes/u, /^Native executable, library, or analysis database/u],
      [/native-and-artifacts/u, /^Native targets$/u],
      FIRST_STEP,
    ],
  ],
  [
    "android apk classes methods",
    [
      [/android-applications/u, /./u],
      [/target-routes/u, /^Android APK code, classes, methods/u],
      FIRST_STEP,
    ],
  ],
  [
    "electron asar",
    [
      [/javascript-applications/u, /./u],
      [/target-routes/u, /^ASAR or extracted JavaScript\/Electron tree/u],
      FIRST_STEP,
    ],
  ],
  [
    "firmware image",
    [
      [/target-routes/u, /^UEFI firmware volumes|^ESP32-family/u],
      [/native-and-artifacts/u, /^ESP|^Packages and extraction$/u],
      FIRST_STEP,
    ],
  ],
  [
    "compare two versions",
    [
      [/target-routes/u, /^Two versions of one target/u],
      [/javascript-applications/u, /./u],
      [/evidence-workflows/u, /./u],
      FIRST_STEP,
    ],
  ],
  [
    "core dump crash",
    [
      [/format-inspectors/u, /^Supplied Linux ELF64 amd64 or AArch64 core/u],
      [/native-and-artifacts/u, /^Recorded Linux crashes$/u],
      FIRST_STEP,
    ],
  ],
  ["provider_unavailable", [[/connection-and-recovery/u, /./u]]],
  [
    "ghidra startup timeout",
    [
      [/native-and-artifacts/u, /^Ghidra startup deadline recovery$/u],
      [/target-routes/u, /^Ghidra startup timeout$/u],
    ],
  ],
  [
    "tools missing after setup",
    [
      [/connection-and-recovery/u, /./u],
      [/working-with-rea/u, /^Connect only when needed$/u],
    ],
  ],
  [
    "result too large truncated",
    [
      [/working-with-rea/u, /^Work summary-first$/u],
      [/^SKILL\.md$/u, /^When a step is refused$/u],
      [/javascript-applications/u, /^Recover an oversized display$/u],
    ],
  ],
  [
    "which api endpoints does the page call",
    [
      [
        /target-routes/u,
        /^Passive traffic capture of a SPA|^User-owned browser page already open/u,
      ],
      [/runtime-observation/u, /^Browser and Electron$/u],
      [/javascript-applications/u, /route candidates/u],
      FIRST_STEP,
    ],
  ],
  ["agent environment from a HAR", [[/environments/u, /./u]]],
  [
    "desktop app environment task",
    [
      [/desktop-build/u, /./u],
      [/environments/u, /desktop/iu],
      [
        /target-routes/u,
        /^Environment of a Linux desktop app|^Task for a desktop/u,
      ],
    ],
  ],
  [
    "frida instrumentation",
    [[/runtime-observation/u, /^Native runtime questions$/u]],
  ],
  [
    "recover readable source from minified bundle",
    [
      [
        /javascript-applications/u,
        /^JavaScript and Electron application artifacts$/u,
      ],
      [/target-routes/u, /^ASAR or extracted JavaScript\/Electron tree/u],
      FIRST_STEP,
    ],
  ],
];

/**
 * Queries agents typed in the task benchmark (runs r1 and r2) that answered
 * `no_matches` or nothing useful, with the section that answers each. Two
 * have no section yet and are left out until a route exists: "openapi" (no
 * guidance names `inspect_api_contract`) and "string literal rodata without
 * provider" (no guidance names a provider-free way to read a data address).
 */
const AGENT_QUERIES: readonly (readonly [string, Accepted])[] = [
  [
    "debug information source files optimisation",
    [
      [/format-inspectors/u, /^DWARF compile units/u],
      [/native-and-artifacts/u, /^DWARF compile units$/u],
    ],
  ],
  [
    "binary licence key validation",
    [[/target-routes/u, /^Native executable, library, or analysis database/u]],
  ],
  [
    "no provider",
    [
      [
        /connection-and-recovery/u,
        /^Choose the remedy from the observed failure$/u,
      ],
      [/^SKILL\.md$/u, /^When a step is refused$/u],
      [/format-inspectors/u, /^Native code or data with no analysis provider/u],
    ],
  ],
  [
    "openapi",
    [[/format-inspectors/u, /^OpenAPI or GraphQL API contract file/u]],
  ],
  [
    "string literal rodata without provider",
    [[/format-inspectors/u, /^Native code or data with no analysis provider/u]],
  ],
  [
    "dump bytes at address",
    [[/native-and-artifacts/u, /^Static memory and original file bytes$/u]],
  ],
  [
    "capture records page",
    [[/runtime-observation/u, /^Fiddler Everywhere traffic debugging$/u]],
  ],
  [
    "browser scenario click",
    [[/target-routes/u, /^Browser action the agent must perform/u]],
  ],
];

/** The queries whose first match is not one of their accepted sections. */
const wrongFirst = async (
  table: readonly (readonly [string, Accepted])[],
  resources: ArtifactResourceScope,
): Promise<string[]> => {
  const wrong: string[] = [];
  for (const [query, accepted] of table) {
    const result = await searchGuidance({ query }, resources);
    if (!result.ok) throw result.error;
    expect(result.value.status, query).toBe("matches");
    if (result.value.status !== "matches") continue;
    expect(result.value.matches.length, query).toBeLessThanOrEqual(3);
    const first = result.value.matches[0]!;
    if (
      !accepted.some(
        ([guide, heading]) =>
          guide.test(first.guide) && heading.test(first.heading),
      )
    )
      wrong.push(`${query}: ${first.guide} > ${first.heading}`);
  }
  return wrong;
};

it("puts the right section first for at least 18 of the audit's twenty queries", async () => {
  const resources = new ArtifactResourceScope();
  try {
    const wrong = await wrongFirst(TWENTY, resources);
    expect(wrong.length, wrong.join("\n")).toBeLessThanOrEqual(2);
  } finally {
    await resources.close();
  }
});

it("puts the right section first for every query agents typed that has one", async () => {
  const resources = new ArtifactResourceScope();
  try {
    expect(await wrongFirst(AGENT_QUERIES, resources)).toEqual([]);
  } finally {
    await resources.close();
  }
});
