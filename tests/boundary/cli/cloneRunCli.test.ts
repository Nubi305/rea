import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import {
  cloneRunGateSchema,
  cloneRunInitResultSchema,
  cloneRunTargetSchema,
} from "../../../src/domain/cloneRun/cloneRunSchemas.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";

const BROWSER = "/opt/fixture-browser/chromium";

const initArguments = (run: string, cloneRoot: string): string[] => [
  "init-clone-run",
  run,
  "--original",
  "http://127.0.0.1:4000",
  "--clone",
  "http://127.0.0.1:4001",
  "--clone-root",
  cloneRoot,
  "--clone-name",
  "Tidewater",
  "--original-name",
  "Quillbrook",
  "--original-name",
  "Quill Brook",
  "--authorization",
  "The original is our own product.",
  "--browser",
  BROWSER,
];

/** Run one command in its own process, so its exit status is the command's own. */
const run = (cli: TestCli, argv: readonly string[]) =>
  cli.run({ arguments: [...argv, "--json"], freshProcess: true });

/** REA's error envelope: a refusal names its code and carries no verdict. */
const expectRefusal = (result: Awaited<ReturnType<typeof run>>) => {
  expect(result.exitCode, result.stdout).toBe(1);
  expect(result.json).toMatchObject({
    error: "Application workflow failed",
    code: expect.any(String),
    message: expect.any(String),
  });
  expect(result.json).not.toHaveProperty("verdict");
  return result.json as { readonly message: string };
};

describe("rea init-clone-run", () => {
  cliTest(
    "scaffolds a run folder from its flags and overwrites nothing",
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-clone-run-cli-");
      const directory = join(root, "run");
      const created = await run(cli, [
        ...initArguments(directory, join(root, "clone")),
        "--exclude",
        "data",
        "--clone-reset",
        "npm run reset",
        "--rea-command",
        "npx rea-agents",
        "--max-rounds",
        "5",
        "--capture-timeout-seconds",
        "90",
        "--browser-no-sandbox",
      ]);
      expect(created.exitCode, created.stdout + created.stderr).toBe(0);
      const result = cloneRunInitResultSchema.parse(created.json);
      expect(result.run).toBe(directory);
      expect(result.created).toContain("target.json");
      expect(result.authored.map(({ file }) => file)).toEqual([
        "scenarios/<scenario>.json",
        "obligations/<area>.json",
        "unknowns/<role>-<n>.json",
      ]);

      const target = cloneRunTargetSchema.parse(
        JSON.parse(await readFile(join(directory, "target.json"), "utf8")),
      );
      expect(target).toMatchObject({
        original: {
          address: "http://127.0.0.1:4000",
          names: ["Quillbrook", "Quill Brook"],
        },
        clone: {
          address: "http://127.0.0.1:4001",
          name: "Tidewater",
          root: join(root, "clone"),
          exclude: ["data"],
          commands: { reset: "npm run reset", start: null },
        },
        browser: { executable_path: BROWSER, no_sandbox: true },
        rea_command: "npx rea-agents",
        limits: { min_captures: 2, max_rounds: 5, capture_timeout_seconds: 90 },
      });
      expect(
        JSON.parse(
          await readFile(join(directory, "intended-differences.json"), "utf8"),
        ),
      ).toMatchObject({
        renames: [
          { from: "Quillbrook", to: "Tidewater" },
          { from: "Quill Brook", to: "Tidewater" },
        ],
      });
      expect(await readdir(join(directory, "examples"))).toHaveLength(3);

      const again = expectRefusal(
        await run(cli, initArguments(directory, join(root, "clone"))),
      );
      expect(again.message).toMatch(/empty/iu);
    },
  );

  cliTest(
    "refuses a run it could never pass, and a missing browser",
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-clone-run-cli-");
      const clone = join(root, "clone");
      await mkdir(clone);
      const base = initArguments(join(root, "run"), clone);
      const withFlag = (flag: string, value: string): string[] => {
        const argv = [...base];
        argv[argv.indexOf(flag) + 1] = value;
        return argv;
      };

      // An address is one origin; a path makes it something else.
      expectRefusal(
        await run(cli, withFlag("--original", "http://127.0.0.1:4000/app")),
      );
      // Every loopback name is one host, so these two addresses are one.
      expectRefusal(
        await run(cli, withFlag("--clone", "http://localhost:4000")),
      );
      expectRefusal(
        await run(cli, withFlag("--clone-name", "Quillbrook Reborn")),
      );
      expectRefusal(await run(cli, initArguments(join(clone, "run"), clone)));
      const withoutBrowser = base.slice(0, base.indexOf("--browser"));
      const missing = expectRefusal(await run(cli, withoutBrowser));
      expect(missing.message).toContain("--browser");
      expect(await readdir(root)).toEqual(["clone"]);
    },
  );
});

describe("rea evaluate-clone-run", () => {
  cliTest(
    "prints the gate and exits by verdict only with --exit-code",
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-clone-run-cli-");
      const directory = join(root, "run");
      const created = await run(
        cli,
        initArguments(directory, join(root, "clone")),
      );
      expect(created.exitCode, created.stdout + created.stderr).toBe(0);

      const plain = await run(cli, ["evaluate-clone-run", directory]);
      expect(plain.exitCode, plain.stdout + plain.stderr).toBe(0);
      const gate = cloneRunGateSchema.parse(plain.json);
      expect(gate.verdict).toBe("not_done");
      expect(gate.blocking.map(({ reason }) => reason)).toEqual([
        "clone_root_missing",
        "no_scenarios",
        "no_obligations",
      ]);
      // Every worklist command is the referee itself, spelled as init recorded it.
      expect(new Set(gate.next.map(({ command }) => command))).toEqual(
        new Set([`rea evaluate-clone-run '${directory}' --exit-code`]),
      );
      expect(
        JSON.parse(await readFile(join(directory, "gate.json"), "utf8")),
      ).toEqual(plain.json);

      const judged = await run(cli, [
        "evaluate-clone-run",
        directory,
        "--exit-code",
      ]);
      expect(judged.exitCode, judged.stdout + judged.stderr).toBe(1);
      expect(cloneRunGateSchema.parse(judged.json).verdict).toBe("not_done");

      // A gate file claiming a pass is an output: the referee overwrites it and never reads it.
      await writeFile(
        join(directory, "gate.json"),
        JSON.stringify({ ...gate, verdict: "done", blocking: [], next: [] }),
      );
      const forged = await run(cli, [
        "evaluate-clone-run",
        directory,
        "--exit-code",
      ]);
      expect(forged.exitCode, forged.stdout + forged.stderr).toBe(1);
      expect(
        JSON.parse(await readFile(join(directory, "gate.json"), "utf8")),
      ).toMatchObject({ verdict: "not_done" });
    },
  );

  cliTest(
    "refuses a folder that is not a run, with or without --exit-code",
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-clone-run-cli-");
      for (const flags of [[], ["--exit-code"]])
        expectRefusal(
          await run(cli, [
            "evaluate-clone-run",
            join(root, "absent"),
            ...flags,
          ]),
        );
    },
  );
});

describe("rea compare-scenario-behavior", () => {
  cliTest(
    "refuses a file that is not capture Evidence instead of judging it",
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-clone-run-cli-");
      const file = join(root, "not-evidence.json");
      await writeFile(file, JSON.stringify({ verdict: "unchanged" }));
      for (const flags of [[], ["--exit-code"]])
        expectRefusal(
          await run(cli, [
            "compare-scenario-behavior",
            "--left",
            file,
            "--right",
            file,
            ...flags,
          ]),
        );
    },
  );

  cliTest("needs a capture on each side", async ({ cli }) => {
    const result = await run(cli, [
      "compare-scenario-behavior",
      "--left",
      "left.json",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("right");
  });
});

describe("clone-run command help", () => {
  cliTest(
    "says what each command decides and how its exit status reads",
    async ({ cli }) => {
      const help = async (command: string): Promise<string> => {
        const result = await cli.run({ arguments: [command, "--help"] });
        expect(result.exitCode, result.stderr).toBe(0);
        return result.stdout;
      };
      const compare = await help("compare-scenario-behavior");
      for (const text of [
        "--left",
        "--right",
        "--differences",
        "--scenario",
        "0 unchanged, 1 changed, 2 unknown",
      ])
        expect(compare).toContain(text);
      const init = await help("init-clone-run");
      for (const text of [
        "--original-name",
        "--clone-root",
        "--authorization",
        "--browser-no-sandbox",
        "--original-reset",
        "--clone-health",
        "--rea-command",
        "scenarios/<id>.json",
      ])
        expect(init).toContain(text);
      const evaluate = await help("evaluate-clone-run");
      for (const text of [
        "0 done or done_with_waivers, 1 not_done, 2 stalled",
        "never starts, stops or resets a target",
        "evaluate, do next, evaluate",
      ])
        expect(evaluate).toContain(text);
    },
  );
});
