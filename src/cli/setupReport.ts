import { readFileSync } from "node:fs";
import { join } from "node:path";

import { skillDestinationSelection } from "../application/SetupSkill.js";
import type { SetupResult } from "../application/SetupTypes.js";

/**
 * What `rea setup --client <x>` prints: the state of the clients asked for,
 * not of every supported client, then one line naming the skill file. The
 * complete report stays behind `--full-report`.
 */

/** The flag that keeps every client's state in setup's report. */
export const SETUP_FULL_REPORT_FLAG = "--full-report";

/** Setup's report scoped to the selected clients. */
export type ScopedSetupReport = Omit<SetupResult, "doctor"> & {
  readonly doctor: SetupResult["doctor"] & {
    /** Unconfigured providers outside the setup's scope, named on one line. */
    readonly other_providers?: string;
  };
  /** Supported clients whose state was left out, and how to see them. */
  readonly other_clients?: string;
  /** Claude Code would list the skill twice. */
  readonly duplicate_skill?: string;
  /** The skill file this setup installs or found, always the last line. */
  readonly skill: string;
};

/** The REA plugin keys Claude Code enables, read from its own files. */
const enabledReaPlugins = (home: string): readonly string[] => {
  const found = new Set<string>();
  const read = (path: string): unknown => {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      return undefined;
    }
  };
  const settings = read(join(home, ".claude", "settings.json"));
  if (typeof settings === "object" && settings !== null) {
    const enabled = (settings as Record<string, unknown>).enabledPlugins;
    if (typeof enabled === "object" && enabled !== null)
      for (const [key, value] of Object.entries(enabled))
        if (key.split("@")[0] === "rea" && value === true) found.add(key);
  }
  return [...found];
};

const skillState = (result: SetupResult): string => {
  if (result.appliedActions.includes("installed_skill")) return "installed";
  if (result.plannedActions.some(({ kind }) => kind === "install_skill"))
    return result.status === "planned"
      ? "would be installed"
      : "not installed yet";
  return result.doctor.scope.skill
    ? (result.doctor.identity?.skill.state ?? "unknown")
    : "not selected (--skill=false)";
};

/**
 * Scope a non-interactive setup result to the clients the caller named.
 * Without named clients the result is returned unchanged.
 */
export const scopeSetupReport = (
  result: SetupResult,
  selection: {
    readonly clients: readonly string[];
    readonly skillClients: readonly string[];
    readonly home: string;
    readonly environment: Readonly<NodeJS.ProcessEnv>;
    readonly platform: NodeJS.Platform;
  },
): ScopedSetupReport | SetupResult => {
  const named = [...new Set([...selection.clients, ...selection.skillClients])];
  if (named.length === 0) return result;
  const clientStates = result.clientStates.filter(({ client }) =>
    named.includes(client.name),
  );
  const omitted = result.clientStates.length - clientStates.length;
  const skillClients =
    selection.skillClients.length > 0 ? selection.skillClients : named;
  const files = skillDestinationSelection(
    selection.home,
    skillClients,
    selection.environment,
    selection.platform,
  ).destinations.map(({ path }) => join(path, "SKILL.md"));
  const plugins =
    skillClients.includes("claude_code") && result.doctor.scope.skill
      ? enabledReaPlugins(selection.home)
      : [];
  const { remediation, code, download, cleanup, ...rest } = result;
  // Providers nobody asked about: one line naming them and where to look.
  const inScope = new Set(result.doctor.scope.providers);
  const inspections = result.doctor.providerInspections ?? [];
  const shown = inspections.filter(
    ({ id, configured }) => configured || inScope.has(id),
  );
  const unconfigured = inspections
    .filter((inspection) => !shown.includes(inspection))
    .map(({ id }) => id);
  return {
    ...rest,
    doctor: {
      ...result.doctor,
      ...(result.doctor.providerInspections === undefined
        ? {}
        : { providerInspections: shown }),
      ...(unconfigured.length === 0
        ? {}
        : {
            other_providers: `${unconfigured.join(", ")} not configured; rea doctor --json shows how to configure each.`,
          }),
    },
    clientStates,
    ...(remediation === undefined ? {} : { remediation }),
    ...(code === undefined ? {} : { code }),
    ...(download === undefined ? {} : { download }),
    ...(cleanup === undefined ? {} : { cleanup }),
    ...(omitted === 0
      ? {}
      : {
          other_clients: `${omitted} other supported clients are not shown; add ${SETUP_FULL_REPORT_FLAG} to list them.`,
        }),
    ...(plugins.length === 0
      ? {}
      : {
          duplicate_skill: `Claude Code also has the REA plugin enabled (${plugins.join(", ")} in ~/.claude/settings.json), which brings its own copy of the skill; with this personal copy the skill is listed twice. Keep one: rerun setup with --skill=false, or disable the plugin.`,
        }),
    skill: `Skill file: ${files.length === 0 ? "none for the selected clients" : files.join(", ")} (${skillState(result)})`,
  };
};
