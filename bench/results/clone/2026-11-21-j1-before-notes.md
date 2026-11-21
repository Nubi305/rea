# Clone benchmark, baseline run j1-before

Build 0e089b3e (before the context work and before fix round 3). Agent label `a1`, one agent per
application, one sample each, 80-minute box in the brief. Scores: `2026-11-21-<application>-j1-before.json`.

| | varnholt | brassnook | seedlark |
| --- | --- | --- | --- |
| Referee's verdict | `not_done` (one open unknown) | `not_done` (five open unknowns) | `done`, exit 0 |
| Hidden rules that agree on the held-out replay | 23 of 23 | 23 of 26 | 10 of 33 |
| Held-out steps unchanged | 79 of 79 | 105 of 108 | 98 of 143 |
| Peak context | 321,088 tokens | 334,515 | 289,498 |
| Prompt tokens, all turns | 20.2 million | 19.1 million | 13.4 million |
| Wall time by the transcript | 30 minutes | 31 minutes | 16 minutes |
| Captures (shim log) | 70 | 81 | 16 |
| Bytes REA printed into context | 80,231 | 76,443 | 20,375 |
| Bytes read from the skill | 84,512 | 84,512 | 84,512 |

## What it shows

- **A `done` that was not.** On seedlark the referee said `done` on the first judged round, after four
  scenarios and 16 captures, and the clone disagrees with the original on 23 of 33 hidden rules. The rules
  are replayed as two long stateful sequences, so a step after an early divergence can fail because of it and
  the count overstates the damage; but the first changed steps are independent of each other (the sort
  fallback, two status filters, an invalid filter value, SKU normalisation, the name limit, the entity tag).
  The agent's own report says it skipped scouting and mapping and that "the verdict only covers the steps the
  scenarios contain". Every check the referee makes passed: nothing in it asks whether the scenarios cover
  the application.
- **Where an agent probes widely, the clone is right.** varnholt 23 of 23 and brassnook 23 of 26, each with
  about 600 steps written by the agent. Both ended `not_done` on unknowns that no step can show and that only
  the user can accept (a body that is not JSON, a reply over 64 KiB, a clock on a page).
- **One context holds everything.** Peak context is about 290,000 to 335,000 tokens. Between 143 KB and
  186 KB of each agent's own tool arguments, most of it the clone's code and generated scenarios, sit in the
  same context as the scouting.
- **The wall is not kept by one agent.** Two of the three reports say so in as many words: the same context
  read the original's client script and then wrote the clone's.

## What it does not show

- One sample per application; no variance.
- Two cells ran at the same time on one machine, and one agent stopped processes by name
  (`pkill -f "node server.js"`), which may have stopped the other's clone once. Clone cells should run one at
  a time.
- All three agents went well past the brief's time box by their own count, while the transcripts' wall time
  reads 16 to 31 minutes: the agents estimate, the transcript measures.
