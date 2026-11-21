# research-context

## Summary

Agent clients now handle large tool catalogues themselves. Claude Code, Codex (since rust-v0.143.0) and Copilot CLI defer MCP tool definitions by default and load them through tool search. Anthropic's tool search loads 3 to 5 tools per search, and its docs say tool selection degrades past 30 to 50 tools. So REA's 263-tool, roughly 97k-tokenx catalogue costs little in those clients. What decides whether an agent finds the right REA tool there is the searchable text: names, the first 4,096 characters of each description, argument names and descriptions, and the server instructions. REA's instructions (2,604 bytes) are almost all error-recovery advice and do not say which kinds of task should send an agent searching for REA. Two clients still have hard caps that REA's default exceeds: VS Code allows 128 tools per request and fails with 'Cannot have more than 128 tools per request'; Cursor has historically sent only the first 40 (forum posts, current limit unconfirmed). On results, Claude Code allows 25,000 tokens by default and saves any text result over 50,000 characters to a file. Codex defaults to about 10k tokens and now allows a per-tool output_token_limit. Gemini CLI truncates at 40,000 characters and summarises with an LLM above 20k tokens. In practice a result's first screen is all the agent reliably sees, so results should lead with the answer and hand back handles. I measured REA's real results with a BPE tokenizer: CLI default TOON is 0 to 11.6% larger than compact JSON (108.6% over 11 results, about 139k against 128k o200k tokens). The CLI census found TOON larger than JSON in 23 of 26 rows, and the TOON project's own README says compact JSON wins on nested or non-uniform data, which is what REA's Evidence is. REA's --token-limit estimator undercounts real BPE tokens by 1.18x on average and up to 2.97x. Only 9 of 263 tools are marked readOnlyHint, because retaining session Evidence counts as a mutation, and Claude Code runs only read-only calls in parallel. MCP 2026-07-28 removes protocol sessions and expects cross-call state to travel as server-minted handles in tool arguments. REA's statement that 'an opened target persists across turns' depends on a connection-scoped session. On skill disclosure, the SKILL.md body is 680 lines and about 10.8k o200k tokens, against Anthropic's guidance of at most 500 lines. 75% of it is one routing section, and none of the 9 reference files has a table of contents (8 are over 100 lines). REA already does a lot right: hot-cold catalogue with discover_tools, summaries with retained Evidence and analysis views, actionable errors, effect-derived annotations, untrusted-content provenance, progress notifications, and the clone-run referee's journal and next list. The highest-value changes reshape existing parts rather than add features.

## Facts (30)

- [documented] Claude Code defers all MCP tool definitions by default (tool search). Only tool names and server instructions load at session start, and there is no fixed per-server tool cap.
  - evidence: https://code.claude.com/docs/en/mcp (fetched as code.claude.com/docs/en/mcp.md, lines 1751-1753, 1807, 1822): 'Tool search keeps MCP context usage low by deferring tool definitions until Claude needs them. Only tool names and server instructions load at session start'; ENABLE_TOOL_SEARCH unset = 'All MCP tools deferred and loaded on demand'. Excerpt saved in /home/user/rea-design/discover/research-context/web-excerpts/claude-code-mcp-tool-search.md
- [documented] Claude Code cuts server instructions and upfront tool descriptions at 4,096 characters and deferred tool descriptions at 16,384. Tool search matches only the text within the shorter limit, so search keywords must come first. Server authors are told to write instructions that say what category of tasks the tools handle, when to search for them, and the key capabilities.
  - evidence: code.claude.com/docs/en/mcp lines 1761-1776
- [documented] A server can mark a tool _meta['anthropic/alwaysLoad']: true so Claude Code loads it upfront.
  - evidence: code.claude.com/docs/en/mcp lines 1784-1800
- [documented] Claude Code MCP output limits: a warning at 10,000 tokens, a default maximum of 25,000 tokens (MAX_MCP_OUTPUT_TOKENS), and any text result over 50,000 characters saved to a file with a path reference. A tool can raise its own threshold with _meta['anthropic/maxResultSizeChars'], up to 500,000.
  - evidence: code.claude.com/docs/en/mcp lines 1532-1563; excerpt in web-excerpts/claude-code-mcp-output-limits.md
- [documented] Claude Code runs a tool's calls in parallel with other read-only calls only when readOnlyHint is true. idempotentHint or readOnlyHint lets it retry a call that was pending when a connection closed.
  - evidence: code.claude.com/docs/en/mcp lines 1655-1661: 'readOnlyHint: the tool changes nothing. Claude Code also runs the tool's calls in parallel with other read-only calls.'
- [ran-it] REA marks only 9 of 263 tools readOnlyHint=true. Of the 129 tools named inspect_/list_/get_/search_/read_/describe_/compare_, 5 are read-only. The cause is that annotationsFromEffects treats mutatesSession (retaining Evidence) as a mutation.
  - evidence: node count over /home/user/rea-design/discover/census-mcp/raw-default-tools.json: readOnly true 9, false 254; /home/user/rea-snap/src/contracts/toolEffects.ts:94-108
- [ran-it] On REA's own MCP results, TOON costs more tokens than compact JSON: 108.6% of compact JSON over 11 real results (range 100.0 to 111.6%), about 139k against 128k o200k tokens. Pretty JSON is 131% of compact. The CLI default (TOON) is 106.6% of the CLI's own --json on `rea capabilities`.
  - evidence: node /home/user/rea-design/discover/research-context/format-compare.mjs over census raw-calls/task-naive plus `rea capabilities --json`; table at /home/user/rea-design/discover/research-context/format-compare.tsv (o200k via gpt-tokenizer; not Claude's tokenizer)
- [ran-it] The CLI census found the default TOON format larger than the JSON base in 23 of 26 measured outputs (mean 106.5% of base in o200k, range 86 to 132%).
  - evidence: awk over /home/user/rea-design/discover/census-cli-output/census-variants.tsv rows 'format toon (default)'
- [documented] The TOON project's own benchmark: 42.6% fewer tokens than pretty JSON with similar accuracy (72.2% against 71.4%) on retrieval questions. Compact JSON 'often wins outright' on deeply nested or non-uniform data (TOON 6.7% larger on nested config, 19.9% larger on semi-uniform event logs), and on mixed-structure data TOON is 1.6% larger than compact JSON.
  - evidence: https://github.com/toon-format/toon (README benchmarks section)
- [unconfirmed] An agentic tool-use study reports TOON saves up to 18% of tokens at about a 9-point accuracy cost, and degrades further in multi-turn use.
  - evidence: arXiv 2605.29676 (search snippet only; arxiv.org is blocked from this session)
- [ran-it] REA's --token-limit uses the tokenx estimator. On 28 '--token-limit 2000' CLI rows the real o200k count was a mean 1.18x and at most 2.97x the limit.
  - evidence: awk over census-cli-output/census-variants.tsv rows with 'token-limit 2000' (tokens_o200k / 2000)
- [documented] The MCP 2025-11-25 spec supports resource_link content blocks in tool results (which need not appear in resources/list), annotations (audience, priority, lastModified), outputSchema with structuredContent, cursor pagination, server instructions, tools.listChanged, and experimental tasks with ttl and pollInterval. A tool returning structuredContent SHOULD also return the serialized JSON as text.
  - evidence: raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/specification/2025-11-25/server/tools.mdx lines 275-341; basic/utilities/tasks.mdx; copies in web-excerpts/
- [documented] MCP 2026-07-28 removes protocol sessions and the initialize handshake ('Servers that need cross-call state use explicit, server-minted handles passed as ordinary tool arguments'). It moves tasks to the io.modelcontextprotocol/tasks extension with polling, recommends a deterministic tools/list order for prompt-cache hits, and adds ttlMs and cacheScope to list results.
  - evidence: docs/specification/2026-07-28/changelog.mdx major changes 1, 2, 6 and minor changes 3, 5 (raw.githubusercontent.com); copy in web-excerpts/mcp-2026-07-28-changelog.mdx
- [documented] MCP has no accepted on-demand tool-discovery mechanism. SEP-1821 (a query parameter on tools/list) is a draft seeking a sponsor, SEP-2636 proposes tool manifests, and the official client best-practices page treats progressive discovery as a host-side pattern.
  - evidence: github.com/modelcontextprotocol/modelcontextprotocol/issues/1821, /pull/2636 (search results); 2026-07-28 tools.mdx has no discovery method
- [ran-it] REA's tools/list returns all 263 tools in one page (no nextCursor), in identical order on two calls, with tools and prompts listChanged declared and no resources. There are no outputSchemas by default, no _meta and no execution.taskSupport on any tool.
  - evidence: node /home/user/rea-design/discover/research-context/tools-list-order.mjs -> 'count 263 identical order true nextCursor null'; census-default.json capabilities {completions, prompts.listChanged, tools.listChanged}
- [ran-it] REA's server instructions are 2,604 bytes (488 o200k tokens). Most of the text covers recovery, timeouts and prompt-injection handling. They name five target categories but say nothing about when to search for REA tools, and they do not mention clone runs, environments, APK or firmware.
  - evidence: node /home/user/rea-design/discover/research-context/print-server-instructions.mjs (initialize result); size from census-mcp/census-default.json
- [documented] VS Code Copilot rejects a request with more than 128 tools ('Cannot have more than 128 tools per request'). The experimental github.copilot.chat.virtualTools.threshold setting groups tools for on-demand discovery.
  - evidence: raw.githubusercontent.com/microsoft/vscode-docs/main/docs/agents/run/tools.md lines 275-277
- [unconfirmed] Cursor historically sent only the first 40 MCP tools to the agent. Forum reports since then mention 80 and 'Dynamic Context Discovery', and the current limit is unconfirmed.
  - evidence: forum.cursor.com/t/tools-limited-to-40-total/67976 and /t/regarding-the-quantity-limit-of-mcp-tools/153432 (search results; docs.cursor.com not fetched)
- [documented] Codex: MCP tools use tool search by default (rust-v0.143.0). rust-v0.152.0 added a per-tool MCP output_token_limit with consistent truncation across resumes. The default tool_output_token_limit is 10k tokens for Codex models.
  - evidence: https://github.com/openai/codex/releases/tag/rust-v0.143.0 ; https://github.com/openai/codex/releases/tag/rust-v0.152.0 ; https://github.com/openai/codex/issues/7867
- [documented] Gemini CLI: tools.truncateToolOutputThreshold defaults to 40,000 characters, distillation.maxOutputTokens to 10,000, and LLM summarisation of truncated output starts above 20,000 tokens. Older tool outputs are masked once more than 50,000 tokens of recent output are protected.
  - evidence: raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/reference/configuration.md lines 1896-1900, 2422-2445; excerpt in web-excerpts/gemini-cli-truncation.md
- [documented] Anthropic tool search: up to 10,000 deferred tools, 5 results per search by default. Search covers names, descriptions, argument names and argument descriptions. Selection accuracy 'degrades once you exceed 30-50 available tools'. Recommended: keep the 3 to 5 most-used tools non-deferred, prefix names by service or resource 'so one search matches the whole group', and describe the tool categories in the system prompt.
  - evidence: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
- [documented] Advanced tool use: tool search took one model generation from 49% to 74% and the next from 79.5% to 88.1% on MCP evaluations, with about 85% less context. Programmatic tool calling cut tokens 37% (43,588 to 27,297). Tool-use examples raised complex-parameter accuracy from 72% to 90%.
  - evidence: https://www.anthropic.com/engineering/advanced-tool-use
- [documented] Writing tools for agents: consolidate tools, prefer search over list, namespace, return high-signal fields, offer a response_format concise/detailed switch (206 against 72 tokens), paginate, filter and truncate with sensible defaults, and steer the agent when truncating. Errors should give actionable fixes. Evaluate with realistic tasks and track tokens, calls and errors.
  - evidence: https://www.anthropic.com/engineering/writing-tools-for-agents
- [documented] Context engineering: find 'the smallest set of high-signal tokens'. Agents should hold lightweight identifiers and retrieve just in time. Tool-result clearing is 'one of the safest, lightest' forms of compaction, and sub-agents return condensed summaries of about 1,000 to 2,000 tokens.
  - evidence: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- [documented] Context editing clears the oldest tool results once a trigger is reached (default 100,000 input tokens) and keeps the 3 most recent tool uses by default. It improved an agentic search eval by 29% (39% with the memory tool) and cut tokens 84% in a 100-turn eval.
  - evidence: https://platform.claude.com/docs/en/build-with-claude/context-editing ; https://claude.com/blog/context-management
- [documented] Code execution with MCP: presenting tools as files or a search_tools function with a detail-level parameter, and filtering data in code, cut an example from 150,000 to 2,000 tokens.
  - evidence: https://www.anthropic.com/engineering/code-execution-with-mcp
- [ran-it] Skill guidance: keep the SKILL.md body under 500 lines, keep references one level deep, and give any reference file over 100 lines a table of contents. REA's SKILL.md body is 680 lines and about 10,840 o200k tokens, with 75.3% in one routing section. None of its 9 reference files has a table of contents in the first 40 lines, and native-and-artifacts.md alone is 1,048 lines.
  - evidence: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices ; /home/user/rea-design/discover/census-skill/01-measure.md; wc -l on /home/user/rea-snap/skills/reverse-engineer-anything
- [documented] Long-running harness guidance: a JSON feature list that agents only flip from failing to passing, a progress file plus git, one feature per session, end-to-end verification, and a fixed get-your-bearings routine at the start of each session.
  - evidence: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- [documented] Multi-agent research: subagents writing to external storage and passing lightweight references back avoids a 'game of telephone'. Having an agent rewrite tool descriptions cut task time by 40%. Start evals with about 20 queries.
  - evidence: https://www.anthropic.com/engineering/multi-agent-research-system
- [unconfirmed] Tool-description quality: 97.1% of 856 MCP tool descriptions have at least one smell. Rewriting them raised task success by a median 5.85 points but added 67% more steps, and lowered success in 16.7% of cases. RAG-based tool selection raised selection accuracy from 13.62% to 43.13%.
  - evidence: arXiv 2602.14878 and arXiv 2505.03275 (search snippets; arxiv.org and huggingface.co blocked)

## Already good (12)

- Hot-cold catalogue with a discover_tools loader, opt-in via REA_MCP_TOOL_CATALOG_PROFILE=hot-cold. This is the server-side form of Anthropic's tool search and search_tools-with-detail-level pattern, and it is honest about needing client refresh (docs/getting-started/client-configuration.md:116-173). The census measured a 7-tool front at about 2.2k tokenx (census-mcp/lazy-proxy.md).
- REA_MCP_TOOL_FAMILIES scopes the advertised tools and prompts by family, which is the 'few targeted tools' lever (src/config/parseConfig.ts:117).
- Summaries with handles: --detail summary plus --evidence_output, retained Evidence with evidence_id, and inspect_analysis_view paging. These match 'lightweight identifiers plus just-in-time retrieval' and response_format concise/detailed (the census task used detail summary on every large call).
- Global result shaping in the CLI: --filter-output, --token-limit/--token-offset, --token-count and several formats (rea --help). Anthropic recommends exactly this kind of filtering and truncation with defaults.
- Actionable error and recovery text with remediation, and 'do not repeat unchanged failures' (server instructions; src/server/EvidenceMcpServerCore.ts:968-970). This follows Anthropic's error guidance and SEP-1303 (return input errors as tool errors so the model can correct itself).
- Annotations come from declared effects, not from tool names (src/contracts/toolEffects.ts:94-116). destructiveHint and openWorldHint are set from those effects, matching Anthropic's advice to disclose open-world and destructive tools.
- Prompt-injection hygiene: the instructions say target-derived content is data, and results carry _meta.provenance.untrusted_content (seen on inspect_artifact results).
- MCP progress notifications are bridged from application progress (src/server/mcpProgress.ts).
- The output schema profile is off by default, which keeps the catalogue smaller while REA validates results against its canonical contracts (client-configuration.md:182-189).
- The size limits hold: the longest description is 1,797 characters and the instructions are 2,604 bytes, both inside Claude Code's 4,096-character cut. tools/list order is deterministic within a connection, as MCP 2026-07-28 recommends.
- evaluate-clone-run already follows the long-running-harness pattern. It writes the verdict to gate.json, keeps a journal.jsonl, returns at most ten next items with the exact command, detects stalls, and states that no agent-written file can produce a pass (rea --help). These correspond to Anthropic's feature list, progress file and verification loop.
- The skill uses progressive disclosure, with 9 reference files loaded on demand. Its description is 572 characters (limit 1,024), so the always-loaded cost is about 109 o200k tokens (census-skill/01-measure.md).

## Opportunities (10)

### Write REA's searchable surface for client-side tool search

- problem: Claude Code, Codex and Copilot CLI now defer REA's tools and show the model only names and server instructions until it searches. The 2,604-byte instructions spend almost all their length on recovery and never say which tasks should send an agent searching for REA. Names do not share one prefix per family (annotate_native_function next to inspect_native_*), and no tool is marked to load upfront. So a search can miss and the agent falls back to bash, or it spends an extra search on each step.
- proposal: (1) Lead the instructions with a short block of task categories and keywords (binary, APK, firmware, JS/Electron, HAR, clone a web app, AgentEnv), plus 'search for REA tools when…'. Move the recovery prose to the end or into a guidance section, keeping the injection paragraph. (2) Mark 3 to 5 hot tools with _meta['anthropic/alwaysLoad']: true (for example search_guidance, open_binary, inspect_analysis_view, evaluate_clone_run). (3) Make the first sentence of each description carry the words an agent would search for. Owners: the instructions string in src/server (createServer/EvidenceMcpServerCore), tool contracts in src/contracts.
- expected gain: Fewer ToolSearch calls before the right tool and fewer wrong-tool or bash fallbacks. Anthropic reports tool-search accuracy gains of 49→74% and 79.5→88.1% when definitions are searchable. The cost is about 500 tokens of instructions, which are always loaded anyway.
- effort: small
- risk: The instruction text is shared by every client, so clients without tool search lose nothing. alwaysLoad is ignored outside Claude Code. Shortening the recovery prose could weaken recovery behaviour, so move it rather than delete it.
- judge: 20 realistic REA tasks in Claude Code with tool search on (default) against the current snapshot. Measure ToolSearch calls per task, the share of tasks whose first REA call is the right tool, and total tokens. Done when the median number of searches before the right tool falls and success does not drop. About 40 runs.

### Make the default catalogue fit capped clients

- problem: REA lists 263 tools by default. VS Code rejects requests with more than 128 tools ('Cannot have more than 128 tools per request') unless the user enables an experimental setting, and Cursor has historically sent only the first 40. In those clients REA either fails or loses most of its tools in list order, which puts annotate_native_function first.
- proposal: Ship named family profiles of 40 tools or fewer, or one 'core' profile with discover_tools, and document a recipe per client. The alternative is to choose the profile from clientInfo at initialize. REA currently refuses to infer behaviour from client names (client-configuration.md:137), so that needs an owner decision. At minimum, put the most important tools first in list order and have `rea doctor` warn when the advertised count exceeds a known client cap.
- expected gain: REA becomes usable in VS Code out of the box, and in Cursor an agent sees the intended tools rather than the first 40.
- effort: medium
- risk: Inferring the profile from clientInfo conflicts with REA's fail-closed stance and could hide tools from clients that can take more. Profiles must not drop the tools a skill route names.
- judge: Connect VS Code Copilot and Cursor to the snapshot and to the change. Record the tool count each client accepts and whether the 10-call census task (census-mcp/07-task.mjs) completes. 2 clients × 2 builds.

### Make the default output format compact JSON, or choose the format by data shape

- problem: The CLI default (TOON) costs more than compact JSON on REA's nested Evidence: 108.6% over 11 real results and up to 111.6%, larger in 23 of 26 census rows. TOON's own README says compact JSON wins on nested or non-uniform data. One agentic study (unconfirmed) reports an accuracy cost.
- proposal: Default CLI output to compact JSON (what MCP text already uses). Keep TOON or CSV for explicitly tabular views (--view rows, inventories). Optionally use 'auto', which picks TOON only when the payload's tabular eligibility is high. Owner: CLI output adapter (incur format default).
- expected gain: About 8% fewer tokens on every default CLI result, and more on nested ones (about 11k o200k tokens over the 11 measured results). It also removes one accuracy risk.
- effort: small
- risk: Users or scripts that parse the default TOON would break, so changing the default is a breaking change unless gated or announced. Agents that already pass --json are unaffected.
- judge: Rerun /home/user/rea-design/discover/research-context/format-compare.mjs over the 169 census baseline outputs (census-cli-output/raw/results.jsonl) and report the total o200k of default output before and after. Done when default output is no larger than compact JSON on every row.

### Lead every large result with the answer and put the full payload behind handles and resource links

- problem: Claude Code saves any text result over 50,000 characters to a file and hands the model a path. Gemini truncates at 40,000 characters and summarises above 20k tokens. Codex keeps about 10k tokens. A naive analyze_javascript_application result was 104k o200k tokens in compact JSON. In every client the model sees only the head or an LLM summary of such a result. The census lens found that limitations and repeated strings make up 21 KB of the 44.7 KB of text in the frugal 10-call task.
- proposal: Give every result a fixed answer-first envelope: verdict or answer, counts, at most N highlights, coverage and limitations once, then handles (evidence_id, view names, next calls). Return the full Evidence as an MCP resource_link (with size and annotations.priority) or as an --evidence_output path, not inline, whenever it exceeds a budget well under 50,000 characters. Set _meta['anthropic/maxResultSizeChars'] only on tools whose full output is the answer, such as decompile. Owner: src/server/ToolResultDelivery.ts and the CLI output adapter.
- expected gain: The model sees the answer within the first ~2k tokens in every client. Context cost per large call is bounded at a few thousand tokens instead of 25k to 100k+. The census frugal task (12.1k tokenx of text) is the floor to beat.
- effort: medium
- risk: Clients that do not fetch resource_link targets would lose content, so the handle must also work through inspect_analysis_view or a CLI path. The digest must not drop limitations, which REA treats as part of the answer.
- judge: Rerun census-mcp/07-task.mjs naive and frugal on the snapshot and on the change. Report total model-visible tokens and whether each step's answer appears in the first 2,000 tokens (answer-position.tsv method). Also test in Claude Code that no result hits the 50k-character persist path. 10 calls × 2 modes × 2 builds.

### Make --token-limit an upper bound on real tokens

- problem: The tokenx estimator behind --token-limit undercounts real BPE tokens by 1.18x on average and up to 2.97x (28 census rows). An agent that asks for 2,000 tokens can get almost 6,000, so its budget is not met, and client limits are counted in characters or real tokens.
- proposal: Calibrate --token-limit conservatively: either count with a bundled BPE tokenizer, or limit on a character bound tied to a worst-case chars-per-token for JSON and TOON. Say in the output which estimator was used.
- expected gain: The budget holds (ratio of real to requested tokens of 1.0 or less), which makes the option usable for fitting agent context.
- effort: small
- risk: Results come out slightly shorter for the same flag value. Bundling a tokenizer adds dependency size. No tokenizer matches every model, so state the bound.
- judge: Rerun the 28 '--token-limit 2000' rows from census-cli-output/specs and check that o200k ≤ 2,000 on every row (and spot-check with Anthropic count_tokens if a key is available).

### Mark tools read-only when their only effect is additive, server-internal Evidence retention

- problem: 254 of 263 tools are readOnlyHint=false, including 124 of the 129 inspect/list/get/search/compare tools, because retaining session Evidence counts as a mutation. Claude Code runs only read-only calls in parallel, so batches of independent inspections run one after another. Some clients also use readOnly for permission prompts.
- proposal: In annotationsFromEffects (src/contracts/toolEffects.ts:98), stop treating additive, idempotent, session-only Evidence retention as modifying the environment. Keep readOnlyHint=false for real session mutations such as close_binary, settings, annotations and unknown updates. This needs a decision on MCP semantics ('does not modify its environment').
- expected gain: Parallel execution of independent inspect calls in Claude Code: roughly the sum of call times becomes the longest call on multi-target questions, plus safe retry after a dropped connection.
- effort: small
- risk: Semantic drift. If retention can evict or replace Evidence under the memory bound, retention is not purely additive. Clients that auto-approve read-only tools would approve these calls without asking.
- judge: Count annotations before and after. In Claude Code, time a prompt that needs 5 independent inspections (for example inspect_artifact on 5 files) on both builds and compare wall time and the transcript's parallel blocks. About 10 runs.

### Make cross-call state explicit handles in tool arguments, ready for stateless MCP

- problem: REA's instructions say 'An opened target persists across turns', and retained Evidence lives in the connection's session. MCP 2026-07-28 removes protocol sessions and expects state to travel as server-minted handles in tool arguments. The census shows 'a one-shot command retains no session Evidence for retained-evidence references', so the CLI route already lacks this continuity. Claude Code context editing clears old tool results (by default it keeps only the 3 most recent), so a handle has to survive in the agent's notes rather than in the transcript.
- proposal: Return a stable handle from open_binary and from Evidence-producing calls: a session or snapshot id that can be resolved from disk (snapshot_path or an evidence file). Accept it as an ordinary argument on follow-up tools, so a new connection, a CLI call or a context reset can continue. Owner: session layer in src/server and the evidence store.
- expected gain: Sessions survive client reconnects, context resets and the move to MCP 2026-07-28. The CLI and MCP routes converge.
- effort: large
- risk: This touches session semantics and Evidence ownership rules (AGENTS.md). A handle that outlives its owner needs lifetime and cleanup rules, and stale handles must fail closed.
- judge: A scripted run: open and analyse on connection A, kill the server, start connection B and continue with inspect_analysis_view by handle only. Then the same over the CLI. It passes when the result matches the uninterrupted run. 2 routes.

### Bring the skill under 500 lines and add tables of contents to the references

- problem: Triggering the skill loads 680 lines (about 10.8k o200k tokens), 75% of it the 'Route the target first' table, against the 500-line guidance. 8 reference files exceed 100 lines and none has a table of contents, so an agent that previews with head misses most of native-and-artifacts.md (1,048 lines).
- proposal: Move the routing table into references/routing.md, split by target kind, and keep a 10 to 15 line routing index in SKILL.md. Add a 'Contents' list at the top of every reference over 100 lines. Keep references one level deep. Owner: .agents/skills/reverse-engineer-anything (source).
- expected gain: Roughly 6k to 8k fewer tokens per skill trigger, and reference sections that can be found under partial reads.
- effort: small
- risk: Routing lookups become one more file read. If the index is too thin the agent picks the wrong first tool, so measure route accuracy.
- judge: census-skill route runs (04-route-runs) on before and after: tokens loaded until the first correct tool call, and route accuracy on 20 target types.

### Adopt MCP tasks for long captures and whole-program operations

- problem: Captures, decompile-all and clone-run captures can outlast client deadlines. REA's instructions spend a paragraph on 'a host timeout without a REA result is a client deadline'. Claude Code moves calls longer than 2 minutes to the background, Codex enforces tool_timeout_sec, and agents re-run uncertain work.
- proposal: Behind a capability check, offer task-augmented execution (2025-11-25 execution.taskSupport 'optional'; the 2026-07-28 io.modelcontextprotocol/tasks extension with polling) for the long-running tool families. Keep progress notifications.
- expected gain: No lost work or replays on long operations. The instructions can shed the timeout prose (about 150 tokens of every session).
- effort: medium
- risk: Tasks are experimental and were redesigned between spec revisions, and client support is uneven. Implement it as an extension negotiated per client, not as the only path.
- judge: Run capture_browser_scenario or decompile_all with a 30-second client deadline in a client that supports tasks. Count re-runs and lost results before and after.

### Measure every context change with a small agent eval before shipping it

- problem: The published evidence says description and format changes cut both ways. Rewriting smelly descriptions raised success a median 5.85 points but added 67% more steps and hurt in 16.7% of cases (unconfirmed). TOON saves tokens on tables but costs accuracy on nested data. REA's own rule is to count the whole task. The census measures bytes and tokens but not agent success.
- proposal: Keep a 20-task agent eval with verifiable outcomes (Anthropic: start with about 20; the clone-run referee is a model of a verifiable outcome). Track success, total tokens, tool calls and errors, use a held-out half, and run it before and after each change above.
- expected gain: Changes that only move tokens around are caught before they ship, and changes that help can be quantified.
- effort: medium
- risk: Running agents costs money and is non-deterministic, so it needs repeats (at least 3 per task) and fixed models.
- judge: The eval itself: the same 20 tasks × 3 repeats on the snapshot give a baseline with a confidence interval, and each change must beat it on tokens without losing success.

## Open questions (7)

- What do Claude Code, Codex and Gemini CLI put into the model's context when a result carries both structuredContent and the duplicate text block? The census shows the bytes on the wire are doubled (93.4 KB wire against 44.7 KB text on the 10-call task). If any client forwards both, REA pays twice. Nothing I fetched answers this. It needs a transcript or proxy capture in each client.
- Claude tokenizer counts were not measured. All token figures are o200k BPE or tokenx, and the TOON comparison could shift on Claude's tokenizer (Anthropic's count_tokens endpoint needs a key).
- What is Cursor's current MCP tool cap (40, 80, or dynamic discovery)? docs.cursor.com was not fetched.
- Is readOnlyHint=true defensible for tools whose only effect is retaining session Evidence, given REA's memory bound (maximum_representation_bytes)? Can retention evict anything?
- Should REA choose a catalogue profile from initialize clientInfo, which conflicts with the documented 'setup does not infer refresh from a client name'? That is an owner decision.
- Several primary sources were unreachable from this session's network: arxiv.org, huggingface.co, modelcontextprotocol.io (the spec was read via raw.githubusercontent.com instead), developers.openai.com, code.visualstudio.com (read via the vscode-docs GitHub raw), docs.github.com and blog.langchain.com. To confirm the arXiv numbers (tool-description smells 2602.14878, RAG-MCP 2505.03275, the TOON agentic study 2605.29676) and LangChain's tool-count benchmark, those hosts would have to be allowed in this session's network settings.
- Does MCP's 'SHOULD also return the serialized JSON in a TextContent block' rule leave room for the text block to be a short digest while structuredContent carries the full object? Read literally it does not, so any digest-in-text design departs from a SHOULD.

## Details

FILES SAVED (durable): /home/user/rea-design/discover/research-context/

- format-compare.mjs: pretty JSON, compact JSON and TOON o200k counts for any set of REA result JSONs. Usage is in the header comment; the TOON encoder is from /home/user/rea-snap/node_modules/@toon-format/toon and gpt-tokenizer comes from the census scratch.
- format-compare.tsv: results (below).
- tools-list-order.mjs: two tools/list calls on one connection to check order and pagination.
- print-server-instructions.mjs: prints the initialize instructions.
- web-excerpts/: copies of the primary sources quoted. These are the MCP 2025-11-25 and 2026-07-28 changelogs and server/tools pages; the Claude Code MCP output-limits, tool-search and annotations sections; the Gemini CLI truncation and distillation settings; and the VS Code 128-tool note.
  Scratch: /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-discover/research-context (raw web pages, unpacked census calls, CLI format samples).

TABLE 1: format comparison on real REA results (o200k; MCP text is already compact JSON)
| result | pretty | compact | TOON | TOON % of compact |
| search_guidance | 520 | 447 | 471 | 105.4 |
| open_binary | 124 | 105 | 108 | 102.9 |
| inspect_artifact | 6760 | 5590 | 5779 | 103.4 |
| analyze_javascript_application (naive, full) | 137756 | 104101 | 113926 | 109.4 |
| inspect_analysis_view | 2368 | 2002 | 2023 | 101.0 |
| inspect_web_network_capture | 3734 | 2755 | 2755 | 100.0 |
| compare_static_and_observed_endpoints | 1477 | 1204 | 1267 | 105.2 |
| inspect_api_contract | 1584 | 1314 | 1378 | 104.9 |
| inspect_binary_hardening | 1916 | 1409 | 1572 | 111.6 |
| export_evidence_bundle | 91 | 74 | 79 | 106.8 |
| rea capabilities (CLI --json) | 12483 | 9475 | 10103 | 106.6 |
| TOTAL | 168813 | 128476 | 139461 | 108.6 |
The CLI --json output is compact (44,953 bytes against 44,952 re-serialized). The default CLI format is TOON (census-cli-output).

TABLE 2: how clients treat catalogues and results (what a server can do)
| client | catalogue | result size | what a server can do |
| Claude Code | tool search on by default; names and instructions upfront; descriptions cut at 4,096 chars upfront / 16,384 deferred | warn at 10k tokens; 25k default max; >50,000 chars saved to file with a path | instructions as a skill-like trigger; _meta anthropic/alwaysLoad; _meta anthropic/maxResultSizeChars (≤500k); readOnlyHint for parallel calls; idempotentHint for retry |
| Codex | tool search default since rust-v0.143.0; enabled_tools per server | tool_output_token_limit (10k default for Codex models); per-tool output_token_limit (v0.152.0) | keep namespaces small; document per-tool limits |
| Copilot CLI | tool search (docs.github.com page not reachable) | n/a | n/a |
| VS Code Copilot | hard cap 128 tools per request; experimental virtualTools grouping | not fetched | ship profiles of 128 tools or fewer |
| Cursor | first 40 tools historically (forum); current limit unconfirmed | not fetched | small profile, important tools first |
| Gemini CLI | names prefixed mcp_ and truncated at 64 chars (Zuplo page, secondary) | truncate at 40,000 chars; distill to 10k tokens; LLM-summarise >20k; mask old outputs | answer first, since the head survives truncation |

TABLE 3: principle, what REA does today, what it implies

- Few, distinct, searchable tools (Anthropic writing-tools; tool-search docs). REA has 263 tools, a hot-cold profile, family scoping, no shared family prefix, no alwaysLoad, and instructions that do not say when to search. Implication: opportunities 1 and 2.
- Concise/detailed response switch and summaries with handles (writing-tools; context engineering). REA has --detail summary, retained Evidence, views and paging, but large full results still go inline when asked for and limitations repeat across pages. Implication: opportunity 4.
- Truncation with sensible defaults that steers the agent (writing-tools). REA has --token-limit, but the estimator undercounts by up to 2.97x. Implication: opportunity 5.
- Choose the result format by evaluation (writing-tools; TOON README). REA defaults to TOON, which is larger on its own data. Implication: opportunity 3.
- Annotations for safety and concurrency (MCP spec; Claude Code). REA derives them from effects, but only 9 are read-only. Implication: opportunity 6.
- Structured output and resource links (MCP 2025-11-25). REA has no outputSchema by default (deliberate), no resource_link and no resources advertised, and puts structuredContent and identical text on the wire. Implication: opportunity 4 and the open question about duplication.
- Stateless MCP with explicit handles (2026-07-28). REA's state is connection-scoped. Implication: opportunity 7.
- Long-running operations through tasks (2025-11-25 experimental; 2026-07-28 extension). REA has progress notifications and timeout prose but no tasks. Implication: opportunity 9.
- Skills: progressive disclosure, a body under 500 lines, tables of contents (skill best practices). REA's body is 680 lines and no reference has a table of contents. Implication: opportunity 8.
- Memory and context editing (context-management): old results get cleared, so state must be re-fetchable by handle. REA has retained Evidence and evidence files, plus gate.json and journal.jsonl for clone runs (already good). Implication: opportunity 7 and keeping handles in agent notes.
- Long-running harness: feature list, progress file, verification. evaluate-clone-run already follows this; it is already good.
- Evaluate with real agent tasks (writing-tools; multi-agent; smells study). The census measures tokens, not success. Implication: opportunity 10.

THE TEN CHANGES THE RESEARCH MOST STRONGLY SUPPORTS (with sources)

1. Write the searchable surface for client tool search: instructions with categories, keywords and when to search; alwaysLoad on 3 to 5 hot tools; keywords at the start of descriptions; family prefixes. Sources: code.claude.com/docs/en/mcp (tool search for server authors, 4,096/16,384 cuts, anthropic/alwaysLoad); platform.claude.com tool-search-tool (fields searched, 3 to 5 non-deferred, prefixes, category prompt); anthropic.com/engineering/advanced-tool-use (49→74%, 79.5→88.1%); github.com/openai/codex/releases/tag/rust-v0.143.0.
2. Fit capped clients with profiles of 128 tools or fewer and of 40 or fewer, important tools first, and a doctor warning. Sources: vscode-docs docs/agents/run/tools.md (128 limit); forum.cursor.com 40-tool threads (unconfirmed); platform.claude.com tool-search-tool (selection degrades past 30 to 50 tools).
3. Default to compact JSON; use TOON or CSV only for tabular views. Sources: my format-compare.tsv; census-variants.tsv; github.com/toon-format/toon (compact JSON wins on nested and non-uniform data); arXiv 2605.29676 (unconfirmed); anthropic.com/engineering/writing-tools-for-agents ('response structure… affects performance, choose based on your evaluations').
4. Answer-first envelopes with handles and resource_link for full payloads; maxResultSizeChars only where the full output is the answer. Sources: MCP 2025-11-25 server/tools (resource_link, annotations); code.claude.com/docs/en/mcp (50k-char persist, 25k tokens); Gemini CLI configuration (40k chars, distillation); Codex issue 7867 (10k); anthropic.com/engineering/effective-context-engineering-for-ai-agents (lightweight identifiers); anthropic.com/engineering/multi-agent-research-system (references instead of telephone).
5. A --token-limit that bounds real tokens. Sources: census-variants.tsv (1.18x mean, 2.97x max); writing-tools (truncation with sensible defaults).
6. readOnlyHint for additive Evidence retention. Sources: code.claude.com/docs/en/mcp (read-only calls run in parallel; idempotent calls retried); MCP spec tool annotations; src/contracts/toolEffects.ts:94-116.
7. Explicit, durable handles for sessions and Evidence. Sources: MCP 2026-07-28 changelog (SEP-2567 and SEP-2575, stateless with server-minted handles); platform.claude.com context-editing (oldest results cleared, keep 3); claude.com/blog/context-management (memory tool +39%); anthropic.com/engineering/effective-harnesses-for-long-running-agents.
8. Skill body of 500 lines or fewer, routing moved to a reference, tables of contents in references. Sources: platform.claude.com agent-skills best-practices; anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills; census-skill/01-measure.md.
9. MCP tasks for long operations, negotiated per client. Sources: MCP 2025-11-25 basic/utilities/tasks; MCP 2026-07-28 changelog item 6 (tasks extension); code.claude.com/docs/en/mcp (background after 2 minutes).
10. A 20-task agent eval gate that tracks success, tokens, calls and errors. Sources: anthropic.com/engineering/writing-tools-for-agents (evaluation section); anthropic.com/engineering/multi-agent-research-system (start with about 20 queries, 40% faster after description fixes); arXiv 2602.14878 (description rewrites cut both ways; unconfirmed).

Also considered and ranked lower:

- Programmatic tool calling and code mode (37% fewer tokens): REA's CLI already acts as a code-callable surface, and documenting return formats (outputSchema) would help it. This is covered by the compact output schema profile.
- input_examples (72→90% on complex parameters): MCP has no field for examples, but REA's largest schemas (update_analysis_settings at 3,138 tokenx) are where examples in the description would pay off.
- Deterministic list order: REA already meets it.
