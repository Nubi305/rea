# Upstream sync notes

Written 2026-11-21. Branch `sync/upstream` in the worktree `/home/user/rea-wt/sync`, started from
`claude/dreamy-hamilton-vczp59` at 0e089b3. Nothing was pushed and nothing was merged into the shared branch.

## What was merged

- Upstream tag `rea-agents-6.10.1` (8bb01b51, "chore(main): release rea-agents 6.10.1 (#12737)",
  2026-11-20 05:30 UTC). It is an ancestor of upstream main (efe2da79 at fetch time) and the newest release tag
  (the tags are 6.9.0, 6.10.0, 6.10.1).
- Merge base, checked after fetching: `git merge-base HEAD rea-agents-6.10.1` = 1a070dee8026b7cceb878ee76692d137ee94b39b,
  which is not a shallow boundary (its parent 4bebd9a5 is present).
- The tag is 132 commits past the fork point. Main is 198 commits past the tag: 188 test, 6 fix, 2 ci, 1 docs,
  1 feat. None of the six fixes touch code the fork uses (electron renderer shutdown, NativeAOT in Ghidra, asar
  listing, reference Git reads, two CI fixes). The feature is headless IDA MCP (#4813). The docs commit is #12856,
  which removes docs/specs (see below). So the tag was the right choice and the fork needs nothing from after it.
- Commits on the branch:
  - b46104b9 `chore(sync): merge upstream rea-agents-6.10.1 (8bb01b51)`, the merge
  - 35248a6a `feat(fork): report a fork marker and give the skill a fork version scheme`

## Conflicts and how each was resolved

There were three content conflicts, and each was resolved by keeping both sides.

| file                             | what clashed                                                                                                                              | resolution                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| docs/.vitepress/documentation.ts | the fork's "Clone runs" nav entry and upstream's "Reconstruction coverage" entry, added at the same spot                                  | both entries, the fork's first           |
| docs/README.md                   | the same two list items                                                                                                                   | both, the fork's first                   |
| docs/specs/README.md             | six new upstream spec rows and the fork's clone-run row (a content conflict at the tag, not modify/delete: the deletion is after the tag) | upstream's six rows, then the fork's row |

Everything else merged automatically, including both SKILL.md copies (upstream's UEFI routing bullet),
package.json (version 6.10.1 and a `verify:ghidra:ppc64` script) and src/generatedPackageMetadata.ts.
The lockfile changed only its two version lines, so the installed dependency set is the same.
`node_modules` in the worktree is a symlink to /home/user/rea/node_modules, and `npm ci` was not run.

The generators had nothing to regenerate after the merge. `metadata:check`, the cursor plugin `--check`, the skill
metadata `--check` (after a build) and `verify-mcp-registry-metadata` all passed, and running
`npm run metadata:generate` and `npm run cursor-plugin:generate` left no diff.

## Checks run on the merged tree (b46104b9)

| check                                                                                                                                                         | result                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run build:cached`                                                                                                                                        | pass, 19 s                                                                    |
| `npm run check:fast` (typecheck, lint, architecture guards over 2,949 files)                                                                                  | pass, 40 s                                                                    |
| clone-run unit tests (12 files under src/domain/cloneRun, src/application/cloneRun, src/application/scenarioBehavior, src/domain/scenarioBehaviorComparison*) | 152 passed                                                                    |
| `test:focused` cloneRunCli, cloneRunGuidance, setupSkill (the managed skill files test)                                                                       | 47 passed, 4 skipped (the skips are root-only `skipIf(getuid() === 0)` cases) |
| `npm run docs:check`                                                                                                                                          | pass (readmeConsistency 8 passed)                                             |
| `npm run verify:test-discovery`                                                                                                                               | pass, 3,850 files                                                             |
| `npx knip --cache`                                                                                                                                            | pass, no findings                                                             |
| `npx oxfmt --check .`                                                                                                                                         | pass, 8,950 files                                                             |
| `scripts/verify/architecture-guards.mjs`, `scripts/verify-module-boundaries.mjs`                                                                              | pass, 2,949 and 4,631 files                                                   |
| `verify-clone-run.mjs`, real Chromium                                                                                                                         | pass, all 20 cases, 229 s, `"verified": true`                                 |

After the fork-identity commit the following were rerun: build, check:fast, oxfmt, docs:check, knip, the generator
checks, test discovery, module boundaries, versionReport and skillManifest unit tests, the Doctor, GuidanceAccess and
Setup.planning unit tests (187 passed), and the versionReportCli, dispatcher, setupSkill, generatedSkill,
cloneRunGuidance and cliOutput boundary tests. All passed.

## Fork identity

### Where the version is read and what constrains it

- package.json `version`. The generator copies it into src/generatedPackageMetadata.ts:4
  (scripts/generate-package-metadata.mjs:46, without a format check), and src/identity.ts:10-13 turns it into
  `packageVersion`, `registrationPackageSpecifier` (`rea-agents@6.10.1`) and `mcpCommand` (`npx -y rea-agents@6.10.1 mcp`).
- The plugin launcher (scripts/plugin-mcp-launcher.mjs:12) requires `^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$` and, at
  line 21, an exact match with the bundled package.json. Release Please writes the same number into
  .claude-plugin/plugin.json, .cursor-plugin/plugin.json, .codex-plugin/plugin.json, .claude-plugin/marketplace.json,
  .agents/plugins/marketplace.json and server.json, and scripts/verify-mcp-registry-metadata.mjs checks them.
  A `+fork` build suffix would fail the launcher's pattern. A `-fork` prerelease suffix would pass it, but it would
  conflict at every release and would rank below upstream's release in semver.
- `rea --version` prints `PRODUCT_IDENTITY.packageVersion` (src/cli/discovery.ts:492-493).
  `rea --version --json` is built by src/domain/versionReport.ts and rendered at src/cliOutput.ts:398-405.
- The update notice (src/cli/updateNotice.ts:96 and 298-304) compares this version with npm's `rea-agents` latest.
- The skill version is free text. src/domain/skillManifest.ts:97-112 accepts any nonempty string.
  scripts/generate-package-metadata.mjs:36 copies it into `skillVersion`. Doctor compares by equality
  (src/application/Doctor.ts:500, 520 and 541-545), and so do src/process/ServerIdentity.ts:117 and
  scripts/verify-agent-experience.mjs:158. src/application/SetupSkill.ts only carries the parsed value through
  (line 754). No code compares skill versions numerically.

### Messages that send a user or an agent to upstream's package

- The skill: .agents/skills/reverse-engineer-anything/SKILL.md:64 and :72 (`npx -y rea-agents@latest`), copied
  to .cursor-plugin/skills/.../SKILL.md:64 and :72. The packaged skill pins these to `rea-agents@6.10.1`
  (scripts/generate-skill-metadata.mjs:33-40), which is still upstream's package. References:
  connection-and-recovery.md:144 and environments.md:275-277. This text was left alone: another package owns the skill.
- README.md:124, 133 (`npm install --global rea-agents`), 169, 173-174 and 422. docs/ has 147 more lines of
  `rea-agents@latest`, `npx -y rea-agents` or `install -g rea-agents`.
- The update path. `rea --update` and the terminal notice "Update available for rea-agents" (src/cli/updateNotice.ts:298-304)
  install npm's `rea-agents` over this build (src/application/Update.ts:101). That replaces the fork with upstream
  and removes the clone-run commands. The remediation at src/application/Update.ts:218 says
  `npx rea-agents@latest`.
- src/application/MsixPackageStorage.ts:104 (`npm install -g rea-agents`) and src/application/SupportedClients.ts:391
  (Grok Bot: `npx -y rea-agents@<version> mcp`).
- Environment bundles. src/application/environment/environmentBundle.ts:80-83 makes the default bundle source
  `rea-agents@6.10.1` from the npm registry, so a bundle exported by this build installs upstream's package.
- `PRODUCT_IDENTITY.mcpCommand` (src/identity.ts:13) is used only by scripts/verify-package.mjs:250.
  `rea setup` registers the local runtime and entry point (src/application/ClientRegistrationIdentity.ts:65-89),
  not npx.

### What was changed (commit 35248a6a)

- A new fork-owned file, src/domain/forkIdentity.ts: `FORK_IDENTITY` = `{ name: "rea-clone-runs", commands: [init-clone-run,
  evaluate-clone-run, compare-scenario-behavior], upstream_package_note }`. The command literals are type-checked
  against the operation constants (`satisfies typeof ...`), and the file documents the skill version rule.
- `rea --version --json` now also prints `fork` (src/domain/versionReport.ts, three added lines). Plain
  `rea --version` still prints `6.10.1`, because the launcher, the update notice and the package verifiers read
  that number. The test changes are one added line each, in src/domain/versionReport.test.ts and
  tests/boundary/cli/versionReportCli.test.ts. docs/getting-started/cli.md gained one paragraph after the
  version report table.
- The skill's `metadata.version` changed from "66" to "63+clone.4". The rule is `<upstream>+clone.<n>`, where
  `<upstream>` is upstream's skill version at the last merge and `<n>` grows by one at every change to the fork's
  SKILL.md text, including a merge that changes it, and never resets. Upstream's versions are plain integers, so
  the two cannot collide. Doctor now expects `63+clone.4` (checked with `rea doctor --json` under an empty HOME),
  so an install of the old "66" skill shows as not aligned.
- Not done, decisions for the lead: guarding `rea --update` against replacing the fork, the 147 docs lines, and the
  bundle default source.

## Commands for the next sync

Run them from the worktree. They are the commands this sync ran. The fetch depth of 800 was enough for 132
upstream commits.

```sh
cd /home/user/rea-wt/sync            # or a fresh worktree: git -C /home/user/rea worktree add <dir> -b sync/<tag> <fork branch>
git remote get-url upstream || { git remote add upstream https://github.com/morluto/rea.git; git remote set-url --push upstream no-push://disabled; }
git ls-remote --tags upstream 'rea-agents-*'                       # pick the newest release tag
TAG=rea-agents-X.Y.Z
timeout 600 git fetch --no-tags --depth 800 upstream +refs/heads/main:refs/remotes/upstream/main +refs/tags/$TAG:refs/tags/$TAG
git merge-base --is-ancestor $TAG upstream/main && git merge-base HEAD $TAG   # must print a real fork-history commit, not a shallow boundary
git log --oneline $TAG..upstream/main | grep -vE '^[0-9a-f]+ test'         # anything the fork needs after the tag?
git merge --no-ff -m "chore(sync): merge upstream $TAG ($(git rev-parse --short $TAG))" $TAG
node -e 'const {execSync}=require("child_process");const g=r=>{const p=JSON.parse(execSync("git show "+r+":package-lock.json",{maxBuffer:1e9})).packages;delete p[""];return JSON.stringify(p)};console.log(g("HEAD^1")===g("HEAD")?"same dependency set: keep the node_modules symlink":"dependency set changed: npm ci in the worktree")'
export TURBO_CACHE_DIR=$PWD/.turbo/cache                         # without this, turbo in a linked worktree writes to the main checkout's .turbo
npm run metadata:generate && npm run cursor-plugin:generate && git status --short
npm run build:cached && npm run check:fast
npm run test:local -- src/domain/cloneRun/*.test.ts src/application/cloneRun/*.test.ts src/application/scenarioBehavior/*.test.ts src/domain/scenarioBehaviorComparison*.test.ts src/domain/versionReport.test.ts
npm run test:focused -- tests/boundary/cli/cloneRunCli.test.ts tests/conformance/cloneRunGuidance.test.ts tests/boundary/filesystem/setupSkill.test.ts tests/boundary/cli/versionReportCli.test.ts
npm run docs:check && npm run verify:test-discovery
npx knip --cache --cache-location /tmp/<scratch>/knip-cache && npx oxfmt --check .
node scripts/verify/architecture-guards.mjs && node scripts/verify-module-boundaries.mjs
REA_BROWSER_EXECUTABLE=/opt/pw-browsers/chromium REA_BROWSER_NO_SANDBOX=true timeout 900 node scripts/verify-clone-run.mjs
```

The skill version rule at each merge: if upstream bumped its SKILL.md version or changed SKILL.md, set the fork's
`metadata.version` to `<upstream's new number>+clone.<n+1>`, then run `npm run metadata:generate` and
`npm run cursor-plugin:generate`. That line conflicts whenever upstream bumps its own number, and the conflict is
always resolved this way.

The pre-commit hook skips merge commits (.husky/pre-commit) and runs lint-staged and check:fast on every other commit.

## What upstream changed that the other packages must know (1a070de..rea-agents-6.10.1)

- The CLI result path. src/cli/cliResultOutput.ts and its callers did not change, and nothing else under src/cli
  changed except one option description in src/cli/utilityCommands.ts (inspect-plist). src/cliOutput.ts,
  src/cliOneShot.ts and src/cli.ts did not change.
- The MCP delivery path. src/server and src/mcp did not change at the tag. On main after the tag, src/server
  changed only in tests. In src/contracts, upstream changed the inspect_plist description in
  src/contracts/native/nativeToolContracts.ts (#9754, breaking: plists outside a bundle need separate inspection),
  and a test now uses `ADVERTISED_INPUT_SCHEMA_MAX_BYTES` (13,312 bytes, from advertisedDialect.ts) in place of a literal.
- The skill. SKILL.md has one changed routing bullet (UEFI volumes and NVAR stores go to `inspect_artifact`;
  Binwalk and Unblob stay for external scanning). Upstream's version is still "63". Plugin and marketplace
  versions are now 6.10.1.
- Captures. The only non-test change is src/browser/playwrightTrace/TraceEventProjection.ts (3 lines, #12724:
  a failed trace response's status is now unknown, not a number). The other browser, history, process/capture
  and analysisView changes are test-only.
- The files clone runs changed in place. Of the 31 upstream files the fork modified, upstream changed only the
  doc lists, the SKILL.md copies, package.json and the generated metadata, all listed above. SetupSkill.ts,
  WebScriptExportService.ts, the environment build, source and compare files, scenarioCaptureRecords.ts,
  webScriptExport.ts, webScriptCaptureAdapters.ts, environmentBundleExport.ts, argvParser.ts,
  cliCommandRegistrations.ts and cliCommandNames.ts are unchanged upstream.
- Shared modules the fork imports. src/domain/analysisErrorBase.ts gained an `InspectPlist` member, and
  src/domain/analysisErrorCleanup.ts gained `providerCleanupErrorFromCloseRejections`. Both are additive.
- The rest is 123 non-test source files of parser hardening (JavaScript, Apple, ELF, UEFI, native, GPU, Ghidra
  and others) and large test consolidation.

## What upstream now forbids, or will

- At this tag, docs/development/documentation.md requires a feature record in `docs/specs/<domain>/<slug>/`, with
  a `docs/specs/README.md` row, for any new CLI command or public contract. The fork follows that.
- On main after the tag, #12856 (a1dec2d2, 2026-11-20) deletes docs/specs, docs/adr, docs/architecture and
  docs/development/roadmap.md, and AGENTS.md says specs, plans, task lists, ADRs and architecture diagrams stay out
  of Git. The next release will bring that. Expect a modify/delete conflict on docs/specs/README.md. The fork's
  docs/specs/reconstruction/clone-runs/ files are fork-added and will not conflict, but they will break the new
  rule. Fifteen fork files cite spec.md, and two tests read it at runtime. The next agent in this lane folds the
  spec into docs/reference/clone-runs.md, and that should land before the next merge.
- New wording at this tag (AGENTS.md, tool-design.md, testing.md): commands that a verifier launches go through
  the supervised command owner (verify-clone-run.mjs already reports `process_lineage: verified`). A private
  temporary copy counts as a filesystem write. Evidence that includes a source digest binds it to the bytes the
  parser admitted. Target execution still needs a maintainer scope decision before integration (AGENTS.md:7).
  This matters only if clone runs go upstream.
- The audit found a draft upstream PR (#11072) that would move SKILL.md's per-target routing into a reference
  file. It touches the section where the fork added its clone-run route bullet, and it will be the first real
  skill conflict.

## Side effects of this sync on shared state

- `git remote add upstream` and the fetched objects, refs and tags are in the shared repository config
  (/home/user/rea/.git). Pushing to upstream is disabled (`no-push://disabled`).
- Before `TURBO_CACHE_DIR` was set, the first `build:cached` and `check:fast` in the worktree wrote five new
  content-addressed entries (04:02:57 to 04:03:57 UTC: 2ed30d4b, 78960acd, 95e0483b, 41e89902, eb575aac) into /home/user/rea/.turbo/cache. That directory is ignored by Git and holds only new
  hashes, so no tracked file changed. They were left in place.
- knip's cache went to scratch (`--cache-location`), not to the shared node_modules.
