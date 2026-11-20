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

The exported names in the five stub modules and the two domain modules are frozen. A package may add exports to the
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
6. **No schema tag on authored files.** Agents hand-write three kinds of file; each extra required member is one more
   rejected call. Referee outputs carry `schema`.

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
- `src/application/environment/environmentCompareProbe.ts`: `probeRequests(records, stepIds?)` sets
  `ProbeStep.step_id`
- the existing tests of those three modules

### B: run folder and referee

- `src/domain/cloneRun/cloneRunSchemas.ts` and `.test.ts`
- `src/application/cloneRun/CloneRunWorkspace.ts`, `CloneRunTreeDigest.ts`, `CloneRunEvaluation.ts` and their tests
- further modules under `src/application/cloneRun/` and `src/domain/cloneRun/` as needed

### C: CLI, fixtures and the end-to-end run

- `src/cli/cloneRunCommands.ts` (`registerCloneRunCommands(cli, logger, environment)`)
- `src/contracts/cliCommandNames.ts` (three `CLI_COMMANDS` entries whose values are the operation constants of the two
  domain modules), `src/cli/cliCommandRegistrations.ts` (registration `cloneRun`, listed under the `application`
  family), `src/cli.ts`
- `tests/boundary/cli/cliContractSchemaParity.uncomparable.json`, `tests/boundary/cli/cloneRunCli.test.ts`
- `tests/fixtures/cloneRun/`: original, renamed clone, mutant switch, scenario, obligations
- `scripts/verify-clone-run.mjs`, `scripts/lib/clone-run-e2e.mjs`, `package.json` script `verify:clone-run`

### D: guidance and documentation

- `.agents/skills/reverse-engineer-anything/references/clone-runs.md`: seven role cards and the web playbook
- `.agents/skills/reverse-engineer-anything/SKILL.md`: a pointer replacing the one build sentence, `metadata.version`
- `src/application/SetupSkill.ts` (`MANAGED_SKILL_FILES`), `tests/boundary/filesystem/setupSkill.test.ts`
- `src/generatedPackageMetadata.ts` and `.cursor-plugin/skills/reverse-engineer-anything/`, regenerated
- `tests/conformance/cloneRunGuidance.test.ts`: every `rea <command>` the reference names is in `CLI_COMMAND_NAMES`
  or is one of the three operation constants, and every reason code and role it names is in `CLONE_RUN_REASONS` and
  `CLONE_RUN_ROLES`
- `docs/reference/clone-runs.md`, `docs/getting-started/cli.md`, `docs/.vitepress/documentation.ts`, `docs/README.md`

## Verification

Focused tests per package with `npm run test:local -- <path>`, boundary tests with `npm run test:focused -- <path>`,
`npm run check:fast` before each commit, and `npm run verify:clone-run` for the acceptance list of the spec. Captures
run under an outer `timeout`. No native provider is needed.
