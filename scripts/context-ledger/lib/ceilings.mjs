// Ceilings are a ratchet: each row's value on the judged checkout may not rise
// above its ceiling (or, for a higher-is-better row, fall below its floor).
// A change may lower a ceiling; raising one needs a written reason in the
// ceilings file. Timing-dependent rows carry a stated tolerance.

const exceeds = (value, entry) => {
  const tolerance = entry.tolerance ?? 0;
  return entry.better === "higher"
    ? value < entry.ceiling * (1 - tolerance)
    : value > entry.ceiling * (1 + tolerance);
};

const describe = (entry) =>
  `${entry.better === "higher" ? "floor" : "ceiling"} ${entry.ceiling.toLocaleString("en-US")} ${entry.metric}${entry.tolerance ? ` (tolerance ${entry.tolerance * 100}%)` : ""}`;

/** Compare a ledger with a ceilings file. Returns per-row results and the verdict. */
export const checkCeilings = (ledger, ceilings, { requireRealTokens }) => {
  const results = {};
  const lines = [];
  let failed = false;
  for (const row of ledger.rows) {
    const entry = ceilings.rows?.[row.id];
    if (entry === undefined || typeof entry.ceiling !== "number") continue;
    let outcome;
    if (entry.metric !== row.metric)
      outcome = {
        state: "fail",
        note: `ceiling is in ${entry.metric}, the row in ${row.metric}`,
      };
    else if (row.value === null || row.value === undefined)
      outcome =
        row.metric === "o200k" && requireRealTokens
          ? { state: "fail", note: "real tokens required but not measured" }
          : { state: "unchecked", note: row.reason ?? "no value on this run" };
    else if (exceeds(row.value, entry))
      outcome = {
        state: "fail",
        note: `${row.value.toLocaleString("en-US")} breaks the ${describe(entry)}`,
      };
    else outcome = { state: "pass", note: `within the ${describe(entry)}` };
    results[row.id] = outcome;
    if (outcome.state === "fail") failed = true;
    lines.push(`${outcome.state.toUpperCase()} ${row.id}: ${outcome.note}`);
  }
  return { failed, results, lines };
};
