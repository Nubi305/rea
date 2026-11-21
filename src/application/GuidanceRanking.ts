import { ellipsisExcerpt } from "../domain/excerpt.js";
import type { GuideSection } from "./GuidanceSections.js";

/**
 * How guidance search reads a query and ranks sections: word splitting,
 * plural folding, keyword lines, weights and the context line.
 */

export const words = (text: string): string[] => [
  ...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []),
];

export const GENERIC_QUERY_WORDS: ReadonlySet<string> = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "my",
  "of",
  "on",
  "or",
  "should",
  "so",
  "that",
  "the",
  "their",
  "there",
  "they",
  "this",
  "to",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

export interface RankedSection {
  readonly section: GuideSection;
  /** Query words the section's heading, keywords or own text holds, in query order. */
  readonly matched: readonly string[];
  /** Specific query words, the denominator of the shown count. */
  readonly of: number;
  /** Weighted coverage; see {@link rankSections}. */
  readonly score: number;
}

/**
 * Light English plural folding, so "classes" finds "class" and "matches"
 * finds "match"; applied to query and guide words alike.
 */
export const stem = (word: string): string => {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(?:ch|sh|x|ss)es$/u.test(word))
    return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss"))
    return word.slice(0, -1);
  return word;
};

/** An author's extra search words for a section: `<!-- keywords: a, b -->`. */
const KEYWORD_LINE = /<!--\s*keywords:([^>]*?)-->/giu;

const keywordText = (ownContent: string): string =>
  [...ownContent.matchAll(KEYWORD_LINE)].map((match) => match[1]).join(" ");

/**
 * A guide's first heading. A short locator of it reads the guide's
 * introduction and its sections, never the whole guide.
 */
export const isWholeGuide = (section: GuideSection): boolean =>
  section.parent === undefined && section.ordinal === 0;

/** Where a query word occurs in a section, and how much that weighs. */
const HEADING_WEIGHT = 3;
const PATH_WEIGHT = 2;
const TEXT_WEIGHT = 1;
/** Each repeat in the own text, up to five, adds this much. */
const REPEAT_WEIGHT = 0.1;

/** Query tokens such as `evidence_stale` or `no-such-flag`, matched whole. */
const IDENTIFIER = /[\p{L}\p{N}]+(?:[_-][\p{L}\p{N}]+)+/gu;

const wordCounts = (text: string): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const key = stem(word);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const headingPath = (section: GuideSection): string => {
  const titles: string[] = [];
  for (
    let parent = section.parent;
    parent !== undefined;
    parent = parent.parent
  )
    titles.push(parent.heading);
  return titles.join(" ");
};

interface IndexedSection {
  readonly section: GuideSection;
  readonly salient: ReadonlySet<string>;
  readonly path: ReadonlySet<string>;
  readonly counts: ReadonlyMap<string, number>;
}

const indexSection = (section: GuideSection): IndexedSection => ({
  section,
  salient: new Set(
    words(`${section.heading} ${keywordText(section.ownContent)}`).map(stem),
  ),
  path: new Set(words(headingPath(section)).map(stem)),
  counts: wordCounts(section.ownContent),
});

const wordWeight = (entry: IndexedSection, word: string): number =>
  entry.salient.has(word)
    ? HEADING_WEIGHT
    : entry.path.has(word)
      ? PATH_WEIGHT
      : entry.counts.has(word)
        ? TEXT_WEIGHT
        : 0;

/** The text a reader of the match receives: a whole guide reads as its introduction. */
export const readLength = (section: GuideSection): number =>
  isWholeGuide(section) ? section.ownContent.length : section.content.length;

/**
 * Rank sections by the query words they cover, each weighted by where it
 * occurs (heading or keyword line, enclosing headings, own text before the
 * first subsection) and by how rare it is in the guidance, plus a bonus for
 * an identifier the text spells exactly. A section needs more than half the
 * specific words. Ties go to the shorter read.
 */
export const rankSections = (
  sections: readonly GuideSection[],
  query: string,
  queryWords: readonly string[],
  specificWords: readonly string[],
): readonly RankedSection[] => {
  if (specificWords.length === 0) return [];
  const wanted = [...new Set(specificWords.map(stem))];
  // More than half: a subject the guidance never names is not swapped for
  // the common words around it.
  const floor = Math.floor(wanted.length / 2) + 1;
  const indexed = sections.map(indexSection);
  const identifiers = query.toLowerCase().match(IDENTIFIER) ?? [];
  const rarity = new Map(
    wanted.map((word) => {
      const holders = indexed.filter(
        ({ salient, counts }) => salient.has(word) || counts.has(word),
      ).length;
      return [word, Math.log((indexed.length + 1) / (holders + 1)) + 1];
    }),
  );
  const ranked = indexed.flatMap((entry) => {
    const covered = wanted.filter((word) => wordWeight(entry, word) > 0);
    if (covered.length < floor) return [];
    const coveredSet = new Set(covered);
    const text = entry.section.ownContent.toLowerCase();
    const score =
      covered.reduce(
        (sum, word) =>
          sum +
          (wordWeight(entry, word) +
            REPEAT_WEIGHT * Math.min(entry.counts.get(word) ?? 0, 5)) *
            rarity.get(word)!,
        0,
      ) +
      // An identifier the text spells exactly, such as an error code.
      identifiers
        .filter((identifier) => text.includes(identifier))
        .reduce(
          (sum, identifier) =>
            sum +
            HEADING_WEIGHT *
              words(identifier)
                .map(stem)
                .reduce((total, word) => total + (rarity.get(word) ?? 1), 0),
          0,
        );
    return [
      {
        section: entry.section,
        matched: queryWords.filter((word) => coveredSet.has(stem(word))),
        of: wanted.length,
        score,
      },
    ];
  });
  return ranked.sort(
    (left, right) =>
      right.score - left.score ||
      readLength(left.section) - readLength(right.section) ||
      compareText(left.section.guide, right.section.guide) ||
      left.section.ordinal - right.section.ordinal,
  );
};

const CONTEXT_LIMIT = 200;

/** The line of a section's own text that holds the most matched words. */
export const contextFor = (
  content: string,
  matched: readonly string[],
): string => {
  const terms = new Set(matched.map(stem));
  let best = "";
  let bestScore = 0;
  for (const line of content.split("\n").slice(1)) {
    if (KEYWORD_LINE.test(line)) {
      KEYWORD_LINE.lastIndex = 0;
      continue;
    }
    const score = words(line).filter((word) => terms.has(stem(word))).length;
    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }
  return ellipsisExcerpt(
    best.replaceAll(/\s+/gu, " ").trim(),
    CONTEXT_LIMIT - 1,
  );
};

export const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;
