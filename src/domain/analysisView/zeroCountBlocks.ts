import type { JsonValue } from "../jsonValue.js";

type JsonObject = { readonly [key: string]: JsonValue };

const isObject = (value: JsonValue): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** True when every leaf of a non-empty object is the count 0. */
const allZero = (value: JsonObject): boolean => {
  const entries = Object.values(value);
  return (
    entries.length > 0 &&
    entries.every((entry) => (isObject(entry) ? allZero(entry) : entry === 0))
  );
};

/**
 * A summary block whose counts are all zero says nothing a reader needs, so
 * it is left out, at any depth; arrays and other values are kept as they are.
 * Returns undefined when the whole block is zero.
 */
export const withoutZeroCountBlocks = (
  value: JsonObject,
): JsonObject | undefined => {
  if (allZero(value)) return undefined;
  const kept: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isObject(entry)) {
      kept[key] = entry;
      continue;
    }
    const pruned = withoutZeroCountBlocks(entry);
    if (pruned !== undefined) kept[key] = pruned;
  }
  return kept;
};
