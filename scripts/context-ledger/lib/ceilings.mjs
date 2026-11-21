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

/**
 * Ceilings from a ledger: a row's ceiling moves down to its value, never up
 * unless `raiseReason` is given, which is then recorded beside the entry.
 * Targets and other fields already in the file are kept.
 */
export const updateCeilings = (
  ledger,
  existing,
  { raiseReason, tolerance },
) => {
  const rows = { ...existing.rows };
  const refused = [];
  for (const row of ledger.rows) {
    if (typeof row.value !== "number") continue;
    const entry = rows[row.id] ?? {};
    const better = row.better ?? "lower";
    const fresh = entry.ceiling === undefined;
    const worse =
      !fresh &&
      (better === "higher"
        ? row.value < entry.ceiling
        : row.value > entry.ceiling);
    if (worse && raiseReason === undefined) {
      refused.push(
        `${row.id}: ${row.value} is worse than the ceiling ${entry.ceiling}`,
      );
      continue;
    }
    const next = {
      metric: row.metric,
      ...entry,
      ceiling:
        fresh || worse
          ? row.value
          : better === "higher"
            ? Math.max(row.value, entry.ceiling)
            : Math.min(row.value, entry.ceiling),
    };
    if (better === "higher") next.better = "higher";
    if (row.timing !== undefined) next.tolerance = entry.tolerance ?? tolerance;
    if (worse)
      next.raised = [
        ...(entry.raised ?? []),
        {
          from: entry.ceiling,
          to: row.value,
          commit: ledger.checkout.commit,
          reason: raiseReason,
        },
      ];
    rows[row.id] = next;
  }
  return {
    ceilings: {
      ...existing,
      schema: "rea.context-ledger.ceilings/1",
      measured_on: {
        ...ledger.checkout,
        node: ledger.node,
        full_census: ledger.full_census,
      },
      rows,
    },
    refused,
  };
};
