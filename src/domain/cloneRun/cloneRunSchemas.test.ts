import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CLONE_RUN_CHECKS,
  CLONE_RUN_REASONS,
  CLONE_RUN_REASON_CODES,
  CLONE_RUN_ROLES,
  cloneNameConflict,
  cloneRunAddressIdentity,
  cloneRunExitCode,
  cloneRunIntendedDifferencesSchema,
  cloneRunObligationsSchema,
  cloneRunReasonCheck,
  cloneRunReasonRole,
  cloneRunScenarioSchema,
  cloneRunUnknownRole,
  cloneRunUnknownSchema,
  cloneRunWaiversSchema,
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
      obligations: [
        { id: "rule", statement: "A rule.", basis: "observed", cases: [] },
      ],
    });
    expect(refused.error?.issues.map(({ path }) => path)).toEqual([
      ["obligations", 0, "cases"],
    ]);
    const reserved = cloneRunScenarioSchema.safeParse({
      start_path: "/",
      actions: [
        { step_id: "fp-list", action: "request" },
        { step_id: "create", action: "request" },
        { step_id: "rea-tree-0", action: "wait_for_timeout" },
      ],
    });
    expect(reserved.error?.issues.map(({ path }) => path)).toEqual([
      ["actions", 2, "step_id"],
    ]);
  });

  it("refuses a scenario that could pass without proving anything", () => {
    const issues = (stepIds: readonly string[]) =>
      cloneRunScenarioSchema
        .safeParse({
          start_path: "/",
          actions: stepIds.map((id) => ({ step_id: id, action: "request" })),
        })
        .error?.issues.map(({ path }) => path.join("/"));
    expect(issues(["fp-list", "create"])).toBeUndefined();
    // No behaviour step: nothing would be cited or have to match.
    expect(issues(["fp-list", "setup-create"])).toEqual(["actions"]);
    // No fingerprint: a dirty start could not be seen.
    expect(issues(["create"])).toEqual(["actions"]);
    // A fingerprint read after a step that may have changed the state.
    expect(issues(["fp-list", "create", "fp-late"])).toEqual([
      "actions/2/step_id",
    ]);
    expect(issues(["fp-list", "create", "create"])).toEqual([
      "actions/2/step_id",
    ]);
  });

  it("refuses declarations that would cover more than they name", () => {
    const volatile = (pointer: string) =>
      cloneRunIntendedDifferencesSchema.safeParse({
        renames: [],
        volatile_fields: [
          { scenario: "notes-api", step_id: "create", pointer, reason: "time" },
        ],
      }).success;
    expect(volatile("/createdAt")).toBe(true);
    expect(volatile("/items/*/id")).toBe(true);
    // The whole body cannot be declared volatile.
    expect(volatile("")).toBe(false);
    const waiver = (person: string) =>
      cloneRunWaiversSchema.safeParse({
        waivers: [{ kind: "unknown", id: "prober-1", person, reason: "why" }],
        closed: [],
      }).success;
    expect(waiver("A. Person")).toBe(true);
    expect(waiver("   ")).toBe(false);
  });

  it("counts every loopback name as one host", () => {
    const same = (left: string, right: string) =>
      cloneRunAddressIdentity(left) === cloneRunAddressIdentity(right);
    expect(same("http://127.0.0.1:4610", "http://localhost:4610")).toBe(true);
    expect(same("http://[::1]:4610", "http://app.localhost:4610")).toBe(true);
    expect(same("http://127.0.0.1:4610", "http://127.0.0.1:4611")).toBe(false);
    expect(same("http://127.0.0.1:4610", "https://127.0.0.1:4610")).toBe(false);
    expect(same("http://a.example:80", "http://b.example:80")).toBe(false);
  });

  it("reads the role from an unknown's file name and finds an unusable clone name", () => {
    expect(cloneRunUnknownRole("prober-1")).toBe("prober");
    expect(cloneRunUnknownRole("spec_writer-12")).toBe("spec_writer");
    expect(cloneRunUnknownRole("prober")).toBeUndefined();
    expect(cloneRunUnknownRole("tester-1")).toBeUndefined();
    expect(cloneNameConflict("Notely Two", ["notely"])).toBe("notely");
    expect(cloneNameConflict("Jotter", ["Notely", "Acme"])).toBeUndefined();
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
    expect(cloneRunReasonRole("clone_symlink_outside_root")).toBe("builder");
    expect(cloneRunReasonRole("start_state_unknown", "clone")).toBe("verifier");
  });

  it("exits 0 only for done", () => {
    expect(cloneRunExitCode("done")).toBe(0);
    expect(cloneRunExitCode("done_with_waivers")).toBe(0);
    expect(cloneRunExitCode("not_done")).toBe(1);
    expect(cloneRunExitCode("stalled")).toBe(2);
  });
});
