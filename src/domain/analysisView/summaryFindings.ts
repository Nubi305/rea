import { z } from "zod";
import { boundedList } from "../boundedList.js";
import { jsonObjectSchema, type JsonValue } from "../jsonValue.js";

/** Rows of one finding a summary states inline; the rest are paged by its view. */
export const SUMMARY_FINDING_ROWS = 20;

/**
 * The first rows of one kind of finding, one line each, with the count the
 * summary left out and the view of the same parent that pages all of them.
 */
export const summaryFindingSchema = z.strictObject({
  name: z.string().min(1),
  /** Every address in the rows starts with this origin, which they leave out. */
  origin: z.string().exactOptional(),
  rows: z.array(z.string()),
  total: z.int().nonnegative(),
  omitted: z.int().nonnegative(),
  /**
   * The view that pages all rows: its index in the summary's `views`, or its
   * view input when it is not among them.
   */
  view: z.union([z.int().nonnegative(), jsonObjectSchema]).nullable(),
});
export type SummaryFinding = z.output<typeof summaryFindingSchema>;

/** State at most SUMMARY_FINDING_ROWS of `rows` and the count left out. */
export const summaryFinding = (
  name: string,
  rows: readonly string[],
  view: Readonly<Record<string, JsonValue>> | null,
): SummaryFinding => {
  const stated = boundedList(rows, SUMMARY_FINDING_ROWS);
  return {
    name,
    rows: [...stated.items],
    total: rows.length,
    omitted: stated.omitted,
    view: view === null ? null : { ...view },
  };
};

/**
 * The origin (scheme://host[:port]) every one of `addresses` shares, if any,
 * so rows can state the rest of each address.
 */
export const sharedOrigin = (
  addresses: readonly string[],
): string | undefined => {
  let shared: string | undefined;
  for (const address of addresses) {
    const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/iu.exec(address)?.[0];
    if (origin === undefined) return undefined;
    if (shared === undefined) shared = origin;
    else if (shared !== origin) return undefined;
  }
  return shared;
};

/** An address without the origin its finding states once. */
export const withoutOrigin = (
  address: string,
  origin: string | undefined,
): string =>
  origin === undefined || !address.startsWith(origin)
    ? address
    : address.slice(origin.length) || "/";

/** Findings with no rows say nothing a count would not; leave them out. */
export const presentFindings = (
  findings: readonly SummaryFinding[],
): { readonly findings?: SummaryFinding[] } => {
  const present = findings.filter((finding) => finding.total > 0);
  return present.length === 0 ? {} : { findings: present };
};

const withoutLimit = (view: unknown): string => {
  if (view === null || typeof view !== "object" || Array.isArray(view))
    return JSON.stringify(view);
  const {
    limit: _limit,
    offset: _offset,
    ...rest
  } = view as Record<string, unknown>;
  return JSON.stringify(rest);
};

/** Point each finding at the named view that pages it, by index. */
export const findingsWithViewIndices = (
  findings: readonly SummaryFinding[],
  named: readonly { readonly arguments: { readonly view: unknown } }[],
): SummaryFinding[] => {
  const keys = named.map((view) => withoutLimit(view.arguments.view));
  return findings.map((finding) => {
    if (finding.view === null || typeof finding.view === "number")
      return finding;
    const index = keys.indexOf(withoutLimit(finding.view));
    return index === -1 ? finding : { ...finding, view: index };
  });
};
