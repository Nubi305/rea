import { GENERIC_QUERY_WORDS, words } from "./GuidanceRanking.js";

/** One command as a search reads it: its name and its one-line description. */
export interface SearchableCommand {
  readonly name: string;
  readonly description: string;
}

/** A command a word search found, with the query words it covers. */
export interface CommandMatch extends SearchableCommand {
  readonly matched: readonly string[];
}

/** At most this many commands per search. */
export const COMMAND_MATCH_LIMIT = 10;

// "endpoint" finds "endpoints" and "decompile" finds "decompiled"; shorter
// words must match exactly, so "id" does not find "identity".
const STEM_LENGTH = 4;

// A stem differs from its word by a short ending at most ("openapi" does not
// find "open").
const MAX_ENDING = 2;

const covers = (vocabulary: readonly string[], word: string): boolean =>
  vocabulary.some(
    (candidate) =>
      candidate === word ||
      (word.length >= STEM_LENGTH &&
        candidate.length >= STEM_LENGTH &&
        Math.abs(candidate.length - word.length) <= MAX_ENDING &&
        (candidate.startsWith(word) || word.startsWith(candidate))),
  );

/** The non-generic words of a query, as the guidance search reads them. */
export const commandQueryWords = (query: string): readonly string[] =>
  words(query).filter((word) => !GENERIC_QUERY_WORDS.has(word));

/**
 * Commands whose name or one-line description covers at least half of the
 * query's non-generic words, most covered first, then by name.
 */
export const searchCommands = (
  commands: readonly SearchableCommand[],
  query: string,
): readonly CommandMatch[] => {
  const wanted = commandQueryWords(query);
  if (wanted.length === 0) return [];
  const needed = Math.ceil(wanted.length / 2);
  return commands
    .map((command) => {
      const vocabulary = words(
        `${command.name.replaceAll("-", " ").replaceAll("_", " ")} ${command.description}`,
      );
      return {
        ...command,
        matched: wanted.filter((word) => covers(vocabulary, word)),
      };
    })
    .filter(({ matched }) => matched.length >= needed)
    .sort(
      (left, right) =>
        right.matched.length - left.matched.length ||
        left.name.localeCompare(right.name),
    )
    .slice(0, COMMAND_MATCH_LIMIT);
};
