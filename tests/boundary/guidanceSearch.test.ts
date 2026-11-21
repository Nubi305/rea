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

/**
 * The audit's twenty queries (census-skill 05-guidance.mjs) with the sections
 * an agent should land on first; any listed section counts. The plan's bar
 * is at least 18 right first and no empty reply.
 */
const TWENTY: readonly (readonly [
  string,
  readonly (readonly [RegExp, RegExp])[],
])[] = [
  [
    "clone a web application",
    [
      [/clone-runs/u, /./u],
      [/SKILL/u, /Route the target first/u],
    ],
  ],
  ["rebuild website and check it matches", [[/clone-runs/u, /./u]]],
  ["clone run prober", [[/clone-runs/u, /^Prober$/u]]],
  ["evidence_stale", [[/clone-runs/u, /^Verifier$/u]]],
  ["stalled what now", [[/clone-runs/u, /when to stop|The loop/u]]],
  [
    "decompile a function in a native binary",
    [
      [/native-and-artifacts/u, /Native targets|Native, managed/u],
      [/SKILL/u, /Route the target first/u],
    ],
  ],
  [
    "android apk classes methods",
    [
      [/android-applications/u, /./u],
      [/SKILL/u, /Route the target first/u],
    ],
  ],
  [
    "electron asar",
    [
      [/javascript-applications/u, /./u],
      [/SKILL/u, /Route the target first/u],
    ],
  ],
  [
    "firmware image",
    [
      [/SKILL/u, /Route the target first/u],
      [/native-and-artifacts/u, /ESP|Packages and extraction/u],
    ],
  ],
  [
    "compare two versions",
    [
      [/javascript-applications/u, /./u],
      [/native-and-artifacts/u, /Native, managed/u],
      [/evidence-workflows/u, /./u],
    ],
  ],
  [
    "core dump crash",
    [
      [/native-and-artifacts/u, /Recorded Linux crashes/u],
      [/SKILL/u, /Route the target first/u],
    ],
  ],
  ["provider_unavailable", [[/connection-and-recovery/u, /./u]]],
  [
    "ghidra startup timeout",
    [[/native-and-artifacts/u, /Ghidra startup deadline recovery/u]],
  ],
  [
    "tools missing after setup",
    [
      [/connection-and-recovery/u, /./u],
      [/SKILL/u, /Connect only when needed/u],
    ],
  ],
  [
    "result too large truncated",
    [
      [/SKILL/u, /Work summary-first/u],
      [/javascript-applications/u, /oversized/u],
    ],
  ],
  [
    "which api endpoints does the page call",
    [
      [/SKILL/u, /Route the target first/u],
      [/runtime-observation/u, /Browser/u],
      [/javascript-applications/u, /route candidates/u],
    ],
  ],
  ["agent environment from a HAR", [[/environments/u, /./u]]],
  [
    "desktop app environment task",
    [
      [/desktop-build/u, /./u],
      [/environments/u, /desktop/iu],
    ],
  ],
  [
    "frida instrumentation",
    [[/runtime-observation/u, /Native runtime questions/u]],
  ],
  [
    "recover readable source from minified bundle",
    [[/javascript-applications/u, /./u]],
  ],
];

it("puts the right section first for at least 18 of the audit's twenty queries", async () => {
  const resources = new ArtifactResourceScope();
  try {
    const wrong: string[] = [];
    for (const [query, accepted] of TWENTY) {
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
    expect(wrong.length, wrong.join("\n")).toBeLessThanOrEqual(2);
  } finally {
    await resources.close();
  }
});
