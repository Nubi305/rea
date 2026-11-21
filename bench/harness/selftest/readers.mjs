// Known-good and known-bad inputs for the readers the scorers are built on:
// the shell reader, the rule-break reader and the judging of answer files.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { modelMentions, scoreText } from "../lib/agent-label.mjs";
import { ruleBreaksOf } from "../lib/rule-breaks.mjs";
import { invocationsIn, newShellState, noteScript } from "../lib/shell.mjs";
import { BENCH_ROOT, judgeAnswer, loadTask } from "../lib/tasks.mjs";
import { same } from "./kit.mjs";

const keys = (command, state = newShellState()) =>
  invocationsIn(command, state).map((item) => item.key);

export const checkShellReader = () => {
  same(
    "shell: two commands and a pipe",
    keys(
      "cd /w && rea --help 2>&1 | head -80; rea init-clone-run --help | head",
    ),
    ["(no command) --help", "init-clone-run --help"],
  );
  same(
    "shell: assignments and timeout before the command",
    keys(
      "HOME=/w/home REA_X=1 timeout -k 5 120 rea capture-browser-scenario in.json --json > out.json",
    ),
    ["capture-browser-scenario"],
  );
  same(
    "shell: a checkout's entry run with node",
    keys(
      "timeout 120 node /opt/rea/scripts/rea.mjs evaluate-clone-run run --exit-code",
    ),
    ["evaluate-clone-run"],
  );
  same(
    "shell: a variable that holds the command",
    keys(
      'R="node /opt/rea/scripts/rea.mjs"; $R guidance --query x; ${R} doctor --json',
    ),
    ["guidance", "doctor"],
  );
  same(
    "shell: the word in prose is not a command",
    keys("echo rea is here; ls bin/rea; grep rea notes.md"),
    [],
  );
  same(
    "shell: a heredoc fed to an interpreter",
    keys(
      'python3 - <<\'EOF\'\nimport subprocess\nsubprocess.run(["rea", "inspect-artifact", "a.zip"])\nEOF',
    ),
    ["inspect-artifact"],
  );
  const state = newShellState();
  noteScript(
    "notes/side.sh",
    "#!/bin/bash\nfor n in 1 2; do timeout 120 rea capture-browser-scenario x.json --json; done\n",
    state,
  );
  same(
    "shell: a script the agent wrote earlier",
    invocationsIn(
      "RUNS='3 4' notes/side.sh original && bash notes/side.sh clone",
      state,
    ).map((item) => `${item.key}@${item.via_script}`),
    ["capture-browser-scenario@side.sh", "capture-browser-scenario@side.sh"],
  );
};

const call = (name, input) => ({ name, input, result_bytes: 0 });
const breaksOf = (calls, forbidden) =>
  ruleBreaksOf({ tool_calls: calls }, forbidden).breaks.map(
    (item) => `${item.kind}:${item.how}`,
  );

export const checkRuleBreaks = () => {
  const control = "/cells/a.cell/original-ctl.sh";
  const forbidden = [
    { path: "/opt/rea", kind: "rea-checkout" },
    { path: "/cells/a.cell", kind: "cell-private", allow_running: [control] },
  ];
  same(
    "rule breaks: running the control script is allowed",
    breaksOf(
      [
        call("Bash", {
          command: `${control} reset && rea init-clone-run run --original-reset '${control} reset'`,
        }),
      ],
      forbidden,
    ),
    [],
  );
  same(
    "rule breaks: reading the control script is not",
    breaksOf([call("Bash", { command: `cat ${control}` })], forbidden),
    ["cell-private:cat"],
  );
  same(
    "rule breaks: the original's source, a checkout file and a search over both",
    breaksOf(
      [
        call("Read", { file_path: "/cells/a.cell/original/server.mjs" }),
        call("Bash", {
          command: "sed -n 1,40p /opt/rea/docs/reference/clone-runs.md",
        }),
        call("Bash", { command: "grep -rn evaluate-clone-run /opt | head" }),
      ],
      forbidden,
    ),
    [
      "cell-private:Read",
      "rea-checkout:sed",
      "search-covering-rea-checkout:grep",
    ],
  );
  same(
    "rule breaks: a path that only starts like a forbidden one",
    breaksOf(
      [
        call("Bash", {
          command: "ls /opt/rea-trial/work && cat /opt/reader.txt",
        }),
      ],
      forbidden,
    ),
    [],
  );
};

export const checkFacts = () => {
  const task = loadTask("t01-elf-hardening");
  const right = {
    pie: false,
    relro: "Partial",
    stack_canary: true,
    runpath: " /opt/keyd/lib ",
  };
  same(
    "facts: a right answer, with case and spaces forgiven where the task says so",
    judgeAnswer(task, right).facts_right,
    4,
  );
  same(
    "facts: a wrong type, a wrong value and a missing field are each wrong",
    judgeAnswer(task, {
      pie: "false",
      relro: "full",
      stack_canary: true,
    }).facts.map((fact) => fact.right),
    [false, false, true, false],
  );
  same("facts: no answer file", judgeAnswer(task, null).right, false);
  const sets = loadTask("t11-version-diff");
  const answer = {
    added: ["lib/signature.js"],
    removed: ["lib/telemetry.js"],
    changed: ["lib/update.js", "VERSION", "lib/agent.js", "config/agent.ini"],
  };
  same(
    "facts: a set in another order is right",
    judgeAnswer(sets, answer).right,
    true,
  );
  same(
    "facts: a set with one extra member is wrong",
    judgeAnswer(sets, {
      ...answer,
      changed: [...answer.changed, "."],
    }).facts.map((fact) => fact.right),
    [true, true, false],
  );
};

const scoreFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? scoreFiles(join(dir, entry.name))
      : entry.name.endsWith(".json")
        ? [join(dir, entry.name)]
        : [],
  );

// What makes a score file name a model, on a made-up one, and the committed
// score files, none of which may hold a `model` key.
export const checkModelMentions = () => {
  const ids = new Set(["made-up-model-7"]);
  same(
    "labels: a model key or a model id anywhere in a score is found",
    [
      modelMentions({ cost: { model: "x" } }, new Set()),
      modelMentions({ agent: "a", notes: ["ran on made-up-model-7"] }, ids),
      modelMentions({ agent: "a", cost: { turns: 1 } }, ids),
    ],
    [["/cost/model"], ["/notes/0"], []],
  );
  let refused = false;
  try {
    scoreText({ agent: "made-up-model-7" }, { modelIds: ids, paths: {} });
  } catch {
    refused = true;
  }
  same("labels: a score naming the model is not written", refused, true);
  const files = scoreFiles(join(BENCH_ROOT, "results"));
  same(
    "labels: no committed score file has a model key, and each names its agent",
    files
      .map((file) => JSON.parse(readFileSync(file, "utf8")))
      .filter(
        (score) =>
          modelMentions(score, new Set()).length > 0 ||
          typeof (score.agent ?? score.agents) === "undefined",
      ).length,
    0,
  );
};
