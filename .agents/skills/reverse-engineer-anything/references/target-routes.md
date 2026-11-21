Target routes: the first tool for each kind of target, when the
first-step list in SKILL.md does not name one. Each route is its own section.

Choose the first tool from the target the user supplied. Use `open_binary` for
active-target native or archive workflows; target-free tools take their own
explicit path or endpoint and do not need it.

## Asked to rebuild or clone a web application the user can run and reset locally

- Asked to rebuild or clone a web application the user can run and reset
  locally: read [references/clone-runs.md](clone-runs.md) before
  touching the original, and take no other route here. A clone run starts
  with the user's authorization statement and `rea init-clone-run`, calls REA
  as CLI one-shots instead of a shared MCP connection, and ends only when
  `rea evaluate-clone-run` says so. An agent environment (AgentEnv bundle) is
  a served recording of an application, not a rebuild of it.

## Two versions of one target: `open_binary`

- Two versions of one target: for native builds, `open_binary` and
  `list_procedures` on each, then `match_native_functions`; for JavaScript,
  `analyze_javascript_application` on each, then
  `compare_application_versions`; for packages, `inspect_artifact` on each,
  then `compare_artifacts`. `guided_workflows` renders the
  `compare_application_versions` checklist.

## ASAR or extracted JavaScript/Electron tree: `analyze_javascript_application`

- ASAR or extracted JavaScript/Electron tree:
  `analyze_javascript_application`. To find a few files in a packaged
  `app.asar`, open it with `open_binary`, start with `inspect_artifact`
  using `detail: "summary"`, then analyze the selected files with
  `source_paths`. When you intend to retain digest contradictions from
  re-signed unpacked companions, pass `integrity_policy: "record-and-continue"`
  starting with `inspect_artifact`. A single JavaScript file is refused:
  use `recover_javascript_sources`, or put the file alone in a directory
  and analyze the directory. See the
  [JavaScript applications reference](javascript-applications.md).

## Archive/package member inventory (ZIP/APK/IPA/MSIX/AppX, DMG, or a PyInstaller executable): `open_binary`

- Archive/package member inventory (ZIP/APK/IPA/MSIX/AppX, DMG, or a PyInstaller
  executable): `open_binary` with the supplied local path; use `inspect_artifact`
  when its graph and findings help answer the question. A PyInstaller CArchive
  is the application layer; the bootloader is only the native prefix. Start with
  `detail: "summary"` for large inventories, then use retained inventory views
  for selected member fields/pages. A complete small inventory can cost less
  than extra calls and schemas. Runtime options are metadata, not files.
  Compact delivery still inventories and hashes members. See the
  [Python packaged applications guide](https://github.com/morluto/rea/blob/main/docs/python-packaged-applications.md).

## Bun `--compile` executable: `open_binary`

- Bun `--compile` executable: `open_binary`, then `inspect_artifact`; the Bun
  module graph is the application layer. Extract stored modules and analyze the
  JavaScript. See [Bun standalone executables](https://github.com/morluto/rea/blob/main/docs/bun-standalone.md).

## Deno `deno compile` executable: `open_binary`

- Deno `deno compile` executable: `open_binary`, then `inspect_artifact`; the
  embedded virtual filesystem is the application layer. Extract stored files and
  analyze compatible JavaScript. Environment-file values and CA certificate bytes
  are retained in local Evidence with their counts and byte lengths. The npm
  snapshot length is reported and not decoded, and the executable is not run. See
  [Deno compile executables](https://github.com/morluto/rea/blob/main/docs/deno-standalone.md).

## Apple app plist, Interface Builder, asset catalog, or keyed archive resources: `open_bundle_resources`

- Apple app plist, Interface Builder, asset catalog, or keyed archive resources:
  `open_bundle_resources`, then the selected resource tool. This does not
  require `CFBundleExecutable` or a deep provider. Resource sessions have no
  executable digest or binary snapshot; use `open_binary` for native code.

## Android APK code, classes, methods, or incoming references: `inspect_android_package`

- Android APK code, classes, methods, or incoming references:
  `inspect_android_package`, then focused Android tools when advertised.
  Archive member inventory still uses the archive route above.

## Managed PE/CLI assembly: `inspect_managed_artifact`

- Managed PE/CLI assembly: `inspect_managed_artifact`.

## UEFI firmware volumes and NVAR stores: `inspect_artifact`

- UEFI firmware volumes and NVAR stores: use bundled `inspect_artifact`.
  For external firmware scanning or extraction on Linux, use
  `inspect_firmware_regions` or `extract_firmware` with caller-supplied
  Binwalk or Unblob. Extraction needs a caller-selected new absolute output
  directory. See the [firmware guide](https://github.com/morluto/rea/blob/main/docs/guides/firmware/firmware-analysis.md).

## ESP32-family app or bootloader image (`0xE9` magic): `inspect_artifact`

- ESP32-family app or bootloader image (`0xE9` magic): `inspect_artifact`
  without a provider; see the ESP section of `references/native-and-artifacts.md`.

## .NET NativeAOT PE/ELF

- .NET NativeAOT PE/ELF: native Ghidra analysis. Native code can yield pseudocode;
  consult the NativeAOT workflow in `references/native-and-artifacts.md` for
  optional metadata recovery and its supported host/layout boundary.

## Native program behavior, live calls, instrumentation, or command-run effects: `open_binary`

- Native program behavior, live calls, instrumentation, or command-run effects:
  choose the matching [native runtime workflow](runtime-observation.md#native-runtime-questions).
  `open_binary` and `trace_native_values` establish static facts; they do not
  observe execution. Runtime tools have distinct launch, attach, mutation and
  cleanup effects, and do not require a preliminary static session unless their
  own contract says so.

## User-owned browser page already open: `list_browser_targets`

- User-owned browser page already open: `list_browser_targets`.

## Passive traffic capture of a SPA (`inspect_web_page` on a target from `list_browser_targets`): `inspect_web_page`

- Passive traffic capture of a SPA (`inspect_web_page` on a target from
  `list_browser_targets`): the default scope is the page's own origin,
  and data APIs usually live on another origin. Discover API origins from
  absolute URLs in loaded bundles or script text via JavaScript analysis tools
  (another passive capture without those origins still scopes to the page
  origin, and `completeness.excluded` counts lack URLs). Pass both the page
  origin and those API origins in `allowed_origins` — the list replaces the
  default scope — and read `completeness.excluded` before reporting that an
  API is absent. For long captures with body shapes, use
  `export_evidence_bundle` instead of expecting an inline result.

## Browser action the agent must perform (click, type, navigate): `capture_browser_scenario`

- Browser action the agent must perform (click, type, navigate):
  `capture_browser_scenario` with declared actions. See
  [runtime observation](runtime-observation.md) for connect/launch
  and the focused follow-up browser tools.

## Agent environment (AgentEnv bundle) of a web application: `capture_browser_scenario`

- Agent environment (AgentEnv bundle) of a web application: read
  [environments](environments.md) before recording; it records with
  `capture_browser_scenario` and writes the bundle with `export_environment_bundle`.

## Task for a desktop application's exported environment, from a `capture-desktop-application` folder

- Task for a desktop application's exported environment, from a
  `capture-desktop-application` folder: read
  [desktop application tasks](environments.md#tasks-for-a-desktop-application-environment).

## Environment of a Linux desktop app with a task, from a request such as "build me an Inkscape environment where the agent changes a poster's headline": `start_build_computer`

- Environment of a Linux desktop app with a task, from a request such as
  "build me an Inkscape environment where the agent changes a poster's
  headline": read [desktop builds](desktop-build.md). You drive the
  app on a build computer from `start_build_computer`, then export and witness.

## User-owned Electron runtime already open: `list_electron_targets`

- User-owned Electron runtime already open: `list_electron_targets`. Before an electron-main Inspector attempt, check packaged fuses with `inspect_electron_fuses`; disabled `EnableNodeCliInspectArguments` means the app ignores `--inspect`.

## Native executable, library, or analysis database: `open_binary`

- Native executable, library, or analysis database: `open_binary`, then
  use focused analysis tools directly; call `binary_overview` when metadata or
  inventory context is useful and available from the selected provider. If
  automatic selection returns `capability_unavailable` with
  `selection_reason: "ambiguous"`, several providers are usable for the
  selected target. Choose one of the reported candidates and retry with its
  `provider_id`. Without an active target, `binary_session({})` shows host
  availability and leaves target support unknown. On the CLI,
  `rea search`, `rea function` and `rea decompile` take the path instead.

## IDA provider

For an existing IDA MCP configuration, use `open_binary` with the original
input binary and `provider_id: "ida"`; do not pass an `.idb` or `.i64` database.
The native attached profile binds the already-open GUI input by SHA-256 and
leaves its database open. The modern headless profile creates and closes an
owned private database without saving; it reuses
[mrexodia/ida-pro-mcp](https://github.com/mrexodia/ida-pro-mcp). See the
[IDA provider guide](https://github.com/morluto/rea/blob/main/docs/providers/ida-provider.md).
A registration naming the removed ida-pro-mcp 1.4 `"legacy"` protocol is
refused; follow the guide's
[legacy attached migration](https://github.com/morluto/rea/blob/main/docs/providers/ida-provider.md#migrate-a-legacy-attached-registration)
instead of editing the protocol value. No IDA profile provides direct callers;
check session availability and the guide's verification limits.
Proceed directly to `analyze_function`, pseudocode, or function/string searches
after opening; IDA does not supply `binary_overview`. Consult session availability
when composing broader workflows. Modern direct callers and unsupported dossier
facets remain unknown; live IDA results are not replayed from snapshots.

## Kuna provider

With `REA_KUNA_COMMAND` configured, `provider_id: "kuna"` answers procedure
lists, lookups, pseudocode, assembly and `analyze_function` from Kuna's cached
whole-program export. Callers/callees use a separate body-free graph shared by
the session; `xrefs` returns exact-address incoming sites and filters forwarding
aliases. These queries and inventory lookups do not trigger a C export. Indirect
targets remain unknown and can make relationship coverage partial. Reference
caches expire on close; a fresh CLI process repeats the native reference walk.
Typed references, CFG, raw-memory tools and annotations remain unsupported. A cold first
answer can come from a single-function run (its limitations say so); assembly
waits for the export. For pseudocode and assembly, `raw_result.source` names the
cached `.c`/`.asm` file and byte span, which you may search directly instead of
calling per function. See the
[Kuna provider guide](https://github.com/morluto/rea/blob/main/docs/kuna-provider.md).

## When the user names no target

If the user says only "my app" without a name, path, or target already selected
for this task, ask which app before searching for artifacts. Paths in unrelated
saved reports and nearby test fixtures do not select the user's target. Resolve
an actual human-readable app name to one clear installed artifact when possible;
ask when matches are ambiguous. Never choose an example app on the user's behalf.

## Target-free sessions and tool availability

In a target-free session, use `open_binary` to bind any archive/package or
native target whose analysis tool operates on the active target. Do not call an
unadvertised tool; inspect `binary_session` with `{}` and its
`result.tool_availability` for availability reasons and remediation. Expand each
group's `names` into entries, inheriting the inventory-level client requirements
unless the group overrides them. The grouped name union is the complete tool
inventory; use `tools/list` for canonical tool schemas. The default summary keeps
each provider candidate's availability and target-support status, code and
reason; `omitted_fields` lists what it leaves out. Request `{"detail": "complete"}`
only when you need an unavailable candidate's remediation, provider
diagnostics, candidate capability sets, or tool surface, effect and annotation
flags; in those closed flag vocabularies, listed
flags are true and omitted known flags are false. Provider candidate facts
describe possible providers, while top-level session capabilities describe the
current route and `analysis_provider_binding` names the selected provider. Do
not treat those scopes as interchangeable.

## Editable Ghidra analysis across processes

For editable Ghidra analysis that must survive a later agent process, select
the [owned Program checkpoint workflow](native-and-artifacts.md#continue-editable-ghidra-analysis-across-processes)
before making metadata edits. It is separate from Evidence/Unknown persistence.

## Ghidra startup timeout

For a Ghidra startup timeout on a large native target, follow
[deadline recovery](native-and-artifacts.md#ghidra-startup-deadline-recovery)
before abandoning deep analysis or repeating the same cold import. The default
330 seconds can be changed for new startup attempts through
`update_analysis_settings` using `ghidra.startup_timeout_ms`. Changing the
server's launch environment instead requires a new REA process.

<!-- Generated by `npm run skill:routes` from upstream's SKILL.md (scripts/skill-routes/). Edit the fork corrections in scripts/lib/skill-routes.mjs, not this file. -->
