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

The directory must be absent or empty and outside the clone's source. The
clone's name must not contain an original name. The two addresses must not be
one address, which they are when their ports are equal and their hosts reach
a common machine: every loopback name and address, `0.0.0.0` and each address
of this machine's own interfaces count as this machine, any other host name
counts as the addresses the system resolver gives for it, and the scheme
decides nothing. With equal ports and a host that does not resolve, REA
cannot tell and refuses as well. A refusal prints REA's error envelope and
exits `1`; nothing is overwritten.

The command writes `target.json`, `intended-differences.json` with one rename
per original name, an empty `waivers.json`, the empty directories and
`examples/`. Its result lists the files agents still write under `authored`,
each with a valid example, and `next`, which is the referee's own first
worklist for the new folder. `--browser` defaults to `REA_BROWSER_EXECUTABLE`,
and `--browser-no-sandbox` to whether `REA_BROWSER_NO_SANDBOX` is `true`.
`--exclude` names a path under the clone root, relative and matched on whole
leading segments (`node_modules`, `data/app.db`); a pattern, a backslash, an
absolute path or `..` is refused. `rea init-clone-run --help` lists the
remaining flags: the start, stop and health commands of each side, material
directories, limits and how worklist commands spell the CLI.

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
| `examples/`                             | `init-clone-run`                | valid examples: see below                                     |
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

`examples/` holds five files: `scenario.example.json` (request steps),
`scenario-pages.example.json` (page steps: `goto`, fill, select, a click that
waits for its reply, a wait for a notice), `obligations.example.json`,
`unknown.example.json` and `crawl.example.json`, a complete input for
`rea capture-browser-scenario` that visits pages of the original and records
their accessibility text and reply bodies.

### Authored files

A scenario is address-free. Its actions are those of
`rea capture-browser-scenario`. A `request` step takes a path. A `goto` step
writes `{origin}` at the start of its URL, such as `{origin}/notes`, and the
referee replaces it with each side's address. Step ids decide what a step is
for: `fp-` steps are the fingerprint that reads the state a clean start shows
and come first; `setup-` steps prepare and are not cited; every other step is
a behavior step that an obligation must cite and that must match. An id starts
with a letter and holds letters, digits, `.`, `_` and `-`.

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
verdict, so gate on the exit status of a run with the flag and never on a
search of the output for the word done. A missing directory or `target.json`
is a refusal with exit `1` and no `verdict` member; every other problem is a
finding. A `target.json` that cannot be read is the finding `target_invalid`:
the gate and the journal line are written and the other outputs are left as
they were.

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

Steps of one scenario that share one finding are one item: `step_ids` lists
them, `step_id` is the first, and `blocking` still counts each step. When
more findings block than `next` holds, `summary` says how many it leaves out.

The gate also carries:

- `stall`: `round`, `max_rounds`, whether this evaluation was `judged`, the
  `attempts` with these findings on these clone files, and `outlook`, a
  sentence that says what would make the next evaluation read `stalled`. See
  [Stall](#stall).
- `declared`: the renames that took effect, each with the number of compared
  values it changed, and the count of honored volatile fields.
- `target`: the two addresses and the clone root the verdict was computed
  for.
- `clone_tree`: the digest of the clone's files, their count, and the
  excludes that matched a path. When one matched, every `summary` ends with a
  clause such as
  `; 1 clone path is excluded and is covered neither by staleness nor by the clean-room check (node_modules)`.
- `counts`: scenarios, obligations, cited steps, steps by status, Evidence
  files by status, and `ungated_steps`, the setup and fingerprint steps that
  are unknown or unstable and do not block.
- `residual_trust`: what the verdict does not establish. It is listed with
  `done` and `done_with_waivers` and is empty otherwise.

The command of a capture item is complete: it runs `capture-browser-scenario`
on the rendered input under an outer `timeout` and writes the next free
`run-N.json` into a directory the referee has already created. Reset the
application before running it. The command of a rejected Evidence file, of
captures that began from different states and of clone captures that
disagree with each other is the `rm` that removes them. Every other item
carries the evaluation command, to run after the edit its message asks for.

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
   the two addresses are not one, the run folder is outside the clone root,
   the clone root exists, every entry under it can be read, and no symlink
   leaves it, enters an excluded path or fails to resolve.
2. **inputs**: every authored file passes its schema, and there is at least
   one scenario and one obligation file.
3. **evidence**: every scenario has at least two admitted captures per side.
   A capture is admitted when REA authenticates it, it started at the side's
   address, and it replays the input the referee renders now. On the clone
   side that input is bound to the clone's current files. An entry of an
   Evidence directory that is not a file a capture wrote is rejected.
4. **clean_start**: the fingerprint steps observed the same state in every
   admitted capture of a side.
5. **coverage**: every behavior step is cited, every obligation cites steps
   that completed on the original, and no obligation is inferred unless
   waived.
6. **parity**: every behavior step is `unchanged`, and no setup or
   fingerprint step is `changed`.
7. **clean_room**: no clone file of 64 bytes or more equals a file under the
   original's material or a reply body an original capture recorded, and none
   of the original's names occurs in a clone file, a path or a link's text.
   The check covers names and identical files only: it does not detect code
   that was retyped, reformatted or paraphrased.
8. **unknowns**: every unknown is waived or closed.

A check that could not be computed yet reads `not_evaluated`.

### Reason codes

Every blocking finding carries one reason code. Capture reasons go to the
prober on the original side and to the verifier on the clone side.

| Reason                         | Check       | Role                                        | Meaning                                                                    |
| ------------------------------ | ----------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| `target_invalid`               | scope       | lead                                        | `target.json` fails its schema, or the clone's name holds an original name |
| `addresses_not_distinct`       | scope       | lead                                        | both sides are one address, or REA cannot tell                             |
| `run_folder_inside_clone`      | scope       | lead                                        | the run folder is the clone root or inside it                              |
| `clone_root_missing`           | scope       | builder                                     | the clone root does not exist                                              |
| `clone_symlink_outside_root`   | scope       | builder                                     | a symlink leaves the clone root, enters an exclude or does not resolve     |
| `clone_path_unreadable`        | scope       | builder                                     | an entry under the clone root cannot be read                               |
| `no_scenarios`                 | inputs      | prober                                      | no scenario file                                                           |
| `scenario_invalid`             | inputs      | prober                                      | a scenario fails its schema or cannot be rendered                          |
| `no_obligations`               | inputs      | spec writer                                 | no obligation file                                                         |
| `obligation_invalid`           | inputs      | spec writer                                 | an obligation file fails its schema                                        |
| `unknown_invalid`              | inputs      | lead                                        | an unknown file fails its schema or its name                               |
| `intended_differences_invalid` | inputs      | lead                                        | a declaration fails its schema or names nothing                            |
| `waivers_invalid`              | inputs      | lead                                        | a waiver lacks a person or a reason, or names nothing                      |
| `evidence_missing`             | evidence    | prober or verifier                          | fewer admitted captures than required                                      |
| `evidence_stale`               | evidence    | verifier                                    | clone captures were made for other clone files                             |
| `evidence_scenario_mismatch`   | evidence    | prober or verifier                          | captures replay another scenario or another version of it                  |
| `evidence_rejected_integrity`  | evidence    | prober or verifier                          | an entry is not authentic capture Evidence; remove it                      |
| `evidence_rejected_address`    | evidence    | prober or verifier                          | a capture started at another address; remove it                            |
| `start_state_dirty`            | clean_start | prober or verifier                          | two captures of a side began from different states                         |
| `start_state_unknown`          | clean_start | prober or verifier                          | a fingerprint observation is missing                                       |
| `step_uncited`                 | coverage    | spec writer                                 | a behavior step is cited by no obligation                                  |
| `obligation_step_unknown`      | coverage    | spec writer                                 | a case cites a step that cannot be cited                                   |
| `obligation_inferred`          | coverage    | prober                                      | an inferred obligation is not waived                                       |
| `parity_changed`               | parity      | builder, or lead when a rename settles it   | the clone differs from the original at a step                              |
| `parity_unknown`               | parity      | prober or verifier                          | data needed to compare a step is missing                                   |
| `parity_unstable`              | parity      | lead or prober (original), verifier (clone) | a side disagrees with itself between repeats                               |
| `clean_room_identical_file`    | clean_room  | builder                                     | a clone file equals a file of the original                                 |
| `clean_room_forbidden_name`    | clean_room  | builder                                     | one of the original's names occurs in the clone                            |
| `unknown_open`                 | unknowns    | lead                                        | an unknown is neither waived nor closed                                    |

### Who a comparison finding goes to

No message tells a builder to change a clone that has not been shown wrong.

| Finding                                                                 | Role               | Command                               |
| ----------------------------------------------------------------------- | ------------------ | ------------------------------------- |
| The clone differs where the original is steady                          | builder            | evaluate, after the clone is fixed    |
| The two values are equal once the original's name or address is renamed | lead               | evaluate, after the rename it prints  |
| A reply field differs between the original's own captures               | lead               | evaluate, after the declaration       |
| Text, a status, a request line or a text reply differs between them     | prober             | evaluate, after the scenario change   |
| The clone's captures disagree with each other                           | verifier           | `rm` of the clone's captures of it    |
| A reply body was not recorded, or one capture recorded a value          | prober or verifier | one more capture of that side         |
| A field is declared volatile and the original's captures do not vary    | prober             | one more capture of the original      |
| The capture left out requests (its transaction limit)                   | prober             | evaluate, after the scenario is split |
| A step did not complete, or left the side's address                     | prober             | evaluate, after the scenario change   |
| The fingerprint steps differ only in on-screen text                     | prober             | evaluate, after the scenario change   |

Where two roles are named, the prober acts for the original side and the
verifier for the clone side. The item of a step that did not complete names
the failed step, its Evidence file and why that kind of step fails; a
`request` step fails on a redirect.

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

A rename replaces the original's text with the clone's before accessibility
text and string values are compared. It matches one spelling exactly, in file
order. Each side's own address is compared as the same thing, so it needs no
rename. A volatile field names one reply field that the original itself
changes between clean repeats. Its `step_id` is a step or `*` for every step
of the scenario, and a `*` segment of its pointer stands for any one index of
a list. It is honored only where the original's captures really differ, and
its shape is still compared. A declared field whose value the original's
captures all agree on is not ignored and not held against the clone: the step
is `unknown` until the original is captured again or the declaration goes.

```json
{
  "renames": [
    { "from": "Acme Notes", "to": "Plain Jotter", "reason": "product name" }
  ],
  "volatile_fields": [
    {
      "scenario": "notes-api",
      "step_id": "*",
      "pointer": "/items/*/createdAt",
      "reason": "creation time"
    }
  ]
}
```

Each step of `behavior/<scenario>.json` lists under `volatile_pointers` the
reply fields the original's captures disagree on.

### Stall

`stalled` means the team acted and nothing improved. The referee decides it
from `journal.jsonl`, to which it appends a line whenever its state differs
from the last line.

- An evaluation is judged when every scenario has its captures admitted on
  both sides. One that is not judged uses up nothing, and evaluating an
  unchanged folder again adds nothing, whether at once or later.
- A round is a judged set of clone files: a judged evaluation starts a round
  when the clone's files differ from the last judged ones. New captures and
  edits to the authored files never use up a round. A result that is not a
  pass reads `stalled` once `round` reaches `max_rounds` in `target.json`
  (8 by default).
- Within a round, an attempt is a judged evaluation that finds the same
  blocking findings from other admitted Evidence. The second attempt reads
  `stalled`; the third does when a blocking finding carries a capture or a
  removal command, so the referee's own remedy does not stall on its first
  try.

A stalled result still carries `next`, and its summary says why:
`stalled after 1 judged round (the same findings were judged 3 times on the same clone tree): 1 blocking finding`.
It reads `not_done` again as soon as a finding or the clone's files change.

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

`--left` and `--right` are required and repeat once per capture Evidence file
of the same scenario; a file holds one capture, as `--evidence_output` saves
it. The address is ignored: steps are aligned by step id and compared on the
step's outcome, its requests, each status, each reply body (JSON by pointer),
the page address and the accessibility text after renames. Each step is
`unchanged`, `changed`, `unknown` or `unstable`, the worst of its findings.

Each finding names the `dimension`, a `category`, the request, the JSON
pointer, the `expected` (left) and `actual` (right) value and the side. The
category alone decides what the finding makes of its step:

| Category                              | Step       | Meaning                                                                          |
| ------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| `not-recorded`                        | `unknown`  | no capture of the side recorded the data: a reply body, a request body, requests |
| `single-observation`                  | `unknown`  | the left side recorded the value once, so nothing shows whether it is steady     |
| `declared-not-shown`                  | `unknown`  | a declared volatile field is steady on the left and differs on the right         |
| `not-completed`, `other-origin`       | `unknown`  | a step did not complete, or a request or the page went to another origin         |
| `repeats-differ`                      | `unstable` | a side's own captures disagree                                                   |
| `undeclared-volatile`                 | `unstable` | a reply field differs between the left captures and no declaration names it      |
| `value`, `status`, `shape`, any other | `changed`  | the sides differ where the left is steady                                        |

- Missing data never counts as a match. Only a reply body folds across
  captures, so another capture can supply one that a capture lost. A reply
  over the capture's 64 KiB body limit is never recorded, and neither is the
  content of a downloaded file: a step that triggers a download is `unknown`
  on both sides, whatever the file holds. A `request` step for the file's
  address records it and compares it.
- When the right side's captures disagree and one of them equals the left's
  steady value, the only finding is `repeats-differ` on the right, never a
  difference. A request line only the right side sent is a difference only
  when the left's captures all send the same requests.
- The markup of a page the browser navigated to is not compared; any other
  reply it navigated to is. Markup that a `request` step fetched is a text
  reply and is compared whole, so a clone with markup of its own differs
  there: probe a page with `goto` and its accessibility text. A text reply
  that is a JSON object or array on both sides is compared field by field.
  Two lists of the same length are compared item by item at their positions.
- Each side's own start address reads `{origin}` in text, reply strings and
  request bodies, so an application that prints its own address compares
  equal.
- One difference in accessibility text is listed at the first step that
  shows it, often `scenario_start`; `limitations` counts the later steps that
  show the same text.
- `volatile_fields` lists, per step, each field that varies and whether a
  declaration names it (`declared`) and took effect (`honoured`).

With `--exit-code` the command exits `0` for `unchanged`, `1` for `changed`
and `2` for `unknown`, which includes unstable steps. Without it the command
exits `0`. `--detail complete` also lists the unchanged steps. The command
reads files only and makes no network call.

`limitations` says what the result cannot show. With one capture on a side
nothing shows which of its values are steady, so comparing one capture of an
application with another capture of the same application reports each field
that differs between two clean runs as `single-observation`, with both
values. A rename is applied to the left side only, so two captures of one
application differ once a rename takes effect.

## Refusals

A refusal exits `1` with or without `--exit-code` and has no `verdict`
member. A refusal by a command is REA's error envelope with `error`, `code`
and `message`, and names the fix under `remediation`. The command line parser
refuses two things before the command runs, without an `error` member:

- A missing or invalid option, as
  `{"code": "VALIDATION_ERROR", "message": …, "fieldErrors": [{"path": "right", "missing": true, …}]}`.
  `path` is the option's key, so `right` is `--right` and `originalName.0` is
  the first `--original-name`.
- A flag the command does not have, or a positional argument it does not
  take, as `{"code": "UNKNOWN", "message": …}`; the message names the flag
  or the argument. A misspelt `--exit-code`, such as one with an underscore,
  is this refusal and never a pass. The parser also reads an option's key
  in camel case as the flag.

`--help` lists every option and starts the description of a required one with
`Required.`: `--left` and `--right` for the comparison, and `--original`,
`--clone`, `--clone-root`, `--clone-name`, `--original-name` and
`--authorization` for a new run.

## What a verdict does not establish

The gate lists these limits as `residual_trust` with every pass.

- The authorization statement, the declarations and a waiver's person and
  reason are recorded as given. `target.json` is the team's own statement:
  whoever can edit it can retarget the run, and the gate repeats what it
  declared.
- The verdict covers the steps the scenarios contain. REA cannot tell whether
  they exercise every rule of the original, nor whether an obligation's
  statement describes the steps it cites. A deleted step, capture or unknown
  leaves no trace.
- A step is compared on its outcome, its requests, their statuses, fetched
  reply bodies, the page address and the accessibility text. Appearance,
  styles, images, fonts, response headers, the document title and timing are
  not compared. Neither is text inside an iframe, nor the text of an alert,
  confirm or prompt dialog, nor the content of a downloaded file.
- A capture is bound to an address and to the clone's files, not to the
  process that answered. Restart the clone after an edit, before capturing.
  A proxy or a port forward between the two addresses is not detected.
- The clone's file digest covers the path and bytes of every regular file and
  the text of every link. File modes, empty directories and special files are
  not part of it, and an edit that was reverted before the evaluation is not
  visible.
- Excluded clone paths are not digested, so an edit there never makes a
  capture stale, and they are not checked for copied files or names.
- Evidence integrity is an unkeyed content digest. It catches an edited or
  misplaced file, not Evidence forged with REA's own code.
- A rename can declare away any difference in text or a string value, and an
  honored volatile field is compared by shape only.
- The clean-room check covers names and identical files only, for the names
  and the material the run declares and for reply bodies a capture recorded.
- REA does not reset targets. A clean start is inferred from the fingerprint
  steps only.
- The journal is the referee's own output. Removing it can hide a stall and
  cannot produce a pass.
