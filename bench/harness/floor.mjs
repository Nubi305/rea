#!/usr/bin/env node
// Prints the harness floor: what the transcript of an agent that only wrote
// a trivial answer (the t00-floor cell) cost. Pass the result to
// clone-score.mjs or task-score.mjs with --floor to get numbers net of it.
//
//   node bench/harness/floor.mjs --transcript <file or run directory> [--label <label>] [--out <file>]
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { modelIdsOf, scoreText } from "./lib/agent-label.mjs";
import { costOf } from "./lib/cost.mjs";
import { writeOut } from "./lib/proc.mjs";
import { findTranscript, readTranscript } from "./lib/transcript.mjs";

const { values } = parseArgs({
  options: {
    transcript: { type: "string" },
    label: { type: "string", default: "bench:task:t00-floor" },
    out: { type: "string" },
  },
});
if (values.transcript === undefined)
  throw new Error(
    "usage: floor.mjs --transcript <file or run directory> [--label <label>] [--out <file>]",
  );

const file = findTranscript(values.transcript, values.label);
const transcript = readTranscript(file);
const floor = { transcript: file, ...costOf(transcript) };
const text = scoreText(floor, {
  modelIds: modelIdsOf([transcript]),
  paths: { [dirname(file)]: "<transcripts>" },
});
writeOut(values.out, text);
process.stdout.write(text);
