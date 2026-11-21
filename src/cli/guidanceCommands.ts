import { z } from "zod";
import { ArtifactResourceScope } from "../resources/index.js";
import {
  readGuidanceSection,
  searchGuidance,
} from "../application/GuidanceAccess.js";
import {
  GUIDANCE_CONTENTS_LOCATOR,
  readGuidanceSectionInputSchema,
  searchGuidanceLimitSchema,
  searchGuidanceInputSchema,
} from "../contracts/guidanceContracts.js";
import { CLI_COMMANDS } from "../contracts/cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { Logger } from "pino";
import { cliCommands, registerCliCommand } from "./commandRegistry.js";
import { listedDescription } from "./helpIndex.js";
import { RECORDED_CLI_COMMAND_DESCRIPTIONS } from "../recordedCliCommandDescriptions.js";
import type { CliInstance } from "./types.js";
import { cliDecimalField } from "./options.js";
import { ownCliProcessResource } from "./cliResources.js";

let retainedResources: ArtifactResourceScope | undefined;

/**
 * Every command with its one-line description. A one-shot `guidance` run
 * registers only its own family, so the build's recording supplies the rest.
 */
const searchableCommands = (
  cli: CliInstance,
): readonly { readonly name: string; readonly description: string }[] =>
  RECORDED_CLI_COMMAND_DESCRIPTIONS === undefined
    ? cliCommands(cli).map(({ name, definition }) => ({
        name,
        description: listedDescription(definition.description),
      }))
    : Object.entries(RECORDED_CLI_COMMAND_DESCRIPTIONS).map(
        ([name, description]) => ({ name, description }),
      );

/** Release CLI-owned guidance descriptors, retaining failed cleanup for retry. */
ownCliProcessResource("guidance", async () => {
  const resources = retainedResources;
  if (resources === undefined) return;
  await resources.close();
  if (retainedResources === resources) retainedResources = undefined;
});

/** Register offline search and retrieval for the installed REA guide bundle. */
export const registerGuidanceCommands = (
  cli: CliInstance,
  logger: Logger,
): void => {
  registerCliCommand(
    cli,
    CLI_COMMANDS.guidance,
    {
      description: "Search or read the installed REA workflow guidance",
      args: z.object({}),
      options: z
        .object({
          action: z
            .enum(["search", "read", "contents"])
            .default("search")
            .describe(
              "Guidance action to perform: search, read, or contents (the guides and their headings with locators)",
            ),
          query: searchGuidanceInputSchema.shape.query
            .optional()
            .describe(
              "Required with search; sections covering more of its words rank first",
            ),
          locator: readGuidanceSectionInputSchema.shape.locator
            .optional()
            .describe(
              "Required with --action read; locator returned by search or contents",
            ),
          guide: z
            .string()
            .min(1)
            .optional()
            .describe(
              "With --action contents: list every heading of this guide, such as references/clone-runs.md",
            ),
          // Decimal tokens only: numeric coercion would read "0x2" as 2.
          limit: cliDecimalField(searchGuidanceLimitSchema.optional()).describe(
            "Maximum search matches; search only, defaults to 3",
          ),
          cursor: searchGuidanceInputSchema.shape.cursor
            .optional()
            .describe("Continue a search page; search only"),
        })
        .superRefine((options, context) => {
          if (options.action !== "contents" && options.guide !== undefined)
            context.addIssue({
              code: "custom",
              path: ["guide"],
              message: "--guide can only be used with --action contents",
            });
          if (options.action === "contents") {
            for (const option of [
              "query",
              "locator",
              "limit",
              "cursor",
            ] as const)
              if (options[option] !== undefined)
                context.addIssue({
                  code: "custom",
                  path: [option],
                  message: `--${option} can only be used with --action ${option === "locator" ? "read" : "search"}`,
                });
          } else if (options.action === "search") {
            if (options.query === undefined)
              context.addIssue({
                code: "custom",
                path: ["query"],
                message: "--query is required with --action search",
              });
            if (options.locator !== undefined)
              context.addIssue({
                code: "custom",
                path: ["locator"],
                message: "--locator can only be used with --action read",
              });
          } else {
            if (options.locator === undefined)
              context.addIssue({
                code: "custom",
                path: ["locator"],
                message: "--locator is required with --action read",
              });
            for (const option of ["query", "limit", "cursor"] as const)
              if (options[option] !== undefined)
                context.addIssue({
                  code: "custom",
                  path: [option],
                  message: `--${option} can only be used with --action search`,
                });
          }
        }),
      run: ({ options }) =>
        logCliCommand(logger, CLI_COMMANDS.guidance, async () => {
          const resources = (retainedResources ??= new ArtifactResourceScope());
          const result =
            options.action === "search"
              ? await searchGuidance(
                  {
                    ...(options.query === undefined
                      ? {}
                      : { query: options.query }),
                    ...(options.limit === undefined
                      ? {}
                      : { limit: options.limit }),
                    ...(options.cursor === undefined
                      ? {}
                      : { cursor: options.cursor }),
                  },
                  resources,
                  {
                    commands: searchableCommands(cli),
                    help: (name) => `${cli.name} ${name} --help`,
                  },
                )
              : await readGuidanceSection(
                  {
                    locator:
                      options.action === "contents"
                        ? options.guide === undefined
                          ? GUIDANCE_CONTENTS_LOCATOR
                          : `${GUIDANCE_CONTENTS_LOCATOR}:${options.guide}`
                        : options.locator,
                  },
                  resources,
                );
          return result.ok ? result.value : projectAnalysisError(result.error);
        }),
    },
    {
      operations: [
        {
          name: "search_guidance",
          flags: {
            query: "--query",
            limit: "--limit",
            cursor: "--cursor",
          },
        },
        {
          name: "read_guidance_section",
          flags: {
            locator: "--locator",
          },
        },
      ],
    },
  );
};
