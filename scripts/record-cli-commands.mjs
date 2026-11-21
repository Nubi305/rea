import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Record which registrar defines each top-level CLI command. Run after `tsc`
// and before bundling, so the record comes from the same compiled registration
// table that one-shot commands load from.
const compiled = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const read = (name) => import(pathToFileURL(join(compiled, name)).href);
const [
  { CLI_COMMAND_REGISTRATIONS, CLI_REGISTRATION_ORDER },
  { createCliShell },
  { createDirectAnalysis },
  { cliCommands },
  { listedDescription },
] = await Promise.all([
  read("cli/cliCommandRegistrations.js"),
  read("cli/cliShell.js"),
  read("composition/directAnalysis.js"),
  read("cli/commandRegistry.js"),
  read("cli/helpIndex.js"),
]);

// Registration is independent of the host account and user configuration.
const home = await mkdtemp(join(tmpdir(), "rea-cli-commands-"));
const recorded = {};
// The one-line description of each command, which `rea guidance --query`
// searches when no guide section matches, without loading every registrar.
const described = {};
try {
  const registrations = await Promise.all(
    CLI_REGISTRATION_ORDER.map(async (id) => {
      const registration = CLI_COMMAND_REGISTRATIONS[id];
      return {
        module: await registration.load(),
        registration: {
          ...registration,
          register(module, context) {
            const before = new Set(
              cliCommands(context.cli).map(({ name }) => name),
            );
            registration.register(module, context);
            for (const { name, definition } of cliCommands(context.cli))
              if (!before.has(name)) {
                recorded[name] = id;
                described[name] = listedDescription(definition.description);
              }
          },
        },
      };
    }),
  );
  createCliShell({
    selectedEnvironment: {
      PATH: process.env.PATH,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_CACHE_HOME: join(home, "cache"),
      XDG_STATE_HOME: join(home, "state"),
    },
    registrations,
    createAnalysis: createDirectAnalysis,
  });
} finally {
  await rm(home, { recursive: true, force: true });
}
if (Object.keys(recorded).length === 0)
  throw new Error("No CLI commands were registered");
const sorted = Object.fromEntries(
  Object.entries(recorded).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
);
await writeFile(
  join(compiled, "recordedCliCommandDescriptions.js"),
  `/** Recorded from the compiled CLI registration table by scripts/record-cli-commands.mjs; do not edit. */\nexport const RECORDED_CLI_COMMAND_DESCRIPTIONS = Object.freeze(${JSON.stringify(
    Object.fromEntries(
      Object.keys(sorted).map((name) => [name, described[name]]),
    ),
  )});\n`,
  "utf8",
);
await writeFile(
  join(compiled, "recordedCliCommandRegistrations.js"),
  `/** Recorded from the compiled CLI registration table by scripts/record-cli-commands.mjs; do not edit. */\nexport const RECORDED_CLI_COMMAND_REGISTRATIONS = Object.freeze(${JSON.stringify(sorted)});\n`,
  "utf8",
);
