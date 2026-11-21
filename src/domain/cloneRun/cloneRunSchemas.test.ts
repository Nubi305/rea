import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CLONE_RUN_CHECKS,
  CLONE_RUN_REASONS,
  CLONE_RUN_REASON_CODES,
  CLONE_RUN_ROLES,
  cloneNameConflict,
  CLONE_RUN_THIS_MACHINE,
  cloneRunAddressRelation,
  cloneRunExcludeIssue,
  cloneRunExitCode,
  cloneRunIntendedDifferencesSchema,
  cloneRunObligationsSchema,
  cloneRunReasonCheck,
  cloneRunReasonRole,
  cloneRunScenarioSchema,
  cloneRunTargetSchema,
  cloneRunUnknownRole,
  cloneRunUnknownSchema,
  cloneRunWaiversSchema,
} from "./cloneRunSchemas.js";

const contract = readFileSync(
  new URL("../../../docs/reference/clone-runs.md", import.meta.url),
  "utf8",
);

/** The JSON example the clone-run reference gives right after naming a file. */
const contractExample = (heading: string): unknown => {
  const start = contract.indexOf(heading);
  expect(start, heading).toBeGreaterThan(-1);
  const open = contract.indexOf("```json\n", start) + "```json\n".length;
  return JSON.parse(contract.slice(open, contract.indexOf("\n```", open)));
};

describe("clone run contract", () => {
  it("accepts the reference's minimal example of each authored file", () => {
    expect(
      cloneRunScenarioSchema.safeParse(
        contractExample("`scenarios/notes-api.json`"),
      ).error?.issues,
    ).toBeUndefined();
    expect(
      cloneRunObligationsSchema.safeParse(
        contractExample("`obligations/notes.json`"),
      ).error?.issues,
    ).toBeUndefined();
    expect(
      cloneRunUnknownSchema.safeParse(
        contractExample("`unknowns/prober-1.json`"),
      ).error?.issues,
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

  it("reads the role from an unknown's file name and finds an unusable clone name", () => {
    expect(cloneRunUnknownRole("prober-1")).toBe("prober");
    expect(cloneRunUnknownRole("spec_writer-12")).toBe("spec_writer");
    expect(cloneRunUnknownRole("prober")).toBeUndefined();
    expect(cloneRunUnknownRole("tester-1")).toBeUndefined();
    expect(cloneNameConflict("Notely Two", ["notely"])).toBe("notely");
    expect(cloneNameConflict("Jotter", ["Notely", "Acme"])).toBeUndefined();
  });

  it("maps every reason code to a check and a role, and the reference names each code", () => {
    for (const code of CLONE_RUN_REASON_CODES) {
      expect(CLONE_RUN_CHECKS).toContain(cloneRunReasonCheck(code));
      for (const side of [undefined, "original", "clone"] as const)
        expect(CLONE_RUN_ROLES).toContain(cloneRunReasonRole(code, side));
      expect(contract, code).toContain(`\`${code}\``);
    }
    expect(Object.keys(CLONE_RUN_REASONS)).toEqual([...CLONE_RUN_REASON_CODES]);
    expect(cloneRunReasonRole("evidence_missing", "original")).toBe("prober");
    expect(cloneRunReasonRole("evidence_missing", "clone")).toBe("verifier");
    expect(cloneRunReasonRole("parity_unstable", "original")).toBe("lead");
    // The clone's own instability is first a matter of its captures, never "change the clone".
    expect(cloneRunReasonRole("parity_unstable", "clone")).toBe("verifier");
    expect(cloneRunReasonRole("clone_path_unreadable")).toBe("builder");
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

describe("clone run scope rules", () => {
  it("calls two resolved addresses one when their ports are equal and their hosts intersect", () => {
    const address = (port: string, hosts: readonly string[] | null) => ({
      port,
      hosts,
    });
    const here = [CLONE_RUN_THIS_MACHINE];
    expect(
      cloneRunAddressRelation(address("4610", here), address("4610", here)),
    ).toBe("same");
    expect(
      cloneRunAddressRelation(
        address("4610", ["192.0.2.7", "192.0.2.8"]),
        address("4610", ["192.0.2.8"]),
      ),
    ).toBe("same");
    expect(
      cloneRunAddressRelation(
        address("4610", here),
        address("4610", ["192.0.2.8"]),
      ),
    ).toBe("distinct");
    // Two ports are two listeners whatever the hosts are, resolved or not.
    expect(
      cloneRunAddressRelation(address("4610", here), address("4611", here)),
    ).toBe("distinct");
    expect(
      cloneRunAddressRelation(address("4610", null), address("4611", null)),
    ).toBe("distinct");
    // One port and a host that did not resolve: nothing is known, which is not "distinct".
    expect(
      cloneRunAddressRelation(address("4610", here), address("4610", null)),
    ).toBe("unknown");
    expect(
      cloneRunAddressRelation(address("4610", null), address("4610", null)),
    ).toBe("unknown");
  });

  it("refuses an exclude that can never match and says what an exclude is", () => {
    const exclude = (entries: readonly string[]) =>
      cloneRunTargetSchema.shape.clone.shape.exclude.safeParse(entries);
    expect(
      exclude([".git", "node_modules", "data/app.db", "./build/"]).success,
    ).toBe(true);
    for (const entry of [
      "*.log",
      "data/*.db",
      "cache?",
      "[ab]",
      "/abs/x",
      "../up",
      "a/../b",
      "data\\app.db",
      " node_modules",
      ".",
      "./",
      "a//b",
    ]) {
      const refused = exclude([entry]);
      expect(refused.success, entry).toBe(false);
      expect(refused.error?.issues[0]?.message, entry).toContain(
        "an exclude is a path relative to the clone root",
      );
      expect(cloneRunExcludeIssue(entry), entry).toBeDefined();
    }
  });
});
