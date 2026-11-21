import { z } from "zod";

export const searchGuidanceLimitSchema = z.number().int().min(1).max(20);

/** The locator that reads the list of guides and headings instead of a section. */
export const GUIDANCE_CONTENTS_LOCATOR = "contents";

export const searchGuidanceInputSchema = z.strictObject({
  query: z
    .string()
    .min(1)
    .max(2048)
    .describe(
      "Lexical query: sections are ranked by how many non-generic words they cover (more than half), heading and keyword words weighing more; generic-only queries return no matches.",
    )
    .refine((value) => value.trim().length > 0),
  limit: searchGuidanceLimitSchema.default(3),
  cursor: z.string().min(1).max(4096).optional(),
});

export const readGuidanceSectionInputSchema = z.strictObject({
  locator: z
    .string()
    .min(1)
    .max(4096)
    .describe(
      `A locator from search_guidance (short or earlier long form), ${GUIDANCE_CONTENTS_LOCATOR} for every guide and its headings, or ${GUIDANCE_CONTENTS_LOCATOR}:<guide> for all headings of one guide.`,
    ),
});

export const searchGuidanceOutputSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("matches"),
    source: z.literal("installed_rea_guidance"),
    content_kind: z.literal("documentation"),
    package: z.string(),
    bundle_sha256: z.string().length(64),
    query: z.string(),
    matches: z.array(
      z.strictObject({
        guide: z.string(),
        heading: z.string(),
        locator: z.string(),
        matched: z
          .string()
          .describe(
            "How many of the query's non-generic words the section covers, and which.",
          ),
        context: z.string(),
        content_length: z
          .number()
          .int()
          .nonnegative()
          .describe(
            "UTF-16 length of the complete section read_guidance_section returns.",
          ),
      }),
    ),
    total_matches: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    has_more: z.boolean(),
    next_cursor: z.string().min(1).max(4096).optional(),
  }),
  z.strictObject({
    status: z.literal("no_matches"),
    source: z.literal("installed_rea_guidance"),
    content_kind: z.literal("documentation"),
    query: z.string(),
    message: z.string(),
    total_matches: z.literal(0),
  }),
  z.strictObject({
    status: z.literal("bundle_unavailable"),
    source: z.literal("installed_rea_guidance"),
    content_kind: z.literal("documentation"),
    message: z.string(),
  }),
  z.strictObject({
    status: z.literal("stale_continuation"),
    source: z.literal("installed_rea_guidance"),
    content_kind: z.literal("documentation"),
    message: z.string(),
  }),
]);

export const readGuidanceSectionOutputSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("section"),
    source: z.literal("installed_rea_guidance"),
    content_kind: z.literal("documentation"),
    package: z.string(),
    bundle_sha256: z.string().length(64),
    guide: z.string(),
    heading: z.string(),
    locator: z.string(),
    content: z.string(),
  }),
  z.strictObject({
    status: z.literal("contents"),
    source: z.literal("installed_rea_guidance"),
    content_kind: z.literal("documentation"),
    package: z.string(),
    bundle_sha256: z.string().length(64),
    guides: z.array(
      z.strictObject({
        guide: z.string(),
        sections: z.array(
          z.strictObject({
            locator: z.string(),
            depth: z.number().int().nonnegative(),
            heading: z.string(),
          }),
        ),
      }),
    ),
    more: z.string().optional(),
  }),
  z.strictObject({
    status: z.enum(["stale_locator", "bundle_unavailable"]),
    source: z.literal("installed_rea_guidance"),
    content_kind: z.literal("documentation"),
    message: z.string(),
  }),
]);

export type SearchGuidanceOutput = z.output<typeof searchGuidanceOutputSchema>;
export type ReadGuidanceSectionOutput = z.output<
  typeof readGuidanceSectionOutputSchema
>;
