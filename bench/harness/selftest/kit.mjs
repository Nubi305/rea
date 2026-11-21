// Shared by the self-test's parts: recording checks, writing synthetic
// transcripts in the workflow tool's format, and running a scorer.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS = join(dirname(fileURLToPath(import.meta.url)), "..");

export const MODEL = "selftest-model";
export const results = [];

export const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  const note = ok || detail === "" ? "" : `: ${detail}`;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${note}`);
};

/** A check that passes when two values are the same JSON. */
export const same = (name, actual, expected) =>
  check(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
  );

const stamp = (seconds) =>
  new Date(Date.UTC(2026, 0, 1, 10, 0, seconds)).toISOString();

/**
 * One turn of a synthetic transcript: `tokens` is [uncached input, read from
 * cache, written to cache, output], `calls` the tool calls with their
 * results.
 */
export const turn = (tokens, calls) => ({ tokens, calls });

const assistantLine = (step, index, usage) => ({
  type: "assistant",
  timestamp: stamp(60 * (index + 1)),
  message: {
    id: `msg_${index}`,
    role: "assistant",
    model: MODEL,
    usage,
    content: step.calls.map((item, slot) => ({
      type: "tool_use",
      id: `tool_${index}_${slot}`,
      name: item.name,
      input: item.input,
    })),
  },
});

const resultLine = (step, index) => ({
  type: "user",
  timestamp: stamp(60 * (index + 1)),
  message: {
    role: "user",
    content: step.calls.map((item, slot) => ({
      type: "tool_result",
      tool_use_id: `tool_${index}_${slot}`,
      content: item.result,
    })),
  },
});

/**
 * The lines of a transcript: the prompt, then one minute per turn. Each
 * reply is written twice the way a streamed reply is, first with a smaller
 * count, which a reader must not add up.
 */
export const transcriptLines = (prompt, turns) => {
  const lines = [
    {
      type: "user",
      timestamp: stamp(0),
      message: { role: "user", content: prompt },
    },
  ];
  turns.forEach((step, index) => {
    const [fresh, cached, created, output] = step.tokens;
    const usage = {
      input_tokens: fresh,
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: created,
      output_tokens: output,
    };
    lines.push(assistantLine(step, index, { ...usage, output_tokens: 1 }));
    lines.push(assistantLine(step, index, usage));
    lines.push(resultLine(step, index));
  });
  return lines;
};

/** Write a transcript and the label file the workflow tool puts beside it. */
export const writeTranscript = (directory, name, label, lines) => {
  writeFileSync(
    join(directory, `agent-${name}.jsonl`),
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
  writeFileSync(
    join(directory, `agent-${name}.meta.json`),
    JSON.stringify({ description: label }),
  );
};

/** Run a scorer of the harness and return the JSON it prints. */
export const runScorer = (script, args) => {
  const result = spawnSync(process.execPath, [join(HARNESS, script), ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `${script} printed no JSON (exit ${result.status}): ${result.stderr.slice(0, 600)}`,
    );
  }
};
