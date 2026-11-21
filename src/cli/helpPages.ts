import { z } from "zod";

import { CLI_OUTPUT_FORMATS } from "../cliOutput.js";
import { PRODUCT_IDENTITY } from "../identity.js";
import { cliCommands, type CliCommandEntry } from "./commandRegistry.js";
import { suggestCommand } from "./commandSuggestion.js";
import {
  formatCommandHelp,
  formatCommandListHelp,
  type HelpCommandRow,
} from "./help.js";
import {
  formatFamilyPage,
  formatRootIndex,
  helpFamilyNames,
  HELP_TOPICS,
} from "./helpIndex.js";
import { MCP_SUBCOMMANDS } from "./mcpBuiltinCommands.js";
import type { CliInstance } from "./types.js";

/** The pages `--help` and `rea help <topic>` print. */

/** The root page's description of REA. */
export const CLI_DESCRIPTION =
  "Reverse engineer anything from your terminal or agent.";

/** Global options REA defines beyond the standard output controls. */
export const CLI_CUSTOM_GLOBAL_OPTIONS = z.object({
  timings: z
    .boolean()
    .default(false)
    .describe("Write measured command timing to stderr."),
});

export const MCP_GROUP_DESCRIPTION = "Register as MCP server";
export const COMPLETIONS_DESCRIPTION = "Generate shell completion script";

/** The integration commands the full list and the options page name. */
const integrations = (): readonly HelpCommandRow[] => [
  { name: "completions", description: COMPLETIONS_DESCRIPTION },
  {
    name: "mcp",
    description: `${MCP_GROUP_DESCRIPTION} (${[...MCP_SUBCOMMANDS.keys()].join(", ")})`,
  },
];

/** The global options block of a page for a command that renders results. */
export const commandGlobalOptions = {
  formats: CLI_OUTPUT_FORMATS,
  custom: CLI_CUSTOM_GLOBAL_OPTIONS,
};

/** Every command in one alphabetical list: `rea help all`. */
export const fullCommandList = (cli: CliInstance): string =>
  formatCommandListHelp(cli.name, {
    version: PRODUCT_IDENTITY.packageVersion,
    description: CLI_DESCRIPTION,
    commands: cliCommands(cli)
      .map(({ name, definition }): HelpCommandRow => ({
        name,
        description: definition.description,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    globalOptions: {
      ...commandGlobalOptions,
      root: { integrations: integrations() },
    },
  });

/** The root page: an index of families and the commands most work starts with. */
export const rootPage = (cli: CliInstance): string =>
  formatRootIndex(cli, {
    version: PRODUCT_IDENTITY.packageVersion,
    description: CLI_DESCRIPTION,
  });

/** `rea help options`: the global options and integrations every command shares. */
export const globalOptionsPage = (cli: CliInstance): string =>
  formatCommandListHelp(`${cli.name} help options`, {
    description: "Options every command accepts",
    usage: `${cli.name} <command> [options]`,
    commands: [],
    globalOptions: {
      ...commandGlobalOptions,
      root: { integrations: integrations() },
    },
  });

/** The one line a command's page prints instead of the global options. */
const globalOptionsReference = (name: string): string =>
  `Global options (--json, --format, --filter-output, --token-limit, --timings, ...): ${name} help options`;

/** A command's own page. */
export const commandPage = (
  cli: CliInstance,
  entry: CliCommandEntry,
): string => {
  const { definition } = entry;
  return formatCommandHelp(`${cli.name} ${entry.name}`, {
    description: definition.description,
    args: definition.args,
    options: definition.options,
    alias: definition.alias,
    globalOptions: {
      ...commandGlobalOptions,
      reference: globalOptionsReference(cli.name),
    },
  });
};

/**
 * `rea help [topic]`: the index, a family, `all`, `options` or a command's
 * page. An unknown topic names the families and the closest name.
 */
export const helpTopicPage = (
  cli: CliInstance,
  topic: string | undefined,
): { readonly text: string; readonly exitCode: number } => {
  if (topic === undefined) return { text: rootPage(cli), exitCode: 0 };
  if (topic === "all") return { text: fullCommandList(cli), exitCode: 0 };
  if (topic === "options") return { text: globalOptionsPage(cli), exitCode: 0 };
  const family = formatFamilyPage(cli, topic);
  if (family !== undefined) return { text: family, exitCode: 0 };
  const entry = cliCommands(cli).find(({ name }) => name === topic);
  if (entry !== undefined)
    return { text: commandPage(cli, entry), exitCode: 0 };
  const families = helpFamilyNames(cli);
  const suggestion = suggestCommand(topic, [
    ...families,
    ...Object.keys(HELP_TOPICS),
    ...cliCommands(cli).map(({ name }) => name),
  ]);
  return {
    text: `Error (UNKNOWN_HELP_TOPIC): '${topic}' is not a family, topic or command.${suggestion === undefined ? "" : ` Did you mean '${suggestion}'?`} Families: ${families.join(", ")}. Topics: ${Object.keys(HELP_TOPICS).join(", ")}.`,
    exitCode: 1,
  };
};
