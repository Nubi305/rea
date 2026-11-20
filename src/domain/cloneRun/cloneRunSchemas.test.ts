import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CLONE_RUN_CHECKS,
  CLONE_RUN_REASONS,
  CLONE_RUN_REASON_CODES,
  CLONE_RUN_ROLES,
  cloneRunExitCode,
  cloneRunObligationsSchema,
  cloneRunReasonCheck,
  cloneRunReasonRole,
  cloneRunScenarioSchema,
  cloneRunUnknownSchema,
} from "./cloneRunSchemas.js";

const spec = readFileSync(
  new URL(
    "../../../docs/specs/reconstruction/clone-runs/spec.md",
    import.meta.url,
  ),
  "utf8",
);

/** The JSON example the specification gives right after naming a file. */
const specExample = (heading: string): unknown => {
  const start = spec.indexOf(heading);
  expect(start, heading).toBeGreaterThan(-1);
  const open = spec.indexOf("```json\n", start) + "```json\n".length;
  return JSON.parse(spec.slice(open, spec.indexOf("\n```", open)));
};

describe("clone run contract", () => {
  it("accepts the specification's minimal example of each authored file", () => {
    expect(
      cloneRunScenarioSchema.safeParse(
        specExample("`scenarios/notes-api.json`"),
      ).error?.issues,
    ).toBeUndefined();
    expect(
      cloneRunObligationsSchema.safeParse(
        specExample("`obligations/notes.json`"),
      ).error?.issues,
    ).toBeUndefined();
    expect(
      cloneRunUnknownSchema.safeParse(specExample("`unknowns/prober-1.json`"))
        .error?.issues,
    ).toBeUndefined();
  });

  it("names the offending member of a refused authored file", () => {
    const refused = cloneRunObligationsSchema.safeParse({
      area: "notes",
      obligations: [
        { id: "rule", statement: "A rule.", basis: "observed", cases: [] },
      ],
    });
    expect(refused.error?.issues.map(({ path }) => path)).toEqual([
      ["obligations", 0, "cases"],
    ]);
    const reserved = cloneRunScenarioSchema.safeParse({
      scenario: "notes-api",
      start_path: "/",
      actions: [{ step_id: "rea-tree-0", action: "wait_for_timeout" }],
    });
    expect(reserved.error?.issues.map(({ path }) => path)).toEqual([
      ["actions", 0, "step_id"],
    ]);
  });

  it("maps every reason code to a check and a role, and the specification names each code", () => {
    for (const code of CLONE_RUN_REASON_CODES) {
      expect(CLONE_RUN_CHECKS).toContain(cloneRunReasonCheck(code));
      for (const side of [undefined, "original", "clone"] as const)
        expect(CLONE_RUN_ROLES).toContain(cloneRunReasonRole(code, side));
      expect(spec, code).toContain(`\`${code}\``);
    }
    expect(Object.keys(CLONE_RUN_REASONS)).toEqual([...CLONE_RUN_REASON_CODES]);
    expect(cloneRunReasonRole("evidence_missing", "original")).toBe("prober");
    expect(cloneRunReasonRole("evidence_missing", "clone")).toBe("verifier");
    expect(cloneRunReasonRole("parity_unstable", "original")).toBe("lead");
    expect(cloneRunReasonRole("parity_changed")).toBe("builder");
  });

  it("exits 0 only for done", () => {
    expect(cloneRunExitCode("done")).toBe(0);
    expect(cloneRunExitCode("done_with_waivers")).toBe(0);
    expect(cloneRunExitCode("not_done")).toBe(1);
    expect(cloneRunExitCode("stalled")).toBe(2);
  });
});
