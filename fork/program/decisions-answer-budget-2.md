# Answer budget: the lead's rulings on the revised contract

The contract is `fork/program/contract-answer-budget.md` (revision 2). Its critique and the
dispositions are in `contract-answer-budget-critique.md`. The revision asked the lead five things and left
three open points. These rulings are part of the contract; where they differ from its text, they win, and the
package that owns the affected section corrects the text when it lands.

1. **Agents whose shell hands REA a regular file (decision D1).** Accepted as revised: explicit settings
   apply on every kind of standard output, and a regular file that is also standard error gets the budget.
   For the case the revision left open (a harness with two capture files, or an agent adding `2>/dev/null`
   in a one-file harness), add one tie-breaker: when standard output is a regular file that is not standard
   error and no explicit setting was given, the budget stays on if an agent marker is present in the
   environment, and is off otherwise. The markers are `REA_AGENT` with any non-empty value, plus the
   variables that the coding-agent clients REA sets up document as present in their shell tools; add a
   client's variable only when its public documentation or its source states it, and list each with its
   source in the limit inventory. Under a marker, a digest written to a file begins with the line that says
   how to get every byte (`--output-budget off`). The cost is accepted: a script an agent starts and that
   redirects REA to a file without the flag reads a digest. The repository's own scripts are covered by the
   switch the contract already gives them.
2. **Default (D3).** 6,000 bytes stays. The program's census row is restated to at most 380,000 bytes
   (measured 371,229 at 6,000). More questions answered in the first reply is worth more than the bytes.
3. **`remediation.action` (D7).** Never removed, as revised.
4. **The referee's verdict under the budget.** The referee's own bounded verdict (round 3, item R10) lands
   before the CLI wiring package merges, so the verdict fits the budget in one reply. The wiring package
   tests against that form.
5. **New surface.** `rea saved-output list|show|clear` with `show --text`, and the store candidate under the
   temporary directory for a read-only home: accepted.
6. **`--detail complete` on a pipe gives a digest.** Confirmed. The budget is a delivery default: the
   complete record is produced, saved and named. The documents package adds one sentence to the fork's
   AGENTS.md and to docs/development/tool-design.md saying so, so that a later reader does not undo it as a
   violation of "honor requested detail".
7. **Names.** `--output-budget` and `REA_OUTPUT_BUDGET` stay, despite the unrelated result field
   `output_budget_bytes`.
8. **Result rows and model names.** Not part of this contract, but binding on every package: no file in the
   repository names an AI model or assistant.

Order of work: A1 and B now, in parallel. A2 and C after A1 is merged. D last. The discovery package (help
index, schema, setup, guidance) runs before A2, and A2 rebases onto it, as the contract's section 17 says.
