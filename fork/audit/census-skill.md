# census-skill

## Summary

The description that is always in an agent's context is cheap: 572 characters, 109 tokens. The body that loads whenever the skill triggers is not: 680 lines and 10,840 tokens (o200k count; 12,510 by REA's own estimator), against the 500 lines and 5,000 tokens that the Agent Skills specification and Anthropic's guidance recommend. Three quarters of it (8,161 tokens) is one list of 58 target routes, and its first 500 tokens hold no route and no rule about context, only connection repair. Claude Code documents that after compaction it keeps the first 5,000 tokens of an invoked skill; for REA that cut falls near line 307 of 686 and silently drops the route for an ordinary native binary, the summary-first rule, the index of guides and the finish rules. In a traced routing test of fifteen realistic requests, a top-down reader needs on average 284 lines and 4,486 tokens to reach the first correct command, and a client loads 14,080 tokens on average; seven routes are clear, three are found only after line 450, three are ambiguous and two are wrong. The costliest wrong step is real: the call the skill names for an Electron app returned 112,519 tokens for a three-file, 1.4 KB app, against 2,705 with detail summary, and the skill's only literal command line omits that option. Of thirty statements sampled with a fixed seed, 8 are judgment the tools cannot give, 17 repeat what the tool's own description or message already prints, 3 are tool facts printed nowhere an agent sees and 2 are bare links; none of the 8 drawn from the route section is judgment. `rea guidance` is a sound mechanism with small sections (median 344 tokens), but on twenty queries the right section came first 12 times, two natural phrasings matched nothing, 11 of 18 first matches were an entire guide, and an average search reply cost 1,748 tokens, 64% of it opaque locators. The tools already own a router the skill does not use (`inspect_artifact` returns next probes), but it covers six operations and is wrong for a core file and for a single JavaScript file. A sketched replacement, measured and accepted by both skill validators, has a 77-line, 1,175-token body whose first 500 tokens carry three context rules and the start of a 13-row first-step table; on the same fifteen requests the loaded cost falls from 14,080 to 1,757 tokens (88% less) and nothing is lost at compaction. Two points are specific to the fork: its skill differs from upstream's only by the clone-run additions, so the route list is inherited text that upstream keeps editing, and every `npx -y rea-agents@...` fallback in the skill resolves to upstream's npm package, which has no clone-run commands. Limits: tokens are o200k and tokenx, not Claude's tokenizer; the routing test is a traced reading, not live agent sessions; no native provider is installed here.

## Facts (31)

- [ran-it] The body of SKILL.md, loaded whenever the skill triggers, is 680 lines, 48,427 bytes and 10,840 tokens (o200k; 12,510 by REA's tokenx estimator). The always-loaded description is 572 characters and 109 tokens. The nine references add 3,739 lines and 53,382 tokens, so the whole skill is 64,350 tokens.
  - evidence: node /home/user/rea-design/discover/census-skill/01-measure.mjs -> 'SKILL.md body (loaded on trigger) | 48427 | 48419 | 680 | 5951 | 10840 | 12510'; 'description (always in context) | 572 | 572 | 1 | 80 | 109 | 146'; 'references total | 235774 | 235710 | 3739 | 32672 | 53382 | 59231'. Table in 01-measure.md.
- [documented] The official guidance sets the body budget at under 5,000 tokens and under 500 lines: 'Level 2: Instructions | When Skill is triggered | Under 5k tokens' and 'Keep the SKILL.md body under 500 lines for optimal performance'; the open specification says 'Instructions (< 5000 tokens recommended)' and 'Keep your main SKILL.md under 500 lines. Move detailed reference material to separate files.' REA's body is 2.2 times the token figure and 36% over the line figure.
  - evidence: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview (table under 'Level 3'); https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices ('Progressive disclosure patterns'); https://raw.githubusercontent.com/agentskills/agentskills/main/docs/specification.mdx ('Progressive disclosure'). Copies and line numbers: /home/user/rea-design/discover/census-skill/official-docs/SOURCES.txt.
- [documented] Claude Code keeps only the start of an invoked skill after compaction: 'When the conversation is summarized to free context, Claude Code re-attaches the most recent invocation of each skill after the summary, keeping the first 5,000 tokens of each', and advises 'put the most important instructions near the top of SKILL.md'.
  - evidence: https://code.claude.com/docs/en/skills, sections 'Skill content lifecycle' and 'Claude stops following a skill' (saved copy official-docs/claude-code-skills.md lines 617 and 1230).
- [ran-it] For REA's SKILL.md the first 5,000 tokens end at file line 307 by o200k count (line 270 by tokenx; line 243 if the client's tokenizer counts 30% more). Everything after is dropped: 21 of the 58 route bullets, including 'Native executable, library, or analysis database: open_binary' at line 473, and the whole of 'Work summary-first', 'Plan broader investigations', 'Read only the relevant guide' and 'Finish the task'. Two references (evidence-workflows.md, android-applications.md) are named only after the cut.
  - evidence: node 02-cutoff.mjs -> '| 5000 | o200k | 307 | 300 | ## Route the target first | - PE import and delay-load tables ...'; 'After a 5,000-token cut (o200k), 382 of 681 body lines are gone'; 'reference files named only after the cut: references/evidence-workflows.md, references/android-applications.md'. File 02-cutoff.md.
- [ran-it] One section, 'Route the target first' (lines 80 to 546), is 8,161 tokens, 75.3% of the body: 58 bullets (7,149 tokens, median 129, largest 266) and 7 trailing paragraphs (1,006). The first 500 tokens of the body are the scope paragraph and connection repair; the only commands they name are rea setup and rea doctor.
  - evidence: 01-measure.md: 'Route the target first | 80-546 | 467 | 35198 | 8161 | 9248 | 75.3%'; 'bullets: 58, tokens in bullets: 7149, median bullet: 129, largest: 266'. 02-cutoff.md: 'commands or tools named in the first 500 tokens: rea, rea setup, rea doctor, cleanup_incomplete'.
- [source-derived] Fifteen realistic requests traced through the skill: a top-down reader reaches the first correct command after 284 lines and 4,486 tokens on average (median 222 lines, 2,868 tokens; 5,693 tokens when the command's CLI help is also needed). A client that loads the whole body plus each whole reference the route names loads 14,080 tokens on average. Seven routes are clear (four of them with a caveat), three are found only past line 450 (native binary at 473, core file at 463, SQLite at 450), three are ambiguous (two versions, a live page, a HAR to an environment) and two are wrong (single JavaScript file; Electron default). Five of the fifteen routes sit beyond the 5,000-token point.
  - evidence: node 10-routing-test.mjs -> {mean_top_down_lines: 284, mean_top_down_tokens: 4486, mean_top_down_tokens_cli: 5693, mean_as_loaded_tokens: 14080, routes_past_5000_token_cut: [R1, R5, R7, R13, R14]}. Per-request rows and reasons in 10-routing-test.md. The paths were traced by hand from the skill text; the counts are computed from the files.
- [ran-it] The first call the skill names for an Electron or JavaScript app returns 323 KB, 112,519 tokens, for a three-file, 1.4 KB app with default arguments, over both the CLI and MCP (the MCP reply is 677 KB on the wire because text and structured content both carry it). With detail summary the same call returns 2,705 tokens (CLI: 2,781).
  - evidence: node 07-mcp-first-steps.mjs -> analyze_javascript_application {input_path}: wire_bytes 677025, text_o200k 112519; with detail summary: text_o200k 2705. node 04-run-routes.mjs -> 'rea analyze-javascript-application $IN/jsapp --json': stdout_bytes 323089, stdout_o200k 112519; with '--detail summary --evidence_output': 2781.
- [ran-it] The only literal command line in SKILL.md (line 64, 'npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json') omits --detail summary. The summary-first rule starts at line 547, after the 5,000-token point, and the same advice is repeated 11 times across SKILL.md, tool by tool. 52 of the 263 tools accept detail summary; by their own descriptions 9 default to it.
  - evidence: /home/user/rea-snap/.agents/skills/reverse-engineer-anything/SKILL.md lines 61-65, 93-100, 547-553; grep count of the three 'detail summary' spellings in SKILL.md = 11; count over the MCP tool list: 'with detail: 57 | detail offers summary: 52 | description says default summary: 9'.
- [source-derived] Thirty statements drawn with a fixed seed (10 from SKILL.md, 20 from the references in proportion to size, out of 2,065 sentences): 8 are workflow judgment the tools cannot give, 17 repeat syntax or facts that the tool's own description, help or message already prints (several word for word), 3 are facts the tool owns but prints nowhere an agent sees, and 2 are bare links to upstream web pages. Within SKILL.md 2 of 10 are judgment; within its route section 0 of 8. From the three newer guides (clone-runs, environments, desktop-build) 5 of 9 are judgment.
  - evidence: 08-sample-statements.mjs (seed 20261121) and 08b-classification.md, one row per statement with the tool text it repeats; for example statement 5 against the inspect_elf_debug_link description ('The verdict is matches, does_not_match, or cannot_verify') and statement 21 against /home/user/rea-snap/src/application/cloneRun/CloneRunEvaluation.ts:1550. Summary: {all: J 8, T 17, F 3, L 2}. One rater.
- [ran-it] Across all 58 route bullets, a median 49% of a bullet's content words also occur in the description and schema of the tools it names (token-weighted mean 51%; 25 bullets at 50% or more). 43% of the route section (3,487 tokens) is sentences of eight repeated kinds, among them 40 link sentences to upstream web pages (1,289 tokens), 25 'Preserve ...' lists (750), 16 'absence is not proof' sentences (314) and 21 'requires no ...' sentences (290).
  - evidence: node 09-route-overlap.mjs -> 'median 49%, lower quartile 40%, upper quartile 59%, token-weighted mean 51%'; node 11-patterns.mjs -> 'sentences matching at least one pattern: 138 of 315 (3487 tokens, 43% of the route list)'.
- [source-derived] The repository's own rules already ask for this: 'Add skill guidance only for workflow judgment or context that the tool cannot reasonably convey; do not use a skill as the primary repair for a discoverability or contract defect', and 'Agent tokens and context' is first in its performance order.
  - evidence: /home/user/rea-snap/AGENTS.md lines 101-103 and line 49.
- [ran-it] `rea guidance` on twenty queries an agent would type: the right section came first 12 times and was on the first page 15 times; two queries matched nothing ('rebuild website and check it matches', 'result too large truncated'); 'core dump crash' returned only the whole 16,076-token native guide and did not point at its 'Recorded Linux crashes' section; 'firmware image' ranked 'Godot PCK' first. In 11 of the 18 replies with matches the first match is an entire guide. A search reply averages 1,748 tokens, 64% of it locators (289 bytes, about 193 tokens each); reading the first match averages 3,728 tokens (maximum 16,076); search plus read averages 5,476.
  - evidence: node 05-guidance.mjs -> {first_is_right: 12, no_matches: 2, right_in_first_page_of_8: 15, mean_search_o200k_when_matches: 1748, mean_locator_share: '64%', mean_read_first_o200k: 3728, max_read_first_o200k: 16076, mean_search_plus_read_first: 5476}. Table 05-guidance.md; raw replies in raw-outputs.tar.gz. Expectations were written before running.
- [source-derived] Why guidance search behaves this way: a section is everything under a heading; every non-generic query word must appear as an exact word (no stemming, no synonyms); ties go to the shorter section; a first-level heading stands for its whole file; text before the first heading (the description) is not indexed. The 58-bullet route list is a single 8,161-token section with no subsections, so guidance cannot return one route. There are 120 indexed sections, median 344 tokens; 15 exceed 2,000 and 6 exceed 5,000. A locator is base64 of a JSON object holding two full SHA-256 digests.
  - evidence: /home/user/rea-snap/src/application/GuidanceAccess.ts lines 130-132 (word split), 134-184 (generic words), 186-198 (locator), 421-488 (ranking; shorter-section tie-break at 483); /home/user/rea-snap/src/application/GuidanceSections.ts lines 113-150. node 06-sections.mjs -> 'indexed sections: 120 ... median 344, p75 749, p90 2673, max 15239'.
- [ran-it] A router already exists in the tools and the skill does not use it: `inspect_artifact` returns `next_probes`. Its table names six follow-up operations. Run here, it sent an ELF core file to open_binary (not inspect_recorded_crash), returned no probe for an APK, refused a SQLite file and a HAR as 'unsupported binary format', and for a single minified .js file named analyze_javascript_application, which then refused the same file with unsupported_target.
  - evidence: 'rea inspect-artifact <path> --json' on seven inputs (raw-probes in raw-outputs.tar.gz): core -> next_probes [{operation: open_binary}]; fake.apk -> []; app.db and site.har -> target_unavailable 'Cannot open artifact: unsupported binary format'; bundle.min.js -> [{operation: analyze_javascript_application}]; then 'rea analyze-javascript-application bundle.min.js' -> unsupported_target 'accepts only a directory or an .asar file'. The table: /home/user/rea-snap/src/domain/artifactInspection.ts lines 341-546.
- [ran-it] Route statements that are wrong, stale or missing today: (a) the only JavaScript bullet sends a single bundle file to a tool that refuses it, and recover_javascript_sources and analyze_web_bundle are not named in SKILL.md at all; (b) the crash bullet and the native guide say 'Linux x86-64 ELF core' while the tool accepts amd64 and AArch64, and neither says the tool needs caller-supplied pwntools; (c) the description promises 'compare versions' but no route covers two versions, and the guide index files 'version comparison' under the JavaScript guide while the native recipe is the unlabelled first paragraph of native-and-artifacts.md; (d) the 146-token bullet 'Passive traffic capture of a SPA' names no capture tool; (e) 13 of the 50 path-taking inspect tools are not named in SKILL.md, for example inspect_uefi_firmware, inspect_devicetree, inspect_byte_entropy and inspect_dart_aot.
  - evidence: SKILL.md lines 93-100, 143-151, 463-467, 655; references/native-and-artifacts.md lines 3-17 and 420; 'rea inspect-recorded-crash --help' -> 'Local Linux ELF64 amd64 or AArch64 little-endian core'; running it -> provider_unavailable 'Set REA_PWNTOOLS_PYTHON ...'; tool-name comparison over the MCP list -> 'path inspectors not named in SKILL.md: inspect_devicetree, inspect_byte_entropy, ...' (13 names).
- [ran-it] With no analysis provider installed, the native route dead-ends: `rea analyze <elf>` returns provider_unavailable (838 tokens) and points to `rea doctor` (2,150 tokens); neither names the inspectors that still work on that file, such as inspect_binary_hardening (ran: 1,401 tokens) or inspect_native_exports (1,089). The skill's instruction for availability, 'inspect binary_session with {}', costs 4,919 tokens (16,900 with detail complete).
  - evidence: 04-route-runs.md rows for 'rea analyze', 'rea doctor --json', 'rea inspect-native-exports', 'rea inspect-binary-hardening'; 07-mcp-first-steps.md rows for binary_session ({}: text_o200k 4919; detail complete: 16900).
- [ran-it] Six guided workflows ship as MCP prompts, as the guided_workflows tool and as `rea guided-workflows` (investigate_feature, compare_application_versions, verify_reconstruction, trace_crash, audit_residual_unknowns, prepare_bounded_process_capture); a rendered one is 463 to 489 tokens. No file of the skill mentions them, and SKILL.md never mentions `rea guidance`, search_guidance or read_guidance_section; only clone-runs.md names `rea guidance` (twice).
  - evidence: 'rea guided-workflows' -> 'workflows[6]' (681 tokens); render compare_application_versions 489 tokens, trace_crash 463. grep -n -i for 'guided', 'rea guidance', 'search_guidance', 'read_guidance' over SKILL.md and the references -> only references/clone-runs.md:131 and :393.
- [ran-it] Three copies ship and cost the same. The source and the Cursor plugin copy are byte-identical (SKILL.md 49,079 bytes, 10,968 tokens). The packaged copy under skills/, which the Claude and Codex plugin manifests point to and which `rea setup` installs, adds one frontmatter line (tool_count: 263) and pins the npx version (49,095 bytes, 10,983 tokens). The nine references are identical in all three. A setup for Claude Code, Codex and Cursor writes two copies of the skill, to ~/.agents/skills and ~/.claude/skills, each 284,869 bytes.
  - evidence: 01-measure.md 'Shipped copies' (SKILL.md digests cc379556519d twice and a8f2001afc49; references digest 08a714907d74 three times); diff of the copies; 'HOME=<throwaway> rea setup --yes --json --client claude_code --client codex --client cursor' then 'diff -rq' of each installed copy against /home/user/rea-snap/skills/reverse-engineer-anything -> no difference.
- [ran-it] The frontmatter is valid. The open specification's reference validator and Claude Code's validator both accept the skill; neither checks body length.
  - evidence: 'agentskills validate <skill directory>' (skills-ref 0.1.1) -> 'Valid skill' for the packaged and the source copy; 'claude plugin validate --strict <copy>/skills' (Claude Code 2.1.330) -> 'Validation passed'.
- [ran-it] Eight of the nine references are longer than 100 lines and none starts with a contents list. Two are very large: native-and-artifacts.md (1,048 lines, 15,239 tokens, 47 second-level sections) and desktop-build.md (860 lines, 13,230 tokens, first command at line 337). Four references link to sibling references. SKILL.md carries 41 links and the references 63 links to pages on github.com/morluto/rea, and docs/ is not in the npm package's file list, so those pages are a second level that is off the machine and outside `rea guidance`. The rules: 'Keep references one level deep from SKILL.md' and 'For reference files longer than 100 lines, include a table of contents at the top'.
  - evidence: 01-measure.md (layer table; 'Links out of SKILL.md': 41 web links, 39 upstream docs pages totalling 594,159 bytes; 'Links between reference files'); node check of /home/user/rea-snap/package.json 'files' -> 'any docs entry: false'; https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices ('Avoid deeply nested references'; 'Structure longer reference files with a table of contents').
- [ran-it] A sketched SKILL.md (a design file, not a change to the repository) has a 77-line, 1,175-token body: scope and three context rules in the first 191 tokens, a 13-row first-step table of 573 tokens, then refusal, evidence, investigation and finish rules. Its first 500 tokens end inside the table after six rows. Every tool it names exists in the connected catalogue, and both validators accept it. A machine-drafted index of 50 path inspectors is 1,084 tokens. Re-running the fifteen requests against it, the route row is found by body line 35 at the latest, and the loaded cost averages 1,757 tokens against 14,080 today (12,323 fewer, 88%).
  - evidence: node 12-sketch.mjs -> 'SKILL.md body | 680 | 10840 | 12510 | 77 | 1175 | 1421'; {mean_today_as_loaded: 14080, mean_sketch_as_loaded: 1757, saving_share: '88%', max_sketch_row_line: 35}; 'names not in the connected catalog: none'. Validators pass on the sketch. Files: sketch/SKILL.md, sketch/references/format-inspectors.md, 12-sketch.md.
- [ran-it] Re-serializing the same twenty real guidance replies with an 11-token locator of the form guide#ordinal@bundle-prefix brings the mean search reply from 1,748 to 697 tokens; with a limit of three matches as well, to 511. A contents list of all 120 headings is 709 tokens.
  - evidence: node 16-guidance-whatif.mjs -> {mean_today: 1748, mean_short_locators: 697, mean_limit3_short_locators: 511, one_short_locator_tokens: 11, one_locator_today_tokens: 193}; heading list sized from 06-sections.json: 709 tokens.
- [ran-it] The fork's skill differs from upstream's current one only by the clone-run additions: SKILL.md gains one route bullet, one index bullet, the finish sentence and a description clause, and clone-runs.md is new; the other eight references are byte-identical to upstream main. Upstream's SKILL.md (metadata version 63; the fork's is 65) has meanwhile changed two route statements the fork does not have (UEFI firmware, IDA databases). Upstream cut 40 releases between 2026-07-12 and 2026-11-11.
  - evidence: curl of https://raw.githubusercontent.com/morluto/rea/main/.agents/skills/reverse-engineer-anything/SKILL.md (48,345 bytes, 678 lines) and of each reference, diffed against the snapshot: six hunks in SKILL.md, 'same' for eight references, 404 for references/clone-runs.md. grep -c '^## [' /home/user/rea-snap/CHANGELOG.md = 40.
- [ran-it] Every npm route in the fork's skill and manifests resolves to upstream's package: SKILL.md lines 64 and 72 ('npx -y rea-agents@latest', pinned to 6.9.0 in the packaged copy), mcp.json, server.json and the plugin marketplace entries. rea-agents@6.9.0 on the public registry is upstream's (189 MB unpacked; latest is 6.10.1), and upstream main has no clone-run guide, so an agent that falls back to npx gets a tool without init-clone-run. That upstream 6.9.0 lacks the commands was inferred, not run.
  - evidence: 'npm view rea-agents@6.9.0 version dist.unpackedSize repository.url --json' -> 6.9.0, 189641205, git+https://github.com/morluto/rea.git; 'npm view rea-agents dist-tags --json' -> latest 6.10.1; /home/user/rea-snap/mcp.json, server.json, .claude-plugin/marketplace.json.
- [ran-it] The skill speaks in MCP tool names, and for native work they do not map to CLI commands: 172 of 263 tools have a same-named command, 91 do not (open_binary has none; analyze_function is `rea function`; procedure_pseudo_code is `rea decompile`), and none of analyze, function, decompile, search or trace is named in SKILL.md. A CLI agent has to read `rea --help` (5,232 tokens) to translate. On the CLI the scenario shape for capture-process is in neither --help nor --schema (413 bytes); only a validation error lists the fields.
  - evidence: Name comparison over the MCP list and 'rea --help' -> 'MCP tools: 263 | CLI commands: 207 | same name with hyphens: 172'; grep of 'rea <command>' forms in SKILL.md -> audit-release-exposure, doctor, evaluate-clone-run, init-clone-run, inspect-evidence-bundle, setup; 'rea capture-process --schema' 413 bytes; running it with a guessed scenario -> invalid_request listing the fields.
- [ran-it] The clone-run referee's output does not point back to the guidance. Neither `rea init-clone-run` nor `rea evaluate-clone-run` mentions the playbook, a role card or `rea guidance`, so a session that resumes from the run folder gets its state but not its instructions. The first worklist item after init is for the prober, while the playbook says to scout and map first ('Do those first anyway').
  - evidence: Outputs of the two commands on a fresh run folder (04-run-routes.mjs; raw-routes/08 and 09 in raw-outputs.tar.gz): next[0] = {role: 'prober', reason: 'no_scenarios'}; a search of both replies for 'guidance', 'clone-runs.md' and 'SKILL' finds nothing. references/clone-runs.md lines 65-67.
- [ran-it] The selectors for inspect_analysis_view are not discoverable where an agent looks: the MCP input schema is 142 bytes (a compact profile), `rea inspect-analysis-view --help` describes only 'Inline workflow JSON or JSON file path', the full CLI schema is 134 KB (33,079 tokens), and a summary reply lists no available views. About 2,200 tokens of the skill (78 sentences) are view-selector recipes that fill this gap.
  - evidence: MCP tool list: inspect_analysis_view inputSchema 142 bytes; 'rea inspect-analysis-view --schema --json' -> 134,270 bytes; keys of the summary reply in raw-mcp/02 (no view list); node 13-view-recipes.mjs -> 'TOTAL | 64222 | 78 | 2206 | 3%'.
- [ran-it] Besides the description, an MCP client always carries the server instructions (2,604 bytes, 488 tokens). The first output a fresh agent reads, from `rea setup --json` for one client, is 34 to 36 KB (11,207 to 11,806 tokens), 81% of it the state of 43 clients it did not ask about, with no pointer to the skill.
  - evidence: node 03-catalog.mjs -> 'instructions: 2604 bytes, 488 o200k tokens'; setup-dry-claude.json 34,011 bytes (11,207 tokens); setup-apply-3.json 36,475 bytes (11,806 tokens), of which clientStates 29,640 bytes. Both in raw-outputs.tar.gz.
- [ran-it] The description covers 17 of 32 words an owner is likely to use (it lacks binary, executable, library, APK, Android, bundle and crash, among others) and spends 47% of its characters on the clone-run and agent-environment clauses. This is a word check, not a trigger test.
  - evidence: node 14-description.mjs -> 'today: 572 chars, 109 tokens, 17/32 terms'; 'characters of today's description spent on the clone-run and agent-environment clauses: 270 of 572 (47%)'.
- [source-derived] A model evaluation harness with a first-tool expectation and token accounting already exists, with two routing scenarios (missing target; native provider). A conformance test already asserts that the clone route is the first route of the skill.
  - evidence: /home/user/rea-snap/tests/evaluation/model-evals/AgentEvaluationScenarios.ts lines 14 and 59 (expectedFirstTool); CodexAgentEval.ts lines 121-136 (input, cached and output tokens); scripts/verify-agent-experience.mjs; tests/conformance/cloneRunGuidance.test.ts line 290. Not run.
- [documented] In Claude Code a plugin skill and a personal skill of the same name both load ('Both load, because plugin skills are namespaced as /plugin-name:skill-name'). REA's plugin and `rea setup --client claude_code` each install the skill, and SKILL.md says the plugin is outside what setup and doctor manage. Whether REA notices the pair was not tested.
  - evidence: https://code.claude.com/docs/en/skills, 'Resolve skills that share a name'; SKILL.md lines 20-22.

## Already good (12)

- The description meets the rules: 572 of 1,024 allowed characters, about 109 tokens against the 'about 100' guideline, and it says what, when and when not ('Skip REA for ordinary source-repository architecture analysis'). It lives at /home/user/rea-snap/.agents/skills/reverse-engineer-anything/SKILL.md line 3. Both skill validators accept the skill.
- One authored source and generated copies: .agents/skills/reverse-engineer-anything/ is the only edited copy; skills/ and .cursor-plugin/skills/ are generated (scripts/generate-skill-metadata.mjs, scripts/generate-cursor-plugin-skill.mjs), the references are identical in all three, and MANAGED_SKILL_FILES in src/application/SetupSkill.ts is one list used by setup, uninstall and guidance.
- Section-level disclosure exists on both surfaces: `rea guidance` and the MCP tools search_guidance and read_guidance_section (src/application/GuidanceAccess.ts). It needs no target or provider, detects stale locators, and indexes 120 sections with a median of 344 tokens. When a query hits a section, the read is cheap: 723 to 1,174 tokens in the test.
- references/clone-runs.md is the model to copy: each role card sits under its own heading at 338 to 859 tokens, 'Rules for every role' is 555 tokens, the text is mostly judgment, and tests/conformance/cloneRunGuidance.test.ts ties every command, flag and reason code it names to the code.
- Tool messages already carry the fix, which is what lets recovery prose leave the skill: the referee's worklist items name the role, the file, the fix and the exact command (src/application/cloneRun/CloneRunEvaluation.ts); provider_unavailable names the variable to set; the JADX refusal gives the download address; invalid_request lists each field.
- Six guided workflows of 463 to 489 tokens each (MCP prompts, the guided_workflows tool, `rea guided-workflows`) are task checklists made of judgment, not syntax.
- Summary-first machinery exists on 52 tools (detail summary, a retained parent record, inspect_analysis_view), and analyze_function already defaults to the summary over MCP.
- Tools already give next-step hints: inspect_artifact returns next_probes (src/domain/artifactInspection.ts), including real judgment such as 'check managed metadata before choosing a native provider' for a PE file, and inspect_binary_hardening names inspect_signature.
- Tool descriptions state their own limits (what is not verified, what absence means). That is why 17 of 30 sampled skill statements are repeats and can go without loss.
- The repository's rules already demand what this lens recommends (AGENTS.md line 49 and lines 101-103), and a model evaluation harness with expectedFirstTool and token counts exists (tests/evaluation/model-evals, scripts/verify-agent-experience.mjs).
- The MCP server instructions (488 tokens) carry the recovery rules and the rule that target content is data, not instructions, for every MCP client, with or without the skill.
- The three newer guides (clone-runs, environments, desktop-build) are procedural and judgment-dense: 5 of the 9 statements sampled from them are judgment, against 0 of 8 from the route section of SKILL.md.

## Opportunities (12)

### Put the context rules and a first-step table in the first 500 tokens, and move the 58-bullet route list out of the body

- problem: Every triggered session loads 10,840 tokens, 75% of them a route list in which the answer for a given request is one bullet. The first 500 tokens hold no route; the route for a native binary is at line 473. After compaction Claude Code keeps the first 5,000 tokens, which drops 21 route bullets and four whole sections. On fifteen test requests the first correct command is 284 lines down on average and 14,080 tokens are loaded.
- proposal: Rewrite .agents/skills/reverse-engineer-anything/SKILL.md along /home/user/rea-design/discover/census-skill/sketch/SKILL.md: scope, three context rules, a first-step table by request giving the tool name and the CLI form, then refusal, evidence, investigation and finish rules, 1,500 tokens at most. Keep upstream's route list word for word as a reference file (for example references/target-routes.md) so upstream edits still merge and `rea guidance` still finds it. Add the new files to MANAGED_SKILL_FILES in src/application/SetupSkill.ts, regenerate skills/ and .cursor-plugin/skills, and update the route assertion at tests/conformance/cloneRunGuidance.test.ts:290.
- expected gain: Loaded tokens per triggered session fall from 14,080 to about 1,760 on average over the fifteen requests (12,300 fewer, 88%). The route is within the first 35 body lines instead of 284 on average. The whole body (1,175 tokens) survives compaction instead of losing 56% of its lines. In a 50-turn session that is about 600,000 fewer cached input tokens re-read.
- effort: medium
- risk: An agent that relied on a caveat in a route bullet no longer sees it unless it reads the tool description; the sample says most are repeats (17 of 30), and the judge must confirm it. The fork then carries a SKILL.md that differs from upstream's most-edited file (63 revisions, two statements changed since the fork point); keeping upstream's list verbatim in a reference limits conflicts to one file move. Installed copies change only when a user re-runs setup or updates the plugin.
- judge: Add the fifteen requests to the existing harness (tests/evaluation/model-evals, expectedFirstTool) and run each with the old and the new skill, three runs each: 90 short sessions that stop at the first REA call. Compare the share whose first REA call is the expected one, and the input tokens before that call. Static check in seconds: node 10-routing-test.mjs and node 12-sketch.mjs.

### State summary-first once, at the top, and fix the one literal command

- problem: The first call the skill names for an Electron or JavaScript app returns 112,519 tokens for a three-file app; the summary is 2,705. The rule sits at line 547, after the compaction cut, and the only literal command in the skill (line 64) omits it. 52 tools take detail summary and the advice is repeated 11 times, per tool.
- proposal: In SKILL.md: one rule in the first lines (when a tool has detail, pass summary; on the CLI --detail summary --evidence_output <new file>), and change line 64 to the summary form. In the tools, owned by the output lens: default to the summary over MCP wherever detail exists, as analyze_function already does.
- expected gain: 109,800 fewer tokens on the first Electron or JavaScript call (112,519 to 2,705). 237 tokens of repeated per-tool advice leave the route list.
- effort: small
- risk: None for the skill text. Changing a tool default breaks callers that expect complete inline Evidence, including the CLI and older installed skill copies that say 'Start with the default result'; limit the default change to MCP or ship it in a major version.
- judge: One call on the three-file fixture (inputs.tar.gz): the first reply must be under 3,000 tokens. Add the Electron request to the evaluation with a ceiling: fail when the first REA reply exceeds 10,000 tokens. Seconds for the fixture, three sessions for the evaluation.

### Correct the routes that are wrong or missing today

- problem: Two of fifteen test routes are wrong and three are ambiguous. The fork's npm fallback fetches upstream's package, which has no clone-run commands. Native CLI commands are named nowhere in SKILL.md, which costs a CLI agent the 5,232-token `rea --help` listing.
- proposal: Text fixes in SKILL.md and two references: (1) a single JavaScript file: name recover_javascript_sources, and say to put the file in a directory for analyze_javascript_application (verified to work); (2) a crash: 'Linux ELF64 amd64 or AArch64 core; needs caller-supplied pwntools', and name the trace_crash workflow; (3) two versions: one route line for native, JavaScript and packages, and fix the index line at 655; (4) a live page: name list_browser_targets and observe_web_session in the passive-capture bullet; (5) replace the 'npx -y rea-agents@...' fallback with the fork's own install source, or remove it; (6) one line with the CLI forms for native work (rea function, decompile, search, trace). Also fix inspect_artifact's next probe for a javascript-bundle in src/domain/artifactInspection.ts.
- expected gain: Five of fifteen routes move from wrong or ambiguous to clear. A CLI agent saves the 5,232-token help listing. The clone-run fallback stops leading to a package without the commands.
- effort: small
- risk: Low. Each added line grows the body unless the first change is done at the same time.
- judge: Re-trace the verdict column of 10-routing-test.md after the edit (minutes), and run the five requests in the evaluation harness (15 sessions).

### Make a guidance search cost 500 tokens instead of 1,750, and add a contents action

- problem: A search reply averages 1,748 tokens and 64% of it is locators of about 193 tokens each; the default returns up to 8 matches; nothing lists what guidance holds, so an agent must guess exact words. Search plus the first read averages 5,476 tokens, half the SKILL.md body.
- proposal: In src/application/GuidanceAccess.ts and src/contracts/guidanceContracts.ts: emit a short locator (guide, section ordinal, 8 hex digits of the bundle digest; 11 tokens) and keep accepting the old form; default to 3 matches; add an action that prints the guides and their headings (`rea guidance --action list`, and the same through MCP); print the bundle digest once per reply.
- expected gain: Mean search reply from 1,748 to 511 tokens (1,237 fewer per search, 71%). A contents list of all 120 headings costs 709 tokens once. A clone run with seven role-card lookups saves about 8,700 tokens.
- effort: small
- risk: Locators held in old transcripts must still resolve, so keep the old decoder. A short digest prefix weakens stale detection slightly; checking the full digest of the section on read keeps it exact.
- judge: node 05-guidance.mjs and node 16-guidance-whatif.mjs on the twenty queries: mean search reply at or under 600 tokens. Existing tests: tests/boundary/guidanceSearch.test.ts, tests/boundary/cli/guidanceCli.test.ts, tests/boundary/mcp/guidanceMcp.test.ts. Seconds.

### Let the tools route: complete and correct next probes, and name working inspectors when a provider is missing

- problem: The route knowledge is hand-written in 58 bullets (7,149 tokens) and has drifted: 13 of 50 path inspectors are missing, one statement is stale and one route is wrong. The tool-side table covers six operations and misroutes a core file and a single JavaScript file. With no provider the native route ends at an error that names only `rea doctor`.
- proposal: In src/domain/artifactInspection.ts derive next probes from the detected format for every path inspector (ELF: hardening, dependencies, exports, notes, DWARF units, initializers, unwind ranges; a core file: inspect_recorded_crash; an APK: inspect_android_package and inspect_apk_signature; PE: imports, certificates, load configuration, resources). Recognize SQLite, HAR and pcap files far enough to name their inspector. Have provider_unavailable list the same probes. SKILL.md then needs one line: for an unknown file, run inspect_artifact with detail summary and follow next_probes.
- expected gain: The 1,084-token format index becomes unnecessary and routes stay correct by construction. Three test routes that are late or dead-end today (a native binary without a provider, a core file, a SQLite file) get a working next step from one call of about 2,000 tokens.
- effort: large
- risk: inspect_artifact replies grow; cap the list at eight probes of about 20 tokens each. This is upstream-owned code that upstream edits; offer it upstream or keep the change to the one table.
- judge: A table test with one fixture per format (about 20 fixtures): the first probe equals the expected inspector, and following it does not refuse the same file. Seconds, in the boundary tests.

### Make guidance search find what agents type, and never return a whole guide

- problem: The right section came first in 12 of 20 queries; two natural phrasings matched nothing; in 11 of 18 replies the first match is an entire guide (up to 16,076 tokens); 'core dump crash' never reaches 'Recorded Linux crashes'.
- proposal: In rankSections (src/application/GuidanceAccess.ts:421): rank by how many query words a section covers, with extra weight for the heading, instead of requiring every word. When a file-level heading matches only through its subsections, return those subsections. Index an optional 'Also:' keyword line per section so authors can add the owner's words (core dump, website, too large).
- expected gain: The right section first in at least 18 of 20. The largest first read falls from 16,076 tokens to the largest second-level section (3,066). No empty replies for the two failing phrasings.
- effort: medium
- risk: Looser matching can return weak matches; show how many of the query words matched and keep a floor. Keyword lines add text to files shared with upstream; start with the fork's own guide.
- judge: The twenty queries with their expected sections as a regression file (05-guidance.mjs already encodes them): count of right-first and the largest read. Seconds.

### Guard the skill with a conformance test and a size budget

- problem: Only clone-runs.md is checked against the code. SKILL.md has a stale statement, a wrong route and 13 missing inspectors, and nothing stops it growing: it is 10,840 tokens after 63 upstream revisions.
- proposal: A test beside tests/conformance/cloneRunGuidance.test.ts: every backticked tool or command named in SKILL.md and the references exists in the catalogue or the CLI; the body is at most 2,000 tokens (tokenx is already a dependency) and 150 lines; the description is at most 1,024 characters; each managed reference over 100 lines starts with a contents list; every first-step row sits in the first 800 tokens.
- expected gain: The saving of the first change cannot erode, and a renamed or removed tool fails the build instead of misleading an agent.
- effort: small
- risk: A merge from upstream that grows SKILL.md fails the gate. That is the intent; with the first change such text lands in the reference file, not the body.
- judge: The test itself, plus two mutations that must fail it: add a tool name that does not exist; paste 200 lines into the body. Seconds.

### Have the referee's reply say how to read the role card, and start with the scout

- problem: A session that resumes from the run folder gets the worklist but no instructions: neither init nor evaluate output names the playbook or `rea guidance`, and finding one card by search costs 1,888 tokens for the search and 1,174 for the card. The first worklist item is for the prober, while the playbook says to scout and map first.
- proposal: In src/application/cloneRun/CloneRunEvaluation.ts add one line per reply, not per item, naming the command that prints the card of each role in the worklist (with the short locator of the guidance change, about 11 tokens per role). Make the first item after init a scout item, or say in init's message that scouting and mapping come first.
- expected gain: A reset session reaches its card in one command for about 20 extra tokens per reply, and the tool's first step agrees with the playbook's.
- effort: small
- risk: It adds a fixed line to every evaluation reply, and an earlier finding was that replies already repeat about 2 KB of fixed text; keep it to one short line.
- judge: Repeat the first leg of the blind trial with only the run folder path: count commands and tokens until the agent has the right card open. One session.

### Give every long reference a contents list, split the two largest, and stop linking off the machine

- problem: Eight of nine references exceed 100 lines with no contents list; two are 13,230 and 15,239 tokens; the first command of the desktop guide is at line 337; 104 links go to upstream web pages that are not in the package and not searchable.
- proposal: Generate a contents block from the second-level headings at build time in scripts/generate-skill-metadata.mjs, so the authored text stays compatible with upstream. Split desktop-build.md by phase and move its per-application notes to a file looked up by application name. Ship the linked docs pages in the package or index them in guidance, and link to a local path.
- expected gain: A partial read shows the whole scope. The desktop route reads three sections (3,430 tokens) instead of the file (13,230). No route depends on fetching a web page.
- effort: medium
- risk: Splitting files shared with upstream diverges from it; the generated contents block does not. Shipping the 39 linked pages adds 594 KB to the package.
- judge: A lint in the conformance test (the contents list equals the headings; no link in the skill leaves the package) and the desktop request in the evaluation. Seconds.

### Have summary replies list the views they offer

- problem: The selectors for inspect_analysis_view are in a 33,079-token CLI schema and nowhere else an agent looks (the MCP schema is 142 bytes; summary replies list none). About 2,200 tokens of skill text carry recipes to fill the gap, and the blind trial lost three turns writing its own scripts instead.
- proposal: Each summary reply adds a short field naming the view kinds and collections valid for its retained parent, with one example selector.
- expected gain: About 2,200 tokens of recipes can leave the skill, and an agent pages a retained record without the schema dump or a guess.
- effort: medium
- risk: It adds 50 to 100 tokens to every summary reply; keep it to names. The tool code is upstream-owned.
- judge: For each of the 52 tools that take detail summary, a test that the example selector in the reply is accepted by inspect_analysis_view. Seconds.

### Rewrite the description around the owner's words, and test that it triggers

- problem: The description has 17 of 32 likely owner words (no binary, APK, Android or crash) and spends 47% of its characters on two features. Whether it triggers correctly has never been measured.
- proposal: Use the sketch's description (537 characters, 115 tokens, 24 of 32 words) or similar, and keep the clause that excludes ordinary source-repository work.
- expected gain: A measured trigger rate on 10 requests that should trigger and 10 near misses that should not; target at least 9 of 10 and at most 1 of 10.
- effort: small
- risk: A broader description can trigger on ordinary source work and load the body for nothing. With the first change a false trigger costs 1,175 tokens instead of 10,840.
- judge: Twenty labelled queries, three runs each, with `claude plugin eval` and a grader on whether the skill was used, as the official guidance describes. 60 short sessions.

### Scope setup's output and point it at the skill

- problem: The first output a fresh agent reads, from `rea setup` for one client, is 11,207 to 11,806 tokens, 81% of it the state of 43 clients nobody asked about, and it does not say where the skill is. A plugin install and a setup install together list the skill twice in Claude Code.
- proposal: With --client given, print that client's state only, and one next line naming the installed SKILL.md. Detect an enabled REA plugin and say that the personal skill copy would be a second listing. This belongs to the lens that owns CLI output.
- expected gain: About 10,000 fewer tokens before the first step.
- effort: small
- risk: Scripts that parse the state of all clients need a flag that keeps the full form.
- judge: The output of `rea setup --dry-run --json --client claude_code` is at or under 1,500 tokens and names the skill path.

## Open questions (9)

- Claude's own token counts were not measured: there is no offline tokenizer, and sending file text to a counting service is outside this audit's rules. By o200k the body is 10,840 tokens, by REA's tokenx 12,510. The line where the 5,000-token carry-over cuts (307, 270 or 243) depends on this.
- How Codex and Cursor load a skill body, what they keep after compaction, and whether they list a skill twice when it is in both ~/.agents/skills and ~/.claude/skills: their documentation hosts (developers.openai.com, cursor.com) and agentskills.io were refused by this session's network proxy. The specification was read from its public repository instead.
- Does a live agent confirm the traced routing numbers? The evaluation is designed but was not run: it needs model sessions, and starting one from here would send file content to an outside service.
- Should the fork carry its own short SKILL.md against upstream, or offer the restructure upstream? Upstream has revised the file 63 times and changed two route statements since the fork point.
- Will the fork publish under its own package name? Until it does, the npx fallbacks and the plugin manifests fetch upstream's code while the fork's skill teaches commands upstream does not have.
- What an MCP client actually shows the agent for the 677 KB default JavaScript reply (text plus structured content) depends on the client and was not observed.
- Whether REA notices a plugin install and a setup install side by side, which lists the same skill twice in Claude Code, was not tested.
- Should the 45 per-format bullets stay reachable as a reference once the tools route, or be deleted? The sample says their content is in the tool descriptions, but only 8 statements from that section were checked by hand.
- Should clone runs become their own skill? Measured: with the sketch a clone-run start loads 2,438 tokens within one skill; a separate skill would save a few hundred more and cost about 100 always-loaded tokens plus setup changes. On these numbers it is not worth it.

## Details

All files are in /home/user/rea-design/discover/census-skill/ and /home/user/rea-design/discover/census-skill/FILES.txt indexes them. Token columns are o200k (gpt-tokenizer 4.1.2) unless marked; tokenx is the estimator REA ships. Neither is Claude's tokenizer.

## 1. What each layer costs (01-measure.md)

| Layer                      | In context                  | Lines | Bytes   | Tokens | tokenx |
| -------------------------- | --------------------------- | ----- | ------- | ------ | ------ |
| description                | always                      | 1     | 572     | 109    | 146    |
| SKILL.md body              | whenever the skill triggers | 680   | 48,427  | 10,840 | 12,510 |
| native-and-artifacts.md    | when read                   | 1,048 | 67,757  | 15,239 | 17,690 |
| desktop-build.md           | when read                   | 860   | 51,806  | 13,230 | 13,098 |
| clone-runs.md              | when read                   | 499   | 28,546  | 6,868  | 7,242  |
| environments.md            | when read                   | 399   | 22,010  | 5,333  | 5,541  |
| connection-and-recovery.md | when read                   | 257   | 19,728  | 3,513  | 4,293  |
| javascript-applications.md | when read                   | 280   | 16,246  | 3,407  | 4,051  |
| evidence-workflows.md      | when read                   | 193   | 12,418  | 2,673  | 3,166  |
| runtime-observation.md     | when read                   | 140   | 13,171  | 2,260  | 3,096  |
| android-applications.md    | when read                   | 63    | 4,092   | 859    | 1,054  |
| whole skill                |                             | 4,425 | 284,853 | 64,350 | 71,909 |

Other guidance an agent can meet: MCP server instructions 488 tokens (always, for MCP clients); `rea --help` 5,232; `rea --llms` 6,355; `rea --llms-full` 48,979; the guided workflow list 681 and one rendered workflow 463 to 489; `rea setup` output 11,207 to 11,806.

Copies: the source and .cursor-plugin/skills are byte-identical (SKILL.md 10,968 tokens). skills/ (the path of the Claude and Codex plugin manifests, and what `rea setup` installs) is 10,983 tokens: it adds `tool_count: 263` and pins npx to 6.9.0. The references are identical everywhere.

## 2. SKILL.md body by section

| Section                      | File lines | Tokens | Share |
| ---------------------------- | ---------- | ------ | ----- |
| opening paragraph            | 8-15       | 65     | 0.6%  |
| Connect only when needed     | 16-79      | 836    | 7.7%  |
| Route the target first       | 80-546     | 8,161  | 75.3% |
| Work summary-first           | 547-615    | 897    | 8.3%  |
| Plan broader investigations  | 616-650    | 407    | 3.8%  |
| Read only the relevant guide | 651-674    | 304    | 2.8%  |
| Finish the task              | 675-686    | 170    | 1.6%  |

Where a budget cuts the file (02-cutoff.md): 500 tokens end at line 48, 1,000 at 89, 2,000 at 147, 5,000 at 307 (o200k); 5,000 at 270 by tokenx and at 243 if the client counts 30% more.

## 3. Official rules against today's skill (quotes, addresses and line numbers in official-docs/SOURCES.txt)

| Rule                                                                                                            | Today                                                                                  |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Description at most 1,024 characters, saying what and when (specification)                                      | 572 characters, 109 tokens, says what, when and when not: met                          |
| Body 'Under 5k tokens' (platform overview; specification)                                                       | 10,840: 2.2 times over                                                                 |
| 'Keep the SKILL.md body under 500 lines' (best practices; Claude Code docs)                                     | 680: 36% over                                                                          |
| First 5,000 tokens kept after compaction; 'put the most important instructions near the top' (Claude Code docs) | first 500 tokens are connection repair; the cut is at line 307 of 686                  |
| 'Keep references one level deep from SKILL.md' (best practices; specification)                                  | 4 references link to sibling references; 104 links go to web pages outside the package |
| 'For reference files longer than 100 lines, include a table of contents at the top' (best practices)            | 8 of 9 are longer; none has one                                                        |
| 'Keep individual reference files focused' (specification)                                                       | two files of 13,230 and 15,239 tokens                                                  |
| 'The key is telling the agent when to load each file' (agentskills best practices)                              | 10 of 58 route bullets link a guide; the index of guides is at line 651, after the cut |
| 'Only add context Claude doesn't already have' (best practices)                                                 | 8 of 30 sampled statements are judgment; 17 repeat the tools                           |
| 'Don't include information that will become outdated' (best practices)                                          | version-coupled sentences, for example 'npm 4.1.0' and 'Versions before 4.1.0'         |
| 'Create evaluations BEFORE writing extensive documentation' (best practices)                                    | a harness with two routing scenarios; nothing covers size or the other routes          |
| Fully qualified MCP tool names, 'ServerName:tool_name' (best practices)                                         | bare names; possibly deliberate, since the server name depends on the install          |

## 4. Routing test (10-routing-test.md; what the commands did here: 04-route-runs.md, 07-mcp-first-steps.md)

'Top-down' is what a reader pays from the top of SKILL.md to the end of the bullet that gives the route, plus the reference from its top to the first command. 'Loaded today' is the whole body plus each whole reference the route names. 'With the sketch' is the sketched body plus the sections it points to.

| Request                             | First correct command                              | Route ends at line | Top-down lines / tokens | Loaded today | With the sketch | Verdict                                                                                           |
| ----------------------------------- | -------------------------------------------------- | ------------------ | ----------------------- | ------------ | --------------- | ------------------------------------------------------------------------------------------------- |
| Native ELF: explain a licence check | open_binary (CLI: rea function)                    | 480                | 474 / 8,098             | 10,840       | 1,175           | Late: 58th of 58 bullets; bullet 136 reads like a match; no CLI names. Here: provider_unavailable |
| Android APK: find the login request | inspect_android_package                            | 125                | 119 / 1,640             | 10,840       | 1,175           | Clear; the JADX requirement is only in the reference and the refusal                              |
| Electron app: how auto-update works | analyze_javascript_application with detail summary | 100                | 94 / 1,196              | 10,840       | 1,175           | Wrong default: 112,519 tokens without summary                                                     |
| Rebuild a web app                   | rea init-clone-run                                 | 92                 | 222 / 2,868             | 17,708       | 2,438           | Clear; six required flags only in --help (1,273 tokens)                                           |
| Core file from a crash              | inspect_recorded_crash                             | 467                | 461 / 7,903             | 10,840       | 2,259           | Late and stale: says x86-64 only; pwntools not mentioned                                          |
| Firmware image                      | inspect_firmware_regions                           | 130                | 124 / 1,739             | 10,840       | 1,175           | Clear; no fallback when Binwalk is absent                                                         |
| Two versions of a native binary     | match_native_functions                             | 673                | 698 / 11,102            | 26,079       | 1,175           | Ambiguous: no route; the index files it under JavaScript                                          |
| Minified JavaScript bundle          | recover_javascript_sources                         | 100                | 103 / 1,330             | 14,247       | 1,175           | Wrong: the named tool refuses a single file                                                       |
| Live page: which endpoints it calls | list_browser_targets, observe_web_session          | 155                | 247 / 3,881             | 13,100       | 1,658           | Ambiguous: three bullets, one names no tool                                                       |
| .NET assembly                       | inspect_managed_artifact                           | 126                | 120 / 1,654             | 10,840       | 1,175           | Clear                                                                                             |
| HAR to an agent environment         | rea environment-build                              | 158                | 165 / 2,356             | 16,173       | 1,473           | Ambiguous: two bullets; the command is only in the reference                                      |
| Desktop app environment             | start_build_computer                               | 165                | 501 / 7,724             | 24,070       | 4,605           | Clear but long: first command at line 337 of the guide                                            |
| SQLite file                         | inspect_sqlite_database                            | 457                | 451 / 7,718             | 10,840       | 2,259           | Late: 53rd bullet. Here: needs Node 24.15                                                         |
| Hardening of an ELF                 | inspect_binary_hardening                           | 334                | 328 / 5,507             | 10,840       | 2,259           | Clear; bullet 458 overlaps                                                                        |
| Run a command and watch it          | capture_process_scenario                           | 141                | 152 / 2,573             | 13,100       | 1,175           | Clear over MCP; on the CLI the scenario shape cannot be discovered                                |
| Mean                                |                                                    |                    | 284 / 4,486             | 14,080       | 1,757           |                                                                                                   |

## 5. Guidance test (05-guidance.md, 16-guidance-whatif.md)

| Query                                        | First match                                                          | Right first | Search tokens | Read tokens |
| -------------------------------------------- | -------------------------------------------------------------------- | ----------- | ------------- | ----------- |
| clone a web application                      | clone-runs.md, whole guide                                           | yes         | 1,591         | 7,444       |
| rebuild website and check it matches         | no match                                                             | no          | 54            |             |
| clone run prober                             | clone-runs.md > Prober                                               | yes         | 1,888         | 1,174       |
| evidence_stale                               | evidence-workflows.md, whole guide (Verifier card is third)          | no          | 3,302         | 3,085       |
| stalled what now                             | clone-runs.md, whole guide                                           | no          | 659           | 7,444       |
| decompile a function in a native binary      | evidence-workflows.md, whole guide                                   | no          | 1,021         | 3,085       |
| android apk classes methods                  | android-applications.md                                              | yes         | 2,244         | 1,178       |
| electron asar                                | javascript-applications.md, whole guide                              | yes         | 700           | 3,869       |
| firmware image                               | native-and-artifacts.md > Godot PCK                                  | no          | 1,015         | 1,182       |
| compare two versions                         | evidence-workflows.md, whole guide                                   | yes         | 1,976         | 3,085       |
| core dump crash                              | native-and-artifacts.md, whole guide                                 | no          | 885           | 16,076      |
| provider_unavailable                         | connection-and-recovery.md > Distinguish client and server deadlines | yes         | 3,053         | 926         |
| ghidra startup timeout                       | native-and-artifacts.md > Ghidra startup deadline recovery           | yes         | 1,526         | 723         |
| tools missing after setup                    | connection-and-recovery.md > Recovery ladder                         | yes         | 3,862         | 780         |
| result too large truncated                   | no match                                                             | no          | 52            |             |
| which api endpoints does the page call       | javascript-applications.md, whole guide                              | no          | 927           | 3,869       |
| agent environment from a HAR                 | environments.md, whole guide                                         | yes         | 2,165         | 5,889       |
| desktop app environment task                 | environments.md > Tasks for a desktop application environment        | yes         | 3,489         | 1,948       |
| frida instrumentation                        | runtime-observation.md > Native runtime questions                    | yes         | 466           | 1,480       |
| recover readable source from minified bundle | javascript-applications.md, whole guide                              | yes         | 695           | 3,869       |

Right first 12 of 20; mean search 1,748 tokens (697 with short locators, 511 with a limit of three as well); mean read 3,728.

## 6. Redundancy (08b-classification.md, 09-route-overlap.md, 11-patterns.md)

| Where                      | Sampled | Judgment the tools cannot give | Already printed by the tool | Tool fact printed nowhere an agent sees | Bare link |
| -------------------------- | ------- | ------------------------------ | --------------------------- | --------------------------------------- | --------- |
| SKILL.md                   | 10      | 2                              | 6                           | 1                                       | 1         |
| of which the route section | 8       | 0                              | 6                           | 1                                       | 1         |
| the nine references        | 20      | 6                              | 11                          | 2                                       | 1         |
| all                        | 30      | 8                              | 17                          | 3                                       | 2         |

Full-population cross-check on the 58 route bullets: median 49% of content words shared with the named tools' own descriptions; 43% of the section in eight repeated sentence patterns. SKILL.md names 66 of the 263 tools; with the references 147.

## 7. The skill an agent would want (sketch/SKILL.md, 12-sketch.md)

The first 500 tokens must contain: (1) the scope and what REA is not for, 31 tokens; (2) three context rules, 160 tokens: ask for the summary first, with the measured reason; read one section of guidance, not a guide; never repeat an unchanged call; (3) the first rows of a first-step table by request: clone a web app, native program, one fact about a file, inside a package, Electron or JavaScript tree, minified bundle. In a client that defers tool schemas, this table is also the list of exact tool names to look up.

| Part                                              | Today                      | Budget                       | Sketch, measured                 |
| ------------------------------------------------- | -------------------------- | ---------------------------- | -------------------------------- |
| description                                       | 109                        | at most 120                  | 115                              |
| body, total                                       | 10,840                     | at most 1,500, gate at 2,000 | 1,175                            |
| scope and three context rules                     | rule at line 547           | at most 200                  | 191                              |
| first-step table                                  | 8,161                      | at most 600                  | 573                              |
| when a step is refused                            | 836                        | at most 150                  | 130                              |
| evidence rule                                     | part of 897                | at most 60                   | 46                               |
| larger investigations                             | 407                        | at most 160                  | 153                              |
| finish                                            | 170                        | at most 90                   | 82                               |
| format index (a reference, until the tools route) | about 5,900 in bullets     | at most 1,100                | 1,084                            |
| one guidance search reply                         | 1,748 mean                 | at most 600                  | 511 (re-serialized real replies) |
| one guidance read                                 | 3,728 mean, 16,076 maximum | at most 900 per section      | not built                        |

What moves to references: the 45 per-format bullets (as the index above, with upstream's text kept verbatim in a reference if wanted); the IDA and Kuna paragraphs (500 tokens) into the native guide; connection prose (836 tokens down to three lines; the recovery guide already exists); evidence composition detail (897 down to 160; the rest is in evidence-workflows.md).

What moves into tool output: the route itself (inspect_artifact next probes; provider-missing errors that name working inspectors); view selectors (summary replies list their views); how to read binary_session's tool list (235 tokens of skill text today); the pointer to a role card (the referee's reply). Per-tool caveats are already in the tool descriptions and are simply deleted, along with 41 web links (873 tokens of link markup) and the repeated 'requires no', 'not proof' and 'Preserve' sentences (1,354 tokens).

Saving per session against today: 12,323 fewer tokens loaded on average over the fifteen requests (14,080 to 1,757); about 109,800 fewer on the first Electron or JavaScript call when the summary rule is followed; 1,237 fewer per guidance search; and after compaction the whole 1,175-token body is kept, where today a 5,000-token carry-over keeps under half of the lines.

## Method limits

Token counts are o200k and tokenx. The routing paths were traced by hand from the skill text, then counted by script; no live agent ran them. The thirty statements were classified by one rater, with the tool text recorded beside each. No Ghidra, IDA, JADX, Binwalk or pwntools is installed, so native, Android, firmware and crash routes ended at the provider refusal; a browser was not started. The format index in the sketch is machine-drafted for size only. Nothing in /home/user/rea-snap or /home/user/rea was changed; `rea setup` ran only with HOME pointed at a throwaway directory; no process of mine is still running.
