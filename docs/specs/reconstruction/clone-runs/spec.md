# Clone runs: a referee and a team playbook for web apps

Status: contract for milestone 1. Nothing here is implemented until [tasks.md](tasks.md) says so.

## Outcome

REA helps an agent understand an application and has nothing that decides whether a rebuild of it matches. This feature
adds a referee and the folder a team works from:

- `rea compare-scenario-behavior` compares captures of one scenario taken at two addresses.
- `rea init-clone-run` creates a run folder; `rea evaluate-clone-run` is the referee. It prints `done` or a worklist
  that says which role does what next.
- `references/clone-runs.md` in the skill holds seven role cards (lead, scout, mapper, prober, spec writer, builder,
  verifier) that one agent plays in turn or several play in parallel.

No agent can declare success. The referee recomputes every verdict from Evidence that REA recorded and authenticated,
and from the clone's files as they are now. The team writes new code for observed behaviour under a new name: nothing
here defeats DRM, licence checks, anti-cheat, packers or logins, and the referee refuses `done` when it finds a copied
file or the original's name in the clone.

All three commands are CLI-only, like `environment-compare`: no MCP tool contract, and the MCP tool list and its
`tools_sha256` do not change. The catalog's `cli_commands` count and `combined_sha256` do, because they cover the CLI
command inventory; both are computed at build time and nothing committed records them.

## Verified facts this contract builds on

Read or run on this branch; builders rely on them and need not re-derive them.

- `capture-browser-scenario --evidence_output <file>` writes an Evidence **bundle** (`{records: [...], ...}`, mode 0600)
  holding the one capture record. It refuses an existing file with exit 1, `code: "invalid_request"`,
  `message: "Evidence file already exists. Choose another output path."`.
- `readEvidenceFileSource(path, options, evidenceId, site)` in `src/application/analysisView/evidenceFileSource.ts`
  reads a record or a bundle and authenticates it. A bundle whose `parameters` were edited fails with
  `EvidenceIntegrityError`.
- The capture record's `parameters` are the scenario REA ran plus `scenario_sha256`, which is
  `digestCanonicalValue(browserScenarioSchema.parse(document), "Browser scenario")`. Recomputing that from the scenario
  file gave the recorded value.
- `normalized_result.scenario.start_origin` is the origin the browser started at. Every entry of
  `normalized_result.steps` records `step_id`, `status` (`completed`, `failed`, `cancelled`) and `after_url`
  (`url` with query and fragment, `origin`, `redacted`), whatever the capture selection. `artifacts.accessibility` is
  `{state: "captured", value: {text}}` only when `capture.after_each_step` selects `accessibility`; otherwise
  `not_requested`. `completeness.status` is `incomplete` (`missing_sections: ["events"]`) on every capture seen,
  including good ones, so it cannot gate.
- Request events carry `step_index` and `resource_type`; `scenarioCaptureRecords` drops both today and names the event
  only by `location.pointer` (`/events/items/N`). `parseCaptureEvidence` returns records without steps or parameters,
  and keeps request bodies only for purpose `"manifest"`.
- `probeRequests(records)` gives each request with the application's answer (`live`), absent when no response was
  recorded and `unobserved: true` when the body was not. `compareAnswers(live, env, new IdMap())` returns categorised
  differences with JSON pointers. With an empty id map and no rules it still treats two clock values of one format as
  equal and counts bodies it could not compare (`normalised.clocks`, `large_bodies`, `unobserved_bodies`) instead of
  reporting them.
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
| `specs/`, `scout/`                      | free form                           | spec writer, scout                                                       |
| `evidence/<side>/<scenario>/run-N.json` | REA Evidence bundle                 | `capture-browser-scenario`, run by prober (original) or verifier (clone) |
| `rendered/<side>/<scenario>.json`       | browser scenario document           | referee                                                                  |
| `records/<side>/<scenario>.json`        | `cloneRunAdmissionRecordSchema`     | referee                                                                  |
| `behavior/<scenario>.json`              | `scenarioBehaviorTableSchema`       | referee                                                                  |
| `parity/<scenario>.json`                | `scenarioBehaviorComparisonSchema`  | referee                                                                  |
| `journal.jsonl`                         | `cloneRunJournalEntrySchema`        | referee                                                                  |
| `gate.json`                             | `cloneRunGateSchema`                | referee                                                                  |
| `examples/*.example.json`               | the authored schemas                | `init-clone-run`                                                         |

`<side>` is `original` or `clone`. The six referee rows are outputs. No verdict reads them back; the one use of an
output is `journal.jsonl` for stall detection, which can only turn `not_done` into `stalled`.

Clean-room wall: builders read `specs/`, `obligations/`, `behavior/` and `gate.json`, never `evidence/` or `scout/`.
In this milestone the wall is a playbook rule; nothing enforces it.

## Trust

- A pass comes only from Evidence that `readEvidenceFileSource` authenticated, admitted as below, and compared by the
  referee in the same run. No file an agent writes can supply one: authored files can declare, cite and block, and
  every declaration is checked against Evidence where Evidence can check it.
- `rendered/`, `records/`, `behavior/`, `parity/` and `gate.json` are rewritten by every evaluation and never read.

Residual trust, stated in `gate.json` as `residual_trust` (`CLONE_RUN_RESIDUAL_TRUST`):

1. The authorisation statement is recorded as given. REA cannot verify it.
2. Evidence integrity is a content digest, not a signature. It detects an edited file, not Evidence forged with REA's
   own algorithm.
3. A capture is bound to an address, not to what answered there. REA cannot prove which program, or which build of the
   clone, was serving when it was captured.
4. Clone Evidence is bound to the tree digest its capture input was rendered for, and that digest equals the tree now.
   An edit that was reverted between the two is not visible.
5. Excluded clone paths are neither digested nor checked for copied files or names.
6. REA does not reset targets. A clean start is inferred from the fingerprint steps only.
7. The journal is the referee's own output. Removing it can hide a stall and cannot produce a pass.

## Scenarios and rendering

A scenario file is address-free: `{scenario, start_path, actions}`. `actions` are `capture-browser-scenario` actions.
Request steps already take a path. A `goto` writes its URL as `{origin}/path`. Step ids starting `rea-` are reserved.

Step ids decide a step's part (`scenarioStepKind`):

- `fp-…`: the fingerprint. At least one, and all of them before any other step.
- `setup-…`, and REA's own `scenario_start`: setup. Compared and reported, never gated, never cited.
- anything else: behaviour. Every such step must be cited by an obligation.

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

Every other member is omitted. On the clone side one more action is appended:
`{"step_id": "rea-tree-<clone tree sha256>", "action": "wait_for_timeout", "duration_ms": 1}`.
The rendered document must pass `browserScenarioSchema`; its issues are reported against the scenario file with that
schema's own messages. The expected digest of a side is `digestCanonicalValue` of the parsed rendered document.

## Admission

For each file under `evidence/<side>/<scenario>/`, in this order:

1. `comparer.readCapture(file)` fails (not authenticated, not one capture record, no step ids):
   `rejected_integrity`.
2. `start_origin`, or the origin of `definition.start_url`, is not the side's address: `rejected_address`. This covers
   a capture taken from the other side's address.
3. `scenario_sha256` equals the side's expected digest: `admitted`.
4. Clone side only: the capture's last action is `rea-tree-<d>`, `d` is not the current tree digest, and rendering with
   `d` gives the capture's `scenario_sha256`: `stale`.
5. Otherwise `scenario_mismatch`: the capture replays another scenario, another version of this one, or other capture
   settings.

So the address binds a capture to its side, and REA's own digest of the scenario it ran binds it to the scenario's
content, the capture settings and, on the clone side, the tree.

A side needs `target.limits.min_captures` admitted captures per scenario (2; the schema refuses less). With fewer, the
finding is `evidence_stale` if the side has stale files, else `evidence_scenario_mismatch` if it has mismatched ones,
else `evidence_missing`. Stale and mismatched files are otherwise harmless: edits make them and captures never
overwrite. Each `rejected_integrity` or `rejected_address` file blocks until its role removes it.

## Staleness

`digestCloneTree(root, exclude)` reads every file under `target.clone.root` except `target.clone.exclude` and returns
`cloneTreeSha256`: the canonical digest of `{tree: "rea.clone-tree/1", files: [[path, kind, sha256], …]}` sorted by
`/`-separated relative path. A symlink contributes its link text and is not followed. An exclude matches whole leading
path segments; the default is `.git` and `node_modules`; `gate.json` lists the excludes that applied.

The binding is the rendered input. Each evaluation digests the tree and renders the clone inputs with that digest in
the `rea-tree-` step. A capture made from that input carries the digest inside `parameters`, which Evidence
authentication covers. Admission then requires the digest in the Evidence to equal the tree as it is at evaluation.
Any edit to any non-excluded clone file, at any time after the input was rendered, including before the first
evaluation that sees the capture, changes the tree digest and makes the capture stale. The verifier's loop is
therefore: evaluate (renders), capture from `rendered/clone/`, evaluate. Residual trust items 3 and 4 say what this
does not prove.

## The comparer

`rea compare-scenario-behavior` takes one or more captures per side. The referee calls the same code through
`ScenarioBehaviorComparer`.

Reuse: `readEvidenceFileSource` authenticates, `parseCaptureEvidence(operation, evidence, "manifest")` validates,
`probeRequests` yields requests and answers, `compareAnswers` is the differ. Step ids reach them through three small
changes owned by this work package: `ScenarioCaptureRecords` gains the step id and resource type of each record (from
the request event's `step_index` and `resource_type`), `ParsedEnvironmentCapture` exposes them with the capture's
steps, start origin and parameters, and `probeRequests` takes the step ids and sets `ProbeStep.step_id`. A HAR has
none; the comparer refuses it.

All captures of one side must list the same step ids in the same order, or the command refuses. Steps are aligned by
step id, taken in the left side's order. A right-only `rea-tree-` step is ignored.

Dimensions per step:

| Dimension      | Recorded today as                                               | Compared                                                 |
| -------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| `step`         | `steps[].status`                                                | outcome                                                  |
| `request`      | request events of the step with type `fetch`, `xhr`, `document` | method, path, query, request body                        |
| `status`       | the matched response's status                                   | exact                                                    |
| `body`         | reply body; JSON for a JSON-like media type                     | JSON by pointer; text whole; not compared for `document` |
| `page_address` | `steps[].after_url`                                             | `url` without its `origin`: path, query and fragment     |
| `text`         | `steps[].artifacts.accessibility.value.text`                    | exact, after renames                                     |

Other resource types (scripts, styles, images, fonts) are not compared in this milestone; each side reports their
count as `ignored_transactions`. Headers are not compared. A screenshot tolerance is milestone 2.

Rules:

- **Transactions** of a step are matched by request line (method, path, query): the k-th occurrence on the left with
  the k-th on the right. An unmatched one is a `request` difference.
- **Renames** (`from` → `to`) are applied to the left side's on-screen text and to JSON string values of its request
  and reply bodies. Never to field names, paths, statuses or page addresses.
- **Repeats fold.** A reply body counts as observed if any capture of that side observed it for that transaction.
- **Missing data is `unknown`, never a match:** no response, a body not observed in any capture, a body the differ
  counted as `large_bodies` or `unobserved_bodies`, text or page address not recorded or redacted, a left step that
  did not complete, a right step that was cancelled.
- **`changed`:** any `compareAnswers` difference; a right step that failed where the left completed; an unmatched
  transaction; a differing page address or text; and any reply leaf that is not exactly equal across sides and is
  stable on the left, even when the differ treated it as equal. The comparer therefore also compares the two replies
  exactly and does not let a normalisation count stand in for equality.
- **`unstable`:** something differs between the repeats of one side and no honoured declaration covers it.
- **Volatile fields.** A declaration `{scenario, step_id, pointer, reason}` (`*` for any array index) is honoured only
  where the left side's repeats really differ at that pointer. An honoured field's value is not compared; its JSON
  type and format still are (the differ's clock format, or equal character classes for other strings). A declaration
  on a field that is stable on the left is ignored. With one left capture nothing can be shown volatile, so a
  normalised difference is `unknown`. Only reply body fields can be declared. A step whose text, status or requests
  vary between repeats must be made deterministic or renamed `setup-`.
- **Fingerprint.** A side's `start_state` is `dirty` when its `fp-` steps differ in any dimension between its
  captures. Declarations do not apply to fingerprint steps.
- A step's status is the worst of its findings: `changed`, then `unstable`, then `unknown`, then `unchanged`. The
  verdict is `changed` if any step is; else `unknown` if any step is `unknown` or `unstable`; else `unchanged`.

## What done means

`evaluate-clone-run` runs eight checks (`CLONE_RUN_CHECKS`). `done` needs all of them to pass.

1. **scope**: `target.json` is valid and carries the authorisation statement; the two addresses differ; the run folder
   is not the clone root or inside it (both paths symlink-resolved); the clone root exists.
2. **inputs**: every authored file passes its schema; there is at least one scenario and one obligation file.
3. **evidence**: admission as above, for every scenario and both sides.
4. **clean_start**: neither side's `start_state` is `dirty`, per scenario.
5. **coverage**: every behaviour step is cited; every cited scenario and step exists in the scenario file and
   completed in an admitted original capture; no obligation is `inferred` unless waived.
6. **parity**: every cited step is `unchanged`, with original as left and clone as right. A `parity_unknown` step
   covered by a waived unknown counts as waived. `changed` and `unstable` cannot be waived.
7. **clean_room**: no clone file of 64 bytes or more has the SHA-256 of a file under `target.original.material`
   (default `scout/` in the run folder); no entry of `target.original.names` occurs, ignoring ASCII case, in a clone
   file's bytes or relative path. Excludes apply.
8. **unknowns**: every `unknowns/` file is waived or closed.

Obligations: `{id, statement, basis: "observed" | "inferred", cases: [{scenario, step_ids}]}`, ids unique across files.
An observed obligation cites at least one case.

Unknowns and waivers. A worker proposes an unknown as a file. Only the lead settles one, in `waivers.json`: a waiver
`{kind: "unknown" | "obligation", id, person, reason}` needs a named person and a reason, and `closed`
`{unknown, obligation}` needs an observed obligation whose cited steps all pass. An unknown with `scenario` and
`step_ids`, once waived, also waives `parity_unknown` on those steps. With one or more waivers applied the verdict is
`done_with_waivers` and `summary` reads `done with N waivers`.

### Reason codes

`CLONE_RUN_REASONS` is the only list. Capture reasons go to the prober on the original side and the verifier on the
clone side.

| Check       | Codes                                                                                                        | Role                             |
| ----------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| scope       | `target_invalid`, `addresses_not_distinct`, `run_folder_inside_clone`                                        | lead                             |
| scope       | `clone_root_missing`                                                                                         | builder                          |
| inputs      | `no_scenarios`, `scenario_invalid`                                                                           | prober                           |
| inputs      | `no_obligations`, `obligation_invalid`                                                                       | spec writer                      |
| inputs      | `unknown_invalid`, `intended_differences_invalid`, `waivers_invalid`                                         | lead                             |
| evidence    | `evidence_missing`, `evidence_scenario_mismatch`, `evidence_rejected_integrity`, `evidence_rejected_address` | prober or verifier               |
| evidence    | `evidence_stale`                                                                                             | verifier                         |
| clean_start | `start_state_dirty`                                                                                          | prober or verifier               |
| coverage    | `step_uncited`, `obligation_step_unknown`                                                                    | spec writer                      |
| coverage    | `obligation_inferred`                                                                                        | prober                           |
| parity      | `parity_changed`                                                                                             | builder                          |
| parity      | `parity_unknown`                                                                                             | prober or verifier               |
| parity      | `parity_unstable`                                                                                            | lead (original), builder (clone) |
| clean_room  | `clean_room_identical_file`, `clean_room_forbidden_name`                                                     | builder                          |
| unknowns    | `unknown_open`                                                                                               | lead                             |

### The worklist

`gate.json` carries `blocking` (every reason with its total) and `next`: at most ten items in check order, then reason
order, scenario and step. Each item has `role`, `reason`, `file`, `command` and `message`; parity items add `scenario`,
`step_id`, `dimension`, `pointer`, `expected` (original) and `actual` (clone), one item per step with its first
finding. `command` is the exact command to run:

- a capture: `[REA_BROWSER_NO_SANDBOX=true ]timeout <capture_timeout_seconds> <rea_command> capture-browser-scenario
  '<run>/rendered/<side>/<scenario>.json' --detail summary --evidence_output
  '<run>/evidence/<side>/<scenario>/run-<N>.json' --json`, one item per missing capture with the next free `N`; the
  message gives the side's reset command when `target.json` records one;
- a rejected Evidence file: `rm '<file>'`;
- everything else: `<rea_command> evaluate-clone-run '<run>' --exit-code`, to run after the edit the message asks for.

`message` names the path and the fix. A schema failure reads like
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

| Flag                                                       | Meaning                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `--original <origin>`, `--clone <origin>`                  | Required. The two addresses.                                               |
| `--clone-root <dir>`, `--clone-name <name>`                | Required. Where the clone's source lives and what it is called.            |
| `--original-name <name>`                                   | Required, repeatable. Names that must not appear in the clone.             |
| `--authorization <text>`                                   | Required. Why the team may study the original.                             |
| `--stated-by <person>`                                     | Who made the statement.                                                    |
| `--browser <path>`                                         | Chromium executable. Default `REA_BROWSER_EXECUTABLE`; refused if neither. |
| `--browser-no-sandbox`                                     | Default: whether `REA_BROWSER_NO_SANDBOX` is `true`.                       |
| `--exclude <path>`                                         | Repeatable. Replaces the default excludes.                                 |
| `--material <dir>`                                         | Repeatable. Replaces the default original material (`scout`).              |
| `--original-start`, `-reset`, `-stop`, `-health <command>` | Recorded for the team; REA never runs them.                                |
| `--clone-start`, `-reset`, `-stop`, `-health <command>`    | The same for the clone.                                                    |
| `--rea-command <command>`                                  | How worklist commands spell the CLI. Default `rea`.                        |
| `--max-rounds <n>`, `--capture-timeout-seconds <n>`        | Defaults 8 and 120.                                                        |

The directory must be absent or empty and outside the clone root. Nothing is overwritten. It writes `target.json`,
`intended-differences.json` (one rename per original name to the clone name, reason `product name`), `waivers.json`
(empty lists), the empty directories, and `examples/`. Result: `cloneRunInitResultSchema`. Exit 0.

### `rea evaluate-clone-run <directory>`

One flag, `--exit-code`. It reads the folder, never starts, stops or resets a target, rewrites its outputs and prints
`gate.json` (`cloneRunGateSchema`). A missing directory or `target.json` is a refusal; every other problem is a finding.
Exit without `--exit-code`: 0. With it: 0 `done` or `done_with_waivers`, 1 `not_done`, 2 `stalled`.

## What an agent still writes

Init scaffolds `target.json`, `intended-differences.json` and `waivers.json` from flags. Agents author three kinds of
file. Init writes each example below to `examples/`, and each must parse with its schema.

`scenarios/notes-api.json` (prober):

```json
{
  "scenario": "notes-api",
  "start_path": "/",
  "actions": [
    {
      "step_id": "fp-health",
      "action": "request",
      "method": "GET",
      "path": "/api/health",
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
  "area": "notes",
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
  "id": "prober-1",
  "role": "prober",
  "statement": "Whether titles are limited by characters or bytes was not probed."
}
```

The lead adds entries to the two scaffolded files, for example a volatile field
`{"scenario": "notes-api", "step_id": "create-ok", "pointer": "/createdAt", "reason": "creation time"}` and a waiver
`{"kind": "unknown", "id": "prober-1", "person": "<name>", "reason": "<why this gap is accepted>"}`.

Schema errors must name the file, the JSON pointer and the fix (`cloneRunFileIssueSchema`), and one evaluation reports
every broken file.

## Acceptance

In this container, with no native provider:

1. `npm run test:local -- src/domain/scenarioBehaviorComparison.test.ts
   src/application/cloneRun/CloneRunEvaluation.test.ts tests/conformance/cloneRunGuidance.test.ts` passes.
2. `npm run verify:clone-run` starts the fixture original, renamed clone and slug mutant on loopback ports, captures
   with real Chromium and shows: matching clone exits 0; mutant exits 1 with a `next` item whose pointer ends in
   `/slug`; one capture per side with an unobserved body is not done; a line appended to a clone file after a pass
   gives `evidence_stale`; an edited Evidence file gives `evidence_rejected_integrity`; a capture from the other side's
   address gives `evidence_rejected_address`; the original's name left in the clone gives `clean_room_forbidden_name`;
   two captures with no reset between them give `start_state_dirty`.
3. `rea setup` under a throwaway `HOME` installs `references/clone-runs.md`, and `rea guidance --query "clone parity"`
   returns matches.

## Non-goals

- Starting, stopping or resetting a target. That needs a scope decision that has not been made.
- Fixing lost response bodies under `Cache-Control: no-store` or the capture step deadline. A lost body is `unknown`.
- MCP tool contracts, surface coverage, screenshot comparison, a packaged agent crew, and JavaScript, Electron or
  command-line targets. A live agent evaluation of the playbook follows this build separately.
