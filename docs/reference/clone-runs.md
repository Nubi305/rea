# Clone runs

A clone run rebuilds a web application as new code under a new name and lets
REA decide whether the rebuild matches. It is a folder on disk and three
CLI-only commands:

- `rea init-clone-run` creates the run folder.
- `rea evaluate-clone-run` is the referee. It recomputes the verdict from the
  folder on every call and prints `done` or a worklist.
- `rea compare-scenario-behavior` compares captures of one scenario taken at
  two addresses. The referee uses the same comparison.

No agent can declare success. A pass comes only from capture Evidence that REA
authenticated and compared in the same evaluation, bound to the clone's files
as they are now. The commands have no MCP tools.

The team that works from the folder is described in the
[clone runs playbook](https://github.com/morluto/rea/blob/main/.agents/skills/reverse-engineer-anything/references/clone-runs.md)
of the REA skill: seven role cards that one agent plays in turn or several
play in parallel. The
[specification](../specs/reconstruction/clone-runs/spec.md) records every
rule, including the ways to a false pass and what stops each.

## Scope

A clone run is for a web application you can run and reset locally, served
from one origin, and for which you can state that you may study it. The team
writes new code for observed behavior. Nothing here gets past DRM, a license
check, anti-cheat, a packer or a sign-in, and the referee refuses `done` when
it finds a copied file or the original's name in the clone. REA never starts,
stops or resets either application; it records the commands you give so the
team can run them.

## Create a run

```sh
rea init-clone-run /work/runs/notes \
  --original http://127.0.0.1:4100 \
  --clone http://127.0.0.1:4200 \
  --clone-root /work/plain-jotter \
  --clone-name "Plain Jotter" \
  --original-name "Acme Notes" \
  --authorization "We own Acme Notes and are replacing its codebase." \
  --stated-by "A. Person" \
  --browser /usr/bin/chromium \
  --original-reset "./ops/reset-original.sh" \
  --clone-reset "./ops/reset-clone.sh" \
  --json
```

The directory must be absent or empty and outside the clone's source. The two
addresses must differ; every loopback name counts as one host, so
`http://localhost:4100` and `http://127.0.0.1:4100` are one address. The
clone's name must not contain an original name. A refusal prints REA's error
envelope and exits `1`; nothing is overwritten.

The command writes `target.json`, `intended-differences.json` with one rename
per original name, an empty `waivers.json`, the empty directories and
`examples/`. Its result lists the files agents still write, each with its role
and a valid example, and the first worklist. `--browser` defaults to
`REA_BROWSER_EXECUTABLE`, and `--browser-no-sandbox` to whether
`REA_BROWSER_NO_SANDBOX` is `true`. `rea init-clone-run --help` lists the
remaining flags: the start, stop and health commands of each side, excludes,
material directories, limits and how worklist commands spell the CLI.

## The run folder

One folder per run. Each file has one writer.

| Path                                    | Writer                          | Holds                                                         |
| --------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| `target.json`                           | `init-clone-run`, then the lead | addresses, names, clone root, excludes, team commands, limits |
| `intended-differences.json`             | lead                            | renames and volatile fields                                   |
| `waivers.json`                          | lead                            | waivers and closed unknowns                                   |
| `scenarios/<scenario>.json`             | prober                          | one address-free scenario                                     |
| `obligations/<area>.json`               | spec writer                     | rules and the steps that show them                            |
| `unknowns/<role>-<n>.json`              | the role in the name            | one statement of what is not established                      |
| `specs/`, `scout/`, `surfaces.json`     | spec writer, scout, mapper      | free form; `scout/` holds what was taken from the original    |
| `evidence/<side>/<scenario>/run-N.json` | `capture-browser-scenario`      | capture Evidence; `<side>` is `original` or `clone`           |
| `examples/`                             | `init-clone-run`                | a valid example of each authored file                         |
| `rendered/<side>/<scenario>.json`       | referee                         | the capture input for that side                               |
| `records/<side>/<scenario>.json`        | referee                         | what was decided about each Evidence file                     |
| `behavior/<scenario>.json`              | referee                         | the original's behavior per step, without addresses           |
| `parity/<scenario>.json`                | referee                         | the comparison of the two sides                               |
| `journal.jsonl`                         | referee                         | one line per changed state, for stall detection               |
| `gate.json`                             | referee                         | the last verdict and worklist                                 |

The referee rewrites its six outputs on every evaluation and never reads a
verdict back from them. A `gate.json` on disk is a copy of the last result,
not a result. A file's base name is its id: a scenario, an obligation area
and an unknown are named by their files and do not repeat the name inside.

### Authored files

A scenario is address-free. Its actions are those of
`rea capture-browser-scenario`. A `request` step takes a path. A `goto` step
writes `{origin}` at the start of its URL, such as `{origin}/notes`, and the
referee replaces it with each side's address. Step ids decide what a step is
for: `fp-` steps are the fingerprint that reads the state a clean start shows
and come first; `setup-` steps prepare and are not cited; every other step is
a behavior step that an obligation must cite and that must match.

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

An obligation is one rule and the recorded steps that show it. A rule no step
shows has basis `inferred` and blocks until a step shows it or it is waived.

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

An unknown is one statement, in a file named for the role that wrote it, such
as `unknowns/prober-1.json`:

```json
{
  "statement": "Whether titles are limited by characters or bytes was not probed."
}
```

## Evaluate

```sh
rea evaluate-clone-run /work/runs/notes --exit-code --json
```

The command reads the folder, rewrites its outputs and prints the gate. With
`--exit-code` it exits `0` for `done` or `done_with_waivers`, `1` for
`not_done` and `2` for `stalled`. Without the flag it exits `0` whatever the
verdict. A missing directory or `target.json` is a refusal with exit `1` and
no `verdict` member; every other problem is a finding.

The gate carries the verdict, a one-line `summary`, the status of each check,
`blocking` (every reason with its total) and `next`: at most ten items, each
with the role that acts, the reason code, the file, a message that names the
fix, and the exact command to run. A parity item also names the step and both
values:

```json
{
  "role": "builder",
  "reason": "parity_changed",
  "file": "/work/plain-jotter",
  "command": "rea evaluate-clone-run '/work/runs/notes' --exit-code",
  "message": "Step create-long-title of scenario notes-api differs from the original at body /slug of POST /api/notes#1: the original gave \"the-quick-brown-fox-jump\", the clone gave \"the-quick-brown-fox\". behavior/notes-api.json shows what the original does. Change the clone, restart it, have it captured again, then run the command.",
  "side": "clone",
  "scenario": "notes-api",
  "step_id": "create-long-title",
  "dimension": "body",
  "pointer": "/slug",
  "expected": "\"the-quick-brown-fox-jump\"",
  "actual": "\"the-quick-brown-fox\""
}
```

When more than ten findings block, `summary` says how many `next` leaves out;
`blocking` always counts them all.

The command of a capture item is complete: it runs `capture-browser-scenario`
on the rendered input under an outer `timeout` and writes the next free
`run-N.json` into a directory the referee has already created. Reset the
application before running it. The command of a rejected Evidence file, and
of captures that began from different states, is the `rm` that removes them.

The clone's capture input carries a digest of the clone's files. The order on
the clone side is therefore: evaluate, restart the clone, capture from
`rendered/clone/`, evaluate. Any edit to a clone file that is not excluded
makes earlier clone captures stale.

The checks do not wait for one another. Before a clone exists, the referee
still renders the original's inputs, admits its captures, judges its start
state and writes `behavior/`.

## What done means

`done` needs all eight checks to pass.

1. **scope**: `target.json` is valid and carries the authorization statement,
   the two addresses differ, the run folder is outside the clone root, the
   clone root exists and no symlink leaves it.
2. **inputs**: every authored file passes its schema, and there is at least
   one scenario and one obligation file.
3. **evidence**: every scenario has at least two admitted captures per side.
   A capture is admitted when REA authenticates it, it started at the side's
   address, and it replays the input the referee renders now. On the clone
   side that input is bound to the clone's current files.
4. **clean_start**: the fingerprint steps observed the same state in every
   admitted capture of a side.
5. **coverage**: every behavior step is cited, every obligation cites steps
   that completed on the original, and no obligation is inferred unless
   waived.
6. **parity**: every behavior step is `unchanged`, and no setup or
   fingerprint step is `changed`.
7. **clean_room**: no clone file of 64 bytes or more equals a file under the
   original's material or a reply body an original capture recorded, and none
   of the original's names occurs in a clone file or path.
8. **unknowns**: every unknown is waived or closed.

A check that could not be computed yet reads `not_evaluated`.

### Reason codes

Every blocking finding carries one reason code. Capture reasons go to the
prober on the original side and to the verifier on the clone side.

| Reason                         | Check       | Role                             | Meaning                                                                    |
| ------------------------------ | ----------- | -------------------------------- | -------------------------------------------------------------------------- |
| `target_invalid`               | scope       | lead                             | `target.json` fails its schema, or the clone's name holds an original name |
| `addresses_not_distinct`       | scope       | lead                             | both sides resolve to one address                                          |
| `run_folder_inside_clone`      | scope       | lead                             | the run folder is the clone root or inside it                              |
| `clone_root_missing`           | scope       | builder                          | the clone root does not exist                                              |
| `clone_symlink_outside_root`   | scope       | builder                          | a symlink leaves the clone root or enters an excluded path                 |
| `no_scenarios`                 | inputs      | prober                           | no scenario file                                                           |
| `scenario_invalid`             | inputs      | prober                           | a scenario fails its schema or cannot be rendered                          |
| `no_obligations`               | inputs      | spec writer                      | no obligation file                                                         |
| `obligation_invalid`           | inputs      | spec writer                      | an obligation file fails its schema                                        |
| `unknown_invalid`              | inputs      | lead                             | an unknown file fails its schema or its name                               |
| `intended_differences_invalid` | inputs      | lead                             | a declaration fails its schema or names nothing                            |
| `waivers_invalid`              | inputs      | lead                             | a waiver lacks a person or a reason, or names nothing                      |
| `evidence_missing`             | evidence    | prober or verifier               | fewer admitted captures than required                                      |
| `evidence_stale`               | evidence    | verifier                         | clone captures were made for other clone files                             |
| `evidence_scenario_mismatch`   | evidence    | prober or verifier               | captures replay another scenario or another version of it                  |
| `evidence_rejected_integrity`  | evidence    | prober or verifier               | a file is not authentic capture Evidence; remove it                        |
| `evidence_rejected_address`    | evidence    | prober or verifier               | a capture started at another address; remove it                            |
| `start_state_dirty`            | clean_start | prober or verifier               | two captures of a side began from different states                         |
| `start_state_unknown`          | clean_start | prober or verifier               | a fingerprint observation is missing                                       |
| `step_uncited`                 | coverage    | spec writer                      | a behavior step is cited by no obligation                                  |
| `obligation_step_unknown`      | coverage    | spec writer                      | a case cites a step that cannot be cited                                   |
| `obligation_inferred`          | coverage    | prober                           | an inferred obligation is not waived                                       |
| `parity_changed`               | parity      | builder                          | the clone differs from the original at a step                              |
| `parity_unknown`               | parity      | prober or verifier               | data needed to compare a step was not recorded                             |
| `parity_unstable`              | parity      | lead (original), builder (clone) | a side disagrees with itself between repeats                               |
| `clean_room_identical_file`    | clean_room  | builder                          | a clone file equals a file of the original                                 |
| `clean_room_forbidden_name`    | clean_room  | builder                          | one of the original's names occurs in the clone                            |
| `unknown_open`                 | unknowns    | lead                             | an unknown is neither waived nor closed                                    |

### Waivers and declarations

Only the lead writes `waivers.json` and `intended-differences.json`.

A waiver names a person and a reason, which REA records and cannot verify. It
covers an unknown or an inferred obligation and nothing else: a difference,
missing data and an unstable step cannot be waived. With a waiver applied the
verdict is `done_with_waivers` and the summary reads `done with N waivers`.

```json
{
  "waivers": [
    {
      "kind": "unknown",
      "id": "prober-1",
      "person": "A. Person",
      "reason": "Titles over 200 bytes are out of scope for the first release."
    }
  ],
  "closed": []
}
```

A rename replaces the original's text with the clone's before on-screen text
and string values are compared. A volatile field names one reply field that
the original itself changes between clean repeats; it is honored only where
the original's captures really differ, and its shape is still compared.

```json
{
  "renames": [
    { "from": "Acme Notes", "to": "Plain Jotter", "reason": "product name" }
  ],
  "volatile_fields": [
    {
      "scenario": "notes-api",
      "step_id": "create-ok",
      "pointer": "/createdAt",
      "reason": "creation time"
    }
  ]
}
```

The gate lists the renames that took effect and counts the honored volatile
fields under `declared`, and repeats the addresses and the clone root under
`target`, so a reader can see what the verdict was computed for.

### Stall

The referee appends a line to `journal.jsonl` whenever its state differs from
the last line. A `not_done` result becomes `stalled` when the judged rounds
reach `max_rounds` in `target.json`, or when two judged rounds in a row have
the same blocking findings and the same clone files. A stalled result still
carries `next`.

## Compare captures directly

```sh
rea compare-scenario-behavior \
  --left /work/runs/notes/evidence/original/notes-api/run-1.json \
  --left /work/runs/notes/evidence/original/notes-api/run-2.json \
  --right /work/runs/notes/evidence/clone/notes-api/run-1.json \
  --right /work/runs/notes/evidence/clone/notes-api/run-2.json \
  --differences /work/runs/notes/intended-differences.json \
  --scenario notes-api \
  --exit-code --json
```

Each side takes one or more capture Evidence files of the same scenario. The
address is ignored: steps are aligned by step id and compared on the step's
outcome, its requests, each status, each reply body (JSON by pointer), the
page address and the on-screen text after renames. Each step is `unchanged`,
`changed`, `unknown` or `unstable`:

- `changed`: the two sides differ where the left side is steady.
- `unknown`: data needed for the comparison was not recorded on a side.
  Missing data never counts as a match. Repeats fold, so another capture can
  supply a body one capture lost; a reply over the capture's body limit is
  never recorded.
- `unstable`: a side disagrees with itself between its repeats and no
  honored declaration covers the field.

With `--exit-code` the command exits `0` for `unchanged`, `1` for `changed`
and `2` for `unknown`, which includes unstable steps. Without it the command
exits `0`. `--detail complete` also lists the unchanged steps. The command
reads files only and makes no network call.

Each finding of a step names the `dimension`, a `category`, the request, the
JSON pointer, the `expected` (left) and `actual` (right) value and the side.
`limitations` says what the result cannot show. With one capture on a side
nothing shows which of its values are steady, so a field that differs only
the way a clock does reads `unknown`; a rename is applied to the left side
only, so two captures of one application differ once a rename takes effect.

## What a verdict does not establish

The gate repeats these limits as `residual_trust`.

- The authorization statement, the declarations and a waiver's person are
  recorded as given.
- The verdict covers the steps the scenarios contain. REA cannot tell whether
  they exercise every rule of the original.
- A capture is bound to an address and to the clone's files, not to the
  process that answered. Restart the clone after an edit, before capturing.
- Evidence integrity is an unkeyed content digest. It catches an edited or
  misplaced file, not Evidence forged with REA's own code.
- Excluded clone paths are neither digested nor checked.
- REA does not reset targets. A clean start is inferred from the fingerprint
  steps only.
