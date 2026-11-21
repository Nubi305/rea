# Answer budget: the lead's decisions

These bind the contract. The contract settles everything below them against the code and may challenge a
decision only by showing, with a run or a file and line, that it cannot work as written.

## The rule in one sentence

REA never puts more than the budget into an agent's context by default: an answer over the budget is saved
complete to a file and replaced by a short answer-first digest that names the file and the next commands.

## CLI

1. **On by default.** The budget applies to every command's result when standard output is not a regular
   file. It also applies when an option asks for the complete form (`--detail complete` and the like): the
   point is that an agent copying a command from a document cannot flood itself.
2. **Three ways to get every byte**, all stated in the digest in one line: redirect standard output to a file
   (then output is exactly today's bytes), `--evidence_output <file>` where the command has it, or
   `--output-budget off` (environment: `REA_OUTPUT_BUDGET=off`). A number sets the budget in bytes.
3. **Default: 6,000 bytes** of rendered output. The audit's simulation on 121 real first answers: 60 pass
   unchanged, 61 become digests of at most 2,754 B, total 24.8 MB to 293 KB. The contract may move the number
   only with a whole-task measurement (first answer plus the follow-up calls needed to reach the answer).
4. **`--filter-output` runs first.** If the filtered result fits, it is printed as today. The digest lists the
   largest key paths so the filter can be used without a second full run.
5. **Nothing is lost.** The complete document is written before the digest is printed, content-addressed, as
   canonical JSON whatever the display format, and the digest carries its absolute path, byte count and
   SHA-256. If the command already wrote the same content through `--evidence_output`, the digest names that
   file and nothing is written twice. The store is per user, outside the working directory and outside any
   target, clone or run folder (a file appearing in a clone's tree changes its digest and would stale its
   evidence). It has a size cap with oldest-first eviction, and a command that lists and clears it if REA has
   a natural place for one. Follow the conventions REA already has for per-user state.
6. **The digest is an answer, not a receipt.** In this order: what the command found (its scalars and counts,
   and for the commands agents call first, a command-owned brief of the findings themselves); the shape of
   what was left out (largest key paths with row counts and row keys); limitations as a count; the saved
   file; at most three exact next commands that work as printed. It is valid JSON under `--json` and is
   marked so a script can tell a digest from a full result. It must fit the budget itself.
7. **Errors are bounded too**: an error document is at most about 1,500 B, never carries partial Evidence
   inline (it is saved and named), states each sentence once, and gives no MCP advice on the CLI. An
   `--evidence_output` path that already exists, or whose parent is missing, is refused before the work runs.
8. **Exit statuses do not change.**
9. **Progress** goes to standard error only when it is a terminal or `--progress` is given.
10. **`--token-limit`** becomes a real upper bound: what it returns never exceeds the requested number in real
    tokens for any content class the audit measured, it works with `--json`, and the output says how the bound
    was computed. If keeping the head of the document is still what it does, the head must be the answer.
11. **Default format.** Compact JSON when standard output is not a terminal, unless the contract finds the
    blast radius in tests and documents too large; then it records the count and leaves the default alone.
12. **Small repairs ride along**: `--evidence-output` accepted as a spelling of `--evidence_output`, the
    nearest flag suggested for an unknown one, an unmatched `--filter-output` path refused with the available
    top-level keys.

## MCP

13. When a tool that has `detail` is called without it and the complete reply is over the budget and the
    record can be retained, the reply is the summary with its `parent_evidence_id`. An explicit
    `detail: "complete"` is honoured exactly as today: over MCP it is the only way to ask for everything.
14. `get_evidence_bundle` and `binary_session` are lean by default (the audit: 350,811 B and 18,613 B today).
15. The same setting governs both surfaces unless a whole-task measurement says the numbers should differ.
16. Tools that have no `detail` and can exceed the budget are listed by the contract with their measured
    sizes. What to do about them is a contract decision, constrained by output schemas: structured content
    must stay valid for any tool that declares one.

## Tests and compatibility

17. The repository's existing tests keep exercising the unbudgeted path through one switch set once for the
    test runner. New tests cover the budgeted path: a table over real outputs proving that every digest is at
    most the budget, that the saved file's SHA-256 matches, and that expanding the saved file reproduces the
    full document byte for byte.
18. The referee's printed commands, the role cards, the verifier script and every documented example are
    checked against the new default and corrected where they relied on megabytes arriving on a pipe.
19. Divergence from upstream is accepted for this fork, kept in as few places as possible (the one CLI result
    writer, the one MCP delivery function) so that merges stay cheap.

## What the contract must deliver

- The exact shapes (digest, error), names, defaults and precedence between the options.
- The list of code sites, with the order in which they change, split into packages that two or three agents
  can build in separate worktrees without touching the same files.
- The test plan, including the switch for existing tests and the count of tests and documents affected.
- The ledger rows that will show it worked, with today's values.
- Every way it found that an agent, a script or a person could lose an answer, and what stops each.
