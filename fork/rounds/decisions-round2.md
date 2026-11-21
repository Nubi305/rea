# Fix round 2 for clone runs: decisions

The first fix round (decisions in `fix-decisions.md`, findings in `findings.md`) was re-checked by two
independent agents on build 77500a5. Their results are in `/home/user/rea-design/m1/findings-round2.md`
(ids `vp-1` to `vp-8`, `vf-1` to `vf-7`, plus the results listed as partly and the integrator's open
issues). This file decides what happens to them. It overrides `fix-decisions.md` where they differ.

Three of the new findings are false passes, and two of those were introduced by a relaxation the first
round's decisions asked for. The lesson for this round: a relaxation is acceptable only if it turns a
false failure into `unstable` or `unknown`, never into a match, and never into something that a step
prefix or a declaration can then silence.

## Comparer (owner: the comparer package)

- **vp-1, reverses the earlier decision on reality-12.** A volatile declaration with a `*` in its pointer
  is honoured only at the concrete positions where the original's own repeats differ. At a position the
  original holds steady over two or more observations, a different clone value is `declared-not-shown`
  (unknown), exactly as for a plain pointer. Consequence, to be stated in the message for that category
  when the pointer lies under an array: a list whose order varies between captures has to be requested in
  a fixed order, or its step named `setup-`. vf-5 is closed by the same rule and gets no relaxation.
- **vp-2.** Container kinds along the path are compared for every pair of leaves before any volatile rule
  is consulted. An array against an object is `changed` at the container whatever is declared beneath it,
  and `*` matches an array index only.
- **vp-4 and vf-3.** No placeholder text. Each side's own address is handled the way renames are: on the
  original's side, the original's start origin is replaced by the clone's start origin, and then the
  original's bare `host:port` by the clone's bare `host:port` (not when the next character is a digit),
  in on-screen text and in string values of request and reply bodies, before comparing exactly. A clone
  that prints a literal token such as `{origin}` then differs from an original that prints its address.
  The count of such substitutions is reported beside `renames_applied`. Page addresses stay compared
  relative to their origin as today.

## Referee and commands (owner: the referee package, which also owns src/cli/cloneRunCommands.ts this round)

- **vp-3.** On a `setup-` or `fp-` step, every finding in which the original is steady and the clone
  differs blocks: `changed`, `declared-not-shown`, and `single-observation` when the clone's value differs
  from the original's one observation. Only pure instability (`repeats-differ`, `undeclared-volatile`) and
  `not-recorded` stay ungated on those steps. The gate lists every declaration that had any effect on any
  step, including one that produced `declared-not-shown`.
- **vf-1.** The `unknown_open` item says, in this order: close it against an observed obligation once a
  step shows the answer; otherwise only the user, or a person the user names, can accept the gap, and an
  agent never writes that name; when nobody can be asked, the lead reports the open unknown and the run
  ends not done. No paste-ready waiver with a name placeholder.
- **vf-4 (the open half of reality-11).** The item for a failed step prints the failure the capture
  recorded for that step (first line, bounded) before any general advice. Redirect advice appears only
  when the recorded text names a redirect; a status outside `expected_status` names the status received.
- **vf-6.** With an unreadable `target.json` the printed command must run as printed without reading any
  referee output back (do not take the spelling from `gate.json`): derive it from how this process was
  started, or say in the item that the spelling could not be read and the same command that was just run
  applies. The stall outlook names the check that kept the evaluation from being judged.
- **vf-7.** `parity_unstable` items that share scenario, side, dimension and pointer pattern collapse into
  one item listing the step ids, printing the `step_id: "*"` declaration where a declaration is the
  remedy. The prober's item for an unstable original carries the removal command the verifier's item has.
- **vp-5.** `--exit-code=<value>`: any value other than `true` or `false` is refused as an argument error
  for the clone-run commands. If the shared parser cannot express that for one command without changing
  other commands, leave the parser alone, and list the values that clear the flag on the reference page.
- **vp-6.** A `journal.jsonl` that is not a regular file is handled as a directory there already is: never
  opened for reading. Check the other referee-owned paths for the same gap.
- **vp-7 and the integrator's download issue.** The residual-trust line names the content of a file saved
  through a download. A `not-recorded` finding on a download's document reply does not say "capture
  again": it says to fetch the file with a `request` step (which records the body up to the limit) and to
  name the click `setup-`.
- **vp-8.** A link is flagged as soon as a segment-by-segment walk of its text from the link's own
  directory rises above the clone root, whatever it does afterwards.
- **Integrator's page-request issue.** When a `request` step's reply is HTML and differs, the item says a
  page is compared by its on-screen text through a `goto` step and that a `request` step compares the
  markup byte for byte; it does not just say "change the clone".
- **referee-12 remainder.** Tests for a file that vanishes during the tree walk and for a special file,
  where they can be written without flakiness.

## Text (owner: the finishing agent)

- **vf-2.** Every command a role card prints must keep full Evidence out of the agent's context: the
  summary form with `--evidence_output`, or a redirect to a file. The scout card's third command is
  corrected, and the conformance test enforces the rule for every fenced command in the playbook if a
  mechanical rule can be stated soundly.
- **reality-7, on-screen half.** The playbook and the reference page say that on-screen text cannot be
  declared volatile, so a date or clock shown on screen makes its step differ between days: capture both
  sides on the same day, or keep such text out of cited steps.
- **referee-14 remainder.** The spec says exactly what the name check reads: file bytes, paths of files
  and links, and link text; not the names of empty directories or special files.
- Spec rows for "rename a failing step `setup-`", "declare a volatile field that does not vary" and the
  origin rule, the reference page and the playbook are corrected to what the code does after this round.

## Not in this round

Everything `fix-decisions.md` lists as deferred stays deferred. cheat-4 beyond vp-5, surface-12's
option-key naming in argument refusals, and trial-1 stay as they are.
