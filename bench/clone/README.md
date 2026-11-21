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
```

`node bench/harness/clone-check-app.mjs --app <id> --judge <checkout>
--ports <a>,<b>` checks an application against this layout and replays its
held-out scenarios on two instances of the original: every step must come out
`unchanged`.

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
  `Cache-Control: no-store`, no redirect to another origin, no cookies.

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

- Find elements by role and name or by a role attribute, never by an id, a
  class or a data attribute of the original's markup. A clean-room clone
  cannot be asked to reproduce those, a step that waits for one fails on the
  clone, and no step after a failed step runs.
- A click whose effect arrives after a request waits for it (`save_response`,
  or a `wait_for` on what appears).
- Two instances of the original must compare `unchanged` on every step with
  the differences file. `clone-check-app.mjs` proves it.

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
