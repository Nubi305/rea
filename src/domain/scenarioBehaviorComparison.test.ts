import { describe, expect, it } from "vitest";

import {
  replyBodyExpected,
  scenarioBehaviorExitCode,
  scenarioBehaviorVerdict,
  scenarioBehaviorVolatileFieldSchema,
  scenarioStartState,
  scenarioStepKind,
  volatileValueShape,
} from "./scenarioBehaviorComparison.js";

describe("scenario behaviour contract", () => {
  it("reads a step's part from its id", () => {
    expect(scenarioStepKind("fp-notes")).toBe("fingerprint");
    expect(scenarioStepKind("setup-open")).toBe("setup");
    expect(scenarioStepKind("scenario_start")).toBe("setup");
    expect(scenarioStepKind("rea-tree-0")).toBe("reserved");
    expect(scenarioStepKind("create-empty-title")).toBe("behavior");
  });

  it("never lets missing data or one capture read as a match", () => {
    expect(scenarioBehaviorVerdict(["unchanged", "unknown"])).toBe("unknown");
    expect(scenarioBehaviorVerdict(["unstable", "unchanged"])).toBe("unknown");
    expect(scenarioBehaviorVerdict(["unknown", "changed"])).toBe("changed");
    expect(scenarioBehaviorVerdict(["unchanged"])).toBe("unchanged");
    expect(scenarioBehaviorExitCode("unchanged")).toBe(0);
    expect(scenarioBehaviorExitCode("changed")).toBe(1);
    expect(scenarioBehaviorExitCode("unknown")).toBe(2);
    expect(scenarioStartState(["a", "a"])).toBe("clean");
    expect(scenarioStartState(["a", null, "a"])).toBe("clean");
    expect(scenarioStartState(["a", "b"])).toBe("dirty");
    expect(scenarioStartState(["a", "a", "b"])).toBe("dirty");
    expect(scenarioStartState(["a"])).toBe("unknown");
    expect(scenarioStartState(["a", null])).toBe("unknown");
    expect(scenarioStartState([])).toBe("unknown");
  });

  it("expects no body where a reply cannot carry one", () => {
    expect(replyBodyExpected("GET", 200)).toBe(true);
    expect(replyBodyExpected("POST", 422)).toBe(true);
    expect(replyBodyExpected("head", 200)).toBe(false);
    expect(replyBodyExpected("GET", 204)).toBe(false);
    expect(replyBodyExpected("GET", 302)).toBe(false);
    expect(replyBodyExpected("GET", 304)).toBe(false);
  });

  it("keeps the type and layout of a volatile value comparable", () => {
    expect(volatileValueShape("2026-11-20T01:00:00.000Z")).toBe(
      volatileValueShape("2027-01-02T23:59:59.5Z"),
    );
    expect(volatileValueShape("3f2a9c1e-0000-4000-8000-000000000001")).toBe(
      "string:x-x-x-x-x",
    );
    expect(volatileValueShape("2026-11-20T01:00:00Z")).not.toBe(
      volatileValueShape(1_795_000_000),
    );
    expect(volatileValueShape(7)).toBe("number");
    expect(volatileValueShape(null)).toBe("null");
    expect(volatileValueShape([])).toBe("array");
    expect(volatileValueShape({})).toBe("object");
  });

  it("lets a volatile declaration name one leaf only", () => {
    const accepts = (pointer: string) =>
      scenarioBehaviorVolatileFieldSchema.safeParse({
        step_id: "create",
        pointer,
      }).success;
    expect(accepts("/createdAt")).toBe(true);
    expect(accepts("/items/*/id")).toBe(true);
    expect(accepts("")).toBe(false);
    expect(accepts("createdAt")).toBe(false);
  });
});
