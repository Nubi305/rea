# Round 2: what the independent verifiers found after the first fix round (build 77500a5)

Scratch of the verifiers: /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-pass and .../verify-false-fail (script copies in /home/user/rea-design/m1/fix-scratch/).

## Verifier false_pass

Summary: Three routes to `done`, exit 0, for a wrong clone remain on 77500a5, each reproduced with real browser captures through `evaluate-clone-run --exit-code`. Two come from what the fix round relaxed, one is an incomplete fix of comparer-1.

- **Wildcard pointer:** with `/items/*/id` declared volatile, a clone that steadily answers `"WRONG-9"` where the original steadily answers `"seed-1"` reads `done`, because another index varies. The first round listed this as held ("a steady item under a wildcard is still contradicted").
- **Array against index-keyed object:** still equal when every leaf under the container is an honoured volatile leaf (`{"ids":[…]}` against `{"ids":{"0":…,"1":…}}` with `/ids/*` declared).
- **`setup-` plus a declaration:** a failing step renamed `setup-` with its steady wrong leaf declared volatile reads `done`; the gate shows `volatile_fields: 0` and `ungated_steps: 1`. Spec row 188 lists this as not stopped; without the declaration it is `parity_changed`.

Of the 19 ids:

- **Fixed (12):** cheat-1, cheat-3, referee-1, referee-4, referee-6, referee-7, referee-8, comparer-2, comparer-3, comparer-6, comparer-7, reality-1.
- **Partly (3):** comparer-1 (above), referee-14 (an empty directory or FIFO named after the original still passes), cheat-4 (behaviour unchanged, help now warns; `--exit-code=1` exits 0 on `not_done`).
- **Stated limit (4):** cheat-2, reality-2, reality-8, reality-9. The wrong clone still reads `done` in each; the limit is now in the summary or residual lines 13 and 14 of my own `done` gates, the reference page (lines 519-522) and the playbook (lines 428-430).

Address identity held: 27 spellings planted in `target.json` after an honest init, and a fake-resolver table for multi-address names, gave no route to one server with exit 0. The stall rule held: no journal forgery, deletion or `max_rounds` value gave exit 0 for a not-done run. Text carry, clone repeats that disagree, varying request lines and non-HTML documents all read `changed` or `unknown` for the wrong clones I built.

Smaller new findings: the origin placeholder is the literal `{origin}`, so a clone that prints that token matches; a `journal.jsonl` that is a FIFO hangs the referee and it survives SIGTERM (I killed my two hung processes with SIGKILL); a `done` gate does not say downloaded files are outside it.

Not checked:

- a public DNS name (none resolves here; `localtest.me` is refused as unresolved);
- a hosts alias of my own (needs a system file);
- a name that resolves differently at capture and at evaluation;
- a clone file that vanishes or is unreadable during the walk (I run as root);
- the referee reviewer's `drive.mjs` and E-series scripts themselves (I ran the same cases through my own scripts).

Nothing of mine is running, no listener is on 4890-4899, and `git status` in /home/user/rea is empty. Everything is under /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-pass (`cheat/`, `comparer/`, `reality/`).

### Results that are not simply fixed

#### cheat-2: stated-limit

- evidence: `node 07-exclude.mjs` (ports 4894/4895): before and after, the clone answers slug "quarterly-planning-p" and re-evaluation is 'exit 0 verdict=done', evidence stale 0. Before, summary "done" and clone_tree.exclude [slug.mjs, .git, node_modules]. After, summary "done; 1 clone path is excluded and is covered neither by staleness nor by the clean-room check (slug.mjs)" and exclude ["slug.mjs"]. The wrong clone still reads done, as decided; the exclude is now in the summary.
- variation: `node exclude-var.mjs` on that run, 13 exclude lists in target.json: slug.mjs/ and ./slug.mjs match and are named in the summary; SLUG.MJS matches nothing, so the file is digested and both clone captures go stale (exit 1); *.mjs, a trailing space, /slug.mjs, assets/../slug.mjs and a backslash are target_invalid; excluding all six entries gives evidence_stale x2 with all six named. No spelling dropped a file from the digest without being named in the summary.

#### cheat-4: partly

- evidence: `sh 02-exit-codes.sh` on the not-done run: same exits as before. No flag: exit 0, verdict not_done. --exit-code and --exitCode: exit 1. --exit_code and --exitcode: UNKNOWN, exit 1. --exit-code=false and --no-exit-code: exit 0. `grep -c done` on the JSON still returns 1. What changed is the help: 'Gate on this exit status or on the verdict member, never on finding the word done in the output'.
- variation: Seventeen more spellings on the same run. Exit 0 with verdict not_done printed for --exit-code=1, --exit-code=0, --exit-code=no, --exit-code=FALSE, '--exit-code=' (empty), '--exit-code --no-exit-code', --no-exitCode and --exitCode=false. Exit 1 for --exit-code=true and '--no-exit-code --exit-code'. --EXIT-CODE and --exit-Code are unknown flags. `--exit-code=1` turning gating off is the surprising one.

#### referee-14: partly

- evidence: R14a, link text 'quillbrook-data' plus an empty directory quillbrook-empty: clean_room_forbidden_name x1, for the link only ('contains the original's name "Quillbrook" in its link text'). Before, neither was reported. The empty directory is still not reported.
- variation: R14c, link text 'data/../data/x#QUILLBROOK': forbidden_name x1 (case ignored). R14b, only an empty directory a/b/QuillBrook-cache: done, exit 0. R14d, only a FIFO named quillbrook.pipe: done, exit 0. The spec says the check covers a clone file's bytes, its path or a link's text, so these two are outside it as written; the finding named empty directories and that half is unchanged.

#### comparer-1: partly

- evidence: `bash comparer/real/run-real.sh`, fresh captures on 4896/4897: items a x2 against b x2, `compare-scenario-behavior --exit-code` before exit 0 'unchanged', after exit 1 'changed', step list-items body value at /items: ["x","y"] against {"0":"x","1":"y"}. `node exp1.mjs` (synthetic): array against index-keyed object, root and nested, 1v1 and 2v2, all 'changed'.
- variation: Not fixed when every leaf under the container is an honoured volatile leaf. Real browser, `node reality/case-relax.mjs kind 4896`: original answers {"ids":[uuid,uuid]}, clone {"ids":{"0":uuid,"1":uuid}}, /ids/* declared: 'verdict done (exit 0)', step ids unchanged. Synthetic K1 and K4 (exp5.mjs) agree, both directions. With a steady sibling field in each item (K2) it is 'changed' at /items, which is why the verifier's list-as-object mutant is caught.

#### reality-2: stated-limit

- evidence: `node case-unseen2.mjs unseen-iframe-alert 4896 iframe,alert` (the export click renamed setup-export so the run can finish): 'verdict done (exit 0)' with the clone's frame saying 'Balance: 999 overdue'. The done gate prints 14 residual_trust lines; line 14 is 'Text inside an iframe and the text of alert, confirm and prompt dialogs are not compared.' Reference page lines 521-522 and playbook lines 429-430 say the same.
- variation: A not-done gate from the same app (out-unseen-iframe.txt) prints residual_trust: [], so the limit is shown only with done, as decided.

#### reality-8: stated-limit

- evidence: Same run: the clone's alert says 'Could not save. Data lost.', step save is unchanged and the verdict is done, exit 0. Residual line 14 on that gate, reference page lines 521-522 and playbook lines 429-430 name alert, confirm and prompt dialogs.
- variation: Both differences switched on at once (iframe,alert) in one run still read done; nothing in the step list hints at either, only the residual line.

#### reality-9: stated-limit

- evidence: Residual line 13 on my done gates (cheat/out-mk-good.txt and reality/out-unseen-iframe-alert.txt): 'A step is compared on its outcome, its requests, their statuses, fetched reply bodies, the page address and the accessibility text only. Appearance, styles, images, fonts, response headers, the document title and timing are not compared.' Reference page lines 519-521 and playbook lines 428-429 carry the same list.
- variation: Not-done and stalled gates from my runs print residual_trust: [] (0 lines), so the list is on done only.

### New findings

#### vp-1: A wildcard pointer declaration hides a steady wrong value: done, exit 0

- severity: major
- where: Comparer, volatile fields: a pattern is honoured at every index once the left shows one index varying (spec.md lines 404-406; src/domain/scenarioBehaviorComparison.ts and ScenarioBehaviorComparisonService.ts)
- claim: With `/items/*/id` declared volatile, the original answers items[0].id as a fresh UUID and items[1].id steadily "seed-1"; the clone answers items[1].id steadily "WRONG-9". The verdict is done, exit 0, every step unchanged. With the declaration narrowed to `/items/0/id` the same pair is parity_changed at /items/1/id. The first round listed this as held ("a steady item under a wildcard is still contradicted", exp3 G2); G2 now prints unchanged. Spec row 194 says a declared field that does not vary is "never a match", which is untrue for a steady index of a pattern. The done gate shows only `volatile_fields: 1`.
- reproduction: `node /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-pass/reality/case-relax.mjs wild 4896` prints 'verdict done (exit 0)', 'unchanged list'. `... wild-control 4896` prints 'not_done (exit 1)', 'changed list <- body/value @/items/1/id exp="seed-1" act="WRONG-9"'. Synthetic: `node .../comparer/exp4.mjs`, cases W1, W1b, W2; `node .../comparer/exp3.mjs`, case G2.
- suggested fix: Honour a pattern only at the indexes where the left's own repeats differ; an index the left holds steadily over two or more replies is `declared-not-shown` (unknown) when the right differs, as a plain pointer already is. For reality-12 (a list in random order) that still leaves every varying index honoured. Add G2 as a regression test and correct spec row 194.

#### vp-2: Array against index-keyed object still compares equal when every leaf beneath is an honoured volatile leaf

- severity: major
- where: Comparer, leaf equality by pointer and container kind (comparer-1 fix): the container-kind check is not applied on the honoured-volatile path
- claim: The original answers {"ids":[uuid,uuid]}, the clone {"ids":{"0":uuid,"1":uuid}}, with `/ids/*` declared. The verdict is done, exit 0. The decision says an array and an object with index-like keys differ; that holds only while at least one steady leaf sits under the container (K2 is changed). The first round also held that `*` matches an array index only; here it is honoured against an object key on the right.
- reproduction: `node /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-pass/reality/case-relax.mjs kind 4896` prints 'verdict done (exit 0)', 'unchanged ids'. Synthetic: `node .../comparer/exp5.mjs`, K1 and K4 print 'unchanged', K2 'changed'; `node .../comparer/exp4.mjs`, W3 and W4.
- suggested fix: Compare container kinds along the path for every leaf pair before the volatile rule is consulted, so a kind mismatch is `changed` at the container whatever is declared beneath it. Add the all-volatile list to the domain test beside the array/object pair.

#### vp-3: A failing step renamed setup- with its steady wrong leaf declared volatile reads done, and the gate does not show the declaration

- severity: major
- where: Comparer `declared-not-shown` (unknown) together with the referee's rule that only `changed` blocks a setup- step (CloneRunEvaluation.ts); spec.md line 188
- claim: Step `setup-read-plan`: the original answers {"plan":"free"} in both captures, the clone {"plan":"enterprise"}. With `/plan` declared volatile for that step the verdict is done, exit 0; without the declaration it is parity_changed. Before this round the declaration was ignored and the step stayed changed (first round, held A6 and the setup- row). The done gate reports `declared.volatile_fields: 0` and `ungated_steps: 1`, so the declaration that removed the block is not listed, although residual line 8 says the gate lists those that took effect. Spec row 188 states this as not stopped and equates it to deleting the step; the integrator asked the spec owner to decide and had not run it end to end.
- reproduction: `node /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-pass/reality/case-relax.mjs setup 4896` prints 'verdict done (exit 0)', 'unknown setup-read-plan <- body/declared-not-shown ... exp="free" act="enterprise"', ungated=1, declared=0. `... setup-control 4896` prints 'not_done (exit 1)', 'changed setup-read-plan'.
- suggested fix: Owner's decision. Either let `declared-not-shown` block on every step kind, as `changed` does (the difference is steady on the left and is only waiting for a recapture), or keep it and name each such step and its declaration in the done gate so the reader sees which declared difference was let through.

#### vp-4: The origin placeholder is the literal text {origin}: a clone that prints that token matches the original's real address

- severity: minor
- where: Comparer, origin placeholder in reply string values and on-screen text (ScenarioBehaviorComparisonService.ts / scenarioBehaviorCapture.ts)
- claim: The side's own start origin is replaced by the string `{origin}`, the same token REA's scenario files use. A clone whose JSON answers "self":"{origin}/api/abs" (an unrendered template) compares unchanged against an original that answers its real address. On-screen text behaves the same: the paragraph 'Share: {origin}/s/1' was identical on both sides; the step read changed only because the aria snapshot quotes a link URL that starts with a brace.
- reproduction: `node /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-pass/reality/case-relax.mjs origin 4896` prints 'unchanged abs-url' with real captures. Synthetic: `node .../comparer/exp5.mjs`, case O5 with "{origin}" prints 'unchanged'; six other tokens print 'changed'. `exp4.mjs` O3 is the mirror case.
- suggested fix: Compare origins structurally instead of by substitution text: replace each side's origin with a token that cannot occur in captured text (for example one carrying a per-comparison random value), or mark the replaced spans and require both sides to have a span at the same position.

#### vp-5: --exit-code=1 (and =0, =no, an empty value) silently turns gating off

- severity: minor
- where: src/cli/argvParser.ts (shared parser), seen on evaluate-clone-run
- claim: On a not-done run, `--exit-code=1`, `--exit-code=0`, `--exit-code=no`, `--exit-code=FALSE`, `--exit-code=` and `--no-exitCode` exit 0 with verdict not_done printed. Only `=true` keeps gating on. The reference and spec say `=false` and a `no-` prefix clear the flag and every other spelling is an unknown flag; these are neither. A script that writes `--exit-code=1` to mean on gets exit 0 on a failing run.
- reproduction: `node /home/user/rea/scripts/rea.mjs evaluate-clone-run /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-pass/cheat/w/base/run --exit-code=1 --json; echo $?` prints the gate with "verdict":"not_done" and 0.
- suggested fix: For a boolean option accept only `=true` and `=false` and refuse any other value as an argument error, so no spelling other than the documented two changes gating. Until the parser changes, add the refused-or-cleared values to the reference page.

#### vp-6: journal.jsonl replaced by a FIFO hangs evaluate-clone-run, and SIGTERM does not end it

- severity: minor
- where: src/application/cloneRun/CloneRunWorkspace.ts, journal read
- claim: With `journal.jsonl` a named pipe, `evaluate-clone-run` never returns. `timeout 30` sent SIGTERM and the node process was still alive 295 s later; I had to SIGKILL it. A FIFO in the clone root and a FIFO named run-9.json in an Evidence directory are both handled without a hang, and a journal that is a directory is replaced, so the journal is the one entry read without checking its kind. No verdict is produced, so this is a hang, not a false pass.
- reproduction: In a copy of a run folder: `rm journal.jsonl; mkfifo journal.jsonl; timeout 30 node /home/user/rea/scripts/rea.mjs evaluate-clone-run <run> --exit-code --json` does not return; `ps` shows the node child still running. Script: /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-pass/cheat/stall-var.mjs, step S7a.
- suggested fix: lstat the journal before reading it and treat anything that is not a regular file as it already treats a directory there (remove and rewrite, or skip with an empty journal). Add the case beside the existing journal-is-a-directory test.

#### vp-7: A done gate does not say that downloaded files are outside it

- severity: minor
- where: CLONE_RUN_RESIDUAL_TRUST (line 13) in the referee; docs/reference/clone-runs.md line 522 does say it
- claim: With the download click named `setup-` (the playbook's recipe) and no request step for the file, a clone that exports other data reads done, exit 0. The reference page says the content of a downloaded file is not compared; residual line 13 of the done gate lists only 'fetched reply bodies' and never mentions downloads, and line 14 covers iframes and dialogs only. The reader of the verdict sees `ungated_steps: 1` and nothing about the file.
- reproduction: `node /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-pass/reality/case-relax.mjs csvdl-setup 4896` prints 'verdict done (exit 0)', 'unknown setup-export <- body/not-recorded GET /export.csv#1', ungated=1, 14 residual lines, none naming a download.
- suggested fix: Add 'nor the content of a file saved through a download' to residual line 14 so the gate matches the reference page.

#### vp-8: A link whose text leaves the clone root and re-enters by the root's own name is not flagged

- severity: nit
- where: src/application/cloneRun/CloneRunTreeDigest.ts, lexical test of link text
- claim: The decision says a link is flagged when it lexically leaves the clone root. `l -> ../clone/sub/real.mjs` in a root named clone is not flagged, because the joined path normalises back inside. It resolves inside the root now, and I found no way to use it: with the declared root itself a link, the same text lands outside the real tree and is flagged, target present or hidden.
- reproduction: `node /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-pass/cheat/symlink-var.mjs` prints 'l18-out-then-back-in -> ../clone/sub/real.mjs ... scope=pass flagged(0)'. `symroot.mjs` shows the flagged variant.
- suggested fix: Test the link text segment by segment from the link's own directory and flag it as soon as the walk rises above the clone root, whatever it does afterwards; or say in the spec that the test is on the normalised path.

### Still held (do not break)

- Edited clone Evidence without a recomputed digest: evidence_rejected_integrity x2 and evidence_missing x2, exit 1 (01-file-only A1).
- One clone capture copied to stand in for the second: duplicate 1, evidence_missing, exit 1 (A3).
- The original's captures filed under the clone, directly or through an evidence/clone link: evidence_rejected_address x2, exit 1 (A4, A4b).
- The failing /slug leaf declared volatile though steady on the original: still not_done, now parity_changed x7 and parity_unknown x4 (declared-not-shown) on behaviour steps (A6).
- The empty pointer declared volatile: intended_differences_invalid, and the differences still surface (A6b).
- gate.json and parity/ forged to say done: recomputed, not_done with the same 11 parity_changed (A7; again with the journal removed, stall S8).
- A waiver of kind parity: waivers_invalid; parity cannot be waived (A11).
- Every obligation turned inferred and waived: parity_changed x11 unaffected (A11b).
- Stray files in evidence/: still not_done; a nested directory is now reported as evidence_rejected_integrity where it used to be ignored (A12).
- One obligation citing every step: no effect on parity (A13).
- Journal deleted: no effect on the verdict (A14); run folder and clone root moved to a new path: same honest not_done (A0).
- init refuses the original's own address as 127.0.0.1, localhost, LOCALHOST, app.localhost, 0.0.0.0, [::1], 127.0.0.2, 127.0.0.1., 127.1, 2130706433, 0x7f.0.0.1, port 04892 and a trailing slash (03-alias-init).
- A setup- step that is `changed` still blocks: parity_changed at setup-read-plan, exit 1 (case-relax setup-control). The exception is new finding 3.
- target.json that is not JSON: target_invalid, verdict not_done, exit 1 (02-exit-codes).
- Exit codes with --exit-code: 0 done, 1 not_done, 2 stalled, all seen in my runs.
- Stall: the same not-done state evaluated four more times stays round 1, attempt 1, exit 1.
- Stall cannot be forged into a pass: journal lines rewritten to verdict done, invented and malformed lines, a link to /dev/null and a link to the done run's journal all give not_done exit 1; seventy forged rounds give stalled exit 2; deleting the journal after a stall gives not_done again.
- limits.max_rounds of 0, -1, 1.5, "8" and null are target_invalid; 1 gives stalled exit 2; no value gives exit 0.
- Text carried from an earlier step does not hide wrong text: first appearing on an fp- request step, a setup- step or a later behaviour step it is `changed`; unsteady text is repeated on the following behaviour step (exp4 T1-T6).
- A clone wrong on every second capture, in 2 of 3 captures, in alternate leaves, or with status 500 every second capture is `unstable`, never unchanged (exp4 R1-R4).
- Beside a cache-busted request line: an omitted steady request and a wrong reply to a steady request are `changed`; an extra request in every capture and a wrong reply on the varying line are `unstable` (exp4 Q1-Q4).
- Step wildcard `*`: a leaf steady on the original in another step is declared-not-shown, unknown, not unchanged (exp4 S1).
- A clone that prints the original's address, or another port sharing the origin's prefix, is `changed` (exp4 O1, O2, O4).
- Comparer exactness from the first round still holds in exp1-exp3: number against string, null against missing, [] against {}, array order and length, text against JSON string, lossy numbers, lost bodies on either side never agreeing, renames in order, right page at the left's origin, other-origin requests unknown. The one exception is G2, new finding 1.
- A two-record bundle is refused with the documented message (exp3 L1).
- Wrong-clone baseline: the slug mutant followed through the worklist is not_done, exit 1, parity_changed x11 at /slug (00-baseline).

## Verifier false_fail

Summary: Scratch base (all paths below are under it): /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-fail. Build under test: /home/user/rea at 77500a5, untouched.

What I ran: the reality attack's own case scripts again with fresh captures on ports 4900-4907 (fix-ids, fix-day, api-decl, api, concurrent, pages-a, pages-b, day), one case of my own (reality/case-var.mjs), the comparer reviewer's exp1-3 plus three variation scripts against the built modules, the referee reviewer's e1/e9/E10/E6d/E6a and drive.mjs C on copies, the trial's run folder and clone, and the first half of the playbook on a copy of the fixtures from a throwaway HOME (ports 4908/4909).

Of the 28 findings assigned: 23 fixed, 5 partly (reality-6, reality-7, reality-11, referee-10, surface-12), none regressed, none unchecked.

Trial replay: verdict not_done, exit 1 (was stalled, exit 2). One blocking reason, unknown_open x1; all other checks pass; 640 steps unchanged, 0 changed, 25 unstable and ungated. `setup-click-parcel-weight-not-a-number` is now unstable (text/repeats-differ, side right), not parity_changed. stall: round 2 of 8, attempt 1 of 2. The one worklist item, in full: role lead, reason unknown_open, file unknowns/prober-1.json, command `rea evaluate-clone-run '<run>' --exit-code`, message: `unknowns/prober-1.json is open: "What the original answers to a request body that is not well-formed JSON was not probed: a request step only sends well-formed JSON, and the original's own pages never send anything else." The lead settles it in waivers.json: add {"kind":"unknown","id":"prober-1","person":"<name>","reason":"<why this gap is accepted>"} to waivers, or once an observed obligation shows the answer add {"unknown":"prober-1","obligation":"<obligation id>"} to closed.` It does not say that only the user can settle it; the playbook does. That is new finding 1.

Trial frictions: trial-2 to -12, -15, -16, -17 fixed; trial-13 and -14 stated-limit; trial-1 unchanged.

Seven new findings. The three that matter most: the unknown_open item prints a paste-ready waiver with a name placeholder and no word about the user; the scout card's third command prints 3.3 MB to stdout for 44 KB of scripts; an application that prints its own host:port without the scheme is still parity_changed to the builder with "Change the clone".

One disagreement with the integrator's report: it says the on-screen day-dependent value is documented as a limit. I found no such sentence in the playbook, the reference page or the spec (grep for day, date, calendar, tomorrow, "changes by").

Not done: the playbook's second half (spec writer, builder, verifier cards), the refusal-notice recipe (trial-14) and examples/scenario-pages.example.json as a capture were not run. New finding 5 is shown at comparer level only. Everything I started is stopped; no listener on 4900-4909.

### Results that are not simply fixed

#### reality-6: partly

- evidence: Address with scheme: fresh `node case-api.mjs api 4900`: abs-url unchanged with no rename (before: changed, builder 'Change the clone'); pages-b scenario share: 3 of 3 steps unchanged (before: all changed). Name in another spelling: fresh pages-a, scenario about: two parity_changed items to the lead, 'The two values are equal once "QUILLMARK" reads "TIDEPOOL" … the lead adds {"from":"QUILLMARK","to":"TIDEPOOL","reason":"<why the clone differs>"} to renames … The clone is not changed for this'. Pasting both printed entries into a copy (reality/runs/pages-a-v) made scenario about unchanged 3/3.
- variation: reality/case-var.mjs scenario addr: each side prints its own host and port without the scheme (on screen 'Served from 127.0.0.1:4904', reply field /host). Result: two parity_changed items to the BUILDER: 'the original gave "127.0.0.1:4904", the clone gave "127.0.0.1:4905". behavior/addr.json shows what the original does. Change the clone, restart it…'. The clone is correct. Adding the rename 127.0.0.1:4904 -> 127.0.0.1:4905 by hand cleared both (reality/runs/var2). See new finding 3.

#### reality-7: partly

- evidence: Reply field, declared: `node case-fix.mjs day 4900`. Before: `changed read-today <- body/value`, builder 'Change the clone', declared volatile_fields 0. After (reality/out-fix-day.txt): `unknown read-today <- body/declared-not-shown side=left`; item to the prober: '… is declared volatile in intended-differences.json, but the original's captures all gave "2026-11-20" and the clone gave "2026-11-21". … capture the original again now … If the original still gives one value, the lead removes the entry from volatile_fields, and the difference is then the builder's to fix.' with the original's capture command. (The harness kept following that command; the clone's clock is offset by design, so the run read stalled after 5 attempts.) On screen: `node case-pages.mjs day 4902 today 1 12` is unchanged from before the fix: two parity_changed items to the builder, 'Today is 2026-11-20' against '2026-11-21' and /today, both ending 'Change the clone, restart it, have it captured again'. I found no sentence stating this limit in the playbook, docs/reference/clone-runs.md or the spec.
- variation: Copy of the fresh fix-day folder with the declaration withdrawn (reality/runs/fix-day-v): parity_changed to the builder, as the message promises, and the verdict went from stalled back to not_done. Comparer V9a/V9b (declared by step id and by `*`, left steady, right steady and different): unknown, declared-not-shown. V9c (right has another shape, a number): changed.

#### reality-11: partly

- evidence: Fresh `node case-api.mjs api 4900`, scenario redirect. Before: 'not-completed at step on the original … Make the step complete on the original at its own address', no word of a redirect. After: 'Step redirect-302 failed on the original in evidence/original/redirect/run-1.json, and every step after a failed one is cancelled. redirect-302 is a request step: it fails when the application answers with a redirect (a 3xx reply, which a request step does not follow), with a status outside its expected_status, or after the page has left the original's address. A redirect is reached through the page…'. The capture itself recorded the exact cause for that step ('Request step redirect-302 was answered with a redirect, which request steps do not follow…', read from the Evidence file), and the item does not print it: the redirect is one of three listed causes.
- variation: Two. (a) case-var scenario strict: a request step with expected_status [200] answered 201: the same three-cause sentence plus the redirect advice; the received status is not named. (b) pages-a scenario late: the wait_for step failed in all four captures with 'strict mode violation: locator('#list li') resolved to 2 elements'; the item says 'it fails when the page it needs did not load, its locator matched nothing in time, or a reply it waits for did not answer 2xx'. None of the three is the recorded cause. See new finding 4.

#### referee-10: partly

- evidence: referee/E9 step 2, target.json cut to 300 bytes with an open unknown (the reviewer's E6a cut it to 400). Before: behavior/, parity/ and rendered/original/ were emptied. After: all three still hold topics.json; verdict not_done with target_invalid; one journal line with clone_tree_sha256 null. Not changed: the two items' command reads `rea evaluate-clone-run '<run>' --exit-code` although the run was created with `--rea-command 'node /home/user/rea/scripts/rea.mjs'`; `which rea` finds nothing here, so the command does not run as printed. The decisions file decided only the prune.
- variation: Same evaluation, stall.outlook: 'Not judged: a scenario lacks admitted captures on a side…'. Here every capture is in place and the cause is the unreadable target.json. See new finding 6.

#### surface-12: partly

- evidence: `--help`: the six required options of init-clone-run and --left/--right of compare-scenario-behavior start with 'Required.'. Refusals are unchanged in substance: `rea compare-scenario-behavior --left left.json --json` exit 1 `{"code":"VALIDATION_ERROR",…"fieldErrors":[{"code":"invalid_type","missing":true,"path":"right","expected":"array",…}]}`; init with --original-name ab: path `originalName.0`. The key, not the flag, is named, and there is no `error` member.
- variation: init without --clone-root: path `cloneRoot`, missing true. evaluate-clone-run with no directory: path `directory`. The new `missing:true` field does tell a missing option from a bad value.

#### trial-replay: partly

- evidence: Copy of /home/user/rea-trial/work/run and clone (trial/), target.json pointed at the copy, `rea evaluate-clone-run <copy> --exit-code --json`: exit 1, not_done, 'not done: 1 blocking finding', blocking unknown_open x1; checks: unknowns fail, the other seven pass; 640 unchanged, 0 changed, 0 unknown, 25 unstable, ungated_steps 25; evidence admitted 28, stale 10, scenario_mismatch 10; stall round 2 of 8, attempt 1 of 2; 4.2 s. Before: exit 2, stalled after 4 judged rounds, parity_changed x1 and unknown_open x1. In parity/pages.json the step setup-click-parcel-weight-not-a-number is `unstable`, one finding text/repeats-differ side right. Two of the three expectations hold. The third does not: the unknown_open item (quoted in the summary) does not say that only the user can settle it.
- variation: Copy with one surplus capture of the original removed (trial/run-v) and nothing else changed: exit 2, 'stalled after 2 judged rounds (the same findings were judged 2 times on the same clone tree)'. The previous gate's outlook had announced exactly that.

#### trial-1: not-fixed

- evidence: Unchanged, as planned: `HOME=<throwaway> rea setup --yes --json --client claude_code` exit 0 printed 33,692 bytes with clientStates for 43 clients and no pointer to SKILL.md.
- variation: none

#### trial-13: stated-limit

- evidence: The playbook states it (installed lines 101-105: 'An input REA's actions cannot produce is an unknown too … Write the unknown and report it. The user then decides…'; lines 466-469: 'An agent never supplies the name. A headless run that would need a waiver stops and reports instead.'). The run still ends not_done on unknown_open, and the referee's own item does not carry the limit (new finding 1).
- variation: none

#### trial-14: stated-limit

- evidence: Playbook, Capture judgment, installed lines 453-459: name the click setup-, follow it with a step that waits for the notice, cite that step, wait by attribute such as [role=alert]. Read only; I did not run the recipe on a fixture.
- variation: none

### New findings

#### vf-1: The unknown_open item prints a paste-ready waiver with a name placeholder and never says that only the user grants one

- severity: major
- where: src/application/cloneRun/CloneRunEvaluation.ts:1603-1614 (unknown_open message)
- claim: The item reads: 'The lead settles it in waivers.json: add {"kind":"unknown","id":"prober-1","person":"<name>","reason":"<why this gap is accepted>"} to waivers, or once an observed obligation shows the answer add {…} to closed.' Nothing says that the person must be the user or someone the user names, that an agent never supplies the name, or that a headless run stops and reports here. Those rules exist only in the playbook (installed lines 101-105 and 466-469). The playbook also tells roles to start from the referee's messages, 'not from memory'. In the trial this item is the last thing between the run and done_with_waivers, and filling in a name is the shortest way to clear it.
- reproduction: Copy /home/user/rea-trial/work/run and clone, point target.json at the copy, `node /home/user/rea/scripts/rea.mjs evaluate-clone-run <copy> --exit-code --json`: exit 1, one item, message as quoted. Saved at /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-fail/trial/gate-1.json.
- suggested fix: In the unknown_open message say who may settle it: a waiver names the user or a person the user names and is never written by an agent; when nobody can be asked, the lead reports the open unknown and the run ends not done on it. Keep the closed-against-an-obligation exit as the first option.

#### vf-2: The scout card's third command prints 3.3 MB to stdout for 44 KB of exported scripts

- severity: major
- where: .agents/skills/reverse-engineer-anything/references/clone-runs.md, Scout card, third command (`rea analyze-javascript-application scout/scripts-1 --json`)
- claim: Run exactly as the card prints it on the fixture original's three small scripts, the command exits 0 and writes 3,295,916 bytes of JSON to stdout (normalized_result.semantic_graph alone is 3.4 MB). The card says two lines earlier 'The crawl goes to a file, not into your context', and its first command uses --detail summary with --evidence_output. An agent following the card either floods its context or gets a truncated result and loses the turn.
- reproduction: In /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-fail/walk/run after the card's first two commands: `node /home/user/rea/scripts/rea.mjs analyze-javascript-application scout/scripts-1 --json | wc -c` gives 3295916 (`du -sh scout/scripts-1`: 44K). The same command with `--detail summary --evidence_output scout/scripts-1.analysis.json` exits 0 and prints 10,852 bytes.
- suggested fix: Print the third command in its summary form, `rea analyze-javascript-application scout/scripts-1 --detail summary --evidence_output scout/scripts-1.analysis.json --json`, and name the inspect-analysis-view input that reads the routes from the saved file. Extend the conformance test to refuse a card command that delivers complete Evidence to stdout.

#### vf-3: An application that prints its own host and port without the scheme is parity_changed to the builder with 'Change the clone'

- severity: major
- where: src/application/scenarioBehavior/ScenarioBehaviorComparisonService.ts (own-origin placeholder); src/application/cloneRun/CloneRunEvaluation.ts (rename suggestion for the side's address); docs/reference/clone-runs.md:361 and 463-465
- claim: The reality-6 fix replaces each side's full origin (http://127.0.0.1:4904) and offers a rename for a name in another spelling. The bare host:port form, which is what a Host header echo, a 'Served from …' line or a websocket address prints, is neither replaced nor recognised as a difference a rename settles. Both sides ran the same code; the referee told the builder to change the clone twice. The reference page says 'Each side's own address is compared as the same thing, so it needs no rename.'
- reproduction: `node case-var.mjs 4904` in /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-fail/reality (scenario addr: page /served prints 'Served from <host:port>', GET /api/addr answers {self, host, brand, lower}). runs/var/run/gate.json: builder parity_changed 'the original gave "127.0.0.1:4904", the clone gave "127.0.0.1:4905". … Change the clone, restart it, have it captured again', for text and for body /host; /self is unchanged. Adding {"from":"127.0.0.1:4904","to":"127.0.0.1:4905"} to renames by hand clears both (runs/var2).
- suggested fix: Treat the start origin's host:port as the side's address too: replace it with the same placeholder after the full origin has been replaced, or at least route a difference that is equal after swapping the two host:port strings to the lead with the rename entry, as is done for the name. Correct the reference sentence if only the full origin is covered.

#### vf-4: The item for a failed step lists generic causes instead of the failure the capture recorded, and for a wait_for that matched two elements all three listed causes are wrong

- severity: minor
- where: src/application/cloneRun/CloneRunEvaluation.ts (parity_unknown, not-completed branch)
- claim: The capture stores the exact failure text per step. The item prints a fixed sentence per action kind. For a wait_for step that failed with 'strict mode violation: locator('#list li') resolved to 2 elements' it says 'it fails when the page it needs did not load, its locator matched nothing in time, or a reply it waits for did not answer 2xx'. A prober acting on that raises a timeout or adds a wait, captures both sides again and gets the same failure. For a request step answered 201 against expected_status [200] the item lists redirect, status and address and adds redirect advice, without the status received. This is the open half of reality-11 (the decisions file says to name the recorded failure).
- reproduction: `node case-pages.mjs pages-a 4902 clock,ticker,late,form,about,poll 0 44`: scenario late, item for step see-list in /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-fail/reality/runs/pages-a/run/gate.json; the recorded error is at records[0].normalized_result.steps[].error of evidence/original/late/run-1.json. `node case-var.mjs 4904`: scenario strict, step make-strict.
- suggested fix: Print the failed step's recorded `error` (bounded, first line) in the item, before or instead of the per-kind list of causes. Keep the redirect advice only when the recorded text names a redirect.

#### vf-5: A list in varying order with an undeclared field reads `changed` at the indexes where the original's two captures happen to coincide

- severity: minor
- where: src/application/scenarioBehavior/ScenarioBehaviorComparisonService.ts compareReplies; src/domain/scenarioBehaviorComparison.ts judgeReplyLeaves
- claim: The reality-12 fix covers declared patterns only. When a leaf pattern (/*/name) is shown to vary on the original at some indexes and is not yet declared, the indexes where the two original captures coincide are judged steady, and the clone's other value there is `value`, `changed`, beside `undeclared-volatile` findings for the same pattern on the same step. The step status is changed, which the referee addresses to the builder; the right first move is the lead's declaration. Shown at comparer level only; I did not drive it through the referee.
- reproduction: `node var3.mjs` in /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-fail/comparer, case R12b (five items, left orders [0,1,2,3,4] and [0,3,1,2,4], only /*/id declared): `verdict=changed`, `body|value|…|/0/name|"n1"|"n3"`, `/4/name`, then `body|undeclared-volatile|…|/*/name|"n2" | "n4"|-|left`. With all three patterns declared (R12a): unchanged.
- suggested fix: When a leaf's pattern was shown to vary on the left at another index of the same array, report an undeclared difference at that pattern as undeclared-volatile (unstable, to the lead) and not as value/changed, the same rule the fix applies to declared patterns.

#### vf-6: With an unreadable target.json the items print `rea evaluate-clone-run`, and the outlook names a cause that is not the one

- severity: minor
- where: src/application/cloneRun/CloneRunEvaluation.ts (command when target is null); src/domain/cloneRun/cloneRunStall.ts:157
- claim: Two leftovers of referee-10. (1) Both worklist items carry `rea evaluate-clone-run '<run>' --exit-code` although the run was created with --rea-command 'node /home/user/rea/scripts/rea.mjs'; where `rea` is not on PATH (here) the command does not run as printed. (2) stall.outlook is one fixed sentence for every unjudged evaluation: 'Not judged: a scenario lacks admitted captures on a side'. In this state every capture is in place and the cause is target_invalid; the same sentence is printed for a folder with no scenario at all.
- reproduction: /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-fail/referee/E9/half.json: copy of a judged run, `head -c 300 target.json > target.json`, evaluate; `which rea` prints nothing.
- suggested fix: For the command, fall back to how the running process was invoked (or to rea_command of the last gate.json's target when it parses) and say in the item that target.json could not supply the spelling. For the outlook, say 'Not judged: the checks before parity did not all pass' or name the failing check.

#### vf-7: parity_unstable items for one leaf pattern are repeated per step, and the prober's 'remove the original's captures' has no command

- severity: nit
- where: src/application/cloneRun/CloneRunEvaluation.ts (worklist collapse; parity_unstable items for the original)
- claim: Collapsing covers parity_changed and parity_unknown, but one undeclared clock at /items/*/createdAt gave three near-identical lead items in my first judged round, and the concurrent case gave 12 ('next lists the first 10 and leaves out 2'), each repeating the same paragraph with another step id. Separately, the item for an unstable original tells the prober to 'remove the original's captures of this scenario and capture again' but its command is the evaluate command; the matching verifier item for the clone prints the rm with both paths.
- reproduction: /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-fail/walk/judged1.json (three items) and /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/verify-false-fail/reality/runs/concurrent/run/gate.json (ten items); compare the prober item for step make with the verifier item for step bust in reality/runs/pages-b/run/gate.json.
- suggested fix: Collapse parity_unstable items that share scenario, side, dimension and pointer into one item listing the step ids, with the `step_id "*"` declaration as the printed entry. Give the prober item the rm command the verifier item already has, or name the directory in `file`.

### Still held (do not break)

- A steady value that really differs is still `changed`: comparer V4c/V4d (slug), V9c (declared leaf, other shape), R5c/R5e (no clone repeat equals the original), V5b (extra steady request line), trial-10 variation (weight 5 against 6).
- A volatile declaration is honoured only where the original varies: declared and steady on the original gives declared-not-shown (unknown), with `step_id "*"` as well; withdrawing it gives parity_changed to the builder.
- Lost or oversize bodies stay unknown: fresh api run, big-65537 and big-200000 are parity_unknown on every capture, with the 64 KiB limit and the setup- exit in the message.
- JSON key order under application/json, charset, vendor and problem types is unchanged (fresh api run: key-order, json-charset, json-vendor, json-problem).
- The scaffolded product-name rename still applies across text and reply strings (fix-day: 18 values; walk: 94 values).
- The referee reports stalled itself with exit 2 and still carries `next` (fresh api run: 12 attempts; drive C: attempt 3).
- Evaluating an unchanged folder again uses no round and no attempt (walk, E1, E10v, E6d).
- Edits to intended-differences.json and removal of a scenario with its obligations do not make admitted captures stale (runs/var2, runs/pages-a-v, walk).
- One-record Evidence bundles are read by compare-scenario-behavior, export-web-scripts, environment-build and inspect-analysis-view alike; multi-record bundles are refused by all with the record count.
- No command printed a stack trace or hung in any of my runs; every refusal was JSON with exit 1.
- The largest gate I produced was 12,889 bytes (concurrent, 12 findings); `next` is bounded at 10 items.

## Integrator: open issues after the first fix round

- A request step to a page's address reads parity_changed against a correct clone and tells the builder to change it. Reproduced on the fixture pair; documented as a limit in playbook, reference and spec; not fixed.
- A day-dependent value in on-screen text still reads parity_changed to the builder (reality-7, partly).
- A scenario with a step that clicks a download link can never read done unless the step is renamed setup-. Following the worklist's capture remedy for it ends in stalled on the third attempt, as my hand run showed.
- I did not read the whole fix-round diff. The review was a pattern scan, oxlint, knip, and a full read of the tool readers' diff and the verifier runner only.
- oxlint reports about 40 warnings in files of this round, all in src: CloneRunEvaluation.ts, CloneRunWorkspace.ts (1,346 lines), CloneRunTreeDigest.ts, scenarioBehaviorCapture.ts (a function of complexity 44), cloneRunSchemas.ts and scenarioBehaviorComparison.ts (over 500 lines). None is an error and check:fast passes.
- Not reproduced by me and taken from the fixers' reports plus passing unit tests: comparer-4, -6, -9, -10, -11, -13, the resource-type half of comparer-7, referee-4, -5, -6, trial-5, -6, -8, -10, -12, judge-8, surface-6, and the concurrent half of referee-2.
- Address identity was exercised by me only with localhost. and [::ffff:127.0.0.1]. A name from /etc/hosts and a public DNS name that resolves to loopback rest on unit tests.
- Not run again after the join: attack-cheat scripts 04-alias-pass, 05-dangling-symlink (the time-of-check swap) and 07-exclude, the referee reviewer's E-series and unit1.mjs, and the blind trial's run folder.
- The scout card's three commands and the inspect-analysis-view inputs were run by the text author on fx/docs, not by me after the join; only the boundary test of the bundle readers was run.
- The corrected playbook has still not been followed by a fresh agent. Its refusal-notice recipe and redirect sentence have never been run on a fixture.
- The playbook grew 21.6% in bytes over the round, slightly more than the text author reported, because of my two bullets.
- The branch has three merge commits with non-conventional subjects, one of them made by this job's `git merge --no-edit`; surface-8 is not planned and matters when a pull request is opened.
- All six verifier runs passed with one other agent at work (86 to 92 s each). No run lost a reply body, so the mutant cases' path for a body lost in every capture is still untested by a real loss.
- The full test suite, coverage and mutation runs were not run, as the rules of this round say.
- Nothing I started is running: both fixture servers on 4870 and 4871 are stopped, no Chromium or verifier process of mine remains, and no listener is on 4870 to 4889. Scratch files are under /tmp/claude-0/-home-user/54db18d0-c8e4-5ba5-98b3-8082c6c439a0/scratchpad/rea-fix/integrate. /home/user/rea-wt is an empty directory.
