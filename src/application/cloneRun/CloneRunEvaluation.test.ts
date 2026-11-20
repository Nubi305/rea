import { readFileSync } from "node:fs";
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import { browserScenarioSchema } from "../../domain/browserScenario.js";
import { digestCanonicalValue } from "../../domain/canonicalDigest.js";
import {
  CLONE_RUN_REASON_CODES,
  cloneRunAdmissionRecordSchema,
  cloneRunExitCode,
  cloneRunGateSchema,
  cloneRunJournalEntrySchema,
  type CloneRunGate,
  type CloneRunNextItem,
  type CloneRunReasonCode,
  type CloneRunSide,
} from "../../domain/cloneRun/cloneRunSchemas.js";
import { err, ok } from "../../domain/result.js";
import {
  SCENARIO_OMITTED_REQUESTS,
  scenarioBehaviorVerdict,
  scenarioStepKind,
  type ScenarioBehaviorCaptureFacts,
  type ScenarioBehaviorComparer,
  type ScenarioBehaviorFinding,
  type ScenarioStepStatus,
} from "../../domain/scenarioBehaviorComparison.js";
import { sha256Hex } from "../../kernel/sha256Hex.js";
import {
  CLONE_RUN_RESIDUAL_TRUST,
  evaluateCloneRun,
} from "./CloneRunEvaluation.js";
import type { CloneRunHostResolver } from "./CloneRunAddressResolution.js";
import { digestCloneTree } from "./CloneRunTreeDigest.js";
import { initCloneRun } from "./CloneRunWorkspace.js";

/**
 * The fake comparer stands in for the real one at its contract: an Evidence
 * file is a JSON document of capture facts plus one observed value per step.
 * `missing` is a value no capture recorded.
 */
interface FakeCapture extends ScenarioBehaviorCaptureFacts {
  readonly observed: Readonly<Record<string, string>>;
  /** A step's status and finding given outright, for categories the value rule above does not produce. */
  readonly scripted?: Readonly<
    Record<
      string,
      {
        readonly status: ScenarioStepStatus;
        readonly finding: Partial<ScenarioBehaviorFinding>;
      }
    >
  >;
}

const MISSING = "missing";

const refusedRead = (message: string) =>
  err(
    new AnalysisInputError("compare-scenario-behavior", {
      userMessage: message,
    }),
  );

const fakeComparer = (
  refuseCompare = false,
): ScenarioBehaviorComparer<FakeCapture> => ({
  readCapture: (file) => {
    try {
      const value = JSON.parse(readFileSync(file, "utf8")) as FakeCapture & {
        readonly authentic?: boolean;
      };
      return Promise.resolve(
        value.authentic === false
          ? refusedRead("Evidence bundle validation failed")
          : ok({ ...value, file }),
      );
    } catch {
      return Promise.resolve(refusedRead("The file is not Evidence JSON"));
    }
  },
  compare: ({ left, right, renames, volatile_fields: volatile }) => {
    if (refuseCompare)
      return refusedRead("The captures of one side list different steps");
    const renamed = new Map<string, number>();
    const rename = (value: string): string =>
      renames.reduce((text, { from, to }, index) => {
        if (!text.includes(from)) return text;
        renamed.set(String(index), (renamed.get(String(index)) ?? 0) + 1);
        return text.replaceAll(from, to);
      }, value);
    const values = (
      captures: readonly FakeCapture[],
      stepId: string,
    ): readonly string[] =>
      captures
        .map((capture) => capture.observed[stepId] ?? "same")
        .filter((value) => value !== MISSING);
    const honoured: { step_id: string; pointer: string }[] = [];
    const steps = (left[0]?.steps ?? [])
      .filter(({ step_id: id }) => scenarioStepKind(id) !== "reserved")
      .map(({ step_id: id }) => {
        const finding = (
          category: string,
          side: "left" | "right" | null,
          expected: string | null,
          actual: string | null,
        ): ScenarioBehaviorFinding => ({
          dimension: "body",
          category,
          request: "POST /api/notes#1",
          pointer: "/slug",
          expected,
          actual,
          side,
        });
        const originals = values(left, id);
        const clones = values(right, id);
        const declared = volatile.find(
          (field) => field.step_id === id || field.step_id === "*",
        );
        let status: ScenarioStepStatus = "unchanged";
        let findings: ScenarioBehaviorFinding[] = [];
        const scripted = [...left, ...right].find(
          (capture) => capture.scripted?.[id] !== undefined,
        )?.scripted?.[id];
        if (scripted !== undefined) {
          status = scripted.status;
          findings = [
            { ...finding("value", null, null, null), ...scripted.finding },
          ];
        } else if (originals.length === 0 || clones.length === 0) {
          status = "unknown";
          findings = [
            finding(
              "not-recorded",
              originals.length === 0 ? "left" : "right",
              null,
              null,
            ),
          ];
        } else if (new Set(originals).size > 1) {
          if (declared === undefined) {
            status = "unstable";
            findings = [finding("repeats-differ", "left", null, null)];
          } else honoured.push(declared);
        } else if (new Set(clones).size > 1) {
          status = "unstable";
          findings = [
            finding("repeats-differ", "right", originals[0] ?? null, null),
          ];
        } else if (rename(originals[0] ?? "") !== clones[0]) {
          status = "changed";
          findings = [
            finding("value", null, originals[0] ?? null, clones[0] ?? null),
          ];
        }
        return { step_id: id, kind: scenarioStepKind(id), status, findings };
      });
    const side = (captures: readonly FakeCapture[]) => ({
      origin: captures[0]?.start_origin ?? "http://unknown.invalid",
      captures: captures.map((capture) => ({
        file: capture.file,
        evidence_id: capture.evidence_id,
        scenario_sha256: capture.scenario_sha256,
        fingerprint_sha256: capture.fingerprint_sha256,
      })),
      start_state: "clean" as const,
      ignored_transactions: 0,
    });
    const count = (status: ScenarioStepStatus): number =>
      steps.filter((step) => step.status === status).length;
    return ok({
      comparison: "scenario-behavior",
      verdict: scenarioBehaviorVerdict(steps.map(({ status }) => status)),
      left: side(left),
      right: side(right),
      summary: {
        steps: steps.length,
        unchanged: count("unchanged"),
        changed: count("changed"),
        unknown: count("unknown"),
        unstable: count("unstable"),
      },
      steps,
      volatile_fields: honoured.map(({ step_id: id, pointer }) => ({
        step_id: id,
        side: "left" as const,
        pointer,
        declared: true,
        honoured: true,
      })),
      renames_applied: renames.flatMap((entry, index) => {
        const count = renamed.get(String(index));
        return count === undefined ? [] : [{ ...entry, values: count }];
      }),
      limitations: [],
    });
  },
  describe: (captures) => ({
    table: "scenario-behavior",
    captures: captures.length,
    steps: [],
  }),
});

const ORIGINAL = "http://127.0.0.1:4631";
const CLONE = "http://127.0.0.1:4632";
const FINGERPRINT = "f".repeat(64);

/** Every reason code a test in this file saw block; the last test requires all of them. */
const seenReasons = new Set<CloneRunReasonCode>();
let clock = Date.UTC(2026, 0, 1);

/** A resolver that knows one name of this machine; every other name does not resolve. */
const hostResolver: CloneRunHostResolver = {
  lookup: (host) =>
    host === "vm"
      ? Promise.resolve(["127.0.0.1"])
      : Promise.reject(new Error(`getaddrinfo ENOTFOUND ${host}`)),
  interfaceAddresses: () => [],
};

const evaluate = async (
  run: string,
  comparer = fakeComparer(),
): Promise<CloneRunGate> => {
  const result = await evaluateCloneRun(run, {
    comparer,
    digestTree: digestCloneTree,
    now: () => new Date((clock += 1000)),
    hostResolver,
  });
  if (!result.ok) throw result.error;
  for (const { reason } of result.value.blocking) seenReasons.add(reason);
  // The printed gate and the file are the same document, and both fit the schema.
  expect(cloneRunGateSchema.safeParse(result.value).error).toBeUndefined();
  expect(JSON.parse(await readFile(join(run, "gate.json"), "utf8"))).toEqual(
    result.value,
  );
  return result.value;
};

const reasons = (gate: CloneRunGate): readonly CloneRunReasonCode[] =>
  gate.blocking.map(({ reason }) => reason);

const item = (
  gate: CloneRunGate,
  reason: CloneRunReasonCode,
): CloneRunNextItem => {
  const found = gate.next.find((entry) => entry.reason === reason);
  if (found === undefined)
    throw new Error(`No ${reason} item in ${JSON.stringify(gate.next)}`);
  return found;
};

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

const editJson = async (
  path: string,
  edit: (value: Record<string, unknown>) => void,
): Promise<void> => {
  const value = JSON.parse(await readFile(path, "utf8")) as Record<
    string,
    unknown
  >;
  edit(value);
  await writeJson(path, value);
};

const SCENARIO = {
  start_path: "/",
  actions: [
    {
      step_id: "fp-list",
      action: "request",
      method: "GET",
      path: "/api/notes",
      timeout_ms: 15000,
    },
    {
      step_id: "setup-seed",
      action: "request",
      method: "POST",
      path: "/api/seed",
      json: {},
      timeout_ms: 15000,
    },
    {
      step_id: "create",
      action: "request",
      method: "POST",
      path: "/api/notes",
      json: { title: "A" },
      timeout_ms: 15000,
    },
    {
      step_id: "open",
      action: "goto",
      destination: { url: "{origin}/notes" },
      wait_until: "load",
      timeout_ms: 15000,
    },
  ],
};

const OBLIGATIONS = {
  obligations: [
    {
      id: "notes-create",
      statement:
        "Creating a note answers 201 with its slug, and the list page shows it.",
      basis: "observed",
      cases: [{ scenario: "notes", step_ids: ["create", "open"] }],
    },
  ],
};

interface Run {
  readonly run: string;
  readonly cloneRoot: string;
  readonly base: string;
}

/** A run folder with one scenario, one obligation file and a clone of one source file. */
const scaffold = async (): Promise<Run> => {
  const base = await createTestTempDirectory("clone-run-referee-");
  const run = join(base, "run");
  const cloneRoot = join(base, "clone");
  await mkdir(cloneRoot);
  await writeFile(
    join(cloneRoot, "server.mjs"),
    "// Jotter: a small notes service, written anew from the recorded behaviour.\nexport const port = 4632;\n",
  );
  const created = await initCloneRun({
    runDirectory: run,
    originalAddress: ORIGINAL,
    cloneAddress: CLONE,
    cloneRoot,
    cloneName: "Jotter",
    originalNames: ["Notelet"],
    authorization: "Our own sample application, written for this test.",
    statedBy: "Test Owner",
    browserExecutable: "/opt/chromium/chrome",
    noSandbox: true,
    originalCommands: { reset: "curl -X POST http://127.0.0.1:4631/reset" },
  });
  if (!created.ok) throw created.error;
  await writeJson(join(run, "scenarios", "notes.json"), SCENARIO);
  await writeJson(join(run, "obligations", "notes.json"), OBLIGATIONS);
  return { run, cloneRoot, base };
};

/**
 * What a capture does: run the rendered input and record what REA ran. The
 * digest and the step ids come from the rendered document, as in real Evidence.
 */
const capture = async (
  run: string,
  side: CloneRunSide,
  name: string,
  overrides: Partial<FakeCapture> & { readonly authentic?: boolean } = {},
  scenario = "notes",
): Promise<string> => {
  const rendered = browserScenarioSchema.parse(
    JSON.parse(
      await readFile(join(run, "rendered", side, `${scenario}.json`), "utf8"),
    ),
  );
  const stepIds = rendered.actions.map(({ step_id: id }) => id);
  const file = join(run, "evidence", side, scenario, `${name}.json`);
  await writeJson(file, {
    evidence_id: `ev_${sha256Hex(`${side}/${scenario}/${name}/${clock}`)}`,
    start_origin: new URL(rendered.start_url.url).origin,
    scenario_sha256: digestCanonicalValue(rendered, "Browser scenario"),
    definition: { start_url: rendered.start_url.url, step_ids: stepIds },
    steps: ["scenario_start", ...stepIds].map((id) => ({
      step_id: id,
      outcome: "completed",
    })),
    fingerprint_sha256: FINGERPRINT,
    reply_bodies: [],
    observed: {},
    ...overrides,
  });
  return file;
};

/** Evaluate (which renders), then capture each side twice. */
const captureBoth = async (
  { run }: Run,
  clone: Partial<FakeCapture> = {},
): Promise<void> => {
  await evaluate(run);
  for (const name of ["run-1", "run-2"]) {
    await capture(run, "original", name);
    await capture(run, "clone", name, clone);
  }
};

it("issues done only from Evidence it admitted and recomputes every output it wrote", async () => {
  const folder = await scaffold();
  const { run } = folder;
  const first = await evaluate(run);
  expect(first.verdict).toBe("not_done");
  expect(first.blocking).toEqual([{ reason: "evidence_missing", count: 4 }]);
  // The fixed text of the limits is printed with a pass, not on every round of the loop.
  expect(first.residual_trust).toEqual([]);
  expect(first.stall).toMatchObject({ judged: false, round: 0, attempts: 0 });
  expect(first.stall.outlook).toContain("Not judged");
  expect(first.checks).toMatchObject({
    scope: "pass",
    inputs: "pass",
    evidence: "fail",
    parity: "not_evaluated",
  });

  // An agent writes the verdict and the reports it would like to see.
  await writeJson(join(run, "gate.json"), {
    ...first,
    verdict: "done",
    summary: "done",
    blocking: [],
    next: [],
  });
  await writeJson(join(run, "parity", "notes.json"), {
    comparison: "scenario-behavior",
    verdict: "unchanged",
  });
  await writeJson(join(run, "records", "clone", "notes.json"), {
    files: [{ file: "evidence/clone/notes/run-1.json", status: "admitted" }],
  });
  await writeFile(join(run, "rendered", "clone", "notes.json"), "{}");
  await rm(join(run, "behavior"), { recursive: true, force: true });
  await symlink(folder.base, join(run, "behavior"));
  const forged = await evaluate(run);
  expect(forged.verdict).toBe("not_done");
  expect(forged.blocking).toEqual(first.blocking);
  expect(await readdir(join(run, "parity"))).toEqual([]);
  expect(await readdir(join(run, "behavior"))).toEqual([]);
  expect(await readdir(folder.base)).toEqual(["clone", "run"]);
  expect(
    cloneRunAdmissionRecordSchema.parse(
      JSON.parse(
        await readFile(join(run, "records", "clone", "notes.json"), "utf8"),
      ),
    ).files,
  ).toEqual([]);

  for (const name of ["run-1", "run-2"]) {
    await capture(run, "original", name);
    await capture(run, "clone", name);
  }
  const done = await evaluate(run);
  expect(done).toMatchObject({
    verdict: "done",
    summary: "done",
    waivers: 0,
    blocking: [],
    next: [],
    target: { original_address: ORIGINAL, clone_address: CLONE },
    counts: {
      scenarios: 1,
      obligations: 1,
      cited_steps: 2,
      steps: { unchanged: 5, changed: 0, unknown: 0, unstable: 0 },
      evidence: { admitted: 4, rejected: 0 },
    },
    residual_trust: CLONE_RUN_RESIDUAL_TRUST,
  });
  expect(Object.values(done.checks)).toEqual(Array(8).fill("pass"));
  expect(cloneRunExitCode(done.verdict)).toBe(0);
  expect(await readdir(join(run, "behavior"))).toEqual(["notes.json"]);

  // Deleting every output, or filling the journal, changes nothing either.
  for (const output of [
    "gate.json",
    "parity",
    "records",
    "rendered",
    "behavior",
  ])
    await rm(join(run, output), { recursive: true, force: true });
  await appendFile(
    join(run, "journal.jsonl"),
    `not json\n${JSON.stringify({ schema: "rea.clone-run.journal/1" })}\n`,
  );
  expect((await evaluate(run)).verdict).toBe("done");
});

it("rejects Evidence that is not authentic, from the other side, or of another scenario", async () => {
  const folder = await scaffold();
  const { run } = folder;
  await captureBoth(folder);
  const edited = await capture(run, "clone", "run-3", { authentic: false });
  const originalCapture = join(
    run,
    "evidence",
    "original",
    "notes",
    "run-1.json",
  );
  const misfiled = join(run, "evidence", "clone", "notes", "run-4.json");
  await copyFile(originalCapture, misfiled);
  const gate = await evaluate(run);
  expect(gate.verdict).toBe("not_done");
  expect(gate.blocking).toEqual([
    { reason: "evidence_rejected_integrity", count: 1 },
    { reason: "evidence_rejected_address", count: 1 },
  ]);
  expect(item(gate, "evidence_rejected_integrity")).toMatchObject({
    role: "verifier",
    side: "clone",
    file: "evidence/clone/notes/run-3.json",
    command: `rm '${edited}'`,
  });
  expect(item(gate, "evidence_rejected_address")).toMatchObject({
    role: "verifier",
    file: "evidence/clone/notes/run-4.json",
    command: `rm '${misfiled}'`,
  });
  expect(item(gate, "evidence_rejected_address").message).toContain(
    `Captured at ${ORIGINAL}`,
  );
  await rm(edited);
  await rm(misfiled);
  expect((await evaluate(run)).verdict).toBe("done");

  // A copy of a capture is not a repeat, and a capture of an edited scenario is not counted.
  await rm(join(run, "evidence", "original", "notes", "run-2.json"));
  await copyFile(
    originalCapture,
    join(run, "evidence", "original", "notes", "run-2.json"),
  );
  const copied = await evaluate(run);
  expect(copied.blocking).toEqual([{ reason: "evidence_missing", count: 1 }]);
  expect(copied.counts.evidence).toMatchObject({ admitted: 3, duplicate: 1 });
  expect(item(copied, "evidence_missing").command).toContain("run-3.json");

  await editJson(join(run, "scenarios", "notes.json"), (scenario) => {
    const third = (scenario.actions as { path?: string }[])[2];
    if (third !== undefined) third.path = "/api/notes/v2";
  });
  const changedScenario = await evaluate(run);
  expect(changedScenario.blocking).toEqual([
    { reason: "evidence_scenario_mismatch", count: 4 },
  ]);
  expect(changedScenario.counts.evidence).toMatchObject({
    admitted: 0,
    scenario_mismatch: 4,
  });
  const next = item(changedScenario, "evidence_scenario_mismatch");
  expect(next).toMatchObject({ role: "prober", side: "original" });
  expect(next.command).toBe(
    `REA_BROWSER_NO_SANDBOX=true timeout 120 rea capture-browser-scenario '${run}/rendered/original/notes.json' --detail summary --evidence_output '${run}/evidence/original/notes/run-3.json' --json`,
  );
  expect(next.message).toContain("curl -X POST http://127.0.0.1:4631/reset");
});

it("makes clone Evidence stale when any clone file changes, also before the first evaluation that sees it", async () => {
  const folder = await scaffold();
  const { run, cloneRoot } = folder;
  await captureBoth(folder);
  expect((await evaluate(run)).verdict).toBe("done");
  await appendFile(join(cloneRoot, "server.mjs"), "// one more line\n");
  const stale = await evaluate(run);
  expect(stale.verdict).toBe("not_done");
  expect(stale.blocking).toEqual([{ reason: "evidence_stale", count: 2 }]);
  expect(stale.counts.evidence).toMatchObject({ admitted: 2, stale: 2 });
  const staleItem = item(stale, "evidence_stale");
  expect(staleItem).toMatchObject({ role: "verifier", side: "clone" });
  expect(staleItem.command).toContain("/evidence/clone/notes/run-3.json'");
  expect(staleItem.message).toContain("clone.exclude");
  expect(
    stale.next.filter(({ reason }) => reason === "evidence_stale")[1]?.command,
  ).toContain("/evidence/clone/notes/run-4.json'");

  // Captured from the input rendered above, then a helper file is added before anyone evaluates.
  await capture(run, "clone", "run-3");
  await capture(run, "clone", "run-4");
  await writeFile(join(cloneRoot, "helper.mjs"), "export const helper = 1;\n");
  const early = await evaluate(run);
  expect(early.blocking).toEqual([{ reason: "evidence_stale", count: 2 }]);
  expect(early.counts.evidence.stale).toBe(4);

  // A path the lead excludes is neither digested nor checked.
  await mkdir(join(cloneRoot, "data"));
  await editJson(join(run, "target.json"), (target) => {
    (target.clone as { exclude: string[] }).exclude = ["data"];
  });
  await evaluate(run);
  await capture(run, "clone", "run-5");
  await capture(run, "clone", "run-6");
  await writeFile(join(cloneRoot, "data", "notes.db"), "Notelet rows");
  const excluded = await evaluate(run);
  expect(excluded.verdict).toBe("done");
  expect(excluded.clone_tree?.exclude).toEqual(["data"]);
});

it("blocks on a changed, unknown or unstable step and says who does what", async () => {
  const folder = await scaffold();
  const { run, cloneRoot } = folder;
  await captureBoth(folder, { observed: { create: "hello_world" } });
  await editJson(
    join(run, "evidence", "original", "notes", "run-1.json"),
    (file) => {
      (file as { observed: object }).observed = { create: "hello-world" };
    },
  );
  await editJson(
    join(run, "evidence", "original", "notes", "run-2.json"),
    (file) => {
      (file as { observed: object }).observed = { create: "hello-world" };
    },
  );
  const mutant = await evaluate(run);
  expect(mutant.verdict).toBe("not_done");
  expect(mutant.blocking).toEqual([{ reason: "parity_changed", count: 1 }]);
  expect(item(mutant, "parity_changed")).toMatchObject({
    role: "builder",
    file: cloneRoot,
    scenario: "notes",
    step_id: "create",
    dimension: "body",
    pointer: "/slug",
    expected: "hello-world",
    actual: "hello_world",
    command: `rea evaluate-clone-run '${run}' --exit-code`,
  });
  expect(
    JSON.parse(await readFile(join(run, "parity", "notes.json"), "utf8")),
  ).toMatchObject({ verdict: "changed" });

  // A difference blocks on a setup step too, so renaming a failing step hides nothing.
  const observedBy = async (
    side: CloneRunSide,
    values: readonly Record<string, string>[],
  ): Promise<void> => {
    for (const [index, observed] of values.entries())
      await editJson(
        join(run, "evidence", side, "notes", `run-${index + 1}.json`),
        (file) => {
          (file as { observed: object }).observed = observed;
        },
      );
  };
  await observedBy("original", [{}, {}]);
  await observedBy("clone", [
    { "setup-seed": "other" },
    { "setup-seed": "other" },
  ]);
  expect((await evaluate(run)).blocking).toEqual([
    { reason: "parity_changed", count: 1 },
  ]);

  // Missing or unsteady data blocks on a behaviour step and is only counted on a setup step.
  await observedBy("original", [
    { create: MISSING, open: "a", "setup-seed": "x" },
    { create: MISSING, open: "b", "setup-seed": "y" },
  ]);
  await observedBy("clone", [{ "fp-list": MISSING }, { "fp-list": MISSING }]);
  const unknown = await evaluate(run);
  expect(unknown.blocking).toEqual([
    { reason: "parity_unknown", count: 1 },
    { reason: "parity_unstable", count: 1 },
  ]);
  expect(unknown.counts.ungated_steps).toBe(2);
  expect(unknown.checks.parity).toBe("fail");
  const lost = item(unknown, "parity_unknown");
  expect(lost).toMatchObject({
    role: "prober",
    side: "original",
    step_id: "create",
  });
  expect(lost.command).toContain("/evidence/original/notes/run-3.json' --json");
  expect(lost.message).toContain("64 KiB");
  const unsteady = item(unknown, "parity_unstable");
  expect(unsteady).toMatchObject({
    role: "lead",
    step_id: "open",
    file: "intended-differences.json",
  });
  expect(unsteady.message).toContain(
    '{"scenario":"notes","step_id":"open","pointer":"/slug","reason":"<why it varies>"}',
  );

  expect(unsteady.message).toContain("one capture at a time per side");
  expect(unsteady.message).not.toContain("Otherwise");

  // The declared leaf is honoured and listed, here through the every-step wildcard.
  await editJson(join(run, "intended-differences.json"), (file) => {
    (file.volatile_fields as object[]).push({
      scenario: "notes",
      step_id: "*",
      pointer: "/slug",
      reason: "creation time",
    });
  });
  await observedBy("original", [
    { open: "a", create: "Notelet" },
    { open: "b", create: "Notelet" },
  ]);
  await observedBy("clone", [
    { create: "Jotter" },
    { create: "Jotter", "fp-list": "odd" },
  ]);
  const declared = await evaluate(run);
  expect(declared.verdict).toBe("done");
  expect(declared.declared).toEqual({
    renames: [{ from: "Notelet", to: "Jotter", values: 1 }],
    volatile_fields: 1,
  });
  await observedBy("clone", [
    { create: "Jotter" },
    { create: "Jotter", open: "odd" },
  ]);
  await editJson(join(run, "intended-differences.json"), (file) => {
    (file.volatile_fields as object[]).length = 0;
  });
  await observedBy("original", [{ create: "Notelet" }, { create: "Notelet" }]);
  // The clone disagreeing with itself is first a matter of its captures: nobody is told to change it.
  const flaky = item(await evaluate(run), "parity_unstable");
  expect(flaky).toMatchObject({
    role: "verifier",
    side: "clone",
    file: "evidence/clone/notes",
    command: `rm '${join(run, "evidence", "clone", "notes", "run-1.json")}' '${join(run, "evidence", "clone", "notes", "run-2.json")}'`,
  });
  expect(flaky.message).toContain("Nothing says yet that the clone is wrong");
  expect(flaky.message).toContain("one capture at a time per side");
  expect(flaky.message).not.toContain("Change the clone");
  expect(cloneRoot).not.toBe(flaky.file);
});

/** Fresh captures of both sides, the clone's first carrying scripted findings, then one evaluation. */
const evaluateScripted = async (
  run: string,
  scripted: FakeCapture["scripted"],
  original: Partial<FakeCapture> = {},
): Promise<CloneRunGate> => {
  for (const name of ["run-1", "run-2"]) {
    await rm(join(run, "evidence", "original", "notes", `${name}.json`), {
      force: true,
    });
    await rm(join(run, "evidence", "clone", "notes", `${name}.json`), {
      force: true,
    });
    await capture(run, "original", name, original);
    await capture(run, "clone", name, { scripted: scripted ?? {} });
  }
  return evaluate(run);
};

const TEXT = { dimension: "text" as const, request: null, pointer: null };

it("addresses each kind of finding to the role that can act on it, with the true cause", async () => {
  const folder = await scaffold();
  const { run } = folder;
  await evaluate(run);
  const script = (
    scripted: FakeCapture["scripted"],
    original: Partial<FakeCapture> = {},
  ): Promise<CloneRunGate> => evaluateScripted(run, scripted, original);
  const text = TEXT;

  // A difference a rename would settle goes to the lead with the line to add, never "change the clone".
  const renamed = item(
    await script({
      create: {
        status: "changed",
        finding: {
          ...text,
          expected: '"heading: NOTELET IS FAST, at http://127.0.0.1:4631/help"',
          actual: '"heading: JOTTER IS FAST, at http://127.0.0.1:4632/help"',
        },
      },
    }),
    "parity_changed",
  );
  expect(renamed).toMatchObject({
    role: "lead",
    file: "intended-differences.json",
  });
  expect(renamed.message).toContain(
    '{"from":"NOTELET","to":"JOTTER","reason":"<why the clone differs>"}',
  );
  expect(renamed.message).toContain(
    '{"from":"http://127.0.0.1:4631","to":"http://127.0.0.1:4632","reason":"<why the clone differs>"}',
  );
  expect(renamed.message).not.toContain("Change the clone");

  // A difference with no recorded values is named by its kind, never "(nothing)" twice.
  const reordered = item(
    await script({
      create: {
        status: "changed",
        finding: {
          category: "order",
          pointer: "",
          expected: null,
          actual: null,
        },
      },
    }),
    "parity_changed",
  );
  expect(reordered.role).toBe("builder");
  expect(reordered.message).toContain(
    "the items are the same and come in another order",
  );
  expect(reordered.message).not.toContain("(nothing)");
  const extra = item(
    await script({
      create: {
        status: "changed",
        finding: {
          dimension: "request",
          pointer: null,
          expected: null,
          actual: "GET /api/extra#1",
        },
      },
    }),
    "parity_changed",
  );
  expect(extra.message).toContain(
    "the clone gave GET /api/extra#1 and the original has nothing there",
  );

  // One observation of a recorded value: one more capture of that side, not "not recorded".
  const single = item(
    await script({
      create: {
        status: "unknown",
        finding: { category: "single-observation", side: "left" },
      },
    }),
    "parity_unknown",
  );
  expect(single).toMatchObject({ role: "prober", side: "original" });
  expect(single.command).toContain(
    "/evidence/original/notes/run-3.json' --json",
  );
  expect(single.message).toContain("only one capture of the original recorded");

  // A declared leaf the original did not show to vary: capture the original again, the clone is not blamed.
  const notShown = item(
    await script({
      create: {
        status: "unknown",
        finding: {
          category: "declared-not-shown",
          side: null,
          expected: '"2026-11-20"',
          actual: '"2026-11-21"',
        },
      },
    }),
    "parity_unknown",
  );
  expect(notShown).toMatchObject({ role: "prober", side: "original" });
  expect(notShown.command).toContain("rendered/original/notes.json");
  expect(notShown.message).toContain("is declared volatile");
  expect(notShown.message).toContain("capture the original again now");
  expect(notShown.message).not.toContain("Change the clone");
});

it("gives the comparer's request findings a remedy that can work", async () => {
  const { run } = await scaffold();
  await evaluate(run);
  const request = { dimension: "request" as const, pointer: null };

  // Requests the capture itself omitted: another capture omits the same, so no capture command is given.
  const omitted = item(
    await evaluateScripted(run, {
      create: {
        status: "unknown",
        finding: {
          ...request,
          category: "not-recorded",
          request: SCENARIO_OMITTED_REQUESTS,
          side: "right",
          actual:
            "3 request events omitted by the capture (max-network-transactions)",
        },
      },
    }),
    "parity_unknown",
  );
  expect(omitted).toMatchObject({
    role: "prober",
    side: "clone",
    file: "scenarios/notes.json",
  });
  expect(omitted.command).toContain("evaluate-clone-run");
  expect(omitted.message).toContain(
    "3 request events omitted by the capture (max-network-transactions)",
  );
  expect(omitted.message).toContain("into shorter scenarios");

  // A request body no capture recorded: only a reply body is supplied by another capture.
  const unsent = item(
    await evaluateScripted(run, {
      create: {
        status: "unknown",
        finding: { ...request, category: "not-recorded", side: "left" },
      },
    }),
    "parity_unknown",
  );
  expect(unsent).toMatchObject({ side: "original" });
  expect(unsent.command).toContain("/evidence/original/notes/run-3.json'");
  expect(unsent.message).toContain(
    "request of POST /api/notes#1 was not recorded on the original",
  );
  expect(unsent.message).toContain(
    "only a reply body is supplied by another capture",
  );
  expect(unsent.message).not.toContain("Captures fold");

  // A request line only the clone sent, where the original's own lines vary: named as the clone's, in the run's words.
  const line = "GET /api/notes/9f3a#1";
  const cloneOnly = item(
    await evaluateScripted(run, {
      create: {
        status: "unstable",
        finding: {
          ...request,
          category: "repeats-differ",
          request: line,
          side: "left",
          expected: "the left captures do not send the same requests",
          actual: line,
        },
      },
    }),
    "parity_unstable",
  );
  expect(cloneOnly).toMatchObject({
    role: "prober",
    side: "original",
    file: "scenarios/notes.json",
  });
  expect(cloneOnly.message).toContain(
    `the clone sent ${line}, which no capture of the original sent`,
  );
  expect(cloneOnly.message).toContain(
    "removes the original's captures of this scenario",
  );
  expect(cloneOnly.message).not.toContain("left captures");
  expect(cloneOnly.message).not.toContain("Change the clone");
});

it("names the recorded cause of a step that did not complete or is unsteady, and collapses equal findings", async () => {
  const folder = await scaffold();
  const { run } = folder;
  await evaluate(run);
  const script = (
    scripted: FakeCapture["scripted"],
    original: Partial<FakeCapture> = {},
  ): Promise<CloneRunGate> => evaluateScripted(run, scripted, original);
  const text = TEXT;

  // A step that did not complete: the failed step, its file and what makes a request step fail.
  const steps = (failed: string) =>
    ["scenario_start", "fp-list", "setup-seed", "create", "open"].map((id) => ({
      step_id: id,
      outcome:
        id === failed
          ? ("failed" as const)
          : id === "open"
            ? ("cancelled" as const)
            : ("completed" as const),
    }));
  const redirected = await script(
    {
      create: {
        status: "unknown",
        finding: {
          dimension: "step",
          category: "not-completed",
          side: "left",
          request: null,
          pointer: null,
          expected: "failed",
        },
      },
    },
    { steps: steps("create") },
  );
  const incomplete = item(redirected, "parity_unknown");
  expect(incomplete).toMatchObject({ role: "prober", side: "original" });
  expect(incomplete.message).toContain(
    "Step create failed on the original in evidence/original/notes/run-1.json",
  );
  expect(incomplete.message).toContain("a redirect (a 3xx reply");
  expect(reasons(redirected)).toContain("obligation_step_unknown");

  // The original's own instability that no declaration can cover goes to the prober, in whole sentences.
  for (const finding of [
    { ...text, category: "repeats-differ", side: "left" as const },
    {
      dimension: "body" as const,
      category: "undeclared-volatile",
      side: "left" as const,
      pointer: "",
    },
  ]) {
    const unsteady = item(
      await script({ create: { status: "unstable", finding } }),
      "parity_unstable",
    );
    expect(unsteady).toMatchObject({
      role: "prober",
      side: "original",
      file: "scenarios/notes.json",
    });
    expect(unsteady.message).not.toContain("Otherwise");
    expect(unsteady.message).toContain(
      finding.dimension === "body"
        ? "A text reply cannot be declared volatile"
        : "not on-screen text",
    );
    expect(unsteady.message).toContain("one capture at a time per side");
  }

  // Steps that share one finding are one item that lists them; every one still counts.
  const same = {
    status: "changed" as const,
    finding: { ...text, expected: '"Welcome"', actual: '"Hello"' },
  };
  const collapsed = await script({
    "fp-list": same,
    "setup-seed": same,
    create: same,
    open: same,
  });
  expect(collapsed.blocking).toEqual([{ reason: "parity_changed", count: 4 }]);
  expect(collapsed.summary).toBe("not done: 4 blocking findings");
  expect(collapsed.next).toHaveLength(1);
  expect(collapsed.next[0]).toMatchObject({
    step_id: "fp-list",
    step_ids: ["fp-list", "setup-seed", "create", "open"],
  });
  expect(collapsed.next[0]?.message).toContain(
    "Steps fp-list, setup-seed, create and open of scenario notes differ",
  );
});

it("requires a clean, recorded start on each side", async () => {
  const folder = await scaffold();
  const { run } = folder;
  await captureBoth(folder);
  const second = join(run, "evidence", "original", "notes", "run-2.json");
  await editJson(second, (file) => {
    (file as { fingerprint_sha256: string }).fingerprint_sha256 = "e".repeat(
      64,
    );
  });
  const tie = await evaluate(run);
  expect(tie.blocking).toEqual([{ reason: "start_state_dirty", count: 1 }]);
  expect(item(tie, "start_state_dirty")).toMatchObject({
    role: "prober",
    side: "original",
    command: `rm '${join(run, "evidence", "original", "notes", "run-1.json")}' '${second}'`,
  });
  await capture(run, "original", "run-3");
  expect(item(await evaluate(run), "start_state_dirty").command).toBe(
    `rm '${second}'`,
  );
  await rm(second);
  expect((await evaluate(run)).verdict).toBe("done");

  // Text that varies by itself is not a missed reset: the message names the text and the scenario change.
  const first = join(run, "evidence", "original", "notes", "run-1.json");
  await editJson(first, (file) => {
    (file as { fingerprint_sha256: string }).fingerprint_sha256 = "d".repeat(
      64,
    );
    (file as { scripted: object }).scripted = {
      "fp-list": {
        status: "unstable",
        finding: {
          dimension: "text",
          category: "repeats-differ",
          side: "left",
          request: null,
          pointer: null,
          expected: '"time: 10:00:01" | "time: 10:00:04"',
        },
      },
    };
  });
  const clock = item(await evaluate(run), "start_state_dirty");
  expect(clock).toMatchObject({
    role: "prober",
    side: "original",
    file: "scenarios/notes.json",
    step_id: "fp-list",
    command: `rea evaluate-clone-run '${run}' --exit-code`,
  });
  expect(clock.message).toContain("the on-screen text at fp-list differs");
  expect(clock.message).toContain("time: 10:00:01");
  expect(clock.message).not.toContain("without a reset");
  await editJson(first, (file) => {
    (file as { fingerprint_sha256: string }).fingerprint_sha256 = FINGERPRINT;
    (file as { scripted: object }).scripted = {};
  });
  expect((await evaluate(run)).verdict).toBe("done");

  // A fingerprint that was not recorded whole shows nothing; it is not a clean start.
  for (const name of ["run-1", "run-2"])
    await editJson(
      join(run, "evidence", "clone", "notes", `${name}.json`),
      (file) => {
        (file as { fingerprint_sha256: null }).fingerprint_sha256 = null;
      },
    );
  const unknown = await evaluate(run);
  expect(unknown.blocking).toEqual([
    { reason: "start_state_unknown", count: 1 },
  ]);
  expect(unknown.checks.clean_start).toBe("fail");
  expect(item(unknown, "start_state_unknown")).toMatchObject({
    role: "verifier",
    side: "clone",
  });
  expect(item(unknown, "start_state_unknown").command).toContain(
    "/evidence/clone/notes/run-3.json'",
  );
});

it("requires every behaviour step cited and every citation shown on the original", async () => {
  const folder = await scaffold();
  const { run } = folder;
  await captureBoth(folder);
  await writeJson(join(run, "obligations", "notes.json"), {
    obligations: [
      {
        ...OBLIGATIONS.obligations[0],
        cases: [
          { scenario: "notes", step_ids: ["create", "delete", "fp-list"] },
          { scenario: "tags", step_ids: ["create"] },
        ],
      },
      {
        id: "notes-limit",
        statement: "Titles end at 80 characters.",
        basis: "inferred",
        cases: [],
      },
    ],
  });
  await editJson(
    join(run, "evidence", "original", "notes", "run-2.json"),
    (file) => {
      for (const step of file.steps as { step_id: string; outcome: string }[])
        if (step.step_id === "create") step.outcome = "failed";
    },
  );
  const gate = await evaluate(run);
  expect(gate.blocking).toEqual([
    { reason: "step_uncited", count: 1 },
    { reason: "obligation_step_unknown", count: 4 },
    { reason: "obligation_inferred", count: 1 },
  ]);
  expect(item(gate, "step_uncited")).toMatchObject({
    role: "spec_writer",
    scenario: "notes",
    step_id: "open",
    file: "obligations",
  });
  expect(item(gate, "step_uncited").message).toContain(
    '{"scenario":"notes","step_ids":["open"]}',
  );
  const unknownSteps = gate.next
    .filter(({ reason }) => reason === "obligation_step_unknown")
    .map(({ message }) => message);
  expect(unknownSteps[0]).toContain(
    "cites step create of scenario notes, which did not complete on the original in evidence/original/notes/run-2.json",
  );
  expect(unknownSteps[1]).toContain(
    "cites step delete, which scenario notes does not have",
  );
  expect(unknownSteps[2]).toContain("cites fp-list, a fingerprint step");
  expect(unknownSteps[3]).toContain("cites scenario tags");
  expect(item(gate, "obligation_inferred")).toMatchObject({
    role: "prober",
    obligation: "notes-limit",
    file: "obligations/notes.json",
  });
});

it("settles unknowns and inferred obligations only by a waiver with a named person and a reason", async () => {
  const folder = await scaffold();
  const { run } = folder;
  await captureBoth(folder);
  await writeJson(join(run, "unknowns", "prober-1.json"), {
    statement:
      "Whether titles are limited by characters or bytes was not probed.",
  });
  await writeJson(join(run, "unknowns", "scout-1.json"), {
    statement: "Whether the list page paginates.",
  });
  await editJson(join(run, "obligations", "notes.json"), (file) => {
    (file.obligations as object[]).push({
      id: "notes-limit",
      statement: "Titles end at 80 characters.",
      basis: "inferred",
      cases: [],
    });
  });
  const open = await evaluate(run);
  expect(open.blocking).toEqual([
    { reason: "obligation_inferred", count: 1 },
    { reason: "unknown_open", count: 2 },
  ]);
  expect(item(open, "unknown_open")).toMatchObject({
    role: "lead",
    file: "unknowns/prober-1.json",
  });
  expect(item(open, "unknown_open").message).toContain(
    '{"kind":"unknown","id":"prober-1","person":"<name>","reason":"<why this gap is accepted>"}',
  );

  const waive = (person: string, reason: string): Promise<void> =>
    writeJson(join(run, "waivers.json"), {
      waivers: [
        { kind: "unknown", id: "prober-1", person, reason },
        { kind: "obligation", id: "notes-limit", person, reason },
      ],
      closed: [{ unknown: "scout-1", obligation: "notes-create" }],
    });
  await waive(" ", "");
  const refused = await evaluate(run);
  expect(refused.verdict).toBe("not_done");
  expect(reasons(refused)).toEqual([
    "waivers_invalid",
    "obligation_inferred",
    "unknown_open",
  ]);
  expect(refused.waivers).toBe(0);
  expect(
    refused.next
      .filter(({ reason }) => reason === "waivers_invalid")
      .map(({ message }) => message),
  ).toEqual([
    "waivers.json /waivers/0/person: Name the person who accepts the gap; Correct the value at this pointer",
    "waivers.json /waivers/0/reason: Say why the gap is accepted; Correct the value at this pointer",
    "waivers.json /waivers/1/person: Name the person who accepts the gap; Correct the value at this pointer",
    "waivers.json /waivers/1/reason: Say why the gap is accepted; Correct the value at this pointer",
  ]);

  await waive("R. Owner", "Out of scope for the first release.");
  const waived = await evaluate(run);
  expect(waived).toMatchObject({
    verdict: "done_with_waivers",
    summary: "done with 2 waivers",
    waivers: 2,
    blocking: [],
  });
  expect(cloneRunExitCode(waived.verdict)).toBe(0);

  // A waiver that names nothing, or tries to waive an observed rule, is refused and has no effect.
  await editJson(join(run, "waivers.json"), (file) => {
    (file.waivers as object[]).push(
      { kind: "unknown", id: "prober-9", person: "R. Owner", reason: "None." },
      {
        kind: "obligation",
        id: "notes-create",
        person: "R. Owner",
        reason: "None.",
      },
    );
    (file.closed as object[]).push({
      unknown: "scout-1",
      obligation: "notes-limit",
    });
  });
  const naming = await evaluate(run);
  expect(naming.blocking).toEqual([{ reason: "waivers_invalid", count: 3 }]);
  expect(naming.verdict).toBe("not_done");
});

it("refuses a copied file and the original's name in the clone", async () => {
  const folder = await scaffold();
  const { run, cloneRoot } = folder;
  const served = `/* styles the original serves */\n${"body { margin: 0; }\n".repeat(8)}`;
  const script = `// script the original serves\n${"render();\n".repeat(12)}`;
  await writeFile(join(run, "scout", "site.css"), served);
  await writeFile(join(run, "scout", "tiny.txt"), "ok\n");
  await writeFile(join(cloneRoot, "site.css"), served);
  await writeFile(join(cloneRoot, "tiny.txt"), "ok\n");
  await writeFile(join(cloneRoot, "app.js"), script);
  await writeFile(join(cloneRoot, "about.html"), "<h1>About NOTELET</h1>\n");
  await mkdir(join(cloneRoot, "notelet-theme"));
  await writeFile(
    join(cloneRoot, "notelet-theme", "main.css"),
    "h1 { color: teal; }\n",
  );
  await evaluate(run);
  for (const name of ["run-1", "run-2"]) {
    await capture(run, "original", name, {
      reply_bodies: [
        {
          request: "GET /app.js",
          sha256: sha256Hex(script),
          bytes: Buffer.byteLength(script),
        },
      ],
    });
    await capture(run, "clone", name);
  }
  const gate = await evaluate(run);
  expect(gate.blocking).toEqual([
    { reason: "clean_room_identical_file", count: 2 },
    { reason: "clean_room_forbidden_name", count: 2 },
  ]);
  expect(
    gate.next.map(({ role, reason, file }) => [role, reason, file]),
  ).toEqual([
    ["builder", "clean_room_identical_file", join(cloneRoot, "app.js")],
    ["builder", "clean_room_identical_file", join(cloneRoot, "site.css")],
    ["builder", "clean_room_forbidden_name", join(cloneRoot, "about.html")],
    [
      "builder",
      "clean_room_forbidden_name",
      join(cloneRoot, "notelet-theme/main.css"),
    ],
  ]);
  expect(gate.next[0]?.message).toContain(
    "the original's reply to GET /app.js",
  );
  expect(gate.next[1]?.message).toContain("scout/site.css");
  expect(gate.next[2]?.message).toContain(
    'the original\'s name "Notelet" in its bytes',
  );
  expect(gate.next[3]?.message).toContain("in its path");
  expect(gate.next[0]?.message).toContain("names and identical files only");

  // Material behind links is read by its real path; it is not dropped as "no copy".
  const mirror = join(folder.base, "mirror");
  await mkdir(mirror);
  await rm(join(run, "scout", "site.css"));
  await writeFile(join(mirror, "site.css"), served);
  await symlink(mirror, join(run, "scout", "site"));
  await rm(join(cloneRoot, "about.html"));
  await rm(join(cloneRoot, "notelet-theme"), { recursive: true });
  await symlink("notelet-data", join(cloneRoot, "data"));
  await evaluate(run);
  for (const name of ["run-3", "run-4"]) await capture(run, "clone", name);
  const linked = await evaluate(run);
  expect(linked.next.map(({ reason }) => reason)).toEqual([
    "clone_symlink_outside_root",
    "clean_room_identical_file",
    "clean_room_identical_file",
    "clean_room_forbidden_name",
  ]);
  expect(linked.next[0]?.message).toContain(
    "The clone's data is a symlink that cannot be resolved now",
  );
  expect(linked.next[2]?.message).toContain(
    "The clone's site.css is byte-identical to scout/site/site.css",
  );
  expect(linked.next[3]?.message).toContain("in its link text");

  // Declared material that is absent, or holds a link that cannot be followed, is a finding, not a pass.
  await symlink("gone.css", join(run, "scout", "lost.css"));
  await editJson(join(run, "target.json"), (target) => {
    (target.original as { material: string[] }).material = ["scout", "scuot"];
  });
  const unread = await evaluate(run);
  const invalid = unread.next.filter(
    ({ reason }) => reason === "target_invalid",
  );
  expect(invalid.map(({ pointer, role }) => [pointer, role])).toEqual([
    ["/original/material/0", "lead"],
    ["/original/material/1", "lead"],
  ]);
  expect(invalid[0]?.message).toContain("scout/lost.css could not be read");
  expect(invalid[1]?.message).toContain(
    "the material directory scuot does not exist",
  );
});

it("checks the scope target.json declares and works on the original before a clone exists", async () => {
  const folder = await scaffold();
  const { run, cloneRoot, base } = folder;
  await rm(cloneRoot, { recursive: true });
  await evaluate(run);
  await capture(run, "original", "run-1");
  await capture(run, "original", "run-2", {
    fingerprint_sha256: "e".repeat(64),
  });
  const early = await evaluate(run);
  expect(early.blocking).toEqual([
    { reason: "clone_root_missing", count: 1 },
    { reason: "start_state_dirty", count: 1 },
  ]);
  expect(item(early, "clone_root_missing")).toMatchObject({
    role: "builder",
    file: cloneRoot,
  });
  expect(early.checks).toMatchObject({
    scope: "fail",
    parity: "not_evaluated",
  });
  expect(early.clone_tree).toBeNull();
  expect(await readdir(join(run, "behavior"))).toEqual(["notes.json"]);
  expect(await readdir(join(run, "rendered", "clone"))).toEqual([]);

  await mkdir(cloneRoot);
  await writeFile(join(base, "outside.mjs"), "export const shared = 1;\n");
  await symlink(join(base, "outside.mjs"), join(cloneRoot, "shared.mjs"));
  // A link that leaves the root blocks whether or not its target exists when the referee looks.
  await symlink("../hidden/rule.mjs", join(cloneRoot, "rule.mjs"));
  // A file whose name is not UTF-8 cannot be recorded; it is a finding, not a refusal and not a skip.
  await writeFile(
    Buffer.concat([Buffer.from(`${cloneRoot}/caf`), Buffer.from([0xe9])]),
    "x",
  );
  await editJson(join(run, "target.json"), (target) => {
    (target.clone as { address: string }).address = "http://localhost:4631";
    (target.clone as { name: string }).name = "Notelet Two";
  });
  const scope = await evaluate(run);
  expect(reasons(scope).slice(0, 4)).toEqual([
    "target_invalid",
    "addresses_not_distinct",
    "clone_symlink_outside_root",
    "clone_path_unreadable",
  ]);
  expect(
    scope.next
      .filter(({ reason }) => reason === "clone_symlink_outside_root")
      .map(({ role, file }) => [role, file]),
  ).toEqual([
    ["builder", join(cloneRoot, "rule.mjs")],
    ["builder", join(cloneRoot, "shared.mjs")],
  ]);
  expect(item(scope, "clone_path_unreadable")).toMatchObject({
    role: "builder",
  });
  expect(item(scope, "clone_path_unreadable").message).toContain(
    "not valid UTF-8",
  );
  expect(item(scope, "addresses_not_distinct").role).toBe("lead");

  // Every alias of the original's address is the same address; a host that does not resolve is not "distinct".
  const withClone = async (address: string): Promise<CloneRunGate> => {
    await editJson(join(run, "target.json"), (target) => {
      (target.clone as { address: string }).address = address;
    });
    return evaluate(run);
  };
  for (const alias of [
    "http://localhost.:4631",
    "http://[::ffff:127.0.0.1]:4631",
    "http://vm:4631",
    "https://127.0.0.1:4631",
  ]) {
    const refused = await withClone(alias);
    expect(reasons(refused), alias).toContain("addresses_not_distinct");
    expect(item(refused, "addresses_not_distinct").message, alias).toContain(
      "are one address: both use port 4631",
    );
  }
  expect(
    item(
      await withClone("http://clone.internal:4631"),
      "addresses_not_distinct",
    ).message,
  ).toContain("the clone's host clone.internal did not resolve");
  expect(reasons(await withClone("http://clone.internal:4632"))).not.toContain(
    "addresses_not_distinct",
  );

  await editJson(join(run, "target.json"), (target) => {
    (target.clone as { root: string }).root = base;
  });
  expect(reasons(await evaluate(run))).toContain("run_folder_inside_clone");

  // A refused target.json blocks without stopping the report on every other file.
  await writeJson(join(run, "target.json"), {
    schema: "rea.clone-run.target/1",
  });
  await writeFile(join(run, "scenarios", "broken.json"), "{");
  const before = await readdir(join(run, "behavior"));
  expect(before).toEqual(["notes.json"]);
  const refused = await evaluate(run);
  expect(refused.target).toBeNull();
  expect(reasons(refused)).toEqual(["target_invalid", "scenario_invalid"]);
  expect(refused.checks.evidence).toBe("not_evaluated");
  expect(item(refused, "target_invalid").command).toBe(
    `rea evaluate-clone-run '${run}' --exit-code`,
  );
  // A refused target.json blocks and leaves the derived outputs alone: builders keep the behaviour tables.
  expect(await readdir(join(run, "behavior"))).toEqual(before);
  expect(await readdir(join(run, "rendered", "original"))).toEqual([
    "notes.json",
  ]);
  // The command is still spelled as the run was created, when the refused file states it.
  await writeJson(join(run, "target.json"), {
    schema: "rea.clone-run.target/1",
    rea_command: "node /opt/rea/scripts/rea.mjs",
  });
  expect(item(await evaluate(run), "target_invalid").command).toBe(
    `node /opt/rea/scripts/rea.mjs evaluate-clone-run '${run}' --exit-code`,
  );
});

it("names the path and the fix of every broken authored file in one evaluation", async () => {
  const { run } = await scaffold();
  await writeJson(join(run, "obligations", "notes.json"), {
    obligations: [
      { id: "rule", statement: "A rule.", basis: "observed", cases: [] },
    ],
  });
  await writeJson(join(run, "scenarios", "notes.json"), {
    start_path: "/",
    actions: [
      {
        step_id: "fp-list",
        action: "request",
        method: "GET",
        path: "/api/notes",
      },
      {
        step_id: "away",
        action: "goto",
        destination: { url: "http://127.0.0.1:4631/notes" },
        wait_until: "load",
      },
    ],
  });
  await writeJson(join(run, "scenarios", "no-proof.json"), {
    start_path: "/",
    scenario: "no-proof",
    actions: [
      { step_id: "setup-only", action: "wait_for_timeout", duration_ms: 1 },
    ],
  });
  await writeJson(join(run, "unknowns", "someone-1.json"), { statement: "?" });
  await writeJson(join(run, "intended-differences.json"), {
    renames: [],
    volatile_fields: [
      {
        scenario: "notes",
        step_id: "create",
        pointer: "",
        reason: "all of it",
      },
      { scenario: "missing", step_id: "create", pointer: "/id", reason: "ids" },
    ],
  });
  const gate = await evaluate(run);
  expect(gate.verdict).toBe("not_done");
  expect(gate.checks.inputs).toBe("fail");
  const messages = gate.next.map(
    ({ reason, message }) => `${reason}: ${message}`,
  );
  expect(messages).toContain(
    'obligation_invalid: obligations/notes.json /obligations/0/cases: An observed obligation cites at least one case; add {"scenario": "<id>", "step_ids": ["<step>"]} or set basis to "inferred"; examples/obligations.example.json is a valid example',
  );
  expect(messages).toContain(
    "scenario_invalid: scenarios/notes.json /actions/1/destination/url: A goto must stay on the clone's address http://127.0.0.1:4632; this one goes to http://127.0.0.1:4631/notes; Write the URL as \"{origin}/<path>\"; the placeholder is replaced by each side's address",
  );
  expect(
    messages.filter((message) => message.includes("scenarios/no-proof.json")),
  ).toEqual([
    "scenario_invalid: scenarios/no-proof.json /scenario: Unknown member; Remove it; the file accepts only the members its example shows; examples/scenario.example.json is a valid example",
    "scenario_invalid: scenarios/no-proof.json /actions: Start with at least one 'fp-' step that reads the state a clean start shows, such as a list request; Correct the value at this pointer; examples/scenario.example.json is a valid example",
    "scenario_invalid: scenarios/no-proof.json /actions: Add at least one step that is neither 'fp-' nor 'setup-': only such steps are cited and must match; Correct the value at this pointer; examples/scenario.example.json is a valid example",
  ]);
  expect(
    messages.some((message) =>
      message.startsWith(
        "unknown_invalid: unknowns/someone-1.json: An unknown is named <role>-<n>.json",
      ),
    ),
  ).toBe(true);
  expect(
    messages.some((message) =>
      message.startsWith(
        "intended_differences_invalid: intended-differences.json /volatile_fields/0/pointer: Use an RFC 6901 JSON pointer to one field",
      ),
    ),
  ).toBe(true);
  expect(reasons(gate)).toEqual([
    "scenario_invalid",
    "obligation_invalid",
    "unknown_invalid",
    "intended_differences_invalid",
  ]);
});

it("lists at most ten items and says how many it left out", async () => {
  const { run } = await scaffold();
  for (const index of [1, 2, 3]) {
    await writeJson(join(run, "scenarios", `more-${index}.json`), SCENARIO);
    await writeJson(join(run, "unknowns", `mapper-${index}.json`), {
      statement: `Open question ${index}.`,
    });
  }
  const gate = await evaluate(run);
  const total = gate.blocking.reduce((sum, { count }) => sum + count, 0);
  expect(gate.blocking).toEqual([
    { reason: "evidence_missing", count: 16 },
    { reason: "step_uncited", count: 6 },
    { reason: "unknown_open", count: 3 },
  ]);
  expect(gate.next).toHaveLength(10);
  expect(gate.next.every(({ reason }) => reason === "evidence_missing")).toBe(
    true,
  );
  expect(gate.summary).toBe(
    `not done: ${total} blocking findings; next lists the first 10 and leaves out ${total - 10}`,
  );
  expect(new Set(gate.next.map(({ command }) => command)).size).toBe(10);
});

const readJournal = async (run: string) =>
  (await readFile(join(run, "journal.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => cloneRunJournalEntrySchema.parse(JSON.parse(line)));

it("reports a stall from its own journal and never a pass", async () => {
  const folder = await scaffold();
  const { run } = folder;
  await captureBoth(folder, { observed: { create: "wrong" } });
  const journal = () => readJournal(run);
  const first = await evaluate(run);
  expect(first).toMatchObject({
    verdict: "not_done",
    stall: {
      round: 1,
      max_rounds: 8,
      judged: true,
      attempts: 1,
      repeated: false,
    },
  });
  // A judged result that is not a pass says what would make the next one read stalled.
  expect(first.stall.outlook).toContain("Round 1 of 8, judged, attempt 1 of 2");
  expect(first.stall.outlook).toContain("reads stalled");
  const lines = (await journal()).length;
  // Running the referee again is free: no line, no round.
  expect((await evaluate(run)).stall.round).toBe(1);
  expect(await journal()).toHaveLength(lines);

  // One more capture, the same failure and the same clone: the team acted and nothing moved.
  await capture(run, "clone", "run-3", { observed: { create: "wrong" } });
  const stalled = await evaluate(run);
  expect(stalled).toMatchObject({
    verdict: "stalled",
    stall: { round: 1, attempts: 2, repeated: true },
  });
  expect(stalled.summary).toBe(
    "stalled after 1 judged round (the same findings were judged 2 times on the same clone tree): 1 blocking finding",
  );
  expect(stalled.next).toHaveLength(1);
  expect(cloneRunExitCode(stalled.verdict)).toBe(2);
  expect((await journal()).at(-1)).toMatchObject({
    judged: true,
    round: 1,
    verdict: "stalled",
  });

  // A stall is never a pass, and a pass is not undone by the journal.
  for (const name of ["run-1", "run-2", "run-3"])
    await editJson(
      join(run, "evidence", "clone", "notes", `${name}.json`),
      (file) => {
        (file as { observed: object }).observed = {};
      },
    );
  await editJson(join(run, "target.json"), (target) => {
    (target.limits as { max_rounds: number }).max_rounds = 1;
  });
  const done = await evaluate(run);
  expect(done.verdict).toBe("done");
  expect(done.stall.outlook).toBeNull();
  await editJson(
    join(run, "evidence", "clone", "notes", "run-1.json"),
    (file) => {
      (file as { observed: object }).observed = { open: "wrong" };
    },
  );
  expect(await evaluate(run)).toMatchObject({
    verdict: "stalled",
    stall: { max_rounds: 1, repeated: false },
  });
});

it("does not call it a stall when nothing changed, or when its own capture command was run once", async () => {
  const folder = await scaffold();
  const { run } = folder;
  await captureBoth(folder);
  await writeJson(join(run, "unknowns", "prober-1.json"), {
    statement: "Open question.",
  });
  // Two evaluations at once both append the line; the next one is still the same round and attempt.
  const atOnce = () =>
    evaluateCloneRun(run, {
      comparer: fakeComparer(),
      digestTree: digestCloneTree,
      now: () => new Date((clock += 1000)),
      hostResolver,
    });
  const both = await Promise.all([atOnce(), atOnce()]);
  expect(both.map((gate) => gate.ok && gate.value.verdict)).toEqual([
    "not_done",
    "not_done",
  ]);
  expect((await readJournal(run)).filter(({ judged }) => judged)).toHaveLength(
    2,
  );
  const again = await evaluate(run);
  expect(again).toMatchObject({
    verdict: "not_done",
    stall: { round: 1, attempts: 1, repeated: false },
  });

  // A half-written target.json between two evaluations of one state: left and entered again, no stall.
  const target = await readFile(join(run, "target.json"), "utf8");
  await writeFile(join(run, "target.json"), target.slice(0, 300));
  expect((await evaluate(run)).stall.judged).toBe(false);
  await writeFile(join(run, "target.json"), target);
  expect(await evaluate(run)).toMatchObject({
    verdict: "not_done",
    stall: { round: 1, attempts: 1, repeated: false },
  });

  // Another open unknown is another finding: the digest tells them apart by file.
  const before = (await readJournal(run)).at(-1)?.failures_sha256;
  await rm(join(run, "unknowns", "prober-1.json"));
  await writeJson(join(run, "unknowns", "mapper-7.json"), {
    statement: "Another open question.",
  });
  expect(item(await evaluate(run), "unknown_open").file).toBe(
    "unknowns/mapper-7.json",
  );
  expect((await readJournal(run)).at(-1)?.failures_sha256).not.toBe(before);
  await rm(join(run, "unknowns", "mapper-7.json"));

  // A reply no capture recorded: the worklist's own capture command, run once, is not a stall.
  for (const name of ["run-1", "run-2"])
    await editJson(
      join(run, "evidence", "original", "notes", `${name}.json`),
      (file) => {
        (file as { observed: object }).observed = { create: MISSING };
      },
    );
  const asked = await evaluate(run);
  expect(asked.blocking).toEqual([{ reason: "parity_unknown", count: 1 }]);
  expect(asked.stall.outlook).toContain(
    "One round of new captures with the same findings is expected",
  );
  await capture(run, "original", "run-3", { observed: { create: MISSING } });
  const once = await evaluate(run);
  expect(once).toMatchObject({
    verdict: "not_done",
    stall: { round: 1, attempts: 2, repeated: true },
  });
  expect(once.stall.outlook).toContain("attempt 2 of 3");
  // Still missing after a second capture: the data will not arrive, and going on is going round.
  await capture(run, "original", "run-4", { observed: { create: MISSING } });
  expect(await evaluate(run)).toMatchObject({
    verdict: "stalled",
    stall: { round: 1, attempts: 3 },
  });
  // It reads not_done again as soon as the findings change.
  await capture(run, "original", "run-5");
  expect((await evaluate(run)).verdict).toBe("done");
});

it("repairs a journal that ends in a partial line instead of joining the next entry to it", async () => {
  const folder = await scaffold();
  const { run } = folder;
  await evaluate(run);
  await appendFile(
    join(run, "journal.jsonl"),
    '{"schema":"rea.clone-run.journal/1","at":"2026',
  );
  await writeJson(join(run, "unknowns", "prober-1.json"), {
    statement: "Open question.",
  });
  await evaluate(run);
  const lines = (await readFile(join(run, "journal.jsonl"), "utf8"))
    .trim()
    .split("\n");
  expect(lines.at(-2)).toBe('{"schema":"rea.clone-run.journal/1","at":"2026');
  expect(
    cloneRunJournalEntrySchema.safeParse(JSON.parse(lines.at(-1) ?? ""))
      .success,
  ).toBe(true);
});

it("rejects an Evidence entry that is not a regular file and never offers its name to a capture", async () => {
  const folder = await scaffold();
  const { run } = folder;
  await captureBoth(folder);
  const directory = join(run, "evidence", "original", "notes");
  await rm(join(directory, "run-2.json"));
  await mkdir(join(directory, "run-2.json"));
  await symlink(join(directory, "run-1.json"), join(directory, "run-3.json"));
  const gate = await evaluate(run);
  expect(gate.blocking).toEqual([
    { reason: "evidence_missing", count: 1 },
    { reason: "evidence_rejected_integrity", count: 2 },
  ]);
  // The printed capture command runs as printed: its output name is free.
  expect(item(gate, "evidence_missing").command).toContain(
    "/evidence/original/notes/run-4.json' --json",
  );
  expect(
    gate.next
      .filter(({ reason }) => reason === "evidence_rejected_integrity")
      .map(({ command, message }) => [command, message.includes("not a file")]),
  ).toEqual([
    [`rm -r '${join(directory, "run-2.json")}'`, true],
    [`rm '${join(directory, "run-3.json")}'`, true],
  ]);
});

it("says next to the verdict which clone paths are excluded, and refuses an exclude that cannot match", async () => {
  const folder = await scaffold();
  const { run, cloneRoot } = folder;
  await mkdir(join(cloneRoot, "node_modules"));
  await writeFile(join(cloneRoot, "node_modules", "dep.js"), "1");
  await writeFile(join(cloneRoot, "rule.mjs"), "export const limit = 24;\n");
  await editJson(join(run, "target.json"), (target) => {
    (target.clone as { exclude: string[] }).exclude = [
      ".git",
      "node_modules",
      "rule.mjs",
    ];
  });
  await captureBoth(folder);
  const done = await evaluate(run);
  expect(done.verdict).toBe("done");
  // Only the excludes that matched a path are listed, and the summary carries the limit with the pass.
  expect(done.clone_tree?.exclude).toEqual(["node_modules", "rule.mjs"]);
  expect(done.summary).toBe(
    "done; 2 clone paths are excluded and are covered neither by staleness nor by the clean-room check (node_modules, rule.mjs)",
  );
  expect(done.residual_trust).toEqual(CLONE_RUN_RESIDUAL_TRUST);
  // The edit an exclude hides: the verdict stays done, and the same line still says why that proves nothing.
  await writeFile(join(cloneRoot, "rule.mjs"), "export const limit = 20;\n");
  expect((await evaluate(run)).summary).toBe(done.summary);

  await editJson(join(run, "target.json"), (target) => {
    (target.clone as { exclude: string[] }).exclude = ["*.log", "/abs/x"];
  });
  const refused = await evaluate(run);
  expect(reasons(refused)).toEqual(["target_invalid"]);
  expect(refused.next.map(({ pointer }) => pointer)).toEqual([
    "/clone/exclude/0",
    "/clone/exclude/1",
  ]);
  expect(refused.next[0]?.message).toContain(
    "Patterns are not expanded, so this matches nothing",
  );
});

it("refuses a folder that is not a run and passes on a refusal of the comparer", async () => {
  const folder = await scaffold();
  const dependencies = {
    comparer: fakeComparer(),
    digestTree: digestCloneTree,
    now: () => new Date(clock),
  };
  const missing = await evaluateCloneRun(
    join(folder.base, "absent"),
    dependencies,
  );
  expect(missing).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisInputError", operation: "evaluate-clone-run" },
  });
  const notRun = await evaluateCloneRun(folder.cloneRoot, dependencies);
  expect(!notRun.ok && notRun.error.userMessage).toContain(
    "has no target.json",
  );
  await captureBoth(folder);
  const refused = await evaluateCloneRun(folder.run, {
    ...dependencies,
    comparer: fakeComparer(true),
  });
  expect(!refused.ok && refused.error.userMessage).toBe(
    "The captures of one side list different steps",
  );
});

it("starts a new run with the two files only agents can write", async () => {
  const { run, cloneRoot } = await scaffold();
  await rm(join(run, "scenarios", "notes.json"));
  await rm(join(run, "obligations", "notes.json"));
  const gate = await evaluate(run);
  expect(gate.blocking).toEqual([
    { reason: "no_scenarios", count: 1 },
    { reason: "no_obligations", count: 1 },
  ]);
  expect(gate.next.map(({ role, file }) => [role, file])).toEqual([
    ["prober", "scenarios"],
    ["spec_writer", "obligations"],
  ]);
  // Before any scenario exists a single agent that takes the first item is sent to the prober, not the builder.
  await rm(cloneRoot, { recursive: true });
  expect(
    (await evaluate(run)).next.map(({ role, reason }) => [role, reason]),
  ).toEqual([
    ["prober", "no_scenarios"],
    ["spec_writer", "no_obligations"],
    ["builder", "clone_root_missing"],
  ]);
  expect(gate.checks).toMatchObject({
    inputs: "fail",
    evidence: "not_evaluated",
  });
});

it("has seen every reason code block", () => {
  expect([...seenReasons].toSorted()).toEqual(
    [...CLONE_RUN_REASON_CODES].toSorted(),
  );
});
