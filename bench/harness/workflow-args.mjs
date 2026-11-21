#!/usr/bin/env node
// Prints the `args` value for workflows/bench-cells.js: one entry per
// prepared cell with its kind, the label its transcript will be found by and
// the prompt prepare wrote. A workflow script cannot read files; this does
// it for it.
//
//   node bench/harness/workflow-args.mjs --cell <cell.json>[=<model>]...
//   node bench/harness/workflow-args.mjs --root <task root>[=<model>]... [--task <id>]...
//        [--effort <level>] [--parallel | --one-at-a-time] [--out <file>]
//
// Both forms can be mixed. A model after "=" is passed to the workflow for
// those cells; without one the agents run on the model of the session that
// launches the workflow. Each entry also carries the cell's agent label (the
// --agent of prepare): the workflow reports it, and the scorers write it
// where a result would otherwise name the model. Without --parallel or --one-at-a-time the workflow
// runs task cells together and anything with a clone cell one at a time.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const USAGE = `usage: workflow-args.mjs --cell <cell.json>[=<model>]... | --root <task root>[=<model>]... [--task <id>]...
       [--effort <level>] [--parallel | --one-at-a-time] [--out <file>]`;

const { values } = parseArgs({
  options: {
    cell: { type: "string", multiple: true, default: [] },
    root: { type: "string", multiple: true, default: [] },
    task: { type: "string", multiple: true },
    effort: { type: "string" },
    parallel: { type: "boolean", default: false },
    "one-at-a-time": { type: "boolean", default: false },
    out: { type: "string" },
  },
});
if (values.cell.length + values.root.length === 0) throw new Error(USAGE);

// "path=model" names a model for the cells of that path.
const split = (text) => {
  const at = text.lastIndexOf("=");
  return at === -1
    ? { path: text, model: null }
    : { path: text.slice(0, at), model: text.slice(at + 1) };
};

const cellFilesUnder = (root) =>
  readdirSync(root)
    .filter((name) => name.endsWith(".cell"))
    .map((name) => join(root, name, "cell.json"))
    .filter((file) => existsSync(file))
    .sort();

const entry = (file, model) => {
  const cell = JSON.parse(readFileSync(file, "utf8"));
  if (values.task !== undefined && !values.task.includes(cell.task)) return [];
  return [
    {
      kind: cell.kind,
      label: cell.label,
      agent: cell.agent ?? "unlabelled",
      prompt: readFileSync(cell.prompt_file, "utf8"),
      ...(model === null ? {} : { model }),
      ...(values.effort === undefined ? {} : { effort: values.effort }),
    },
  ];
};

const cells = [
  ...values.cell.map(split).flatMap(({ path, model }) => entry(path, model)),
  ...values.root
    .map(split)
    .flatMap(({ path, model }) =>
      cellFilesUnder(path).flatMap((file) => entry(file, model)),
    ),
];
const labels = cells.map((cell) => cell.label);
const repeated = labels.filter(
  (label, index) => labels.indexOf(label) !== index,
);
if (repeated.length > 0)
  throw new Error(
    `labels must be unique, or transcripts cannot be told apart: ${[...new Set(repeated)].join(", ")}`,
  );

const order = values.parallel
  ? { parallel: true }
  : values["one-at-a-time"]
    ? { parallel: false }
    : {};
const text = `${JSON.stringify({ cells, ...order }, null, 1)}\n`;
if (values.out !== undefined) writeFileSync(values.out, text);
else process.stdout.write(text);
console.error(`${cells.length} cell(s): ${labels.join(", ")}`);
