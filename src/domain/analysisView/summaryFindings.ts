import { z } from "zod";
import { jsonObjectSchema, type JsonValue } from "../jsonValue.js";

/** Rows of one finding a summary states inline; the rest are paged by its view. */
export const SUMMARY_FINDING_ROWS = 20;

/**
 * The first rows of one kind of finding, one line each, with the count the
 * summary left out and the view of the same parent that pages all of them.
 */
export const summaryFindingSchema = z.strictObject({
  name: z.string().min(1),
  rows: z.array(z.string()),
  total: z.int().nonnegative(),
  omitted: z.int().nonnegative(),
  view: jsonObjectSchema.nullable(),
});
export type SummaryFinding = z.output<typeof summaryFindingSchema>;

/** State at most SUMMARY_FINDING_ROWS of `rows` and the count left out. */
export const summaryFinding = (
  name: string,
  rows: readonly string[],
  view: Readonly<Record<string, JsonValue>> | null,
): SummaryFinding => ({
  name,
  rows: rows.slice(0, SUMMARY_FINDING_ROWS),
  total: rows.length,
  omitted: Math.max(0, rows.length - SUMMARY_FINDING_ROWS),
  view: view === null ? null : { ...view },
});

/** Findings with no rows say nothing a count would not; leave them out. */
export const presentFindings = (
  findings: readonly SummaryFinding[],
): { readonly findings?: SummaryFinding[] } => {
  const present = findings.filter((finding) => finding.total > 0);
  return present.length === 0 ? {} : { findings: present };
};
