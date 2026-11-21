# REA Clone Runs: an agent team with a referee

## Why

REA helps an agent understand how an app works. Its guide has one sentence on rebuilding, and nothing in REA can tell whether a rebuild matches. In our trials REA's own comparison scored a deliberately wrong copy the same as a correct one.

This design adds two things:

- **A referee inside REA.** One command replays the same recorded actions against the original and the rebuild, compares the answers, and prints either "done" or a short list of what is wrong and who should fix it.
- **A team playbook.** Seven roles that one agent can play in turn, or several in parallel, all working from one folder on disk.

No agent can declare success. Only the referee can, from recordings REA made and checked itself.

The team writes new code for behaviour it observed, under a new name. It does not get past DRM, licence checks, anti-cheat, packers or logins, and it does not copy the original's code, artwork or brand. The referee refuses "done" if it finds copied files or the original's name in the clone.

## How a run goes

1. You name the target, state that you may study it, and name the clone.
2. The **scout** lists what exists: pages, API routes, files. The **mapper** turns that into a checklist of surfaces.
3. **Probers** write scripted visits ("scenarios") that test each rule: empty input, limits, duplicates. REA records the original's answers at least twice, each time from a clean start.
4. The **spec writer** turns the recordings into numbered rules ("obligations"). Each cites the recorded steps that show it; guesses are labelled.
5. **Builders** write new code from the rules only. They never open the original's source.
6. The **verifier** replays the same scenarios against the clone.
7. The **lead** runs the referee and hands out its worklist: which rule fails, at which step, expected and actual value, which role acts. Repeat until done, or stop at the limit and report what is unproven.

## What "done" means

`rea evaluate-clone-run <folder> --exit-code` exits 0 only if all of these hold:

1. **Scope.** Authorisation is recorded, original and clone run at different addresses, and the run folder is outside the clone's source.
2. **Evidence.** Every scenario has at least two recordings per side. Each passes REA's integrity check, comes from the declared address and replays the same scenario. Clone recordings match the clone's current files, so any edit makes them stale.
3. **Clean start.** The opening "fingerprint" steps are identical across a side's recordings.
4. **Coverage.** Every step is cited by a rule and every rule cites steps seen on the original. From milestone 2, every mapped surface and input field is probed or waived.
5. **Parity.** Every cited step matches on request, status, each field of the JSON reply, page address, and on-screen text after declared renames (from milestone 2, screenshots within a declared tolerance). A mismatch, missing data, or an unstable or stale result blocks. Missing data never counts as a match.
6. **Clean room.** No clone file is byte-identical to a file taken from the original, and none of the original's declared names appear.
7. **Unknowns.** None open. A waiver needs a named person and a reason, and the result then reads "done with N waivers".

The lead stops as "stalled" after 8 rounds, or when two rounds change neither the failures nor the clone.

The rest is for implementers. Milestones: (1) referee and playbook for web apps; (2) trustworthy captures and coverage; (3) packaged Claude Code crew; (4) JavaScript, Electron and command-line targets; (5) REA's obligation ledger.

Base: the portable design (playbook in the skill, a folder on disk, CLI-only commands). Grafted: the product design's trust model, where REA recomputes every verdict from its own evidence and ties it to the clone's current files, and the Claude-native design's verified Claude Code packaging.

## Roles

| Role                     | REA commands (all CLI)                                                                                         | Reads                                              | Writes                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| Lead (main conversation) | `init-clone-run`, `evaluate-clone-run`, `guidance`                                                             | `gate.json`                                        | `target.json`, `intended-differences.json`, `waivers.json` |
| Scout                    | `capture-browser-scenario` (crawl), `analyze-web-bundle`, `analyze-javascript-application`, `inspect-artifact` | `target.json`                                      | `scout/`                                                   |
| Mapper                   | `environment-build`, `inspect-analysis-view`                                                                   | `scout/`                                           | `surfaces.json`                                            |
| Prober                   | `validate-browser-scenario`, `capture-browser-scenario`, `capture-process`                                     | `surfaces.json`, `rendered/`                       | `scenarios/`, `evidence/original/`                         |
| Spec writer              | none required                                                                                                  | `behavior/`; evidence when unclear                 | `specs/`, `obligations/`                                   |
| Builder                  | none                                                                                                           | `specs/`, `obligations/`, `behavior/`, `gate.json` | clone source only                                          |
| Verifier                 | `capture-browser-scenario`, `capture-process`                                                                  | `rendered/`                                        | `evidence/clone/`                                          |

## Shared state: one run folder

Each file has one writer, so nothing is merged. Agents pass paths and ids, never payloads (a capture file is 0.22 MB for sixty small request steps and measured 0.46 to 2.9 MB each, 48 files, in the trial run).

- `target.json`: both addresses; start, reset, stop and health commands; browser path; `REA_BROWSER_NO_SANDBOX`; limits; the authorisation statement.
- `scenarios/<id>.json`: address-free, with stable step ids. `fp-*` is the fingerprint, `setup-*` is setup, every other step must be cited.
- `obligations/<area>.json`: `{id, statement, basis: observed|inferred, cases: [{scenario, step_ids}]}`.
- `unknowns/<role>-<n>.json`: proposals as plain data. Only the lead accepts one.
- `evidence/<side>/<scenario>/run-N.json`: written by REA's capture command, which never overwrites.
- Written only by the referee: `rendered/` (ready-to-run capture inputs per side), `records/` (each admitted evidence file with side, scenario and clone-tree digest), `behavior/` (the original's behaviour only: requests, statuses, decoded JSON, on-screen text; the trial's tables measured 174 to 647 KB per scenario, 2.28 MB for five, and a reply over 8 KiB is left out of the table), `parity/`, `journal.jsonl`, and `gate.json` (the verdict plus `next`: at most ten items, each with role, reason, file and the exact command).

Clean-room wall: builders read `specs/`, `obligations/`, `behavior/` and `gate.json`, never `evidence/` or `scout/`. Interface identifiers (routes, field names, channel names, control labels) are kept. Product names, images, fonts and long-form copy are replaced and declared in `intended-differences.json`.

## Orchestration

- **Every REA call is a CLI one-shot.** An REA server holds one active target and one evidence store, a second agent silently retargets the first, and the tool catalogue costs about 97,000 tokens per agent. So nothing shares an MCP session.
- **The loop is the referee's output.** Run it, do or delegate `next`, repeat. All state is files, so a new session or another client resumes by running it again.
- **Any client with a shell:** one agent plays the roles in turn, reading one role card at a time through `rea guidance`. Codex, Cursor and Gemini use this path until their agent formats are confirmed.
- **Claude Code today:** the lead starts ordinary subagents with a role card and one `next` item, two at once on four CPUs. Each prober and verifier needs its own instance and browser.
- **Claude Code packaged (milestone 3):** `/rea:clone`, role agents, and a workflow script that schedules scout, then map, probe and spec per family, a critic that requests more probes, builders in git worktrees, verify, fix. A plugin hook denies builders any read under `evidence/`. The script cannot read files, so the main conversation re-runs the referee itself before reporting.
- **Capture hazards:** every capture runs under an outer `timeout`. After a cancelled capture, reset, retry twice, then record an unknown.

## Parity beyond web (milestone 4)

- **JavaScript and Electron:** surface parity is set equality of IPC channels (with mode) and bridge members from two `analyze-javascript-application` Evidence files. Behaviour parity is a deterministic transcript run under `capture-process` on both sides, compared on terminal and exit, printing one digest line because long output is silently cut. A rule known only from reading minified code is `inferred` and blocks done until the original is executed or you waive it.
- **Command-line programs:** the same transcript claim over arguments, stdin and files.

## Product changes

Guidance cannot supply these, and REA's rules forbid using the skill to cover a tool defect.

1. `rea compare-scenario-behavior`: compares several captures per side, ignores the address, reads bodies, and sets an exit code. It reuses REA's existing differ.
2. `rea init-clone-run` and `rea evaluate-clone-run`: the referee. All three commands are CLI-only, like `environment-compare`, so the MCP catalogue and its digest do not change.
3. `references/clone-runs.md` in the existing skill, added to `MANAGED_SKILL_FILES` so setup installs it and guidance search finds it.
4. Fix lost response bodies (seen only with `Cache-Control: no-store`) and make the step deadline hold.
5. Surface coverage and a screenshot tolerance in the referee.
6. Package `agents/`, `workflows/`, `commands/` and `hooks/`, which npm excludes today, with tests that fail if they are dropped.
7. Transcript and JavaScript surface claims, and a fix for silent output loss in `capture-process`.

## Deferred

Closing REA's obligation ledger waits for milestone 5 and a scope decision. Further out: function-level native comparison (needs Ghidra or IDA), explicit target binding and a multi-session MCP server, role-shaped MCP profiles, agent files for other clients, and live third-party targets that need writes or sign-in.

## Checked for this synthesis

Ran: the product comparer prototype on its saved captures (two captures per side: 59 of 59 steps the same, exit 0; one per side: 1 unknown, exit 2; slug mutant: exit 1 at `/slug`); the portable gate prototype on a copy (done, exit 0; one line appended to a clone file: stale, exit 1); `claude plugin validate --strict` on the Claude-native draft (agents, workflow, command, hooks listed); the differ's tests (85 passed). Source-derived: the CLI-only command class, the single-skill file list, and that the portable gate prototype trusts a report file an agent could write.
