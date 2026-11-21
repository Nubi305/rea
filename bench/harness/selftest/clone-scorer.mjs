// The clone scorer on an application against an exact copy of itself, which
// must agree on every hidden rule, and against the copy with one rule broken
// (hidden/selftest-mutant.json), which must disagree on exactly that rule.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { copyOriginal } from "../lib/clone-app.mjs";
import { runRea } from "../lib/proc.mjs";
import { CELL_SCHEMA } from "../lib/workspace.mjs";
import {
  runScorer,
  same,
  transcriptLines,
  turn,
  writeTranscript,
} from "./kit.mjs";

const applyMutant = (app, directory) => {
  const mutant = JSON.parse(
    readFileSync(join(app.hidden_dir, "selftest-mutant.json"), "utf8"),
  );
  const file = join(directory, mutant.file);
  const source = readFileSync(file, "utf8");
  if (!source.includes(mutant.find))
    throw new Error(`${mutant.file} does not hold ${mutant.find}`);
  writeFileSync(file, source.replaceAll(mutant.find, mutant.replace));
  return mutant.breaks;
};

// The run folder is a real one, so that the scorer finds the commands that
// restart the clone where a run records them: in target.json.
const initRun = (settings, runDir, cloneRoot, control) => {
  const { app, judge, ports } = settings;
  const init = runRea(
    judge.checkout,
    [
      "init-clone-run",
      runDir,
      "--original",
      `http://127.0.0.1:${ports[0]}`,
      "--clone",
      `http://127.0.0.1:${ports[1]}`,
      "--clone-root",
      cloneRoot,
      "--clone-name",
      "Selftest Mirror",
      ...app.product_names.flatMap((name) => ["--original-name", name]),
      "--authorization",
      "Harness self-test.",
      "--clone-reset",
      control("reset"),
      "--clone-stop",
      control("stop"),
      "--browser",
      settings.browser,
      "--json",
    ],
    { node: judge.node },
  );
  if (init.status !== 0)
    throw new Error(`init-clone-run failed: ${init.stdout.slice(0, 300)}`);
};

const fabricateCell = (work, variant, settings) => {
  const { app, judge, ports } = settings;
  const workspace = join(work, `clone-${variant}`);
  const cloneRoot = join(workspace, "clone");
  mkdirSync(workspace, { recursive: true });
  const ctl = copyOriginal(app, cloneRoot);
  const breaks = variant === "mutant" ? applyMutant(app, cloneRoot) : [];
  initRun(
    settings,
    join(workspace, "run"),
    cloneRoot,
    (verb) => `PORT=${ports[1]} bash ${ctl} ${verb}`,
  );
  const address = (port) => `http://127.0.0.1:${port}`;
  const cell = {
    schema: CELL_SCHEMA,
    kind: "clone",
    id: `selftest-${variant}`,
    label: `selftest:clone:${variant}`,
    app: app.id,
    // The mirror carries the original's own name: nothing is renamed.
    clone: {
      name: app.product_names[0],
      root: cloneRoot,
      port: ports[1],
      address: address(ports[1]),
    },
    original: { address: address(ports[0]), port: ports[0], control: null },
    run_dir: join(workspace, "run"),
    skill_dir: null,
    shim_log: null,
    rea: judge,
    browser: settings.browser,
    forbidden: [],
    workspace,
  };
  writeFileSync(join(workspace, "cell.json"), JSON.stringify(cell));
  return { cell, breaks };
};

const checkVariant = (score, variant, breaks) => {
  const { hidden } = score;
  same(
    `clone scorer, ${variant}: the hidden rules that disagree`,
    hidden.rules
      ?.filter((rule) => rule.result === "disagrees")
      .map((rule) => rule.id) ?? null,
    breaks,
  );
  same(
    `clone scorer, ${variant}: every other rule agrees and no capture failed`,
    [hidden.rules_agree, hidden.rules_undecided, hidden.captures_failed],
    [hidden.rules_total - breaks.length, 0, 0],
  );
  same(
    `clone scorer, ${variant}: the referee refuses an empty run and says so by exit status`,
    [score.referee.verdict, score.referee.exit_status],
    ["not_done", 1],
  );
  same(
    `clone scorer, ${variant}: both applications left stopped`,
    score.left_running,
    {
      original: false,
      clone: false,
    },
  );
  same(
    `clone scorer, ${variant}: cost read from the transcript`,
    [score.cost.turns, score.cost.peak_context_tokens],
    [1, 1000],
  );
};

/** `settings` is `{ app, judge, ports: [a, b], browser }`. */
export const checkCloneScorer = (work, settings) => {
  const transcripts = join(work, "clone-transcripts");
  mkdirSync(transcripts, { recursive: true });
  for (const variant of ["mirror", "mutant"]) {
    const { cell, breaks } = fabricateCell(work, variant, settings);
    const turns = [
      turn(
        [100, 0, 900, 10],
        [
          {
            name: "Bash",
            input: { command: "rea evaluate-clone-run run --exit-code --json" },
            result: "{}",
          },
        ],
      ),
    ];
    writeTranscript(
      transcripts,
      variant,
      cell.label,
      transcriptLines("clone prompt", turns),
    );
    const score = runScorer("clone-score.mjs", [
      "--workspace",
      cell.workspace,
      "--cell",
      join(cell.workspace, "cell.json"),
      "--transcript",
      transcripts,
      "--judge",
      settings.judge.checkout,
      "--node",
      settings.judge.node,
    ]);
    checkVariant(score, variant, breaks);
  }
};
