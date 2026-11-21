/**
 * What a `--filter-output` expression selects in a document, as absolute
 * printable paths, and where a path that selects nothing stops.
 *
 * The digest of a selection is built over the saved document with these
 * paths, so every command it prints addresses the saved file from its root
 * (contract 5.3). The writer uses `stops` to refuse a filter that matched
 * nothing (contract 10.4) instead of printing `{}`.
 */
import type { OutputFilterPath, OutputFilterSegment } from "../outputFilter.js";

/** One selected value: a node, or a range of rows of an array. */
export type SelectionTarget =
  | { readonly path: string; readonly node: unknown }
  | {
      readonly path: string;
      readonly node: readonly unknown[];
      readonly from: number;
      readonly to: number;
    };

/** Where one filter path stopped without reaching a value. */
export interface SelectionStop {
  /** The filter path as written (normalized). */
  readonly path: string;
  /** The printable prefix that was reached; "" is the top level. */
  readonly at: string;
  /** Keys of the object where it stopped. */
  readonly keys?: readonly string[];
  /** Rows of the array where it stopped. */
  readonly rows?: number;
}

export interface Selection {
  readonly targets: readonly SelectionTarget[];
  readonly stops: readonly SelectionStop[];
  /** Targets past the cap that were not returned. */
  readonly more: number;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The writer's slice rule: negative counts from the end, NaN is 0. */
export const normalizeSliceIndex = (index: number, length: number): number => {
  const integer = Number.isNaN(index) ? 0 : Math.trunc(index);
  return integer < 0
    ? Math.max(length + integer, 0)
    : Math.min(integer, length);
};

/** A dotted key path joined with one more key. */
export const joinPath = (path: string, key: string): string =>
  path === "" ? key : `${path}.${key}`;

/** A parsed filter path written back as text. */
export const filterPathText = (path: OutputFilterPath): string => {
  let text = "";
  for (const segment of path)
    text +=
      "key" in segment
        ? text === ""
          ? segment.key
          : `.${segment.key}`
        : `[${String(segment.start)},${String(segment.end)}]`;
  return text;
};

/** Is `target` a range of rows rather than one value? */
export const isRange = (
  target: SelectionTarget,
): target is Extract<SelectionTarget, { from: number }> => "from" in target;

/**
 * Walk each path of a parsed `--filter-output` expression through `document`.
 *
 * A key enters an object. A key on the root array applies to every row (as the
 * writer projects it); on a nested array it stops. A slice that is not last
 * continues in every row as `<path>[i,i+1]`. A last slice, or a path that ends
 * at an array, is a range of that array; a range of one row is that row. An
 * empty or out-of-range slice stops.
 */
export const resolveTargets = (
  document: unknown,
  paths: readonly OutputFilterPath[] | undefined,
  cap = 64,
): Selection => {
  if (paths === undefined || paths.length === 0)
    return { targets: [{ path: "", node: document }], stops: [], more: 0 };
  const targets: SelectionTarget[] = [];
  const stops: SelectionStop[] = [];
  let more = 0;
  const push = (target: SelectionTarget): void => {
    if (targets.length < cap) targets.push(target);
    else more += 1;
  };
  const walk = (
    node: unknown,
    segments: readonly OutputFilterSegment[],
    path: string,
    written: string,
  ): boolean => {
    const [segment, ...tail] = segments;
    if (segment === undefined) {
      if (Array.isArray(node) && node.length > 1)
        push({ path, node, from: 0, to: node.length });
      else if (Array.isArray(node) && node.length === 1 && path !== "")
        push({ path: `${path}[0,1]`, node: node[0] });
      else push({ path, node });
      return true;
    }
    if ("key" in segment) {
      if (Array.isArray(node)) {
        if (path !== "") {
          stops.push({ path: written, at: path, rows: node.length });
          return false;
        }
        let any = false;
        node.forEach((row, index) => {
          if (
            isRecord(row) &&
            Object.hasOwn(row, segment.key) &&
            walk(
              row,
              segments,
              `[${String(index)},${String(index + 1)}]`,
              written,
            )
          )
            any = true;
        });
        if (!any) stops.push({ path: written, at: path, rows: node.length });
        return any;
      }
      if (
        !isRecord(node) ||
        !Object.hasOwn(node, segment.key) ||
        node[segment.key] === undefined
      ) {
        stops.push({
          path: written,
          at: path,
          ...(isRecord(node) ? { keys: Object.keys(node) } : {}),
        });
        return false;
      }
      return walk(
        node[segment.key],
        tail,
        joinPath(path, segment.key),
        written,
      );
    }
    if (!Array.isArray(node)) {
      stops.push({
        path: written,
        at: path,
        ...(isRecord(node) ? { keys: Object.keys(node) } : {}),
      });
      return false;
    }
    const start = normalizeSliceIndex(segment.start, node.length);
    const end = normalizeSliceIndex(segment.end, node.length);
    if (end <= start) {
      stops.push({ path: written, at: path, rows: node.length });
      return false;
    }
    if (tail.length === 0) {
      if (end - start === 1)
        push({
          path: `${path}[${String(start)},${String(end)}]`,
          node: node[start],
        });
      else push({ path, node, from: start, to: end });
      return true;
    }
    let any = false;
    for (let index = start; index < end; index += 1)
      if (
        walk(
          node[index],
          tail,
          `${path}[${String(index)},${String(index + 1)}]`,
          written,
        )
      )
        any = true;
    return any;
  };
  for (const path of paths) walk(document, path, "", filterPathText(path));
  return { targets, stops, more };
};

/** Keys listed in the unmatched message. */
const LISTED_KEYS = 20;

/**
 * The refusal text for an expression none of whose paths reached a value
 * (contract 10.4), from the first path's stop. `undefined` when something
 * matched.
 */
export const unmatchedFilterMessage = (
  selection: Selection,
): string | undefined => {
  if (selection.targets.length > 0 || selection.more > 0) return undefined;
  const stop = selection.stops[0];
  if (stop === undefined) return undefined;
  const where = stop.at === "" ? "the top level" : stop.at;
  const there =
    stop.rows !== undefined
      ? `There: an array of ${String(stop.rows)} rows; select rows with [start,end].`
      : stop.keys !== undefined && stop.keys.length > 0
        ? `Keys there: ${stop.keys.slice(0, LISTED_KEYS).join(", ")}${stop.keys.length > LISTED_KEYS ? `, and ${String(stop.keys.length - LISTED_KEYS)} more` : ""}.`
        : stop.keys !== undefined
          ? "There: an empty object."
          : "There: a value that has no keys.";
  return `--filter-output matched nothing: ${stop.path} stops at ${where}. ${there}`;
};
