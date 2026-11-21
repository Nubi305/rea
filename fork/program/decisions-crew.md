# The clone crew: the lead's decisions

Why: the one agent that cloned an unseen application alone needed a peak context of 475,393 tokens. Of the
443 KB of tool results it read, REA printed 171 KB and the skill 77 KB, and it wrote 269 KB of its own tool
arguments, most of it the clone's code. Making REA print less is necessary and not enough: the work has to
be split so that no agent holds all of it. The playbook already names seven roles. This package makes the
split real and measures it.

## Decisions

1. **The referee drives.** The crew is a loop around `rea evaluate-clone-run`. Its `next` items are the work
   queue. A role agent receives one item, or the items of one role for one scenario, and its role card, and
   nothing else. Nobody but the referee says done.
2. **State lives in the run folder, never in an agent.** A role agent writes files and returns a receipt of
   at most ten lines: what it wrote, what it could not do. The lead reads receipts and the next verdict,
   never a payload. Any agent can be replaced mid-run, and a run can be resumed by starting the loop again:
   its first act is an evaluation.
3. **One loop, three drivers.** (a) A workflow script for harnesses that orchestrate agents
   deterministically: the script is the lead. (b) Role agents and a start command for a client with named
   subagents: the main session is the lead and follows the lead card. (c) A single agent that plays the roles
   in turn, with a fresh context per role where its client allows. The role cards are the same text in all
   three; only who dispatches differs.
4. **Bootstrap, then the loop.** Before the first judged round: scout, mapper, probers by area, spec writer.
   Then builders by area, the verifier's captures, an evaluation. After that only the worklist decides who
   works. The crew does not invent phases the referee did not ask for.
5. **One instance, one capturer.** Captures of a side are serialized, each from a reset. Only the verifier
   captures. Probers and builders may work in parallel where their files are disjoint (an area's scenario and
   obligation files; an area's part of the clone).
6. **The wall is enforced where the client can enforce it, and audited everywhere.** Builders do not read
   `evidence/`, `scout/` or the original's address. Where a client has hooks, a hook refuses the read and
   journals it. Where it has none, the rule is in the builder's brief, and the run's transcripts are audited
   for it afterwards. The referee reports what it was given: reads refused, reads journaled, or "not
   enforced on this client".
7. **Budgets.** Each role agent has a box in turns or minutes; the loop stops at the run's `max_rounds`. A
   role that runs out reports what is left and the next evaluation re-issues it.
8. **Roles need not share a model.** The driver takes a model per role. Scouting, mapping and capturing are
   reading and bookkeeping; building is the role that needs the strongest model.
9. **Nothing here widens what REA may do.** The crew uses the same commands as a single agent. It starts and
   resets the original only through the commands the user gave at `init-clone-run`.

## The judge

The clone benchmark, same three applications, same agent label, two arms: one agent alone, and the crew.
Per run: the referee's verdict; hidden rules that agree; the largest peak context of any agent; total tokens
over all agents; wall time. The crew earns its place if it reaches at least the single agent's hidden-rule
agreement with a largest peak context under 150,000 tokens, and it is reported honestly if it costs more
tokens in total, which it may.

## Order

After fix round 3 is merged (role cards and worklist forms change there). First the workflow driver and the
benchmark's crew arm, because that is the one this environment can run and measure. Then the role agents,
start command and hook for a client with subagents, verified against that client's current documentation.
