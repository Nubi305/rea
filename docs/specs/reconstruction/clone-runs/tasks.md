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

- [x] Register the three commands CLI-only; `--exit-code` for the comparer and the referee.
- [x] Boundary test of the three commands over the built CLI.
- [x] Fixture trio and scenario under `tests/fixtures/cloneRun/`, with the properties the plan lists.
- [x] `npm run verify:clone-run` shows each line of acceptance item 2 and stops every server and browser it started.

## D: guidance and documentation

- [x] `references/clone-runs.md` with seven role cards and the web playbook; `SKILL.md` pointer and version.
- [x] `MANAGED_SKILL_FILES`, regenerated metadata and plugin copy.
- [x] Conformance test tying every command, reason code and role named in the reference to real ones.
- [x] `docs/reference/clone-runs.md` and the CLI guide.
- [x] Setup under a throwaway `HOME` installs the reference, and `rea guidance --query "clone parity"` matches.

## Integration

- [x] Merge the four packages; the referee reads a finding's status from the comparer's `scenarioFindingStatus`
      instead of its own copy of the category lists.
- [x] Reconcile the specification, the reference page, the CLI guide and the playbook with `--help` and with the
      real output of a run driven by hand on the fixture pair.
- [x] A `goto` whose URL is a bare path is refused with the `{origin}` fix (`CloneRunWorkspace.test.ts`).

## Verification (2026-11-20)

On the merged branch, in a container with Chromium and no native provider:

- `npm run test:local` over the comparer, referee, workspace, tree digest and schema tests, the changed environment
  and capture-record tests and `tests/conformance/cloneRunGuidance.test.ts`: all passed.
- `npm run test:focused` over `tests/boundary/cli/cloneRunCli.test.ts`, `tests/boundary/filesystem/setupSkill.test.ts`
  and the CLI catalogue, registration, startup and guidance boundary tests: all passed; four `setupSkill` tests skip
  when run as root.
- `npm run verify:clone-run` three times in a row: each run printed eleven `pass` lines and no other, in 44 to 47 s,
  and reported no process left behind. No capture lost a reply body in these runs, so the recapture of a lost body
  was driven only by the reply over the body limit.
- A run driven by hand with the documented commands on the fixture pair: `init-clone-run`, the worklist's four
  capture commands, `done`; then the mutant switch, `evidence_stale`, two more clone captures and `parity_changed`
  at `/slug`; then one more clone capture with nothing else changed, and `stalled` with exit 2.
  `compare-scenario-behavior` exited 0 on the four captures and 2 on one original capture per side.
- `rea setup` under a throwaway `HOME` installed `references/clone-runs.md` byte for byte, and
  `rea guidance --query "clone parity"` returned matches.
- `npm run check:fast` and `npm run verify:test-discovery` passed.

Not verified: the playbook has not been followed by an agent, and the full test suite was not run on this branch.
