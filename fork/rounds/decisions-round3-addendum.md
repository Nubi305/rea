# Fix round 3: addendum after stage 1

Stage 1 delivered the comparer (branch `fx3/comparer3`, report in `round3-stage1-partial.json`, member
`other1`, and its note for the referee, `round3-comparer-interface.md`) and the referee's part 1 (branch
`fx3/referee3`, member `referee1`). The capture package is still at work. These rulings settle what stage 1
left open. They are part of `fix-decisions-round3.md` and win where they differ.

1. **The comparer and the R1 gate table land together or not at all.** With the new comparer and the old
   table, a clone that answers a `setup-` request with a different wrong value in every capture has no
   blocking finding. Neither branch is merged into the work branch before the other.
2. **A reply only one side failed to record blocks on every step (R1 stands; the rule table's "as above" is
   withdrawn).** The capture package makes random loss go away at its source: its measurements show no lost
   body in 40 captures of each class under load. After that, a reply one side cannot record is a difference
   or a defect worth seeing. Over the size limit on one side only stays `value`. For any other reason the
   item goes to the verifier first, with one more capture of that side; lost again on the clone it goes to
   the builder (the clone's reply does not finish), lost again on the original to the prober (the step
   cannot be observed and has to change). The reason the Evidence records is in the item.
3. **The cut.** A prepared step blocks on a cut only when `findings_omitted` has a key other than
   `undeclared-volatile`. Never by counting findings.
4. **Declarations reach the comparer whole**: `of` and `request` are passed through, so a request parameter
   or a page-address parameter can be declared.
5. **Start states follow the same rule as everything else.** A fingerprint step compares what the original
   holds steady; a line or a field that varies between the original's own clean starts is noise there too,
   and does not make the start dirty. A steady unit that differs between a side's captures still does.
6. **Text replies that are not JSON are compared by lines**, with the skeleton rule of on-screen text, so a
   per-request token in an HTML or text reply is noise in its own line and the rest is compared. The
   generated properties are extended to cover it.
7. **Canaries (R4) are built, as a report.** The comparer offers what the referee needs to make a stand-in
   clone from the original's own admitted captures with one named steady unit changed. After a pass, and with
   an option otherwise, the referee reports under `sensitivity` how many such changes the comparison caught,
   and each one it did not with the declaration, rename or prefix responsible. Bounded: one change per unit
   kind per cited step.
8. **The trial replay's expected reading changes.** It will read `not_done` on `unknown_open` and on the
   clone's own disagreement at `setup-click-parcel-weight-not-a-number` (an alert present in one clone
   capture of two). That is the truth about those captures; the remedy is the capture package's action wait.
9. **Size and complexity.** `evaluateCloneRun` (890 lines, the fourth most complex function in the
   repository) and the comparison service are split along the seams this round creates, where a split makes
   the next change easier. Not a goal in itself; no behaviour change rides on it.
