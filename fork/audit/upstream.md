# upstream

## Summary

The fork and upstream barely overlap, so merging is cheap today. Upstream main (head 2533a8b3) is 321 commits past the fork point 1a070de, and they all landed in about 28 hours, roughly 250 a day. Most of them don't touch what agents see: 197 are test consolidations and 75 are parser, CI or desktop fixes. Only 2 are features (IDA's official MCP running headless, and a PPC64 Ghidra lane). There were two releases (6.10.0 and 6.10.1), and one source file holding tool contracts changed (one description, for inspect_plist). I trial-merged upstream into the fork commit 77500a5 in a scratch clone. Three files conflicted, all trivial documentation edits: two nav lists, plus docs/specs/README.md, which upstream deleted. Everything else auto-merged, including SKILL.md. The merged tree type-checks with no new errors: the only error is a Frida-types one that the unmerged fork has too. Upstream's architecture guards and module-boundary verifiers also pass on it. The real drift is a policy change, not code. On 2026-11-20 upstream PR #12856 removed docs/specs, the ADRs and docs/development/roadmap.md, and AGENTS.md now says specs, plans and task lists stay out of Git. Yet 15 fork files point at docs/specs/reconstruction/clone-runs/spec.md, and two tests read it at runtime. Upstream has 679 open issues. By title, about 280 ask for new formats or provider integrations, about 50 are about agent context, catalogue, skill or setup, and about 40 about reconstruction, verification or comparison. In the agent-and-context issues, the most frequent ask is a smaller always-loaded surface. Measured examples from issue authors: tools/list is 4.4 MB by default against 98 KB in the hot/cold profile (#9347); SKILL.md costs about 8,300 tokens on every activation (#8084); one Android search costs about 1M tokens (#9755); and one host sent 249,653 input tokens before any work (#6870). Upstream also has open, unmerged work in the fork's own direction. Most notable: draft PR #11310 adds web-scenario, web-capture and web-screenshot reconstruction claims with recipes. Also open: #4991 and #6367 (negative verifier controls, the same idea as the fork's mutant fixtures) and #7269 (a skill guide for rebuilding online platforms). The fork should keep merging upstream rather than rebase, take release tags at least, and run a daily trial merge as an early warning. Before contributing anything back, it should move its spec out of docs/specs.

## Facts (16)

- [ran-it] Upstream main is 321 commits ahead of the fork point and moves about 250 commits per day
  - evidence: git -C /home/user/morluto/rea fetch --depth 500 origin main -> 1a070dee..2533a8b3; git rev-list --count 1a070de..FETCH_HEAD = 321; commit dates: 236 on 2026-11-19, 261 on 2026-11-20, 3 on 2026-11-21 (last 500)
- [ran-it] Most of the drift is tests and parser fixes, not agent-facing surface: 197 test, 75 fix, 26 refactor, 14 docs, 3 perf, 2 feat, 2 ci, 2 chore. Changed lines: tests 47,108, src 7,542, scripts 6,637. Docs show 73,498, but 52,874 of them are one generated release-contributions JSON.
  - evidence: git log --format=%s 1a070de..FETCH_HEAD | cut type | uniq -c; git diff --numstat; saved in /home/user/rea-design/discover/upstream/drift-summary.txt
- [ran-it] Trial merge of upstream into fork 77500a5 has exactly 3 conflicts, all trivial: docs/.vitepress/documentation.ts and docs/README.md (both sides appended a nav entry at the same spot, keep both), and docs/specs/README.md (modify/delete; upstream removed docs/specs)
  - evidence: scratch clone .../scratchpad/rea-discover/upstream/merge: git merge --no-ff --no-commit upstream/main -> CONFLICT (content) x2, CONFLICT (modify/delete) x1; auto-merged SKILL.md, .cursor-plugin SKILL.md, package.json, environmentCompare.test.ts, generatedPackageMetadata.ts. Saved: /home/user/rea-design/discover/upstream/merge-forecast.txt
- [ran-it] The merged tree type-checks with no merge-introduced error. Upstream's architecture guards and module-boundary verifier pass on both the fork and the merge.
  - evidence: tsc -p tsconfig.fork-check.json (29 fork src files, 3,569-file graph, 27 s): one error TS2614 in src/frida/FridaInstrumentationManager.ts, identical on unmerged 77500a5 (frida native types not built); fork src+test (47 files): same single error; node scripts/verify/architecture-guards.mjs: passed 2945 vs 2949 files; node scripts/verify-module-boundaries.mjs: passed 4623 vs 4619 files
- [ran-it] Only 8 files are changed by both the fork and upstream, and none of them is clone-run code. The fork's new code imports just 5 modules that upstream changed, and all 5 changes are additive, with no removed exports.
  - evidence: comm of changed-file lists: SKILL.md x2, docs/.vitepress/documentation.ts, docs/README.md, docs/specs/README.md, package.json, environmentCompare.test.ts, generatedPackageMetadata.ts; import scan: analysisErrorBase.ts (+2), analysisErrorCleanup.ts (+56), evidenceFormat.ts, targetIdentity.ts, utilityCommands.ts
- [ran-it] Upstream now forbids tracked specs, plans, task lists, ADRs and architecture diagrams in Git (PR #12856, 2026-11-20). It deleted docs/specs, docs/adr, docs/architecture and docs/development/roadmap.md. The fork's clone-run spec lives in docs/specs/reconstruction/clone-runs/ and is cited by 15 fork files; two tests read it at runtime.
  - evidence: git show FETCH_HEAD:AGENTS.md line 81: 'Keep specs, implementation plans, task lists, ADRs, and architecture diagrams in issue or pull request discussions or in local drafts outside Git.'; commit a1dec2d2; grep: src/application/cloneRun/CloneRunWorkspace.test.ts:31, src/domain/cloneRun/cloneRunSchemas.test.ts:27, tests/conformance/cloneRunGuidance.test.ts:61 read spec.md
- [ran-it] The fork's base already has evidence_format 2 and the hot/cold progressive catalogue. Upstream's last two days changed src/server only in tests. So the 6.10.0 breaking changes are already in the fork, and nothing in the catalogue or MCP machinery drifted.
  - evidence: /home/user/rea-snap/src/domain/evidence.ts:616 EVIDENCE_FORMAT_REVISION; src/server/ProgressiveToolCatalog.ts and src/config/mcpToolCatalogProfile.ts present in snapshot; git diff --stat 1a070de FETCH_HEAD -- src/server: 4 test files only
- [ran-it] Skill version numbers will collide. The fork bumped SKILL.md metadata.version from 63 to 65. Upstream changed SKILL.md twice (UEFI routing, Hex-Rays IDA) and is still at 63, so its next bumps will reuse 64 and 65 for different content.
  - evidence: git show FETCH_HEAD:.agents/skills/reverse-engineer-anything/SKILL.md -> version "63"; rea-snap SKILL.md version "65"; merged tree takes "65" silently
- [ran-it] There are 679 open upstream issues (3,769 closed) and 701 open PRs. Within the open issues, 459 are labelled enhancement, and two prolific authors filed 311 between them, many of them one-per-format requests.
  - evidence: gh api search/issues q='repo:morluto/rea is:issue is:open' total_count=679; all 679 downloaded via search pages to /home/user/rea-design/discover/upstream/open_issues.json; label and author Counter
- [documented] Upstream users' agent-context asks are measured, and all point at the always-loaded surface. Default tools/list is 4,407,688 B vs 98,084 B under hot-cold (#9347). SKILL.md is about 8,300 tokens per activation, and progressive disclosure cuts 59-87% (#8084). One search-android-classes call is about 1.05M tokens (#9755). DeepSeek Harness sends 249,653 tokens on the first request vs about 9.2k with a family index (#6870). Closed #5861 records a 259K-token default catalogue that overflowed a 227K context.
  - evidence: issue bodies in open_issues.json; #5861 fetched via search API (closed 2026-11-20)
- [documented] Upstream has open, unmerged PRs in the fork's own direction. #11310 (draft) adds web-scenario/web-capture/web-screenshot claims to verify_reconstruction, plus reconstruct_web_feature/reconstruct_cli_feature prompts and recipes. #4991 and #6367 require failing negative controls before a verifier closes an obligation. #3529 adds visual screenshot claims. #8944 adds a reconstruction benchmark adapter. #7269 (draft) is a skill guide for online-platform reconstruction.
  - evidence: gh api search/issues q='repo:morluto/rea is:pr is:open reconstruction in:title' (6 results) and 'skill in:title' (13); saved /home/user/rea-design/discover/upstream/related-open-prs.tsv
- [documented] Upstream draft PR #11072 would move about 390 of SKILL.md's 609 lines of per-target routing into references/target-routing.md. That is exactly where the fork inserted its clone-run route bullet, so it will be the next real conflict.
  - evidence: PR #11072 body via search API; fork diff of SKILL.md adds a bullet at line 86 in 'Choose the first tool' routing list
- [source-derived] Upstream's roadmap (deleted at head, read at 1a070de) required capabilities to return evidence through shared CLI/MCP workflows. It said agents compose experiments with ordinary commands and scripts, and that custom orchestration needs a demonstrated requirement. tool-design.md at head is unchanged apart from one link.
  - evidence: git show 1a070de:docs/development/roadmap.md (Admission criteria); tool-design.md lines 44-52 'Custom orchestration languages, replay engines, or separate prepare/execute plans need an observed requirement'; diff 1a070de..FETCH_HEAD of tool-design.md = 1 line
- [source-derived] The fork's three clone-run commands are CLI-only (listed in CLI_COMMANDS, with no MCP contract). Upstream has a precedent for that (environment-compare), but its product line is 'shared CLI/MCP workflows'.
  - evidence: git -C /home/user/rea-snap diff 1a070de...HEAD -- src/contracts/cliCommandNames.ts adds compareScenarioBehavior, initCloneRun, evaluateCloneRun; no cloneRun in src/contracts or src/server; design_doc.md:88 'CLI-only, like environment-compare'
- [source-derived] The fork fixed a real upstream gap that has no upstream issue or fix. export-web-scripts and environment-build refuse the Evidence bundle that capture-browser-scenario --detail summary --evidence_output writes, and their error does not name the cause.
  - evidence: fork commit 4b4e8eb (src/application/EvidenceBundleCapture.ts new); git grep bundle in FETCH_HEAD:src/application/WebScriptExportService.ts and environmentSource.ts -> none; gh search 'evidence_output bundle export-web-scripts' -> no matching issue
- [source-derived] Upstream rules that bind any contribution. Target execution needs a maintainer scope decision before substantial implementation. Skill guidance is only for judgment the tool cannot convey. Agent tokens are the first performance priority. An assumed agent budget does not justify a limit. Tool descriptions must identify the operation within the first 240 characters.
  - evidence: FETCH_HEAD:AGENTS.md lines 7, 58, 116; tool-design.md lines 98-101 and 204-208

## Already good (6)

- Fork changes are isolated in new files: 81 of 89 changed files are new, and the fork's code depends on only 5 upstream-changed modules, all changed additively. That is why a 321-commit jump merges with 3 trivial conflicts (/home/user/rea-design/discover/upstream/merge-forecast.txt).
- CLI-only clone-run commands follow an existing upstream precedent (environment-compare in CLI_COMMANDS). The MCP catalogue and its digest, and the 255-tool Grok ceiling in issue #10776, are untouched.
- The clone-run playbook already lives in a reference page (references/clone-runs.md) with a short route bullet in SKILL.md. That is the progressive-disclosure layout upstream is moving toward (#8084, PR #11072).
- Clone runs end only on a referee verdict ('done only when evaluate-clone-run says so'). That answers upstream issue #7193, where agents stop at the first plausible answer, and the over-claiming that the reconstruction tickets (#4396, #4991) target.
- The fork's mutant fixtures (tests/fixtures/cloneRun/mutant/*.json) and clean-room check (CloneRunCleanRoom.ts) put into practice what upstream users ask for in #4396 (negative controls) and #2120 (keeping agents away from the original source).
- The fork already has upstream's hot-cold progressive catalogue, compact schema profiles and evidence_format 2 (src/server/ProgressiveToolCatalog.ts, src/domain/evidence.ts). None of it needs porting.

## Opportunities (6)

### Move the clone-run spec out of docs/specs before upstream's rule bites

- problem: Upstream deleted docs/specs and now forbids tracked specs (AGENTS.md:81). Fifteen fork files cite docs/specs/reconstruction/clone-runs/spec.md, and two tests read it at runtime. As it stands the fork cannot send clone runs upstream, and every merge re-raises the docs/specs/README.md modify/delete conflict.
- proposal: Fold the normative parts of spec.md into docs/reference/clone-runs.md, which already exists, and the schema doc comments in src/domain/cloneRun/cloneRunSchemas.ts. Point the 15 'Contract:' comments and the tests at the reference page. Keep plan.md and tasks.md in /home/user/rea-design, outside Git. Drop docs/specs/README.md when merging.
- expected gain: Removes 1 of the 3 merge conflicts permanently and makes clone runs eligible for an upstream PR. The always-loaded skill is unaffected.
- effort: small
- risk: The conformance test cloneRunGuidance.test.ts checks guide text against spec.md, so it must be re-pointed without weakening it. The fork owner may want to keep a spec for the team; it can live in rea-design.
- judge: grep -rn 'docs/specs' over src, tests and docs returns 0. The clone-run tests and verify-clone-run e2e pass unchanged, and a trial merge with upstream main shows no docs/specs conflict. One run of each.

### Merge upstream (not rebase), on release tags plus a daily trial merge

- problem: Upstream moves about 250 commits a day. The fork is 22 commits on a shared branch that several agents use. Rebasing would rewrite that history each time. Waiting lets drift grow, and the first real conflict is already queued (PR #11072 rewrites the SKILL.md routing section the fork edited).
- proposal: Take upstream release tags (rea-agents-6.10.1 now, then each release) with git merge into a sync branch. Separately, run a daily trial merge of main in a throwaway clone with /home/user/rea-design/discover/upstream/sync-upstream-trial.sh (steps run by hand today; the script itself is untested). After each real merge, run: the targeted tsc over the fork's graph (27 s); architecture-guards and module-boundaries (seconds each); the fork's clone-run unit, boundary and conformance tests; the setupSkill managed-file test; verify-clone-run e2e; and docs:check.
- expected gain: Today: 3 trivial conflicts, 0 type errors, about 30 s of static checks per merge. Prevents the drift turning into large hand-merges, and catches skill or contract API breakage within 1 day.
- effort: small
- risk: Merge commits clutter the history. Release tags lag main by up to about a week, so upstream fixes the fork needs may have to be cherry-picked.
- judge: Trial-merge conflict count and tsc error delta recorded daily (both are 0 new today). Success is no upstream merge taking more than 30 minutes of conflict work over the next month.

### Give the fork its own skill version scheme

- problem: The fork's SKILL.md is version 65 and upstream's is 63. Upstream's next two bumps will reuse 64 and 65 for different content, and the merge took '65' silently. Anything that compares skill versions (doctor's 'aligned', the #5244-style skill-versus-server drift) can then call different skill text the same version.
- proposal: Keep upstream's number and add a fork suffix (for example 63+clone.2), or bump the fork's number on every merge to max(upstream, fork)+1. First check what the skill-version parser in src/application/SetupSkill.ts accepts.
- expected gain: Rules out the case where doctor reports 'aligned' for a skill whose text differs from what the fork installs.
- effort: small
- risk: The version parser may accept only integers. If so, the fallback is the +1 rule on each merge.
- judge: After a merge that bumps upstream's version, rea doctor on a fork install still reports the fork skill as distinct (one doctor run).

### Contribute back the Evidence-bundle reading fix (fork commit 4b4e8eb)

- problem: Upstream export-web-scripts and environment-build refuse the bundle that capture-browser-scenario --detail summary --evidence_output writes. The error doesn't name the cause, so an agent burns calls guessing. There is no upstream issue or fix.
- proposal: Open an upstream issue with the smallest repro, then a PR with EvidenceBundleCapture.ts and its test. Both are small, independent of clone runs, and need no scope decision (no new authority).
- expected gain: One fewer failed round-trip per web-capture-to-environment workflow for every upstream user, and one less fork-only file to carry.
- effort: small
- risk: Upstream may prefer a single shared loader change. The PR needs a human owner per CONTRIBUTING.
- judge: Upstream merges it. Afterwards the fork's diff against upstream shrinks by EvidenceBundleCapture.ts and its test.

### Get ahead of upstream draft PR #11310 and the #4396/#4991 negative-control work instead of duplicating it

- problem: Upstream has open work that overlaps clone runs. #11310 puts web-scenario, web-capture and web-screenshot claims into verify_reconstruction and adds reconstruct_web_feature prompts. #4991 and #6367 add failing negative controls, the same idea as the fork's mutant fixtures. If either merges first, the fork carries two referees with different semantics.
- proposal: Read #11310 and compare its claim model with the fork's referee. Post the fork's measured blind-trial and mutant-catch results on #4396 and #11310 as evidence. Open one scope-decision issue proposing clone runs as a composed workflow over existing captures (needed anyway, because launching the original is target execution under AGENTS.md:7).
- expected gain: Avoids one duplicate referee and one later migration. Turns the fork's trial data into an influence on upstream's closure policy.
- effort: medium
- risk: Upstream may choose #11310's claim-based model, and the fork then needs an adapter. Writing to GitHub needs the owner's go-ahead (this lens did not write).
- judge: A maintainer scope decision recorded on the issue. A side-by-side run of the fork's mutant fixtures through #11310's verifier shows whether it also catches download-separator, list-as-object and slug-cut (3 cases).

### Adopt upstream's measured always-loaded-surface fixes as they land, rather than building parallel ones

- problem: Users measured the cost: default tools/list is 4.4 MB vs 98 KB hot-cold (#9347), SKILL.md costs about 8.3k tokens per activation (#8084), and multi-word discover_tools queries return 0 tools (PR #11756). The fork's design doc cites about 97,000 tokens of catalogue per agent as the reason for CLI-only clone runs.
- proposal: Track and merge PRs #11072 (skill routing to a reference), #10374, #11756 and #3905 (catalogue size in doctor) when they land, and do not write fork versions. Contribute measurements, not code. Re-check whether clone-run roles could use the hot-cold MCP profile once #11756 lands.
- expected gain: Per PR #11072: SKILL.md from 609 to 263 lines on every activation, roughly half the skill's always-loaded tokens, at zero fork maintenance.
- effort: small
- risk: #11072 rewrites the section the fork edited, so it will conflict once. Hot-cold needs clients that refresh tools/list.
- judge: Skill tokens per activation before and after the merge (one count). One clone-run role session's whole-task tokens via CLI vs hot-cold MCP (2 runs).

## Open questions (6)

- Does the fork owner want clone runs upstream at all? If yes, they need a maintainer scope decision first (target execution, AGENTS.md:7), and the CLI-only choice should be defended against 'shared CLI/MCP workflows'.
- How does draft PR #11310's claim model compare with the clone-run referee? I read only its description, not its diff.
- Does upstream's docs:check (scripts/lib/docs-facts.mjs) or verify:docs:routes reject the fork's docs/specs pages or the new nav entry? I did not run npm scripts. SKIPPED_PROSE no longer exempts docs/specs, but a grep found no tool counts in the fork's docs.
- Does the skill-version parser accept a non-integer fork suffix?
- Should the fork follow upstream release tags (weekly) or main (about 250 commits a day)? That depends on how quickly the fork needs upstream fixes.
- Repository-scoped GitHub REST endpoints returned 403 'access not enabled for this session', so issue comments (for example the 47 on #1065) were not read. Only search API bodies were read.

## Details

Saved files (durable, /home/user/rea-design/discover/upstream/):

- drift-summary.txt: commit counts by type, line counts by area, the 8 files both sides changed
- upstream-commits-since-fork.txt: all 321 upstream commits
- fork-changed-files.txt, upstream-changed-files.txt
- merge-forecast.txt: trial merge conflicts, resolutions, post-merge checks, the 15 fork files citing docs/specs, the resolved diff
- tsconfig.fork-check.json and tsc-merged-extended-diagnostics.txt: the targeted typecheck (3,569 files, 27 s, 4.3 GB)
- sync-upstream-trial.sh: the trial-merge procedure as a script (steps run by hand; the script itself has not been run)
- open_issues.json: all 679 open issues (title, labels, counts, first 4,000 chars of body)
- top20-issues.tsv: the twenty most relevant issues
- related-open-prs.tsv: 10 open upstream PRs that overlap the fork's direction
- upstream-roadmap-at-1a070de.md.txt: the roadmap upstream has since deleted
- upstream-policy-diff-12856.txt: the AGENTS.md and documentation.md policy change

Scratch (may be cleared): /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-discover/upstream/merge, the scratch clone with the resolved, uncommitted merge.

Conflict table:

| file                                                                                                                                                                                                                                                                    | kind            | difficulty                | resolution                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------- | ----------------------------------------------------------- |
| docs/.vitepress/documentation.ts                                                                                                                                                                                                                                        | content, 1 hunk | trivial                   | keep both nav entries (Clone runs, Reconstruction coverage) |
| docs/README.md                                                                                                                                                                                                                                                          | content, 1 line | trivial                   | keep both list items                                        |
| docs/specs/README.md                                                                                                                                                                                                                                                    | modify/delete   | trivial now, policy later | delete it; move the spec content (see opportunity 1)        |
| Auto-merged cleanly: both SKILL.md copies (upstream UEFI and Hex-Rays routing edits, fork clone-run bullet), package.json (version 6.10.1, a bridge file, a verify:ghidra:ppc64 script; no dependency change), environmentCompare.test.ts, generatedPackageMetadata.ts. |

Upstream themes since the fork point: parser hardening (ELF, Mach-O, NuGet, Maven, Gradle, UEFI, APT, PE, V8 code cache) through BinaryReader and owned limits; large test consolidation (197 commits); verifier commands run through the supervised owner; the docs reorganisation in #12856 (specs, ADRs and the roadmap removed; limits docs moved to docs/reference); headless official Hex-Rays IDA MCP (#4813); a PPC64 Ghidra lane; releases 6.10.0 and 6.10.1. Nothing changed the MCP catalogue machinery, output sizes, setup or skill structure. SKILL.md changed in two routing bullets only, with the version left at 63.

Issue clusters for agents and context, by title match among the 679 open issues:

| cluster                                                                                                                                                                                                                                                                                                     | title matches             | flagship issues                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| catalogue and tool count                                                                                                                                                                                                                                                                                    | 14                        | #9347, #6870, #8388, #10776                                                   |
| output size and tokens                                                                                                                                                                                                                                                                                      | 7 (252 bodies mention it) | #9755, #723, #1065                                                            |
| skill and guidance                                                                                                                                                                                                                                                                                          | 14                        | #8084, #4718, #5244, #10369, #1587                                            |
| setup and clients                                                                                                                                                                                                                                                                                           | 33                        | #9347, #2187, #3016, #4847                                                    |
| subagents and handoff                                                                                                                                                                                                                                                                                       | 7                         | #8364, #8733, #8546 (Evidence handoffs; no subagent-specific ask)             |
| captures and comparisons                                                                                                                                                                                                                                                                                    | 48                        | #4973, #9036 (compare_web_captures schema too large for Claude Desktop), #724 |
| reconstruction and verification                                                                                                                                                                                                                                                                             | 66 (most are per-format)  | #4069, #4396, #8475, #4972, #9497, #10287                                     |
| A first-match classification of all 679: about 137 new-format requests, about 143 provider integration, about 51 agent context, catalogue, skill and setup, about 39 reconstruction, verification and comparison, about 53 runtime capture, and about 256 other (parser bugs, Windows authority, CI, docs). |

The 20 issues: #9347 hot/cold default (4.4 MB to 98 KB); #8084 skill progressive disclosure (8.3k tokens, cut 59-87%); #723 result repetition (MCP 759 KB vs CLI 303 KB on the same task); #1065 MCP usability tracker (P1, 47 comments); #9755 Android summary and paging (about 1M tokens per call); #6870 _meta.family for lazy hosts (250k to 9.2k tokens); #8388 a scoped catalogue hides workflows behind a bare 'disabled' error; #10776 the 255-tool ceiling; #9036 and #4973 compare_web_captures rejected by Claude Desktop (schema too deep); #4069 UI state and transition primitives for behavioural reconstruction; #4396 negative controls for verifiers; #8475 benchmark oracle adapter; #7193 investigation-loop construct; #4718 companion-skill extension point; #5244 skill documents tools the server lacks; #10369 drop scripted staged workflows from the skill; #1932 agent evaluation beyond Codex; #2120 clean-room and copyright; #4230 planted-instruction (prompt-injection) agent evaluation.

What users ask for most overall: more formats and providers. In the agent-and-context area, the dominant ask is a smaller always-loaded surface (catalogue and skill), plus summary-and-retain instead of inline dumps.

How upstream's stated rules (roadmap at 1a070de, tool-design.md and AGENTS.md at head) fit the fork's ideas:

- Fits: the referee as a 'compare'/'workflow' shape that composes recorded Evidence. Mutant negative controls (they match #4396). The playbook as a reference page, not in SKILL.md (#8084). CLI-only commands (environment-compare precedent). Agent tokens first (AGENTS.md:58).
- Does not fit as is: specs and tasks tracked in docs/specs (AGENTS.md:81). Launching the original app needs a scope decision first (AGENTS.md:7). The seven-role team playbook runs against 'avoid prescribing call sequences a direct tool can replace' (tool-design.md:46-47), 'skill guidance only for judgment the tool cannot convey' (AGENTS.md:116), and the #10369/#10374 move away from scripted workflows. The run-folder orchestration needs the 'observed requirement' bar for custom orchestration (tool-design.md:49-52); the blind trial is the evidence to cite. Any output cap must be justified by a real resource limit, not an assumed agent budget (tool-design.md:206).

Recommendation:

- Adopt (merge, don't build): upstream releases; skill routing PR #11072 and #10374 when merged; discover_tools ranking #11756; doctor catalogue size #3905.
- Avoid duplicating: web reconstruction claims (#11310), negative-control closure (#4991, #6367), visual claims (#3529), benchmark adapter (#8944), the online-platform skill guide (#7269).
- Contribute back: the bundle-reading fix (4b4e8eb); the mutant and blind-trial evidence on #4396 and #11310; and, after moving the spec out of docs/specs, a scope-decision issue for clone runs as a composed workflow.
