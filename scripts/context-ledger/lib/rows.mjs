// Every row the ledger can produce: what it measures, the unit its ceiling is
// read in, which way is better, the plan row it answers and whether its value
// depends on timing. Rows are produced by the files in ../rows/.

/**
 * @typedef {object} RowDefinition
 * @property {string} what      one line: what the number is
 * @property {string} metric    the unit the ceiling is read in: o200k, tokenx, bytes, chars, count or lines
 * @property {"lower"|"higher"} [better]  default lower; a higher-is-better row's ceiling is a floor
 * @property {string} [plan]    the row of the plan's J1 table this answers
 * @property {string} [timing]  why the value may differ between two runs
 * @property {boolean} [slow]   only run with --full
 */

/** @type {Record<string, RowDefinition>} */
export const ROWS = {
  "mcp.ten-calls.default": {
    what: "Ten MCP calls of the audit's task with default arguments: total text of the results",
    metric: "o200k",
    plan: "Ten MCP calls, default arguments",
  },
  "mcp.ten-calls.summary": {
    what: "The same ten calls with detail summary asked wherever a tool takes it",
    metric: "o200k",
    plan: "Ten MCP calls, summary asked each time",
  },
  "mcp.status.default": {
    what: "binary_session with no arguments on a fresh connection, no target open",
    metric: "bytes",
    plan: "Default status call",
  },
  "mcp.bundle.default": {
    what: "get_evidence_bundle with no arguments after four small summary analyses",
    metric: "bytes",
  },
  "mcp.page.one-row": {
    what: "inspect_analysis_view page of one module row from retained Evidence",
    metric: "bytes",
  },
  "mcp.catalogue": {
    what: "tools/list result as the server sends it (every page)",
    metric: "tokenx",
  },
  "mcp.catalogue.model-visible": {
    what: "Name, description and input schema of every listed tool",
    metric: "o200k",
  },
  "mcp.instructions": {
    what: "Server instructions in the initialize result",
    metric: "o200k",
  },
  "guidance.search.mean": {
    what: "Mean `rea guidance --query` reply (default TOON) over the queries that match, of the audit's twenty",
    metric: "o200k",
    plan: "Guidance search reply",
  },
  "guidance.search.no-match": {
    what: "Of the audit's twenty guidance queries, how many match nothing",
    metric: "count",
  },
  "cli.census.largest": {
    what: "Largest successful first answer (stdout) in the quick CLI census (15 calls)",
    metric: "bytes",
    plan: "CLI census, largest first answer",
  },
  "cli.census.total": {
    what: "Total stdout of the successful first answers in the quick CLI census",
    metric: "bytes",
    plan: "CLI census, total first-answer bytes",
  },
  "cli.census.over-2000": {
    what: "Successful first answers over 2,000 o200k tokens in the quick CLI census",
    metric: "count",
  },
  "cli.census-full.largest": {
    what: "Largest successful first answer in the full in-repository CLI census",
    metric: "bytes",
    plan: "CLI census, largest first answer",
    slow: true,
  },
  "cli.census-full.total": {
    what: "Total stdout of the successful first answers in the full in-repository CLI census",
    metric: "bytes",
    plan: "CLI census, total first-answer bytes",
    slow: true,
  },
  "cli.census-full.over-2000": {
    what: "Successful first answers over 2,000 o200k tokens in the full in-repository CLI census",
    metric: "count",
    slow: true,
  },
  "cli.mistakes.largest": {
    what: "Largest stdout among the typical CLI mistakes",
    metric: "bytes",
    plan: "Largest error",
  },
  "cli.help": {
    what: "`rea --help`",
    metric: "bytes",
    plan: "`rea --help`",
  },
  "cli.help.command": {
    what: "`rea inspect-artifact --help`, one command's help",
    metric: "bytes",
  },
  "cli.setup.one-client": {
    what: "`rea setup --dry-run --yes --json --client claude_code` in a throwaway home",
    metric: "o200k",
    plan: "Setup output for one client",
  },
  "cli.progress.stderr": {
    what: "Standard error of a successful `rea analyze-javascript-application <5-file app> --detail summary --evidence_output <file> --json`",
    metric: "bytes",
  },
  "skill.body": {
    what: "SKILL.md body (frontmatter removed), the part loaded whenever the skill triggers",
    metric: "o200k",
    plan: "Skill body",
  },
  "skill.lines-lost-at-carry-over": {
    what: "Body lines after the point where a 5,000-token carry-over (o200k) cuts; 0 when the whole body survives",
    metric: "lines",
  },
  "skill.loaded-per-request": {
    what: "Mean tokens a client loads per request over the fifteen traced requests: body plus each whole reference the route names",
    metric: "o200k",
    plan: "Skill loaded per request (15 requests)",
  },
  "skill.routes-clear": {
    what: "Of the fifteen traced requests, how many the skill routes clearly (from the trace file)",
    metric: "count",
    better: "higher",
    plan: "Routes clear on the 15 requests",
  },
  "clone.loop.stdout": {
    what: "Standard output of one scenario's clone-run loop on the fixture pair: init, every evaluation, every printed capture command",
    metric: "o200k",
    plan: "Clone loop stdout per scenario",
    timing:
      "the browser's captures vary by a few bytes, and a reply body lost in a capture adds a round",
  },
  "clone.verdict.ten-items": {
    what: "`rea evaluate-clone-run --exit-code --json` stdout for a run with a ten-item worklist",
    metric: "chars",
    plan: "Ten-item verdict",
    timing: "depends on the captures taken before it",
  },
  "clone.behavior": {
    what: "Size of behavior/ after the fixture loop (one scenario)",
    metric: "bytes",
    plan: "behavior/ on the trial replay",
    timing: "written from the captures",
  },
  "clone.step-read": {
    what: "The playbook's read-one-step command (text of step 1) on a capture from the loop",
    metric: "o200k",
    plan: "One step read",
    timing: "reads one capture",
  },
};

export const rowDefinition = (id) => {
  const definition = ROWS[id];
  if (definition === undefined) throw new Error(`unknown row ${id}`);
  return definition;
};

/** A row with a value. `units` holds bytes, tokenx and o200k where they apply. */
export const measuredRow = (id, { units, value, detail } = {}) => {
  const definition = rowDefinition(id);
  const primary =
    value ??
    (units === undefined
      ? undefined
      : definition.metric === "chars"
        ? units.chars
        : units[definition.metric]);
  return {
    id,
    status: primary === null ? "partial" : "measured",
    value: primary ?? null,
    units: units ?? null,
    detail: detail ?? null,
  };
};

/** A row that could not be measured on this run, with the reason. */
export const skippedRow = (id, reason) => {
  rowDefinition(id);
  return { id, status: "not-measured", value: null, units: null, reason };
};
