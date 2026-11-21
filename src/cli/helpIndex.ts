import { ellipsisExcerpt } from "../domain/excerpt.js";
import { cliCommands, type CliCommandEntry } from "./commandRegistry.js";
import { formatHelpIndex, type HelpCommandRow } from "./help.js";
import {
  HELP_FAMILIES,
  HELP_START_COMMANDS,
  helpFamilyOf,
} from "./helpFamilies.js";
import type { CliInstance } from "./types.js";

/**
 * `rea --help` as an index of families, and `rea help <family>` as one
 * family's commands. A family lists each command with the first sentence of
 * its description, at most {@link LISTED_DESCRIPTION_LIMIT} characters; the
 * command's own help keeps the full text.
 */

/** The family that holds commands whose registrar has none. */
export const OTHER_HELP_FAMILY = "other";

/** Words `rea help` accepts besides family and command names. */
export const HELP_TOPICS = {
  all: "every command, one line each",
  options: "the options every command accepts",
} as const;

const LISTED_DESCRIPTION_LIMIT = 100;

/** The first sentence of a description, shortened to the listing limit. */
export const listedDescription = (description: string | undefined): string => {
  if (description === undefined) return "";
  const sentence = /^.*?[.!?](?=\s|$)/u.exec(description)?.[0] ?? description;
  const text = sentence.endsWith(".") ? sentence.slice(0, -1) : sentence;
  return ellipsisExcerpt(text, LISTED_DESCRIPTION_LIMIT - 1);
};

/** Commands by family id, sorted by name, in family order. */
export const commandsByFamily = (
  cli: CliInstance,
): ReadonlyMap<string, readonly CliCommandEntry[]> => {
  const families = new Map<string, CliCommandEntry[]>(
    HELP_FAMILIES.map(({ id }) => [id, []]),
  );
  for (const entry of cliCommands(cli)) {
    const family =
      helpFamilyOf(entry.name, entry.registrar) ?? OTHER_HELP_FAMILY;
    const list = families.get(family) ?? [];
    list.push(entry);
    families.set(family, list);
  }
  for (const list of families.values())
    list.sort((left, right) => left.name.localeCompare(right.name));
  return families;
};

const familySummary = (id: string): string =>
  HELP_FAMILIES.find((family) => family.id === id)?.summary ??
  "Commands outside the families above";

/** The root index, without a trailing newline. */
export const formatRootIndex = (
  cli: CliInstance,
  identity: { readonly version: string; readonly description: string },
): string => {
  const names = new Set(cliCommands(cli).map(({ name }) => name));
  const families: HelpCommandRow[] = [...commandsByFamily(cli)]
    .filter(([, commands]) => commands.length > 0)
    .map(([id]) => ({ name: id, description: familySummary(id) }));
  return formatHelpIndex(cli.name, {
    ...identity,
    usage: `${cli.name} <command> [options]`,
    sections: [
      {
        heading: "Start with:",
        rows: HELP_START_COMMANDS.filter(({ usage }) =>
          names.has(usage.split(" ")[0]!),
        ).map(({ usage, summary }) => ({ name: usage, description: summary })),
      },
      {
        heading: `Families (${cli.name} help <family> lists its commands):`,
        rows: families,
      },
    ],
    footer: [
      `More: ${cli.name} <command> --help (one command), ${cli.name} help all (${HELP_TOPICS.all}),`,
      `${cli.name} help options (--json, --format, --filter-output, --token-limit, ...),`,
      `${cli.name} --llms (manifest), ${cli.name} completions <shell>, ${cli.name} mcp.`,
    ],
  });
};

/** One family's page, or undefined for a name that is not a family. */
export const formatFamilyPage = (
  cli: CliInstance,
  family: string,
): string | undefined => {
  const commands = commandsByFamily(cli).get(family);
  if (commands === undefined || commands.length === 0) return undefined;
  return formatHelpIndex(`${cli.name} help ${family}`, {
    description: familySummary(family),
    usage: `${cli.name} <command> [options]`,
    sections: [
      {
        heading: "Commands:",
        rows: commands.map(({ name, definition }) => ({
          name,
          description: listedDescription(definition.description),
        })),
      },
    ],
    footer: [
      `${cli.name} <command> --help shows a command's arguments and options.`,
    ],
  });
};

/** Family ids that have commands on this CLI, in index order. */
export const helpFamilyNames = (cli: CliInstance): readonly string[] =>
  [...commandsByFamily(cli)]
    .filter(([, commands]) => commands.length > 0)
    .map(([id]) => id);
