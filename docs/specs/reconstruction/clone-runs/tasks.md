# Tasks

Each task names the spec section it implements and the check that shows it.

## Contract

- [x] Record the outcome, requirements, acceptance and non-goals ([spec.md](spec.md)).
- [x] Pin the run-folder schemas, reason codes and roles (`src/domain/cloneRun/cloneRunSchemas.ts`).
- [x] Pin the comparer's result, table and port (`src/domain/scenarioBehaviorComparison.ts`).
- [x] Stub the service and referee modules so every package compiles against one set of names (`npm run check:fast`).
- [x] Review the contract against real captures and correct it: start-origin comparison, both-sided missing data,
      redirects, copied captures, leaf-only volatile fields, symlinks, loopback aliases, no parity waiver.

## A: comparer (spec: "The comparer")

- [x] Carry step id and resource type from request events onto scenario capture records, the parsed capture and
      `ProbeStep`; `probeRequests` takes the origin to use; existing environment tests still pass.
- [x] `readScenarioBehaviorCapture`: authenticate a record or bundle, refuse a HAR, another operation, an edited file;
      fill `fingerprint_sha256` and `reply_bodies`.
- [x] Compare at the start origin only: an other-origin `fetch`, `xhr` or `document` request is `unknown`, and a page
      address that left the start origin keeps its whole URL. Test with a capture whose page was sent elsewhere.
- [x] Align steps by id, match transactions by request line, fold repeats, apply renames in order and report those
      applied.
- [x] Statuses: `changed`, `unknown`, `unstable`, `unchanged`; missing data never matches on either side (a body lost
      on the right is `unknown`, not `changed`); a redirect has no body to miss; exact comparison beside the differ.
- [x] Volatile fields: one leaf per declaration, honoured only where the left repeats differ, shape still compared.
- [x] Fingerprint `start_state` per side through `scenarioStartState`.
- [x] `describeScenarioBehavior`: the behaviour table.
- [x] Unit tests for each rule. The pilot's saved captures selected no accessibility text, so under this contract every
      step of theirs is `unknown` on `text`; they can show the request, status and body rules only (mutant changed at
      `/slug`). An all-`unchanged` result needs captures made with the rendered capture settings.

## B: run folder and referee (spec: "Run folder" to "Stall")

- [x] `initCloneRun`: scaffold from flags, refuse a non-empty directory, a folder inside the clone root, addresses
      that are not distinct and a clone name containing an original name, write the three examples and check them
      against their schemas in a test.
- [x] `loadCloneRunWorkspace`: every authored file, ids from base names, the cross-file rules of check 2, issues with
      file, pointer and fix; one evaluation reports all.
- [x] `renderCloneRunScenario`: both sides, `{origin}` only at the start of a `goto` URL, every `goto` on the side's
      address, the `rea-tree-` step, the expected digest equals what a real capture records.
- [x] `digestCloneTree`: excludes on whole segments, symlinks not followed and those leaving the root listed, stable
      order.
- [x] Admission in the specified order; a copy is `duplicate`; duplicate, stale and mismatched files do not block
      alone; rejected files do.
- [x] The eight checks, evaluated without waiting for one another (the original side before a clone exists); the
      worklist (at most ten, exact commands, the JSON line to add); waivers and `done with N waivers`; `target` and
      `declared` in the gate.
- [x] Journal and stall: no line for an unchanged state, judged rounds, the two stall conditions.
- [x] Unit tests with a fake comparer for every reason code.

## C: CLI, fixtures and end to end (spec: "Commands", "Acceptance")

- [x] Register the three commands CLI-only; `--exit-code` for the comparer and the referee.
- [x] Boundary test of the three commands over the built CLI.
- [x] Fixture trio and scenario under `tests/fixtures/cloneRun/`, with the properties the plan lists.
- [x] `npm run verify:clone-run` shows each line of acceptance item 2 and stops every server and browser it started.

## D: guidance and documentation

- [x] `references/clone-runs.md` with seven role cards and the web playbook; `SKILL.md` pointer and version.
- [x] `MANAGED_SKILL_FILES`, regenerated metadata and plugin copy.
- [x] Conformance test tying every command, reason code and role named in the reference to real ones.
- [x] `docs/reference/clone-runs.md` and the CLI guide.
- [x] Setup under a throwaway `HOME` installs the reference, and `rea guidance --query "clone parity"` matches.

## Integration

- [x] Merge the four packages; the referee reads a finding's status from the comparer's `scenarioFindingStatus`
      instead of its own copy of the category lists.
- [x] Reconcile the specification, the reference page, the CLI guide and the playbook with `--help` and with the
      real output of a run driven by hand on the fixture pair.
- [x] A `goto` whose URL is a bare path is refused with the `{origin}` fix (`CloneRunWorkspace.test.ts`).

## Verification (2026-11-20)

On the merged branch, in a container with Chromium and no native provider:

- `npm run test:local` over the comparer, referee, workspace, tree digest and schema tests, the changed environment
  and capture-record tests and `tests/conformance/cloneRunGuidance.test.ts`: all passed.
- `npm run test:focused` over `tests/boundary/cli/cloneRunCli.test.ts`, `tests/boundary/filesystem/setupSkill.test.ts`
  and the CLI catalogue, registration, startup and guidance boundary tests: all passed; four `setupSkill` tests skip
  when run as root.
- `npm run verify:clone-run` three times in a row: each run printed eleven `pass` lines and no other, in 44 to 47 s,
  and reported no process left behind. No capture lost a reply body in these runs, so the recapture of a lost body
  was driven only by the reply over the body limit.
- A run driven by hand with the documented commands on the fixture pair: `init-clone-run`, the worklist's four
  capture commands, `done`; then the mutant switch, `evidence_stale`, two more clone captures and `parity_changed`
  at `/slug`; then one more clone capture with nothing else changed, and `stalled` with exit 2.
  `compare-scenario-behavior` exited 0 on the four captures and 2 on one original capture per side.
- `rea setup` under a throwaway `HOME` installed `references/clone-runs.md` byte for byte, and
  `rea guidance --query "clone parity"` returned matches.
- `npm run check:fast` and `npm run verify:test-discovery` passed.

Not verified: the playbook has not been followed by an agent, and the full test suite was not run on this branch.

## Fix round (2026-11-20)

A proof round followed the build: a blind trial in which a fresh agent cloned an unseen application from the playbook
alone, two adversarial attacks and three line-by-line reviews. It found about eighty defects. Each box below is one
group of them; the finding ids are those of the proof round's record. The boxes of the comparer, the referee and the
tool readers are ticked on those packages' own reports and the join's; what was run again for this text is under
[Verification of the fix round](#verification-of-the-fix-round).

### A: comparer (spec: "The comparer")

- [x] Missing data is `unknown` in the cases the first build read as a match: a request body that was not recorded,
      request events the capture omitted, a download's body (comparer-2, comparer-3, reality-1).
- [x] An array and an object with index-like keys differ (comparer-1); same-length lists compare by position
      (trial-10); a text reply that is JSON on both sides compares by leaves (reality-14).
- [x] New categories `single-observation` and `declared-not-shown`, both `unknown` (surface-2, comparer-8,
      reality-7); `declared` and `honoured` are separate (comparer-9); `step_id` `*` covers every step (trial-11); a
      declared pattern is honoured at every index once one varies (reality-12).
- [x] A clone-side repeat difference is `repeats-differ` alone, never `changed` (reality-5, trial-15, judge-1); a
      request line only the clone sent beside an unsteady original is `repeats-differ` (reality-4, comparer-5).
- [x] The side's own origin reads `{origin}` in text and bodies (reality-6); a `request` fingerprint step leaves out
      the page text (reality-3); one text difference is reported once (judge-8); a JSON string request body is shown
      as JSON (trial-12).

### B: referee (spec: "What done means" to "Stall")

- [x] Address identity by port and resolved host, at init and at every evaluation (cheat-1, referee-1).
- [x] The stall rule as a pure function: a round is a judged clone tree, one state is one attempt, the referee's own
      capture remedy does not stall on its first try, the gate prints `stall.outlook` (referee-2, referee-3,
      referee-5, referee-9, trial-7, trial-16).
- [x] Excludes are validated and named in every summary when one matched (cheat-2, referee-8); a link that cannot be
      resolved is flagged (cheat-3, referee-4, referee-14); unreadable clone entries are the finding
      `clone_path_unreadable` (referee-6); non-regular Evidence entries are rejected (referee-7); a refused
      `target.json` leaves the other outputs alone (referee-10).
- [x] Who is told what: no `repeats-differ` finding reaches a builder, a rename that settles a difference goes to
      the lead with the entry to add, a failed step is named with why its kind of step fails (reality-6, reality-10,
      reality-11, reality-13, reality-15).
- [x] `init-clone-run` prints the referee's own first worklist and writes a page-step scenario and a crawl input
      (surface-3, trial-3, trial-17); `residual_trust` is listed with a pass only and gains two lines; equal findings
      collapse into one item (surface-10, reality-2, reality-8, reality-9, judge-5, judge-6).

### Tool readers

- [x] `export-web-scripts` and `environment-build` read the bundle `--evidence_output` saves when it holds one
      capture record, and say so when it does not (surface-1, trial-4).

### D: guidance and documentation

- [x] `SKILL.md` routes a request to rebuild or clone a web application to the playbook before the original is
      touched, in its description and at the top of the routing list (surface-9, trial-2); version 65.
- [x] Playbook: every command a card names was run on the file the card has the agent save, in a run made from the
      fixture pair; the cards for scout, mapper and prober give the exact commands (surface-1, trial-5, trial-6,
      trial-9); the loop defines a judged round and the stall rule as built (trial-7); the prober card states the
      step id pattern, the locator rule, the tie rule for rounding and how a refusal notice is probed (trial-8,
      trial-14, judge-3, judge-7); the mapper card names the operator's own addresses (judge-4); the lead card shows a
      wildcard volatile field and where candidates are listed (trial-11); the rules say what to do with an input REA
      cannot send (trial-13); what a step compares is stated where probes are designed (reality-9).
- [x] Reference page and specification: every changed category, reason code, message, flag, exit status, example
      file and limit; the false-pass table row by row and the residual-trust list against the code's fourteen lines
      (comparer-13, referee-11, surface-13, reality-2, reality-8, reality-9, reality-11).
- [x] Conformance test: flags against the option schema of the command they are written with, and the reason
      table's check and role columns against the code (surface-5).

### Tests, verifier and fixtures

- [x] The fixture scenario `topics` probes every route with the wrong method, a body of the wrong kind, a trailing
      slash, a path below a topic and both ends of the title limit: fourteen more steps with their obligations. The
      fixture clone's routing was rewritten until they pass, and its About page reworded with a declared rename per
      paragraph (surface-4, surface-13).
- [x] The verifier asserts exit 1 and `not_done` wherever a line says not done, forges all four referee outputs and
      reads each back, and stops cleanly on an interruption or a fixture server that exits early; it is split into
      six modules (surface-6, surface-7, surface-11). Four new cases: a loopback alias as the clone's address, a
      link that leaves the clone root for a target that does not exist, a list answered as an object keyed by
      position, and a file saved through a download link.
- [x] `Required.` starts the description of each required option, and the help of `--clone`, `--exclude`,
      `--max-rounds`, `--differences` and `--exit-code` says what the fixed code does (surface-12, cheat-4).
- [ ] The shared argument parser is unchanged: `--exitCode` still sets `--exit-code`, and an argument refusal
      names the option's key, not its flag (cheat-4, surface-12). The boundary test pins both.
- [ ] No in-process test runs the referee with the real comparer; the verifier is the only test of the two
      together. No test covers a clone file that vanishes during the tree walk (referee-12).

### Verification of the fix round

On the feature branch after the three code packages were joined, as the join reported it:

- `npm run verify:clone-run`: 11 of 11 cases passed, twice, with real Chromium.
- The blind trial's run folder, copied: `not_done` with one blocking finding, the open unknown; no step `changed`.
- Thirteen copies of the attacks' run folders: each wrong clone stayed `not_done`, each new category reached the
  role the contract names.

On the documentation branch, in a container with Chromium and no native provider:

- A run driven by hand from the fixture pair on two loopback ports, with every command the playbook's cards name:
  the crawl from `examples/crawl.example.json`, `export-web-scripts` and `analyze-javascript-application` on what it
  saved, the two `inspect-analysis-view` inputs, `validate-browser-scenario` and the prober's preview. With both
  fixture scenarios the worklist's capture commands led to `parity_unknown` for the `export` scenario, whose reply is
  over the body limit, and to `stalled` on its third attempt, as the stall rule says; with that scenario taken out,
  the same captures read `done`. The slug mutant then read `evidence_stale`, and after two clone captures
  `parity_changed` at `/slug` in round 2, with five steps collapsed into one item; a matched exclude added its clause
  to every summary; a wildcard volatile field was honoured for the eleven fields the per-step entries had covered;
  a loopback alias and a pattern exclude were refused at init.
- `tests/conformance/cloneRunGuidance.test.ts`, `npm run docs:check`, `npm run check:fast` and
  `npm run verify:test-discovery` passed. `rea setup` under a throwaway `HOME` installed the playbook, and
  `rea guidance --query` returned its sections for `clone a web application`, `clone parity`, `judged round stalled`
  and each role card.

After the documentation and the fixes to the commands, the verifier and the fixtures were joined, in the same
container:

- `npm run verify:clone-run` three times in a row: each run exited 0 and printed fifteen `pass` lines and no other,
  in 86 to 87 s. The lines were the same in all three apart from the port in the alias case.
- `npm run test:local` over the comparer, referee, stall, address, tree digest, workspace and schema tests, the
  changed environment, capture-record and script-export tests and the two conformance tests: 25 files passed.
- `npm run test:focused` over `tests/boundary/cli/cloneRunCli.test.ts`, `cloneRunVerifier.test.ts`,
  `savedCaptureBundleCli.test.ts`, `tests/boundary/filesystem/setupSkill.test.ts` and the CLI command, schema,
  golden, registry, coverage and startup boundary tests: 14 files passed; four `setupSkill` tests skip when run as
  root.
- A run driven by hand from the fixture pair on two loopback ports, with the worklist's own commands. Init listed
  five authored files and printed the referee's first worklist. With the `topics` and `download` scenarios and a
  scenario of two `request` steps to a page's address: `parity_unknown` at the step that clicks the download link,
  `parity_changed` at both page requests, whose markup differs between the sides, and `stalled` with exit 2 on the
  third attempt. With the click renamed `setup-` and the page scenario removed: `done`, fourteen residual lines, one
  ungated step, and the excluded-path clause in the summary once the clone held a `node_modules` directory. The
  slug mutant then read `evidence_stale`, and after the clone's captures `parity_changed` at `/slug` in round 2.
  Two captures of the original compared with each other read `single-observation` for each `createdAt`, exit 2.
- The three refusal shapes were read from real output: the error envelope for a missing run folder and for a
  loopback alias at init, `VALIDATION_ERROR` for a missing option, `UNKNOWN` for an unknown flag and for a
  positional file.
- `rea setup` under a throwaway `HOME` installed the playbook byte for byte with skill version 65, and
  `rea guidance --query` returned its sections for `clone a web application`, `clone parity`,
  `judged round stalled` and each of the seven role cards.
- `npm run check:fast`, `npm run verify:test-discovery`, `npm run docs:check`, `npx knip --cache`,
  `npx oxfmt --check .` and the three generator checks passed.

Not verified: the corrected playbook has not been followed by a fresh agent, the proof round's reproductions were
not all run again after the join, and the full test suite was not run.

## Second fix round (2026-11-21)

Two independent agents ran every reproduction of the proof round again on the fixed build. Most fixes held. They
found three ways to `done` for a wrong clone, two of them opened by relaxations of the first fix round, and a dozen
smaller defects (ids `vp-1` to `vp-8` and `vf-1` to `vf-7`). The rule of this round: a relaxation may turn a false
failure into `unstable` or `unknown`, never into a match, and never into something a step prefix or a declaration
can then silence. An unticked box is a finding that is still open.

### A: comparer

- [x] A `*` pointer is honoured only at the positions where the original's own repeats differ. A steady position with
      another value on the clone is `declared-not-shown`, also with step `*` (vp-1; reverses the first round's rule
      for a list in varying order).
- [x] The kind of every container, empty ones included, is judged before any declaration: a list against an object is
      `changed` at the outermost such container (vp-2).
- [x] No placeholder stands for an address. The original's start origin, then its bare `host:port`, are read as the
      clone's in on-screen text and body strings, and `addresses_applied` counts them (vp-4, vf-3).
- [x] An honoured leaf is held to the presence, JSON type and layout the original's own values share, also when they
      do not share one shape.
- [ ] A list in varying order with a field that is not declared, or declared, still reads `changed`, `unknown` or
      `unstable` at the positions where the original's captures coincide (vf-5). By decision there is no relaxation:
      the list has to be requested in a fixed order, and `limitations` and the referee's items say so.
- [ ] A reply body that one capture of a side recorded stands for the captures of that side that lost it, so a clone
      that is wrong only in a capture whose body was lost reads `unchanged`. Closing it needs the reason a body is
      unavailable, which the capture readers do not pass on. Stated as residual trust item 15.

### B: referee and commands

- [x] On a `setup-` or `fp-` step every finding blocks in which the original is steady and the clone differs, and so
      does data only one side lacks; the rule is one table with its own tests. The gate lists every declared pointer
      that had an effect, also one that only held a difference back (vp-3). A clone reply padded past the body limit
      at a `setup-` step, found while fixing, blocks as well.
- [x] The `unknown_open` and `obligation_inferred` items say who may settle them and print no waiver to paste (vf-1).
- [x] The item of a step that did not complete quotes the failure the capture recorded, and gives redirect advice
      only when that text names a redirect (vf-4).
- [x] With an unreadable `target.json` the printed command is spelled from how the evaluation was started and runs
      as printed, and the stall outlook names the check that kept the evaluation from being judged (vf-6).
- [x] `parity_unstable` items of one field collapse into one item with the `step_id` `*` declaration, and the
      prober's item for an unstable original carries the removal command (vf-7).
- [x] `--exit-code=<value>` with a value other than `true` or `false` is refused as an argument error; before, `=1`
      was read as the flag turned off and exited 0 on a failing run (vp-5).
- [x] A `journal.jsonl` that is not a regular file is never opened (vp-6). The residual line names the content of a
      file saved through a download, and a body no capture of either side recorded gets the advice to fetch the file
      with a `request` step instead of a capture command (vp-7). A link is flagged as soon as its text rises above
      the clone root, whatever it does afterwards, and when its text is an absolute path (vp-8).
- [x] A `request` step whose two replies are HTML pages goes to the prober with the remedy, a `goto`.
- [x] Tests for a file that vanishes during the tree walk, one that cannot be read, a link swapped in for a file and
      a named pipe (the remainder of referee-12).
- [x] The items for a declared field the original holds steady and for a field the clone's captures disagree on say,
      at a list position, that lists are compared by position. A difference whose original value holds the
      original's own address says that the value is shown with that address read as the clone's.

### Text, tests and the verifier

- [x] Every command the playbook prints keeps complete Evidence out of the agent's context: the scout's script
      analysis is printed in its summary form with `--evidence_output`, followed by the view that reads the routes
      from the saved file, and the conformance test holds every fenced command to that rule (vf-2).
- [x] The playbook and the reference page say that on-screen text cannot be declared volatile, so a date or a clock
      on screen makes its step differ between days (the on-screen half of reality-7). The decision's second remedy,
      keeping such text out of cited steps, is written as keeping it off the pages a scenario shows: a text
      difference is reported at the first step that shows the text and blocks on every kind of step.
- [x] The specification says exactly what the name check reads: file bytes, the paths of files and links, and link
      text; not the names of empty directories or special files (the remainder of referee-14).
- [x] The specification's rows for a failing step renamed `setup-`, a declared field that does not vary and the
      origin rule, the reference page and the playbook say what the code does after this round.
- [x] Five verifier cases on the new fixture scenario `board`, each asserting the exit status and the verdict: a
      correct clone of an application that prints its own address with and without the scheme (`done`); a clone
      steadily wrong at a list position the original holds steady under a declared `*` pointer; a list answered as
      an object keyed by position with every value beneath declared volatile; the text `{origin}` where the original
      prints its address; and a failing step renamed `setup-` with its field declared volatile (each `not_done`, the
      last also `stalled` once the item's capture command is followed).
- [ ] The decision asked that the `declared-not-shown` message offer naming the step `setup-` for a list in varying
      order. It is not printed, because the same round makes that finding block on a `setup-` step.
- [ ] The corrected playbook has still not been followed by a fresh agent, and no verifier case pads a clone reply
      past the body limit at a `setup-` step: that rule rests on the referee's unit tests and its author's run.

### Verification of the second fix round

On the feature branch after the comparer's and the referee's packages were joined, in a container with Chromium and
no native provider, with up to three other agents at work on the same four CPUs:

- `node scripts/verify-clone-run.mjs` three times in a row on the final runtime: each run exited 0 and printed twenty
  `pass` lines and no other, with 202 to 239 s of case time. The lines were the same in all three apart from the
  ports. Three earlier runs in a row, on the runtime before the `--exit-code` refusal was added, gave the same lines.
- `npm run test:local` over the comparer, step gate, referee, parity gate, stall, address, tree digest, tree walk,
  workspace and schema tests, the environment comparison, scenario, source and capture-record tests and the two
  conformance tests: 23 files, 399 tests passed. `CloneRunParityGate.test.ts`, which runs the referee's blocking
  rule against the real comparer, passed against the joined comparer.
- `npm run test:focused` over `tests/boundary/cli/cloneRunCli.test.ts`, `cloneRunVerifier.test.ts`,
  `argvParser.test.ts`, `cliDecimalArguments.test.ts`, `cliContractCommandParity.test.ts`, `cliSetup.test.ts`,
  `savedCaptureBundleCli.test.ts`, `tests/boundary/process/processCli.test.ts` and
  `tests/boundary/filesystem/setupSkill.test.ts`: 9 files, 1181 tests passed and 5 skipped.
- Every command the playbook's cards print, run as printed from a copy of the fixtures on two loopback ports, with
  the bytes each wrote to standard output: the crawl 7,476; `export-web-scripts` 8,842; the script analysis in its
  summary form 10,802, where the form the card printed before wrote 3,295,886; the routes view on the saved analysis
  5,032 (an empty list for these scripts); the text view of one step 5,496; the manifest view 6,117; the first
  evaluation 4,513; each of the worklist's four capture commands about 26,000, for an Evidence file of 274,000; the
  prober's preview 5,433; the evaluation that read `done` 4,805.
- The blind trial's run folder and clone, copied, with `target.json` pointed at the copy: exit 1, `not_done`, one
  blocking finding, `unknown_open`; 640 steps unchanged, none changed, 25 unstable and ungated. The item says that
  only the user, or a person the user names, can accept the gap, and prints no waiver. On that folder
  `--exit-code=1`, `=0`, `=no` and an empty value were each refused with exit 1.
- `rea setup` under a throwaway `HOME` installed the playbook byte for byte with skill version 66, and
  `rea guidance --query "clone a web application"` returned the playbook first.
- `npm run check:fast`, `npm run verify:test-discovery` (3,847 files), `npm run docs:check`, `npx knip --cache`,
  `npx oxfmt --check .` and the checks of the package metadata, the editor plugin copy of the skill and the
  third-party inventory passed. The format check first failed on three comparer files, which were then formatted.

Not verified: the full test suite, coverage and mutation runs were not run. The proof round's and the verifiers'
reproduction scripts were run by the two packages on their own branches and not again after the join, where the
verifier's twenty cases, the unit tests and the trial replay stand for them. The spec writer's, builder's and
verifier's cards print no command of their own and were not followed by a fresh agent.
