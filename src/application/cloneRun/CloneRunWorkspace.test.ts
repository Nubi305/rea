import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { browserScenarioSchema } from "../../domain/browserScenario.js";
import {
  cloneRunInitResultSchema,
  cloneRunIntendedDifferencesSchema,
  cloneRunObligationsSchema,
  cloneRunScenarioSchema,
  cloneRunTargetSchema,
  cloneRunUnknownSchema,
  cloneRunWaiversSchema,
  type CloneRunTarget,
} from "../../domain/cloneRun/cloneRunSchemas.js";
import {
  CLONE_RUN_EXAMPLES,
  cloneRunCaptureCommand,
  initCloneRun,
  loadCloneRunWorkspace,
  renderCloneRunScenario,
  type CloneRunInitInput,
} from "./CloneRunWorkspace.js";

const spec = readFileSync(
  new URL(
    "../../../docs/specs/reconstruction/clone-runs/spec.md",
    import.meta.url,
  ),
  "utf8",
);

/** The JSON example the specification gives right after naming a file. */
const specExample = (heading: string): unknown => {
  const open =
    spec.indexOf("```json\n", spec.indexOf(heading)) + "```json\n".length;
  return JSON.parse(spec.slice(open, spec.indexOf("\n```", open)));
};

const input = (
  base: string,
  overrides: Partial<CloneRunInitInput> = {},
): CloneRunInitInput => ({
  runDirectory: join(base, "run"),
  originalAddress: "http://127.0.0.1:4631/",
  cloneAddress: "http://127.0.0.1:4632",
  cloneRoot: join(base, "clone"),
  cloneName: "Jotter",
  originalNames: ["Notelet", "Notelet Cloud"],
  authorization: "Our own sample application.",
  browserExecutable: "/opt/chromium/chrome",
  noSandbox: false,
  ...overrides,
});

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, "utf8"));

it("scaffolds the run folder from flags, with examples that are the specification's", async () => {
  const base = await createTestTempDirectory("clone-run-init-");
  const result = await initCloneRun(
    input(base, {
      statedBy: "R. Owner",
      cloneCommands: { reset: "curl -X POST http://127.0.0.1:4632/reset" },
      reaCommand: "node scripts/rea.mjs",
      maxRounds: 5,
    }),
    { now: () => new Date("2026-01-02T03:04:05.000Z") },
  );
  if (!result.ok) throw result.error;
  const run = join(base, "run");
  expect(
    cloneRunInitResultSchema.safeParse(result.value).error,
  ).toBeUndefined();
  expect(result.value.run).toBe(run);
  expect(result.value.created).toEqual([
    "target.json",
    "intended-differences.json",
    "waivers.json",
    "examples/scenario.example.json",
    "examples/obligations.example.json",
    "examples/unknown.example.json",
  ]);
  expect((await readdir(run)).toSorted()).toEqual([
    "evidence",
    "examples",
    "intended-differences.json",
    "obligations",
    "scenarios",
    "scout",
    "specs",
    "target.json",
    "unknowns",
    "waivers.json",
  ]);
  expect(await readdir(join(run, "evidence"))).toEqual(["clone", "original"]);
  expect(
    cloneRunTargetSchema.parse(await readJson(join(run, "target.json"))),
  ).toMatchObject({
    authorization: {
      stated_by: "R. Owner",
      recorded_at: "2026-01-02T03:04:05.000Z",
    },
    original: {
      address: "http://127.0.0.1:4631",
      material: ["scout"],
      commands: { reset: null },
    },
    clone: {
      root: join(base, "clone"),
      exclude: [".git", "node_modules"],
      commands: { reset: "curl -X POST http://127.0.0.1:4632/reset" },
    },
    rea_command: "node scripts/rea.mjs",
    limits: { min_captures: 2, max_rounds: 5, capture_timeout_seconds: 120 },
  });
  expect(
    cloneRunIntendedDifferencesSchema.parse(
      await readJson(join(run, "intended-differences.json")),
    ),
  ).toEqual({
    renames: [
      { from: "Notelet", to: "Jotter", reason: "product name" },
      { from: "Notelet Cloud", to: "Jotter", reason: "product name" },
    ],
    volatile_fields: [],
  });
  expect(
    cloneRunWaiversSchema.parse(await readJson(join(run, "waivers.json"))),
  ).toEqual({
    waivers: [],
    closed: [],
  });
  const examples = [
    [
      CLONE_RUN_EXAMPLES.scenario,
      cloneRunScenarioSchema,
      "`scenarios/notes-api.json`",
    ],
    [
      CLONE_RUN_EXAMPLES.obligations,
      cloneRunObligationsSchema,
      "`obligations/notes.json`",
    ],
    [
      CLONE_RUN_EXAMPLES.unknown,
      cloneRunUnknownSchema,
      "`unknowns/prober-1.json`",
    ],
  ] as const;
  for (const [example, schema, heading] of examples) {
    const written = await readJson(join(run, example.file));
    expect(schema.safeParse(written).error).toBeUndefined();
    expect(written).toEqual(specExample(heading));
  }
  expect(
    result.value.next.map(({ role, reason, command }) => [
      role,
      reason,
      command,
    ]),
  ).toEqual([
    [
      "prober",
      "no_scenarios",
      `node scripts/rea.mjs evaluate-clone-run '${run}' --exit-code`,
    ],
    [
      "spec_writer",
      "no_obligations",
      `node scripts/rea.mjs evaluate-clone-run '${run}' --exit-code`,
    ],
  ]);
});

it("refuses what could never pass or would overwrite, and writes nothing", async () => {
  const base = await createTestTempDirectory("clone-run-init-refused-");
  await mkdir(join(base, "clone"));
  await mkdir(join(base, "busy"));
  await writeFile(join(base, "busy", "notes.txt"), "mine");
  await symlink(join(base, "clone"), join(base, "link"));
  const refusals = [
    [{ runDirectory: join(base, "busy") }, "is not empty"],
    [{ runDirectory: join(base, "clone", "run") }, "is the clone root"],
    [
      { runDirectory: join(base, "link", "nested", "run") },
      "is the clone root",
    ],
    [{ runDirectory: join(base, "clone") }, "is the clone root"],
    [{ cloneAddress: "http://localhost:4631" }, "are one address"],
    [{ cloneName: "notelet next" }, 'contains the original\'s name "Notelet"'],
    [{ originalAddress: "http://127.0.0.1:4631/app" }, "original.address"],
    [{ originalNames: [] }, "original.names"],
    [{ authorization: "" }, "authorization.statement"],
  ] as const;
  for (const [overrides, message] of refusals) {
    const refused = await initCloneRun(input(base, overrides));
    expect(refused).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError", operation: "init-clone-run" },
    });
    expect(!refused.ok && refused.error.userMessage).toContain(message);
  }
  expect((await readdir(base)).toSorted()).toEqual(["busy", "clone", "link"]);
  expect(await readdir(join(base, "busy"))).toEqual(["notes.txt"]);
  expect(await readdir(join(base, "clone"))).toEqual([]);
  // An existing empty directory is accepted.
  await mkdir(join(base, "empty"));
  expect(
    (await initCloneRun(input(base, { runDirectory: join(base, "empty") }))).ok,
  ).toBe(true);
});

it("reads authored files by base name and lists Evidence in path order", async () => {
  const base = await createTestTempDirectory("clone-run-load-");
  const created = await initCloneRun(input(base));
  if (!created.ok) throw created.error;
  const { run } = created.value;
  await writeFile(
    join(run, "scenarios", "notes-api.json"),
    JSON.stringify(CLONE_RUN_EXAMPLES.scenario.document),
  );
  await writeFile(
    join(run, "obligations", "notes.json"),
    JSON.stringify(CLONE_RUN_EXAMPLES.obligations.document),
  );
  await writeFile(
    join(run, "obligations", "again.json"),
    JSON.stringify(CLONE_RUN_EXAMPLES.obligations.document),
  );
  await writeFile(
    join(run, "unknowns", "prober-1.json"),
    JSON.stringify(CLONE_RUN_EXAMPLES.unknown.document),
  );
  await writeFile(join(run, "scenarios", "notes.yaml"), "start_path: /");
  await writeFile(join(run, "scenarios", ".hidden.json"), "{");
  for (const name of ["run-2.json", "run-10.json", ".rea-write-x"])
    await mkdir(join(run, "evidence", "original", "notes-api"), {
      recursive: true,
    }).then(() =>
      writeFile(join(run, "evidence", "original", "notes-api", name), "{}"),
    );
  const loaded = await loadCloneRunWorkspace(join(base, ".", "run"));
  if (!loaded.ok) throw loaded.error;
  const workspace = loaded.value;
  expect(workspace.run).toBe(run);
  expect(workspace.target?.clone.name).toBe("Jotter");
  expect([...workspace.scenarios.keys()]).toEqual(["notes-api"]);
  expect([...workspace.obligations.keys()]).toEqual(["again", "notes"]);
  expect([...workspace.unknowns.keys()]).toEqual(["prober-1"]);
  expect(workspace.evidence.original.get("notes-api")).toEqual([
    join(run, "evidence", "original", "notes-api", "run-10.json"),
    join(run, "evidence", "original", "notes-api", "run-2.json"),
  ]);
  expect(workspace.evidence.clone.size).toBe(0);
  expect(workspace.issues).toEqual([
    {
      reason: "scenario_invalid",
      file: "scenarios/notes.yaml",
      pointer: "",
      message:
        "The file name is not <id>.json with an id of letters, digits, '.', '_' and '-' starting with a letter",
      fix: "Rename the file, or remove it if it does not belong here; examples/scenario.example.json is a valid example",
    },
    {
      reason: "obligation_invalid",
      file: "obligations/notes.json",
      pointer: "/obligations/0/id",
      message:
        "Obligation id notes-title-required is already used in obligations/again.json",
      fix: "Give each obligation its own id across all obligation files",
    },
  ]);
});

it("refuses a directory without target.json", async () => {
  const base = await createTestTempDirectory("clone-run-load-refused-");
  for (const directory of [base, join(base, "absent")]) {
    const refused = await loadCloneRunWorkspace(directory);
    expect(refused).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError", operation: "evaluate-clone-run" },
    });
  }
});

const target: CloneRunTarget = cloneRunTargetSchema.parse({
  schema: "rea.clone-run.target/1",
  authorization: {
    statement: "Ours.",
    stated_by: null,
    recorded_at: "2026-01-01T00:00:00Z",
  },
  original: {
    address: "http://127.0.0.1:4601",
    names: ["Notelet"],
    material: ["scout"],
    commands: { start: null, reset: null, stop: null, health: null },
  },
  clone: {
    address: "http://127.0.0.1:4600",
    name: "Jotter",
    root: "/work/clone",
    exclude: [],
    commands: { start: null, reset: null, stop: null, health: null },
  },
  browser: { executable_path: "/opt/pw-browsers/chromium", no_sandbox: true },
  rea_command: "rea",
  limits: { min_captures: 2, max_rounds: 8, capture_timeout_seconds: 90 },
});
const scenario = cloneRunScenarioSchema.parse({
  start_path: "/",
  actions: [
    {
      step_id: "fp-health",
      action: "request",
      method: "GET",
      path: "/api/health",
      timeout_ms: 15000,
    },
    {
      step_id: "create-empty-title",
      action: "request",
      method: "POST",
      path: "/api/notes",
      json: { title: "   " },
      timeout_ms: 15000,
    },
    {
      step_id: "open-home",
      action: "goto",
      destination: { url: "{origin}/?x=1#top" },
      wait_until: "load",
      timeout_ms: 15000,
    },
  ],
});
const tree = "dc9c5edb8b2d479e697b4b0b8ab874f32b325138598ce9e7b759eb8292110622";

it("renders both sides, binds the clone input to the tree, and digests as a real capture records", () => {
  const clone = renderCloneRunScenario("notes", scenario, target, {
    side: "clone",
    cloneTreeSha256: tree,
  });
  if (!clone.ok) throw new Error(JSON.stringify(clone.error));
  expect(clone.value.document).toEqual({
    browser: { mode: "launch", executable_path: "/opt/pw-browsers/chromium" },
    start_url: { url: "http://127.0.0.1:4600/" },
    actions: [
      scenario.actions[0],
      scenario.actions[1],
      {
        ...scenario.actions[2],
        destination: { url: "http://127.0.0.1:4600/?x=1#top" },
      },
      {
        step_id: `rea-tree-${tree}`,
        action: "wait_for_timeout",
        duration_ms: 1,
      },
    ],
    capture: {
      after_each_step: ["url", "accessibility"],
      at_end: ["url", "accessibility"],
      network: {
        request_body: true,
        response_body: true,
        header_values: false,
      },
    },
  });
  expect(browserScenarioSchema.safeParse(clone.value.document).success).toBe(
    true,
  );
  // `parameters.scenario_sha256` of a real capture of this exact input (contract stage, ev-bound-1.json).
  expect(clone.value.scenarioSha256).toBe(
    "e0293d06ef1e3beaf05afa07acdd84ce5c6a71a1ce21c0be2cc5ae2da1226983",
  );
  const other = renderCloneRunScenario("notes", scenario, target, {
    side: "clone",
    cloneTreeSha256: "0".repeat(64),
  });
  expect(other.ok && other.value.scenarioSha256).not.toBe(
    clone.value.scenarioSha256,
  );
  const original = renderCloneRunScenario("notes", scenario, target, {
    side: "original",
  });
  if (!original.ok) throw new Error(JSON.stringify(original.error));
  expect(original.value.document).toMatchObject({
    start_url: { url: "http://127.0.0.1:4601/" },
  });
  expect(JSON.stringify(original.value.document)).not.toContain("rea-tree-");
  expect(JSON.stringify(original.value.document)).not.toContain("4600");
  expect(
    renderCloneRunScenario("notes", scenario, target, { side: "original" }),
  ).toEqual(original);
});

it("replaces the placeholder only at the start of a goto URL and keeps every goto on the side's address", () => {
  const render = (actions: readonly object[]) =>
    renderCloneRunScenario(
      "notes",
      cloneRunScenarioSchema.parse({
        start_path: "/",
        actions: [scenario.actions[0], ...actions],
      }),
      target,
      { side: "original" },
    );
  const goto = (url: string) => ({
    step_id: "open",
    action: "goto",
    destination: { url },
    wait_until: "load",
  });
  for (const url of [
    "http://127.0.0.1:4600/notes",
    "https://elsewhere.example/notes",
    "{origin}@elsewhere.example/notes",
    "http://elsewhere.example/?next={origin}/notes",
  ]) {
    const refused = render([goto(url)]);
    expect(
      refused.ok
        ? []
        : refused.error.map(({ file, pointer }) => [file, pointer]),
    ).toEqual([["scenarios/notes.json", "/actions/1/destination/url"]]);
  }
  const kept = render([
    {
      step_id: "send",
      action: "request",
      method: "POST",
      path: "/api/notes",
      json: { link: "{origin}/x" },
    },
    goto("{origin}/notes?from={origin}"),
  ]);
  expect(kept.ok && kept.value.document).toMatchObject({
    actions: [
      {},
      { json: { link: "{origin}/x" } },
      { destination: { url: "http://127.0.0.1:4601/notes?from={origin}" } },
    ],
  });
  // An action the capture command would refuse is reported against the scenario file.
  const invalid = render([{ step_id: "wait", action: "wait_for_timeout" }]);
  expect(
    invalid.ok ? [] : invalid.error.map(({ file, pointer }) => [file, pointer]),
  ).toEqual([["scenarios/notes.json", "/actions/1/duration_ms"]]);
});

it("spells the exact capture command", () => {
  expect(
    cloneRunCaptureCommand("/runs/it's", target, "clone", "notes", 3),
  ).toBe(
    `REA_BROWSER_NO_SANDBOX=true timeout 90 rea capture-browser-scenario '/runs/it'"'"'s/rendered/clone/notes.json' --detail summary --evidence_output '/runs/it'"'"'s/evidence/clone/notes/run-3.json' --json`,
  );
  expect(
    cloneRunCaptureCommand(
      "/runs/a",
      {
        ...target,
        browser: { ...target.browser, no_sandbox: false },
        rea_command: "node scripts/rea.mjs",
      },
      "original",
      "notes",
      1,
    ),
  ).toBe(
    "timeout 90 node scripts/rea.mjs capture-browser-scenario '/runs/a/rendered/original/notes.json' --detail summary --evidence_output '/runs/a/evidence/original/notes/run-1.json' --json",
  );
});
