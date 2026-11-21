// The transcript reader. Everything the scorers know about what an agent did
// and what it cost comes through readTranscript(): a second driver (a
// headless command-line agent, say) needs only to produce a file this
// function can turn into the same shape. bench/README.md describes the shape.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const parseLines = (file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });

const textOf = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block?.type === "text" ? (block.text ?? "") : ""))
    .join("");
};

const promptTokens = (usage) =>
  (usage.input_tokens ?? 0) +
  (usage.cache_read_input_tokens ?? 0) +
  (usage.cache_creation_input_tokens ?? 0);

// A streamed reply is written more than once under one message id, with
// counts that only grow: the largest is the reply's.
const noteTurn = (turns, line) => {
  const { id, usage, model } = line.message;
  if (usage === undefined || id === undefined) return;
  const turn = {
    id,
    at: line.timestamp ?? null,
    model: model ?? null,
    prompt_tokens: promptTokens(usage),
    uncached_prompt_tokens:
      (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    output_tokens: usage.output_tokens ?? 0,
  };
  const earlier = turns.get(id);
  if (
    earlier === undefined ||
    turn.prompt_tokens + turn.output_tokens >=
      earlier.prompt_tokens + earlier.output_tokens
  )
    turns.set(id, { ...turn, at: earlier?.at ?? turn.at });
};

const noteBlocks = (calls, line) => {
  const content = line.message.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block.type === "tool_use" && !calls.has(block.id)) {
      calls.set(block.id, {
        id: block.id,
        name: block.name,
        input: block.input ?? {},
        at: line.timestamp ?? null,
        result_at: null,
        result_text: null,
        result_bytes: 0,
        is_error: false,
      });
    } else if (block.type === "tool_result") {
      const call = calls.get(block.tool_use_id);
      if (call === undefined) continue;
      call.result_text = textOf(block.content);
      call.result_bytes = Buffer.byteLength(call.result_text);
      call.result_at = line.timestamp ?? null;
      call.is_error = block.is_error === true;
    }
  }
};

const readMeta = (file) => {
  const meta = file.replace(/\.jsonl$/u, ".meta.json");
  if (!existsSync(meta)) return {};
  try {
    return JSON.parse(readFileSync(meta, "utf8"));
  } catch {
    return {};
  }
};

/**
 * Read one agent's transcript: JSON lines as the workflow tool writes them
 * (agent-<id>.jsonl, with agent-<id>.meta.json beside it).
 *
 * Returns `{ file, label, started_at, ended_at, prompt, turns, tool_calls,
 * final_output }`. A turn is one reply of the model with its token counts; a
 * tool call carries its input and the text of its result.
 */
export const readTranscript = (file) => {
  const turns = new Map();
  const calls = new Map();
  let prompt = null;
  let first = null;
  let last = null;
  for (const line of parseLines(file)) {
    if (line.timestamp !== undefined) {
      first ??= line.timestamp;
      last = line.timestamp;
    }
    if (line.message === undefined) continue;
    if (prompt === null && line.message.role === "user")
      prompt = textOf(line.message.content);
    if (line.message.role === "assistant") noteTurn(turns, line);
    noteBlocks(calls, line);
  }
  const toolCalls = [...calls.values()];
  const report = toolCalls.findLast((call) => call.name === "StructuredOutput");
  return {
    file,
    label: readMeta(file).description ?? basename(file, ".jsonl"),
    started_at: first,
    ended_at: last,
    prompt: prompt ?? "",
    turns: [...turns.values()],
    tool_calls: toolCalls,
    final_output: report?.input ?? null,
  };
};

/**
 * The transcript of the agent a workflow run launched under a label. `where`
 * is the run's transcript directory, or a transcript file, which is returned
 * as it is.
 */
export const findTranscript = (where, label) => {
  if (where.endsWith(".jsonl")) return where;
  const matches = readdirSync(where)
    .filter((name) => /^agent-.*\.jsonl$/u.test(name))
    .map((name) => join(where, name))
    .filter((file) => readMeta(file).description === label);
  if (matches.length === 0)
    throw new Error(`no agent labelled ${label} in ${where}`);
  if (matches.length > 1)
    throw new Error(
      `${matches.length} agents are labelled ${label} in ${dirname(matches[0])}: pass the transcript file`,
    );
  return matches[0];
};
