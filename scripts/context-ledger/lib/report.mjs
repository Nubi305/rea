// The readable form of ledger.json.

const number = (value) =>
  value === null || value === undefined ? "-" : value.toLocaleString("en-US");

const cell = (text) =>
  String(text).replaceAll("|", "\\|").replaceAll("\n", " ");

/** What the ledger cannot measure without a model or outside material. */
export const NOT_MEASURABLE = [
  "Token counts in Anthropic's own tokenizer: none exists offline; o200k is the proxy and tokenx is REA's estimate (off by +23% to -39% against o200k in the audit).",
  "Whether an agent succeeds, how many calls it needs, its peak context or total tokens: those are the agent benchmarks (J2, J3), which need a model in the loop.",
  "Which route the skill gives for a request and whether it is clear: a reading judgment. The ledger takes it from inputs/skill-routes.json, a trace recorded against one SKILL.md body; when the body changes, the routing rows say so and stay unmeasured until the trace is redone.",
  "behavior/ on the blind trial's run folder (the plan's 2.28 MB): that folder is not in the repository. The ledger measures behavior/ after the fixture loop instead, a different and much smaller run.",
];

export const renderMarkdown = (ledger, verdict) => {
  const header = [
    "# Context ledger",
    "",
    `Checkout: ${ledger.checkout.path} (${ledger.checkout.package}, commit ${ledger.checkout.commit ?? "unknown"}); Node ${ledger.node}; ${ledger.elapsed_seconds} s; full census: ${ledger.full_census ? "yes" : "no"}.`,
    "",
    `Units: bytes are ${ledger.units.bytes}; tokenx is ${ledger.units.tokenx}; o200k is ${ledger.units.o200k}. These are context sizes, not agent success.`,
    "",
    "| row | what | value | unit | bytes | tokenx | o200k | status | ceiling check |",
    "| --- | --- | ---: | --- | ---: | ---: | ---: | --- | --- |",
  ];
  const body = ledger.rows.map((row) => {
    const check = verdict?.results[row.id];
    const status = [
      row.status,
      row.reason,
      row.timing === undefined ? undefined : `timing-dependent: ${row.timing}`,
      row.slow ? "full run only" : undefined,
    ]
      .filter(Boolean)
      .join("; ");
    return `| ${row.id} | ${cell(row.what)} | ${number(row.value)} | ${row.metric} | ${number(row.units?.bytes)} | ${number(row.units?.tokenx)} | ${number(row.units?.o200k)} | ${cell(status)} | ${check === undefined ? "-" : cell(`${check.state}: ${check.note}`)} |`;
  });
  const notes = ledger.rows
    .filter((row) => row.detail?.note !== undefined)
    .map((row) => `- ${row.id}: ${row.detail.note}`);
  return [
    ...header,
    ...body,
    "",
    ...(notes.length > 0 ? ["## Notes", "", ...notes, ""] : []),
    "## Not measured by this ledger",
    "",
    ...NOT_MEASURABLE.map((line) => `- ${line}`),
    "",
  ].join("\n");
};
