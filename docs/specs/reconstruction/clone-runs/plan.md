# Plan

Implements [spec.md](spec.md). Design choices that the spec leaves to the implementation are recorded here once.

## Architecture

Dependencies flow inward, as everywhere in REA.

| Layer       | Module                                                                  | Holds                                                                                    |
| ----------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| domain      | `src/domain/scenarioBehaviorComparison.ts`                              | step kinds, statuses, verdict and exit code, result and table schemas, the comparer port |
| domain      | `src/domain/cloneRun/cloneRunSchemas.ts`                                | every run-folder schema, the gate, the reason codes and their roles                      |
| application | `src/application/scenarioBehavior/ScenarioBehaviorComparisonService.ts` | reading captures through the existing owners, comparing, the behaviour table             |
| application | `src/application/cloneRun/CloneRunWorkspace.ts`                         | init, reading authored files, rendering capture inputs, writing outputs                  |
| application | `src/application/cloneRun/CloneRunTreeDigest.ts`                        | the clone tree digest                                                                    |
| application | `src/application/cloneRun/CloneRunEvaluation.ts`                        | the referee                                                                              |
| CLI         | `src/cli/cloneRunCommands.ts`                                           | the three commands                                                                       |

The domain comparer module cannot import `compareAnswers`, `probeRequests` or `parseCaptureEvidence`: they live in
`src/application/environment/`. It holds the pure rules; the service calls the owners.

The referee takes the comparer as `ScenarioBehaviorComparer<Capture>` (`readCapture`, `compare`, `describe`) together
with `digestTree` and `now` in `CloneRunEvaluationDependencies`. It is generic in `Capture` and reads only
`ScenarioBehaviorCaptureFacts`, so its unit tests pass a fake comparer and never build Evidence. Production wiring is
`{ comparer: SCENARIO_BEHAVIOR_COMPARER, digestTree: digestCloneTree, now: () => new Date() }`.

What crosses the two packages is small and all of it is in `ScenarioBehaviorCaptureFacts` and the comparison schema:
the referee admits by `start_origin`, `scenario_sha256`, `definition` and `evidence_id`, judges the start state from
`fingerprint_sha256` (`scenarioStartState`, also without a clone), checks copied files against `reply_bodies`, and
reads step statuses and findings from `compare`, which returns a `Result` because differing step lists are a refusal.

The exported names in the four stub modules and the two domain modules are frozen. A package may add exports to the
modules it owns; it does not rename or reshape what another package imports. A needed change is a deviation to report.

## Choices

1. **Tree binding through the capture input**, not a record written at admission. The capture command is unchanged
   and knows nothing of the clone, so the only authenticated place a tree digest can travel is the scenario REA ran.
   A reserved last step (`rea-tree-<sha256>`, a 1 ms wait) carries it; a real capture with such a step was run and
   validated. An admission-time record was rejected: it cannot see an edit made before the first evaluation, and it
   would make a referee output a source of truth.
2. **One equality admits a capture.** REA already records `scenario_sha256` over the whole scenario it ran. The
   referee renders the expected input, digests it the same way, and compares. Address, scenario content, capture
   settings and tree are all inside that digest; the address is checked first only to give its own reason code.
3. **The differ is reused and not trusted to mask.** `compareAnswers` treats equal-format clocks as equal and counts
   bodies it could not compare. The comparer adds an exact comparison of the two replies and of each side's repeats, so
   a normalisation never stands in for equality and a field is volatile only when the original's repeats show it.
4. **Stale and mismatched Evidence does not block by itself.** Captures never overwrite, so every clone edit and every
   scenario edit leaves old files behind. Edited files and captures from a wrong address do block.
5. **Exit codes keep REA's convention for refusals** (exit 1 with the error envelope). `--exit-code` adds the verdict
   codes by setting `process.exitCode` in the handler, as `audit-release-exposure --fail_on` does.
6. **No schema tag on authored files, and no member that repeats the file name.** Agents hand-write three kinds of
   file; each extra required member is one more rejected call. The base name is the scenario, area or unknown id.
   Referee outputs carry `schema`.
7. **The application is the start origin.** `probeRequests` picks the origin with the most JSON-like records; on a
   capture whose page had been sent to another server it compared that server. The comparer names the origin itself,
   treats a compared request to any other origin as `unknown`, and keeps the origin in a page address that left.
8. **Parity cannot be waived, and renaming a step cannot hide a difference.** Waivers cover unknown proposals and
   inferred obligations. A setup or fingerprint step may be `unknown` or `unstable`; `changed` blocks on every step.
9. **A copied capture is not a repeat.** Two admitted files with one `evidence_id` count once.
10. **The copied-file check reads Evidence too.** Reply bodies the original's admitted captures recorded join the
    declared material, so the check does not depend on what the scout chose to save.
11. **A volatile declaration names one leaf.** A pointer to an object, an array or the whole body would mask every
    value beneath it as soon as one of them varied.

## Work packages

No file belongs to two packages. A and B build in parallel against the stubs; C merges A and B, then wires the CLI and
owns the end-to-end run; D builds in parallel with C.

### A: comparer

- `src/domain/scenarioBehaviorComparison.ts` and `.test.ts`
- `src/application/scenarioBehavior/ScenarioBehaviorComparisonService.ts` and `.test.ts`
- `src/domain/analysisView/scenarioCaptureRecords.ts`: `ScenarioCaptureRecords.steps`, a map from record ordinal to
  `{ step_id, resource_type }`
- `src/application/environment/environmentSource.ts`: `ParsedEnvironmentCapture.scenario`, null for a HAR, with the
  capture's steps, start origin, parameters and the map above
- `src/application/environment/environmentCompareProbe.ts`: `probeRequests(records, options?)`, where
  `options.origin` replaces the majority-origin choice; without options it behaves as today. It returns each parsed
  request line (`lines`) beside its steps, so the comparer does not parse a line again
- the existing tests of those three modules

### B: run folder and referee

- `src/domain/cloneRun/cloneRunSchemas.ts` and `.test.ts`
- `src/application/cloneRun/CloneRunWorkspace.ts`, `CloneRunTreeDigest.ts`, `CloneRunEvaluation.ts` and their tests
- further modules under `src/application/cloneRun/` and `src/domain/cloneRun/` as needed

### C: CLI, fixtures and the end-to-end run

- `src/cli/cloneRunCommands.ts` (`registerCloneRunCommands(cli, logger, environment)`)
- `src/contracts/cliCommandNames.ts` (three `CLI_COMMANDS` entries, each a literal that the type checker holds equal
  to the operation constant of its domain module, so the module keeps no runtime import),
  `src/cli/cliCommandRegistrations.ts` (registration `cloneRun`, listed under the `application` family), `src/cli.ts`
- `tests/boundary/cli/cliContractSchemaParity.uncomparable.json`, `tests/boundary/cli/cloneRunCli.test.ts`
- `tests/fixtures/cloneRun/`: original, renamed clone, three mutants (`mutant/slug-cut.json`,
  `mutant/list-as-object.json` and `mutant/download-separator.json`, each one replacement in one file of the clone),
  and under `run/` the three scenarios (`topics`, `export`, `download`), their obligations and the declared
  differences. The clone is new code: no file of 64 bytes or more equals a file the original serves, and neither it
  nor a mutant mentions the original's name. The original's name is distinctive (it occurs in no route or field
  name) and one of its routes answers with more than 64 KiB for the unknown case.
- `scripts/verify-clone-run.mjs`, `package.json` script `verify:clone-run`, and under `scripts/lib/` the modules
  `clone-run-e2e.mjs` (the case list), `clone-run-e2e-cases.mjs` and `clone-run-e2e-mutant-cases.mjs` (the cases),
  `clone-run-e2e-context.mjs` (commands, run folder and the team loop), `clone-run-e2e-runner.mjs` (the case loop
  and interruption) and `clone-run-e2e-sites.mjs` (the fixture servers). The script drives each case by the worklist
  (reset the fixture, run the capture command of a `next` item, evaluate) until the verdict settles or a bound is
  reached: reply bodies are lost at random, so a fixed two captures per side would make the run flaky

### D: guidance and documentation

- `.agents/skills/reverse-engineer-anything/references/clone-runs.md`: seven role cards and the web playbook
- `.agents/skills/reverse-engineer-anything/SKILL.md`: a pointer replacing the one build sentence, `metadata.version`
- `src/application/SetupSkill.ts` (`MANAGED_SKILL_FILES`), `tests/boundary/filesystem/setupSkill.test.ts`
- `src/generatedPackageMetadata.ts` and `.cursor-plugin/skills/reverse-engineer-anything/`, regenerated
- `tests/conformance/cloneRunGuidance.test.ts`: every `rea <command>` the reference names is in `CLI_COMMAND_NAMES`
  or is one of the three operation constants, and every reason code and role it names is in `CLONE_RUN_REASONS` and
  `CLONE_RUN_ROLES`
- `docs/reference/clone-runs.md`, `docs/getting-started/cli.md`, `docs/.vitepress/documentation.ts`, `docs/README.md`

### Shared files

`tasks.md`: each package ticks the boxes of its own section and touches no other line. `spec.md` and this plan are
changed only by package C when it merges, from the deviations the other packages report. `package.json` belongs to C;
D regenerates `src/generatedPackageMetadata.ts`, which holds the skill version and nothing of C's.

### As built

Where the build differs from the packages above, and why:

- The referee splits the copied-file and forbidden-name checks into `src/application/cloneRun/CloneRunCleanRoom.ts`.
- `--original` and `--clone` are plain text options. A CLI option schema is published as JSON Schema, which cannot hold
  the transform of the origin schema; `initCloneRun` checks both with the target schema.
- The verifier serves both fixtures from worker threads of its own process and resets a side by restarting its worker,
  so it starts no server process and `target.json` records no start or reset command. It runs every case in one run
  folder, in the order a team would meet them, with `--max-rounds 60` because each case is a judged round.
- The conformance test also covers `docs/reference/clone-runs.md`, holds every reason code to the card of the role
  that acts on it, and parses the reference's JSON examples with the authored schemas.
- `scripts/verify-clone-run-live.mjs` is not built: the specification lists the live agent evaluation as a non-goal.

Changed by the fix round of 2026-11-20 ([tasks.md](tasks.md#fix-round-2026-11-20)):

- The comparer is three modules: `ScenarioBehaviorComparisonService.ts` keeps its exports, `scenarioBehaviorCapture.ts`
  reads a capture into observations and `scenarioBehaviorReplies.ts` compares replies.
- The stall rule is the pure function `cloneRunStall` in `src/domain/cloneRun/cloneRunStall.ts`, with its own tests.
- Address identity is split: `src/application/cloneRun/CloneRunAddressResolution.ts` resolves a host name through the
  system resolver, and the pure `cloneRunAddressRelation` in the schemas module judges two resolved addresses.
- `init-clone-run` loads the production comparer to compute the first worklist it prints, so the list is the
  referee's own.
- `src/application/EvidenceBundleCapture.ts` (`savedBundleCapture`) lets `export-web-scripts` and `environment-build`
  read the bundle `--evidence_output` saves when it holds one capture record.
- The conformance test also checks every flag a guide names against the option schema of the command it is written
  with, and the check and role columns of the reference's reason table against `CLONE_RUN_REASONS`. The roles a
  finding can be addressed to beyond its reason's own are listed in the test, because the referee does not export
  them.

## Verification

Focused tests per package with `npm run test:local -- <path>`, boundary tests with `npm run test:focused -- <path>`,
`npm run check:fast` before each commit, and `npm run verify:clone-run` for the acceptance list of the spec. Captures
run under an outer `timeout`. No native provider is needed.
