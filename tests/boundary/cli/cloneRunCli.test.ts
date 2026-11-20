import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import {
  LEFT,
  RIGHT,
  captureEvidence,
  create,
  list,
  note,
  type Step,
} from "../../../src/application/scenarioBehavior/scenarioBehaviorCapture.fixture.js";
import {
  cloneRunGateSchema,
  cloneRunInitResultSchema,
  cloneRunTargetSchema,
} from "../../../src/domain/cloneRun/cloneRunSchemas.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { scenarioBehaviorComparisonSchema } from "../../../src/domain/scenarioBehaviorComparison.js";
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

interface ArgumentRefusal {
  readonly code: string;
  readonly message: string;
  readonly fieldErrors?: readonly {
    readonly path: string;
    readonly missing: boolean;
  }[];
}

/**
 * Arguments the parser refused, before the command ran: exit 1, a code and
 * no verdict. The fields are named by option key (`originalName` for
 * `--original-name`).
 */
const expectArgumentRefusal = (
  result: Awaited<ReturnType<typeof run>>,
  code: "VALIDATION_ERROR" | "UNKNOWN",
): ArgumentRefusal => {
  expect(result.exitCode, result.stdout).toBe(1);
  expect(result.json).toMatchObject({ code, message: expect.any(String) });
  expect(result.json).not.toHaveProperty("verdict");
  return result.json as ArgumentRefusal;
};

const missingFields = (refusal: ArgumentRefusal): string[] =>
  (refusal.fieldErrors ?? [])
    .filter(({ missing }) => missing)
    .map(({ path }) => path);

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
      // Two scenario examples (request steps, page steps); any role writes an unknown.
      expect(result.authored.map(({ file, role }) => [file, role])).toEqual([
        ["scenarios/<scenario>.json", "prober"],
        ["scenarios/<scenario>.json", "prober"],
        ["obligations/<area>.json", "spec_writer"],
        ["unknowns/<role>-<n>.json", undefined],
        ["scout/<crawl>.json", "scout"],
      ]);
      const examples = await readdir(join(directory, "examples"));
      expect(result.authored.map(({ example }) => example).sort()).toEqual(
        examples.map((name) => `examples/${name}`).sort(),
      );
      for (const example of examples)
        expect(result.created).toContain(`examples/${example}`);

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
      expect(examples).toHaveLength(5);

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
      // Every spelling of this machine is one host, so with one port these are one address.
      for (const host of ["localhost", "localhost.", "[::ffff:127.0.0.1]"])
        expectRefusal(
          await run(cli, withFlag("--clone", `http://${host}:4000`)),
        );
      // An exclude is a path, never a pattern: one that matched nothing would hide nothing it was meant to.
      expectRefusal(await run(cli, [...base, "--exclude", "*.log"]));
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

  cliTest(
    "names every required flag that is missing or too short, and writes nothing",
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-clone-run-cli-");
      const directory = join(root, "run");
      const bare = expectArgumentRefusal(
        await run(cli, [
          "init-clone-run",
          directory,
          "--original",
          "http://127.0.0.1:4000",
        ]),
        "VALIDATION_ERROR",
      );
      expect(missingFields(bare)).toEqual([
        "clone",
        "cloneRoot",
        "cloneName",
        "originalName",
        "authorization",
      ]);
      const argv = initArguments(directory, join(root, "clone"));
      argv[argv.indexOf("Quillbrook")] = "Qb";
      const short = expectArgumentRefusal(
        await run(cli, argv),
        "VALIDATION_ERROR",
      );
      expect(short.fieldErrors).toMatchObject([
        { path: "originalName.0", missing: false, code: "too_small" },
      ]);
      expect(await readdir(root)).toEqual([]);
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
      // Init printed this worklist: the referee is its only producer.
      expect(cloneRunInitResultSchema.parse(created.json).next).toEqual(
        gate.next,
      );
      // What a pass does not cover is said with a pass, not on every round.
      expect(gate.residual_trust).toEqual([]);
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

  cliTest("never reads a misspelt --exit-code as a pass", async ({ cli }) => {
    const root = await createTestTempDirectory("rea-clone-run-cli-");
    const directory = join(root, "run");
    const created = await run(
      cli,
      initArguments(directory, join(root, "clone")),
    );
    expect(created.exitCode, created.stdout + created.stderr).toBe(0);
    const evaluate = (flag: string) =>
      run(cli, ["evaluate-clone-run", directory, flag]);

    // The parser's two spellings of the option both gate.
    for (const flag of ["--exit-code", "--exitCode"]) {
      const judged = await evaluate(flag);
      expect(judged.exitCode, flag).toBe(1);
      expect(cloneRunGateSchema.parse(judged.json).verdict).toBe("not_done");
    }
    // Any other spelling is refused: exit 1 and no verdict to misread.
    for (const flag of ["--exit_code", "--exitcode", "--exit"]) {
      const refusal = expectArgumentRefusal(await evaluate(flag), "UNKNOWN");
      expect(refusal.message).toContain(flag);
    }
    // Turning the option off is the documented exit 0 with the verdict printed.
    for (const flag of ["--no-exit-code", "--exit-code=false"]) {
      const printed = await evaluate(flag);
      expect(printed.exitCode, flag).toBe(0);
      expect(cloneRunGateSchema.parse(printed.json).verdict).toBe("not_done");
    }
  });

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
    for (const [given, lacking] of [
      ["--left", "right"],
      ["--right", "left"],
    ] as const) {
      const refusal = expectArgumentRefusal(
        await run(cli, ["compare-scenario-behavior", given, "capture.json"]),
        "VALIDATION_ERROR",
      );
      expect(missingFields(refusal)).toEqual([lacking]);
    }
  });

  cliTest(
    "exits by verdict with --exit-code and 0 without it",
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-clone-run-cli-");
      let files = 0;
      /** One capture file, as `capture-browser-scenario --evidence_output` saves it. */
      const saved = async (origin: string, steps: readonly Step[]) => {
        files += 1;
        const file = join(root, `capture-${String(files)}.json`);
        await writeFile(
          file,
          JSON.stringify(
            createEvidenceBundle([captureEvidence(origin, steps)]),
          ),
        );
        return file;
      };
      /** Two captures per side of the same scenario, with the reply each side gave to the create step. */
      const compare = async (
        left: Parameters<typeof create>[0],
        right: Parameters<typeof create>[0],
        flags: readonly string[],
      ) => {
        const argv = ["compare-scenario-behavior"];
        for (const [flag, origin, reply] of [
          ["--left", LEFT, left],
          ["--right", RIGHT, right],
        ] as const)
          for (let capture = 0; capture < 2; capture += 1)
            argv.push(flag, await saved(origin, [list, create(reply)]));
        const result = await run(cli, [...argv, ...flags]);
        return {
          exitCode: result.exitCode,
          verdict: scenarioBehaviorComparisonSchema.parse(result.json).verdict,
        };
      };
      const lost = { lost: "body-size-limit" } as const;

      expect(await compare(note(), note(), ["--exit-code"])).toEqual({
        exitCode: 0,
        verdict: "unchanged",
      });
      expect(await compare(note(), note("hello-wor"), ["--exit-code"])).toEqual(
        { exitCode: 1, verdict: "changed" },
      );
      // A reply no capture recorded is unknown, never a match.
      expect(await compare(lost, lost, ["--exit-code"])).toEqual({
        exitCode: 2,
        verdict: "unknown",
      });
      for (const [left, right, verdict] of [
        [note(), note("hello-wor"), "changed"],
        [lost, lost, "unknown"],
      ] as const)
        expect(await compare(left, right, [])).toEqual({
          exitCode: 0,
          verdict,
        });
    },
  );
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
      /** The flags whose help line says the command cannot run without them. */
      const required = (text: string): string[] =>
        [...text.matchAll(/^ {2}(--[a-z-]+)\b.*? {2}Required\. /gmu)].map(
          ([, flag]) => flag!,
        );
      const compare = await help("compare-scenario-behavior");
      for (const text of [
        "--left",
        "--right",
        "--differences",
        "--scenario",
        "0 unchanged, 1 changed, 2 unknown",
      ])
        expect(compare).toContain(text);
      expect(required(compare)).toEqual(["--left", "--right"]);
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
      expect(required(init)).toEqual([
        "--original",
        "--clone",
        "--clone-root",
        "--clone-name",
        "--original-name",
        "--authorization",
      ]);
      const evaluate = await help("evaluate-clone-run");
      expect(required(evaluate)).toEqual([]);
      for (const text of [
        "0 done or done_with_waivers, 1 not_done, 2 stalled",
        "never starts, stops or resets a target",
        "evaluate, do next, evaluate",
      ])
        expect(evaluate).toContain(text);
    },
  );
});
