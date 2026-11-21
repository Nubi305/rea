// The prompts agents under test receive. The clone prompt is the first blind
// trial's cloner prompt (2026-11-20) with the paths of the cell in it; change
// its substance and later results stop being comparable with earlier ones.
// The task prompt follows the same frame.

const list = (paths) => paths.join(", ");

const environment = ({ workspace, skillDir, browser }) => [
  `- \`rea\` is on PATH once you run: export PATH=${workspace}/bin:$PATH`,
  ...(browser === null
    ? []
    : [
        `- The browser REA uses: export REA_BROWSER_EXECUTABLE=${browser} and export REA_BROWSER_NO_SANDBOX=true`,
      ]),
  `- REA's skill is installed for you in a private home. Read it starting from ${skillDir}/SKILL.md, as an agent that had just been given this skill would, and follow where it leads.`,
];

const sourcesRule = (offLimits) =>
  `Your only sources of knowledge about REA are the installed skill files, \`rea --help\` and \`rea <command> --help\` or \`--schema\`, \`rea guidance\`, and what REA's commands print. Do NOT open anything under ${list(offLimits)} or any other copy of REA on this machine (its source, docs, tests, specs and fixtures are off limits) and do not search the machine for examples.`;

/** The prompt of a clone cell. */
export const clonePrompt = (cell) => {
  const { original, clone, workspace } = cell;
  const spare =
    cell.spare_ports === null
      ? ""
      : ` Ports ${cell.spare_ports} are yours too.`;
  return `You are an AI coding agent on a developer's machine. The developer has installed a tool called REA and has this request:

"Please clone my web app. It is running at ${original.address}. ${cell.public_description} I wrote this app and I authorise you to study it; this instance is disposable, so you may write to it. Call the clone '${clone.name}' and put its source in ${clone.root}, served on 127.0.0.1:${clone.port}. Tell me when the clone matches and how you know."

Answers the developer has already given, in case you need them:
- Who authorises: "Trial Operator". The authorisation statement, word for word: "I wrote this app and I authorise studying and reimplementing it."
- The original's product and brand names: ${JSON.stringify(cell.product_names)}.
- To control the original: \`${original.control} start|stop|reset|health\`. Reset gives a clean start. It is running right now.
- The developer is not available for further questions during this session. Where you would ask them something, make the most reasonable choice, write it down and carry on. They will not grant waivers.

## Your environment
${environment({ workspace, skillDir: cell.skill_dir, browser: cell.browser }).join("\n")}
- Work under ${workspace}: the run folder is ${cell.run_dir}, the clone's source goes in ${clone.root}, and notes go anywhere else under it. Port ${clone.port} on 127.0.0.1 is yours.${spare} The machine has 4 CPUs and another agent is busy: one capture at a time, an outer \`timeout\` on every capture, and stop every server and browser you started before you finish.

## The rules of this trial
This is a test of whether REA's guidance is enough for an agent that knows nothing else. So:
1. ${sourcesRule(cell.off_limits)}
2. Do NOT read anything under ${cell.cell_dir}; run the control script there and nothing else. You learn about the original only by talking to it at its address, the way the skill tells you to.
3. Follow the guidance as written, even where you would have done it differently. Where it is silent, wrong or unclear, note the moment (what you expected, what you got, the exact message, what it cost you) and then use your judgment.
4. Do not fake anything. If you cannot get the referee to say done, stop and report that honestly; that is a useful result. Stop after about ${cell.minutes} minutes of work, or when the referee reports done or stalled, whichever comes first.

Your report is read by the people improving REA, not by the developer. Be exact and unsparing about every friction, in order. Leave the run folder and the clone source in place. Leave your clone stopped and the original stopped.
`;
};

const answerFields = (fields) =>
  Object.entries(fields)
    .map(([name, meaning]) => `- \`${name}\`: ${meaning}`)
    .join("\n");

/** The prompt of a task cell. */
export const taskPrompt = (cell) => {
  const { workspace } = cell;
  const inputs =
    cell.input_files.length === 0
      ? ""
      : `\n- The files the request is about are in ${cell.input_dir}. Treat them as the developer's: do not change them.`;
  return `You are an AI coding agent on a developer's machine. The developer has installed a tool called REA and has this request:

"${cell.question}"

The developer is not available for questions during this session. Where you would ask them something, make the most reasonable choice and carry on.

## Your environment
${environment({ workspace, skillDir: cell.skill_dir, browser: cell.browser }).join("\n")}${inputs}
- Work under ${workspace}; write nothing outside it. Put an outer \`timeout\` on anything that can hang, and stop every server and browser you started before you finish.

## The rules of this trial
This is a test of whether REA and its guidance are enough for an agent that knows nothing else. So:
1. ${sourcesRule(cell.off_limits)}
2. Answer with REA. Other tools are for running REA and for reading what REA wrote: do not get the answer by opening the files or the address with anything else (no cat, strings, hex dump, unzip, sqlite3, curl, interpreter or debugger of your own on them). Where REA cannot tell you part of the answer, leave that part out; do not fill it in another way.
3. Do not fake anything. A field you could not establish is left out of the answer, not guessed. Stop after about ${cell.minutes} minutes of work.

## Your answer
Write your answer as one JSON object to ${cell.answer_file}, with these fields and nothing else:
${answerFields(cell.answer_fields)}

Then report briefly: the REA commands that gave you the answer, and every place REA or its guidance cost you time.
`;
};
