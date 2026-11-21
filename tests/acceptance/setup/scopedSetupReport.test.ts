import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "setup for one client reports that client, names the skill file and keeps the full report behind a flag",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-scoped-setup-");
    const run = (...extra: readonly string[]) =>
      cli.run({
        arguments: [
          "setup",
          "--dry-run",
          "--json",
          "--client",
          "claude_code",
          ...extra,
        ],
        cwd: home,
        environment: { HOME: home, USERPROFILE: home, TMPDIR: home },
      });
    const scoped = await run();
    expect(scoped.exitCode, scoped.stdout).toBe(0);
    const report = scoped.json as Record<string, unknown> & {
      clientStates: { client: { name: string } }[];
    };
    expect(report.clientStates.map(({ client }) => client.name)).toEqual([
      "claude_code",
    ]);
    expect(report.other_clients).toMatch(
      /other supported clients .*--full-report/u,
    );
    expect(report.duplicate_skill).toBeUndefined();
    const keys = Object.keys(report);
    expect(keys.at(-1)).toBe("skill");
    expect(report.skill).toBe(
      `Skill file: ${join(home, ".claude", "skills", "reverse-engineer-anything", "SKILL.md")} (would be installed)`,
    );

    const full = await run("--full-report");
    const fullReport = full.json as {
      clientStates: unknown[];
      skill?: unknown;
    };
    expect(fullReport.clientStates.length).toBeGreaterThan(10);
    expect(fullReport.skill).toBeUndefined();
    expect(Buffer.byteLength(scoped.stdout) * 3).toBeLessThan(
      Buffer.byteLength(full.stdout),
    );

    // An enabled REA plugin brings its own copy of the skill.
    await mkdir(join(home, ".claude"), { recursive: true });
    await writeFile(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: { "rea@rea": true } }),
    );
    const twice = await run();
    expect(
      (twice.json as { duplicate_skill?: string }).duplicate_skill,
    ).toMatch(/rea@rea.*listed twice.*--skill=false/u);
    const noSkill = await run("--skill=false");
    expect(
      (noSkill.json as { duplicate_skill?: string }).duplicate_skill,
    ).toBeUndefined();
  },
);
