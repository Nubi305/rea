# Tasks

Each task names the spec section it implements and the check that shows it.

## Contract

- [x] Record the outcome, requirements, acceptance and non-goals ([spec.md](spec.md)).
- [x] Pin the run-folder schemas, reason codes and roles (`src/domain/cloneRun/cloneRunSchemas.ts`).
- [x] Pin the comparer's result, table and port (`src/domain/scenarioBehaviorComparison.ts`).
- [x] Stub the service and referee modules so every package compiles against one set of names (`npm run check:fast`).

## A: comparer (spec: "The comparer")

- [ ] Carry step id and resource type from request events onto scenario capture records, the parsed capture and
      `ProbeStep`; existing environment tests still pass.
- [ ] `readScenarioBehaviorCapture`: authenticate a record or bundle, refuse a HAR, another operation, an edited file.
- [ ] Align steps by id, match transactions by request line, fold repeats, apply renames.
- [ ] Statuses: `changed`, `unknown`, `unstable`, `unchanged`; missing data never matches; exact comparison beside the
      differ; volatile fields honoured only where the left repeats differ, with type and format still compared.
- [ ] Fingerprint `start_state` per side.
- [ ] `describeScenarioBehavior`: the behaviour table.
- [ ] Unit tests for each rule, and the saved pilot captures: two per side unchanged, one per side unknown, mutant
      changed at `/slug`.

## B: run folder and referee (spec: "Run folder" to "Stall")

- [ ] `initCloneRun`: scaffold from flags, refuse a non-empty directory and a folder inside the clone root, write the
      three examples and check them against their schemas in a test.
- [ ] `loadCloneRunWorkspace`: every authored file, issues with file, pointer and fix; one evaluation reports all.
- [ ] `renderCloneRunScenario`: both sides, the `rea-tree-` step, the expected digest equals what a real capture
      records.
- [ ] `digestCloneTree`: excludes on whole segments, symlinks not followed, stable order.
- [ ] Admission in the specified order; stale and mismatched files do not block alone; rejected files do.
- [ ] The eight checks, the worklist (at most ten, exact commands), waivers and `done with N waivers`.
- [ ] Journal and stall: no line for an unchanged state, judged rounds, the two stall conditions.
- [ ] Unit tests with a fake comparer for every reason code.

## C: CLI, fixtures and end to end (spec: "Commands", "Acceptance")

- [ ] Register the three commands CLI-only; `--exit-code` for the comparer and the referee.
- [ ] Boundary test of the three commands over the built CLI.
- [ ] Fixture trio and scenario under `tests/fixtures/cloneRun/`.
- [ ] `npm run verify:clone-run` shows each line of acceptance item 2 and stops every server and browser it started.

## D: guidance and documentation

- [ ] `references/clone-runs.md` with seven role cards and the web playbook; `SKILL.md` pointer and version.
- [ ] `MANAGED_SKILL_FILES`, regenerated metadata and plugin copy.
- [ ] Conformance test tying every command, reason code and role named in the reference to real ones.
- [ ] `docs/reference/clone-runs.md` and the CLI guide.
- [ ] Setup under a throwaway `HOME` installs the reference, and `rea guidance --query "clone parity"` matches.
