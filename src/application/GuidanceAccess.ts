import { fileURLToPath } from "node:url";
import type { z } from "zod";
import {
  ArtifactResourceScope,
  AnalysisCleanupLease,
  ArtifactReaderFailure,
} from "../resources/index.js";
import { MANAGED_SKILL_FILES, readSkillFile } from "./SetupSkill.js";
import { PRODUCT_IDENTITY } from "../identity.js";
import {
  GUIDANCE_CONTENTS_LOCATOR,
  readGuidanceSectionInputSchema,
  readGuidanceSectionOutputSchema,
  type ReadGuidanceSectionOutput,
  type SearchGuidanceOutput,
  searchGuidanceInputSchema,
  searchGuidanceOutputSchema,
} from "../contracts/guidanceContracts.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import {
  bindRegularFileCleanup,
  RetainedRegularFileCleanupFailure,
} from "../process/RegularFileRead.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  parseGuidanceSections,
  type GuideSection,
} from "./GuidanceSections.js";
import {
  contextFor,
  GENERIC_QUERY_WORDS,
  isWholeGuide,
  rankSections,
  readLength,
  words,
  type RankedSection,
} from "./GuidanceRanking.js";
import { sha256Hex } from "../kernel/sha256Hex.js";

const SKILL_ROOT = `../../skills/${PRODUCT_IDENTITY.skillName}/`;
const SOURCE = "installed_rea_guidance" as const;
const MAX_GUIDE_FILE_BYTES = 1_048_576;
const MAX_GUIDE_BUNDLE_BYTES = 4_194_304;
interface GuidanceBundle {
  readonly digest: string;
  readonly sections: readonly GuideSection[];
}

const readPackagedGuide = (
  relativePath: string,
  resources: ArtifactResourceScope,
): Promise<string> =>
  readSkillFile(
    fileURLToPath(new URL(`${SKILL_ROOT}${relativePath}`, import.meta.url)),
    resources,
    MAX_GUIDE_FILE_BYTES,
  );

type GuidanceBundleRead =
  | { readonly kind: "available"; readonly bundle: GuidanceBundle }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "cleanup"; readonly error: ProviderCleanupError };

const guidanceCleanupFailure = (
  cause: unknown,
  resources: ArtifactResourceScope,
  operation: string,
): ProviderCleanupError => {
  const observation = ArtifactReaderFailure.cleanupObservation(
    cause,
    resources.cleanupResources,
  );
  const error = new ProviderCleanupError(
    "rea",
    resources.cleanupResources,
    { phase: "managed_guidance_read", reason: observation.reason },
    {
      operation,
      cause,
      cleanup: observation,
      remediationAction:
        "Close REA so it can retry releasing the retained guidance file handle. Do not repeat the request until cleanup completes.",
    },
  );
  bindRegularFileCleanup(cause, error);
  return error;
};

const readBundle = async (
  readGuide: (relativePath: string) => Promise<string>,
  resources: ArtifactResourceScope,
  operation: string,
): Promise<GuidanceBundleRead> => {
  const files = new Map<string, string>();
  let bundleBytes = 0;
  try {
    for (const relativePath of MANAGED_SKILL_FILES) {
      const content = await readGuide(relativePath);
      bundleBytes += Buffer.byteLength(content, "utf8");
      if (bundleBytes > MAX_GUIDE_BUNDLE_BYTES)
        return {
          kind: "unavailable",
          message:
            "Installed REA guidance exceeds the 4 MiB bundle allowance; no partial bundle was indexed.",
        };
      files.set(relativePath, content.replaceAll("\r\n", "\n"));
    }
  } catch (cause: unknown) {
    return cause instanceof RetainedRegularFileCleanupFailure ||
      (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined)
      ? {
          kind: "cleanup",
          error: guidanceCleanupFailure(cause, resources, operation),
        }
      : {
          kind: "unavailable",
          message:
            "Installed REA guidance is missing or unreadable; no complete bundle could be indexed.",
        };
  }
  const digest = sha256Hex(
    [...files]
      .map(([path, content]) => `${path}\0${sha256Hex(content)}\n`)
      .join(""),
  );
  const sections = parseGuidanceSections(files);
  if (sections === undefined)
    return {
      kind: "unavailable",
      message:
        "Installed REA guidance exceeds the 4,096-section or 25,165,824 expanded UTF-16-code-unit index allowance; no partial index was used.",
    };
  return { kind: "available", bundle: { digest, sections } };
};

type GuidanceReader = (
  relativePath: string,
  resources: ArtifactResourceScope,
) => Promise<string>;
type GuidanceResult<Value> = Result<
  Value,
  AnalysisInputError | ProviderCleanupError
>;

/** Admit the complete request once; file reads belong to its independent child. */
const runGuidanceOperation = async <Value>(
  resources: ArtifactResourceScope,
  operationName: string,
  operation: (child: ArtifactResourceScope) => Promise<GuidanceResult<Value>>,
): Promise<GuidanceResult<Value>> => {
  try {
    return await resources.run(async () => {
      const child = new ArtifactResourceScope();
      try {
        return await operation(child);
      } finally {
        if (child.hasPending)
          resources.retain({
            kind: "lease",
            resource: "managed guidance operation",
            lease: new AnalysisCleanupLease(() => child.close(), {
              get cleanupResources() {
                return child.cleanupResources;
              },
            }),
          });
        else await child.close();
      }
    });
  } catch (cause: unknown) {
    if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined)
      return err(guidanceCleanupFailure(cause, resources, operationName));
    throw cause;
  }
};

/** Reader seams receive the operation child rather than re-entering the root. */
export const searchGuidanceWithReader = (
  input: unknown,
  readGuide: GuidanceReader,
  resources: ArtifactResourceScope,
): Promise<GuidanceResult<SearchGuidanceOutput>> =>
  runGuidanceOperation(resources, "search_guidance", (child) =>
    searchGuidanceInScope(input, (path) => readGuide(path, child), child),
  );

export const readGuidanceSectionWithReader = (
  input: unknown,
  readGuide: GuidanceReader,
  resources: ArtifactResourceScope,
): Promise<GuidanceResult<ReadGuidanceSectionOutput>> =>
  runGuidanceOperation(resources, "read_guidance_section", (child) =>
    readGuidanceSectionInScope(input, (path) => readGuide(path, child), child),
  );

const invalidInput = (
  operation: string,
  input: unknown,
  issues: readonly z.core.$ZodIssue[],
): Result<never, AnalysisInputError> =>
  err(analysisInputErrorFromIssues(operation, issues, input));

export const searchGuidance = async (
  input: unknown,
  resources: ArtifactResourceScope,
): Promise<
  Result<SearchGuidanceOutput, AnalysisInputError | ProviderCleanupError>
> => searchGuidanceWithReader(input, readPackagedGuide, resources);

/** Reader seam keeps packaged-guide drift and missing-file behavior testable. */
const searchGuidanceInScope = async (
  input: unknown,
  readGuide: (relativePath: string) => Promise<string>,
  resources: ArtifactResourceScope,
): Promise<
  Result<SearchGuidanceOutput, AnalysisInputError | ProviderCleanupError>
> => {
  const parsed = searchGuidanceInputSchema.safeParse(input);
  if (!parsed.success)
    return invalidInput("search_guidance", input, parsed.error.issues);
  const cursor =
    parsed.data.cursor === undefined
      ? undefined
      : decodeGuidanceCursor(parsed.data.cursor);
  if (parsed.data.cursor !== undefined && cursor === undefined)
    return invalidInput("search_guidance", input, [
      {
        code: "custom",
        path: ["cursor"],
        message: "Invalid guidance continuation token",
      },
    ]);
  const queryDigest = sha256Hex(parsed.data.query);
  if (cursor !== undefined && !queryDigest.startsWith(cursor.query))
    return invalidInput("search_guidance", input, [
      {
        code: "custom",
        path: ["cursor"],
        message: "The continuation token belongs to a different query",
      },
    ]);
  const loaded = await readBundle(readGuide, resources, "search_guidance");
  if (loaded.kind === "cleanup") return err(loaded.error);
  if (loaded.kind === "unavailable")
    return ok(
      searchGuidanceOutputSchema.parse({
        status: "bundle_unavailable",
        source: SOURCE,
        content_kind: "documentation",
        message: loaded.message,
      }),
    );
  const bundle = loaded.bundle;

  if (cursor !== undefined && !bundle.digest.startsWith(cursor.bundle))
    return ok(
      searchGuidanceOutputSchema.parse({
        status: "stale_continuation",
        source: SOURCE,
        content_kind: "documentation",
        message:
          "The installed guidance changed since this search page was issued. Restart the search to continue with current content.",
      }),
    );

  const queryWords = words(parsed.data.query);
  const ranked = rankSections(
    bundle.sections,
    parsed.data.query,
    queryWords,
    queryWords.filter((word) => !GENERIC_QUERY_WORDS.has(word)),
  );

  if (ranked.length === 0)
    return ok(
      searchGuidanceOutputSchema.parse({
        status: "no_matches",
        source: SOURCE,
        content_kind: "documentation",
        query: parsed.data.query,
        message:
          "No bundled guidance sections matched this query. This does not indicate whether an analysis capability is available.",
        total_matches: 0,
      }),
    );

  const offset = cursor?.offset ?? 0;
  if (cursor !== undefined && offset >= ranked.length)
    return invalidInput("search_guidance", input, [
      {
        code: "custom",
        path: ["cursor"],
        message:
          "The continuation token does not select a remaining result page",
      },
    ]);
  const page = ranked.slice(offset, offset + parsed.data.limit);
  const hasMore = offset + page.length < ranked.length;
  return ok(
    searchGuidanceOutputSchema.parse({
      status: "matches",
      source: SOURCE,
      content_kind: "documentation",
      package: `${PRODUCT_IDENTITY.packageName}@${PRODUCT_IDENTITY.packageVersion}`,
      bundle_sha256: bundle.digest,
      query: parsed.data.query,
      matches: page.map(presentMatch),
      total_matches: ranked.length,
      offset,
      limit: parsed.data.limit,
      has_more: hasMore,
      ...(hasMore
        ? {
            next_cursor: encodeGuidanceCursor({
              v: 1,
              bundle: bundle.digest,
              query: queryDigest,
              offset: offset + page.length,
            }),
          }
        : {}),
    }),
  );
};

/** The short locator: guide, section ordinal and 8 hex digits of the section's digest. */
const shortLocator = (section: GuideSection): string =>
  `${section.guide}#${section.ordinal}.${sha256Hex(section.content).slice(0, 8)}`;

const SHORT_LOCATOR = /^(.+)#(\d{1,6})\.([a-f0-9]{8})$/u;

const presentMatch = (match: RankedSection) => {
  const { section, matched, of } = match;
  return {
    guide: section.guide,
    heading: section.heading,
    locator: shortLocator(section),
    matched: `${matched.length} of ${of}: ${matched.join(", ")}`,
    context: contextFor(section.ownContent, matched),
    content_length: readLength(section),
  };
};

/**
 * What a short locator of a whole guide reads: the guide's introduction and
 * its sections, each with its locator, instead of the whole guide. The
 * earlier long locator form still reads the whole guide.
 */
const guideIntroduction = (
  bundle: GuidanceBundle,
  guide: GuideSection,
): string =>
  [
    guide.ownContent,
    "",
    "Sections of this guide (read one with its locator):",
    ...bundle.sections
      .filter((section) => section.parent === guide)
      .map((section) => `- ${section.heading}: ${shortLocator(section)}`),
  ].join("\n");

/** The guides and their headings, each with the locator that reads it. */
const guidanceContents = (
  bundle: GuidanceBundle,
  guide: string | undefined,
) => {
  const depth = (section: GuideSection): number => {
    let level = 0;
    for (let parent = section.parent; parent !== undefined;) {
      level += 1;
      parent = parent.parent;
    }
    return level;
  };
  const guides = [...new Set(bundle.sections.map((section) => section.guide))]
    .filter((name) => guide === undefined || name === guide)
    .map((name) => ({
      guide: name,
      sections: bundle.sections
        .filter(
          (section) =>
            section.guide === name &&
            (guide !== undefined || depth(section) <= 1),
        )
        .map((section) => ({
          locator: shortLocator(section),
          depth: depth(section),
          heading: section.heading,
        })),
    }));
  return guides;
};

export const readGuidanceSection = async (
  input: unknown,
  resources: ArtifactResourceScope,
): Promise<
  Result<ReadGuidanceSectionOutput, AnalysisInputError | ProviderCleanupError>
> => readGuidanceSectionWithReader(input, readPackagedGuide, resources);

/** Reader seam keeps packaged-guide drift and missing-file behavior testable. */
const readGuidanceSectionInScope = async (
  input: unknown,
  readGuide: (relativePath: string) => Promise<string>,
  resources: ArtifactResourceScope,
): Promise<
  Result<ReadGuidanceSectionOutput, AnalysisInputError | ProviderCleanupError>
> => {
  const parsed = readGuidanceSectionInputSchema.safeParse(input);
  if (!parsed.success)
    return invalidInput("read_guidance_section", input, parsed.error.issues);
  const request = parseLocatorRequest(parsed.data.locator);
  if (request === undefined)
    return invalidInput("read_guidance_section", input, [
      {
        code: "custom",
        path: ["locator"],
        message: `Malformed or unsupported guidance locator; use a locator from search_guidance, or ${GUIDANCE_CONTENTS_LOCATOR} for the list of guides and headings`,
      },
    ]);
  const loaded = await readBundle(
    readGuide,
    resources,
    "read_guidance_section",
  );
  if (loaded.kind === "cleanup") return err(loaded.error);
  if (loaded.kind === "unavailable")
    return ok(
      readGuidanceSectionOutputSchema.parse({
        status: "bundle_unavailable",
        source: SOURCE,
        content_kind: "documentation",
        message: loaded.message,
      }),
    );
  const bundle = loaded.bundle;
  if (request.kind === "contents")
    return ok(
      readGuidanceSectionOutputSchema.parse({
        status: "contents",
        source: SOURCE,
        content_kind: "documentation",
        package: `${PRODUCT_IDENTITY.packageName}@${PRODUCT_IDENTITY.packageVersion}`,
        bundle_sha256: bundle.digest,
        guides: guidanceContents(bundle, request.guide),
        ...(request.guide === undefined
          ? {
              more: `Headings up to the second level. ${GUIDANCE_CONTENTS_LOCATOR}:<guide> lists every heading of one guide.`,
            }
          : {}),
      }),
    );
  const identity = request.identity;
  if (identity.kind === "full" && identity.bundle !== bundle.digest)
    return ok(
      readGuidanceSectionOutputSchema.parse({
        status: "stale_locator",
        source: SOURCE,
        content_kind: "documentation",
        message:
          "The installed guidance changed since this locator was issued. Search again for a current locator.",
      }),
    );
  const section = bundle.sections.find(
    (candidate) =>
      candidate.guide === identity.guide &&
      candidate.ordinal === identity.ordinal &&
      (identity.kind === "full"
        ? sha256Hex(candidate.content) === identity.section
        : sha256Hex(candidate.content).startsWith(identity.section)),
  );
  if (section === undefined)
    return ok(
      readGuidanceSectionOutputSchema.parse({
        status: "stale_locator",
        source: SOURCE,
        content_kind: "documentation",
        message:
          "The selected section is no longer present in the installed guidance. Search again.",
      }),
    );
  return ok(
    readGuidanceSectionOutputSchema.parse({
      status: "section",
      source: SOURCE,
      content_kind: "documentation",
      package: `${PRODUCT_IDENTITY.packageName}@${PRODUCT_IDENTITY.packageVersion}`,
      bundle_sha256: bundle.digest,
      guide: section.guide,
      heading: section.heading,
      locator: parsed.data.locator,
      content:
        identity.kind === "short" && isWholeGuide(section)
          ? guideIntroduction(bundle, section)
          : section.content,
    }),
  );
};

/**
 * A section a locator names. The full form (`rea-guide-v1.`, issued before
 * short locators) binds the whole bundle; the short form binds the section
 * by guide, ordinal and the first 8 hex digits of its content digest.
 */
type LocatorIdentity =
  | {
      readonly kind: "full";
      readonly v: 1;
      readonly bundle: string;
      readonly guide: string;
      readonly ordinal: number;
      readonly section: string;
    }
  | {
      readonly kind: "short";
      readonly guide: string;
      readonly ordinal: number;
      readonly section: string;
    };

/** Digests are complete in the earlier cursor form and 16-digit prefixes in the short one. */
interface GuidanceCursor {
  readonly v: 1;
  readonly bundle: string;
  readonly query: string;
  readonly offset: number;
}

/** A cursor carries 16 hex digits of each digest: offset, bundle, query. */
const CURSOR_DIGEST_LENGTH = 16;
const SHORT_CURSOR = /^p(\d{1,9})\.([a-f0-9]{16})\.([a-f0-9]{16})$/u;

const encodeGuidanceCursor = (cursor: GuidanceCursor): string =>
  // generation-cap: a digest prefix that names the bundle and query, not a list.
  `p${cursor.offset}.${cursor.bundle.slice(0, CURSOR_DIGEST_LENGTH)}.${cursor.query.slice(0, CURSOR_DIGEST_LENGTH)}`;

/** The short cursor, or the earlier `rea-guidance-page-v1.` form. */
const decodeGuidanceCursor = (cursor: string): GuidanceCursor | undefined => {
  const short = SHORT_CURSOR.exec(cursor);
  if (short !== null) {
    const offset = Number(short[1]);
    return offset < 1
      ? undefined
      : { v: 1, offset, bundle: short[2]!, query: short[3]! };
  }
  const prefix = "rea-guidance-page-v1.";
  if (!cursor.startsWith(prefix)) return undefined;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor.slice(prefix.length), "base64url").toString("utf8"),
    );
    if (typeof value !== "object" || value === null) return undefined;
    const item = value as Partial<GuidanceCursor>;
    if (
      item.v !== 1 ||
      typeof item.bundle !== "string" ||
      !/^[a-f0-9]{64}$/u.test(item.bundle) ||
      typeof item.query !== "string" ||
      !/^[a-f0-9]{64}$/u.test(item.query) ||
      typeof item.offset !== "number" ||
      !Number.isInteger(item.offset) ||
      item.offset < 1
    )
      return undefined;
    return item as GuidanceCursor;
  } catch {
    return undefined;
  }
};

const decodeLocator = (locator: string): LocatorIdentity | undefined => {
  const short = SHORT_LOCATOR.exec(locator);
  if (short !== null)
    return (MANAGED_SKILL_FILES as readonly string[]).includes(short[1]!)
      ? {
          kind: "short",
          guide: short[1]!,
          ordinal: Number(short[2]),
          section: short[3]!,
        }
      : undefined;
  if (!locator.startsWith("rea-guide-v1.")) return undefined;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(locator.slice("rea-guide-v1.".length), "base64url").toString(
        "utf8",
      ),
    );
    if (typeof value !== "object" || value === null) return undefined;
    const item = value as Partial<{
      v: number;
      bundle: string;
      guide: string;
      ordinal: number;
      section: string;
    }>;
    if (
      item.v !== 1 ||
      typeof item.bundle !== "string" ||
      !/^[a-f0-9]{64}$/u.test(item.bundle) ||
      typeof item.guide !== "string" ||
      !(MANAGED_SKILL_FILES as readonly string[]).includes(item.guide) ||
      !Number.isInteger(item.ordinal) ||
      typeof item.section !== "string" ||
      !/^[a-f0-9]{64}$/u.test(item.section)
    )
      return undefined;
    return {
      kind: "full",
      v: 1,
      bundle: item.bundle,
      guide: item.guide,
      ordinal: item.ordinal as number,
      section: item.section,
    };
  } catch {
    return undefined;
  }
};

type LocatorRequest =
  | { readonly kind: "contents"; readonly guide: string | undefined }
  | { readonly kind: "section"; readonly identity: LocatorIdentity };

/** `contents`, `contents:<guide>`, a short locator or the earlier full form. */
const parseLocatorRequest = (locator: string): LocatorRequest | undefined => {
  if (locator === GUIDANCE_CONTENTS_LOCATOR)
    return { kind: "contents", guide: undefined };
  if (locator.startsWith(`${GUIDANCE_CONTENTS_LOCATOR}:`)) {
    const guide = locator.slice(GUIDANCE_CONTENTS_LOCATOR.length + 1);
    return (MANAGED_SKILL_FILES as readonly string[]).includes(guide)
      ? { kind: "contents", guide }
      : undefined;
  }
  const identity = decodeLocator(locator);
  return identity === undefined ? undefined : { kind: "section", identity };
};
