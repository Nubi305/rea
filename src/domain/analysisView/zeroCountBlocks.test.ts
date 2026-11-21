import { expect, it } from "vitest";
import { withoutZeroCountBlocks } from "./zeroCountBlocks.js";

it("leaves out blocks whose counts are all zero, at any depth", () => {
  expect(
    withoutZeroCountBlocks({
      browser_windows: 0,
      ipc: { operations: 0, literal_channels: 0 },
    }),
  ).toBeUndefined();
  expect(
    withoutZeroCountBlocks({
      parsed: 3,
      failed: 0,
      semantics: { unknown_sources: 0, unexamined_sources: 0 },
      syntax: { complete: 1, recovered: 0 },
      status: "complete",
      limits: [],
    }),
  ).toEqual({
    parsed: 3,
    failed: 0,
    syntax: { complete: 1, recovered: 0 },
    status: "complete",
    limits: [],
  });
});
