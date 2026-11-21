# Clone runs: rebuild a web application with a referee

<!-- keywords: clone, copy, replicate, rebuild a website, web app, does the rebuild match the original -->

Use this when the user asks to rebuild ("clone") a web application they can
run and reset on this machine, and wants to know when the rebuild matches. A
clone run is one folder on disk, seven roles that work from it, and a referee.
The roles run the same scripted visits against the original and the clone;
`rea evaluate-clone-run` compares what REA recorded on each side and decides
parity. No role declares success. Only the referee does, from captures REA
recorded and authenticated and from the clone's files as they are now.

One agent can play the seven roles in turn, or a lead can hand them to
helpers. To understand an application without rebuilding it, use the other
guides. The referee covers web applications served from one origin. A
scenario cannot carry stored state or secrets, so a sign-in is covered only
when its own steps perform it, and the captures then record what they sent.
For a native, Electron or command-line target there is no referee:
build with ordinary coding tools, keep observed behavior apart from design
choices, and say that no REA verdict backs the result.

## Scope

- The team writes new code for behavior it observed, under a new name.
- It never gets past DRM, a license check, anti-cheat, a packer or a sign-in.
  When one stands in the way, stop, write an unknown and tell the user.
- It never copies the original's code, artwork or brand into the clone. The
  referee refuses `done` when a clone file is byte-identical to a file of the
  original, or when one of the original's names appears in the clone.
- The user states that they may study the original. Ask for that statement and
  for the name of the person making it, and give both to `rea init-clone-run`
  word for word. REA records the statement and cannot verify it. Never write
  one yourself.
- Probes write to the original, so it must be an instance the user says is
  disposable. REA never starts, stops or resets a target: the team runs the
  commands the user gave, which `target.json` records.

## The loop

<!-- keywords: stalled, stuck, what now, next step, exit status, referee -->

```sh
rea evaluate-clone-run /abs/run --exit-code --json
```

Exit 0 is done, 1 is not done, 2 is stalled. On 1, read `next`: each item
names a role, a reason, a file, what is wrong and the exact command to run.
Do the item with that role's card open, or hand it to a helper, then run the
referee again. Repeat until it exits 0 or 2.

All state is the run folder. A new session, a compacted context or another
client resumes by running the same command, which recomputes everything from
the files. Do not carry the worklist in memory between runs.

The verdict is the exit status of an evaluation you ran. A `gate.json` found
on disk, a helper's message and your memory of the last run are copies.
Without `--exit-code` the command exits 0 whatever it found. Write the flag
bare: a value after `=` other than `true` or `false` is refused.

Rounds and stalling. An evaluation is judged when every scenario has its
captures admitted on both sides. Before that it uses up nothing, and neither
does evaluating an unchanged folder again. A round is a judged set of clone
files: a judged evaluation after an edit to the clone starts the next one,
and the run reads `stalled` when `max_rounds` of them (8 unless the lead set
another) are used. Within a round, the same blocking findings judged again
from other captures are a second attempt, which reads `stalled`; when a
finding itself asked for a capture or a removal, the third does. So add or
remove captures when an item asks for it, never to see whether the findings
move. Every result that is not a pass says where the run stands under
`stall`, and its `outlook` says what would make the next one read `stalled`.

`rea init-clone-run` prints the first worklist. It asks for scenarios,
because the referee cannot check scouting or mapping. Do those first anyway,
in this order:

1. Lead: settle the scope with the user and create the folder.
2. Scout, then mapper: list what exists and what must be probed. The verdict
   covers only the steps the scenarios contain, and the map is the only list
   of what they should contain.
3. Prober: write scenarios and capture the original from a clean start.
4. Spec writer: turn `behavior/` into specs and obligations.
5. Builder: write the clone from the specs.
6. Verifier: capture the clone.
7. Lead: evaluate and hand out `next`.

The checks do not wait for one another. Before a clone exists the referee
already admits the original's captures and writes `behavior/`, so probing and
spec writing can finish before building starts.

## Rules for every role

Give these to a helper together with its card.

- Call REA only as CLI one-shots (`rea <command> ... --json`). Do not share an
  MCP connection: one REA server holds one active target and one Evidence
  store, and a second agent silently retargets the first.
- Write only where your card says. Each file has one writer, so nothing is
  merged.
- Never edit, copy or move an Evidence file, and never edit what the referee
  writes (`rendered/`, `records/`, `behavior/`, `parity/`, `journal.jsonl`,
  `gate.json`). The referee rewrites its outputs and never reads them back, so
  an edit there changes nothing.
- Pass paths and ids, never payloads. A capture file runs from hundreds of
  kilobytes to several megabytes; a step id and a path say the same in one
  line.
- What you could not establish goes into `unknowns/<role>-<n>.json` as one
  statement, with your role spelled as in the worklist (`spec_writer-1.json`).
  Do not guess and do not drop it. Only the lead settles an unknown.
- An input REA's actions cannot produce is an unknown too, not a surface to
  leave out: a `request` step sends a JSON body or none, so a body that is
  not well-formed JSON, for one, cannot be probed. Write the unknown and
  report it. The user then decides: observe it another way, name a person
  for a waiver, or accept a run that ends not done on that one finding.
- `examples/` in the run folder holds a valid example of each file a role
  writes, and the referee's messages name the file, the place and the fix.
  Start from those, not from memory.
- Read one step of a capture file with the command below instead of loading
  the file. `"collection":"steps"` lists each step's index and id, and
  `"collection":"transactions","step_indices":[1],"event_kinds":["request","response","network-content"]`
  gives one step's requests and replies. Builders never read captures.
- Keep the scope above. A protection or a sign-in in the way is a reason to
  stop, not a problem to solve.

```sh
rea inspect-analysis-view '{"source":{"kind":"evidence-file","path":"scout/crawl-1.evidence.json"},"view":{"kind":"browser-scenario","collection":"text","step_index":1,"artifact":"accessibility"}}' --json
```

## Role cards

### Lead

The lead owns a clone run: its scope, its target, its declarations and the
loop. It is the main conversation and the only role that talks to the user.

- Reads: the referee's output; `unknowns/`.
- Writes: `target.json` (created by `rea init-clone-run`, edited by hand
  afterwards), `intended-differences.json`, `waivers.json`. Never clone code,
  scenarios or obligations.
- Commands: `rea init-clone-run`, `rea evaluate-clone-run`, `rea guidance`.
- Before creating the folder, ask once: both addresses; where the clone's
  source lives and what the clone is called; the original's product and brand
  names; the authorization statement and who makes it; how to start, reset,
  stop and health-check each side; whether the original instance is
  disposable. Put the run folder outside the clone's source.
- Finished when an evaluation you ran exits 0 and you have told the user what
  the verdict rests on: the `summary` (it names excluded clone paths), every
  waiver, the `declared` renames and `volatile_declarations`, the `target`
  addresses and root, and the limits the gate lists under `residual_trust`.
  On exit 2,
  report as [When to stop](#waivers-declarations-and-when-to-stop) says.
- Worklist reasons: `target_invalid`, `addresses_not_distinct` and
  `run_folder_inside_clone` are your `target.json`. `unknown_invalid`,
  `intended_differences_invalid` and `waivers_invalid` are files you own or
  accept. `unknown_open` asks you to settle a proposal: have it probed, close
  it against an observed obligation that passes, or take a waiver to the
  user. The item prints no waiver to paste: the person's name comes from the
  user, never from you.
  `parity_unstable` on the original means the original disagrees with itself
  between clean repeats: declare the field volatile only if it is a clock or
  a generated value, otherwise send the step back to the prober.
  `parity_changed` comes to you only when a rename would settle it: the item
  gives the exact spelling to declare. Add it if the clone differs there on
  purpose; if not, the difference is the builder's.
- One volatile field can cover a whole scenario and every position of a
  list:
  `{"scenario": "notes-api", "step_id": "*", "pointer": "/items/*/createdAt", "reason": "creation time"}`.
  Each step of `behavior/<scenario>.json` lists the candidates under
  `volatile_pointers`. A declaration counts only where the original's own
  captures differ, at each step and each list position by itself. Where they
  agree and the clone differs, the step blocks, a `setup-` step included,
  and the gate names the declaration. Only a field of a JSON reply can be
  declared: not on-screen text, not the order of a list.
- Typical mistakes: reporting done from a helper's summary; declaring a
  rename or a volatile field to make a difference disappear; excluding a
  clone path that holds code (an excluded path never makes a capture stale
  and is not checked); choosing an original name that is also a route or a
  field name, which the clone must keep and the name check will then always
  find; granting a waiver yourself.

### Scout

In a clone run the scout takes the first look at the original, read-only:
which pages, routes, scripts and files exist.

- Reads: `target.json`.
- Writes: `scout/` only. Everything taken from the original goes there: the
  crawl capture, exported scripts, saved pages, your inventory.
- Commands: copy `examples/crawl.example.json` to `scout/crawl-1.json`, give
  it one `goto` step per page, then run the commands below from the run
  folder. The crawl and the script analysis go to files, not into your
  context: each command prints a summary. The last one lists the routes the
  scripts name, twenty at a time; an empty list means the scripts build
  their paths while they run, and the requests the crawl recorded are then
  what you have. A page the crawl finds gets another step and another crawl.
- Finished when `scout/` lists every page reachable from the start page, every
  request those pages make and every script they load, and what you could not
  reach is written as unknowns.
- Typical mistakes: submitting forms or pressing buttons that change data (a
  crawl only reads); saving the original's files outside `scout/`, where the
  copied-file check cannot know them; presenting a rule read from a script as
  observed (it is inferred until a probe shows it); a crawl capture with no
  outer `timeout`.
- The referee does not check the scout's output. Nothing will tell you a page
  was missed.

```sh
timeout 120 rea capture-browser-scenario scout/crawl-1.json --detail summary --evidence_output scout/crawl-1.evidence.json --json
rea export-web-scripts scout/crawl-1.evidence.json scout/scripts-1 --json
rea analyze-javascript-application scout/scripts-1 --detail summary --evidence_output scout/scripts-1.analysis.json --json
rea inspect-analysis-view '{"source":{"kind":"evidence-file","path":"scout/scripts-1.analysis.json"},"view":{"kind":"javascript-routes","collection":"routes","fields":["path","confidence"],"limit":20}}' --json
```

### Mapper

In a clone run the mapper turns the scout's inventory into the checklist the
probers work through: every page, route and input, each with the cases to try.

- Reads: `scout/`.
- Writes: `surfaces.json` in the run folder. It is free form: the referee
  does not read it.
- Commands: the command below lists the routes a capture recorded: `tools`
  holds each API route with its method, path template and statuses, and
  `excluded` the pages and assets. A crawl of pages that embed their data
  records no API request, so `tools` is empty: the routes the scout read from
  the scripts are then the map, each one inferred until probed.
- Finished when every surface names the scenario that will probe it or says
  why it is out of scope, and every input lists its cases: typical, empty,
  both sides of each limit, wrong type, wrong method, duplicate, ordering.
- Typical mistakes: listing only what the pages show and missing routes that
  only scripts call; leaving out an address that no page links to but the
  operator's own commands call (the health command in `target.json`);
  dropping a surface without a reason; mapping something behind a protection
  as in scope.
- The referee does not measure coverage of this list. The lead and the
  probers do, by reading it.

```sh
rea inspect-analysis-view '{"source":{"kind":"evidence-file","path":"scout/crawl-1.evidence.json"},"view":{"kind":"environment-manifest"}}' --json
```

### Prober

In a clone run the prober shows what the original does, one rule per step, in
scenarios that are then run against both sides.

- Reads: `surfaces.json`, `target.json` for the original's reset and health
  commands, `rendered/original/`.
- Writes: `scenarios/<scenario>.json`; `evidence/original/` only through the
  capture command; `unknowns/prober-<n>.json`.
- Commands: `rea validate-browser-scenario` on a rendered input,
  `rea capture-browser-scenario` exactly as the worklist prints it, and the
  preview below. Before any clone exists it shows what the original itself
  answers differently in two clean runs. Each finding needs a decision now: a
  clock or a generated id goes to the lead as a volatile field, data that was
  not recorded needs another capture, anything else is a step to make
  deterministic.
- A scenario starts with `fp-` steps that read the state a clean start shows:
  a list request, not a health check. Then one step per case, with an id that
  names the case (`create-empty-title`: a letter first, then letters, digits,
  `.`, `_` and `-`). A step that only prepares, a pause included, is
  `setup-`. A pause among the `fp-` steps is `fp-wait-`, because nothing else
  may come before the last of them.
- A scenario names no address. A `request` step takes a path. A `goto` step
  writes `{origin}` before its path (`{origin}/notes`), and the referee puts
  in each side's address when it renders the capture inputs.
- Locate a control by its role and name, or by an attribute both sides must
  share. Never by an id or a class of the original's markup: the clone need
  not keep them, and a correct clone then fails the step.
- A rounding rule is shown only by a step whose value lands exactly on a tie.
  Work out the inputs from the formula you believe, and probe the tie.
- Finished when every case the map lists for your surface is a step that
  completed on the original in two captures from a clean start, and no item
  for the original remains.
- Worklist reasons: `no_scenarios` and `scenario_invalid` are your files.
  `evidence_missing` asks for a capture: reset first.
  `evidence_scenario_mismatch` means the scenario changed after its captures,
  so capture again. `evidence_rejected_integrity` and
  `evidence_rejected_address` ask you to remove a file; an address rejection
  means you captured the wrong side, so check which instance you talk to.
  `start_state_dirty` means a capture began on a used instance, or the start
  page shows text that changes by itself; the item says which.
  `start_state_unknown` and `parity_unknown` mean data is missing: the item
  says whether another capture can supply it, as
  [capture judgment](#capture-judgment) explains. For a step that failed it
  quotes the failure the capture recorded: act on that text. `parity_unstable`
  reaches you when the original varies where nothing can be declared
  (on-screen text, a status, a request line, a text reply): run the item's
  removal, evaluate, capture again one at a time, then make the step
  deterministic. `parity_changed` reaches you when a `request` step fetched
  a page: replace it with a `goto`. `obligation_inferred` asks for a step
  that shows the rule on the original.
- Typical mistakes: the happy path only; one step that tests several rules;
  editing a scenario after the verifier has started, which sends both sides
  back to capturing; a UI action cited for a result that renders later;
  renaming a step `setup-` to silence it. A difference from a steady
  original blocks there too, with or without a volatile declaration, and a
  step that is only unsteady stops being compared, which removes its rule
  from what the verdict covers.

```sh
rea compare-scenario-behavior --left evidence/original/notes-api/run-1.json --right evidence/original/notes-api/run-2.json --json
```

### Spec writer

In a clone run the spec writer turns what the original was observed to do
into numbered rules a builder can implement without seeing the original.

- Reads: `behavior/<scenario>.json`, the original's requests, statuses,
  decoded replies and on-screen text per step; `surfaces.json`. Evidence only
  when the table is unclear, or for a reply over 8 KiB, which the table
  lists as `omitted`.
- Writes: `specs/` in prose for the builder, `obligations/<area>.json`,
  `unknowns/spec_writer-<n>.json`.
- Commands: none required.
- Finished when every behavior step is cited by an obligation whose statement
  that step really shows, and every rule you believe but no step shows has
  gone back to the prober as a case to add, or is marked inferred.
- Worklist reasons: `no_obligations` and `obligation_invalid` are your files.
  `step_uncited` names a step no rule cites: write the rule it shows, or tell
  the prober the step shows nothing. `obligation_step_unknown` means a case
  cites a step that does not exist, is an `fp-` or `setup-` step, or did not
  complete on the original.
- Typical mistakes: citing a step under an unrelated obligation to clear the
  worklist (REA cannot tell whether a statement describes its steps, so this
  passes and proves nothing); stating a rule more widely than its steps show;
  marking observed what you read in a script; pasting the original's source
  or long copy into `specs/`, which the builder reads.

### Builder

In a clone run the builder writes the clone: new code under the clone's own
name that implements the obligations.

- Reads: `specs/`, `obligations/`, `behavior/`, `gate.json`. Never `evidence/`
  or `scout/`.
- Writes: the clone's source under the clone root, nothing in the run folder.
- Commands: none. Use ordinary coding tools.
- Finished when your obligations are implemented and no item for you remains
  after the verifier's next captures. You cannot certify your own work. Before
  handing back, send the failing step's request to an instance of your own
  and compare the answer with the item's `expected`.
- Worklist reasons: `parity_changed` gives the scenario, the step or
  `step_ids`, the dimension, the pointer, `expected` (the original) and
  `actual` (the clone): fix the rule the citing obligation states, not the
  one value. An address in `expected` is the clone's own: where the original
  prints its own address, the clone prints its own, and nothing else stands
  for one. `clone_root_missing` asks for the directory.
  `clone_symlink_outside_root` asks you to bring the linked code inside the
  root, and `clone_path_unreadable` to make a file readable or remove it.
  `clean_room_identical_file` asks you to rewrite a file that equals one of
  the original's; if it is a third-party library both use, tell the lead.
  `clean_room_forbidden_name` asks you to remove the original's name from a
  file or a path.
- Typical mistakes: special-casing the probed input; opening the original or
  its captures to check one thing; editing while the verifier captures, which
  makes those captures stale; letting the running clone write a database or a
  log under its root without telling the lead; renaming a route, a field, an
  error code or a control label.

### Verifier

<!-- keywords: evidence_stale, stale evidence, verify, replay -->

In a clone run the verifier replays the same scenarios against the clone so
the referee can compare. Where a helper is available it is not the builder.

- Reads: `rendered/clone/`, `target.json` for the clone's reset and health
  commands.
- Writes: `evidence/clone/` only through the capture command;
  `unknowns/verifier-<n>.json`.
- Commands: `rea capture-browser-scenario` exactly as the worklist prints it.
- Keep this order: edits to the clone have stopped; an evaluation renders the
  clone's capture inputs, which are bound to the clone's files as they are at
  that moment; restart and reset the clone so that it runs those files;
  capture; evaluate.
- Finished when every scenario has two clone captures from a clean start that
  the referee admits for the current files, and no item for the clone side
  remains with your role.
- Worklist reasons: `evidence_stale` means the clone changed after the input
  was rendered: evaluate, restart, capture again. If a fresh capture is stale
  at once, the running clone writes under its own root; tell the lead which
  path. `evidence_missing` asks for a capture. `evidence_scenario_mismatch`,
  `evidence_rejected_integrity` and `evidence_rejected_address` are captures
  of another scenario version, edited files, or captures of the wrong side.
  `start_state_dirty`, `start_state_unknown` and `parity_unknown` are the
  prober's cases on the clone side: reset, confirm, capture again.
  `parity_unstable` means the clone's captures disagree with each other,
  which is more often a snapshot taken too early than a fault in the clone:
  run the item's removal, evaluate, and capture again one at a time. Tell
  the lead only if the same difference returns.
- Typical mistakes: capturing a clone process that was started before the
  last edit (a capture is bound to the files, not to the process that
  answered, so it would describe old code); copying a capture to make the
  second, which counts once; repairing clone code yourself.

## The clean-room wall

Builders read `specs/`, `obligations/`, `behavior/` and `gate.json`. They
never read `evidence/` or `scout/`, which hold the original's scripts and
pages. Nothing enforces this wall: it holds only while the roles keep it,
and in one recorded run the clone's client script followed the scripts in
`scout/` statement by statement. The
referee's clean-room check finds the original's names and identical files
and nothing more: code retyped from the original's scripts passes it and is
still copying.

- Interface identifiers are kept, because parity compares them: routes, field
  names, error codes, status codes, control labels.
- Product names, logos, images, fonts and long copy are replaced. The lead
  declares each replaced text as a rename in `intended-differences.json`, so
  the comparison expects the clone's wording.
- `specs/` crosses the wall. The spec writer describes behavior there and
  quotes no source.
- One agent that has played scout cannot unread the original's scripts. It
  still writes the clone with only the builder's files open, and does not
  follow a script from `scout/` statement by statement. If the user needs
  builders who never saw the original, the builder must be a helper with its
  own context.

## One agent or a team

One agent: take the first item of `next`, read that role's card and nothing
else, do the item, evaluate. `rea guidance --query "clone run prober"` finds
one card; read it with the locator the match returns.

A team: the lead keeps the loop and gives a helper four things: the rules for
every role, one card, the run folder path and one `next` item, copied as
printed. The helper answers with the paths and ids it wrote.

- Only the lead evaluates. Two evaluations at once interleave their outputs.
  A helper whose item ends in the evaluation command returns instead. A
  helper that wants a preview runs `rea compare-scenario-behavior` on the
  capture files: it writes nothing, and it is not a verdict.
- Run two helpers at a time on a four-CPU machine: a capture is a browser
  plus a Node process.
- Work on different files runs side by side: scenarios per surface,
  obligations per area, clone code per area with assigned paths.
- An instance serves one capture at a time, and nothing else talks to it
  meanwhile. A run has one address per side, so captures queue per side: one
  prober on the original, one verifier on the clone. A builder who wants to
  try a request starts an instance of its own on another port.
- Stop builders before the lead evaluates for the verifier, and keep them
  stopped until the captures are in.

## Capture judgment

- Reset, then confirm, before every capture. Run the side's reset command,
  then its health command, and read the state the fingerprint reads. Do not
  trust a process id you wrote down: an agent has captured a used instance
  after recording the wrong one. Check that the old process is gone and the
  new one owns the address.
- Keep the outer `timeout` the worklist command carries, and put one on every
  capture you write yourself. A capture that timed out or was cancelled has
  already changed the instance: reset, retry at most twice, then write an
  unknown.
- A step is compared on its outcome, its requests, their statuses, the
  bodies of fetched replies, the page address and the page's accessibility
  text. Nothing else is: not appearance, styles, images, fonts, response
  headers, the document title or timing, not the text inside an iframe, not
  the text of an alert, confirm or prompt dialog, and not the content of a
  file saved through a download. A rule that shows only there cannot be a
  step: write it as an unknown.
- Missing data is unknown, never a match. Do not argue with it and do not
  edit anything. Only a lost reply body is supplied by one more capture; the
  item says when a capture cannot help. Some data never arrives: a reply
  over 64 KiB, the content of a downloaded file, a request to another
  origin.
- A step whose data no capture of either side can record can only become
  `setup-`; its item gives no capture command. That is a decision about
  coverage, not a repair: its rule is no longer compared, so the obligation
  that cited it becomes inferred or goes. Data only one side lacks is a
  difference between the sides and blocks on a `setup-` step too.
- A list is compared position by position, also under a `*` declaration. A
  list whose order varies between captures has to be requested in a fixed
  order, such as with a sort parameter.
- On-screen text cannot be declared volatile. A date or a clock shown on
  screen makes its step differ between days: capture both sides on the same
  day, or keep such text off the pages a scenario shows.
- An application that prints its own address, with or without the scheme,
  needs no rename: the original's own address is read as the clone's.
- Probe the rules, not the happy path: empty and whitespace-only input, both
  sides of every limit, the wrong type, a missing field, the same thing twice,
  an unknown id, a wrong method, order after several writes, read after
  delete. Error replies often state the limit.
- A `request` step records the reply itself, so use one for what a route
  answers, errors included. It does not follow a redirect and fails on one,
  which cancels every later step: reach a redirect through the page.
- Probe a file behind a download link with a `request` step for the file's
  address. The click that saves it is never recorded, so it is `setup-`.
- Probe a page with `goto` and its on-screen text. A `request` step for a
  page's address compares the markup as one text, which a clone with markup
  of its own never matches.
- A UI action's own snapshot can precede the render it causes, and the
  request it triggers can land in the next step. When the action's request
  succeeds, make its step wait for the reply, as the click in
  `examples/scenario-pages.example.json` does. That wait fails the step when
  the reply is not 2xx, so for a notice the page shows after a refusal, name
  the click `setup-`, follow it with a step that waits for the notice, and
  cite that step. A role locator does not take the roles of a notice, so
  wait for it by attribute, such as `[role=alert]`.
- A rule known only from reading code is inferred until a step shows it on
  the original. Inferred obligations block.
- Restart the clone after every edit and before capturing it.

## Waivers, declarations and when to stop

<!-- keywords: stalled, give up, done, waiver, declared difference -->

A waiver is a named person accepting a stated gap. Only the user, or a person
the user names, grants one; the lead records the person and the reason in
`waivers.json`. An agent never supplies the name. A headless run that would
need a waiver stops and reports instead.

- A waiver can cover an unknown proposal or an inferred obligation. Nothing
  else: not a difference, not missing data, not an unstable step.
- Acceptable: a rule that cannot be observed inside the scope, such as one
  behind a sign-in or one that needs a write the user does not allow.
- Not acceptable: anything a probe could show inside the scope, or a waiver
  whose only purpose is an empty worklist.
- The verdict then reads `done_with_waivers`. Report it in those words and
  list each waiver.

Renames and volatile fields are declarations, and only the lead makes them.
A rename can explain away any text difference, and the referee cannot tell an
honest one from a convenient one: it lists those that took effect under
`declared`, and the lead reports them with the verdict. Renames apply in file
order, each to the result of the one before, so a sentence that contains the
product name is declared before the product name itself. A rename matches
one spelling exactly, so the name in capitals is a rename of its own.

Stop when the referee exits 2. `stalled` means the team acted and nothing
improved: the round limit is reached, or the same findings were judged again
on the same clone files, as [the loop](#the-loop) says. Do not delete the
journal to start the count again, and do not waive your way out. Report what
is unproven: the `blocking` reasons, the items still in `next` and the open
unknowns. A stall whose only reasons are missing data is still a stall: name
the steps, and let the user decide whether to capture again, give up as
`setup-` a step whose data neither side can record, or stop.

Stop as well, at any point, when a protection or a sign-in is in the way,
when the user's authorization does not cover what the next step needs, or
when the only way forward is to copy.
