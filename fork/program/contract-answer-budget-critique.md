# Answer-budget contract: the critique and what was done about it

2026-11-21. The first contract was attacked by an independent critic (verdict: build after fixes; 2 critical,
5 major, 5 minor findings). Each finding was reproduced or checked before it was answered. The reviser's scratch
folder may be cleared; everything needed to repeat the checks is in `contract-scripts/` (its `v1/` is the
prototype the critic attacked).
Nothing was changed in `/home/user/rea`; REA was only run through its launcher.

## Dispositions

| Id  | Severity | Finding, in short                                                                                                              | Reproduced                 | Disposition                                 |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------- |
| F1  | critical | a harness that hands REA a regular file as stdout gets the budget switched off, and the environment variable cannot turn it on | yes                        | accepted, except the agent-marker variable  |
| F2  | critical | printed `next` commands dead-end or loop; the whole-task figure came from an oracle                                            | yes                        | accepted                                    |
| F3  | major    | the 1,024 B minimum cannot hold a digest; the prototype never drops the brief                                                  | yes                        | accepted                                    |
| F4  | major    | the referee's worklist loses commands, files and the reset instruction; its own text is marked untrusted                       | yes                        | accepted, in a different form than proposed |
| F5  | major    | edit E1 removes `remediation.action`, the key agents are told to follow                                                        | yes                        | accepted                                    |
| F6  | major    | the store's permission rule cannot work on Windows                                                                             | checked in source, not run | accepted                                    |
| F7  | major    | `get_evidence_bundle` changes its default without changing what agents are told; shape depends on size                         | yes                        | accepted, and widened                       |
| F8  | minor    | `saved-output list` cannot tell runs apart after a reset; a new container finds the store empty                                | checked                    | accepted                                    |
| F9  | minor    | 1.4 bytes per token is not a bound outside the census                                                                          | yes                        | accepted, with real-language text measured  |
| F10 | minor    | temporary-name collisions, no age limit, stale temporary files                                                                 | checked                    | accepted                                    |
| F11 | minor    | the prototype disagrees with the contract on the limitations command                                                           | yes                        | accepted                                    |
| F12 | minor    | verification runs only the unbudgeted path; test files and overlaps unowned                                                    | checked                    | accepted                                    |

## F1. Which stdout is an agent's

- **Seen.** In this harness `fstatSync(1)` and `fstatSync(2)` are regular files with the same `dev` and `ino`
  (`/proc/self/fd/1` and `/2` name one file). Under the first contract's row 3 that is "off".
- **Changed.** Section 2: explicit settings (`--output-budget`, `REA_OUTPUT_BUDGET`) now apply on every kind of
  stdout; only the default yields to a redirect. Section 3: a regular file that is also stderr is kind `capture`
  and gets the budget; a file of its own is kind `file` and gets today's bytes. The digest's `complete` line names
  the redirect only when the budget came from the default.
- **Tests.** "stdout kinds" (file alone, file shared with stderr), "precedence" (the variable with stdout in a
  file); three rows in `accept-cli-budget.mjs`, all failing on head today.
- **Rejected part.** Treating a marker variable such as `AI_AGENT` as "budget on": a script that an agent runs
  (`rea x --json > f; jq ... f`) would read a digest only when an agent started it, and an agent's own `> f` would
  stop giving every byte. The variable is set in this harness, so the case is real; it is left to the lead (19.5).
- **Not closed.** A harness that records the two streams in two files, and `2>/dev/null` inside a one-file
  harness, look exactly like `> f`. Section 16 row 24 says so.

## F2. Commands that lead nowhere

- **Seen.** The critic's `follow.mjs` rerun on the first prototype: 61 digests, 134 `next` commands, 22 over the
  budget (9 sliced, 13 unsliced, up to 6,503,944 B); `loop.mjs`: `inspect-artifact` on a zip, `providers` and
  `inspect-evidence-bundle` print the same `[0,1]` command at every hop.
- **Changed.** Section 5.2: an array of one row that cannot be read whole is entered as `<path>[0,1]` and its parts
  are listed; `page` is counted on the rows themselves. Section 5.3: a digest of a selection is built over the
  saved document with absolute paths (`resolveTargets`), and four progress rules (never the same command, always
  strictly less, never an unsliced array over a page, everything reachable). Section 8.3: `--text`, a raw-text
  reader in windows, because a filter page of a long string is one escaped line that can be neither paged
  sensibly nor searched.
- **Measured** with the revised prototype (`follow-next.mjs`, `follow-shapes.mjs`, `simulate-follow.mjs`): 162
  printed commands, 159 return content, 3 a deeper digest, 0 repeat, 0 over the budget; 237 listed rows, 234
  reach content in one hop and 3 in two; 13 synthetic shapes pass. Whole task following printed commands only:
  18 of 24 answered in the first reply, 5 after one printed command, 1 not reached in three hops (a word in a
  173 KB listing: one call with the search pipeline the text notice names); 95,145 B and 27,206 o200k tokens
  (95,324 B and 27,264 with that call). The first contract's 98,970 B with 14 follow-ups was an oracle walk and
  is withdrawn.
- **Tests.** "printed commands" (every `next` command run as printed, content within three hops for every
  listed row) and "digest rules" (P1 to P4 on real documents and on the synthetic shapes).

## F3. The minimum budget

- **Seen.** `minfit.mjs`: 63 of 112 digests over 1,024 B; with brief and stated limitations removed still 50.
- **Changed.** Minimum 2,048 B (`--token-limit` at least 1,576). Section 5.4 is now a complete fit order in seven
  steps with the brief dropped before any protected fact, a named core, and `budget.core_over` for the one case
  no order can fix (a store path of several hundred bytes at the minimum).
- **Measured** (`min-budget.mjs`, store directory of 199 B): 1,024 B: 44 of 112 over; 1,536 B: 0 over but 29 lose
  a protected fact; 2,048 B: 0 over, 5 lose one; 6,000 B: 0 and 0.
- **Tests.** "minimum budget": every row of the real-output table again at 2,048; smaller values refused.

## F4. The referee's worklist

- **Seen.** The first prototype's digest of the ten-item verdict kept role, reason, scenario and side for 8 items
  and one command; `untrusted_content` was `true`.
- **Changed.** Section 5.5: the brief is `worklist`, whole items in order, as many as the budget still holds,
  with `worklist_more` and, first in `next`, the command for the following items. Not the critic's proposal of
  every item with its message cut to 160 characters: ten commands of about 450 B do not fit 6,000 B, and the
  reset instruction sits past character 90 of a message, so a cut would remove it. Section 6.2: the mark is a
  list of paths when only some strings can quote the target; for the referee `["brief.worklist.message"]`.
- **Measured** (`follow-worklist.mjs`): 4 whole items in a first reply of 5,126 B, all 10 whole and in order
  after two follow-ups, 11,261 B in all against 11,126 B in one reply today. The digest makes a long verdict
  safe, not cheap; the saving is P4's bounded worklist. A ten-item verdict can be built without a browser
  (`init-clone-run` and three scenario files: 8,828 B on head).
- **Tests.** "referee worklist" in the repository, the same check in `accept-cli-budget.mjs`, and one budgeted
  case in `verify:clone-run`.

## F5. `remediation.action`

- **Seen.** The first prototype on the pre-check refusal returns no `remediation`. In 6 of the 19 census
  mistakes the projection sets `remediation.action` to the message.
- **Changed.** Section 7: no key of the projection is ever removed; E1 only rewrites the one MCP sentence; E5
  cuts message and action alike. Cost: 57 to 327 B in those six; the largest bounded error is 1,390 B.
- **Tests.** "bounded errors": `remediation.action` present whenever the unbudgeted error has it; two rows in the
  acceptance script. D7's "each sentence once" is therefore not met for this key (section 18).

## F6. The store on Windows

- **Checked.** `src/process/OwnedLease.ts:338` applies POSIX permission checks only where `process.getuid`
  exists; `reaCacheDirectory` puts the cache under the user profile on Windows.
- **Changed.** Section 8.1: the ownership and mode check only where `getuid` exists; on Windows none, with the
  reason stated and documented. The store takes `platform` and `getuid` as parameters; its test file joins the
  curated Windows lane of `ci.yml`. Nobody in this program ran Windows.

## F7. `get_evidence_bundle` and what agents are told

- **Seen.** The description says "Default complete returns an importable canonical bundle". On head an empty
  session returns 136 B and a session with two analyses 364,339 B, so "summary when over the budget" would have
  given one call two shapes.
- **Also seen, beyond the finding.** No advertised schema carries a `default` (0 of 263 tools); what omission
  returns is promised in descriptions, and three tools (`inspect_artifact`, `inspect_macho`,
  `decode_interface_builder`) say "Omitted or complete returns the complete ...".
- **Changed.** Section 11.2: both always-listed tools are lean whenever `detail` is omitted and the server has a
  budget, whatever the size; `binary_session` gets `"lean"` as a value. Descriptions rewritten in five source
  places, all owned by C. Section 11.1: a reply made smaller by the budget carries a second text block and a
  `_meta` entry that say so and name `detail: "complete"`. Three documents added to D.
- **Tests.** MCP row of 13.3; four more checks in `mcp-probe.mjs` (head: `FAIL 9/12`).

## F8 to F12

| Id  | Changed                                                                                                                                                                                                                                                                                                                                                                                     | Test or check                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| F8  | 8.1: an `about` file beside each saved document, with up to six scalars copied from the document, never argv; 8.3: `list` shows it and takes `--command`; an unknown id answers with what to do; `cli.md` tells sessions whose home does not persist to set `REA_SAVED_OUTPUT_DIR`                                                                                                          | "reader": two analyses of two targets list two different `about` values |
| F9  | 10.1: counted tokens, one per 1.3 ASCII bytes and one per other byte. Run on 21 classes (`token-classes.mjs`): real sentences in seven non-Latin languages are 4.24 to 7.98 bytes per token, so the critic's random strings were pessimistic; but 1.4 does fail for random Hangul, Cyrillic, rare CJK (1.01 to 1.34) and for random printable ASCII (1.36). The counted rule held in all 21 | "token bound", second row                                               |
| F10 | 8.1: random temporary names; documents unused for 14 days removed; `*.tmp` older than an hour removed; `clear` reports the documents removed                                                                                                                                                                                                                                                | "store"                                                                 |
| F11 | Section 12 says the text wins over the scripts; the limitations command prints the paths the sentences were read from; an object row's own sentences are read at `<row>.limitations`; the prototype no longer prints an unsliced collection                                                                                                                                                 | `follow-next.mjs`: 0 unsliced collections over the budget               |
| F12 | 13.2 names the owner of every existing test that changes; 13.3 adds a budgeted case to `verify:clone-run` and a browserless referee test; section 17 says who rebases and who re-records goldens when P3b, P4 and P3 touch the same places                                                                                                                                                  | `npm run verify:clone-run` reports the budgeted case                    |

## Found while rereading as the implementer

| What a builder would have tripped on                                                                                                                                                                     | Fixed in                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| "works as printed": `next` printed `rea ...`, but the skill starts REA through `npx` and a checkout through `node scripts/rea.mjs`; the first acceptance script removed the prefix before running        | 5.6; the acceptance script now runs commands through `/bin/sh` as printed |
| "unmatched filter" was defined as "the selection is undefined", which only a wrong first key produces; a nested typo prints `{"normalized_result":{}}` on head                                           | 10.4, with `resolveTargets`                                               |
| a sandbox with a read-only home (documented for one widely used agent CLI: only the workspace and temporary directories are writable) would make every save fail and every answer fall back to megabytes | 8.1, third candidate directory                                            |
| a token window larger than the budget: section 9 said the budget applies, 10.1 said the window is explicit                                                                                               | 9 and 10.1: a window is its own limit and never a digest                  |
| an error whose partial Evidence cannot be saved had no rule                                                                                                                                              | section 7, last sentence                                                  |
| `parent_evidence_id` was protected in the first prototype and not in the text                                                                                                                            | 5.1 row 1                                                                 |
| C was given `src/recordedMcpCatalog.ts`, a stub the build fills, and not `src/server/serviceToolBindings.ts` in the site table                                                                           | section 12                                                                |
| B needs `editDistance`, which `commandSuggestion.ts` does not export                                                                                                                                     | site 17                                                                   |
| `CHANGELOG.md` is generated from commits                                                                                                                                                                 | section 14: the footer goes on A2's commit                                |

## Runs behind this file

| Run                                                                                                       | Result                                                                   |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `node check-filter-port.mjs /home/user/rea/scripts/rea.mjs <home>`                                        | the transliterated filter gives the CLI's bytes for 17 of 17 expressions |
| `node follow-next.mjs <census out> 6000` (also 4000, 2048)                                                | `PASS` at each; numbers in `examples/follow-next.txt`                    |
| `node follow-shapes.mjs`                                                                                  | `PASS`, 13 shapes, deepest hop 4                                         |
| `node min-budget.mjs <census out> 1024,1536,2048,3000,6000 200`                                           | `examples/min-budget.txt`                                                |
| `TOKENIZER=<o200k> node simulate-follow.mjs <census out> 3000,4000,6000,8000,12000`                       | `examples/simulate-follow.txt` and its detail                            |
| `node follow-worklist.mjs <ten-item verdict> 6000` and `4000`                                             | `examples/follow-worklist.txt`                                           |
| `node token-classes.mjs <o200k>`                                                                          | `examples/token-classes.txt`                                             |
| `node accept-cli-budget.mjs /home/user/rea/scripts/rea.mjs <inputs> <scratch>` on head `0e089b3`          | `FAIL 50/61` (`examples/accept-cli-budget.today.txt`)                    |
| `REA_ROOT=/home/user/rea node mcp-probe.mjs <inputs> <scratch> out.json` on head                          | `FAIL 9/12` (`examples/mcp-probe.today.txt`)                             |
| the critic's `follow.mjs`, `loop.mjs`, `minfit.mjs`, `minfit2.mjs`, `tok.mjs` against the first prototype | the critic's numbers (the random-string runs within 0.01)                |

## The critic's report, as received

Verdict: build after fixes. Summary: "The contract is well grounded in the code and most of its mechanisms survived
checking. It has two defects that would undo it, plus several smaller ones." The findings follow in the critic's
words (claim, evidence, proposed fix); the critic's scripts were in its own scratch folder.

### F1 (critical, costs more than it saves)

- **Claim.** An agent shell tool that captures stdout into a regular file gets the budget switched off. Precedence
  row 3 (stdout is a regular file means off, today's bytes, TOON) fires for that harness, so none of the CLI
  savings reach it. Row 3 sits above row 4, so even `REA_OUTPUT_BUDGET=6000` set in that agent's environment
  cannot turn the budget on; only a per-call `--output-budget` flag can.
- **Evidence.** Run in this agent harness's shell tool: `node -e 'fs.fstatSync(1)'` gives isFile true, isFIFO
  false, isTTY undefined. `/proc/self/fd/1` and `fd/2` both point to the same file, with equal dev and ino. A
  human `> r.txt` redirect in the same shell gives isFile true but fd 1 and fd 2 with different inodes. Contract
  section 2 rows 3-4 and section 3 (regular file row). `accept-cli-budget.mjs` runs every check through spawnSync
  pipes. Its only file check asserts that a redirected file gets the complete result, so it builds this outcome
  into the acceptance test. The harness also sets a generic marker variable (`AI_AGENT`).
- **Fix proposed.** (a) Move `REA_OUTPUT_BUDGET` above the regular-file row. (b) Treat stdout as a user redirect
  only when it is a regular file and fd 2 is not the same file (compare dev and ino). (c) Optionally also treat a
  known agent marker variable such as `AI_AGENT` as active. (d) Add acceptance rows: stdout and stderr on the same
  regular file gives a digest; stdout alone on a file gives the complete result; `REA_OUTPUT_BUDGET=6000` with
  stdout on a file gives a digest.

### F2 (critical, answer lost)

- **Claim.** The printed `next` commands often lead to a dead end, and for single-row arrays to an infinite loop.
  When a page is over budget, the digest of that selection never descends into array elements, so it re-lists the
  same collection and prints the same slice again. Row content under a one-row array cannot be reached by any
  printed command, including in the contract's own worked example. The whole-task figures (14 follow-ups,
  98,970 B) come from an oracle walk, not from following printed commands.
- **Evidence.** `follow.mjs` builds the prototype digest for every census JSON output over 6,000 B and applies
  REA's filter grammar (`src/cli/cliResultOutput.ts:857-1000`) to each printed `next`. Result: 61 digests, 134
  next commands, 22 return more than 6,000 B (9 sliced, 13 unsliced whole collections, up to 6,503,944 B), across
  15 outputs. `loop.mjs` follows the first slice command hop by hop: `inspect-artifact.zip` goes
  `normalized_result.substeps[0,1]` (10,892 B) to a digest whose only rows are `normalized_result.substeps`
  (rows 1) and whose next is the same `[0,1]`, identical at hops 1 to 4. The same loop happens for
  `inspect-artifact.jar` (9,811 B), `inspect-evidence-bundle.records` (`records[0,1]`, 52,070 B) and `providers`
  (`analysis_provider_candidates[0,1]`, 16,272 B). The analyze-js brief next `graph.nodes[0,3]` is 11,249 B and
  needs a second hop. `digest.mjs` `omitted()` says "never into arrays". K is computed from the average row size.
  `simulate-budget.mjs` Part 2 picks the answer's own index from `locate()`, uses `> out.txt` plus grep for text,
  and sets `done = size <= budget || true` even when the page was a sub-digest. `accept-cli-budget.mjs` checks
  only that next[0] exits 0 and fits the budget, so a looping digest passes.
- **Fix proposed.** When the selection is a slice whose rows are over budget, list paths inside the row. Size K
  from the largest row, not the average. Never print a next command that would reproduce the current selection,
  and never print an unsliced collection over budget. Rerun the simulation following only printed next commands
  (breadth first to depth 3) and publish that number beside the oracle one. Add an acceptance and unit row: from
  each real document, the printed next commands reach a page that fits the budget for every listed collection
  within 3 hops.

### F3 (major, script or test broken)

- **Claim.** The allowed minimum budget (1,024 B, and `--token-limit` 732) cannot hold a digest, so "never more
  than the budget" and D10's token bound both fail for small values. The contract's fit order also says the brief
  is dropped whole, but the prototype the builder is told to copy never drops it.
- **Evidence.** `minfit.mjs`: at 1,024 B, 63 of 112 digests are over budget (worst
  `evaluate-clone-run.many-items`, 1,992 B); at 1,400 B, 22 of 111; at 2,000 B and 2,800 B, 0. `minfit2.mjs` also
  deletes the brief and every stated limitation when over: still 50 of 112 over at 1,024 B (worst
  `worklist-capture.1.original`, 1,600 B) and 11 of 111 at 1,400 B. In `digest.mjs` the fit loop pops omitted,
  result, limitations.stated and next, never brief.
- **Fix proposed.** Set the minimum budget to 2,048 B (`--token-limit` at least 1,463), or prove a smaller floor
  by running the table test at the minimum. Make the prototype drop the brief whole before protected facts, and
  cap the protected sets. Add the minimum budget as a row of the real-output table test.

### F4 (major, answer lost)

- **Claim.** The clone-run loop loses the referee's instructions. The playbook says each `next` item names a
  role, a reason, a file, what is wrong and the exact command. The `evaluate-clone-run` digest keeps only role,
  reason, scenario and side for 8 of 10 items, plus the first command. The per-item `message` (which carries the
  instruction to reset the original before each capture), `file` and commands 2 to 10 are dropped. The referee's
  own document is also marked `untrusted_content: true`, which may make a careful agent hesitate to run
  `first_command`.
- **Evidence.** `show-digest.mjs` on the census `evaluate-clone-run.many-items.out` (11,126 B, 10 next items)
  gives a 2,628 B digest: `brief.next_items` has 8 entries of 4 keys and `next_items_more` is 2; only
  `first_command` is kept. `references/clone-runs.md:37-43`. Contract 6.2's exempt list does not include
  `evaluate-clone-run`. Contract section 14 says the role cards need "none".
- **Fix proposed.** Make the brief carry every next item's {role, reason, file, command} and the message cut to
  about 160 characters, dropping whole items last-first. Alternatively, have P4 bring the verdict under the budget
  before P1 lands, and test the combined result. Exempt REA-authored referee fields from `untrusted_content`, or
  mark only the fields that carry target text. Add the 10-item verdict as a row of the real-output table, with
  the assertion that every item's command is in the first reply.

### F5 (major, agent misled)

- **Claim.** Bounded-error edit E1 removes `remediation` whenever the message contains its action. It does this
  even on the section 8.4 pre-check refusal, whose shape the contract says keeps `remediation.action`. Under the
  default budget, a script or agent reading `.remediation.action` gets nothing. Tests do not notice, because they
  run with the budget off.
- **Evidence.** The prototype `buildBoundedError` on the exact 8.4 refusal prints an error without `remediation`.
  The skill tells agents "Follow its `remediation.action`" (`references/connection-and-recovery.md:63`;
  `docs/design/limits-and-recovery.md:448`). `tests/boundary/cli/artifactCallerSelection.test.ts:81-87` expects
  `remediation: {action: ...}`, and that test runs with the switch off.
- **Fix proposed.** Never drop `remediation`; it is about 60 B. If a duplicate must go, shorten `message` instead,
  or keep `remediation.action` and drop nothing. Add a budgeted test asserting that the pre-check refusal and
  every bounded error keep `remediation.action` whenever the original had it.

### F6 (major, cannot be built as written)

- **Claim.** The store's privacy rules are POSIX-only. On Windows, Node reports synthesized mode bits, so the rule
  "refused when group- or world-writable" would refuse every save: the budget would silently never apply and the
  complete result would be printed. If the check is skipped instead, the 0600 and 0700 promises mean nothing
  there. REA itself treats Windows privacy as needing a native DACL boundary.
- **Evidence.** Contract 8.1. `src/process/PrivateRuntimeRoot.ts:31-37` and `64-69` route win32 through
  `windowsNativeCapabilities(...).private_runtime_dacl`. `tests/support/cli/cliFixture.ts:118-126` shows REA tests
  run on win32. Not run on Windows by the critic or the author.
- **Fix proposed.** Specify the Windows store separately: create the directory through the existing
  WindowsPrivateRuntime and DACL helper, or put it under `%LOCALAPPDATA%` and skip the mode check with a stated
  reason. Add the Windows case to the store test matrix and the CI lane that already runs win32.

### F7 (major, agent misled)

- **Claim.** Rule 14 changes `get_evidence_bundle`'s default without changing what agents are told. The tool
  description still says the default returns an importable bundle, several documents still say the complete
  record comes from it, and no package owns those texts. Because the switch happens only when the reply is over
  budget, a client exporting a bundle gets an importable bundle when the session is small and a non-importable
  summary when it is large.
- **Evidence.** `src/contracts/sessionToolContracts.ts:255-258`, not in package C's files.
  `docs/api-contracts.md:47`, `docs/javascript-route-inventory.md:68` and `docs/desktop-applications.md:56` are not
  in package D. Contract 11.2 supplies the summary as a rule-13 alternative, which fires only over budget.
- **Fix proposed.** Add `sessionToolContracts.ts`, and the regenerated catalogue that carries its text, to package
  C, and rewrite the description. Alternatively make the lean default unconditional so the shape does not depend
  on size. Add the three documents to package D.

### F8 (minor, gap)

- **Claim.** After a context reset, `rea saved-output list` cannot tell which saved answer is which. Entries
  carry id, command, time, bytes and file, and argv is never stored. Ten `analyze-javascript-application` entries
  for different targets look alike. A session resumed in a new container also finds `~/.cache` empty, while its
  transcript names the store files.
- **Fix proposed.** Have `list` read identifying facts from the document itself, never argv: evidence_id,
  operation, the subject's path or sha256 and evaluated_at. Add a `--command` filter. Document
  `REA_SAVED_OUTPUT_DIR` pointing into a persisted work folder for cloud sessions.

### F9 (minor, other)

- **Claim.** The fixed 1.4 bytes per token behind `--token-limit` is not a real bound for plausible target text
  outside the census, such as Korean or Cyrillic application strings, or rare CJK.
- **Evidence.** `tok.mjs`, o200k_base on JSON-encoded random strings: Hangul syllables 1.33, Cyrillic 1.34, CJK
  Extension B 1.01, digits and punctuation 1.41 bytes per token; Latin-1 high characters 1.98; emoji 1.79. Random
  strings are pessimistic; real-language text was not measured.
- **Fix proposed.** Count real tokens for windows whose bytes are mostly multibyte, or use 1.0 bytes per token
  when more than half the window's bytes are non-ASCII. Have the notice say which rule was applied.

### F10 (minor, answer lost)

- **Claim.** The store's write and eviction details can turn the fallback into a flood, or keep target content
  forever. The temporary file name `<name>.<pid>.tmp` opened with `wx` collides when two containers share a home
  and their processes have the same pid; the save then fails and the complete result is printed. There is no age
  limit, so target-derived results stay in `~/.cache` until 512 MiB is reached. Temporary files left by a killed
  process are never mentioned.
- **Fix proposed.** Add random bytes to the temporary name. Add an age expiry (for example 14 days, refreshed by
  `show`). Have eviction remove `*.tmp` files older than an hour. Have `clear` report the count of target-content
  files removed.

### F11 (minor, cannot be built as written)

- **Claim.** The prototype the builders are told to copy disagrees with the contract on `next`. When limitations
  live only in omitted parts, the prototype prints the largest collection unsliced (for example
  `--filter-output normalized_result.semantic_graph.nodes`, 6.5 MB, which only yields another digest) instead of
  `--filter-output limitations`. And `--filter-output limitations` selects only the root key, not
  `normalized_result.limitations`, which the stated count includes.
- **Fix proposed.** State in section 12 that the contract text wins over `digest.mjs` and fix the prototype. For
  `in_omitted_parts`, point to each omitted object row's own limitations path. Make the limitations command
  `--filter-output limitations,normalized_result.limitations`.

### F12 (minor, gap)

- **Claim.** Verification would check only the unbudgeted path. The one statement in `verifier-cleanup.mjs` turns
  the budget off for 94 or more scripts, including the clone-run verifier, so nothing outside the new table test
  exercises what agents actually see. The package split is also clean only internally: P3b (help and
  `discovery.ts`, help goldens) and P4 (the clone-run brief) run in the same wave on the same files, and the test
  files listed in 13.2 belong to no package.
- **Fix proposed.** Add one budgeted lane: `verify:clone-run` run once with the budget at its default, asserting
  the loop completes by following only digest commands. Assign the 13.2 test files to A2 explicitly, and add a
  merge note naming the P3b and P4 overlaps with the order in which they rebase.

### What the critic found to hold

Compact JSON instead of TOON costs no tokens (56,838 against 59,049 o200k on the 60 outputs under the budget);
digest paths and commands are well formed; MCP rule 13 can be built at the one delivery site, and retention never
evicts a summary's parent; the test switch reaches every project through `extends: true`; the launcher covers both
package bin names; the clone-run verifier spreads `process.env`; the desktop capture bridge keeps its events and
its complete output; only three documented `--json | jq` pipelines exist; bounded errors bring the large failures
to at most 1,385 B; and each of the first contract's six challenges to the lead's decisions was checked against
the cited lines and holds.
