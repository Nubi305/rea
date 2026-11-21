# Round 3: what the comparer now gives the referee

For the agent who changes the referee after the comparer package. It says what the comparer emits, what
it exports for you, and each place of the referee that has to change because of it. Rule and decisions:
`fix-decisions-round3.md`. Worktree `/home/user/rea-wt/comparer3`, branch `fx3/comparer3`, commit
`46827701`.

The referee compiles and its own tests run against this branch untouched, except the two tests of section 9.
Everything the referee imports from `src/domain/scenarioBehaviorComparison.ts` still exists under the same
name. New members of the schemas are optional, so your fakes still parse.

## 1. Where things are

| File                                                   | What it holds                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `src/domain/scenarioBehaviorComparison.ts`             | the contract: schemas, categories, units, limits, the order of a step's findings    |
| `src/domain/scenarioBehaviorComparisonUnits.ts`        | `judgeUnit`: the rule's table, one unit at a time                                   |
| `src/domain/scenarioBehaviorComparisonDeclarations.ts` | `scenarioVolatileDeclaration`, `scenarioVolatileDeclarationNames`                   |
| `src/domain/scenarioBehaviorComparisonCoverage.ts`     | what is compared and what is not, field by field of a capture record                |
| `src/application/scenarioBehavior/`                    | the comparer itself; `scenarioBehaviorCapture.fixture.ts` builds captures for tests |

## 2. A finding

```
{ dimension, category, request, pointer, expected, actual, side,   // as before
  unit: { kind, name?, index? },                                    // always present now
  observations?: { left, right },   // captures of each side the judgement rests on
  disagreeing?: number[],           // repeats-differ: indexes into comparison.right.captures
  reasons?: string[] }              // not-recorded, and value about a size limit
```

`expected` and `actual` are `null` for a side that does not hold the unit (a request it does not send, a
member or a line it lacks). They are never a placeholder text, so "the clone has nothing there" is
`actual === null`.

The vocabulary is closed: `SCENARIO_FINDING_CATEGORIES`. `scenarioFindingStatus` still reads the step status
from the category alone.

| Category              | Step     | `side`         | Left                                                                 | Right                                                                                         | Carries                                                                                                                |
| --------------------- | -------- | -------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `value`               | changed  | null           | steady over 2+ observations, or never holds the unit                 | steady, another value; or holds what the left never does; or lacks what the left always holds | `observations`; `reasons` when one side is over a size limit                                                           |
| `shape`               | changed  | null           | varies (declared, or on-screen lines, or members under varying keys) | outside what the left's values share                                                          | `observations`                                                                                                         |
| `missing-step`        | changed  | null           | has the step                                                         | lacks it                                                                                      | `expected` is the step id                                                                                              |
| `repeats-differ`      | unstable | always `right` | steady over 2+ observations                                          | its own captures disagree                                                                     | `observations`, `disagreeing`; `actual` is what the disagreeing captures hold                                          |
| `undeclared-volatile` | unstable | always `left`  | its own captures disagree                                            | not looked at                                                                                 | `expected` is two of the left's own values, `a \| b`, with `<absent>` for a capture that lacks the unit; `actual` null |
| `single-observation`  | unknown  | `left`         | one observation                                                      | anything but equal in every capture                                                           | `observations` (`left` is 1)                                                                                           |
| `declared-not-shown`  | unknown  | `left`         | declared volatile, steady                                            | another value of the same shape                                                               | `observations`                                                                                                         |
| `not-recorded`        | unknown  | the side       | see section 4                                                        |                                                                                               | `reasons`; no values                                                                                                   |
| `not-completed`       | unknown  | the side       | the step did not complete on the left, or was cancelled on the right |                                                                                               | `expected` or `actual` is the outcome                                                                                  |
| `other-origin`        | unknown  | the side       | unchanged from round 2                                               |                                                                                               |                                                                                                                        |

Gone: the category `status` (a status difference is `value` in dimension `status`), every category of the
old JSON differ (`missing-field`, `extra-field`, `length`, `order` and the rest: a missing or added member is
`value` with unit `member`, a list of another length is `value` at the members it lacks or adds), and
`repeats-differ` on the left (the left disagreeing with itself is always `undeclared-volatile`, also for a
unit nothing can declare).

Changed meaning, same name:

- `single-observation` is emitted for every kind of unit, and also when some clone captures agree with the
  one original value and others do not.
- `declared-not-shown` is emitted for request and page-address units too, where `pointer` is null.
- `value` now also says "a request the original always sends and the clone never does, or the reverse" and
  "over a size limit on one side only".

## 3. Units: what a finding is about

`SCENARIO_BEHAVIOR_UNITS` lists the kinds per dimension. `request` is null for step, page address and text.
`pointer` is filled only in dimension `body`.

| Dimension      | `unit.kind`                              | `unit.name`                          | `unit.index`                        | Values shown                                                                                                                                                                                                                                              |
| -------------- | ---------------------------------------- | ------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `step`         | `step`, `outcome`                        |                                      |                                     | step id; `completed`, `failed`, `cancelled`                                                                                                                                                                                                               |
| `request`      | `presence`                               |                                      |                                     | the request name on the side that sends it, null on the other                                                                                                                                                                                             |
| `request`      | `initiator`                              |                                      |                                     | `"document request"`, `"fetch or xhr request"`                                                                                                                                                                                                            |
| `request`      | `segment`                                |                                      | path segment, from 0                | the segment                                                                                                                                                                                                                                               |
| `request`      | `parameter`                              | parameter name                       | occurrence, from 1                  | the raw value; `null` for a parameter without `=`                                                                                                                                                                                                         |
| `request`      | `body`                                   | `form`, or none                      |                                     | with `name: "form"`, the form of the body in words; without a name, a text body from just before its first difference                                                                                                                                     |
| `request`      | `field`                                  | field or part name                   | occurrence, from 1                  | a form field or multipart part                                                                                                                                                                                                                            |
| `request`      | `leaf`, `member`, `container`, `members` | JSON pointer inside the request body |                                     | as for a reply                                                                                                                                                                                                                                            |
| `status`       | `status`                                 |                                      |                                     | `200`; or `a response` against `no response`                                                                                                                                                                                                              |
| `body`         | `media-type`                             |                                      |                                     | the media type without parameters                                                                                                                                                                                                                         |
| `body`         | `body`                                   | `form`, or none                      |                                     | with `name: "form"`, the form in words (`a JSON body`, `a text body`, `a binary body`, `no body`, `an HTML page`, `a body over the capture's size limit`); without a name, a text reply from just before its first difference. `not-recorded` has no name |
| `body`         | `leaf`                                   |                                      |                                     | the leaf at `pointer`                                                                                                                                                                                                                                     |
| `body`         | `member`                                 |                                      |                                     | whether the member at `pointer` is there                                                                                                                                                                                                                  |
| `body`         | `container`                              |                                      |                                     | a list against an object at `pointer`                                                                                                                                                                                                                     |
| `body`         | `members`                                |                                      |                                     | members under varying keys of the object at `pointer`: `"3 members"` against `"2 members"`, or a key of another layout                                                                                                                                    |
| `page_address` | `address`                                |                                      |                                     | the whole address, only when it is unrecorded or at another origin                                                                                                                                                                                        |
| `page_address` | `segment`, `parameter`, `fragment`       | as for a request                     |                                     |                                                                                                                                                                                                                                                           |
| `text`         | `text`                                   |                                      |                                     | the text as a whole: unrecorded, over the limit, or `the texts differ in more than 2000 lines`                                                                                                                                                            |
| `text`         | `line`                                   |                                      | line number, from 1                 | one line the original shows in every capture: both lines, or null where a side lacks it                                                                                                                                                                   |
| `text`         | `lines`                                  |                                      | the line they follow, 0 for the top | lines between two such lines: a line the clone adds where the original never has one, or a varying region of another count or layout                                                                                                                      |

Line numbers are those of the original's first text, which is the text `behavior/<scenario>.json` shows.

A request is named `METHOD /path?query#occurrence`, by the original's own spelling. A path segment or a
parameter value the original's captures do not share reads `*`: `GET /api/items/*?page=2&_=*#1`. Only the
parameters every original capture sends are in the name. The behaviour table names requests the same way.

In dimension `body`, `pointer` is exact for `value` and `shape` at a leaf. For `undeclared-volatile`,
`repeats-differ`, `single-observation`, `declared-not-shown` and unit `member` it is the pattern a declaration
would use, listed once per pattern: `*` for every list position and for every key of an object whose keys
vary (`/byId/*/title`).

## 4. `not-recorded`, and the one decision the comparer cannot make

What a capture holds of a datum is one of: its content, the fact that it was over a size limit
(`body-size-limit`, `comparison-limit`; for text, a snapshot the capture cut at its own limit), or nothing
(`response-unfinished`, `request-failed`, `no-response`, `not-readable`, `redacted` and the like). The
reasons are the Evidence's own and arrive in `reasons`.

| Situation                                                                                         | Finding                                                                                               |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| no capture of either side holds the content (over the limit on both sides included)               | `not-recorded` twice, once per side, same dimension, request and unit                                 |
| one side holds the content, the other saw nothing in any capture                                  | `not-recorded` once, for that side, with its `reasons`                                                |
| one side holds the content, the other only saw it over the limit                                  | `value`: `a JSON body` against `a body over the capture's size limit`, `reasons: ["body-size-limit"]` |
| some clone captures hold it and others are over the limit                                         | `repeats-differ` on the right, never folded away                                                      |
| a reply body one capture lost, another capture of the side recorded                               | nothing: the recorded one stands for it. Only reply bodies fold                                       |
| text, page address, request body or a response that one capture of a side lacks and another holds | `repeats-differ` (right) or `undeclared-volatile` (left)                                              |

Units that can be `not-recorded`: `body`/`body` (a reply body), `request`/`body` (a request body),
`status`/`status` (no response at all; `media-type` and the reply body are then not judged), `text`/`text`,
`page_address`/`address`, and `request`/`presence` for requests the capture could not line up, which includes
`SCENARIO_OMITTED_REQUESTS`.

**Decision needed (R1 against the rule table).** R1 says only both-sided `not-recorded` is ungated on
`setup-`, start and `fp-` steps. The rule table says a body lost on one side for a reason other than size is
"`not-recorded` as above", ungated there, and that this closes xf-1. Both cannot hold. The comparer emits the
one-sided finding with `side` and `reasons` and leaves the gate to you. What I would do: ungate one-sided
`not-recorded` only for a reply body (`dimension: "body"`, `unit.kind: "body"`), which is the xf-1 case, and
block every other one-sided `not-recorded`. The size route of the false-pass verifier no longer arrives as
`not-recorded` at all, it is `value`. The wrong clone that then hides: one whose reply at a prepared step is
wrong and is lost in every clone capture, for instance never finished. Its status and media type are still
compared.

## 5. The cut, and the order of a step's findings

`steps[].findings_omitted` is `{category: count}` for the findings the list left out. It is absent exactly
when the list is complete, so a step with exactly 20 findings and no `findings_omitted` lists all it has.
`steps[].status` is still the worst of all findings, listed or not.

Order: `changed`, then `repeats-differ`, then `unknown`, then `undeclared-volatile` last. So a cut drops what
says least about the clone first, and a cut whose `findings_omitted` holds only `undeclared-volatile` left
out nothing that can block a prepared step. Within one rank a step lists the findings no earlier step of the
scenario lists (same unit, same two values; a text line wherever it stands on the page) before those one
does. Every step is now compared on its own text, so a line that stays wrong is a finding at every step that
shows it; this order keeps it from standing in front of what the step itself adds. Your "first finding of the
step's status" therefore still picks the new one.

## 6. Declarations

`scenarioBehaviorVolatileFieldSchema` is `{step_id, pointer, of?, request?}`. `of` is `reply` (the default),
`request` or `page`. `cloneRunIntendedDifferencesSchema` extends it, so `intended-differences.json` already
accepts the two members.

| `of`      | `pointer`                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reply`   | a JSON leaf; `*` for a list position or a key of an object whose keys vary. It also covers whether the members on the way to the leaf are there                     |
| `request` | `/presence`, `/path/<index>`, `/query/<name>` or `/query/<name>/<occurrence>`, `/body` (a text body whole), `/body/<json pointer>`, `/body/<field>/<position or *>` |
| `page`    | `/path/<index>`, `/query/<name>[/<occurrence>]`, `/fragment`                                                                                                        |

`request` restricts a declaration to requests named `METHOD /path` with `*` for any one segment. On-screen
text needs no declaration. A status, a media type, an initiator, an outcome, a container kind and the form of
a body cannot be declared: when the original varies there, the finding is `undeclared-volatile` and
`scenarioVolatileDeclaration` returns null.

Two functions so that you do not rebuild the rule from spellings:

- `scenarioVolatileDeclaration(finding)` returns `{pointer, of?, request?}` to print for an
  `undeclared-volatile` finding, or null. Add `scenario`, `step_id` and `reason`.
- `scenarioVolatileDeclarationNames(declaration, reported)` says whether a declaration names a
  `volatile_fields` entry, or the unit `scenarioVolatileDeclaration` spells for a `declared-not-shown`
  finding. It replaces `volatileDeclarationCovers`, which only knows reply pointers.

`volatile_fields[]` entries carry `of` and `request` when the unit is not a reply field. Every unit a
declaration names is listed, whatever their number; only undeclared ones are capped at 20 per step, the rest
counted in `limitations`. Entries with `of: "text"` and pointer `/lines/<n>` are the lines after line `n` that
vary on the original's screen. They have `declared: false, honoured: true`: compared by number and layout
only, without any declaration and without a finding.

## 7. `addresses_applied`

Up to four entries now: the original's origin, its bare `host:port`, and each of the two percent-encoded.
The reading applies to on-screen lines, strings of request and reply bodies, text bodies, form values, path
segments, query values and the page address. `expected` is still the value as compared. `addressNote` keeps
working as it is.

## 8. What is not compared: one table

`scenarioBehaviorComparisonCoverage.ts` exports:

- `SCENARIO_NOT_COMPARED`: 17 entries `{id, what, unrecorded?}`.
- `scenarioNotComparedText()`: one sentence built from it. It is meant to replace residual lines 13 and 14,
  which are hand-written and already disagree with the code (line 13 says "its requests").
- `SCENARIO_CAPTURE_FIELD_RULES`, `captureFieldRule(field)`, `SCENARIO_RESOURCE_TYPE_RULES`: every field of
  the capture record's schema and every resource type, each either compared (with its units) or not
  compared (with the id). `scenarioBehaviorComparisonCoverage.test.ts` walks the schema and fails on a field
  nobody classified.

## 9. Where the referee has to change

Each with the finding or member that causes it.

1. **`CLONE_RUN_PREPARED_STEP_GATES`** (R1). Drop `status`; no "any other category" row is needed, the
   vocabulary is closed and can be typed by `ScenarioFindingCategory`. `repeats-differ` is always the clone
   and blocks. `undeclared-volatile` is always the original, ungated. `not-recorded`: section 4. Note 3 of the
   table's comment ("emitted only where no capture of the clone agrees") is no longer true.
   **This one must land with the comparer.** The old comparer added a `value` finding when no clone capture
   agreed with the original; the rule table has one finding there, `repeats-differ`. With the gate table as
   it is today that finding is ungated on a prepared step, so a clone that answers a `setup-` request with a
   different wrong value in every capture (original `1, 1`, clone `2, 3`) would read done. On a behaviour
   step it blocks as `parity_unstable` either way.
2. **`cloneRunStepFindingsCut`** infers a cut from `findings.length >= 20`. Read `step.findings_omitted`
   instead; it needs the step, not the list. Suggested rule: a prepared step blocks on a cut only when
   `findings_omitted` has a key other than `undeclared-volatile`. This is xf-2.
   `CloneRunParityGate.test.ts` "sees that the comparer cut a list in which a blocking finding was left out"
   fails today for this reason: of its 26 findings the comparer now lists the `declared-not-shown` one
   first, and the six it leaves out are `undeclared-volatile`, stated in `findings_omitted`.
3. **`CloneRunParityGate.test.ts` "blocks a setup step on a gap only one side shows"** fails: a reply over
   the limit on one side is `value` (changed), where the test expects `not-recorded` (unknown). The step
   still blocks.
4. **`gapSubject` / `cloneRunGapShared`**: add `unit.kind` to the subject. A request can now be
   `not-recorded` in its presence and in its body.
5. **`isDeclarationNotShown`**: `category === "declared-not-shown"` in any dimension. `single-observation`
   has nothing to do with declarations any more.
6. **`declarationEffects`**: use `scenarioVolatileDeclarationNames`. Drop `full`: declared units are never
   capped. For `notShown` take `scenarioVolatileDeclaration(finding)` instead of `finding.pointer`, which is
   null outside reply bodies.
7. **The compare request in `evaluateCloneRun`** maps declarations with
   `.map(({ step_id, pointer }) => ({ step_id, pointer }))`. That drops `of` and `request`, so a declared
   query parameter is read as a reply pointer and never honoured. Pass both through. The same for the
   `fingerprintDifferences` call if it ever passes declarations.
8. **`honouredVolatile`** counts `honoured && side === "left"`. Text entries are honoured without a
   declaration, so add `declared` to the filter for "from N declarations", and list the `of: "text"` entries
   under R3 as lines compared by layout only.
9. **`where()`** names dimension and pointer. Name the unit (R8): for `request` and `page_address` the
   segment index, the parameter name and occurrence, the field or the body pointer in `unit.name`; for
   `text` the line (`unit.kind` `line`) or "the lines after line n" (`lines`).
10. **Collapsing steps on one finding.** The group key is the whole finding. For `text`, leave `unit.index`
    out of the key: the same line stands on another line number on another page (xf-12). `observations` can
    be left out too.
11. **`CATEGORY_TEXT`**: `order` and `length` are dead. `sidesText` works with the null values as it is.
12. **`isCloneOnlyRequest`** and its message: dead. A request only the clone sends is `value` with
    `expected: null`, also when a segment of the original's request varies.
13. **The `undeclared-volatile` message** offers a declaration only for `dimension === "body"` with a
    pointer. Offer what `scenarioVolatileDeclaration(finding)` returns; when it is null the unit cannot be
    declared and the item is the prober's. "Only a field of a JSON reply can be declared volatile" is no
    longer true.
14. **`fingerprintDifferences`** compares a side with itself and keeps `unstable` findings. Varying lines of
    on-screen text give no finding now, so the branch "text that varies by itself" never triggers. Read the
    self-comparison's `volatile_fields` entries with `of: "text"` at `fp-` steps for it. The fingerprint
    digest itself is unchanged: a per-load line on an `fp-` page step still makes the start `dirty`.
15. **R2.** `disagreeing` gives the clone captures to remove, as indexes into `comparison.right.captures`;
    `observations.left >= 4` is the "four or more steady observations" test.
16. **R3.** Ungated units are the `undeclared-volatile` and ungated `not-recorded` findings of prepared
    steps, each with its `unit`; what was compared by shape only is `volatile_fields` with `honoured`.
17. **Residual lines.** 13 and 14: section 8. 15 says a clone that differs only in a capture "over the
    capture's 64 KiB limit" is not detected; over the limit is now an observation that never folds, so that
    half is false. Line 8 should add the two new by-shape comparisons: lines that vary on the original's
    screen, and members under keys that vary.
18. **Messages that offer `setup-`** for an unsteady clone or a one-sided gap: not a remedy under R1.
19. **`src/cli/cloneRunCommands.ts`**: the `--differences` help says a volatile field names "one reply
    leaf". It can name a request or page unit with `of` and `request`.
20. **R4.** `ScenarioBehaviorComparer` has no method that makes a stand-in clone with one unit changed, and
    the referee is generic over the capture type. Canaries need either such a method or the production
    capture's `observations` (`StepObservation` in `scenarioBehaviorCapture.ts`). Not in this branch.

## 10. The behaviour table

`behavior/<scenario>.json` is written from `comparer.describe`, so it already has the new form:

```
{ table, captures,
  texts: ["<each distinct on-screen text once, in the order of its first step>"],
  steps: [{ step_id, kind, action, outcome, page_address,
            text: 0,                 // index into texts, or null when not recorded
            transactions: [{ request, request_body, status, reply }],
            volatile_pointers }] }
```

`expandScenarioBehaviorTable(table)` gives the round-2 form. A reply left out for its size or for being
binary is `{kind: "omitted", reason, read: {file, pointer}}`: the Evidence file and the JSON pointer of the
body inside it. Page markup has no `read`. Rows are the matched requests of all captures, named as findings
name them, so a request only a later capture made has a row. The playbook and any item that tells a builder
to read `text` at a step have to say it is an index.

## 11. `npm run verify:clone-run` on this branch

20 of 20 cases pass on commit `46827701` with the referee untouched. Before the order of section 5 the case
"the literal text {origin} where the original prints its own address" failed: the item for `board-facts`
showed the text line again instead of body `/address`.

It has no cases for xp-1 to xp-4 yet. They are in the comparer's tests and were read on the verifier's own
recorded Evidence. End to end they need item 7 above first: xp-3's correct clone has a cache-busting
parameter that is `undeclared-volatile` until `{of: "request", pointer: "/query/_"}` is declared.

## 12. What your change will move

- **The trial replay.** With the referee untouched it still reads `not_done` on `unknown_open` alone, 645
  steps unchanged and 20 unstable, all ungated. One of the 20 is the clone, not the original: scenario
  `pages`, step `setup-click-parcel-weight-not-a-number`, `text` `repeats-differ` on the right, the lines
  after line 12, `observations {left: 10, right: 2}`, `disagreeing: [0]`, `actual` `- alert: Enter a weight
  above zero`. The round-2 comparer reported the same. Under R1 it blocks, so the trial will then read
  `not_done` with a `parity_unstable` item beside `unknown_open`. The other 19 are `undeclared-volatile` on
  the original (44 findings, generated ids and timestamps in setup replies).
- **The reference page.** I changed only "Compare captures directly", "Comparison rules", "The behavior
  table" and the comparison rows of "Ways to a false pass". Three of those rows wait for you: "Answer
  rightly in one capture and pad the reply past the limit in another" says `parity_unstable` at a behavior
  step, which R1 widens to every step; the two rows "not stopped: compared by shape only" point at
  "Comparison rules" because no residual line states them yet (item 17).
- **The context ledger.** Measured with one `--work` folder on both builds: `clone.behavior` falls from
  81,011 to 47,020 bytes, because each text is stored once; `clone.loop.stdout` (32,187 against 32,161
  o200k) and `clone.verdict.ten-items` (9,854 chars on both) do not move. They depend on your messages from
  here on. A `--work` folder with a longer path than the default breaks both ceilings on either build,
  because the path is printed in every item.

## 13. Limits that remain in the comparer

- With one original capture every difference is `single-observation`, never `changed`.
- A line the original's captures disagree on is compared by count and layout: another word of the same
  layout passes. The same for an honoured declared unit.
- Members under varying keys are compared as an unordered set: values swapped between two members pass.
- A reply body lost in one clone capture is supplied by another, so a clone wrong only there passes.
- A date that is steady across captures taken together still differs tomorrow.
- A text reply that is not JSON is one unit, compared whole.
