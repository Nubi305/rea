# Clone runs: a referee and a team playbook for web apps

Status: implemented as milestone 1. [tasks.md](tasks.md) records what was built and what was verified. A proof round
on 2026-11-20 found defects in the first build, among them ways to `done` for a wrong clone and ways a correct clone
was blocked; a fix round the same day corrected them, and this text describes the corrected behaviour as the commands
show it.

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
[The comparer](#the-comparer) says what the feature changed. The facts about frames, dialogs and downloads were
established by the proof round.

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
  names the other origin. Accessibility text is the top document's: a frame shows in it as a bare `iframe` line,
  whatever its origin, and the text of an alert, confirm or prompt dialog is not recorded at all.
- A link that downloads a file produces a `document` transaction whose body the capture records as unavailable
  (`request-failed`), and the page text does not change.
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

| Path                                    | Schema (`cloneRunSchemas.ts`)         | Writer                                                                   |
| --------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| `target.json`                           | `cloneRunTargetSchema`                | `init-clone-run`; the lead edits it afterwards                           |
| `intended-differences.json`             | `cloneRunIntendedDifferencesSchema`   | lead (scaffolded by init)                                                |
| `waivers.json`                          | `cloneRunWaiversSchema`               | lead (scaffolded by init)                                                |
| `scenarios/<scenario>.json`             | `cloneRunScenarioSchema`              | prober                                                                   |
| `obligations/<area>.json`               | `cloneRunObligationsSchema`           | spec writer                                                              |
| `unknowns/<role>-<n>.json`              | `cloneRunUnknownSchema`               | the role in the file name                                                |
| `specs/`, `scout/`, `surfaces.json`     | free form                             | spec writer, scout, mapper                                               |
| `evidence/<side>/<scenario>/run-N.json` | REA Evidence bundle                   | `capture-browser-scenario`, run by prober (original) or verifier (clone) |
| `rendered/<side>/<scenario>.json`       | browser scenario document             | referee                                                                  |
| `records/<side>/<scenario>.json`        | `cloneRunAdmissionRecordSchema`       | referee                                                                  |
| `behavior/<scenario>.json`              | `scenarioBehaviorTableSchema`         | referee                                                                  |
| `parity/<scenario>.json`                | `scenarioBehaviorComparisonSchema`    | referee                                                                  |
| `journal.jsonl`                         | `cloneRunJournalEntrySchema`          | referee                                                                  |
| `gate.json`                             | `cloneRunGateSchema`                  | referee                                                                  |
| `examples/*.example.json`               | the authored schemas; a capture input | `init-clone-run`                                                         |

`<side>` is `original` or `clone`. A file's base name is its id: no authored file repeats its own name inside. The six
referee rows are outputs. No verdict reads them back; the one use of an output is `journal.jsonl` for stall detection,
which can only turn `not_done` into `stalled`. Outputs of a scenario that no longer exists are removed; an entry of
an output directory whose name starts with a dot is left alone, because it can be a write in flight. Evaluations are
not serialised: two at once would interleave these outputs, so the playbook has one role evaluate at a time. Two
evaluations of one state are still one round ([Stall](#stall)).

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

Residual trust, stated in the gate as `residual_trust` (`CLONE_RUN_RESIDUAL_TRUST`, same order). The gate lists it with
`done` and `done_with_waivers` only; with `not_done` and `stalled` the member is empty, so the fixed text is not
repeated on every round.

1. The authorisation statement is recorded as given. REA cannot verify it.
2. `target.json`, the scenarios and the declarations are the team's own statements. The verdict is about the addresses,
   clone root, excludes, names and material that `target.json` declares when the referee runs, and anyone who can edit
   it can retarget the run. `gate.json` repeats the addresses and the root under `target`.
3. The verdict covers only the steps the scenarios contain. REA cannot tell whether they exercise every rule of the
   original (surface coverage is a later milestone), nor whether an obligation's statement describes the steps it
   cites. Deleting a failing step, a capture or an unknown file leaves no trace.
4. Evidence integrity is an unkeyed content digest. It catches an edited or misplaced file. It does not catch Evidence
   forged by recomputing the digest with REA's own code.
5. A capture is bound to an address, not to what answered there. REA cannot prove which program or which build of the
   clone was serving, nor that it did not pass requests on to another server. The two addresses are checked to differ
   by port or by resolved host; a proxy or a port forward between them is not detected.
6. Clone Evidence is bound to the tree digest its capture input was rendered for, and that digest equals the tree now.
   An edit that was reverted between the two is not visible. The digest covers the path and bytes of every regular
   file and the text of every link; file modes, empty directories and special files (a FIFO, a socket, a device) are
   not part of it.
7. Excluded clone paths are not digested, so an edit there never makes a capture stale, and they are not checked for
   copied files or names. The summary names them whenever an exclude matched.
8. Renames and volatile fields are declarations. A rename can declare away any difference in on-screen text or a
   string value, and an honoured volatile field is compared by shape only. `gate.json` lists those that took effect
   under `declared`.
9. A waiver's person and reason are recorded as given.
10. The clean-room check covers names and identical files only: no declared name of the original in the clone, and no
    clone file byte-identical to a file of the declared material or to a reply body a capture recorded, 64 KiB each
    at most. It does not detect rewritten, reformatted or paraphrased code.
11. REA does not reset targets. A clean start is inferred from the fingerprint steps only.
12. The journal is the referee's own output. Removing it can hide a stall and cannot produce a pass.
13. A step is compared on its outcome, its requests, their statuses, fetched reply bodies, the page address and the
    accessibility text only. Appearance, styles, images, fonts, response headers, the document title and timing are
    not compared.
14. Text inside an iframe and the text of alert, confirm and prompt dialogs are not compared.

Items 13 and 14 were appended by the fix round, so the earlier numbers keep their place. A downloaded file belongs to
item 13 in effect: no capture records a download's body, so a step that triggers one is `unknown` and can only leave
the worklist as a `setup-` step, which is not compared.

### Ways to a false pass, and what stops each

The rows that name a reason code or a comparer rule are what the comparer's and the referee's tests are written
against; [tasks.md](tasks.md) records what was run. "Not stopped" rows are limits: each names the residual item that
states it.

| Attempt                                                                              | Stopped by                                                                                                                                               |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Write or edit `gate.json`, `parity/`, `records/` or `rendered/`                      | never read; the verdict is recomputed                                                                                                                    |
| Edit the journal                                                                     | can only add `stalled` (residual 12)                                                                                                                     |
| Edit an Evidence file                                                                | `evidence_rejected_integrity`                                                                                                                            |
| Forge Evidence with REA's own digest code                                            | not stopped (residual 4)                                                                                                                                 |
| Copy one capture to make the second                                                  | `duplicate`, so `evidence_missing`                                                                                                                       |
| File a capture under the other side                                                  | `evidence_rejected_address`                                                                                                                              |
| File a capture of another scenario, version or capture setting                       | `evidence_scenario_mismatch`, so not counted                                                                                                             |
| Edit the clone after its capture, or before the first evaluation                     | `evidence_stale`                                                                                                                                         |
| Change only a file's mode, or add an empty directory or a special file               | not stopped: these are not part of the tree digest (residual 6)                                                                                          |
| Keep code under an exclude, or edit an excluded file after an honest capture         | not stopped: an excluded path never goes stale. Every summary names the excluded paths that matched, and `gate.json` lists them (residual 7)             |
| Write an exclude that looks narrow and is not (a pattern, `..`, an absolute path)    | `target_invalid`: the entry can never match and is refused                                                                                               |
| Keep code behind a symlink that leaves the clone root                                | `clone_symlink_outside_root`, also when the link's target is absent or cannot be resolved while the referee runs                                         |
| Make a clone file unreadable to the referee                                          | `clone_path_unreadable`                                                                                                                                  |
| Serve another program, or another build, at the clone's address                      | not stopped (residual 5)                                                                                                                                 |
| Send the browser or its requests from the clone to another server                    | `parity_changed` or `parity_unknown` (comparer rule **Origin**)                                                                                          |
| Give both sides one address, also through another name of this machine               | `addresses_not_distinct`: equal ports and hosts that resolve to a common address; a host that does not resolve blocks too                                |
| Put a proxy or a port forward at the clone's address                                 | not stopped (residual 5)                                                                                                                                 |
| Put the run folder inside the clone                                                  | `run_folder_inside_clone`                                                                                                                                |
| Point `target.json` at other addresses or another root                               | not stopped; `gate.json` repeats them (residual 2)                                                                                                       |
| No scenario, or no obligation file                                                   | `no_scenarios`, `no_obligations`                                                                                                                         |
| A scenario with no behaviour step, or no fingerprint                                 | `scenario_invalid`                                                                                                                                       |
| An absolute URL in a `goto`                                                          | `scenario_invalid`                                                                                                                                       |
| Rename a failing step `setup-`                                                       | `parity_changed`: `changed` blocks on every step                                                                                                         |
| Rename a failing step `setup-` and declare the differing reply field volatile        | not stopped: the step is `unknown` (`declared-not-shown`), which a setup step may be. It is the deleted step of the next row, counted in `ungated_steps` |
| Delete a failing step                                                                | not stopped (residual 3)                                                                                                                                 |
| Leave a behaviour step uncited                                                       | `step_uncited`                                                                                                                                           |
| An observed obligation with no case                                                  | `obligation_invalid`                                                                                                                                     |
| An obligation that cites only `fp-` or `setup-` steps, or a step that does not exist | `obligation_step_unknown`                                                                                                                                |
| Mark a rule `inferred` instead of probing it                                         | `obligation_inferred` until a named person waives it                                                                                                     |
| Declare a volatile field that does not vary on the original, also with step `*`      | not honoured: `parity_unknown` (`declared-not-shown`) on a behaviour step, and `parity_changed` once the declaration is withdrawn. Never a match         |
| Declare an object, an array or the whole body volatile                               | never covers the leaves beneath; the empty pointer is `intended_differences_invalid`                                                                     |
| Declare a rename that hides a real difference                                        | not stopped; `gate.json` lists applied renames (residual 8)                                                                                              |
| Waive missing data, a difference or an unstable step                                 | no such waiver exists                                                                                                                                    |
| A waiver with no person, or one that names nothing                                   | `waivers_invalid`; a named person is not verified (residual 9)                                                                                           |
| Skip the reset between captures                                                      | `start_state_dirty`                                                                                                                                      |
| Copy the original's served files into the clone                                      | `clean_room_identical_file`, for files in `material` or recorded reply bodies; material behind a link is read at its real path                           |
| Declare a material directory that does not exist                                     | `target_invalid` at `/original/material/<n>`                                                                                                             |
| Retype, reformat or paraphrase the original's scripts                                | not stopped (residual 10)                                                                                                                                |
| Leave the original's name in the clone, a path or a link's text                      | `clean_room_forbidden_name`                                                                                                                              |
| Answer a list where the original answers an object with index keys, or the reverse   | `parity_changed`: leaves are equal by pointer and by the kind of every container on the way (comparer rule **`changed`**)                                |
| Drop a request body, or run past the capture's transaction limit                     | `parity_unknown` (`not-recorded`): data no capture recorded is never a match                                                                             |
| Serve a download with other content                                                  | `parity_unknown`: no capture records a download's body. Renamed `setup-`, the step is no longer compared (residual 3)                                    |
| Differ only in appearance, headers, the document title or timing                     | not stopped (residual 13)                                                                                                                                |
| Differ only in the text of an iframe or of a dialog                                  | not stopped (residual 14)                                                                                                                                |
| Run the referee without `--exit-code` and read exit 0, or search its output for done | not stopped; the printed `verdict` says `not_done`, and only the exit status of a run with the flag is the verdict                                       |

## Scenarios and rendering

A scenario file is address-free: `{start_path, actions}`. `actions` are `capture-browser-scenario` actions. A `request`
step already takes a path. A `goto` step writes `{origin}` at the start of its `destination.url`
(`{"url": "{origin}/notes"}`); that is the only place the placeholder is replaced, and after replacement every `goto`
must stay on the side's address. Storage, secrets and other scenario members cannot be set.

Step ids decide a step's part (`scenarioStepKind`), and the schema enforces the rules: an id starts with a letter and
holds letters, digits, `.`, `_` and `-`; ids are unique, and ids starting `rea-` are reserved.

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

For each entry under `evidence/<side>/<scenario>/` whose name does not start with a dot, in path order:

1. The entry is not a regular file (a directory, a link, a special file), or `comparer.readCapture(file)` fails (not
   authenticated, not one capture record, no step ids): `rejected_integrity`. A non-regular entry is never read
   through; its detail reads `not a file capture-browser-scenario wrote`.
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
never overwrite. Each `rejected_integrity` or `rejected_address` entry blocks until its role removes it. The next free
`run-N.json` skips every existing one, whatever kind of entry it is, so a printed capture command never meets an
existing entry. A directory under `evidence/<side>/` that names no scenario is ignored.

## Staleness

`digestCloneTree(root, exclude)` reads every file under `target.clone.root` except `target.clone.exclude` and returns
`cloneTreeSha256`: the canonical digest of `{tree: "rea.clone-tree/1", files: [[path, kind, sha256], …]}` sorted by
`/`-separated relative path. It covers the path and bytes of every regular file and the text of every link. File
modes, empty directories and special files are not part of it (residual trust 6). A file that vanishes during the walk
is skipped; an entry that cannot be read, or whose name is not valid UTF-8, blocks with `clone_path_unreadable`.

An exclude is a path relative to the clone root that matches whole leading segments; the default is `.git` and
`node_modules`. `cloneRunExcludeIssue` refuses an entry that can never match: white space around it, a backslash, an
absolute path, a pattern character (`*`, `?`, `[`, `]`), `..`, or the root itself. `clone_tree.exclude` in the gate
lists the declared excludes that matched a path, and whenever one matched, every summary ends
`; N clone path(s) is|are excluded and is|are covered neither by staleness nor by the clean-room check (<paths>)`. A
pass with a matched exclude therefore never has the summary `done` alone.

A symlink contributes its link text and is not followed. A link could change what the clone serves without changing
the digest when its target lies outside the clone root or under an exclude, and equally when it cannot be resolved
while the referee runs (its target is absent, or the links loop). Each one blocks with `clone_symlink_outside_root`
until it is removed or its own path is excluded; the check does not depend on the target being present.

The binding is the rendered input. Each evaluation digests the tree and renders the clone inputs with that digest in
the `rea-tree-` step. A capture made from that input carries the digest inside `parameters`, which Evidence
authentication covers. Admission then requires the digest in the Evidence to equal the tree as it is at evaluation.
A change to the bytes of any non-excluded clone file, or adding, removing or renaming one, at any time after the input
was rendered, including before the first evaluation that sees the capture, changes the tree digest and makes the
capture stale. The verifier's loop is therefore: evaluate (renders), capture from `rendered/clone/`, evaluate. Residual
trust items 5 and 6 say what this does not prove.

A clone that writes files under its own root while it runs (a database, a log, a build cache) makes every capture
stale. The lead lists those paths in `target.clone.exclude`; the `evidence_stale` message says so.

## The comparer

`rea compare-scenario-behavior` takes one or more captures per side. The referee calls the same code through
`ScenarioBehaviorComparer`.

Reuse: `readEvidenceFileSource` authenticates, `parseCaptureEvidence(operation, evidence, "manifest")` validates,
`probeRequests` yields requests and answers, `compareAnswers` is the differ. Step ids reach them through small changes
owned by this work package: `ScenarioCaptureRecords` gains the step id and resource type of each record (from the
request event's `step_index` and `resource_type`), `ParsedEnvironmentCapture` exposes them with the capture's steps,
start origin, parameters and the capture's own count of omitted request events, and `probeRequests` takes the origin
to use and returns each parsed request line beside its steps. The comparer looks a step up by the record's ordinal and
does not parse a request line again. A HAR has no step ids; the comparer refuses it. A bundle that does not hold
exactly one record is refused with
`<file> is an Evidence bundle that does not hold exactly one record. Pass a file holding one capture: capture-browser-scenario --evidence_output writes one per capture.`

All captures of one side must list the same step ids in the same order, or the comparison is refused. Steps are
aligned by step id, taken in the left side's order. A left step the right side lacks is `changed`; a right-only step
is named in `limitations`. Steps whose ids start `rea-` are never compared.

Dimensions per step:

| Dimension      | Recorded today as                                            | Compared                                                        |
| -------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| `step`         | `steps[].status`                                             | outcome                                                         |
| `request`      | the step's request events of type `fetch`, `xhr`, `document` | method, path, query, request body, navigation or script request |
| `status`       | the matched response's status                                | exact                                                           |
| `body`         | reply body; JSON for a JSON-like media type                  | JSON by pointer; text whole; page markup is not compared        |
| `page_address` | `steps[].after_url`                                          | path, query and fragment; see **Origin**                        |
| `text`         | `steps[].artifacts.accessibility.value.text`                 | exact, after renames; a cross-side difference is listed once    |

Other resource types (scripts, styles, images, fonts) are not compared in this milestone; each side reports their
count as `ignored_transactions`. Headers, the document title and timing are not compared, and `text` is the top
document's accessibility text: it holds neither the content of an iframe nor the text of a dialog. A screenshot
tolerance is milestone 2.

Rules:

- **Origin.** A capture's application is its `start_origin`, never the origin `probeRequests` would pick. Only
  transactions at that origin are compared. A `fetch`, `xhr` or `document` request to another origin is an `unknown`
  finding (`other-origin`) for the side that made it: neither compared nor ignored. A page address is `after_url.url`
  with the start origin removed; at another origin it keeps its whole URL. So a clone that sends the browser or its
  requests to another server cannot match, and a target that serves its API from a second origin is outside this
  milestone. The capture's own start origin is also replaced by `{origin}` in on-screen text, in reply string values
  and text bodies and in request bodies, in the comparison and in `behavior/<scenario>.json`, so an application that
  prints its own address compares equal across the two addresses and needs no rename for it.
- **Transactions** of a step are matched by request line (method, path, query): the k-th occurrence on the left with
  the k-th on the right. An unmatched one is a `request` difference, with one exception: when the left's captures do
  not all send the same request lines at that step, a line only the right sent cannot contradict them and is
  `repeats-differ` (side `left`, the right's line in `actual`). A matched line that is a navigation on one side and a
  script request on the other is a `request` difference (`"document request"` against `"fetch or xhr request"`);
  `fetch` and `xhr` are one kind.
- **Documents.** Only page markup is skipped: a `document` reply whose media type is HTML, or one whose media type was
  lost with its body and whose path and query equal the step's page address (a page over the body limit). Any other
  `document` reply, such as a CSV, a PDF or a download, is compared like a fetched reply, and is `not-recorded` when
  no capture holds its body. Today no capture records a download's body, so a step that triggers a download is
  `unknown` on both sides. A page on one side against recorded data on the other is a `body` difference.
- **Renames** (`from` → `to`) are applied to the left side's on-screen text, to JSON string values of its request and
  reply bodies and to its text bodies: every occurrence, case-sensitive, in declaration order. Never to field names,
  paths, queries, statuses or page addresses. The result lists each rename that changed a compared value
  (`renames_applied`, counting compared values only).
- **Repeats fold for reply bodies only.** A reply body counts as observed if any capture of that side observed it
  for that transaction. A status, a text, a page address or a request body that some captures of a side recorded and
  others did not is `repeats-differ` (`recorded in K of N captures`), and so is a request line that only some sent
  (`sent in K of N captures`).
- **Missing data is `unknown`, never a match, on either side:** no response; a reply body that was expected and that
  no capture of the side recorded whole (lost, over the capture's body limit, or cut by the differ's own limit); a
  request body that was sent and not recorded; request events the capture itself reports it omitted (its transaction
  limit), which leaves every step of that capture `not-recorded`; text or page address not recorded or redacted; a
  left step that did not complete; a right step that was cancelled. A HEAD reply, 204, 205, 304 and every redirect
  carry no body to miss (`replyBodyExpected`), and a GET or HEAD request is read as sending none. The comparer decides
  this for both sides before it calls the differ.
- **`changed`:** any `compareAnswers` difference between two observed replies; a right step that failed where the left
  completed; an unmatched transaction beside a steady left; a differing request body, page address or text; and any
  reply leaf that is not exactly equal across sides and is stable on the left, even when the differ treated it as
  equal. Two leaves are equal when their pointer, the kind of every container on the way and their value are equal,
  so a list and an object with index-like keys differ. Two lists of the same length are compared item by item at
  their positions, never by an inferred pairing; lists of different lengths keep the differ's `length` finding. A
  text reply that is a JSON object or array in every reply of both sides is compared by its leaves.
- **`unstable`:** something differs between the repeats of one side and no honoured declaration covers it. What the
  left side's own repeats disagree on is `unstable`, not `changed`: only a value the original holds steadily can be
  contradicted. When the right side's repeats disagree and one of them equals the left's steady value, the only
  finding is `repeats-differ` on the right: the clone is not shown wrong by a capture that disagrees with its own
  repeat. This holds for text, status, page address, request body and reply leaves.
- **On-screen text is reported once.** A difference between the sides in on-screen text is a finding at the first
  step that shows that text. Later steps that show the same text on both sides carry no finding of their own for it,
  and `limitations` says how many (`The on-screen text difference at step <id> is listed there only: N later steps
show the same text on both sides and carry no finding of their own for it.`). The first step is still `changed`,
  so a clone whose page text is wrong cannot pass. Text that is unsteady or unrecorded is judged at every step.
- **Volatile fields.** A declaration `{scenario, step_id, pointer, reason}` names one reply leaf (`*` for any one array
  index); `step_id` is a step or `*` for every step of the scenario. It never covers the values beneath an object or
  array, and the empty pointer is refused. It is honoured only where the left side's repeats really differ: at that
  leaf, or at another index of the same pattern (`/items/*/id` is honoured at every index once the left shows one
  index varying). An honoured leaf's value is not compared; its `volatileValueShape` (JSON type, and a string's
  layout) still is whenever the left's own values share one shape. A declared leaf that the left holds steadily over
  two or more replies and that differs on the right with the same shape is `declared-not-shown`, `unknown`: nothing
  is ignored and nothing is held against the right until the left is captured again or the declaration is withdrawn,
  after which the difference is `changed`. A recorded value the left observed once is `single-observation`,
  `unknown`: one observation cannot show a value steady or volatile. `volatile_fields[]` of a step lists at most 20
  entries, each with `declared` (a declaration names the pointer at that step) and `honoured` (it took effect). Only
  reply body leaves can be declared. A step whose text, status or requests vary between repeats must be made
  deterministic or renamed `setup-`.
- **Fingerprint.** Each capture has a `fingerprint_sha256` over what its `fp-` steps observed, null when one of them
  lacks an observation, a request body that was not recorded or omitted request events. An `fp-` step that is a
  `request` step fingerprints its request and reply and leaves out the page text behind it. A side's `start_state` is
  `dirty` when two of its fingerprints differ, `clean` when at least two are recorded and all are equal, else
  `unknown` (`scenarioStartState`). Volatile declarations do not apply to fingerprint steps; renames do.
- A step's status is the worst of its findings: `changed`, then `unstable`, then `unknown`, then `unchanged`. The
  verdict is `changed` if any step is; else `unknown` if any step is `unknown` or `unstable`; else `unchanged`.
- **Finding categories.** Each finding carries a `category`, and the category alone decides what the finding makes of
  its step (`scenarioFindingStatus`, which the referee uses too). `not-recorded`, `single-observation`,
  `declared-not-shown`, `not-completed` and `other-origin` are gaps: `unknown`. `repeats-differ` and
  `undeclared-volatile` are one side disagreeing with itself: `unstable`; `undeclared-volatile` is emitted for the
  left side only. Every other category is a difference between the sides, `changed`: the comparer's own `value`,
  `status`, `shape` (an honoured volatile field whose shape differs) and `missing-step`, and any category
  `compareAnswers` reports for a reply body. A step's findings are listed most severe first.
- **Behaviour table.** `behavior/<scenario>.json` shows a JSON request body, a JSON string included, as
  `{kind: "json", value}`, a body that was sent and not recorded as `{kind: "not-recorded"}`, and each step's
  `volatile_pointers`: the reply leaves the original's captures disagree on.

## What done means

`evaluate-clone-run` runs eight checks (`CLONE_RUN_CHECKS`). `done` needs all of them to pass.

1. **scope**: `target.json` is valid and carries the authorisation statement; the clone's name contains none of the
   original's names; every exclude can match and every declared material directory exists and can be read; the two
   addresses are not one address (below); the run folder is not the clone root or inside it (both paths
   symlink-resolved); the clone root exists; every entry under it can be read; no symlink leaves it, enters an
   exclude or fails to resolve.
2. **inputs**: every authored file passes its schema; there is at least one scenario and one obligation file. Beyond
   the schemas: a base name is an identifier and an unknown is named `<role>-<n>`; obligation ids are unique across
   files; each waiver names an existing unknown or an existing inferred obligation, and each `closed` entry an
   existing unknown and an existing observed obligation; each volatile field names an existing scenario and a step
   of it, or `*` for every step.
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
   (default `scout/` in the run folder; material reached through a link is read at its real path) or of a reply body
   an admitted original capture recorded (`reply_bodies`); no entry of `target.original.names` occurs, ignoring ASCII
   case, in a clone file's bytes, its relative path or a link's text. Excludes apply. A name is matched as a plain
   substring, so the lead declares distinctive names: one that also occurs in a route or a field name can never be
   satisfied. The check covers names and identical files only, and its messages say so (residual trust 10).
8. **unknowns**: every `unknowns/` file is waived or closed.

Address identity. A host name cannot be classified by its spelling, so the application layer resolves both addresses
at init and at every evaluation (`resolveCloneRunAddress`) and the domain function `cloneRunAddressRelation` judges
the result. One trailing dot is stripped and IP literals are normalised (an IPv4-mapped IPv6 address to IPv4). Every
loopback and unspecified address and every address of this machine's own interfaces is `CLONE_RUN_THIS_MACHINE`; any
other host name is the set of addresses the system resolver gives for it. Two addresses are one when their ports are
equal and their host sets intersect. The scheme decides nothing: one port of one host is one listener. With equal
ports and a host that does not resolve, identity is unknown and blocks like one address, with a message that says so.
A proxy or a port forward is not detected (residual trust 5).

The checks do not wait for one another. With no clone yet, the referee still renders the original's inputs, admits its
Evidence, judges its start state and writes `behavior/` from the first admitted capture, so the prober and the spec
writer work before a builder starts. A check is `pass` when it was computed for every scenario and found nothing,
`fail` when it has a finding, and `not_evaluated` otherwise (parity before both sides are admitted; every check that
needs `target.json` when it is refused). A `target.json` that is refused writes only `gate.json` and the journal
line: `rendered/`, `records/`, `behavior/` and `parity/` are left as they were, and the item's command uses the
`rea_command` the refused file states when it states one.

Obligations: `{id, statement, basis: "observed" | "inferred", cases: [{scenario, step_ids}]}`. An observed obligation
cites at least one case.

Unknowns and waivers. A worker proposes an unknown as a file `{statement}`. Only the lead settles one, in
`waivers.json`: a waiver `{kind: "unknown" | "obligation", id, person, reason}` needs a named person and a reason, and
`closed` `{unknown, obligation}` needs an observed obligation whose cited steps are all `unchanged`. Waivers cover
unknown proposals and inferred obligations, nothing else: a step whose data is missing blocks until a capture records
it or the prober renames it `setup-`. With one or more waivers applied the verdict is `done_with_waivers` and
`summary` reads `done with N waivers`. An unknown about something REA's actions cannot produce (a request body that is
not well-formed JSON) has the same two exits and no third: a headless run reports it and ends `not_done`.

### Reason codes

`CLONE_RUN_REASONS` is the only list. Capture reasons go to the prober on the original side and the verifier on the
clone side. A finding can name another role than its reason's own when the remedy is another role's; the last
column lists those.

| Check       | Codes                                                                                                        | Role                              | Also addressed to                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------- |
| scope       | `target_invalid`, `addresses_not_distinct`, `run_folder_inside_clone`                                        | lead                              |                                                         |
| scope       | `clone_root_missing`, `clone_symlink_outside_root`, `clone_path_unreadable`                                  | builder                           |                                                         |
| inputs      | `no_scenarios`, `scenario_invalid`                                                                           | prober                            |                                                         |
| inputs      | `no_obligations`, `obligation_invalid`                                                                       | spec writer                       |                                                         |
| inputs      | `unknown_invalid`, `intended_differences_invalid`, `waivers_invalid`                                         | lead                              |                                                         |
| evidence    | `evidence_missing`, `evidence_scenario_mismatch`, `evidence_rejected_integrity`, `evidence_rejected_address` | prober or verifier                |                                                         |
| evidence    | `evidence_stale`                                                                                             | verifier                          |                                                         |
| clean_start | `start_state_dirty`, `start_state_unknown`                                                                   | prober or verifier                | the prober, for a text-only dirty start on either side  |
| coverage    | `step_uncited`, `obligation_step_unknown`                                                                    | spec writer                       |                                                         |
| coverage    | `obligation_inferred`                                                                                        | prober                            |                                                         |
| parity      | `parity_changed`                                                                                             | builder                           | the lead, when a rename settles the difference          |
| parity      | `parity_unknown`                                                                                             | prober or verifier                | the prober, when the remedy is the scenario or original |
| parity      | `parity_unstable`                                                                                            | lead (original), verifier (clone) | the prober, when no declaration can cover it            |
| clean_room  | `clean_room_identical_file`, `clean_room_forbidden_name`                                                     | builder                           |                                                         |
| unknowns    | `unknown_open`                                                                                               | lead                              |                                                         |

### The worklist

`gate.json` carries `blocking` (every reason with its total) and `next`: at most ten items in check order, then reason
order, scenario and step. While no scenario exists, `clone_root_missing` sorts after the inputs reasons, so the first
item of a new run is the prober's and not the builder's. When findings are left out, `summary` says so (`not done: 14
blocking findings; next lists the first 10 and leaves out 4`). Each item has `role`, `reason`, `file`, `command` and `message`; parity items add `scenario`,
`step_id`, `dimension`, `pointer`, `expected` (original) and `actual` (clone), one item per step with its most severe
finding. Steps of one scenario whose most severe finding is one and the same (dimension, category, request, pointer, both
values and side) collapse into one item that lists them in `step_ids` (two or more; `step_id` is the first); `blocking` counts each step. `command` is the
exact command to run:

- a capture: `[REA_BROWSER_NO_SANDBOX=true ]timeout <capture_timeout_seconds> <rea_command> capture-browser-scenario
'<run>/rendered/<side>/<scenario>.json' --detail summary --evidence_output
'<run>/evidence/<side>/<scenario>/run-<N>.json' --json`. One item per missing capture, each with its own free `N`,
  for `evidence_missing`, `evidence_stale` and `evidence_scenario_mismatch`. One more capture also serves
  `start_state_unknown` and a `parity_unknown` whose finding is `not-recorded` or `single-observation` on that side;
  those items of one side and scenario carry the same command. A `declared-not-shown` finding carries the original's
  capture command, whichever side it was found on. The message gives the side's reset command when `target.json`
  records one, says for a reply body that captures fold and for any other dimension that only a reply body does, and
  says that data still missing after another capture will not arrive (a body over the body limit, the body of a
  download);
- a removal: `rm '<file>'…` for each rejected Evidence file (`rm -r` for a directory); for `start_state_dirty` the
  side's captures outside its largest group of equal fingerprints, or all of them on a tie; and for `parity_unstable`
  on the clone every admitted clone capture of the scenario, because captures fold and a new capture cannot outvote
  an old one;
- everything else: `<rea_command> evaluate-clone-run '<run>' --exit-code`, to run after the edit the message asks for.

Who is told what. A `repeats-differ` finding never tells a builder to change the clone.

- `parity_changed` goes to the builder with `the original gave X, the clone gave Y`, or with a phrase for the
  category when a value is absent; `(nothing)` is never printed. When the two values are equal once one of the
  original's names in another letter case, or the original's address, is replaced (`renamesThatSettle`; values the
  comparer cut to an excerpt are compared as far as both go), the item goes to the lead with file
  `intended-differences.json` and the exact `{"from", "to", "reason"}` entry to add.
- `parity_unstable` on the original goes to the lead with the `volatile_fields` entry to add when the finding is a
  leaf of a JSON reply, and to the prober with file `scenarios/<scenario>.json` when no declaration can cover it
  (on-screen text, a status, a page address, a request line, a text reply). Both messages name the other usual
  cause, something else talking to the instance during a capture: one capture at a time per side.
- `parity_unstable` on the clone goes to the verifier with the removal above. Only if the same difference returns is
  it the builder's or the prober's, and the message says so.
- `parity_unknown` for request events the capture omitted goes to the prober with the scenario file and no capture
  command: another capture omits the same, so the scenario is split. For a step that did not complete, the message
  names the failed step, its Evidence file and why a step of that action fails; a `request` step fails on a redirect.
- `start_state_dirty` caused only by on-screen text at an `fp-` step goes to the prober with the scenario file: the
  text varies by itself, so neither a reset nor a removal helps.

`message` names the path and the fix, and where the fix is a line of JSON it gives the line: the case to add for
`step_uncited`, the `volatile_fields` entry for a `parity_unstable` leaf of the original, the rename for a
`parity_changed` it settles, the waiver for `unknown_open`. A schema failure reads like
`obligations/notes.json /obligations/0/cases: An observed obligation cites at least one case; add
{"scenario": "<id>", "step_ids": ["<step>"]} or set basis to "inferred"`.

### Stall

`stalled` means the team acted and nothing improved. The referee reports it itself, from `journal.jsonl`, through the
pure function `cloneRunStall(journal, state, maxRounds)`. An evaluation appends a line only when its state (blocking
findings, clone tree digest, admitted Evidence ids, judged or not) differs from the last line; a journal that ends in
a partial line is repaired by starting a new line. The digest of the blocking findings is over reason, side, file,
scenario, step, obligation and pointer, so two findings of one reason are told apart.

- A line is **judged** when every scenario had its captures admitted on both sides. Only judged lines count.
  Evaluating one state again, at once or later, concurrently or in sequence, is the same attempt of the same round,
  also when unjudged evaluations lie in between.
- A **round** is a judged clone tree: a judged evaluation starts one when the tree digest differs from the last judged
  one. New captures and edits to the authored files never use up a round.
- Within a round, an **attempt** is a judged state with the same blocking findings from Evidence not judged with them
  before. The second attempt reads `stalled`; when a blocking finding carries a capture or removal command of the
  referee's own, the third does, so the prescribed remedy does not stall on its first try.
- A result that is not a pass reads `stalled` once `round` reaches `target.limits.max_rounds` (8), judged or not.

The gate's `stall` member carries `round`, `max_rounds`, `judged`, `attempts`, `repeated` (two or more attempts) and
`outlook`: a sentence that says where the run stands and what would make the next evaluation read `stalled`, null with
a pass. A stalled summary reads `stalled after N judged round(s) (the same findings were judged K times on the same
clone tree): …` or `… (the limit is N): …`. `stalled` still carries `next`, and the result reads `not_done` again as
soon as a finding or the clone's files change.

## Commands

A refusal exits 1, with or without `--exit-code`, and has no `verdict` member. It has one of two shapes. A refusal the
command itself raises is REA's usual error envelope (`{"error": …, "code": …, "message": …}`) and names the fix. An
argument the command line parser cannot accept is refused before the command runs, as
`{"code": "VALIDATION_ERROR", "message": …, "fieldErrors": [{"path", "expected", "message"}]}` without an `error`
member; `path` is the option's key in camel case (`right`, `originalName.0`, `maxRounds`), not the flag's spelling.
The tables below mark the required options.

### `rea compare-scenario-behavior`

| Flag                         | Meaning                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `--left <file>`              | Required. Capture Evidence of the left side: a record, or a bundle holding one. Repeat per capture; at least one. |
| `--right <file>`             | Required. The same for the right side.                                                                            |
| `--differences <file>`       | An `intended-differences.json`; its renames and volatile fields apply.                                            |
| `--scenario <id>`            | Which scenario's volatile fields apply. Required when the file names more than one.                               |
| `--detail summary\|complete` | `summary` (default) omits unchanged steps.                                                                        |
| `--exit-code`                | Exit by verdict.                                                                                                  |

Result: `scenarioBehaviorComparisonSchema`. Exit without `--exit-code`: 0. With it: 0 `unchanged`, 1 `changed`,
2 `unknown`. Capture files are named with the flags; a positional file is refused.

### `rea init-clone-run <directory>`

| Flag                                                                                     | Meaning                                                                                                    |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `--original <origin>`, `--clone <origin>`                                                | Required. The two addresses, read as text and checked by the target schema and by address identity.        |
| `--clone-root <dir>`, `--clone-name <name>`                                              | Required. Where the clone's source lives and what it is called.                                            |
| `--original-name <name>`                                                                 | Required, repeatable. Names of three characters or more that must not appear in the clone.                 |
| `--authorization <text>`                                                                 | Required. Why the team may study the original.                                                             |
| `--stated-by <person>`                                                                   | Who made the statement.                                                                                    |
| `--browser <path>`                                                                       | Chromium executable. Default `REA_BROWSER_EXECUTABLE`; refused if neither.                                 |
| `--browser-no-sandbox`                                                                   | Default: whether `REA_BROWSER_NO_SANDBOX` is `true`.                                                       |
| `--exclude <path>`                                                                       | Repeatable. Replaces the default excludes. Relative whole segments; an entry that cannot match is refused. |
| `--material <dir>`                                                                       | Repeatable. Replaces the default original material (`scout`).                                              |
| `--original-start`, `--original-reset`, `--original-stop`, `--original-health <command>` | Recorded for the team; REA never runs them.                                                                |
| `--clone-start`, `--clone-reset`, `--clone-stop`, `--clone-health <command>`             | The same for the clone.                                                                                    |
| `--rea-command <command>`                                                                | How worklist commands spell the CLI. Default `rea`.                                                        |
| `--max-rounds <n>`, `--capture-timeout-seconds <n>`                                      | Defaults 8 and 120. A round is a judged clone tree ([Stall](#stall)).                                      |

The directory must be absent or empty and outside the clone root, the two addresses must not be one address as scope
requires, and the clone's name must not contain an original name. Nothing is overwritten. It writes `target.json`,
`intended-differences.json` (one rename per original name to the clone name, reason `product name`), `waivers.json`
(empty lists), the empty directories, and `examples/`. Result: `cloneRunInitResultSchema`: `created`, `authored` (five
entries: `scenarios/<scenario>.json` twice, once per example, `obligations/<area>.json`, `unknowns/<role>-<n>.json`
with no `role`, because any role writes one, and `scout/<crawl>.json`), and `next`, the referee's own first worklist
for the new folder, computed by the same evaluation and not written by hand. Exit 0.

### `rea evaluate-clone-run <directory>`

One flag, `--exit-code`. It reads the folder, never starts, stops or resets a target, rewrites its outputs and prints
`gate.json` (`cloneRunGateSchema`). A missing directory or `target.json` is a refusal; every other problem is a finding.
Exit without `--exit-code`: 0, whatever the verdict. With it: 0 `done` or `done_with_waivers`, 1 `not_done`,
2 `stalled`. Every worklist command passes the flag.

## What an agent still writes

Init scaffolds `target.json`, `intended-differences.json` and `waivers.json` from flags. Agents author three kinds of
file. Init writes each example below to `examples/`, and each must parse with its schema. It writes two more:
`scenario-pages.example.json`, a scenario of page steps (a `goto` with `{origin}`, a fill, a select, a click that
waits for its reply with `save_response`, a `wait_for` on a notice), and `crawl.example.json`, a complete input for
`capture-browser-scenario` that the scout copies to `scout/`: `goto` steps at the original's address, the page
address and accessibility text after each step, and request and reply bodies on.

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
`{"scenario": "notes-api", "step_id": "*", "pointer": "/items/*/createdAt", "reason": "creation time"}` (`step_id` names
one step, or `*` for every step of the scenario) and a waiver
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
3. `rea setup` under a throwaway `HOME` installs `references/clone-runs.md`, and `rea guidance --query` returns
   sections of it for `clone a web application`, `clone parity`, `judged round stalled` and `clone run <role>` for
   each of the seven roles.

## Non-goals

- Starting, stopping or resetting a target. That needs a scope decision that has not been made.
- Changes to what the capture commands record or accept. A reply no capture recorded is `unknown`. Deferred to
  milestone 2 ("trustworthy captures"), each a stated limit until then: text inside same-origin iframes, dialog text,
  the document title, a raw request body so that malformed input can be probed, a click or press that waits for a
  reply of any status, the roles `status`, `alert` and `heading` in role locators, the bodies of downloads, bodies
  lost under `Cache-Control: no-store`, the capture step deadline and body limits, and an automatic census of routes.
- A measure of similarity between clone files and the original's scripts, and an enforced wall between scout output
  and builders. Both belong to milestone 3 with the packaged crew; until then the clean-room check covers names and
  identical files only.
- Targets that serve their application from more than one origin.
- MCP tool contracts, surface coverage, screenshot comparison, a packaged agent crew, and JavaScript, Electron or
  command-line targets.
- The live agent evaluation of the playbook (the design's `verify:clone-run:live`). It starts a named coding assistant,
  so it follows this build as a separate decision.
