# Tasks

Each task names the spec section it implements and the check that shows it.

## Contract

- [x] Record the outcome, requirements, acceptance and non-goals ([spec.md](spec.md)).
- [x] Pin the run-folder schemas, reason codes and roles (`src/domain/cloneRun/cloneRunSchemas.ts`).
- [x] Pin the comparer's result, table and port (`src/domain/scenarioBehaviorComparison.ts`).
- [x] Stub the service and referee modules so every package compiles against one set of names (`npm run check:fast`).
- [x] Review the contract against real captures and correct it: start-origin comparison, both-sided missing data,
      redirects, copied captures, leaf-only volatile fields, symlinks, loopback aliases, no parity waiver.

## A: comparer (spec: "The comparer")

- [x] Carry step id and resource type from request events onto scenario capture records, the parsed capture and
      `ProbeStep`; `probeRequests` takes the origin to use; existing environment tests still pass.
- [x] `readScenarioBehaviorCapture`: authenticate a record or bundle, refuse a HAR, another operation, an edited file;
      fill `fingerprint_sha256` and `reply_bodies`.
- [x] Compare at the start origin only: an other-origin `fetch`, `xhr` or `document` request is `unknown`, and a page
      address that left the start origin keeps its whole URL. Test with a capture whose page was sent elsewhere.
- [x] Align steps by id, match transactions by request line, fold repeats, apply renames in order and report those
      applied.
- [x] Statuses: `changed`, `unknown`, `unstable`, `unchanged`; missing data never matches on either side (a body lost
      on the right is `unknown`, not `changed`); a redirect has no body to miss; exact comparison beside the differ.
- [x] Volatile fields: one leaf per declaration, honoured only where the left repeats differ, shape still compared.
- [x] Fingerprint `start_state` per side through `scenarioStartState`.
- [x] `describeScenarioBehavior`: the behaviour table.
- [x] Unit tests for each rule. The pilot's saved captures selected no accessibility text, so under this contract every
      step of theirs is `unknown` on `text`; they can show the request, status and body rules only (mutant changed at
      `/slug`). An all-`unchanged` result needs captures made with the rendered capture settings.

## B: run folder and referee (spec: "Run folder" to "Stall")

- [x] `initCloneRun`: scaffold from flags, refuse a non-empty directory, a folder inside the clone root, addresses
      that are not distinct and a clone name containing an original name, write the three examples and check them
      against their schemas in a test.
- [x] `loadCloneRunWorkspace`: every authored file, ids from base names, the cross-file rules of check 2, issues with
      file, pointer and fix; one evaluation reports all.
- [x] `renderCloneRunScenario`: both sides, `{origin}` only at the start of a `goto` URL, every `goto` on the side's
      address, the `rea-tree-` step, the expected digest equals what a real capture records.
- [x] `digestCloneTree`: excludes on whole segments, symlinks not followed and those leaving the root listed, stable
      order.
- [x] Admission in the specified order; a copy is `duplicate`; duplicate, stale and mismatched files do not block
      alone; rejected files do.
- [x] The eight checks, evaluated without waiting for one another (the original side before a clone exists); the
      worklist (at most ten, exact commands, the JSON line to add); waivers and `done with N waivers`; `target` and
      `declared` in the gate.
- [x] Journal and stall: no line for an unchanged state, judged rounds, the two stall conditions.
- [x] Unit tests with a fake comparer for every reason code.

## C: CLI, fixtures and end to end (spec: "Commands", "Acceptance")

- [ ] Register the three commands CLI-only; `--exit-code` for the comparer and the referee.
- [ ] Boundary test of the three commands over the built CLI.
- [ ] Fixture trio and scenario under `tests/fixtures/cloneRun/`, with the properties the plan lists.
- [ ] `npm run verify:clone-run` shows each line of acceptance item 2 and stops every server and browser it started.

## D: guidance and documentation

- [ ] `references/clone-runs.md` with seven role cards and the web playbook; `SKILL.md` pointer and version.
- [ ] `MANAGED_SKILL_FILES`, regenerated metadata and plugin copy.
- [ ] Conformance test tying every command, reason code and role named in the reference to real ones.
- [ ] `docs/reference/clone-runs.md` and the CLI guide.
- [ ] Setup under a throwaway `HOME` installs the reference, and `rea guidance --query "clone parity"` matches.
