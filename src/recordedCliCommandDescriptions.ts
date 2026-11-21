/**
 * The one-line description of each top-level CLI command, recorded from the
 * compiled registration table by `scripts/record-cli-commands.mjs` after
 * compilation. Source runs leave this undefined; the CLI then reads the
 * descriptions of the commands it registered.
 */
export const RECORDED_CLI_COMMAND_DESCRIPTIONS:
  | Readonly<Record<string, string>>
  | undefined = undefined;
