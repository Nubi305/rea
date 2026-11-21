import { z } from "zod";

import type {
  EVALUATE_CLONE_RUN_OPERATION,
  INIT_CLONE_RUN_OPERATION,
} from "./cloneRun/cloneRunSchemas.js";
import type { SCENARIO_BEHAVIOR_OPERATION } from "./scenarioBehaviorComparison.js";

/**
 * Fork-owned build identity. This build carries the version number of the
 * upstream rea-agents release it was merged from, so the number alone cannot
 * tell it from upstream's package, which has none of the commands below.
 * Upstream never edits this file; a fork change here never conflicts with an
 * upstream release. `rea --version --json` reports it as `fork`.
 *
 * The skill's `metadata.version` follows `<upstream>+clone.<n>`: `<upstream>`
 * is upstream's skill version at the last merge, and `<n>` grows by one at
 * every change to the fork's SKILL.md text, a merge that changes it included,
 * and never resets. Upstream's versions are plain integers, so the two never
 * collide.
 */
export const forkIdentitySchema = z.strictObject({
  name: z.string(),
  commands: z.array(z.string()).readonly(),
  upstream_package_note: z.string(),
});

export type ForkIdentity = z.infer<typeof forkIdentitySchema>;

export const FORK_IDENTITY: ForkIdentity = Object.freeze({
  name: "rea-clone-runs",
  commands: Object.freeze([
    "init-clone-run" satisfies typeof INIT_CLONE_RUN_OPERATION,
    "evaluate-clone-run" satisfies typeof EVALUATE_CLONE_RUN_OPERATION,
    "compare-scenario-behavior" satisfies typeof SCENARIO_BEHAVIOR_OPERATION,
  ]),
  upstream_package_note:
    "npm's rea-agents, which rea --update and npx rea-agents install, is the upstream build without these commands.",
});
