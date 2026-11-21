// Ports upstream's SKILL.md body into the fork's skill references.
//
// The fork's SKILL.md is a short router. Upstream keeps a long SKILL.md whose
// sections (above all "Route the target first") it edits often. To merge
// those edits mechanically, the fork records upstream's SKILL.md and derives
// three references from it, word for word:
//
// - references/target-routes.md: the route bullets that start a workflow,
//   and the paragraphs after the route list;
// - references/format-inspectors.md: the route bullets whose first tool is a
//   per-format inspector taking an explicit path;
// - references/working-with-rea.md: every other section of the body.
//
// Each bullet and paragraph gets a heading of its own so `rea guidance` can
// return one route. The files have no first-level title: guidance would
// treat it as the whole file and return the file for any query its sections
// cover between them. The only changes to upstream's words are the recorded
// fork corrections below, and the fork's search keywords: a `<!-- keywords: -->`
// line under a section's heading, words an agent types that the section's own
// text does not hold. A correction whose text upstream has since changed, or a
// keyword line whose section upstream has renamed, stops the port instead of
// being skipped.

/** Where the generated references live, relative to the skill directory. */
export const ROUTE_REFERENCES = Object.freeze({
  routes: "references/target-routes.md",
  formats: "references/format-inspectors.md",
  working: "references/working-with-rea.md",
});

const ROUTE_SECTION = "Route the target first";

// Tools that begin a workflow rather than answer one fact about one file,
// although their names read like inspectors.
const ROUTE_TOOLS = new Set([
  "inspect_artifact",
  "inspect_android_package",
  "inspect_managed_artifact",
  "inspect_web_page",
]);

const INSPECTOR = /^(?:inspect|decode|audit)_[a-z0-9_]+$/u;
const TOOL_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/u;

// Headings for the paragraphs that follow the route bullets, chosen by a
// phrase each paragraph contains. A new paragraph gets "Routing note".
const PARAGRAPH_HEADINGS = [
  [/IDA MCP configuration/u, "IDA provider"],
  [/REA_KUNA_COMMAND/u, "Kuna provider"],
  [/says only "my app"/u, "When the user names no target"],
  [/target-free session/u, "Target-free sessions and tool availability"],
  [/editable Ghidra analysis/u, "Editable Ghidra analysis across processes"],
  [/Ghidra startup timeout/u, "Ghidra startup timeout"],
];

/**
 * The fork's edits to upstream's text, applied before the split. `section`
 * names the upstream section; `find` must occur exactly once in it.
 */
export const FORK_CORRECTIONS = Object.freeze([
  {
    section: "Connect only when needed",
    reason: "upstream's npm package has no clone-run commands",
    find: "trusted directory outside the target project, with absolute target paths. Managed\n",
    replace:
      "trusted directory outside the target project, with absolute target paths. That\nnpm package lacks the three clone-run commands, so a clone run needs an\ninstalled `rea` from this build. Managed\n",
  },
  {
    section: ROUTE_SECTION,
    reason: "the fork's clone-run route, and a route for two versions",
    find: "explicit path or endpoint and do not need it.\n\n- ",
    replace:
      "explicit path or endpoint and do not need it.\n\n" +
      "- Asked to rebuild or clone a web application the user can run and reset\n" +
      "  locally: read [references/clone-runs.md](references/clone-runs.md) before\n" +
      "  touching the original, and take no other route here. A clone run starts\n" +
      "  with the user's authorization statement and `rea init-clone-run`, calls REA\n" +
      "  as CLI one-shots instead of a shared MCP connection, and ends only when\n" +
      "  `rea evaluate-clone-run` says so. An agent environment (AgentEnv bundle) is\n" +
      "  a served recording of an application, not a rebuild of it.\n" +
      "- Two versions of one target: for native builds, `open_binary` and\n" +
      "  `list_procedures` on each, then `match_native_functions`; for JavaScript,\n" +
      "  `analyze_javascript_application` on each, then\n" +
      "  `compare_application_versions`; for packages, `inspect_artifact` on each,\n" +
      "  then `compare_artifacts`. `guided_workflows` renders the\n" +
      "  `compare_application_versions` checklist.\n" +
      "- ",
  },
  {
    section: ROUTE_SECTION,
    reason:
      "analyze_javascript_application refuses a single file (unsupported_target)",
    find: "  starting with `inspect_artifact`. See the\n  [JavaScript applications reference]",
    replace:
      "  starting with `inspect_artifact`. A single JavaScript file is refused:\n" +
      "  use `recover_javascript_sources`, or put the file alone in a directory\n" +
      "  and analyze the directory. See the\n  [JavaScript applications reference]",
  },
  {
    section: ROUTE_SECTION,
    reason:
      "observe_web_session records navigation only; inspect_web_page records the page's requests",
    find: "- Passive traffic capture of a SPA: the default scope is the page's own origin,\n",
    replace:
      "- Passive traffic capture of a SPA (`inspect_web_page` on a target from\n" +
      "  `list_browser_targets`): the default scope is the page's own origin,\n",
  },
  {
    section: ROUTE_SECTION,
    reason:
      "the tool reads amd64 and AArch64 cores and needs caller-supplied pwntools",
    find: "- Supplied Linux x86-64 ELF core: `inspect_recorded_crash`.",
    replace:
      "- Supplied Linux ELF64 amd64 or AArch64 core: `inspect_recorded_crash`, with\n" +
      "  caller-supplied pwntools (`REA_PWNTOOLS_PYTHON`).",
  },
  {
    section: ROUTE_SECTION,
    reason: "the CLI has no open_binary; its native commands take the path",
    find: "  availability and leaves target support unknown.\n",
    replace:
      "  availability and leaves target support unknown. On the CLI,\n" +
      "  `rea search`, `rea function` and `rea decompile` take the path instead.\n",
  },
  {
    section: ROUTE_SECTION,
    reason:
      "upstream names no route for an API contract file or for reading native code without a provider",
    find: "- Native executable, library, or analysis database: `open_binary`, then\n",
    replace:
      "- OpenAPI or GraphQL API contract file: `inspect_api_contract` with the\n" +
      '  file\'s path; for GraphQL SDL set `contract_format: "graphql-sdl"` (CLI\n' +
      "  `--contract-format graphql-sdl`). It reads the declared operations, paths\n" +
      "  and types offline and calls nothing.\n" +
      "- Native code or data with no analysis provider ready: `inspect_with_objdump`\n" +
      "  with operation `symbols`, or `disassemble` and `symbol` for one function.\n" +
      "  A string or constant whose address the disassembly shows is read by GDB\n" +
      "  without running the program: `rea debug-with-gdb 'x/s 0x2008' --executable\n" +
      "  <path>`. The provider refusal lists these for its file.\n" +
      "- Native executable, library, or analysis database: `open_binary`, then\n",
  },
  {
    section: "Read only the relevant guide",
    reason:
      "version comparison is not only JavaScript; the fork's clone-run guide",
    find: "- ASARs, extracted JavaScript, feature tracing, and version comparison:\n",
    replace:
      "- ASARs, extracted JavaScript, feature tracing, and JavaScript version\n  comparison:\n",
  },
  {
    section: "Read only the relevant guide",
    reason: "the fork's clone-run guide",
    find: "  computers: [references/desktop-build.md](references/desktop-build.md)\n",
    replace:
      "  computers: [references/desktop-build.md](references/desktop-build.md)\n" +
      "- Rebuilding (cloning) a web application: the run folder, the seven role\n" +
      "  cards for one agent or a team, and the referee that decides parity:\n" +
      "  [references/clone-runs.md](references/clone-runs.md)\n",
  },
  {
    section: "Finish the task",
    reason: "only the clone run's referee finishes a rebuild",
    find: "Explain findings in plain language and tie them to returned evidence. When the\nuser asks to build something, use normal coding tools and separate observed\nbehavior from design choices. Close",
    replace:
      "Explain findings in plain language and tie them to returned evidence. A\nrebuild of a web application is finished only by the referee of its\n[clone run](references/clone-runs.md), never by an agent's own statement. For\nany other build, use normal coding tools, separate observed behavior from\ndesign choices, and say that no REA verdict backs the result. Close",
  },
]);

/**
 * Search keywords the fork adds to a generated section, one line under its
 * heading. `section` is the route's lead phrase (the heading without its
 * tool), a paragraph's recorded heading, or an upstream section's heading.
 * Each names words agents typed into `rea guidance` that the section answers
 * but does not spell.
 */
export const FORK_KEYWORDS = Object.freeze([
  {
    section:
      "Asked to rebuild or clone a web application the user can run and reset locally",
    reason:
      "the short first landing for a rebuild; clone-runs.md is loaded whole, so its words stay out of it",
    keywords:
      "rebuild a website, copy, replicate, check it matches the original",
  },
  {
    section: "Native executable, library, or analysis database",
    reason:
      "decompiling a function and reading a licence or key check start here",
    keywords:
      "decompile a function, licence check, license key, key validation",
  },
  {
    section: "UEFI firmware volumes and NVAR stores",
    reason: "the only route that names the firmware scanners and extractors",
    keywords:
      "firmware image, embedded firmware, Binwalk, Unblob, extract firmware",
  },
  {
    section:
      "Passive traffic capture of a SPA (`inspect_web_page` on a target from `list_browser_targets`)",
    reason: "where the API origins a page calls are captured",
    keywords: "which API endpoints a page calls, page requests",
  },
  {
    section: "DWARF compile units",
    reason: "agents ask for source files and optimisation, not DWARF",
    keywords:
      "debug information, source files, optimisation level, optimization, compiler flags",
  },
  {
    section: "OpenAPI or GraphQL API contract file",
    reason: "agents search for the format's names, not 'API contract'",
    keywords: "openapi, swagger, graphql schema, api spec, endpoints of a spec",
  },
  {
    section: "Native code or data with no analysis provider ready",
    reason:
      "agents ask to read a string literal or rodata when no provider is installed",
    keywords:
      "string literal, rodata, read data at an address, without provider, no provider",
  },
  {
    section: "Work summary-first",
    reason: "the recovery for a result that is too large or cut off",
    keywords: "result too large, truncated, cut off, oversized reply",
  },
]);

const keywordLines = () => {
  const unused = new Map(FORK_KEYWORDS.map((entry) => [entry.section, entry]));
  return {
    /** The keyword line for a section, or nothing. */
    line: (section) => {
      const entry = unused.get(section);
      if (entry === undefined) return "";
      unused.delete(section);
      return `<!-- keywords: ${entry.keywords} -->\n\n`;
    },
    check: () => {
      for (const entry of unused.values())
        fail(
          `upstream has no section "${entry.section}" for the keywords (${entry.reason}); re-derive them`,
        );
    },
  };
};

const HEADERS = {
  routes: `Target routes: the first tool for each kind of target, when the
first-step list in SKILL.md does not name one. Each route is its own section.
`,
  formats: `Format inspectors: each takes an explicit local path, needs no
\`open_binary\` or analysis provider unless its route says so, and never runs
the file. Each inspector is its own section.
`,
  working: `Working with REA: connection and setup, summary-first reading of
Evidence, larger investigations, the guide index and finishing.
`,
};

const FOOTER =
  "\n<!-- Generated by `npm run skill:routes` from upstream's SKILL.md (scripts/skill-routes/). Edit the fork corrections in scripts/lib/skill-routes.mjs, not this file. -->\n";

const fail = (message) => {
  throw new Error(`skill routes: ${message}`);
};

/** Body of a SKILL.md split into its `## ` sections, in order. */
export const skillSections = (text) => {
  const normalized = text.replaceAll("\r\n", "\n");
  const frontmatter = /^---\n[\s\S]*?\n---\n/u.exec(normalized);
  const body =
    frontmatter === null ? normalized : normalized.slice(frontmatter[0].length);
  const parts = body.split(/^(?=## )/mu);
  const preamble = parts[0] ?? "";
  const sections = parts.slice(1).map((part) => {
    const newline = part.indexOf("\n");
    return {
      heading: part.slice(3, newline).trim(),
      text: part.slice(newline + 1),
    };
  });
  return { preamble, sections };
};

const applyCorrections = (sections) => {
  const byHeading = new Map(
    sections.map((section) => [section.heading, section]),
  );
  for (const correction of FORK_CORRECTIONS) {
    const section = byHeading.get(correction.section);
    if (section === undefined)
      fail(
        `upstream has no section "${correction.section}" for the correction (${correction.reason}); re-derive it`,
      );
    const count = section.text.split(correction.find).length - 1;
    if (count !== 1)
      fail(
        `the correction "${correction.reason}" expects its text once in "${correction.section}" and found it ${count} times: upstream changed it, re-derive the correction`,
      );
    section.text = section.text.replace(correction.find, correction.replace);
  }
};

// Moved text sits in references/, so links relative to the skill root lose
// their "references/" prefix.
const relink = (text) => text.replaceAll("](references/", "](");

const collapse = (text) => text.replaceAll(/\s+/gu, " ").trim();

/** Text before the first ": " outside code spans, links and parentheses. */
const leadPhrase = (bullet) => {
  const text = bullet.replace(/^- /u, "");
  let depth = 0;
  let code = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "`") code = !code;
    else if (!code && (character === "[" || character === "(")) depth += 1;
    else if (!code && (character === "]" || character === ")"))
      depth = Math.max(0, depth - 1);
    else if (
      !code &&
      depth === 0 &&
      character === ":" &&
      /\s/u.test(text[index + 1] ?? "")
    )
      return collapse(text.slice(0, index)).replaceAll(
        /\[([^\]]*)\]\([^)]*\)/gu,
        "$1",
      );
  }
  return undefined;
};

const firstTool = (text) => {
  for (const match of text.matchAll(/`([^`]+)`/gu))
    if (TOOL_NAME.test(match[1] ?? "")) return match[1];
  return undefined;
};

/** Split the route section into intro, bullets and trailing paragraphs. */
const routeParts = (text) => {
  const blocks = [];
  let current;
  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) {
      current = { kind: "bullet", lines: [line] };
      blocks.push(current);
    } else if (line.trim() === "") {
      current = undefined;
    } else if (current?.kind === "bullet" && /^ {2}\S/u.test(line)) {
      current.lines.push(line);
    } else if (current?.kind === "paragraph") {
      current.lines.push(line);
    } else {
      current = { kind: "paragraph", lines: [line] };
      blocks.push(current);
    }
  }
  const firstBullet = blocks.findIndex((block) => block.kind === "bullet");
  if (firstBullet === -1) fail(`"${ROUTE_SECTION}" has no route bullets`);
  return {
    intro: blocks.slice(0, firstBullet),
    rest: blocks.slice(firstBullet),
  };
};

const uniqueHeading = (seen, heading) => {
  let candidate = heading;
  for (let ordinal = 2; seen.has(candidate); ordinal += 1)
    candidate = `${heading} (${ordinal})`;
  seen.add(candidate);
  return candidate;
};

/**
 * Derive the three references from upstream's SKILL.md text.
 * Returns `{ files: {path: content}, notes: string[] }`; notes name what a
 * porter should look at (paragraphs or bullets the rules could not name).
 */
export const portSkillRoutes = (upstreamSkill) => {
  const { preamble, sections } = skillSections(upstreamSkill);
  applyCorrections(sections);
  const notes = [];
  const route = sections.find((section) => section.heading === ROUTE_SECTION);
  if (route === undefined) fail(`upstream has no "${ROUTE_SECTION}" section`);
  const { intro, rest } = routeParts(route.text);
  const routeBlocks = [];
  const formatBlocks = [];
  const seen = new Set();
  const keywords = keywordLines();
  for (const block of rest) {
    const text = block.lines.join("\n");
    if (block.kind === "bullet") {
      const lead = leadPhrase(text);
      const tool = firstTool(text);
      if (lead === undefined)
        notes.push(
          `bullet without a lead phrase: ${collapse(text).slice(0, 60)}`,
        );
      const name = lead ?? collapse(text).slice(2, 60);
      const heading = uniqueHeading(
        seen,
        tool === undefined ? name : `${name}: \`${tool}\``,
      );
      const isFormat =
        tool !== undefined && INSPECTOR.test(tool) && !ROUTE_TOOLS.has(tool);
      (isFormat ? formatBlocks : routeBlocks).push(
        `## ${heading}\n\n${keywords.line(name)}${text}\n`,
      );
    } else {
      const match = PARAGRAPH_HEADINGS.find(([pattern]) => pattern.test(text));
      if (match === undefined)
        notes.push(
          `paragraph with no recorded heading: ${collapse(text).slice(0, 60)}`,
        );
      const heading = uniqueHeading(seen, match?.[1] ?? "Routing note");
      routeBlocks.push(
        `## ${heading}\n\n${keywords.line(match?.[1] ?? "")}${text}\n`,
      );
    }
  }
  const introText = intro.map((block) => block.lines.join("\n")).join("\n\n");
  const routes = `${HEADERS.routes}\n${introText}\n\n${routeBlocks.join("\n")}`;
  const formats = `${HEADERS.formats}\n${formatBlocks.join("\n")}`;
  const preambleText = preamble
    .trim()
    .replace(/^# [^\n]*\n/u, "")
    .trim();
  const working = [
    HEADERS.working,
    `## When to use REA\n\n${preambleText}\n`,
    ...sections
      .filter((section) => section.heading !== ROUTE_SECTION)
      .map(
        (section) =>
          `## ${section.heading}\n\n${keywords.line(section.heading)}${section.text.trim()}\n`,
      ),
  ].join("\n");
  keywords.check();
  const files = {
    [ROUTE_REFERENCES.routes]: relink(routes) + FOOTER,
    [ROUTE_REFERENCES.formats]: relink(formats) + FOOTER,
    [ROUTE_REFERENCES.working]: relink(working) + FOOTER,
  };
  return { files, notes };
};
