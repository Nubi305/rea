# Clone runs: a referee and a team playbook for web apps

Status: implemented as milestone 1. [tasks.md](tasks.md) records what was built and what was verified, and this
text was reconciled with the commands' real output on 2026-11-20.

## Outcome

REA helps an agent understand an application and has nothing that decides whether a rebuild of it matches. This feature
adds a referee and the folder a team works from:

- `rea compare-scenario-behavior` compares captures of one scenario taken at two addresses.
- `rea init-clone-run` creates a run folder; `rea evaluate-clone-run` is the referee. It prints `done` or a worklist
  that says which role does what next.
- `references/clone-runs.md` in the skill holds seven role cards (lead, scout, mapper, prober, spec writer, builder,
  verifier) that one agent plays in turn or several play in parallel.

No agent can declare success. The referee recomputes every verdict from Evidence that REA recorded and authenticated,
and from the clone's files as they are now. [Trust](#trust) lists what that does not cover. The team writes new code
for observed behaviour under a new name: nothing here defeats DRM, licence checks, anti-cheat, packers or logins, and
the referee refuses `done` when it finds a copied file or the original's name in the clone.

All three commands are CLI-only, like `environment-compare`: no MCP tool contract, and the MCP tool list and its
`tools_sha256` do not change. The catalog's `cli_commands` count and `combined_sha256` do, because they cover the CLI
command inventory; both are computed at build time and nothing committed records them.

## Verified facts this contract builds on

Read or run before the build; builders relied on them. They describe REA as the feature found it, and
[The comparer](#the-comparer) says what the feature changed.

- `capture-browser-scenario --evidence_output <file>` writes an Evidence **bundle** (`{records: [...], ...}`, mode 0600)
  holding the one capture record. It refuses an existing file with exit 1, `code: "invalid_request"`,
  `message: "Evidence file already exists. Choose another output path."`.
- `readEvidenceFileSource(path, options, evidenceId, site)` in `src/application/analysisView/evidenceFileSource.ts`
  reads a record or a bundle and authenticates it. A bundle whose `parameters` were edited fails with
  `EvidenceIntegrityError`. A copy of a file authenticates with the same `evidence_id`; two captures never share one.
  A record whose content was edited and whose `evidence_id` was then recomputed with REA's exported
  `evidenceSemanticContent` and `digestCanonicalValue` also authenticates: the digest has no key.
- The capture record's `parameters` are the scenario REA ran plus `scenario_sha256`, which is
  `digestCanonicalValue(browserScenarioSchema.parse(document), "Browser scenario")`. Recomputing that from the scenario
  file gave the recorded value.
- `normalized_result.scenario.start_origin` is the origin the browser started at. Every entry of
  `normalized_result.steps` records `step_id`, `status` (`completed`, `failed`, `cancelled`) and `after_url`
  (`url` with query and fragment, `origin`, `redacted`), whatever the capture selection. `artifacts.accessibility` is
  `{state: "captured", value: {text}}` only when `capture.after_each_step` selects `accessibility`; otherwise
  `not_requested`. `completeness.status` is `incomplete` (`missing_sections: ["events"]`) on every capture seen,
  including good ones, so it cannot gate.
- A failed step cancels every later step. A `request` step answered with a redirect fails, and so does one that runs
  after the page left the start origin. A `goto` may leave the start origin and completes; `after_url.origin` then
  names the other origin. Accessibility text does not include a cross-origin iframe's content.
- Request events carry `step_index` (the index into `steps`) and `resource_type`; `scenarioCaptureRecords` dropped
  both and named the event only by `location.pointer` (`/events/items/N`). `parseCaptureEvidence` returned records
  without steps or parameters, and keeps request bodies only for purpose `"manifest"`.
- A reply over `max_network_body_bytes` (64 KiB by default; a capture keeps 1 MiB of bodies in all) is recorded as
  `unavailable`, and so is every redirect's body. Back-to-back `request` steps also lose reply bodies at random (in the
  pilots 24 of 58, and 1 to 10 of 59 with a 120 ms wait after each). `probeRequests(records)` gives each request with
  the application's answer (`live`), absent when no response was recorded and `unobserved: true` in all three cases.
- `probeRequests` takes the origin with the most JSON-like records as the application's. On a capture whose start page
  sent the browser to another server it returned that server's transactions and dropped the start origin's.
- `compareAnswers(live, env, new IdMap())` returns categorised differences with JSON pointers. With an empty id map and
  no rules it still treats two clock values of one format as equal, and it counts a body it could not compare
  (`large_bodies`, `unobserved_bodies`) only when the body is missing on `live`: one missing on `env` comes back as a
  `value` difference at pointer `""`.
- A transaction belongs to the step during which its request was observed, so a reply-triggered fetch can land in the
  next step, and an accessibility snapshot can precede the render it caused.

## Run folder

One folder per run, outside the clone's source. Each file has one writer. Agents pass paths and ids, never payloads.

| Path                                    | Schema (`cloneRunSchemas.ts`)       | Writer                                                                   |
| --------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| `target.json`                           | `cloneRunTargetSchema`              | `init-clone-run`; the lead edits it afterwards                           |
| `intended-differences.json`             | `cloneRunIntendedDifferencesSchema` | lead (scaffolded by init)                                                |
| `waivers.json`                          | `cloneRunWaiversSchema`             | lead (scaffolded by init)                                                |
| `scenarios/<scenario>.json`             | `cloneRunScenarioSchema`            | prober                                                                   |
| `obligations/<area>.json`               | `cloneRunObligationsSchema`         | spec writer                                                              |
| `unknowns/<role>-<n>.json`              | `cloneRunUnknownSchema`             | the role in the file name                                                |
| `specs/`, `scout/`, `surfaces.json`     | free form                           | spec writer, scout, mapper                                               |
| `evidence/<side>/<scenario>/run-N.json` | REA Evidence bundle                 | `capture-browser-scenario`, run by prober (original) or verifier (clone) |
| `rendered/<side>/<scenario>.json`       | browser scenario document           | referee                                                                  |
| `records/<side>/<scenario>.json`        | `cloneRunAdmissionRecordSchema`     | referee                                                                  |
| `behavior/<scenario>.json`              | `scenarioBehaviorTableSchema`       | referee                                                                  |
| `parity/<scenario>.json`                | `scenarioBehaviorComparisonSchema`  | referee                                                                  |
| `journal.jsonl`                         | `cloneRunJournalEntrySchema`        | referee                                                                  |
| `gate.json`                             | `cloneRunGateSchema`                | referee                                                                  |
| `examples/*.example.json`               | the authored schemas                | `init-clone-run`                                                         |

`<side>` is `original` or `clone`. A file's base name is its id: no authored file repeats its own name inside. The six
referee rows are outputs. No verdict reads them back; the one use of an output is `journal.jsonl` for stall detection,
which can only turn `not_done` into `stalled`. Outputs of a scenario that no longer exists are removed. Evaluations
are not serialised: two at once would interleave these outputs, so the playbook has one role evaluate at a time.

The referee also creates the empty `evidence/<side>/<scenario>/` directory of every input it renders, because the
capture command does not create directories and the worklist's capture commands must run as printed. `surfaces.json`
is the mapper's checklist; the referee does not read it.

Clean-room wall: builders read `specs/`, `obligations/`, `behavior/` and `gate.json`, never `evidence/` or `scout/`.
In this milestone the wall is a playbook rule; nothing enforces it.

## Trust

- A pass comes only from Evidence that `readEvidenceFileSource` authenticated, admitted as below, and compared by the
  referee in the same run. No file an agent writes can supply one: authored files can declare, cite and block, and
  every declaration is checked against Evidence where Evidence can check it.
- `rendered/`, `records/`, `behavior/`, `parity/` and `gate.json` are rewritten by every evaluation and never read.
- The verdict is the exit status and output of an evaluation the reader ran. A `gate.json` found on disk is a copy.

Residual trust, stated in `gate.json` as `residual_trust` (`CLONE_RUN_RESIDUAL_TRUST`, same order):

1. The authorisation statement is recorded as given. REA cannot verify it.
2. `target.json`, the scenarios and the declarations are the team's own statements. The verdict is about the addresses,
   clone root, excludes, names and material that `target.json` declares when the referee runs, and anyone who can edit
   it can retarget the run. `gate.json` repeats the addresses and the root under `target`.
3. The verdict covers only the steps the scenarios contain. REA cannot tell whether they exercise every rule of the
   original (surface coverage is a later milestone), nor whether an obligation's statement describes the steps it
   cites. Deleting a failing step or an unknown file leaves no trace.
4. Evidence integrity is an unkeyed content digest. It catches an edited or misplaced file. It does not catch Evidence
   forged by recomputing the digest with REA's own code.
5. A capture is bound to an address, not to what answered there. REA cannot prove which program or which build of the
   clone was serving, nor that it did not pass requests on to another server.
6. Clone Evidence is bound to the tree digest its capture input was rendered for, and that digest equals the tree now.
   An edit that was reverted between the two is not visible.
7. Excluded clone paths are neither digested nor checked for copied files or names.
8. Renames and volatile fields are declarations. A rename can declare away any difference in on-screen text or a
   string value, and an honoured volatile field is compared by shape only. `gate.json` lists those that took effect
   under `declared`.
9. A waiver's person and reason are recorded as given.
10. The copied-file check knows the original's files only from the declared material and from reply bodies its captures
    recorded, 64 KiB each at most. The name check knows only the declared names.
11. REA does not reset targets. A clean start is inferred from the fingerprint steps only.
12. The journal is the referee's own output. Removing it can hide a stall and cannot produce a pass.

### Ways to a false pass, and what stops each

The comparer's and the referee's tests cover every row that names a reason code or a comparer rule.

| Attempt                                                                              | Stopped by                                                                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Write or edit `gate.json`, `parity/`, `records/` or `rendered/`                      | never read; the verdict is recomputed                                                |
| Edit the journal                                                                     | can only add `stalled` (residual 12)                                                 |
| Edit an Evidence file                                                                | `evidence_rejected_integrity`                                                        |
| Forge Evidence with REA's own digest code                                            | not stopped (residual 4)                                                             |
| Copy one capture to make the second                                                  | `duplicate`, so `evidence_missing`                                                   |
| File a capture under the other side                                                  | `evidence_rejected_address`                                                          |
| File a capture of another scenario, version or capture setting                       | `evidence_scenario_mismatch`, so not counted                                         |
| Edit the clone after its capture, or before the first evaluation                     | `evidence_stale`                                                                     |
| Keep code under an exclude                                                           | not stopped; `gate.json` lists the excludes (residual 7)                             |
| Keep code behind a symlink that leaves the clone root                                | `clone_symlink_outside_root`                                                         |
| Serve another program, or another build, at the clone's address                      | not stopped (residual 5)                                                             |
| Send the browser or its requests from the clone to another server                    | `parity_changed` or `parity_unknown` (comparer rule **Origin**)                      |
| Give both sides one address, also through a loopback alias                           | `addresses_not_distinct`                                                             |
| Put the run folder inside the clone                                                  | `run_folder_inside_clone`                                                            |
| Point `target.json` at other addresses or another root                               | not stopped; `gate.json` repeats them (residual 2)                                   |
| No scenario, or no obligation file                                                   | `no_scenarios`, `no_obligations`                                                     |
| A scenario with no behaviour step, or no fingerprint                                 | `scenario_invalid`                                                                   |
| An absolute URL in a `goto`                                                          | `scenario_invalid`                                                                   |
| Rename a failing step `setup-`                                                       | `parity_changed`: `changed` blocks on every step                                     |
| Delete a failing step                                                                | not stopped (residual 3)                                                             |
| Leave a behaviour step uncited                                                       | `step_uncited`                                                                       |
| An observed obligation with no case                                                  | `obligation_invalid`                                                                 |
| An obligation that cites only `fp-` or `setup-` steps, or a step that does not exist | `obligation_step_unknown`                                                            |
| Mark a rule `inferred` instead of probing it                                         | `obligation_inferred` until a named person waives it                                 |
| Declare a volatile field that does not vary on the original                          | declaration ignored, so `parity_changed`                                             |
| Declare an object, an array or the whole body volatile                               | never covers the leaves beneath; the empty pointer is `intended_differences_invalid` |
| Declare a rename that hides a real difference                                        | not stopped; `gate.json` lists applied renames (residual 8)                          |
| Waive missing data, a difference or an unstable step                                 | no such waiver exists                                                                |
| A waiver with no person, or one that names nothing                                   | `waivers_invalid`; a named person is not verified (residual 9)                       |
| Skip the reset between captures                                                      | `start_state_dirty`                                                                  |
| Copy the original's served files into the clone                                      | `clean_room_identical_file`, for files in `material` or recorded reply bodies        |
| Leave the original's name in the clone                                               | `clean_room_forbidden_name`                                                          |
| Run the referee without `--exit-code` and read exit 0                                | not stopped; the printed `verdict` says `not_done`                                   |

## Scenarios and rendering

A scenario file is address-free: `{start_path, actions}`. `actions` are `capture-browser-scenario` actions. A `request`
step already takes a path. A `goto` step writes `{origin}` at the start of its `destination.url`
(`{"url": "{origin}/notes"}`); that is the only place the placeholder is replaced, and after replacement every `goto`
must stay on the side's address. Storage, secrets and other scenario members cannot be set.

Step ids decide a step's part (`scenarioStepKind`), and the schema enforces the rules: ids are unique, and ids
starting `rea-` are reserved.

- `fp-…`: the fingerprint. At least one, and all of them before any other step. It reads the state a clean start
  shows.
- `setup-…`, and REA's own `scenario_start`: setup. It needs no citation and cannot be cited. It may be `unknown` or
  `unstable`; `changed` still blocks.
- anything else: behaviour. At least one per scenario; each must be cited by an obligation and must be `unchanged`.

The referee renders one capture input per side (`renderCloneRunScenario`):

```json
{
  "browser": {
    "mode": "launch",
    "executable_path": "<target.browser.executable_path>"
  },
  "start_url": { "url": "<side address><start_path>" },
  "actions": ["<the scenario's actions with {origin} replaced>"],
  "capture": {
    "after_each_step": ["url", "accessibility"],
    "at_end": ["url", "accessibility"],
    "network": {
      "request_body": true,
      "response_body": true,
      "header_values": false
    }
  }
}
```

Every other member is omitted, so REA's default capture limits apply. On the clone side one more action is appended:
`{"step_id": "rea-tree-<clone tree sha256>", "action": "wait_for_timeout", "duration_ms": 1}`.
The rendered document must pass `browserScenarioSchema`; its issues are reported against the scenario file with that
schema's own messages. The expected digest of a side is `digestCanonicalValue` of the parsed rendered document.

## Admission

For each file under `evidence/<side>/<scenario>/`, in path order:

1. `comparer.readCapture(file)` fails (not authenticated, not one capture record, no step ids):
   `rejected_integrity`.
2. `start_origin`, or the origin of `definition.start_url`, is not the side's address: `rejected_address`. This covers
   a capture taken from the other side's address.
3. `scenario_sha256` equals the side's expected digest: `admitted`, or `duplicate` when an earlier file of this side
   and scenario holds the same `evidence_id`. A copied capture is not a repeat.
4. Clone side only: the capture's last action is `rea-tree-<d>`, `d` is not the current tree digest, and rendering with
   `d` gives the capture's `scenario_sha256`: `stale`.
5. Otherwise `scenario_mismatch`: the capture replays another scenario, another version of this one, or other capture
   settings.

So the address binds a capture to its side, and REA's own digest of the scenario it ran binds it to the scenario's
content, the capture settings and, on the clone side, the tree.

A side needs `target.limits.min_captures` admitted captures per scenario (2; the schema refuses less). With fewer, the
finding is `evidence_stale` if the side has stale files, else `evidence_scenario_mismatch` if it has mismatched ones,
else `evidence_missing`. Duplicate, stale and mismatched files are otherwise harmless: edits make them and captures
never overwrite. Each `rejected_integrity` or `rejected_address` file blocks until its role removes it. A directory
under `evidence/<side>/` that names no scenario is ignored.

## Staleness

`digestCloneTree(root, exclude)` reads every file under `target.clone.root` except `target.clone.exclude` and returns
`cloneTreeSha256`: the canonical digest of `{tree: "rea.clone-tree/1", files: [[path, kind, sha256], …]}` sorted by
`/`-separated relative path. An exclude matches whole leading path segments; the default is `.git` and `node_modules`;
`gate.json` lists the excludes that applied.

A symlink contributes its link text and is not followed. A link whose resolved target lies outside the clone root or
under an exclude could change what the clone serves without changing the digest, so each one blocks with
`clone_symlink_outside_root` until it is removed or its own path is excluded.

The binding is the rendered input. Each evaluation digests the tree and renders the clone inputs with that digest in
the `rea-tree-` step. A capture made from that input carries the digest inside `parameters`, which Evidence
authentication covers. Admission then requires the digest in the Evidence to equal the tree as it is at evaluation.
Any edit to any non-excluded clone file, at any time after the input was rendered, including before the first
evaluation that sees the capture, changes the tree digest and makes the capture stale. The verifier's loop is
therefore: evaluate (renders), capture from `rendered/clone/`, evaluate. Residual trust items 5 and 6 say what this
does not prove.

A clone that writes files under its own root while it runs (a database, a log, a build cache) makes every capture
stale. The lead lists those paths in `target.clone.exclude`; the `evidence_stale` message says so.

## The comparer

`rea compare-scenario-behavior` takes one or more captures per side. The referee calls the same code through
`ScenarioBehaviorComparer`.

Reuse: `readEvidenceFileSource` authenticates, `parseCaptureEvidence(operation, evidence, "manifest")` validates,
`probeRequests` yields requests and answers, `compareAnswers` is the differ. Step ids reach them through small changes
owned by this work package: `ScenarioCaptureRecords` gains the step id and resource type of each record (from the
request event's `step_index` and `resource_type`), `ParsedEnvironmentCapture` exposes them with the capture's steps,
start origin and parameters, and `probeRequests` takes the step ids and the origin to use and sets
`ProbeStep.step_id`. A HAR has none; the comparer refuses it.

All captures of one side must list the same step ids in the same order, or the comparison is refused. Steps are
aligned by step id, taken in the left side's order. A left step the right side lacks is `changed`; a right-only step
is named in `limitations`. Steps whose ids start `rea-` are never compared.

Dimensions per step:

| Dimension      | Recorded today as                                            | Compared                                                 |
| -------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| `step`         | `steps[].status`                                             | outcome                                                  |
| `request`      | the step's request events of type `fetch`, `xhr`, `document` | method, path, query, request body                        |
| `status`       | the matched response's status                                | exact                                                    |
| `body`         | reply body; JSON for a JSON-like media type                  | JSON by pointer; text whole; not compared for `document` |
| `page_address` | `steps[].after_url`                                          | path, query and fragment; see **Origin**                 |
| `text`         | `steps[].artifacts.accessibility.value.text`                 | exact, after renames                                     |

Other resource types (scripts, styles, images, fonts) are not compared in this milestone; each side reports their
count as `ignored_transactions`. Headers are not compared. A screenshot tolerance is milestone 2.

Rules:

- **Origin.** A capture's application is its `start_origin`, never the origin `probeRequests` would pick. Only
  transactions at that origin are compared. A `fetch`, `xhr` or `document` request to another origin is an `unknown`
  finding (`other-origin`) for the side that made it: neither compared nor ignored. A page address is `after_url.url`
  with the start origin removed; at another origin it keeps its whole URL. So a clone that sends the browser or its
  requests to another server cannot match, and a target that serves its API from a second origin is outside this
  milestone.
- **Transactions** of a step are matched by request line (method, path, query): the k-th occurrence on the left with
  the k-th on the right. An unmatched one is a `request` difference.
- **Renames** (`from` → `to`) are applied to the left side's on-screen text, to JSON string values of its request and
  reply bodies and to its text bodies: every occurrence, case-sensitive, in declaration order. Never to field names,
  paths, queries, statuses or page addresses. The result lists each rename that changed a compared value
  (`renames_applied`).
- **Repeats fold.** A reply body counts as observed if any capture of that side observed it for that transaction.
- **Missing data is `unknown`, never a match, on either side:** no response; a reply body that was expected and that
  no capture of the side recorded whole (lost, over the capture's body limit, or cut by the differ's own limit); text
  or page address not recorded or redacted; a left step that did not complete; a right step that was cancelled. A
  HEAD reply, 204, 205, 304 and every redirect carry no body to miss (`replyBodyExpected`). The comparer decides this
  for both sides before it calls the differ.
- **`changed`:** any `compareAnswers` difference between two observed replies; a right step that failed where the left
  completed; an unmatched transaction; a differing request body, page address or text; and any reply leaf that is not
  exactly equal across sides and is stable on the left, even when the differ treated it as equal. The comparer
  therefore also compares the two replies exactly and does not let a normalisation count stand in for equality.
- **`unstable`:** something differs between the repeats of one side and no honoured declaration covers it. What the
  left side's own repeats disagree on is `unstable`, not `changed`: only a value the original holds steadily can be
  contradicted.
- **Volatile fields.** A declaration `{scenario, step_id, pointer, reason}` names one reply leaf (`*` for any one array
  index). It never covers the values beneath an object or array, and the empty pointer is refused. It is honoured only
  where the left side's repeats really differ at that leaf. An honoured leaf's value is not compared; its
  `volatileValueShape` (JSON type, and a string's layout) still is whenever the left's own values share one shape. A
  declaration on a leaf that is stable on the left is ignored. With one left capture nothing can be shown volatile, so
  a normalised difference is `unknown`. Only reply body leaves can be declared. A step whose text, status or requests
  vary between repeats must be made deterministic or renamed `setup-`.
- **Fingerprint.** Each capture has a `fingerprint_sha256` over everything its `fp-` steps observed, null when one of
  them lacks an observation. A side's `start_state` is `dirty` when two of its fingerprints differ, `clean` when at
  least two are recorded and all are equal, else `unknown` (`scenarioStartState`). Declarations do not apply to
  fingerprint steps.
- A step's status is the worst of its findings: `changed`, then `unstable`, then `unknown`, then `unchanged`. The
  verdict is `changed` if any step is; else `unknown` if any step is `unknown` or `unstable`; else `unchanged`.
- **Finding categories.** Each finding carries a `category`, and the category alone decides what the finding makes of
  its step (`scenarioFindingStatus`, which the referee uses too). `not-recorded`, `not-completed` and `other-origin`
  are missing data: `unknown`. `repeats-differ` and `undeclared-volatile` are one side disagreeing with itself:
  `unstable`. Every other category is a difference between the sides, `changed`: the comparer's own `value`, `status`,
  `shape` (an honoured volatile field whose shape differs) and `missing-step`, and any category `compareAnswers`
  reports for a reply body. A step's findings are listed most severe first.

## What done means

`evaluate-clone-run` runs eight checks (`CLONE_RUN_CHECKS`). `done` needs all of them to pass.

1. **scope**: `target.json` is valid and carries the authorisation statement; the clone's name contains none of the
   original's names; the two addresses differ in scheme, port or host, with every loopback name counted as one host
   (`cloneRunAddressIdentity`); the run folder is not the clone root or inside it (both paths symlink-resolved); the
   clone root exists; no symlink leaves it.
2. **inputs**: every authored file passes its schema; there is at least one scenario and one obligation file. Beyond
   the schemas: a base name is an identifier and an unknown is named `<role>-<n>`; obligation ids are unique across
   files; each waiver names an existing unknown or an existing inferred obligation, and each `closed` entry an
   existing unknown and an existing observed obligation; each volatile field names an existing scenario and step.
3. **evidence**: admission as above, for every scenario and both sides.
4. **clean_start**: each side's `start_state` is `clean`, per scenario, judged once the side has `min_captures`
   admitted captures.
5. **coverage**: every behaviour step is cited; every case names an existing scenario and behaviour steps of it
   (never an `fp-` or `setup-` step), each of which completed in every admitted original capture; no obligation is
   `inferred` unless waived.
6. **parity**: with original as left and clone as right, every behaviour step is `unchanged` and no setup or
   fingerprint step is `changed`. No parity finding can be waived. Setup and fingerprint steps that are `unknown` or
   `unstable` are counted in `counts.ungated_steps`.
7. **clean_room**: no clone file of 64 bytes or more has the SHA-256 of a file under `target.original.material`
   (default `scout/` in the run folder) or of a reply body an admitted original capture recorded (`reply_bodies`); no
   entry of `target.original.names` occurs, ignoring ASCII case, in a clone file's bytes or relative path. Excludes
   apply. A name is matched as a plain substring, so the lead declares distinctive names: one that also occurs in a
   route or a field name can never be satisfied.
8. **unknowns**: every `unknowns/` file is waived or closed.

The checks do not wait for one another. With no clone yet, the referee still renders the original's inputs, admits its
Evidence, judges its start state and writes `behavior/` from the first admitted capture, so the prober and the spec
writer work before a builder starts. A check is `pass` when it was computed for every scenario and found nothing,
`fail` when it has a finding, and `not_evaluated` otherwise (parity before both sides are admitted; every check that
needs `target.json` when it is refused).

Obligations: `{id, statement, basis: "observed" | "inferred", cases: [{scenario, step_ids}]}`. An observed obligation
cites at least one case.

Unknowns and waivers. A worker proposes an unknown as a file `{statement}`. Only the lead settles one, in
`waivers.json`: a waiver `{kind: "unknown" | "obligation", id, person, reason}` needs a named person and a reason, and
`closed` `{unknown, obligation}` needs an observed obligation whose cited steps are all `unchanged`. Waivers cover
unknown proposals and inferred obligations, nothing else: a step whose data is missing blocks until a capture records
it or the prober renames it `setup-`. With one or more waivers applied the verdict is `done_with_waivers` and
`summary` reads `done with N waivers`.

### Reason codes

`CLONE_RUN_REASONS` is the only list. Capture reasons go to the prober on the original side and the verifier on the
clone side.

| Check       | Codes                                                                                                        | Role                             |
| ----------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| scope       | `target_invalid`, `addresses_not_distinct`, `run_folder_inside_clone`                                        | lead                             |
| scope       | `clone_root_missing`, `clone_symlink_outside_root`                                                           | builder                          |
| inputs      | `no_scenarios`, `scenario_invalid`                                                                           | prober                           |
| inputs      | `no_obligations`, `obligation_invalid`                                                                       | spec writer                      |
| inputs      | `unknown_invalid`, `intended_differences_invalid`, `waivers_invalid`                                         | lead                             |
| evidence    | `evidence_missing`, `evidence_scenario_mismatch`, `evidence_rejected_integrity`, `evidence_rejected_address` | prober or verifier               |
| evidence    | `evidence_stale`                                                                                             | verifier                         |
| clean_start | `start_state_dirty`, `start_state_unknown`                                                                   | prober or verifier               |
| coverage    | `step_uncited`, `obligation_step_unknown`                                                                    | spec writer                      |
| coverage    | `obligation_inferred`                                                                                        | prober                           |
| parity      | `parity_changed`                                                                                             | builder                          |
| parity      | `parity_unknown`                                                                                             | prober or verifier               |
| parity      | `parity_unstable`                                                                                            | lead (original), builder (clone) |
| clean_room  | `clean_room_identical_file`, `clean_room_forbidden_name`                                                     | builder                          |
| unknowns    | `unknown_open`                                                                                               | lead                             |

### The worklist

`gate.json` carries `blocking` (every reason with its total) and `next`: at most ten items in check order, then reason
order, scenario and step. When findings are left out, `summary` says so (`not done: 14 blocking findings; next lists
the first 10 and leaves out 4`). Each item has `role`, `reason`, `file`, `command` and `message`; parity items add `scenario`,
`step_id`, `dimension`, `pointer`, `expected` (original) and `actual` (clone), one item per step with its most severe
finding. `command` is the exact command to run:

- a capture: `[REA_BROWSER_NO_SANDBOX=true ]timeout <capture_timeout_seconds> <rea_command> capture-browser-scenario
  '<run>/rendered/<side>/<scenario>.json' --detail summary --evidence_output
  '<run>/evidence/<side>/<scenario>/run-<N>.json' --json`. One item per missing capture, each with its own free `N`,
  for `evidence_missing`, `evidence_stale` and `evidence_scenario_mismatch`. One more capture also serves
  `start_state_unknown` and every `parity_unknown` whose finding is `not-recorded` on that side, because repeats fold
  and another capture can supply what one lost; those items of one side and scenario carry the same command. The
  message gives the side's reset command when `target.json` records one, and for `parity_unknown` says that data
  still missing after another capture will not arrive (a reply over the body limit);
- a removal: `rm '<file>'…` for each rejected Evidence file, and for `start_state_dirty` the side's captures outside
  its largest group of equal fingerprints, or all of them on a tie;
- everything else: `<rea_command> evaluate-clone-run '<run>' --exit-code`, to run after the edit the message asks for.

`message` names the path and the fix, and where the fix is a line of JSON it gives the line: the case to add for
`step_uncited`, the `volatile_fields` entry for a `parity_unstable` leaf of the original, the waiver for
`unknown_open`. A schema failure reads like
`obligations/notes.json /obligations/0/cases: An observed obligation cites at least one case; add
{"scenario": "<id>", "step_ids": ["<step>"]} or set basis to "inferred"`.

### Stall

The referee reports `stalled` itself, from `journal.jsonl`. An evaluation appends a line only when its state (blocking
findings, clone tree digest, admitted Evidence ids) differs from the last line, so re-running it is free. A line is
**judged** when every scenario had its captures admitted on both sides; `round` counts judged lines. A `not_done`
result becomes `stalled` when `round` reaches `target.limits.max_rounds` (8), or when this judged round and the
previous one have the same blocking findings and the same clone tree digest. `stalled` still carries `next`.

## Commands

A refusal is REA's usual error envelope (`{"error": …, "code": …, "message": …}`) and exit 1, with or without
`--exit-code`. A refusal has no `verdict` member.

### `rea compare-scenario-behavior`

| Flag                         | Meaning                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `--left <file>`              | Capture Evidence of the left side (record or bundle). Repeat per capture; at least one. |
| `--right <file>`             | The same for the right side.                                                            |
| `--differences <file>`       | An `intended-differences.json`; its renames and volatile fields apply.                  |
| `--scenario <id>`            | Which scenario's volatile fields apply. Required when the file names more than one.     |
| `--detail summary\|complete` | `summary` (default) omits unchanged steps.                                              |
| `--exit-code`                | Exit by verdict.                                                                        |

Result: `scenarioBehaviorComparisonSchema`. Exit without `--exit-code`: 0. With it: 0 `unchanged`, 1 `changed`,
2 `unknown`.

### `rea init-clone-run <directory>`

| Flag                                                                                     | Meaning                                                                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `--original <origin>`, `--clone <origin>`                                                | Required. The two addresses, read as text and checked by the target schema.                |
| `--clone-root <dir>`, `--clone-name <name>`                                              | Required. Where the clone's source lives and what it is called.                            |
| `--original-name <name>`                                                                 | Required, repeatable. Names of three characters or more that must not appear in the clone. |
| `--authorization <text>`                                                                 | Required. Why the team may study the original.                                             |
| `--stated-by <person>`                                                                   | Who made the statement.                                                                    |
| `--browser <path>`                                                                       | Chromium executable. Default `REA_BROWSER_EXECUTABLE`; refused if neither.                 |
| `--browser-no-sandbox`                                                                   | Default: whether `REA_BROWSER_NO_SANDBOX` is `true`.                                       |
| `--exclude <path>`                                                                       | Repeatable. Replaces the default excludes.                                                 |
| `--material <dir>`                                                                       | Repeatable. Replaces the default original material (`scout`).                              |
| `--original-start`, `--original-reset`, `--original-stop`, `--original-health <command>` | Recorded for the team; REA never runs them.                                                |
| `--clone-start`, `--clone-reset`, `--clone-stop`, `--clone-health <command>`             | The same for the clone.                                                                    |
| `--rea-command <command>`                                                                | How worklist commands spell the CLI. Default `rea`.                                        |
| `--max-rounds <n>`, `--capture-timeout-seconds <n>`                                      | Defaults 8 and 120.                                                                        |

The directory must be absent or empty and outside the clone root, the two addresses must differ as scope requires, and
the clone's name must not contain an original name. Nothing is overwritten. It writes `target.json`,
`intended-differences.json` (one rename per original name to the clone name, reason `product name`), `waivers.json`
(empty lists), the empty directories, and `examples/`. Result: `cloneRunInitResultSchema`. Exit 0.

### `rea evaluate-clone-run <directory>`

One flag, `--exit-code`. It reads the folder, never starts, stops or resets a target, rewrites its outputs and prints
`gate.json` (`cloneRunGateSchema`). A missing directory or `target.json` is a refusal; every other problem is a finding.
Exit without `--exit-code`: 0, whatever the verdict. With it: 0 `done` or `done_with_waivers`, 1 `not_done`,
2 `stalled`. Every worklist command passes the flag.

## What an agent still writes

Init scaffolds `target.json`, `intended-differences.json` and `waivers.json` from flags. Agents author three kinds of
file. Init writes each example below to `examples/`, and each must parse with its schema.

`scenarios/notes-api.json` (prober):

```json
{
  "start_path": "/",
  "actions": [
    {
      "step_id": "fp-notes",
      "action": "request",
      "method": "GET",
      "path": "/api/notes",
      "timeout_ms": 15000
    },
    {
      "step_id": "create-empty-title",
      "action": "request",
      "method": "POST",
      "path": "/api/notes",
      "json": { "title": "   " },
      "timeout_ms": 15000
    }
  ]
}
```

`obligations/notes.json` (spec writer):

```json
{
  "obligations": [
    {
      "id": "notes-title-required",
      "statement": "Creating a note whose title is empty after trimming answers 422 with error title_required.",
      "basis": "observed",
      "cases": [{ "scenario": "notes-api", "step_ids": ["create-empty-title"] }]
    }
  ]
}
```

`unknowns/prober-1.json` (any worker):

```json
{
  "statement": "Whether titles are limited by characters or bytes was not probed."
}
```

The lead adds entries to the two scaffolded files, for example a volatile field
`{"scenario": "notes-api", "step_id": "create-ok", "pointer": "/createdAt", "reason": "creation time"}` and a waiver
`{"kind": "unknown", "id": "prober-1", "person": "<name>", "reason": "<why this gap is accepted>"}`. The worklist
prints both lines ready to paste.

Schema errors must name the file, the JSON pointer and the fix (`cloneRunFileIssueSchema`), and one evaluation reports
every broken file.

## Acceptance

In this container, with no native provider:

1. `npm run test:local -- src/domain/scenarioBehaviorComparison.test.ts
   src/application/cloneRun/CloneRunEvaluation.test.ts tests/conformance/cloneRunGuidance.test.ts` passes.
2. `npm run verify:clone-run` serves the fixture original and a copy of the renamed clone on loopback ports (the slug
   mutant is that copy with the one replacement of `mutant/switch.json` applied), captures with real Chromium by
   running the worklist's own commands, and shows: matching clone exits 0; mutant exits 1 with a `next` item whose pointer ends in
   `/slug`; a step whose reply no capture recorded (the fixture answers it with more than 64 KiB) makes
   `compare-scenario-behavior --exit-code` exit 2 with one capture per side and gives `parity_unknown`, not done, with
   two; a line appended to a clone file after a pass gives `evidence_stale`; an edited Evidence file gives
   `evidence_rejected_integrity`; a capture from the other side's address gives `evidence_rejected_address`; the
   original's name left in the clone gives `clean_room_forbidden_name`; two captures with no reset between them give
   `start_state_dirty`.
3. `rea setup` under a throwaway `HOME` installs `references/clone-runs.md`, and `rea guidance --query "clone parity"`
   returns matches.

## Non-goals

- Starting, stopping or resetting a target. That needs a scope decision that has not been made.
- Fixing lost response bodies or the capture step deadline, and raising the capture's body limits. A reply no capture
  recorded is `unknown`.
- Targets that serve their application from more than one origin.
- MCP tool contracts, surface coverage, screenshot comparison, a packaged agent crew, and JavaScript, Electron or
  command-line targets.
- The live agent evaluation of the playbook (the design's `verify:clone-run:live`). It starts a named coding assistant,
  so it follows this build as a separate decision.
