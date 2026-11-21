// What an agent's run cost and what filled its context, from a transcript
// read by readTranscript(). Tokens are the provider's own counts; the context
// breakdown is in bytes of tool results, because the transcript records no
// token count per result.
import { existsSync, readFileSync } from "node:fs";
import {
  invocationsIn,
  newShellState,
  noteScript,
  splitHeredocs,
} from "./shell.mjs";

const sum = (items, pick) =>
  items.reduce((total, item) => total + pick(item), 0);

const minutesBetween = (start, end) =>
  start === null || end === null
    ? null
    : Math.round((Date.parse(end) - Date.parse(start)) / 6000) / 10;

/**
 * Cost of a run. `peak_context_tokens` is the largest prompt of any turn;
 * `prompt_tokens_all_turns` adds every turn's whole prompt, cached or not,
 * and `uncached_prompt_tokens` the part that was not read from the cache.
 */
export const costOf = (transcript) => {
  const { turns } = transcript;
  return {
    model: [...new Set(turns.map((turn) => turn.model).filter(Boolean))].join(
      ",",
    ),
    turns: turns.length,
    peak_context_tokens: Math.max(
      0,
      ...turns.map((turn) => turn.prompt_tokens),
    ),
    first_turn_prompt_tokens: turns[0]?.prompt_tokens ?? 0,
    prompt_tokens_all_turns: sum(turns, (turn) => turn.prompt_tokens),
    uncached_prompt_tokens: sum(turns, (turn) => turn.uncached_prompt_tokens),
    output_tokens: sum(turns, (turn) => turn.output_tokens),
    tool_calls: transcript.tool_calls.length,
    wall_minutes: minutesBetween(transcript.started_at, transcript.ended_at),
  };
};

/**
 * Cost with the harness floor taken off. The floor's first prompt (system
 * text, tool list, the hub's instructions) is in every turn's prompt, so it
 * comes off the peak once and off the sum once per turn.
 */
export const netOfFloor = (cost, floor) => ({
  floor_first_turn_prompt_tokens: floor.first_turn_prompt_tokens,
  peak_context_tokens: Math.max(
    0,
    cost.peak_context_tokens - floor.first_turn_prompt_tokens,
  ),
  prompt_tokens_all_turns: Math.max(
    0,
    cost.prompt_tokens_all_turns - cost.turns * floor.first_turn_prompt_tokens,
  ),
  uncached_prompt_tokens: Math.max(
    0,
    cost.uncached_prompt_tokens - floor.uncached_prompt_tokens,
  ),
  output_tokens: Math.max(0, cost.output_tokens - floor.output_tokens),
  turns: Math.max(0, cost.turns - floor.turns),
  tool_calls: Math.max(0, cost.tool_calls - floor.tool_calls),
});

const under = (path, root) => path === root || path.startsWith(`${root}/`);

const skillFile = (call, skillDir) => {
  if (skillDir === null) return null;
  const { input, name } = call;
  if (["Read", "Grep", "Glob"].includes(name)) {
    const path = input.file_path ?? input.path ?? "";
    return under(path, skillDir)
      ? path.slice(skillDir.length + 1) || "."
      : null;
  }
  if (name === "Bash" && String(input.command ?? "").includes(skillDir)) {
    const found = new RegExp(
      `${skillDir.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/([\\w./-]+)`,
      "u",
    ).exec(input.command);
    return found === null ? "." : found[1];
  }
  return null;
};

// Scripts an agent writes are remembered so that running one later counts as
// running the REA commands inside it.
const noteWrites = (call, state) => {
  if (call.name === "Write" && typeof call.input.content === "string")
    noteScript(String(call.input.file_path ?? ""), call.input.content, state);
  if (call.name !== "Bash") return;
  for (const heredoc of splitHeredocs(String(call.input.command ?? ""))
    .heredocs)
    if (heredoc.target !== null)
      noteScript(heredoc.target, heredoc.body, state);
};

const classify = (call, state, skillDir) => {
  // First, so that a command which writes a script and runs it is read right.
  noteWrites(call, state);
  const invocations =
    call.name === "Bash"
      ? invocationsIn(String(call.input.command ?? ""), state)
      : [];
  if (invocations.length > 0) return { bucket: "rea", invocations };
  const file = skillFile(call, skillDir);
  return file === null
    ? { bucket: "other", invocations }
    : { bucket: "skill", invocations, file };
};

const add = (table, key, bytes, calls = 1) => {
  table[key] ??= { calls: 0, bytes: 0 };
  table[key].calls += calls;
  table[key].bytes += bytes;
};

const describe = (call) => {
  const text =
    call.name === "Bash"
      ? String(call.input.command ?? "")
      : String(
          call.input.file_path ?? call.input.path ?? call.input.pattern ?? "",
        );
  return text.replaceAll(/\s+/gu, " ").slice(0, 160);
};

const roundTable = (table) =>
  Object.fromEntries(
    Object.entries(table)
      .map(([key, row]) => [
        key,
        { calls: row.calls, bytes: Math.round(row.bytes) },
      ])
      .sort((left, right) => right[1].bytes - left[1].bytes),
  );

/**
 * What filled the context, in bytes of tool results: results of commands
 * that ran REA (split by REA command), text read from the installed skill,
 * and everything else. A result of a command that ran several REA commands
 * is divided equally among them. `tool_input_bytes` is what the agent itself
 * wrote as tool arguments (commands, files), which stays in its context too.
 */
export const contextOf = (transcript, { skillDir = null } = {}) => {
  const state = newShellState();
  const buckets = { rea: 0, skill: 0, other: 0 };
  const calls = { rea: 0, skill: 0, other: 0 };
  const byCommand = {};
  const byFile = {};
  const classified = [];
  for (const call of transcript.tool_calls) {
    const kind = classify(call, state, skillDir);
    buckets[kind.bucket] += call.result_bytes;
    calls[kind.bucket] += 1;
    for (const invocation of kind.invocations)
      add(
        byCommand,
        invocation.key,
        call.result_bytes / kind.invocations.length,
      );
    if (kind.bucket === "skill") add(byFile, kind.file, call.result_bytes);
    classified.push({ call, ...kind });
  }
  return {
    prompt_bytes: Buffer.byteLength(transcript.prompt),
    tool_input_bytes: sum(transcript.tool_calls, (call) =>
      Buffer.byteLength(JSON.stringify(call.input)),
    ),
    tool_result_bytes: buckets.rea + buckets.skill + buckets.other,
    rea: {
      bytes: buckets.rea,
      tool_calls: calls.rea,
      by_command: roundTable(byCommand),
    },
    skill: {
      bytes: buckets.skill,
      tool_calls: calls.skill,
      by_file: roundTable(byFile),
    },
    other: { bytes: buckets.other, tool_calls: calls.other },
    largest_results: classified
      .toSorted(
        (left, right) => right.call.result_bytes - left.call.result_bytes,
      )
      .slice(0, 8)
      .map(({ call, bucket }) => ({
        bucket,
        bytes: call.result_bytes,
        tool: call.name,
        what: describe(call),
      })),
    invocations: classified.flatMap(({ call, invocations }) =>
      invocations.map((invocation) => ({
        at: call.at,
        key: invocation.key,
        command: invocation.command,
        mode: invocation.mode,
        via_script: invocation.via_script,
        text: invocation.text.slice(0, 400),
      })),
    ),
  };
};

/**
 * REA invocations the workspace's shim recorded, one per line as
 * `time<TAB>pid<TAB>command<TAB>mode`. Null when there is no log: the run
 * predates the shim, or the transcript came from elsewhere.
 */
export const readShimLog = (file) => {
  if (file === null || !existsSync(file)) return null;
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [at, pid, command, mode] = line.split("\t");
      return { at, pid: Number(pid), command, mode };
    });
};

const countBy = (items, pick) => {
  const counts = {};
  for (const item of items) counts[pick(item)] = (counts[pick(item)] ?? 0) + 1;
  return counts;
};

/**
 * How many REA commands ran. The shim's log is exact; the transcript count
 * is what the command text shows, and misses every repeat inside a loop.
 */
export const invocationCounts = (context, shimLog) => {
  const ran = (key) => (item) => item.mode === "run" && item.command === key;
  const captures = "capture-browser-scenario";
  return {
    from_transcript: {
      total: context.invocations.length,
      by_command: countBy(context.invocations, (item) => item.key),
      captures: context.invocations.filter(ran(captures)).length,
    },
    from_shim_log:
      shimLog === null
        ? null
        : {
            total: shimLog.length,
            by_command: countBy(shimLog, (item) =>
              item.mode === "run"
                ? item.command
                : `${item.command} --${item.mode}`,
            ),
            captures: shimLog.filter(ran(captures)).length,
          },
  };
};

/**
 * Everything the scorers take from a transcript's cost side: token cost (net
 * of the floor when one is given), the context breakdown and the REA
 * invocations, with `invocations` as the ordered list the context reader
 * found.
 */
export const transcriptReport = (transcript, { skillDir, shimLog, floor }) => {
  const cost = costOf(transcript);
  const { invocations, ...context } = contextOf(transcript, { skillDir });
  return {
    cost: {
      ...cost,
      net_of_floor: floor === null ? null : netOfFloor(cost, floor),
    },
    context,
    rea_invocations: invocationCounts({ invocations }, readShimLog(shimLog)),
    invocations,
  };
};
