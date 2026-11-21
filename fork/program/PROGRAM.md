# REA for agents: the program after the audit

Written 2026-11-21 by the lead, from the eight audit lenses in `/home/user/rea-design/discover/<lens>/result.md`.
This file is the plan of record. Decisions that bind every package are in the `decisions-*.md` files beside it.

## Goal

An agent, on any model and in any client, pays as little context as possible to:

1. find the right REA call,
2. read REA's answer,
3. keep going after its context is reset, and
4. get an answer it can trust about whether a rebuild matches the original.

## What the audit changed

- The tool list is not the main cost. Claude Code, Codex and Copilot CLI defer tool definitions by default
  (REA costs about 3,300 tokens there, not 97,000). VS Code (128-tool cap) and Cursor (historically 40) are the
  clients where the 263-tool list is a real problem.
- The answers are the cost. The same ten calls return 12,136 tokens when each asks for a summary and 94,516
  with default arguments. The median first CLI answer is about 1,900 real tokens; 58 of 121 exceed 2,000, 7
  exceed 100,000, the largest is 15.9 MB. Everything that keeps answers small is opt-in today.
- The skill body is 10,840 tokens on every trigger and loses its second half after compaction. Three quarters
  is one route list. A 1,175-token router answers the same fifteen requests.
- In clone runs the referee's own printed capture command returns 25.5 KB each time (88% of one scenario's
  loop), the behaviour tables are 2.28 MB for five scenarios against a 10 to 20 KB design, and a ten-item
  verdict is 11,126 characters.
- Nobody has measured an agent using any of it: no run reached `done` on an unseen application, and no token
  count exists for any run.

## Judges

**J1, the context ledger** (no model, deterministic, about two minutes): `scripts/context-ledger/` in the
repository. It measures scripted tasks in bytes, in the repository's own estimate and in real BPE tokens
(o200k as the proxy; no tokenizer for the models agents run on exists offline). `ceilings.json` holds the
current value of every row as a ceiling that only ratchets down, and the target. The rows that matter most,
with their values on the synced base (commit 6928a7e) and targets:

| Row                                                                 | Now                         | Target                       |
| ------------------------------------------------------------------- | --------------------------- | ---------------------------- |
| `mcp.ten-calls.default` (ten MCP calls, default arguments)          | 118,158 tokens              | at most 20,000               |
| `mcp.ten-calls.summary` (a summary asked each time)                 | 10,914 tokens               | at most 9,700, stretch 7,100 |
| `mcp.status.default`                                                | 18,615 B                    | at most 8,000 B              |
| `mcp.bundle.default`                                                | 349,485 B                   | lean by default              |
| `cli.census-full.largest` (largest first answer, repository inputs) | 1,023,454 B                 | at most the budget           |
| `cli.census-full.total` (54 calls)                                  | 3.9 MB                      | under 300 KB                 |
| `cli.mistakes.largest` (largest error)                              | 1,022,704 B                 | at most 1,500 B              |
| `cli.help`                                                          | 29,652 B                    | index at most 3,000 B        |
| `cli.setup.one-client`                                              | 6,675 tokens                | at most 1,500                |
| `guidance.search.mean`                                              | 1,751 tokens                | at most 600                  |
| `skill.body`                                                        | 10,879 tokens               | at most 1,500                |
| `skill.loaded-per-request` (fifteen requests)                       | 14,115 tokens               | at most 2,000                |
| `skill.routes-clear`                                                | 7 of 15                     | at least 13                  |
| `clone.loop.stdout` (one scenario's loop)                           | 31,183 tokens               | at most 5,000                |
| `clone.verdict.ten-items`                                           | 8,050 characters            | at most 6,000                |
| `clone.step-read`                                                   | 1,511 tokens on the fixture | at most 700                  |

The audit's own census (121 calls on inputs outside the repository) measured 24.8 MB of first answers with a
largest of 15.9 MB; with the answer budget at 6,000 bytes the simulated total is 371 KB, and that row's
target is restated as at most 380 KB.

**J2, the clone benchmark** (agents in the loop): `bench/` in the repository. An agent that has only the
installed skill clones an application it has never seen; scripts then score it with the referee and with
held-out scenarios mapped to hidden rules. Three applications: varnholt, brassnook, seedlark. The baseline
row is the first blind trial, scored by the scripts: verdict `not_done` when recomputed (the run recorded
`stalled`), 50.0 minutes, 94 turns, peak context 475,393 tokens, 27.1 million prompt tokens summed over
turns, 443 KB of tool results of which REA printed 171 KB (captures 61 KB, verdicts 33 KB, setup 25 KB) and
the skill 77 KB, 23 of 23 hidden rules on the held-out scenarios. The trial's own judge, probing outside the
scenarios, found two rules only partly matched and seven differences no step probed.

**J3, the task benchmark** (agents in the loop): `bench/tasks/`, eighteen small reverse-engineering questions
with answers a script checks, plus a floor cell. Per run: right or wrong per fact, whether the first REA
command was the expected one, peak context, tokens, and what filled the context.

J1 gates every change. J2 and J3 are run before and after each wave on the same applications and questions.
Agents under test reach REA through the CLI and the installed skill only; the MCP surface is judged by J1.

## Packages

| Id  | Package                                                                                                                                                                                      | Main sources                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| P0  | Upstream sync, fork identity, one contract document for clone runs (done)                                                                                                                    | upstream 1-3, completeness 6, 10                      |
| R3  | Clone runs, fix round 3: comparison at the smallest unit with generated proofs, an honest and small referee, deterministic captures                                                          | `rounds/decisions-round3.md`                          |
| J1  | Context ledger in the repository                                                                                                                                                             | census-mcp 7                                          |
| P1  | Answer budget on the CLI: digest and saved file over budget, errors bounded, quiet progress, honest limits                                                                                   | census-cli 1, 2, 8, 10; census-mcp 3                  |
| P2a | Views and summaries: limitations once, findings first, views named, per-kind schema                                                                                                          | census-mcp 4; census-cli 5; census-skill 10           |
| P2b | MCP surface: reply budget, lean status, instructions, hot-cold repairs, annotations                                                                                                          | census-mcp 2, 5, 6, 9, 10; research-context 1, 6      |
| P2c | Guidance: short locators, contents action, ranking, keywords                                                                                                                                 | census-skill 4, 6                                     |
| P2d | Emit each fact once; bulk payloads to files                                                                                                                                                  | census-cli 6, 7                                       |
| P3  | Skill router, route reference, conformance test and size budget, description                                                                                                                 | census-skill 1-3, 7, 9, 11                            |
| P3b | Discovery text: help index, setup scoped to the client asked for                                                                                                                             | census-cli 9; census-skill 12                         |
| P4  | Clone loop economy: receipt-sized captures, bounded worklist, behaviour tables deduplicated, one-step reader, role-card pointers, target text marked as data, exit status, portable commands | census-cli 3; completeness 2, 4, 7, 8; census-skill 8 |
| P5  | Trust: placeholder binding, mutant canaries, held-out scenarios, stop rule                                                                                                                   | landscape 1-3; completeness 8, 11                     |
| P6  | Reach: body limits, sign-in with an account the user supplies, page structure, coverage, suggested edge cases                                                                                | completeness 3, 9; landscape 4, 5, 9                  |
| P7  | Proof in the repository: in-process end-to-end test, browser lane, the twelve wrong statements, full gate                                                                                    | completeness 5, 10                                    |
| P8  | Packaged crew for Claude Code: command, role agents, hook with read journal, CLI in bin                                                                                                      | clients 3, 5-7; landscape 6                           |
| P9  | A lazy catalogue profile for clients with tool caps                                                                                                                                          | census-mcp 8; research-context 2                      |
| P10 | Explicit target and Evidence handles that outlive a connection                                                                                                                               | research-context 7; landscape 7                       |

## Order

1. Now: P0 and J1; the answer-budget contract with an adversarial critic.
2. Then, in parallel worktrees: P1, P3, P3b, P4, and the benchmark harness with its baselines.
3. Then: P2a to P2d, P7, verification of the wave by agents who did not write it, push.
4. Then: P5, P8, P6, P9, P10, each wave ending with the judges and a push.

## Standing rules for every package

- Nothing an agent could read today may become unreachable. A shorter answer names where the rest is.
- A change that only moves tokens from one place to another does not count; the ledger measures whole tasks.
- A relaxation in the referee may turn a false failure into `unstable` or `unknown`, never into a match.
- Explicit requests keep their meaning; defaults are what change.
- Each package lands with tests that fail before it and pass after it, and with its ledger rows.
- Work in a worktree, commit after each finished item, never push, never write to GitHub.
