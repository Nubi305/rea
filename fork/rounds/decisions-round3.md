# Fix round 3 for clone runs: decisions

Round 2 (head 0e089b3) was re-checked by two independent agents. Their full results are in
`/home/user/rea-design/m1/verify-round2-extract.txt` and `fix2-result.json` (member `verify`). Ids used here:

- `xp-1` to `xp-8`: the eight new findings of the false-pass verifier, in the order of that file.
- `xf-1` to `xf-15`: the fifteen new findings of the false-failure verifier, in the order of that file.

Four of them are ways to `done` for a wrong clone (xp-1 to xp-4), and three are correct clones that round 2
made fail (xf-1, xf-2, and the after-write recipe). This file decides what happens. It overrides the two
earlier decision files where they differ.

## Why this round is different

Three rounds of fixes each closed the routes that were found and left the next ones open. The four new
routes have one cause. The comparer compares in units that are too coarse (a page's whole text, an exact
request line, a field's presence and value together), so one small source of noise on the original makes the
whole unit "unsteady", and an unsteady unit is then let through on `setup-`, start and `fp-` steps. Patching
each route again would leave the cause.

So this round replaces the rule, and proves the new rule with generated cases instead of hand-picked ones.

## The rule (owner: the comparer package)

**P1. Noise is subtracted at the smallest unit the data has.** A difference is noise only at the exact unit
where the original's own captures disagree with each other.

**P2. Everything the original holds steady, the clone must match, on every step, whatever its prefix.**
`setup-`, `fp-` and the start step relax only the units that are themselves unsteady or unrecorded.

For one unit of one step, with the original's captures on the left and the clone's on the right:

| Left                                      | Right                     | Finding                                                                                                                                                                                                                                   |
| ----------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| steady, two or more observations          | every capture equal to it | unchanged                                                                                                                                                                                                                                 |
| steady, two or more observations          | steady, another value     | `value`: changed, blocks on every step                                                                                                                                                                                                    |
| steady, two or more observations          | captures disagree         | `repeats-differ` on the right: unstable, blocks on every step (see R2)                                                                                                                                                                    |
| one observation                           | equal in every capture    | unchanged                                                                                                                                                                                                                                 |
| one observation                           | anything else             | `single-observation`: unknown, blocks on every step (closes xf-7 for every value, not only timestamps)                                                                                                                                    |
| captures disagree, unit declared volatile | same shape                | unchanged (honoured)                                                                                                                                                                                                                      |
| captures disagree, unit declared volatile | another shape             | `shape`: changed                                                                                                                                                                                                                          |
| captures disagree, not declared           | anything                  | `undeclared-volatile`: blocks a behaviour step until declared; ungated on `setup-`, start and `fp-` steps for that unit only                                                                                                              |
| declared volatile but steady              | another value             | `declared-not-shown`: unknown, blocks on every step (unchanged from round 2)                                                                                                                                                              |
| not recorded on either side               |                           | `not-recorded`: blocks a behaviour step; ungated and named on the others                                                                                                                                                                  |
| not recorded on one side only             |                           | by the reason the Evidence records: over the size limit on one side only is `value` (changed); a body lost for another reason folds with that side's other captures, and if none recorded it, it is `not-recorded` as above (closes xf-1) |

**Presence and value are separate units (closes xp-1).** A field, a request or a line that some of the
original's captures lack is unsteady in presence only. Its value is steady if every capture that holds it
holds the same value, and then the clone's value must equal it wherever the clone holds it. One holder is one
observation.

**Units, by dimension:**

- **On-screen text (closes xp-2, and lifts the on-screen date limit).** Lines. The lines common to all of the
  original's captures, in order, are its skeleton; the same for the clone. The two skeletons must be equal
  after renames and the address reading: a line missing, added or different is `value`. Between two skeleton
  lines, the original's varying lines are noise: the clone must have lines there too when the original always
  does, the same number when the original's number is steady, and of the same layout. No declaration is
  needed for a clock or a counter shown on screen. Text findings name the line, and findings that differ in
  the same line collapse into one (xf-12).
- **Requests (closes xp-3, xp-4, xf-4, xf-5, xf-6).** The requests of a step are matched across captures and
  across sides by method and path, with the best agreement of path segments when paths differ; order within
  a step is not a unit. For a matched request the units are: whether it was sent (presence); each path
  segment; each query parameter by name and occurrence; the request body by its parts (JSON leaves,
  form fields, multipart parts by name with the boundary removed, otherwise the whole); the reply's status,
  media type and body. A cache-busting parameter, a multipart boundary or a generated id in a path is noise
  in its own unit and the rest of the request and its reply are compared. A request the original always
  sends and the clone never does, or the reverse, is `value`. A request only some of the clone's captures
  send, where the original never or always does, is `repeats-differ` on the right, not `value`.
- **The application's own address.** Read as the other side's in every text unit: on-screen lines, reply
  strings, request path segments, query values and request bodies, in plain and percent-encoded form. A
  clone that sends or prints the original's address is `value`. Counted in `addresses_applied`.
- **Reply bodies.** Leaves as today, containers by kind first, lists by position. An object whose set of
  keys differs between the original's captures: its steady keys are compared as any field; the members under
  varying keys are compared by count and by shape (closes xf-11 as a stated rule), and the comparison says so
  in `limitations`.
- **Step outcome and page address.** The path by segment and the query by parameter, as for requests.

**Cuts.** The comparer says whether it left findings out. The referee never infers a cut from a count
(closes xf-2).

## Proof (owner: the comparer package; this is the acceptance of the round)

- **Sensitivity, generated.** A property test with the repository's `@fast-check/vitest`: generate an
  application model with every noise source above (varying and optional fields, per-load lines, cache-busting
  parameters, multipart bodies, generated ids in paths and as object keys, polled requests, the own address
  in each position, lost bodies), draw two or three captures for the original, draw the clone's captures from
  the same model with independent noise, then change one steady unit in every clone capture. The comparison
  must not read `unchanged` and must name that unit, for every dimension, every step kind (behaviour,
  `setup-`, `fp-`, start), with any set of volatile declarations that does not name the unit.
- **No false change, generated.** With the clone drawn from the same model and nothing changed, no finding
  is `value`, `shape` or a missing or extra request. Unsteady findings are allowed only where a unit really
  varies, and once every varying unit is declared the comparison reads `unchanged`.
- **Closed world.** A test walks the capture record's schema and requires every recorded field to be
  classified as compared (with the unit that compares it) or not compared (with the residual-trust line that
  says so). A field nobody classified fails the test. The list of what is not compared (response headers,
  cookies, the document title, data loaded through script elements, event streams, sockets, beacons, images,
  fonts, the order of requests in a step, frames, dialogs, appearance) is generated from that table into the
  residual-trust text, so the two cannot drift (closes xp-8).
- **Recorded cases.** Every reproduction saved by the verifiers (`xp-*`, `xf-*`, and the earlier `vp-*`,
  `vf-*`, `cheat-*`, `reality-*` scripts) reads as this file says, the 51 recorded scenarios read the same or
  differ only where this file changes the rule, the trial replay still reads `not_done` on `unknown_open`
  alone, and `npm run verify:clone-run` passes with new cases for xp-1 to xp-4.

## Referee (owner: the referee package)

- **R1, the step gate follows P2.** The only findings that do not block on `setup-`, start and `fp-` steps
  are `undeclared-volatile` and both-sided `not-recorded`. The table in `cloneRunStepGate.ts` shrinks to
  that. The referee stops offering the `setup-` rename as a remedy for anything else.
- **R2, a clone that disagrees with itself.** `repeats-differ` on the right goes first to the verifier with
  one more capture of each side. When the original has four or more steady observations of the unit and the
  clone's captures still disagree, the item goes to the builder: the clone answers differently from one run
  to the next where the original never does. The removal command names only the captures that disagree with
  the majority, never all of them.
- **R3, what a pass did not compare (closes xp-7).** The gate lists every step with an ungated unit, with the
  unit and the reason, the summary of a pass ends with their count, and a residual line says what an ungated
  unit proves (nothing about the clone there).
- **R4, canaries.** After a pass, and on request otherwise, the referee takes the original's own admitted
  captures as a stand-in clone, changes one steady unit at a time (bounded: one per unit kind per cited
  step), and reports under `sensitivity` how many changes the comparison caught and each one it did not,
  with the declaration, rename or prefix responsible. It is a report, not a check, in this round.
- **R5, closed unknowns leave a trace (closes xp-6).** `declared.closed` lists each unknown closed against an
  obligation, the summary counts them, and the `unknown_open` item no longer prints a fill-in line that any
  passing obligation satisfies: it says the obligation must cite a step that shows the answer.
- **R6, entries that are not regular files (closes xp-5).** A link, directory, special file or dot file in
  `scenarios/`, `obligations/` or `unknowns/` is `scenario_invalid`, `obligation_invalid` or
  `unknown_invalid`. One rule for links for every authored file: not followed.
- **R7, a dirty start hides nothing else but adds nothing either (closes xf-9).** Parity items of a side and
  scenario whose start state is dirty are not listed until the start-state item is done; removal commands
  never name a clean capture.
- **R8, messages.** xf-8 (the list sentence first, before any removal advice, and addressed to the prober),
  xf-13 (the five dead ends), xf-14 (a port the browser refuses is refused at init with the reason), and the
  messages that follow from the new units (a text item names the line; a request item names the parameter,
  segment or part).
- **R9, exit status.** `done_with_waivers` exits 3 with `--exit-code`, so that exit 0 means `done` and
  nothing else. Documented, tested, and used by the verifier script.
- **R10, the referee's own output stays small** (from the audit, same files): capture commands print a
  receipt, not 25 KB (xf-15); a verdict stays under 6,000 characters with the rest in `gate.json`; paths are
  relative to the run folder with the first line saying where to run them; a session that knows only the run
  folder is told in one line how to read its role's card; `rea evaluate-clone-run <run> --step
  <scenario>/<step>` prints one step's behaviour and findings; text from either application appears only in
  members marked as target text, never inside the referee's own sentences; and printed commands use nothing
  a stock macOS or Windows shell lacks (no `timeout`, no `rm`, no environment prefix), which needs C3 below.
- **R11, behaviour tables.** Each distinct text is stored once and referenced; a reply left out of a table is
  named with where to read it (owner: the comparer package, which writes the tables).

## Captures (owner: the capture package; the earlier rule against changing captures is lifted for it)

The verifiers traced most false failures to the capture layer, not to clones: a reply body the page never
reads is recorded in 4 of 43 captures; under load a `no-store` route loses 7 to 12 of 12 bodies; a clone that
answers 300 ms slower fails the playbook's click recipes because the snapshot is taken when the action
returns; a capture can hang without a deadline.

- **C1, bodies.** A reply body is recorded whether or not the page reads it and whatever its cache headers,
  up to the size limit, deterministically under load. The Evidence still says why when one is not recorded.
- **C2, actions wait for what they trigger (closes xf-3).** A UI action can name the reply it waits for by
  method and path and by any status or a set of statuses, and its snapshot is taken after that reply. The
  existing wait keeps its meaning.
- **C3, a deadline per step and per capture** inside the command, so no outer `timeout` is needed, with the
  step that ran out named in the Evidence.
- **C4, refusals with a cause**: a port the browser refuses, and any navigation error the browser names, are
  classified with the remedy instead of "did not classify the failure".
- **C5, body limit as an input** the run can set once for both sides (the capture already accepts it; the
  referee's renderer passes it through and it is part of the scenario digest).
- Every change is additive in the Evidence schema, proven on a fixture application that reproduces each
  defect before the fix (a route the page never reads, `no-store` under load, a slow reply, a hang), and
  measured: the loss rate over at least 40 captures before and after.

## Not in this round

Sign-in with an account the user supplies, held-out scenarios, coverage of the original's code, page
structure beyond text, screenshots, and exploration. They stay on the plan.

## Stop rule

The referee is called trustworthy only after two consecutive independent verification rounds, each on an
application the fixers never saw, find no new way to `done` for a wrong clone. Round 3's verifiers use the
two new benchmark applications, which have the realistic mess the last round's verifiers pointed at.
