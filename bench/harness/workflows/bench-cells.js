export const meta = {
  name: "rea-bench-cells",
  description:
    "REA agent benchmarks: one fresh agent per prepared cell, with the installed REA skill and CLI only. A clone cell clones an application it has never seen; a task cell answers one reverse-engineering question",
  phases: [
    {
      title: "Clone",
      detail:
        "one agent per clone cell, each with the prompt clone-prepare.mjs wrote for it",
    },
    {
      title: "Tasks",
      detail:
        "one agent per task cell, each with the prompt task-prepare.mjs wrote for it",
    },
  ],
};

// args: { cells: [{ kind, label, prompt, model?, effort? }], parallel? }
// Build it with bench/harness/workflow-args.mjs. The label is how the scorers
// find an agent's transcript: keep it as given.

const FRICTIONS = {
  type: "array",
  description:
    "every place you lost time, guessed, or were told something wrong or nothing, in the order it happened",
  items: {
    type: "object",
    properties: {
      where: {
        type: "string",
        description: "the command, file or guidance section",
      },
      what_happened: {
        type: "string",
        description: "what you expected, what you got, with the exact message",
      },
      cost: { type: "string", description: "turns or minutes lost" },
      kind: {
        type: "string",
        enum: [
          "playbook-missing",
          "playbook-wrong",
          "tool-message",
          "tool-defect",
          "schema",
          "environment",
          "own-mistake",
        ],
      },
      suggestion: { type: "string" },
    },
    required: ["where", "what_happened", "cost", "kind", "suggestion"],
  },
};

// The report of the first blind trial's cloner, field for field.
const CLONE_REPORT = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "five to ten sentences: how it went",
    },
    outcome: {
      type: "string",
      enum: ["done", "done_with_waivers", "not_done", "stalled", "gave_up"],
    },
    final_exit_code: {
      type: "string",
      description: "exit status of your last evaluate-clone-run --exit-code",
    },
    run_folder: { type: "string" },
    clone_root: { type: "string" },
    clone_address: { type: "string" },
    clone_start_command: {
      type: "string",
      description: "how to start and reset your clone",
    },
    referee_rounds: {
      type: "string",
      description: "how many evaluations you ran",
    },
    effort: {
      type: "string",
      description: "rough count of commands, captures and minutes",
    },
    route: {
      type: "string",
      description:
        "how you found the playbook from the installed skill, step by step, and where you nearly went wrong",
    },
    frictions: FRICTIONS,
    worked_well: { type: "array", items: { type: "string" } },
    rules_found: {
      type: "array",
      items: { type: "string" },
      description:
        "the business rules you believe the original has, one line each",
    },
    unproven: {
      type: "array",
      items: { type: "string" },
      description:
        "what your clone may still get wrong, and what you did not probe",
    },
  },
  required: [
    "summary",
    "outcome",
    "final_exit_code",
    "run_folder",
    "clone_root",
    "clone_address",
    "clone_start_command",
    "referee_rounds",
    "effort",
    "route",
    "frictions",
    "worked_well",
    "rules_found",
    "unproven",
  ],
};

const TASK_REPORT = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "two or three sentences: what you answered and how sure you are",
    },
    answer_file: { type: "string", description: "the answer file you wrote" },
    commands: {
      type: "array",
      items: { type: "string" },
      description: "the REA commands that gave you the answer, in order",
    },
    left_out: {
      type: "array",
      items: { type: "string" },
      description: "answer fields you left out, each with why",
    },
    frictions: FRICTIONS,
  },
  required: ["summary", "answer_file", "commands", "left_out", "frictions"],
};

const KINDS = {
  clone: { phase: "Clone", schema: CLONE_REPORT },
  task: { phase: "Tasks", schema: TASK_REPORT },
};

const cells = args && Array.isArray(args.cells) ? args.cells : [];
if (cells.length === 0)
  throw new Error("args.cells is empty: pass what workflow-args.mjs printed");
for (const cell of cells) {
  if (typeof cell.label !== "string" || typeof cell.prompt !== "string")
    throw new Error("every cell needs a label and a prompt");
  if (!KINDS[cell.kind])
    throw new Error(`${cell.label}: kind must be clone or task`);
}

const run = (cell) => {
  const options = {
    label: cell.label,
    phase: KINDS[cell.kind].phase,
    schema: KINDS[cell.kind].schema,
  };
  if (cell.model) options.model = cell.model;
  if (cell.effort) options.effort = cell.effort;
  return agent(cell.prompt, options);
};

// A clone run starts servers and a browser: clone cells run one at a time
// unless args.parallel says otherwise. Task cells are light and run together.
const together =
  args.parallel === undefined
    ? cells.every((cell) => cell.kind === "task")
    : args.parallel === true;

let reports;
if (together) {
  reports = await parallel(cells.map((cell) => () => run(cell)));
} else {
  reports = [];
  for (const cell of cells) {
    log(`starting ${cell.label}`);
    reports.push(await run(cell));
  }
}

const silent = cells
  .filter((cell, index) => !reports[index])
  .map((cell) => cell.label);
if (silent.length > 0) log(`no report from: ${silent.join(", ")}`);

return cells.map((cell, index) => ({
  label: cell.label,
  kind: cell.kind,
  model: cell.model || null,
  report: reports[index] || null,
}));
