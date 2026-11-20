import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runCloneRunCases } from "../../../scripts/lib/clone-run-e2e-runner.mjs";
import { startSite } from "../../../scripts/lib/clone-run-e2e-sites.mjs";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

/**
 * The parts of `verify:clone-run` that decide whether a broken run ends: a
 * fixture that cannot start, a failed case and an interruption. The cases
 * themselves need a browser and run in the verifier.
 */

const fixtureModule = async (source: string): Promise<string> => {
  const file = join(
    await createTestTempDirectory("rea-clone-run-verifier-"),
    "site.mjs",
  );
  await writeFile(file, source);
  return file;
};

describe("verify:clone-run fixture servers", () => {
  it("serves a fixture and returns it to its start state on the same port", async () => {
    const site = await startSite(
      fileURLToPath(
        new URL("../../fixtures/cloneRun/original/server.mjs", import.meta.url),
      ),
      "startOriginal",
    );
    try {
      const titles = async (): Promise<number> => {
        const reply = await fetch(`${site.origin}/api/topics`);
        return ((await reply.json()) as { total: number }).total;
      };
      const seeded = await titles();
      const created = await fetch(`${site.origin}/api/topics`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Written before the restart" }),
      });
      expect(created.status).toBe(201);
      expect(await titles()).toBe(seeded + 1);
      await site.restart();
      expect(new URL(site.origin).port).toBe(String(site.port));
      expect(await titles()).toBe(seeded);
    } finally {
      await site.close();
    }
  });

  it("fails promptly when a fixture exits, throws or stays silent instead of reporting its address", async () => {
    const exits = await fixtureModule(
      "export const start = () => process.exit(3);\n",
    );
    await expect(startSite(exits, "start")).rejects.toThrow(
      /exited with code 3 before it reported its address/u,
    );
    const throws = await fixtureModule(
      'export const start = () => { throw new Error("port in use"); };\n',
    );
    await expect(startSite(throws, "start")).rejects.toThrow("port in use");
    const silent = await fixtureModule(
      "export const start = () => new Promise(() => { setInterval(() => {}, 1000); });\n",
    );
    const startedAt = performance.now();
    await expect(
      startSite(silent, "start", { deadlineMs: 300 }),
    ).rejects.toThrow(/reported no address within 300 ms/u);
    expect(performance.now() - startedAt).toBeLessThan(5_000);
  });
});

describe("verify:clone-run case runner", () => {
  const cases = (
    outcomes: readonly ("pass" | "fail")[],
    onRun: (index: number) => void = () => undefined,
  ) =>
    outcomes.map((outcome, index) => ({
      name: `case ${String(index + 1)}`,
      run: (): Promise<string> => {
        onRun(index);
        return outcome === "pass"
          ? Promise.resolve("as stated")
          : Promise.reject(new Error("exit 2 where 1 was expected"));
      },
    }));

  it("verifies only when every case passed, and stops at the first failure", async () => {
    const lines: string[] = [];
    const passed = await runCloneRunCases(
      cases(["pass", "pass"]),
      undefined,
      (line) => lines.push(line),
    );
    expect(passed.verified).toBe(true);
    expect(lines).toEqual([
      "pass: case 1 -- as stated",
      "pass: case 2 -- as stated",
    ]);

    lines.length = 0;
    const ran: number[] = [];
    const failed = await runCloneRunCases(
      cases(["pass", "fail", "pass"], (index) => ran.push(index)),
      undefined,
      (line) => lines.push(line),
    );
    expect(failed.verified).toBe(false);
    expect(ran).toEqual([0, 1]);
    expect(failed.cases.map(({ outcome }) => outcome)).toEqual([
      "passed",
      "failed",
      "not-run",
    ]);
    expect(lines).toEqual([
      "pass: case 1 -- as stated",
      "FAIL: case 2 -- exit 2 where 1 was expected",
      "not run: case 3",
    ]);
    expect(
      (await runCloneRunCases([], undefined, () => undefined)).verified,
    ).toBe(false);
  });

  it("runs no further case once it is interrupted, and verifies nothing", async () => {
    const interruption = new AbortController();
    const ran: number[] = [];
    const lines: string[] = [];
    const result = await runCloneRunCases(
      cases(["pass", "pass", "pass"], (index) => {
        ran.push(index);
        if (index === 0)
          interruption.abort(new Error("interrupted by SIGTERM"));
      }),
      undefined,
      (line) => lines.push(line),
      interruption.signal,
    );
    // The case in hand had finished; a pass before the interruption stays a pass.
    expect(ran).toEqual([0]);
    expect(result.cases.map(({ outcome }) => outcome)).toEqual([
      "passed",
      "not-run",
      "not-run",
    ]);
    expect(result.verified).toBe(false);

    // A case whose command the interruption stopped says what stopped it.
    lines.length = 0;
    const stopped = new AbortController();
    const cancelled = await runCloneRunCases(
      [
        {
          name: "in hand",
          run: (): Promise<string> => {
            stopped.abort(new Error("interrupted by SIGINT"));
            return Promise.reject(new Error("Command cancelled."));
          },
        },
        ...cases(["pass"]),
      ],
      undefined,
      (line) => lines.push(line),
      stopped.signal,
    );
    expect(cancelled.verified).toBe(false);
    expect(lines).toEqual([
      "FAIL: in hand -- interrupted by SIGINT (Command cancelled.)",
      "not run: case 1",
    ]);
  });
});
