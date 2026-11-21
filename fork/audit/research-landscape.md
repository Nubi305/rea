# research-landscape

## Summary

I surveyed six areas next to REA. Only github.com and anthropic.com pages would open from this container. arxiv.org, playwright.dev, modelcontextprotocol.io, schemathesis docs and simonwillison.net were blocked, so claims from those come from search-result excerpts (marked unconfirmed or documented with the URL) and should be re-read before anyone quotes them. The main result: REA's clone-run referee already uses the strongest pattern in the field, Twitter Diffy's noise subtraction. It takes two or more clean captures per side, reads a field as noise only where the original disagrees with itself, and keeps replay deterministic with no LLM judge. Most clone and web-generation benchmarks still grade with LLM judges or visual similarity (WebGen-Bench, Copy Bench, Design2Code). REA's context discipline is also ahead of most RE-for-agent servers: every command takes --token-limit, --token-offset, --token-count and --filter-output, the default output format is toon, `rea --llms` costs 7,862 tokens, and agents pass paths instead of payloads. The gaps are where adjacent fields have learned hard lessons. First, every scenario is visible to the builders. RepoMod-Bench uses hidden boundary tests because visible tests invite "test-driven overfitting", and Copy Bench keeps 37 of its 50 tasks private. Second, volatile values are compared "by shape only" with no identity across steps (scenarioBehaviorComparison.ts:124-128), which is the root of round-2 findings vp-1 and vp-2. ApprovalTests scrubbers that track duplicates, and Hypothesis bundles, avoid this. Third, inputs are only what probers think to write. Schemathesis and Hypothesis generate inputs and step sequences and shrink them. REA even has unused CDP precise coverage that could measure how much of the original its scenarios exercise. Fourth, the clean-room check stops at byte-identical files and declared names. The 2026 chardet dispute (JPlag 1.29%) and Launder-Bench (best static detector 0.66 AUROC) show that similarity scores cannot prove independence, so what REA needs is a record of what each role read, plus a near-duplicate red flag. Fifth, a single MCP server still holds one implicit target. ida-pro-mcp (a database id on every call) and r2mcp (X-Session-ID) show the fix, and GhydraMCP moved to a --json CLI, which supports REA's CLI-only decision. My top ten ideas are listed in opportunities, best first. The tables and measurements are saved under /home/user/rea-design/discover/research-landscape/.

## Facts (22)

- [source-derived] REA's referee compares only outcome, requests, statuses, fetched reply bodies, page address and accessibility text; appearance, styles, images, fonts, headers, title, timing, iframe text and dialog text are not compared.
  - evidence: /home/user/rea-snap/src/application/cloneRun/CloneRunEvaluation.ts:113-114 (CLONE_RUN_RESIDUAL_TRUST)
- [source-derived] An honoured volatile field is compared by its shape only (JSON type, and string layout). No identity is kept across steps: the clone can return a different id at each step, or an id that does not match the one it echoes later, and still pass.
  - evidence: /home/user/rea-snap/src/domain/scenarioBehaviorComparison.ts:124-128 volatileValueShape, :378-425 misshapenIndex/outcome 'shape'; CloneRunEvaluation.ts:108; /home/user/rea-design/m1/findings-round2.md vp-1, vp-2
- [source-derived] The clean-room check covers declared names and byte-identical files (64 KiB each at most) only. Rewritten, reformatted or paraphrased copies are not detected.
  - evidence: CloneRunEvaluation.ts:110
- [source-derived] REA already has a Diffy-style noise model. It requires at least two clean captures per side, reports parity_unstable when the original disagrees with itself, and honours a volatile declaration only where the original's own captures differ.
  - evidence: /home/user/rea-snap/skills/reverse-engineer-anything/references/clone-runs.md:146-157; Diffy: https://github.com/opendiffy/diffy ('Non-deterministic noise' between primary and secondary)
- [source-derived] REA ships CDP precise JS coverage code, but the clone-run code does not use it.
  - evidence: grep: CdpPreciseCoverage in src/browser/execution/CdpPreciseCoverage.ts, CdpExecutionCapture.ts, CdpRuntimeSession.ts; no match under src/application/cloneRun/
- [ran-it] The REA CLI already offers token controls on every command: --token-count, --token-limit, --token-offset, --filter-output, --format toon and --llms. The manifest costs 7,862 tokens with --llms and 59,426 with --llms-full. A guidance search for 'prober role card' costs 416 tokens.
  - evidence: node /home/user/rea-snap/scripts/rea.mjs guidance --help; rea --llms --token-count -> 7862; rea --llms-full --token-count -> 59426; guidance --query 'prober role card' --token-count -> 416 (saved in /home/user/rea-design/discover/research-landscape/measurements.txt)
- [ran-it] The skill an agent loads is 687 lines and 49,095 bytes (SKILL.md), plus 499 lines and 28,546 bytes for clone-runs.md, about 19k tokens together at bytes/4. Anthropic-attributed guidance is to keep SKILL.md under 500 lines, and Codex caps AGENTS.md at 32 KiB by default.
  - evidence: wc on /home/user/rea-snap/skills/reverse-engineer-anything; https://developers.openai.com/codex/guides/agents-md (project_doc_max_bytes 32 KiB); the 500-line figure comes from secondary write-ups such as https://dev.to/0xmariowu/claude-code-skills-and-claudemd-how-they-fit-together-97o
- [documented] ida-pro-mcp uses batch-first tools and cursor pagination. Its default limit is 1000 with an enforced maximum of 10000 'to prevent token overflow'. Debugger tools are hidden by default (?ext=dbg), and every tool call takes an explicit database session id.
  - evidence: https://github.com/mrexodia/ida-pro-mcp
- [documented] GhydraMCP returns _links (next/prev/related) in every reply and supports several Ghidra instances on separate ports. It is deprecating its MCP bridge in favour of the 'ghydra' CLI with --json mode.
  - evidence: https://github.com/starsong-consulting/GhydraMCP
- [documented] r2mcp offers a -R read-only mode, tool enable and disable settings, approval gating for 'dangerous run tools', and per-session state through -X with an X-Session-ID header.
  - evidence: https://github.com/radareorg/radare2-mcp
- [documented] jadx-mcp-server strips Kotlin metadata by default (slim=True), which it says is 'often 25-50% of a Kotlin dump'. Its adapter caps each result with --max-tool-chars.
  - evidence: https://github.com/zinja-coder/jadx-mcp-server
- [documented] Anthropic guidance: Claude Code limits tool responses to 25,000 tokens by default; a concise response_format used 72 tokens against 206 for detailed; sub-agents should return condensed summaries of about 1,000-2,000 tokens; notes kept outside the window (NOTES.md) carry state across long tasks; code execution with MCP cut one task from 150,000 to 2,000 tokens.
  - evidence: https://www.anthropic.com/engineering/writing-tools-for-agents ; https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents ; https://www.anthropic.com/engineering/code-execution-with-mcp
- [unconfirmed] RepoMod-Bench grades with a hidden test suite that talks only through CLI or REST interfaces, because visible unit tests let agents 'cheat' through 'test-driven overfitting'. Agents average a 15.3% pass rate on projects over 50K LOC.
  - evidence: https://arxiv.org/html/2602.22518 (search excerpt; arxiv blocked from this container)
- [unconfirmed] Copy Bench (rebuild a component from a screen recording) keeps 37 of its 50 tasks private, excludes copied or empty copies, and grades with two LLM judges. Motion averages 33/100 against 76 for typography.
  - evidence: https://21st.dev/benchmarks/copy/method (search excerpt)
- [unconfirmed] ImpossibleBench measures cheating as the pass rate on tasks whose tests contradict the spec. One prompt change cut one model's cheating from 92% to 1% on the LiveCodeBench variant.
  - evidence: https://arxiv.org/abs/2510.20270 (search excerpt)
- [unconfirmed] WebGen-Bench runs 647 operation and expected-result cases with a WebVoyager agent and scores YES=1, PARTIAL=0.5. The best system reached 27.8%.
  - evidence: https://arxiv.org/abs/2505.03733 (search excerpt)
- [unconfirmed] Interaction2Code's most frequent failures in generated interactive pages are 'No interaction', 'Partial implementation', 'Interactive element missing' and 'Wrong function'.
  - evidence: https://arxiv.org/abs/2411.03292v3 (search excerpt)
- [unconfirmed] The 2026 chardet 7.0 relicensing showed a JPlag max similarity of 1.29% to the prior release and was still disputed as not clean room. Launder-Bench reports that the best static provenance detector reaches 0.66 AUROC against agentic rewrites, and a 2026 paper argues that a low similarity score does not show independence.
  - evidence: https://lwn.net/Articles/1061534/ ; https://arxiv.org/pdf/2611.01966 ; https://arxiv.org/pdf/2611.07887 (search excerpts)
- [documented] Dolos detects near-duplicate code with tree-sitter tokenization and winnowing fingerprints (Schleimer et al. 2003). It supports JavaScript, and its core matching library is TypeScript.
  - evidence: https://github.com/dodona-edu/dolos ; https://arxiv.org/pdf/2402.10853
- [documented] Playwright aria snapshots compare role/name trees in YAML, with regex names, partial matching and '/children: equal' for exact ordered children. toHaveScreenshot uses a per-pixel threshold (default 0.2) and maxDiffPixels.
  - evidence: https://github.com/microsoft/playwright/blob/main/docs/src/aria-snapshots.md ; https://github.com/microsoft/playwright/blob/main/docs/src/test-snapshots-js.md
- [documented] Schemathesis generates API inputs from a schema, chains operations into stateful workflows, and 'learns constraints, ids, and auth from responses, reusing them mid-run'.
  - evidence: https://github.com/schemathesis/schemathesis
- [unconfirmed] SWE-bench images leaked fixes through git history: agents used 'git log --all' to reach future commits. Cursor reports a 9% rate of this in one model's trajectories before images were cleaned.
  - evidence: https://cursor.com/blog/reward-hacking-coding-benchmarks (search excerpt)

## Already good (8)

- Diffy-grade noise handling: at least two clean captures per side, parity_unstable when the original disagrees with itself, volatile declarations honoured only where the original varies, and missing data never counting as a match (clone-runs.md:146-157; design_doc.md section 'What done means').
- A deterministic referee with no LLM judge, recomputed from authenticated Evidence, with clone Evidence tied to the clone tree digest. This is stricter than WebGen-Bench, Copy Bench or Design2Code, which rely on LLM judges or visual similarity (CloneRunEvaluation.ts; `rea evaluate-clone-run --help`).
- Scientist-style accepted mismatches with accountability: waivers need a named person and a reason, and intended-differences.json declares renames. The gate lists the declarations that took effect (CloneRunEvaluation.ts:108-109).
- A clean-room wall built into the file layout, so builders read only specs/, obligations/, behavior/ and gate.json. This mirrors the Phoenix BIOS split between examiners and implementers (design_doc.md:67).
- Context discipline ahead of most RE MCP servers: CLI one-shots, --detail summary with --evidence_output, inspect-analysis-view paging, --token-limit/--token-offset/--token-count/--filter-output/--format toon on every command, passing paths instead of payloads, and a `next` capped at ten items, each with the exact command (`rea guidance --help`; clone-runs.md:96-118).
- Session survival through external state, as Anthropic's NOTES.md advice recommends: all state lives in the run folder and re-running the referee resumes (clone-runs.md:45-47).
- A residual_trust list that says plainly what a pass does not cover. Benchmark-audit papers (ABC checklist, the CUA mis-scoring audit) ask for exactly this (CloneRunEvaluation.ts:100-115).
- The existing building blocks most of the ideas below need: compare-web-screenshots, an ariaSnapshot capture (PlaywrightScenarioArtifacts.ts:95), CDP precise coverage (src/browser/execution/CdpPreciseCoverage.ts), inspect-api-contract for OpenAPI, and HAR/mitmproxy ingestion (inspect-web-network-capture).

## Opportunities (10)

### Held-out scenarios the builders never see

- problem: Every scenario's original behaviour goes into behavior/, which builders read, so a clone can be fitted to exactly the recorded steps. RepoMod-Bench names this 'test-driven overfitting' and grades through a hidden boundary suite, and Copy Bench keeps 37 of 50 tasks private. REA has no measure of overfitting today: residual_trust says the verdict covers only the steps the scenarios contain.
- proposal: Let the lead mark scenarios (or a random fraction, e.g. 20%) as holdout in target.json. The referee leaves holdout steps out of behavior/ and out of the builder-facing parts of gate.next (the worklist names only 'holdout failed: N steps in area X'), and still requires them for done. Owning files: src/application/cloneRun/CloneRunEvaluation.ts, CloneRunWorkspace.ts, cloneRunSchemas.ts, references/clone-runs.md.
- expected gain: Catches clones that pass visible steps but fail unseen ones. Expected to surface a measurable visible-versus-holdout pass gap, the overfitting rate, on blind trials. Builder context cost is zero.
- effort: medium
- risk: Holdout failures give builders less to act on, which can raise round counts and push runs toward 'stalled'. It needs a reveal rule, such as showing a holdout step after two failing rounds, then retiring it to visible and drawing a fresh one. It is compatible with existing run folders if the setting defaults to none.
- judge: Rerun the m1 blind trial with 20% holdout and report the pass rate on visible against holdout steps, plus rounds to done. Success means a seeded overfit clone (special-cases only the recorded inputs) fails the holdout while a genuine clone passes. Size: one trial target, two clones.

### Consistent placeholder binding for volatile values

- problem: Honoured volatile leaves are compared by shape only (scenarioBehaviorComparison.ts:124-128). A clone that returns a fresh UUID at every step, or creates id A and then serves id B, passes. Round-2 vp-1 and vp-2 are this class: a wildcard volatile pointer hides a steady wrong value.
- proposal: Treat volatile values the way ApprovalTests scrubbers 'track duplicates' and Hypothesis Bundles carry values between steps. Within one capture, map each distinct volatile value to a placeholder ($v1, $v2, and so on) at its first occurrence, and require the same equality pattern on both sides wherever the value reappears: later reply leaves, request URLs and bodies, and the page address. Keep the shape check. Owning file: src/domain/scenarioBehaviorComparison.ts.
- expected gain: Closes the referential-integrity hole for ids, tokens and timestamps that are echoed back, without new declarations. vp-1 and vp-2 become not_done.
- effort: small
- risk: An original that legitimately mints two equal values by coincidence would bind them as one. Binding only values at least 8 characters long, or with an id or timestamp shape, limits this. Some existing passing runs could flip to not_done, which is correct but needs a changelog note.
- judge: Add the m1 vp-1 and vp-2 cases and a mutant clone whose POST /items returns a new id that GET /items/{id} does not echo. All three must read not_done, and the m1 genuine-clone trial must still read done. Size: about 4 comparer tests and one trial rerun.

### Mutant canaries: the referee checks its own sensitivity on every run

- problem: Nothing tells the lead whether the scenarios and declarations could detect a wrong clone at all. Over-broad volatile or rename declarations (vp-1, vp-3) silently blind the referee. ImpossibleBench and the ABC checklist show that graders need built-in canaries. The m1 'slug mutant' was a single hand-made check.
- proposal: Offline, with no target needed: for each cited step, synthesise mutated right-side captures from the original's own admitted captures. Flip one non-volatile JSON leaf, change a status, drop a request, or alter an accessibility line. Run the existing comparer on each mutant and report in gate.json a 'sensitivity' figure: the fraction of mutants detected per obligation, with any leaf or pointer where a mutation goes undetected. A mutant that survives because of a declaration names that declaration. Owning files: CloneRunEvaluation.ts and a new domain helper beside scenarioBehaviorComparison.ts.
- expected gain: Each wildcard volatile, rename or setup- relabelling that blinds the referee becomes visible as a surviving mutant. The lead gets a number (for example 'mutation sensitivity 97%, 3 survivors at /items/*/price') instead of trust.
- effort: small
- risk: CPU and time grow with the number of leaves, so it needs a cap such as one mutant per leaf class per step. Survivors under legitimately volatile fields must read as expected. It should be report-only at first, not blocking.
- judge: On the m1 attack-cheat folders, every cheat that read done in round 2 (vp-1, vp-3) must show at least one surviving mutant naming the offending declaration, and a clean run must show 100% sensitivity outside declared leaves. Size: the existing m1 scratch folders.

### Measure how much of the original the scenarios exercise (coverage), using REA's existing CDP precise coverage

- problem: The referee cannot tell whether the scenarios cover the original's behaviour; residual_trust says so. The scout's completeness is unchecked ('Nothing will tell you a page was missed', clone-runs.md:185-186). REA already ships CdpPreciseCoverage, but clone runs do not use it.
- proposal: Have the original's captures record client-side precise JS coverage, as function and block ranges per script URL. For a Node original whose start command the user controls, set NODE_V8_COVERAGE as well. Write a behavior/coverage.json summary: percentage of functions executed, plus the top uncovered functions with their script and an identifier, never code. Add a mapper worklist item when coverage of a first-party script is below a declared floor. Owning files: CloneRunWorkspace.ts (capture input), CloneRunEvaluation.ts, src/browser/execution/CdpPreciseCoverage.ts.
- expected gain: Turns 'covers only the steps the scenarios contain' into a number with a list of uncovered handlers. This is an outside judge for scout, mapper and prober work, at roughly 1-5 KB per capture of summary.
- effort: medium
- risk: Coverage of minified bundles is noisy, and server-side coverage exists only for Node originals the user starts. Coverage of the original's code is read by the mapper, not builders, so the clean-room wall holds, but the summary must hold no source text.
- judge: On the m1 trial target, seed three bugs into the clone in behaviour whose original handler the scenarios do not reach. Show that the coverage report lists those handlers as uncovered, and that adding probes for them turns the run not_done. Size: one target, three seeded bugs.

### Differential exploration that writes scenarios (Schemathesis and Hypothesis style)

- problem: Every input is hand-written by probers. Scenario comparison catches nothing in inputs nobody thought of, such as boundary values, wrong types, long strings or unusual orderings. WebGen-Bench and Interaction2Code show that missing and partial interactions are the most common rebuild failures.
- proposal: Add `rea explore-clone-run <folder> --budget N`. From the request shapes in behavior/ (and inspect-api-contract when an OpenAPI file exists), generate request steps with boundary and invalid values and short random sequences that reuse returned ids, as Schemathesis stateful testing does. Run each against both addresses in lockstep from a reset. Shrink every divergence to a minimal sequence and write it as a proposed scenarios/explore-<n>.json plus an unknown for the lead. Nothing becomes evidence until it is captured through the normal path.
- expected gain: Finds divergences outside the recorded scenarios at no prober context cost, because only the shrunk sequences reach an agent.
- effort: large
- risk: It writes to the original, so it needs the disposable-instance statement (already required) and a request budget. Generated requests can trip rate limits. Keeping it proposal-only preserves the referee's trust model.
- judge: Seed 10 bugs in a clone (off-by-one limits, a missing validation, wrong status on a duplicate). Compare the bugs found by the hand-written m1 scenarios with those found by scenarios plus exploration at a fixed budget, such as 500 requests. Success means exploration adds at least 3 bugs the scenarios missed.

### Per-role read journal as clean-room provenance, with near-duplicate detection as a red flag only

- problem: The wall is enforced by convention plus a planned hook. Nothing records what a builder actually read, and the copy check stops at byte-identical files. The chardet case (JPlag 1.29%, still disputed) and Launder-Bench (best detector 0.66 AUROC) show that similarity cannot prove independence; provenance can.
- proposal: (a) In the milestone-3 Claude Code package, have the PreToolUse hook that denies builders reads under evidence/ and scout/ also append every read path, with role and time, to a journal the referee lists. gate.json then states 'builder reads outside the wall: 0', or names them. (b) Add a winnowing fingerprint check (Dolos approach, k-grams over tokens) between clone files and scout/ scripts plus captured reply bodies. Above a threshold it blocks with file and line spans; below it, it never claims independence. Owning files: CloneRunCleanRoom.ts, the hooks/ package.
- expected gain: Clean-room claims rest on an access record instead of an absence of evidence. Renamed or reformatted copies of original scripts are caught.
- effort: medium
- risk: The journal is only as trustworthy as the harness: shell reads that bypass the hook are invisible, which residual_trust must state. A winnowing threshold can false-positive on shared framework boilerplate, so vendored or framework files need an exclude list.
- judge: Seed (1) a builder subagent told to read evidence/ and (2) a clone file that is an original script with identifiers renamed and reformatted. Both must be reported. The m1 genuine clone must show 0 flags. Size: two seeded cases and one clean trial.

### Explicit target and Evidence-store handle on every MCP call

- problem: The design forbids sharing an MCP session because one REA server holds one active target and a second agent silently retargets the first. That forces CLI-only use for teams and costs the ~97,000-token catalogue per agent (design_doc.md:71). ida-pro-mcp requires a database session id on every call, and r2mcp keys state by X-Session-ID.
- proposal: Accept an optional `target`/`session` handle on target-bound tools. Refuse ambiguous calls when more than one handle is open, instead of switching targets. Return the handle in every reply.
- expected gain: Lets parallel agents share one server safely and removes a class of silent wrong-target results.
- effort: large
- risk: It touches every target-bound contract and the MCP digest, so it needs an upstream scope decision. Old clients must keep working when only one handle exists.
- judge: Run two agents against one server on two targets with interleaved calls. Today the result is wrong-target answers; afterwards zero, with explicit refusals. Size: one scripted two-client test.

### Hidden-by-default tool families and role profiles

- problem: The catalogue costs about 97,000 tokens per agent (design doc). ida-pro-mcp hides its 20 debugger tools unless ?ext=dbg is set, Serena has modes, and the MCP client guidance and Anthropic's tool search both recommend progressive discovery.
- proposal: Ship a small default MCP profile (inspect, evidence, guidance and search tools) and enable other families by flag or by a discover-and-enable meta tool. Role profiles for clone runs would list only the commands in each role card.
- expected gain: Catalogue cost per agent cut by an order of magnitude for typical sessions. The catalogue-cost lens should supply the exact figure.
- effort: medium
- risk: Agents may not find hidden tools, so this depends on good guidance search. Existing MCP users who expect the full catalogue need an opt-out.
- judge: Run tokens-to-completion on 5 representative tasks with full and small profiles, counting failed-to-find-tool events. Success means less than 25% of the tokens with no rise in failures.

### Structure-aware page parity (aria tree) plus screenshot tolerance

- problem: Only accessibility text is compared, not roles, order or layout, and appearance is out of scope (CloneRunEvaluation.ts:113). Design2Code and Interaction2Code show that missing elements, wrong positions and missing interactions are the dominant rebuild failures. Copy Bench shows motion is the weakest area.
- proposal: Compare the captured aria snapshot as a role/name tree, with order and children checked as Playwright's '/children: equal' does and renames applied. In milestone 2, add compare-web-screenshots with a declared pixel threshold and masks for volatile regions, judged against the original's own repeat-to-repeat pixel noise as Diffy does.
- expected gain: Catches a button that becomes a link, reordered lists, missing landmarks and visual regressions, which pure text equality misses.
- effort: medium
- risk: Screenshot baselines vary by platform and font, so both sides must render in the same browser on the same host. That is already true in a clone run.
- judge: Five Interaction2Code-style mutants (element missing, role changed, order swapped, element moved, colour changed). Today most read done; afterwards all read not_done, while the genuine clone stays done.

### Budgeted target brief for scout and mapper (repo-map style)

- problem: Scout and mapper start from crawl captures of 350 KB to 1 MB and a skill of about 19k tokens. Aider's repo map gives a ranked, token-budgeted map (default 1k tokens), and llms.txt gives a small index of a large corpus.
- proposal: `rea brief-clone-run <folder> --budget 1500` prints a ranked list built from admitted Evidence: pages, routes with methods and statuses, forms and inputs, scripts, and surfaces not yet cited by any obligation, ranked by request frequency and uncovered status, within the token budget. It is the mapper's starting point and the lead's re-entry after a reset.
- expected gain: Replaces several inspect-analysis-view calls per role and gives a reset session a sub-2k-token picture of the target.
- effort: small
- risk: A ranked summary can hide a low-traffic surface, so it must say how many items were cut and how to page.
- judge: Have a fresh agent produce surfaces.json on the m1 target with and without the brief. Measure tokens spent and surfaces found against the m1 ground-truth list. Success means at least 30% fewer tokens and no fewer surfaces.

## Open questions (5)

- Several sources could only be read through search excerpts because arxiv.org, playwright.dev, modelcontextprotocol.io, schemathesis docs and simonwillison.net are blocked from this container. The numbers for RepoMod-Bench, Copy Bench, ImpossibleBench, WebGen-Bench, Launder-Bench and chardet should be re-read on the pages before they are quoted in a roadmap.
- Does the comparer already normalise volatile ids that appear inside request URLs (for example GET /items/<uuid>)? If not, scenarios with server-minted ids may read unstable rather than wrong, which would make placeholder binding more urgent. I did not trace this end to end.
- Should held-out scenarios be chosen by the lead or at random by the referee? Random selection resists a lead who games the choice, but makes runs less reproducible unless the seed is recorded.
- Will upstream (morluto/rea) accept a session handle on MCP calls? Its AGENTS.md requires a maintainer scope decision for broad contract changes.
- Is CDP precise coverage cheap enough to keep on for every original capture? Its capture-size and time overhead were not measured here.

## Details

Saved files: /home/user/rea-design/discover/research-landscape/landscape-sources.md holds the per-area table (adjacent practice with URL, what REA matches, what it lacks, the one idea to take) and the basis key. /home/user/rea-design/discover/research-landscape/measurements.txt holds the commands I ran and their outputs.

The one idea to take from each area:

1. RE tools for agents (ida-pro-mcp, GhydraMCP, r2mcp, jadx-mcp-server, ReVa, pyghidra-mcp): an explicit target handle on every call, with tool families hidden by default. REA already beats them on output budgets (--token-limit and the others).
2. Clone and rebuild tools and benchmarks (Design2Code, Interaction2Code, WebGen-Bench, Copy Bench): structure-aware page parity plus a screenshot tolerance. REA is ahead in replacing LLM judges with deterministic replay.
3. Proving equivalence (Diffy, Scientist, ApprovalTests, Pact, Schemathesis, Hypothesis stateful, Playwright, VCR, GoReplay): consistent placeholder binding of volatile values in the short term, and differential exploration that writes scenarios in the long term. REA already has Diffy's noise model and Scientist's ignore mechanism.
4. Clean room (Phoenix BIOS method, the OpenBIOS thread, chardet, Launder-Bench, Dolos): a per-role read journal as provenance, and winnowing similarity as a red flag that never proves independence.
5. Benchmarks and gaming (Commit0, RepoMod-Bench, ImpossibleBench, ABC checklist, the SWE-bench git leak, the CUA mis-scoring audit): held-out scenarios plus mutant canaries.
6. Compact context (Aider repo map, Repomix, llms.txt, AGENTS.md 32 KiB cap, Serena, Context7, Anthropic context engineering): a token-budgeted target brief. REA already has run-folder memory, guidance search and token flags.

My first ten, in order: holdout scenarios; consistent placeholder binding; mutant canaries reporting referee sensitivity; coverage of the original from the existing CdpPreciseCoverage; differential exploration that writes scenarios; per-role read journal plus winnowing check; explicit target handle on MCP; hidden-by-default tool families and role profiles; aria-tree plus screenshot parity; budgeted target brief.

What this lens did not do: it ran no clone run, built nothing, and ran no tests. The only commands run were read-only rea CLI calls (help, guidance search, --llms with --token-count) and greps of /home/user/rea-snap.
