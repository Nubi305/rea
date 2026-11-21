# Clone benchmark applications

Each application under `apps/<id>/` is a small web application that an agent
under test is asked to clone without seeing its source. The harness
(`bench/harness/clone-prepare.mjs`, `clone-score.mjs`) reads the layout below.
`bench/README.md` says how a run is prepared, launched and scored.

```
apps/<id>/
  app.json                  what the agent is told about the application
  original/                 the application's source; the agent never sees it
    ctl.sh                  start | stop | reset | health
    ...                     server and static files
  hidden/                   the author's secrets; the agent never sees them
    rules.json              the hidden rules and the steps that show each one
    <scenario>.json         one file per held-out scenario
    heldout-differences.json
    HIDDEN.md               the rules in prose, for people
    selftest-mutant.json    optional: one rule broken by one replacement
```

`node bench/harness/clone-check-app.mjs --app <id> --judge <checkout>
--ports <a>,<b>` checks an application against this layout and replays its
held-out scenarios on two instances of the original: every step must come out
`unchanged`. It lists what breaks the layout as `layout_problems`. With
`--apps <directory>` it checks an application that is not under `apps/` yet.
Two more ways to run the second instance:

- `--clone-source <directory>` runs it from another copy of the source, such
  as one whose ids, classes and data attributes were renamed. It must still
  agree on every rule: that is how to show the scenarios are portable.
- `--mutant` runs the original with `hidden/selftest-mutant.json` applied
  (`file`, `find`, `replace`, and `breaks`, the rules that must then
  disagree). It must disagree on exactly those rules and agree on every other.

## app.json

| Key                  | Holds                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | the directory name                                                                                                                                          |
| `product_names`      | the product and brand names that appear in the application, exactly as spelled; the agent is given them, and the clone may not contain them                 |
| `public_description` | what an owner would tell someone asked to clone it: two or three sentences, no rules. `{address}` stands for the address the original is served at in a run |

## original/

- Node standard library only, one process, one origin, no sign-in and no
  request to another host. Data lives in memory and is rebuilt from a seed, so
  a restart is the reset.
- Deterministic after a restart, apart from the fields
  `heldout-differences.json` declares volatile (generated ids, timestamps).
- `ctl.sh start|stop|reset|health`. `PORT` selects the port. `start` refuses a
  port that is taken, `reset` is stop then start and returns only when the new
  process answers, `stop` returns when the port is free, `health` exits 0 when
  the application answers. It must work from wherever the directory is copied
  to: the harness never runs the copy in the repository.
- Stays inside what clone runs support: every reply under 64 KiB, no
  `Cache-Control: no-store`, no redirect to another origin, no cookies. A
  reply a held-out step requests must keep to this; with `no-store` the
  capture loses reply bodies at random and the step comes out `unknown`.

## hidden/

`rules.json`:

```json
{
  "application": "Varnholt",
  "scenarios": { "heldout-rules": "heldout-rules.json" },
  "differences": "heldout-differences.json",
  "rules": [
    {
      "id": "R05-code-unique",
      "difficulty": "edge",
      "rule": "A code in use is refused whatever case it was typed in.",
      "cases": [
        { "scenario": "heldout-rules", "step_ids": ["manifest-code-taken"] }
      ]
    }
  ]
}
```

- `scenarios` maps a scenario id to its file in `hidden/`. A list of ids is
  read as `<id>.json` each.
- `differences` names the declared-differences file; the default is
  `heldout-differences.json`. It holds `volatile_fields` only. Its scenario
  names are the ids above. The scorer adds the renames itself: one per product
  name, to the clone's name.
- Every rule cites at least one step, and every cited step exists in its
  scenario. Cite every step whose answer the rule decides, setup steps
  included: a step that prepares a refusal shows the rule as much as the
  refusal does.

Held-out scenarios are in the address-free format of a clone run
(`start_path`, `actions`, `{origin}` in a `goto` address), with the `fp-`
steps first. Three things keep them usable on a clone nobody has seen:

- Find elements by role and name, by a role or ARIA attribute, or by the text
  they show (the browser's text selector, `text="exact text"` or
  `text=/pattern/`, as a `css` locator), never by an id, a class or a data
  attribute of the original's markup. A clean-room clone cannot be asked to
  reproduce those, a step that waits for one fails on the clone, and no step
  after a failed step runs.
- Make a wait independent of what a rule decides: wait for the shape of a
  message (`text=/^Requested /`) or for an element the rules do not move, not
  for the value a rule computes. A clone that breaks the rule then gets past
  the wait, and the step shows the difference; otherwise the step fails and
  every later step goes undecided.
- A click whose effect arrives after a request waits for it (`save_response`,
  or a `wait_for` on what appears).
- Two instances of the original must compare `unchanged` on every step with
  the differences file. `clone-check-app.mjs` proves it, and reports every
  step that finds an element by anything but a role or ARIA attribute.

## How a rule is scored

Both applications are restarted clean, each scenario is captured twice per
side through the pinned judge checkout, and
`rea compare-scenario-behavior --detail complete` gives every step a status.
A rule then reads:

| Rule        | When                                                           |
| ----------- | -------------------------------------------------------------- |
| `agrees`    | every step it cites is `unchanged`                             |
| `disagrees` | a step it cites is `changed`                                   |
| `undecided` | no cited step is `changed`, and one is `unknown` or `unstable` |

The score counts each. Only `agrees` says the clone matched the original on
the rule, and only as far as the cited steps probe it.

## varnholt

The application of the first blind trial (2026-11-20). `original/` and
`hidden/` hold that trial's files byte for byte. Three files were added:
`app.json`, `hidden/rules.json` (the trial gave the mapping of steps to rules
in `HIDDEN.md` only) and `hidden/heldout-pages-portable.json`. The last is
`heldout-pages.json` with one locator changed, from `#notice p[role=status]`
to `[role=status]`: the element id made the step fail on every clone that did
not copy the original's markup, and left the eight steps after it unrun.
`rules.json` replays the portable file under the scenario id `heldout-pages`.

## brassnook

The second blind-trial application (2026-11-21): a rehearsal studio's room
bookings, five pages built in the browser from a JSON API, 26 rules.
`original/` is its author's copy byte for byte except one line: `GET
/api/summary` no longer sends `Cache-Control: no-store`, which made the
capture lose that reply's body at random on two unmodified instances. Its
author's `heldout-pages.json` waits ten times on `body[data-ready]` and once on
`#notice:not(:empty)`; `heldout-pages-portable.json` waits on the text or the
link the built page shows instead, and `rules.json` replays it.
`make-scenarios.mjs` writes both. The author's capture and compare scripts
and their results (`proof/`) were not brought in. `hidden/HIDDEN.md` says all
of this under "In the benchmark".

It keeps two departures from the layout that no held-out step meets: `GET
/api/export` answers 191,273 bytes, and `/activity` shows a clock.

## seedlark

The third blind-trial application (2026-11-21): a seed-packet shop rendered on
the server, with forms, a basket per browser in a cookie, an order book and a
JSON API, 33 rules. `original/` is its author's copy byte for byte. Its
author's `heldout-pages.json` waits nine times on `[data-alert=...]` or
`[data-notice=...]`; `heldout-pages-portable.json` waits on `[role=alert]` or
`[role=status]` instead, and `rules.json` replays it. `tools/gen.mjs` writes
both and, like `tools/rules.mjs`, now finds the folder from where it is. The
author's capture script and the script that built the differences file from
results kept outside the repository were not brought in.

It keeps one departure from the layout that the scenarios rely on: the basket
is held in a cookie.
