# This fork: start here

This repository is a fork of REA (upstream: `morluto/rea`). Its owner wants it to become an outstanding tool
for AI agents, especially with context: cheap for an agent to hold and use, able to survive a context reset,
and able to tell an agent truthfully whether a rebuild of an application matches the original.

This folder is the working record of that effort. It exists so that a person or an agent with no memory of
the earlier sessions can pick the work up. It is not shipped in the package and is not part of the product's
documentation.

## What the fork adds to upstream

- **Clone runs.** `rea init-clone-run`, `rea evaluate-clone-run` (the referee) and
  `rea compare-scenario-behavior`, with a team playbook in the skill
  (`.agents/skills/reverse-engineer-anything/references/clone-runs.md`). The one contract is
  `docs/reference/clone-runs.md`.
- **The context program.** Changes that make REA cheaper for an agent to use: bounded answers by default, a
  short skill, small discovery text, a referee that prints receipts. The plan is `program/PROGRAM.md`.
- **Judges.** `scripts/context-ledger/` measures what REA puts into an agent's context, with no model
  involved. `bench/` measures real agents: cloning applications they have never seen, and answering small
  reverse-engineering questions.
- **A fork marker.** `rea --version --json` reports `fork`, and the skill's version follows
  `<upstream>+clone.<n>` (`src/domain/forkIdentity.ts`).

## How to pick the work up

1. Read `program/PROGRAM.md`: the goal, the judges, the packages and their order.
2. See where the branch is: `git log --oneline -30`. Work happens on the branch
   `claude/dreamy-hamilton-vczp59`; the fork's `main` is left as upstream's.
3. Run the ledger on a built checkout: `node scripts/context-ledger/run.mjs --rea . --check
   scripts/context-ledger/ceilings.json` (guide: `scripts/context-ledger/README.md`). Its ceilings say what
   has been achieved; its targets say what has not.
4. Run the clone-run acceptance: `npm run verify:clone-run` (real browser).
5. For benchmark runs, `bench/README.md` has the exact commands.
6. To bring the fork up to date with upstream, follow `program/sync-notes.md`: merge the newest release tag,
   never rebase.

## What is in this folder

| Path                                | What it holds                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `program/PROGRAM.md`                | The plan of record: goal, judges with baselines and targets, packages, order, standing rules          |
| `program/decisions-*.md`            | The lead's decisions that bind the packages                                                           |
| `program/contract-answer-budget.md` | The contract for bounded answers, with its critique beside it                                         |
| `program/sync-notes.md`             | What the last upstream merge did and the commands for the next one                                    |
| `audit/`                            | The eight lenses of the audit of 2026-11-21: measured context costs, research, upstream, completeness |
| `rounds/`                           | Clone runs: the findings and decisions of each proof and fix round                                    |
| `design/`                           | The design of clone runs, its milestones and the owner's decisions                                    |

Paths that begin with `/home/user/rea-design` or with a scratch directory name the machine of the session
that wrote a document. They may no longer exist. What mattered from them is in this folder, in `bench/` and
in `scripts/context-ledger/`.

## Rules the owner set

- Never open a pull request unless the owner asks for one. Never write to upstream in any way: no pull
  requests, no issues, no comments.
- No file in the repository names an AI model or assistant.
- REA stays out of bypassing DRM, licence checks, anti-cheat and access controls, and a clone never copies a
  target's code, art or brand.
- A change is judged by something other than its author: a test that fails before and passes after, the
  ledger, the benchmark, or an independent verification round.

## Decisions taken for the owner, and decisions that still need the owner

Taken, under the owner's instruction that nothing inside the fork is off limits:

- Answers are bounded by default in this fork (upstream prints everything by default).
- `rea --update` and the update notice must not replace this build with upstream's release.
- The working record lives in this folder on the work branch.

Still needing the owner's word:

- Offering any of this to upstream, or reporting the capture defects found along the way.
- Publishing the fork as a package under its own name.
- Support for signing in to a target with an account the user supplies.
- Any change to the fork's `main` branch.
