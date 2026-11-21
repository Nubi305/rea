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
as they are now. The commands have no MCP tools, and the MCP tool list does
not change with them.

This page is the contract: the code's `Contract:` comments and the clone-run
tests point here. The team that works from the folder is described in the
playbook `references/clone-runs.md` of the REA skill, kept in the repository
under `.agents/skills/reverse-engineer-anything/`: seven role cards (lead,
scout, mapper, prober, spec writer, builder, verifier) that one agent plays in
turn or several play in parallel. `rea setup` installs it, and
`rea guidance --query "clone run prober"` finds a card.

## Scope

A clone run is for a web application you can run and reset locally, served
from one origin, and for which you can state that you may study it. The team
writes new code for observed behavior. Nothing here gets past DRM, a license
check, anti-cheat, a packer or a sign-in, and the referee refuses `done` when
it finds a copied file or the original's name in the clone. REA never starts,
stops or resets either application; it records the commands you give so the
team can run them.

A scenario holds only a start path and actions: it cannot carry stored state
or secrets. A sign-in is covered only when the scenario's own steps perform
it, and what they send is then recorded in every capture.

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
clone's name must not contain an original name, and each original name has
three characters or more. The two addresses must not be one address, which
they are when their ports are equal and their hosts reach a common machine:
every loopback name and address, `0.0.0.0` and each address of this
machine's own interfaces count as this machine, any other host name counts as
the addresses the system resolver gives for it, and the scheme decides
nothing. With equal ports and a host that does not resolve, REA cannot tell
and refuses as well. A refusal prints REA's error envelope and exits `1`;
nothing is overwritten.

The command writes `target.json`, `intended-differences.json` with one rename
per original name to the clone's name (reason `product name`), an empty
`waivers.json`, the empty directories and `examples/`. Its result lists the
files agents still write under `authored`, each with a valid example, and
`next`, which is the referee's own first worklist for the new folder,
computed by the same evaluation. It exits `0`.

| Flag                        | Default and rule                                                     |
| --------------------------- | -------------------------------------------------------------------- |
| `--browser`                 | `REA_BROWSER_EXECUTABLE`; refused when neither is set                |
| `--browser-no-sandbox`      | whether `REA_BROWSER_NO_SANDBOX` is `true`                           |
| `--exclude`                 | repeatable; replaces the default `.git` and `node_modules`           |
| `--material`                | repeatable, absolute or relative to the run folder; replaces `scout` |
| `--rea-command`             | how worklist commands spell the CLI; default `rea`                   |
| `--max-rounds`              | default 8; see [Stall](#stall)                                       |
| `--capture-timeout-seconds` | default 120, the outer timeout of each capture command               |

`--original-start`, `--original-reset`, `--original-stop` and
`--original-health`, and the same four for the clone (`--clone-start`,
`--clone-reset`, `--clone-stop`, `--clone-health`), are recorded in
`target.json` and repeated in worklist messages; REA never runs them.
`--exclude` names a path under the clone root, relative and matched on whole
leading segments (`node_modules`, `data/app.db`). An entry that can never
match is refused: white space around it, a backslash, an absolute path, a
pattern character (`*`, `?`, `[`, `]`), a `..` segment, an empty or `.`
segment, or the root itself. `--help` marks the required flags.

## The run folder

One folder per run. Each file has one writer, and agents pass paths and ids
between them, never payloads.

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
| `behavior/<scenario>.json`              | referee                         | the original's behavior per step, as the original gave it     |
| `parity/<scenario>.json`                | referee                         | the comparison of the two sides                               |
| `journal.jsonl`                         | referee                         | one line per changed state, for stall detection               |
| `gate.json`                             | referee                         | the last verdict and worklist                                 |

Each file's schema is in `src/domain/cloneRun/cloneRunSchemas.ts`; the
comparison and the behavior table are in
`src/domain/scenarioBehaviorComparison.ts`.

- The referee rewrites its six outputs on every evaluation and never reads a
  verdict back from them. A `gate.json` on disk is a copy of the last result,
  not a result. The one output it reads is the journal, which can only turn
  `not_done` into `stalled`.
- The outputs of a scenario that no longer exists are removed. An entry of an
  output directory whose name starts with a dot is left alone, because it can
  be a write in flight.
- Evaluations are not serialized: two at once interleave their outputs, so
  one role evaluates at a time. Two evaluations of one state are still one
  round.
- The referee creates the empty `evidence/<side>/<scenario>/` directory of
  every input it renders, because the capture command does not create
  directories.
- A file's base name is its id: a scenario, an obligation area and an unknown
  are named by their files and do not repeat the name inside. A base name is
  an identifier: a letter, then letters, digits, `.`, `_` and `-`.
- The referee does not read `surfaces.json`, `specs/` or `scout/`, except
  that `scout/` is the default original material of the clean-room check.

The clean-room wall: builders read `specs/`, `obligations/`, `behavior/` and
`gate.json`, never `evidence/` or `scout/`. The wall is a rule of the
playbook. Nothing enforces it, and it has been broken: in one recorded run
the clone's client script followed the scripts in `scout/` statement by
statement.

`examples/` holds five files: `scenario.example.json` (request steps),
`scenario-pages.example.json` (page steps: `goto`, fill, select, a click that
waits for its reply, a wait for a notice), `obligations.example.json`,
`unknown.example.json` and `crawl.example.json`, a complete input for
`rea capture-browser-scenario` that visits pages of the original and records
their accessibility text and reply bodies.

### Authored files

Authored files are strict: an unknown member is refused with its path. A
schema failure names the file, the JSON pointer and the fix, such as
`obligations/notes.json /obligations/0/cases: An observed obligation cites at least one case; …`,
and one evaluation reports every broken file.

A scenario is address-free. Its actions are those of
`rea capture-browser-scenario`. A `request` step takes a path. A `goto` step
writes `{origin}` at the start of its URL, such as `{origin}/notes`; that is
the only place the referee replaces with each side's address, and after the
replacement every `goto` must stay on that address. Step ids decide what a
step is for:

- `fp-` steps are the fingerprint that reads the state a clean start shows.
  There is at least one, and all of them come before any other step.
- `setup-` steps, and REA's own `scenario_start`, prepare. They are not cited
  and cannot be cited.
- Every other step is a behavior step that an obligation must cite and that
  must match. There is at least one per scenario.

An `fp-` or `setup-` step is compared too, and [parity](#parity-on-setup-and-fingerprint-steps)
says what blocks there: the prefix never hides a difference. Ids are unique,
start with a letter and hold letters, digits, `.`, `_` and `-`; ids that start
`rea-` are reserved for REA.

`scenarios/notes-api.json`, written by the prober:

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

An obligation is one rule and the recorded steps that show it. An observed
obligation cites at least one case. A rule no step shows has basis `inferred`
and blocks until a step shows it or it is waived. Obligation ids are unique
across files.

`obligations/notes.json`, written by the spec writer:

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

An unknown is one statement, in a file named `<role>-<n>` for the role that
wrote it, such as `unknowns/prober-1.json`, written by any role:

```json
{
  "statement": "Whether titles are limited by characters or bytes was not probed."
}
```

An unknown about an input REA's actions cannot produce, such as a request
body that is not well-formed JSON, has the two exits of any unknown and no
third: a run that cannot ask the user reports it and ends `not_done`.

### Capture inputs

For each scenario and side the referee renders `rendered/<side>/<scenario>.json`:
the target's browser, `start_url` at the side's address plus `start_path`, the
scenario's actions with `{origin}` replaced, the page address and
accessibility text after each step and at the end, and request and reply
bodies without header values. Every other member is left out, so REA's
default capture limits apply. On the clone side one more action is appended,
a 1 ms wait whose step id is `rea-tree-` and the digest of the clone's files.
The rendered input must pass the capture command's own schema, and its issues
are reported against the scenario file. A side's expected digest is
`scenario_sha256` of that input.

## Admission

Each entry under `evidence/<side>/<scenario>/` whose name does not start with
a dot gets one status, in path order:

1. `rejected_integrity`: the entry is not a regular file, or it is not one
   authenticated capture with step ids. A link or a directory is never read
   through.
2. `rejected_address`: the capture started at another address than the
   side's, such as the other side's.
3. `admitted`, or `duplicate` when an earlier file of this side and scenario
   holds the same Evidence id: the capture replays the side's rendered input.
   A copied capture is not a repeat.
4. `stale`, on the clone side only: the capture replays an input rendered for
   other clone files.
5. `scenario_mismatch`: the capture replays another scenario, another version
   of this one, or other capture settings.

A side needs `min_captures` admitted captures per scenario (2; the schema
refuses less). With fewer, the finding is `evidence_stale` if the side has
stale files, else `evidence_scenario_mismatch` if it has mismatched ones,
else `evidence_missing`. Duplicate, stale and mismatched files are otherwise
harmless. Each rejected entry blocks until its role removes it. The next free
`run-N.json` skips every existing entry, so a printed capture command never
meets one. A directory under `evidence/<side>/` that names no scenario is
ignored.

## Staleness

The referee digests the clone's files at every evaluation: the path and bytes
of every regular file and the text of every link, sorted by path, outside the
excludes. File modes, empty directories and special files are not part of the
digest. A file that vanishes during the walk is skipped; an entry that cannot
be read, or whose name is not valid UTF-8, blocks with
`clone_path_unreadable`.

The binding is the rendered input. The clone's input carries the digest, the
capture records the input inside its authenticated parameters, and admission
requires that digest to equal the files as they are at evaluation. Any change
to a clone file that is not excluded, at any time after the input was
rendered, makes the capture stale. The order on the clone side is therefore:
evaluate, restart the clone, capture from `rendered/clone/`, evaluate. A
clone that writes under its own root while it runs (a database, a log, a
build cache) makes every capture stale until the lead excludes those paths;
the `evidence_stale` message says so.

`clone_tree.exclude` in the gate lists the declared excludes that matched a
path, and whenever one matched, every `summary` ends with a clause such as
`; 1 clone path is excluded and is covered neither by staleness nor by the clean-room check (node_modules)`,
so a pass with a matched exclude never reads `done` alone.

A symlink contributes its text and is not followed. One whose target lies
outside the root or under an exclude, or cannot be resolved while the referee
runs, blocks with `clone_symlink_outside_root` until it is removed or its own
path is excluded. A link's text leaves the root when it is an absolute path or
rises above the root at any point, walked segment by segment from the link's
directory, also when it comes back in by the root's own name.

## Evaluate

```sh
rea evaluate-clone-run /work/runs/notes --exit-code --json
```

The command reads the folder, never starts, stops or resets a target,
rewrites its outputs and prints the gate. With `--exit-code` it exits `0` for
`done` or `done_with_waivers`, `1` for `not_done` and `2` for `stalled`.
Without the flag it exits `0` whatever the verdict, so gate on the exit
status of a run with the flag and never on a search of the output for the
word done. Every worklist command passes the flag. Write it bare: after `=`
only `true` and `false` are read, and `false` turns the flag off as a `no-`
prefix does. Any other value, such as `--exit-code=1`, is refused as an
argument error and never read as the flag turned off.

### When the referee refuses

A refusal exits `1` and has no `verdict` member. The referee refuses when the
run folder is missing, is not a directory or cannot be read, when it has no
`target.json`, and when it cannot finish reading what it judges: the clone
root cannot be resolved, a clone file or a material file cannot be read
during the name or digest walk, or the comparer refuses a scenario's
captures, such as captures of one side that list different steps. Every
other problem is a finding. A `target.json` that cannot be read or fails its
schema is the finding `target_invalid`: the gate and the journal line are
written and the other outputs are left as they were. Its items use the
`rea_command` the file states when it states one; otherwise they spell the
command the way this evaluation was started, and say so.

### The gate

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

Items come in check order, then reason order, scenario and step. While no
scenario exists, `clone_root_missing` sorts after the inputs reasons, so the
first item of a new run is the prober's. A parity item carries its step's
most severe blocking finding. Steps of one scenario whose most severe finding
is one and the same (dimension, category, request, pointer, both values and
side) are one item: `step_ids` lists them, `step_id` is the first, and
`blocking` still counts each step. When more findings block than `next`
holds, `summary` says how many it leaves out, as in
`not done: 14 blocking findings; next lists the first 10 and leaves out 4`.
Where the fix is a line of JSON the message gives the line: the case to add
for `step_uncited`, the volatile field for an unsteady leaf of the original,
the rename that settles a difference, the `closed` entry for `unknown_open`.
It never gives a waiver.

The gate also carries:

- `stall`: `round`, `max_rounds`, whether this evaluation was `judged`, the
  `attempts` with these findings on these clone files, `repeated`, and
  `outlook`, a sentence that says what would make the next evaluation read
  `stalled`, or, for an evaluation that was not judged, which check kept it
  from being judged. See [Stall](#stall).
- `declared`: the renames that took effect, each with the number of compared
  values it changed; the count of honored volatile fields; and
  `volatile_declarations`, one entry per scenario and declared pointer that
  had any effect. `honoured_steps` counts the steps where the value was not
  compared, `not_shown_steps` the steps where the declaration held a
  difference back because the original's captures agree there, and `steps`
  names up to three of them, those not honored first.
- `target`: the two addresses and the clone root the verdict was computed
  for.
- `clone_tree`: the digest of the clone's files, their count, and the
  excludes that matched a path.
- `counts`: scenarios, obligations, cited steps, steps by status, Evidence
  files by status, and `ungated_steps`, the setup and fingerprint steps that
  are not unchanged and do not block.
- `residual_trust`: what the verdict does not establish. It is listed with
  `done` and `done_with_waivers` and is empty otherwise.

### Worklist commands

Each item's `command` is one of three:

- A capture:
  `[REA_BROWSER_NO_SANDBOX=true ]timeout <capture_timeout_seconds> <rea_command> capture-browser-scenario '<run>/rendered/<side>/<scenario>.json' --detail summary --evidence_output '<run>/evidence/<side>/<scenario>/run-<N>.json' --json`.
  It writes the next free `run-N.json` into a directory the referee has
  already created; reset the application before running it. There is one
  item per missing capture for `evidence_missing`, `evidence_stale` and
  `evidence_scenario_mismatch`, each with its own `N`. One more capture also
  serves `start_state_unknown` and a `parity_unknown` whose finding is
  `not-recorded` or `single-observation` on that side; those items of one
  side and scenario carry the same command. A `declared-not-shown` finding
  carries the original's capture command, whichever side it was found on. A
  reply body that no capture of either side recorded gets no capture command,
  because one more capture records as little.
- A removal, `rm '<file>'…` (`rm -r` for a directory): for a rejected Evidence
  entry; for captures that began from different states, those outside the
  side's largest group of equal fingerprints, or all of them on a tie; for
  clone captures that disagree with each other, every admitted clone capture
  of the scenario, because captures fold and a new one cannot outvote an old
  one; and for the prober's item for captures of the original that disagree,
  every admitted capture of the original.
- Everything else: `<rea_command> evaluate-clone-run '<run>' --exit-code`, to
  run after the edit the message asks for.

The capture and removal commands are POSIX shell lines that need the
`timeout` and `rm` commands. They run as printed on Linux, where they are
tested. A shell without a `timeout` command cannot run the capture command
as printed, and `npm run verify:clone-run` refuses Windows.

The checks do not wait for one another. Before a clone exists, the referee
still renders the original's inputs, admits its captures, judges its start
state and writes `behavior/` from the first admitted capture, so the prober
and the spec writer work before a builder starts.

## What done means

`done` needs all eight checks to pass.

1. **scope**: `target.json` is valid and carries the authorization statement,
   the clone's name contains none of the original's names, every exclude can
   match, every declared material directory exists and can be read, the two
   addresses are not one, the run folder is not the clone root or inside it
   (both paths resolved through links), the clone root exists, every entry
   under it can be read, and no symlink leaves it, enters an excluded path or
   fails to resolve.
2. **inputs**: every authored file passes its schema, and there is at least
   one scenario and one obligation file. Beyond the schemas, base names are
   identifiers, an unknown is named `<role>-<n>`, obligation ids are unique
   across files, each waiver names an existing unknown or inferred
   obligation, each `closed` entry names an existing unknown and an existing
   observed obligation, and each volatile field names an existing scenario
   and a step of it, or `*`.
3. **evidence**: every scenario has at least two admitted captures per side
   ([Admission](#admission)).
4. **clean_start**: the fingerprint steps observed the same state in every
   admitted capture of a side, judged once the side has its captures.
5. **coverage**: every behavior step is cited, every case names an existing
   scenario and behavior steps of it, each of which completed in every
   admitted capture of the original, and no obligation is inferred unless
   waived.
6. **parity**: with the original as left and the clone as right, every
   behavior step is `unchanged`, so every finding blocks it. What blocks on a
   setup or fingerprint step is [below](#parity-on-setup-and-fingerprint-steps).
   No parity finding can be waived.
7. **clean_room**: no clone file of 64 bytes or more equals a file under the
   original's material or a reply body an admitted original capture recorded,
   and none of the original's names occurs, ignoring ASCII letter case, in
   the bytes of a clone file, in the path of a file or a link, or in a link's
   text. A name is matched as a plain substring, so the lead declares
   distinctive names: one that also occurs in a route or a field name can
   never be satisfied. The name of an empty directory or of a special file is
   not read. Material reached through a link is read at its real path. The
   check covers names and identical files only: it does not detect code that
   was retyped, reformatted or paraphrased.
8. **unknowns**: every unknown is waived or closed.

A check reads `pass` when it was computed for every scenario and found
nothing, `fail` when it has a finding, and `not_evaluated` otherwise: parity
before both sides are admitted, and every check that needs `target.json`
while it is refused.

### Address identity

Both addresses are resolved at init and at every evaluation. One trailing dot
is stripped and IP literals are normalized, an IPv4-mapped IPv6 address to
IPv4. Every loopback and unspecified address and every address of this
machine's own interfaces is this machine; any other host name is the set of
addresses the system resolver gives for it. Two addresses are one when their
ports are equal and their host sets intersect. With equal ports and a host
that does not resolve, identity is unknown and blocks like one address, with
a message that says so.

### Parity on setup and fingerprint steps

A setup or fingerprint step is the team's own naming, so nothing that shows
the clone differing from a steady original, and nothing only one side shows,
may depend on the prefix. By the finding's category:

- Every category that makes a step `changed`, and any category this list does
  not name, blocks as `parity_changed`.
- `declared-not-shown`, `single-observation` and `not-completed` block as
  `parity_unknown`.
- `not-recorded` and `other-origin` block unless the other side shows the
  same gap at the step (the same dimension, request and pointer; the same
  origin). Data no capture of either side recorded is the one exit: the step
  then proves nothing, as a deleted step would.
- `repeats-differ` and `undeclared-volatile` do not block: one side disagrees
  with itself, and where no capture of the clone agrees with a steady
  original the comparer reports the difference as well.
- A step that lists as many findings as the comparer keeps per step (20),
  none of which blocks, blocks as `parity_unknown`, because one it left out
  may block.

A step that is not `unchanged` and does not block is counted in
`ungated_steps`. Naming a step `setup-` therefore hides no difference, with
or without a volatile declaration.

### Reason codes

Every blocking finding carries one reason code. Capture reasons go to the
prober on the original side and to the verifier on the clone side. A finding
goes to another role than its reason's own when the remedy is that role's;
the fourth column names those.

| Reason                         | Check       | Role                              | Also addressed to                                      | Meaning                                                                    |
| ------------------------------ | ----------- | --------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `target_invalid`               | scope       | lead                              |                                                        | `target.json` fails its schema, or the clone's name holds an original name |
| `addresses_not_distinct`       | scope       | lead                              |                                                        | both sides are one address, or REA cannot tell                             |
| `run_folder_inside_clone`      | scope       | lead                              |                                                        | the run folder is the clone root or inside it                              |
| `clone_root_missing`           | scope       | builder                           |                                                        | the clone root does not exist                                              |
| `clone_symlink_outside_root`   | scope       | builder                           |                                                        | a symlink leaves the clone root, enters an exclude or does not resolve     |
| `clone_path_unreadable`        | scope       | builder                           |                                                        | an entry under the clone root cannot be read                               |
| `no_scenarios`                 | inputs      | prober                            |                                                        | no scenario file                                                           |
| `scenario_invalid`             | inputs      | prober                            |                                                        | a scenario fails its schema or cannot be rendered                          |
| `no_obligations`               | inputs      | spec writer                       |                                                        | no obligation file                                                         |
| `obligation_invalid`           | inputs      | spec writer                       |                                                        | an obligation file fails its schema                                        |
| `unknown_invalid`              | inputs      | lead                              |                                                        | an unknown file fails its schema or its name                               |
| `intended_differences_invalid` | inputs      | lead                              |                                                        | a declaration fails its schema or names nothing                            |
| `waivers_invalid`              | inputs      | lead                              |                                                        | a waiver lacks a person or a reason, or names nothing                      |
| `evidence_missing`             | evidence    | prober or verifier                |                                                        | fewer admitted captures than required                                      |
| `evidence_stale`               | evidence    | verifier                          |                                                        | clone captures were made for other clone files                             |
| `evidence_scenario_mismatch`   | evidence    | prober or verifier                |                                                        | captures replay another scenario or another version of it                  |
| `evidence_rejected_integrity`  | evidence    | prober or verifier                |                                                        | an entry is not authentic capture Evidence; remove it                      |
| `evidence_rejected_address`    | evidence    | prober or verifier                |                                                        | a capture started at another address; remove it                            |
| `start_state_dirty`            | clean_start | prober or verifier                | the prober, for a dirty start in on-screen text only   | two captures of a side began from different states                         |
| `start_state_unknown`          | clean_start | prober or verifier                |                                                        | a fingerprint observation is missing                                       |
| `step_uncited`                 | coverage    | spec writer                       |                                                        | a behavior step is cited by no obligation                                  |
| `obligation_step_unknown`      | coverage    | spec writer                       |                                                        | a case cites a step that cannot be cited                                   |
| `obligation_inferred`          | coverage    | prober                            |                                                        | an inferred obligation is not waived                                       |
| `parity_changed`               | parity      | builder                           | the lead for a rename, the prober for a requested page | the clone differs from the original at a step                              |
| `parity_unknown`               | parity      | prober or verifier                | the prober, when the remedy is the scenario            | data needed to compare a step is missing                                   |
| `parity_unstable`              | parity      | lead (original), verifier (clone) | the prober, when no declaration can cover it           | a side disagrees with itself between repeats                               |
| `clean_room_identical_file`    | clean_room  | builder                           |                                                        | a clone file equals a file of the original                                 |
| `clean_room_forbidden_name`    | clean_room  | builder                           |                                                        | one of the original's names occurs in the clone                            |
| `unknown_open`                 | unknowns    | lead                              |                                                        | an unknown is neither waived nor closed                                    |

### Who a comparison finding goes to

A finding that only shows a side disagreeing with itself never tells a
builder to change the clone.

| Finding                                                                 | Role               | Command                               |
| ----------------------------------------------------------------------- | ------------------ | ------------------------------------- |
| The clone differs where the original is steady                          | builder            | evaluate, after the clone is fixed    |
| The two values are equal once the original's name or address is renamed | lead               | evaluate, after the rename it prints  |
| Two pages that a `request` step fetched differ in their markup          | prober             | evaluate, after the scenario change   |
| A reply field differs between the original's own captures               | lead               | evaluate, after the declaration       |
| Text, a status, a request line or a text reply differs between them     | prober             | `rm` of the original's captures of it |
| The clone's captures disagree with each other                           | verifier           | `rm` of the clone's captures of it    |
| A reply body was not recorded on one side, or was recorded once         | prober or verifier | one more capture of that side         |
| A reply body was recorded by no capture of either side                  | prober             | evaluate, after the scenario change   |
| A field is declared volatile and the original's captures do not vary    | prober             | one more capture of the original      |
| The capture left out requests (its transaction limit)                   | prober             | evaluate, after the scenario is split |
| A step did not complete, or left the side's address                     | prober             | evaluate, after the scenario change   |
| The fingerprint steps differ only in on-screen text                     | prober             | evaluate, after the scenario change   |

Where two roles are named, the prober acts for the original side and the
verifier for the clone side. Unsteady findings of one scenario that share
side, dimension, pointer and category are one item, whatever their values,
which prints the declaration with `step_id` `*` when a declaration is the
remedy. The messages state the cause:

- A difference says `the original gave X, the clone gave Y`, or a phrase for
  the category when a value is absent. A difference whose original value
  holds the original's own address shows that value as it was compared, with
  the address read as the clone's, and says so.
- A rename settles a difference when the values are equal once one of the
  original's names in another letter case, or its address, is replaced;
  values cut to an excerpt are compared as far as both go. When both values
  of a `request` step are HTML pages, the item goes to the prober: a page is
  compared by its on-screen text through a `goto`, and a `setup-` name does
  not help.
- The original's unsteady items name the other usual cause, something else
  talking to the instance during a capture. The clone's go to the verifier;
  only if the same difference returns is it the builder's or the prober's,
  and the message says so.
- The item of a step that did not complete names the failed step and its
  Evidence file and quotes the first line of the failure the capture
  recorded, at most 300 characters. It adds advice about redirects only when
  that text names one.
- A body recorded by no capture of either side is a download or a reply over
  64 KiB on both sides. For a download the prober adds a `request` step for
  the file and names the click `setup-`.
- A body that only one side lacks after another capture is a difference: the
  sides differ in what decides whether a capture can record it. It blocks on
  a `setup-` step too.
- A `declared-not-shown` item says that the difference blocks on every step,
  a `setup-` step included.
- At a position of a list, a declared field the original holds steady and a
  field the clone's captures disagree on both say that lists are compared by
  position: a list whose order varies between captures has to be requested
  in a fixed order.

### Waivers and declarations

Only the lead writes `waivers.json` and `intended-differences.json`.

A waiver names a person and a reason, which REA records and cannot verify. It
covers an unknown or an inferred obligation and nothing else: a difference,
missing data and an unstable step cannot be waived. A step whose data is
missing blocks until a capture records it or the prober renames it `setup-`.
A `closed` entry settles an unknown with an observed obligation whose cited
steps are all `unchanged`. With a waiver applied the verdict is
`done_with_waivers` and the summary reads `done with N waivers`. The items
for `unknown_open` and `obligation_inferred` say who may settle them, in this
order: show the answer with a step and close the unknown against an observed
obligation; otherwise only the user, or a person the user names, accepts the
gap, and an agent never writes that name; when nobody can be asked, the lead
reports the finding and the run ends not done. They print no waiver to paste.

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
order. The original's own address needs no rename: its origin, and its bare
host and port when the origin names a port, are read as the clone's in
accessibility text and in string values. No placeholder stands for an
address, so a clone that prints `{origin}` or the original's address where
the original prints its own differs.

A volatile field names one reply field that the original itself changes
between clean repeats. Its `step_id` is a step or `*` for every step of the
scenario, and a `*` segment of its pointer stands for any one index of a
list. It never covers the values beneath an object or a list, and the empty
pointer is refused. It is honored only where the original's captures really
differ, at each step and each list position by itself, and what the
original's values share is still compared: whether the field is present, its
JSON type and its layout. A declared field whose value the original's
captures all agree on, also at one position of a list that varies at another,
is not ignored: when the clone differs there the step is `unknown` and
blocks, on a `setup-` step too, until the original is captured again or the
declaration goes. Volatile declarations do not apply to fingerprint steps;
renames do. Only a field of a JSON reply can be declared. On-screen text
cannot, so a date or a clock shown on screen makes its step differ between
days: capture both sides on the same day, or keep such text off the pages a
scenario shows. The order of a list cannot either: a list is compared
position by position, so a list whose order varies between captures has to
be requested in a fixed order. A step whose text, status or requests vary
between the original's own repeats is made deterministic or renamed
`setup-`.

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

### Stall

`stalled` means the team acted and nothing improved. The referee decides it
from `journal.jsonl`, to which it appends a line whenever its state (the
blocking findings, the clone's digest, the admitted Evidence ids, judged or
not) differs from the last line. Findings are told apart by reason, side,
file, scenario, step, obligation and pointer. A journal that ends in a
partial line is repaired by starting a new line.

- An evaluation is judged when every scenario has its captures admitted on
  both sides. One that is not judged uses up nothing, and its `outlook` names
  the cause: `target.json` is refused, no valid scenario, a scenario that
  could not be rendered, a missing clone root, or a scenario that lacks
  admitted captures on a side. Evaluating one state again, at once or later,
  concurrently or in sequence, adds nothing.
- A round is a judged set of clone files: a judged evaluation starts a round
  when the clone's files differ from the last judged ones. New captures and
  edits to the authored files never use up a round. A result that is not a
  pass reads `stalled` once `round` reaches `max_rounds` in `target.json`
  (8 by default), judged or not.
- Within a round, an attempt is a judged evaluation that finds the same
  blocking findings from other admitted Evidence. The second attempt reads
  `stalled`; the third does when a blocking finding carries a capture or a
  removal command, so the referee's own remedy does not stall on its first
  try.

A stalled result still carries `next`, and its summary says why:
`stalled after 1 judged round (the same findings were judged 3 times on the same clone tree): 1 blocking finding`,
or `(the limit is N)` when the round limit was reached. It reads `not_done`
again as soon as a finding or the clone's files change. The journal is read
only when it is a regular file: a link or a special file in its place counts
as no journal and is replaced.

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
it, and a bundle that does not hold exactly one record, a HAR or a positional
file is refused. `--differences` applies the renames and volatile fields of
an `intended-differences.json`, and `--scenario` picks the scenario whose
volatile fields apply; it is required when the file names more than one. All
captures of one side must list the same step ids in the same order, or the
comparison is refused. Steps are aligned by step id in the left side's
order. A left step the right side lacks is `changed`; a right-only step is
named in `limitations`. Steps whose ids start `rea-` are never compared.

| Dimension      | Compared                                                                          |
| -------------- | --------------------------------------------------------------------------------- |
| `step`         | the outcome: completed, failed or cancelled                                       |
| `request`      | method, path, query, request body, and navigation or script request               |
| `status`       | exactly                                                                           |
| `body`         | JSON by pointer, text whole; the markup of a page the browser navigated to is not |
| `page_address` | path, query and fragment relative to the side's origin                            |
| `text`         | the accessibility text, exactly, after renames                                    |

Only requests of type `fetch`, `xhr` and `document` are compared. Scripts,
styles, images and fonts are counted as `ignored_transactions`. Each step is
`unchanged`, `changed`, `unknown` or `unstable`, the worst of its findings in
the order `changed`, `unstable`, `unknown`. The verdict is `changed` if any
step is; else `unknown` if any step is `unknown` or `unstable`; else
`unchanged`.

Each finding names the `dimension`, a `category`, the request, the JSON
pointer, the `expected` (left) and `actual` (right) value and the side. A
step lists its 20 most severe findings, gaps last, and `limitations` counts
the rest. The category alone decides what the finding makes of its step:

| Category                              | Step       | Meaning                                                                          |
| ------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| `not-recorded`                        | `unknown`  | no capture of the side recorded the data: a reply body, a request body, requests |
| `single-observation`                  | `unknown`  | the left side recorded the value once, so nothing shows whether it is steady     |
| `declared-not-shown`                  | `unknown`  | a declared volatile field is steady on the left and differs on the right         |
| `not-completed`, `other-origin`       | `unknown`  | a step did not complete, or a request or the page went to another origin         |
| `repeats-differ`                      | `unstable` | a side's own captures disagree                                                   |
| `undeclared-volatile`                 | `unstable` | a reply field differs between the left captures and no declaration names it      |
| `value`, `status`, `shape`, any other | `changed`  | the sides differ where the left is steady                                        |

### Comparison rules

- Origin: a capture's application is the origin it started at. Only requests
  to that origin are compared. A `fetch`, `xhr` or `document` request to
  another origin is `other-origin` for the side that made it, and a page
  address at another origin keeps its whole URL, so a clone that sends the
  browser or its requests to another server cannot match.
- Requests of a step are matched by request line (method, path, query): the
  k-th occurrence on the left with the k-th on the right. An unmatched line is
  a `request` difference, unless the left's captures do not all send the same
  lines at that step: a line only the right sent then cannot contradict them
  and is `repeats-differ`. A line that is a navigation on one side and a
  script request on the other differs; `fetch` and `xhr` are one kind.
- Only page markup is skipped: a `document` reply whose media type is HTML,
  or one whose media type was lost with its body and whose path and query
  equal the step's page address. Any other `document` reply, such as a CSV or
  a download, is compared like a fetched reply. Markup that a `request` step
  fetched is a text reply and is compared whole, so a clone with markup of
  its own differs there: probe a page with `goto` and its accessibility text.
  A text reply that is a JSON object or list in every reply of both sides is
  compared field by field.
- Renames apply to the left side's accessibility text, to JSON string values
  of its request and reply bodies and to its text bodies: every occurrence,
  case-sensitive, in declaration order. Never to field names, paths, queries,
  statuses or page addresses. `renames_applied` lists each rename that
  changed a compared value.
- The left's own address is read as the right's in the same places: its start
  origin, then its bare host and port when the origin names a port, except at
  the end of a longer host name or before a further digit. It is not read
  inside a request line or a query, inside a field name, in another letter
  case, or as the bare form of an origin on its scheme's default port.
  `addresses_applied` lists each form that changed a compared value, beside
  `renames_applied`. The right side is never rewritten and no placeholder
  stands for an address. A finding's `expected` is the left value as it was
  compared, after this reading and the renames. With several start origins
  on a side, `limitations` says which one was read.
- Missing data is `unknown`, never a match, on either side: no response; a
  reply body that was expected and that no capture of the side recorded
  whole; a request body that was sent and not recorded; request events the
  capture reports it omitted at its transaction limit, which leaves every
  step of that capture `not-recorded`; text or a page address not recorded;
  a left step that did not complete; a right step that was cancelled. A HEAD
  reply, 204, 205, 304 and every redirect carry no body to miss, and a GET or
  HEAD request sends none.
- Only a reply body folds across captures: it counts as recorded if any
  capture of that side recorded it, so another capture can supply one that a
  capture lost. A status, a text, a page address or a request body that some
  captures of a side recorded and others did not is `repeats-differ`, and so
  is a request line only some sent.
- What the left's own captures disagree on is `unstable`, not `changed`: only
  a value the original holds steady can be contradicted. When the right
  side's captures disagree and one of them equals the left's steady value,
  the only finding is `repeats-differ` on the right, never a difference.
- Any reply leaf that is steady on the left and not exactly equal on the
  right is `changed`. The kind of every container is judged first: a list
  against an object is a difference at the outermost such container,
  whatever is declared beneath it, an empty one included. Two lists of the
  same length are compared item by item at their positions, also under a
  declared `*` pointer, and `limitations` says so when a position the left
  holds steady differs on the right; lists of different lengths differ in
  length.
- An honored volatile field is compared by presence, JSON type and string
  layout, as far as the left's values share them; a right value outside that
  is `shape`. A declared field the left holds steady over two or more replies
  and that differs on the right is `declared-not-shown`, and `changed` once
  the declaration is withdrawn. A value the left recorded once is
  `single-observation`.
- One difference in accessibility text is listed at the first step that
  shows it, often `scenario_start`; `limitations` counts the later steps that
  show the same text. Text that is unsteady or not recorded is judged at
  every step.
- `volatile_fields` lists, per step, at most 20 fields that vary, each with
  whether a declaration names it (`declared`) and took effect (`honoured`).
- Each capture has a `fingerprint_sha256` over what its `fp-` steps observed,
  null when one of them lacks an observation, a request body or omitted
  request events. An `fp-` request step fingerprints its request and reply,
  not the page text behind it. A side's `start_state` is `dirty` when two
  fingerprints differ, `clean` when at least two are recorded and all are
  equal, else `unknown`.

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

### The behavior table

`behavior/<scenario>.json` is what builders read instead of Evidence: per
step, its kind, action, outcome, page address relative to the original's
origin, accessibility text, and each request with its request body, status
and reply, plus `volatile_pointers`, the reply fields the original's captures
disagree on. Each value is the first one a capture recorded, as the original
gave it, its own address included. A JSON body is `{kind: "json", value}`, a
body sent and not recorded is `{kind: "not-recorded"}`. Page markup is never
copied into the table (`{kind: "omitted", reason: "document"}`), nor is a
binary body. A body over 8 KiB (8,192 bytes) is left out of the table as
`omitted`, with its size; the comparison still compares it. Read such a body
from the capture, one step at a time. Accessibility text is repeated at every
step: in a recorded run of five scenarios the tables measured 174 to 647 KB
each.

## Refusals

A refusal exits `1` with or without `--exit-code` and has no `verdict`
member. A refusal by a command is REA's error envelope with `error`, `code`
and `message`, and names the fix under `remediation`. The command line parser
refuses three things before the command runs, without an `error` member:

- A missing or invalid option, as
  `{"code": "VALIDATION_ERROR", "message": …, "fieldErrors": [{"path": "right", "missing": true, …}]}`.
  `path` is the option's key, so `right` is `--right` and `originalName.0` is
  the first `--original-name`.
- A flag the command does not have, or a positional argument it does not
  take, as `{"code": "UNKNOWN", "message": …}`; the message names the flag
  or the argument. A misspelt `--exit-code`, such as one with an underscore,
  is this refusal and never a pass. The parser also reads an option's key
  in camel case as the flag.
- A value after `--exit-code=` that is neither `true` nor `false`, as
  `{"code": "PARSE_ERROR", "message": "Invalid --exit-code value; use true or false."}`.
  Such a value is never read as the flag turned off.

`--help` lists every option and starts the description of a required one with
`Required.`: `--left` and `--right` for the comparison, and `--original`,
`--clone`, `--clone-root`, `--clone-name`, `--original-name` and
`--authorization` for a new run.

## What a verdict does not establish

The gate lists these limits as `residual_trust` with every pass, one line
each, in this order.

1. The authorization statement is recorded as given. REA cannot verify it.
2. `target.json`, the scenarios and the declarations are the team's own
   statements. The verdict is about the addresses, clone root, excludes,
   names and material that `target.json` declares when the referee runs, and
   whoever can edit it can retarget the run. The gate repeats the addresses
   and the root under `target`.
3. The verdict covers only the steps the scenarios contain. REA cannot tell
   whether they exercise every rule of the original, nor whether an
   obligation's statement describes the steps it cites. A deleted step,
   capture or unknown leaves no trace.
4. Evidence integrity is an unkeyed content digest. It catches an edited or
   misplaced file, not Evidence forged with REA's own code.
5. A capture is bound to an address, not to what answered there: not to the
   program or the build of the clone that served it. The addresses are
   checked to differ by port or by resolved host; a proxy or a port forward
   between them is not detected. Restart the clone after an edit, before
   capturing.
6. Clone Evidence is bound to the clone's digest when its input was
   rendered, and that digest equals the files now: an edit that was reverted
   between the two is not visible. File modes, empty directories and special
   files are not part of the digest.
7. Excluded clone paths are not digested, so an edit there never makes a
   capture stale, and they are not checked for copied files or names. The
   summary names them whenever an exclude matched.
8. A rename can declare away any difference in text or a string value, and
   an honored volatile field is compared by presence, JSON type and layout
   only. The gate lists both under `declared`.
9. A waiver's person and reason are recorded as given.
10. The clean-room check covers names and identical files only, for the names
    and the material the run declares and for reply bodies a capture
    recorded, which are 64 KiB each at most.
11. REA does not reset targets. A clean start is inferred from the
    fingerprint steps only.
12. The journal is the referee's own output. Removing it can hide a stall and
    cannot produce a pass.
13. A step is compared on its outcome, its requests, their statuses, fetched
    reply bodies, the page address and the accessibility text. Appearance,
    styles, images, fonts, response headers, the document title and timing
    are not compared.
14. Text inside an iframe, the text of an alert, confirm or prompt dialog and
    the content of a file saved through a download are not compared.
15. A reply body that one capture of a side recorded stands for the captures
    of that side that lost it. A clone that answers differently only in a
    capture whose body was lost, or was over the capture's 64 KiB limit, is
    not detected.

The gate's line 15 says that captures lose bodies at random. They do not:
back-to-back `request` steps lost none of 90 cacheable replies in three
captures, and 21 of 90 replies sent with `Cache-Control: no-store`.

## Ways to a false pass

What stops each known attempt to reach `done` with a wrong clone. A row that
says "not stopped" names the limit above that states it.

| Attempt                                                                       | Stopped by                                                                       |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Write or edit `gate.json`, `parity/`, `records/` or `rendered/`               | never read; the verdict is recomputed                                            |
| Edit or delete the journal                                                    | can only add or hide `stalled` (12)                                              |
| Edit an Evidence file                                                         | `evidence_rejected_integrity`                                                    |
| Forge Evidence with REA's own digest code                                     | not stopped (4)                                                                  |
| Copy one capture to make the second                                           | `duplicate`, so `evidence_missing`                                               |
| File a capture under the other side                                           | `evidence_rejected_address`                                                      |
| File a capture of another scenario, version or capture setting                | `evidence_scenario_mismatch`                                                     |
| Edit the clone after its capture, or before the first evaluation              | `evidence_stale`                                                                 |
| Change only a file's mode, or add an empty directory or a special file        | not stopped (6)                                                                  |
| Keep code under an exclude, or edit an excluded file after a capture          | not stopped; every summary names the matched excludes (7)                        |
| Write an exclude that looks narrow and is not                                 | `target_invalid`                                                                 |
| Keep code behind a symlink that leaves the root, or whose target is absent    | `clone_symlink_outside_root`                                                     |
| Make a clone file unreadable to the referee                                   | `clone_path_unreadable`                                                          |
| Serve another program or build at the clone's address, or a proxy             | not stopped (5)                                                                  |
| Send the browser or its requests from the clone to another server             | `parity_changed` or `parity_unknown`                                             |
| Give both sides one address, also through another name of this machine        | `addresses_not_distinct`                                                         |
| Put the run folder inside the clone                                           | `run_folder_inside_clone`                                                        |
| Point `target.json` at other addresses or another root                        | not stopped; the gate repeats them (2)                                           |
| A scenario with no behavior step or no fingerprint, or an absolute `goto` URL | `scenario_invalid`                                                               |
| Rename a failing step `setup-`                                                | `parity_changed`                                                                 |
| ... and declare the differing field volatile                                  | `parity_unknown` (`declared-not-shown`), and the gate names the declaration      |
| Pad the clone's wrong reply past the body limit at a `setup-` step            | `parity_unknown`: data only one side lacks blocks                                |
| Delete a failing step                                                         | not stopped (3)                                                                  |
| Leave a behavior step uncited, or cite only `fp-`, `setup-` or absent steps   | `step_uncited`, `obligation_step_unknown`                                        |
| An observed obligation with no case                                           | `obligation_invalid`                                                             |
| Mark a rule `inferred` instead of probing it                                  | `obligation_inferred` until a named person waives it                             |
| Declare a field volatile that the original holds steady, also with step `*`   | `parity_unknown`, then `parity_changed` once the declaration goes                |
| Declare a `*` pointer and be wrong at a list position the original holds      | `parity_unknown` at that position                                                |
| Declare an object, a list or the whole body volatile                          | covers no leaf beneath it; the empty pointer is `intended_differences_invalid`   |
| Declare a rename that hides a real difference                                 | not stopped; the gate lists applied renames (8)                                  |
| Waive missing data, a difference or an unstable step                          | no such waiver exists                                                            |
| A waiver with no person, or one that names nothing                            | `waivers_invalid`; a named person is not verified (9)                            |
| Skip the reset between captures                                               | `start_state_dirty`                                                              |
| Copy the original's served files into the clone                               | `clean_room_identical_file`, for material files and recorded reply bodies        |
| Declare a material directory that does not exist                              | `target_invalid`                                                                 |
| Retype, reformat or paraphrase the original's scripts                         | not stopped (10)                                                                 |
| Leave the original's name in the clone, a path or a link's text               | `clean_room_forbidden_name`                                                      |
| Answer a list where the original answers an object, or the reverse            | `parity_changed` at the container                                                |
| Print `{origin}` or the original's address for an address                     | `parity_changed`                                                                 |
| Answer wrongly only in a capture whose body was lost or over the limit        | not stopped (15)                                                                 |
| Drop a request body, or run past the capture's transaction limit              | `parity_unknown` (`not-recorded`)                                                |
| Serve a download with other content                                           | `parity_unknown` at the step that saves it; not stopped once it is `setup-` (14) |
| Differ only in appearance, headers, the title, timing, an iframe or a dialog  | not stopped (13, 14)                                                             |
| Run the referee without `--exit-code`, or search its output for done          | not stopped; only the exit status of a run with the flag is the verdict          |
| Write `--exit-code=1`                                                         | refused as an argument error, exit `1`, no verdict                               |

## Limits of what a capture records

These come from the capture command, `rea capture-browser-scenario`, and hold
for both sides.

- A reply over the capture's body limit, 64 KiB, is recorded as unavailable,
  and so is the body of every redirect and of a file the browser saves.
- A capture can lose a reply body. Replies sent with `Cache-Control: no-store`
  were lost in 21 of 90 back-to-back `request` steps; cacheable replies were
  not. Another capture supplies a lost body.
- A failed step cancels every later step. A `request` step fails on a
  redirect, and so does one that runs after the page left the start origin.
  A `goto` may leave it and completes.
- Accessibility text is the top document's: a frame shows as a bare
  `iframe` line, and dialog text is not recorded.
- A request belongs to the step during which it was observed, so a request a
  reply triggers can land in the next step, and an accessibility snapshot can
  precede the render it caused. A click that waits for its reply avoids this.
- A `request` step sends a JSON body or none, so a body that is not
  well-formed JSON cannot be probed.
- An application served from more than one origin is outside a clone run.
- A capture file runs from a few hundred kilobytes to several megabytes:
  0.22 MB for sixty small `request` steps, and 0.46 to 2.9 MB each in a
  recorded run of five scenarios.

`npm run verify:clone-run` serves a fixture original and a renamed clone on
loopback ports, captures both with real Chromium by running the worklist's
own commands, and checks twenty cases, from each way to a false pass it can
stage to the matching clone that exits `0`.
