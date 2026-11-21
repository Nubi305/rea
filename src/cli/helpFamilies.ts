/**
 * The families `rea --help` lists and `rea help <family>` opens. A family is
 * a group of commands an agent chooses between for one kind of target or
 * task. Commands join the family of the registrar that defines them, so a new
 * command needs no entry here; a new registrar must name its family in the
 * table below (the help index test fails until it does).
 *
 * The index prints one line per family, in this order. Adding a family is
 * one entry here and one line in the index.
 */
export const HELP_FAMILIES = [
  {
    id: "start",
    summary: "Set up, check and update REA; guides; providers",
  },
  {
    id: "artifact",
    summary: "Identify, unpack and inspect files and packages of any format",
  },
  {
    id: "native",
    summary: "Decompile, search, cross-reference and trace native code",
  },
  {
    id: "binary",
    summary: "ELF, PE, Mach-O facts: imports, hardening, debug info, crashes",
  },
  {
    id: "debug",
    summary: "gdb, rizin, objdump, Cutter, Frida; observe native calls and UI",
  },
  {
    id: "managed",
    summary: ".NET (PE/CLI) assemblies and their native boundaries",
  },
  {
    id: "android",
    summary: "Android and Flutter apps: APK, DEX, resources, JEB",
  },
  { id: "adb", summary: "A connected Android device through adb" },
  { id: "firmware", summary: "Firmware images, UEFI volumes and NVRAM" },
  {
    id: "web",
    summary: "Live pages and bundles: capture, network, scripts, sources",
  },
  {
    id: "javascript",
    summary: "JavaScript and Electron apps: analysis, recovery, runtime",
  },
  {
    id: "captures",
    summary: "Packet captures and signal recordings",
  },
  {
    id: "desktop",
    summary: "Desktop applications and processes: capture, state, export",
  },
  {
    id: "application",
    summary: "Whole applications: versions, API contracts, feature traces",
  },
  {
    id: "evidence",
    summary: "Saved Evidence: views, bundles, export, import, compare",
  },
  {
    id: "environment",
    summary: "Agent environments: build, serve, compare, export",
  },
  {
    id: "clone-run",
    summary: "Rebuild a web application under a referee (this fork only)",
  },
] as const satisfies readonly {
  readonly id: string;
  readonly summary: string;
}[];

export type HelpFamilyId = (typeof HELP_FAMILIES)[number]["id"];

/**
 * The family of each registrar's commands, keyed by registrar id. The keys are
 * plain strings on purpose: importing the registrar id type from the command
 * registrations would pull every command module into the type program of the
 * checked scripts (tsconfig.scripts.json), which reach this file through the
 * CLI shell. The help index test keeps the table complete: a command whose
 * registrar is missing here lands in no family and fails it.
 */
const REGISTRAR_FAMILIES: Readonly<Record<string, HelpFamilyId>> = {
  setup: "start",
  guidance: "start",
  guidedWorkflow: "start",
  coreAnalysis: "native",
  nativeFunctionMatching: "native",
  binaryDiagnostics: "binary",
  utility: "binary",
  reverseEngineering: "debug",
  cutter: "debug",
  frida: "debug",
  artifact: "artifact",
  wasm: "artifact",
  evm: "artifact",
  desktopApplication: "artifact",
  releaseExposure: "artifact",
  go: "artifact",
  il2cpp: "artifact",
  model: "artifact",
  gpu: "artifact",
  rust: "artifact",
  pythonPyc: "artifact",
  nugetNupkg: "artifact",
  erlang: "artifact",
  v8CodeCache: "artifact",
  mavenGradleMetadata: "artifact",
  sqlite: "artifact",
  managed: "managed",
  android: "android",
  apktool: "android",
  jeb: "android",
  apkSignature: "android",
  flutter: "android",
  adb: "adb",
  firmware: "firmware",
  uefi: "firmware",
  browser: "web",
  webRuntime: "web",
  webNetworkCapture: "web",
  advancedBrowser: "web",
  browserScenario: "web",
  webScript: "web",
  webModule: "web",
  webSourceLocation: "web",
  electron: "javascript",
  javaScriptRuntimeObservation: "javascript",
  javaScriptRecovery: "javascript",
  capture: "captures",
  pcap: "captures",
  signal: "captures",
  desktopCapture: "desktop",
  process: "desktop",
  application: "application",
  analysisView: "evidence",
  evidence: "evidence",
  environment: "environment",
  cloneRun: "clone-run",
};

/**
 * Commands whose registrar serves several families: the utility registrar
 * holds provider status beside native format readers and observers.
 */
const COMMAND_FAMILIES: Readonly<Record<string, HelpFamilyId>> = {
  capabilities: "start",
  providers: "start",
  "observe-native-calls": "debug",
  "observe-native-ui": "debug",
  "capture-native-ui-scenario": "debug",
};

/** The family of a command, or undefined when its registrar is unknown. */
export const helpFamilyOf = (
  name: string,
  registrar: string | undefined,
): HelpFamilyId | undefined =>
  COMMAND_FAMILIES[name] ??
  (registrar !== undefined && Object.hasOwn(REGISTRAR_FAMILIES, registrar)
    ? REGISTRAR_FAMILIES[registrar]
    : undefined);

/**
 * The commands most first calls start from, with the line the index prints.
 * A test keeps every name a registered command.
 */
export const HELP_START_COMMANDS: readonly {
  readonly usage: string;
  readonly summary: string;
}[] = [
  {
    usage: "inspect-artifact <path>",
    summary: "Identify any file; prints the next probes",
  },
  { usage: "analyze <path>", summary: "Overview of a native app" },
  {
    usage: "analyze-javascript-application <path>",
    summary: "A JavaScript or Electron app on disk",
  },
  {
    usage: "list-browser-targets <endpoint>",
    summary: "Pages of a running browser (CDP)",
  },
  { usage: "guidance --query <words>", summary: "Search REA's guides" },
  { usage: "doctor", summary: "Check providers and agent setup" },
];
