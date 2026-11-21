# Fix round for clone runs, milestone 1: decisions and ownership

The proof round (blind trial, two attacks, three reviews) is in `/home/user/rea-design/m1/findings.md`, one
entry per finding with a stable id (`cheat-1`, `reality-4`, `comparer-2`, `referee-3`, `surface-1`,
`trial-10`, `judge-3`). This file says what is decided about them. Where this file and a finding's
"suggested fix" disagree, this file wins. Where neither settles a detail, the package owner decides and
reports it.

## Principles

1. A wrong clone must never read `done`. Missing or unrecorded data is `unknown`, never a match.
2. A correct clone must not be blocked by capture timing or by the referee's own bookkeeping, and no
   message may tell a builder to change a clone that is not wrong.
3. Every limit of what `done` covers is stated where the reader of a verdict sees it.
4. Fix the owning code and its message first. Skill text carries workflow judgment only.
5. No capture-command changes in this round (see "Deferred"). Each deferred gap becomes a stated limit.

## Shared contract for the comparer and the referee (both packages code against this)

Finding categories and their step status after this round. Existing categories keep their meaning unless
listed here.

| Category                   | Status   | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `single-observation` (new) | unknown  | A value was recorded, but the side has one observation of it, so steadiness cannot be judged. Replaces the use of `not-recorded` for recorded values (surface-2, comparer-8). Remedy: one more capture of that side.                                                                                                                                                                                                                                   |
| `declared-not-shown` (new) | unknown  | A leaf is declared volatile, the original's repeats agree at it, and the clone's value differs from it with the same shape (reality-7). Remedy: capture the original again (the value may change by day), or withdraw the declaration, after which the difference is `changed`. The finding names the declaration; nothing is ignored silently.                                                                                                        |
| `not-recorded`             | unknown  | Only for data no capture recorded: a lost or oversize reply body, a request body that was sent but not recorded (comparer-3), and steps whose transactions the capture itself reports as dropped or omitted (comparer-2).                                                                                                                                                                                                                              |
| `repeats-differ`           | unstable | Repeats of one side disagree. When the clone's repeats disagree and at least one of them equals the original's steady value, this is the ONLY finding: no `value` finding and no `changed` status (reality-5, trial-15, judge-1). When a request line exists on no left capture and the left's own request lines for that step are not the same in every left capture, the right-only line is `repeats-differ`, not `changed` (reality-4, comparer-5). |

Other comparer rules decided here:

- Leaf equality is by JSON pointer AND container kind along the path: an array and an object with
  index-like keys differ (comparer-1).
- A `document` reply is skipped only when its media type is HTML. Any other document reply (CSV, PDF, a
  download) is compared like a fetched reply, and `not-recorded` when no capture holds its body
  (reality-1). The resource type of a matched request line is compared in the request dimension
  (comparer-7).
- The side's own start origin is replaced by one placeholder in on-screen text and in reply string values,
  as it already is in page addresses, so an app that prints its own address compares equal across sides
  (reality-6).
- A fingerprint (`fp-`) step that is a `request` step fingerprints the reply, not the page text behind it
  (reality-3). The referee's `start_state_dirty` message is fixed separately.
- One text difference is reported once: on the first step where that text appears. A later step whose
  on-screen text is the same as the previous step's on both sides carries no new text finding
  (judge-8). The owner chooses the mechanism and must keep this property: a clone whose page text is wrong
  can still never read `done`.
- When two arrays have the same length, differences are named by position (pointer), not by an inferred
  pairing key, so a list whose pairing key is a generated value does not become an undeclarable
  `length` finding on a container (trial-10). A declaration is honoured for a leaf pattern (`/items/*/x`)
  when any leaf of that pattern was shown to vary on the original (reality-12).
- A text reply whose bytes parse as a JSON object or array on both sides is compared by leaves
  (reality-14).
- `leftRepeated` is the number of observations of that value, not the number of captures (comparer-4).
- A mix of recorded and absent status, text, address or request body within one side's repeats is
  `repeats-differ`, not folded away; the fold that lets one capture supply what another lost applies to
  reply bodies only, as the contract says (comparer-6).
- `volatile_fields[].declared` says whether a declaration names the pointer; a separate `honoured` flag
  says whether it took effect (comparer-9). `renames_applied` counts only values that are compared
  (comparer-10). Per-step volatile entries are bounded like findings (comparer-11).
- A volatile declaration may use `step_id: "*"` to mean every step of the scenario (trial-11). It is still
  honoured only where the original's own repeats differ, so the wildcard cannot hide a steady difference.
  The schema lives in the referee's package; the comparer treats `*` as matching every step.

## Referee decisions

- **Address identity (cheat-1, referee-1).** Lexical checks cannot classify a host name. At init and at
  every evaluation: strip one trailing dot, normalise IP literals (IPv4-mapped IPv6 to IPv4), treat every
  loopback and unspecified address and every address of this machine's own interfaces as "this machine",
  and resolve any other host name with the system resolver (`dns.lookup`, all addresses). Two sides are
  the same address when their ports are equal and their resolved host sets intersect or are both "this
  machine". A host that does not resolve leaves identity unknown, which blocks with
  `addresses_not_distinct` and a message that says so. Resolution happens in the application layer; the
  domain function stays pure and takes resolved identities. Forwarding and proxies stay residual trust 5.
- **Stall (referee-2, referee-3, referee-5, trial-7, trial-16).** `stalled` must mean: the team acted and
  nothing improved. Required properties: evaluating the same state twice, concurrently or in sequence, is
  one round, not two; leaving and re-entering a state through an unjudged evaluation does not stall; the
  referee's own prescribed remedy (one more capture for missing data) does not read `stalled` on the first
  try; the findings digest distinguishes findings that differ by file, obligation or side; a journal with
  a partial last line is repaired, not compounded (referee-9). The rule becomes a pure function with its
  own tests (referee-13). Every judged `not_done` result prints the round number, whether it was judged,
  and what would make the next evaluation read `stalled`.
- **Who is told what.** A `repeats-differ` finding is never addressed to the builder with "change the
  clone": original-side instability goes to the prober or lead, clone-side instability asks the verifier
  for another capture first and names the builder only if it persists. A difference that a rename would
  settle (the two values are equal after replacing the original's name, case-insensitively, or the side's
  address) goes to the lead with the exact declaration to add (reality-6). `declared-not-shown` asks for a
  fresh capture of the original (reality-7). Messages never print "(nothing)" for both sides
  (reality-13), never start with a dangling "Otherwise" (reality-10), name the recorded failure of a
  failed step including a redirect (reality-11), and mention "one capture at a time per side" where
  instability may come from concurrent captures (reality-15). `start_state_dirty` caused only by the text
  dimension names the text and the scenario change, not a reset and an `rm` (reality-3).
- **Excludes (cheat-2, referee-8).** Exclude entries are validated (relative, `/`-separated whole leading
  segments, no `..`, no glob characters, no backslash). The gate lists the excludes that matched at least
  one path, and whenever any exclude is in force the verdict summary says so in one line: N clone paths
  are excluded and are covered neither by staleness nor by the clean-room check.
- **Symlinks (cheat-3, referee-4, referee-14).** A link is flagged when it lexically leaves the clone
  root or cannot be resolved, without requiring its target to exist. Declared material that is absent is a
  finding; material reached through links is hashed by its real path or blocks. The name check also reads
  link text.
- **Tree walk (referee-6, referee-11).** A file that vanishes during the walk is skipped; other unreadable
  entries are findings, not a refusal. The spec and residual trust 6 say that modes, empty directories and
  special files are not part of the digest.
- **Evidence directories (referee-7).** Every non-hidden entry is listed; a non-regular one is rejected
  with a removal item, and run numbers account for all names.
- **Refused target (referee-10).** A `target.json` that cannot be read writes only the gate and the
  journal line; it does not prune `rendered/`, `behavior/`, `parity/` or `records/`.
- **Init (surface-3, trial-3, trial-17).** `init-clone-run` prints the referee's own first worklist, not a
  hand-written one, and while no scenario exists the input reasons come before `clone_root_missing`. It
  writes two more examples: a complete crawl capture input (`examples/crawl.example.json`, goto steps,
  accessibility and url after each step, bodies on) and a scenario with page steps (goto with
  `{origin}`, fill, select_option, click with `save_response`, wait_for).
- **Output size (surface-10).** `residual_trust` is printed only with `done` and `done_with_waivers`.
  Worklist items that share reason, dimension, expected and actual collapse into one item that lists the
  step ids.
- **What the verdict says about itself (reality-2, reality-8, reality-9, judge-5, judge-6).**
  `CLONE_RUN_RESIDUAL_TRUST` gains lines for: a step is compared on its outcome, requests, statuses,
  fetched reply bodies, page address and accessibility text only (not appearance, styles, images, fonts,
  response headers, the document title or timing); text inside an iframe and the text of alert, confirm
  and prompt dialogs are not compared; the clean-room check covers declared names and byte-identical files
  only and does not detect rewritten or paraphrased code. The check's own message says "names and
  identical files only".
- **Behaviour table (trial-12).** A JSON string body is shown as JSON, not as raw text.
- **Flags (cheat-4, surface-12).** Required options say "Required" in their description. Near-miss flag
  spellings are handled consistently. Without `--exit-code` the behaviour stays as documented.

## Tool readers (their own package)

- `rea export-web-scripts` and `rea environment-build` accept the Evidence bundle that
  `capture-browser-scenario --evidence_output` writes when it holds one capture record, through the same
  owner the comparer uses, and their refusal says "this is an Evidence bundle holding N capture records"
  when that is the cause (surface-1, trial-4, trial-6). `environment-build --dry-run` either lists the
  routes it found or the playbook stops claiming it does.

## Text (its own package, after the code)

- SKILL.md: a routing entry near the top of "Route the target first" and the frontmatter description name
  rebuilding or cloning a web application and point to the clone-runs reference before the original is
  touched (surface-9, trial-2). Version bump and regeneration as the repository requires.
- Playbook: scout and mapper cards name only commands that work on the file the playbook has them save,
  with the exact invocation for reading one step of a saved capture or no claim at all (trial-5, trial-6);
  the prober card shows `compare-scenario-behavior --left ... --right ...` once, states the step id
  pattern, says never to locate by an id or class of the original, says a rounding rule is established
  only by a step that lands exactly on a tie, and says how to probe a refusal notice with what the capture
  command supports today (trial-8, trial-9, trial-14, judge-3, judge-7); the mapper card says to probe the
  address the operator's health command calls and that pages which embed their data yield no routes from a
  crawl (judge-4, trial-6); "The loop" defines a judged round and the stall rule as built (trial-7); the
  lead card shows one wildcard volatile declaration and says where candidates are listed (trial-11); the
  unknowns rule says what to do when REA's actions cannot produce an input (write the unknown, report it,
  the user decides) (trial-13); stated limits match the new residual-trust lines.
- Reference page and spec: every changed behaviour, category, message, flag and limit. The spec's
  false-pass table is corrected row by row against what the fixed code does (comparer-13, referee-11,
  surface-12, surface-13).

## Tests, verifier and fixtures (their own package, after the code)

- Each fixed finding gets a regression test at the level that would have caught it (comparer-14,
  referee-12). The fixture scenarios gain the probes the review listed and the fixture clone is corrected
  until they pass; its About page is reworded with a matching declared rename (surface-4, surface-13).
- The verifier asserts exact exit codes and verdicts, re-reads what it claims was recomputed, forges all
  four referee outputs, cleans up on interruption and on a worker that exits early, and is split below the
  repository's file and function limits (surface-6, surface-7, surface-11). New verifier cases: a loopback
  alias for the clone address is refused; a dangling outside link is flagged; a download with different
  content is `changed`; an array against an index-keyed object is `changed`.
- The conformance test checks flags and the reason table's check and role columns, not only names
  (surface-5).

## Deferred, with where each goes

Capture-command changes belong to milestone 2 ("trustworthy captures"): text inside same-origin iframes
(reality-2); dialog text (reality-8); the document title (judge-5); a raw request body so malformed input
can be probed (trial-13, judge-2); a click or press that waits for a reply of any status (trial-14); the
roles `status`, `alert` and `heading` in role locators (judge-7); lost bodies under `Cache-Control:
no-store`; the step deadline; an automatic route census and surface coverage (judge-4).

Milestone 3 (packaged crew): a similarity measure between clone files and the original's scripts and an
enforced wall between scout output and builders (judge-6).

Not planned without the owner's word: scoping `rea setup --json` output to the requested client
(trial-1), which changes an existing output contract; rewriting the branch's two merge commits
(surface-8), which matters only when a pull request is opened.
