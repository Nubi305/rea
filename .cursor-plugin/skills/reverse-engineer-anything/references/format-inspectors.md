Contents:

- Fiddler Everywhere traffic or a native `.saz` capture: `inspect_web_network_capture`
- Retained HAR/SAZ/native mitmproxy/aioquic qlog capture: `inspect_web_network_capture`
- Shipped application exposure for a local `.app`, install directory, ASAR, or executable: `audit_release_exposure`
- Packet-field discovery: `inspect_packet_fields`
- Recorded packet captures: `inspect_packet_capture`
- Decoder discovery: `inspect_signal_decoders`
- Recorded logic/signal traces: `decode_signal_recording`
- Explicit local WebAssembly artifact: `inspect_wasm_artifact`
- Explicit local Android APK (or ZIP/AAB) signing: `inspect_apk_signature`
- Explicit local EVM bytecode carrier: `inspect_evm_interface`
- Embedded Go compiler, module, build-setting metadata, or static `(ptr, len)` string literals: `inspect_go_binary`
- Embedded CUDA/HIP code objects: `inspect_gpu_code_objects`
- Bundled GGUF or safetensors model declarations: `inspect_model_artifact`
- Unity IL2CPP names, member owners and string literals from `global-metadata.dat`: `inspect_il2cpp_metadata`
- Embedded cargo-auditable Rust dependency metadata: `inspect_rust_binary`
- Maven POM or Gradle module metadata: `inspect_maven_gradle_metadata`
- PE Authenticode certificate table: `inspect_pe_certificates`
- PE import and delay-load tables: `inspect_pe_imports`
- Windows Shell Link shortcuts: `inspect_windows_shortcut`
- PE TLS callbacks and load configuration: `inspect_pe_load_config`
- ELF, PE, and Mach-O hardening: `inspect_binary_hardening`
- ELF note tables: `inspect_elf_notes`
- DWARF compile units: `inspect_dwarf_units`
- Separate ELF debug files: `inspect_elf_debug_link`
- ELF load-time dynamic dependencies: `inspect_elf_dependencies`
- Code that runs before `main` or at exit in ELF or Mach-O: `inspect_native_initializers`
- ELF unwind function ranges: `inspect_elf_unwind_ranges`
- Apple `.ips` crash reports: `inspect_apple_ips`
- Linux kernel module metadata: `inspect_kernel_module`
- Linux kernel version and build config (`CONFIG_*` options such as `CONFIG_SECURITY_SELINUX`): `inspect_kernel_build_config`
- CPython 3.7–3.15 `.pyc` header, nested marshal code objects and bytecode identity: `inspect_python_pyc`
- Erlang BEAM IFF container: `inspect_erlang_beam`
- NuGet `.nupkg` package identity, dependency groups and ZIP inventory: `inspect_nuget_nupkg`
- Explicit local SQLite database snapshot: `inspect_sqlite_database`
- Explicit Linux ELF file for offline layout, symbols, relocations or static mitigation evidence: `inspect_binary_layout`
- Supplied Linux ELF64 amd64 or AArch64 core: `inspect_recorded_crash`
- PE resource type/name/language trees and static icon group references: `inspect_pe_resources`
- PE export directories and ELF dynamic-symbol exports: `inspect_native_exports`
- OpenAPI or GraphQL API contract file: `inspect_api_contract`
- Native code or data with no analysis provider ready: `inspect_with_objdump`

Format inspectors: each takes an explicit local path, needs no
`open_binary` or analysis provider unless its route says so, and never runs
the file. Each inspector is its own section.

## Fiddler Everywhere traffic or a native `.saz` capture: `inspect_web_network_capture`

- Fiddler Everywhere traffic or a native `.saz` capture: read the
  [Fiddler workflow](runtime-observation.md#fiddler-everywhere-traffic-debugging).
  Inspect saved SAZ with `inspect_web_network_capture` and `format: "saz"`;
  connect Everywhere's separate MCP server for live traffic.

## Retained HAR/SAZ/native mitmproxy/aioquic qlog capture: `inspect_web_network_capture`

- Retained HAR/SAZ/native mitmproxy/aioquic qlog capture: `inspect_web_network_capture`. Select
  original record ordinals when useful; inspect producer fields and byte/number
  sidecars without fetching recorded URLs or claiming live attribution. HAR/SAZ/qlog
  old-generation heap is `REA_CAPTURE_DECODER_OLD_GENERATION_MIB` (default 192 MiB,
  floor 8, maximum 16384), set where REA starts. Host memory and `NODE_OPTIONS` do not
  raise it. See
  historical captures (REA repository: `docs/guides/web/web-network-captures.md`) for the exact upstream
  profile and credential exclusions. Qlog support starts with aioquic 1.5.0
  JSON 0.3; stream coverage and endpoint loss declarations do not recover bodies
  or establish network loss. Prefer detail summary, then kind qlog trace/stream
  pages; select one trace, stream ID and direction for contribution/range pages.
  Facts retain all-recorded-events-before-selection scope. Other qlog layouts
  and PCAP correlation are unsupported.

## Shipped application exposure for a local `.app`, install directory, ASAR, or executable: `audit_release_exposure`

- Shipped application exposure for a local `.app`, install directory, ASAR, or executable: `audit_release_exposure` / `rea audit-release-exposure`. Each check has a stable id, a status, and fixed remediation. Unknown and unassessed checks stay in the report. This does not establish that an application is secure. Credential-marker hits report the rule id and location only. See release exposure (REA repository: `docs/release-exposure.md`).

## Packet-field discovery: `inspect_packet_fields`

- Packet-field discovery: `inspect_packet_fields` searches installed protocols
  and field names/types before choosing fields for `inspect_packet_capture`.
  Query/page the relevant records; registrations do not establish observed traffic.

## Recorded packet captures: `inspect_packet_capture`

- Recorded packet captures: `inspect_packet_capture` with selected TShark fields,
  display filters and decode-as rules. Requires Linux, util-linux prlimit and
  TShark 4.x on an absolute `PATH` entry or via the optional absolute
  `REA_TSHARK_COMMAND` override; see
  capture guide (REA repository: `docs/guides/data/packet-captures.md`).
  Packet limits count input packets before filtering. Output defaults to 50 matching
  frames; use `match_offset` / `match_limit` for later pages, or explicit null
  limit for complete matching output. Preserve the source digest across pages.
  This does not perform live capture.
  For address/DNS/SNI/protocol summaries use `inspect_pcap_capture` with MCP
  detail summary, then retained kind pcap pages. Requires Wireshark 4.x tshark
  and capinfos, with Linux prlimit or Windows Job Objects; see
  packet summaries (REA repository: `docs/guides/data/pcap-analysis.md`).
  Select an exact DNS question for address pages; page exhaustion does not prove
  network completeness. This reads recordings and does not acquire traffic.

## Decoder discovery: `inspect_signal_decoders`

- Decoder discovery: `inspect_signal_decoders` searches installed decoder IDs
  or selected decoder help, including channels and options. Query and page the
  relevant details before choosing settings; this does not scan hardware.

## Recorded logic/signal traces: `decode_signal_recording`

- Recorded logic/signal traces: `decode_signal_recording` with explicit decoder,
  channel and protocol settings. On Linux with util-linux prlimit, supply sigrok-cli 0.7.2 through
  `REA_SIGROK_COMMAND`; see recording guide (REA repository: `docs/guides/signals/signal-recordings.md`).
  Output defaults to 50 literal lines; select annotation classes and page with
  `line_offset` / `line_limit`, or explicit null for all remaining output.
  Window counts are display lines, not annotations or samples. Preserve source digests across pages.
  This reads existing files; it does not acquire hardware signals.

## Explicit local WebAssembly artifact: `inspect_wasm_artifact`

- Explicit local WebAssembly artifact: `inspect_wasm_artifact`. Supply WABT 1.0.42
  through `REA_WABT_BIN_DIRECTORY`; retain exact byte/tool identity and decoded WAT.
  Select JavaScript glue and candidate paths explicitly and preserve URL/path
  ambiguity. No implicit fetch or target execution; WAT is not original source.
  See the WASM guide (REA repository: `docs/guides/wasm/wasm-artifacts.md`).

## Explicit local Android APK (or ZIP/AAB) signing: `inspect_apk_signature`

- Explicit local Android APK (or ZIP/AAB) signing: `inspect_apk_signature`.
  Prefer its summary or selected signer/digest/lineage page; retain complete
  Evidence and use `inspect_analysis_view` kind `apk-signature` for follow-ups.
  Reports which schemes are present (v1 JAR, v2, v3, v3.1), each signer's
  certificate SHA-256 fingerprint (v1 included, from its PKCS#7 block), v3 key-rotation lineage, source stamp, and
  whether each signed digest still matches the bytes (self-consistency). This
  is identity and integrity, not a trust or authenticity verdict.
  See the APK signature guide (REA repository: `docs/apk-signature.md`).

## Explicit local EVM bytecode carrier: `inspect_evm_interface`

- Explicit local EVM bytecode carrier: `inspect_evm_interface` with caller-selected
  `raw` or `hex` encoding. The owned worker deadline is `timeout_ms` (default
  30000 ms, range 1..2147483647, next call). Select byte, address-space and CPU
  allowances separately through `producer_limits`; tighter inherited OS limits
  remain enforced, and the 256 MiB worker heap is independent. Preserve
  carrier/decoded digests and treat selectors,
  argument strings and mutability as inferred candidates; this performs no chain
  lookup or target execution. For the complete inferred interface without hex or
  duplicate stdout, discover support and select `detail: "summary"`; complete
  Evidence stays retained under its original identity. Use the returned
  `parent_evidence_id` for exact function or `bytecode_hex`/stdout/stderr pages.
  Candidate coverage does not establish interface completeness. See the
  EVM bytecode guide (REA repository: `docs/guides/evm/evm-bytecode.md`).

## Embedded Go compiler, module, build-setting metadata, or static `(ptr, len)` string literals: `inspect_go_binary`

- Embedded Go compiler, module, build-setting metadata, or static `(ptr, len)`
  string literals: `inspect_go_binary` with the explicit local file (pass
  `include_string_literals: true` and optional `max_string_literals` for bounded
  inferred static string-header recovery, and page retained rows with
  `inspect_analysis_view` kind `go` collection `string_literals`). This built-in
  target-free inspection requires no Go installation or disassembler. Preserve
  raw module bytes and source ranges; absent metadata does not prove a binary is
  not Go, static string recovery excludes compiler-inlined stack or immediate
  strings, and unparsed text records remain explicit. See the
  Go binary guide (REA repository: `docs/guides/native/go-binaries.md`).

## Embedded CUDA/HIP code objects: `inspect_gpu_code_objects`

- Embedded CUDA/HIP code objects: `inspect_gpu_code_objects`; inventory targets
  first, then decode selected payloads and query retained GPU Evidence.

## Bundled GGUF or safetensors model declarations: `inspect_model_artifact`

- Bundled GGUF or safetensors model declarations: `inspect_model_artifact`
  with the explicit local file. Default header hashing leaves full-file identity
  unknown; `hash: "full"` additionally reads all weights for SHA-256. MCP returns
  retained summaries; optional `view` selects one page in the initial call. Use
  `inspect_analysis_view` kind `model-artifact` for
  batched metadata keys, tensor names or type totals, selected fields and pages.
  Preserve header-scoped indices and array preview omissions; do not infer model
  behavior from declared architecture or tensor types. See the
  model file guide (REA repository: `docs/model-artifacts.md`).

## Unity IL2CPP names, member owners and string literals from `global-metadata.dat`: `inspect_il2cpp_metadata`

- Unity IL2CPP names, member owners and string literals from `global-metadata.dat`:
  `inspect_il2cpp_metadata` with the explicit local file; MCP defaults to compact
  counts. Query sections, images, types, methods, fields, properties, events,
  parameters or string_literals through `inspect_analysis_view`
  with the returned `parent_evidence_id`, using exact filters, batch indices and
  selected fields. Parameters accept `method_indices`, avoiding a scan of all
  parameter pages. Missing collections in historical Evidence remain unknown.
  Versions 24, 27, 29, 31 and 39; no Unity, IL2CPP
  binary or disassembler is run. Unrecognized magic (possibly encrypted) and
  other versions are unsupported. Optional matching `binary_path` enables static native addresses and type references; query `method_addresses` with indices or addresses/states, preserving every shared-body method and both artifact identities. Without a linked binary native counts remain unknown. Byte-pattern fallback is inferred; no runtime behavior or same-build pairing is proved. See the
  IL2CPP metadata guide (REA repository: `docs/il2cpp-metadata.md`).

## Embedded cargo-auditable Rust dependency metadata: `inspect_rust_binary`

- Embedded cargo-auditable Rust dependency metadata: `inspect_rust_binary`
  with the explicit local ELF, PE, thin Mach-O, or WebAssembly core-module
  file. This built-in target-free inspection requires no Rust installation or
  disassembler. Preserve package order, dependency indices, and the section file
  range. A missing `.dep-v0` section is null metadata, not proof the binary has
  no dependencies. A rustc commit hash is an inference from a
  `/rustc/<40-hex>/` path in read-only data or a WebAssembly data section.
  For selected crates, use `view: {collection: "packages", names: [...],
  fields: ["name", "version", "source"]}` on the first call; explicitly include
  `dependencies` for direct index references. Use `detail: "summary"` for counts
  and ranges, or retained `inspect_analysis_view` Rust package/edge pages for
  subsequent filters. Keep the complete parent Evidence accessible; CLI compact
  delivery requires `--evidence_output`.
  See the
  Rust binary guide (REA repository: `docs/rust-binaries.md`).

## Maven POM or Gradle module metadata: `inspect_maven_gradle_metadata`

- Maven POM or Gradle module metadata: `inspect_maven_gradle_metadata` with
  the explicit local `pom.xml` or `.module` file. This built-in target-free
  inspection requires no Maven or Gradle. Preserve coordinates as spelled,
  dependency and dependencyManagement rows, BOM imports, Gradle variants and
  rich versions, and unresolved property or parent references. Interpolation,
  inheritance, tree resolution, and repository access are not performed. See
  the
  Maven POM and Gradle module metadata guide (REA repository: `docs/maven-gradle-metadata.md`).

## PE Authenticode certificate table: `inspect_pe_certificates`

- PE Authenticode certificate table: `inspect_pe_certificates` with the explicit
  local PE32/PE32+ file. This built-in target-free inspection requires no
  Windows SDK. Preserve WIN_CERTIFICATE ranges, types, payload SHA-256, and
  PKCS#7 signer/X.509 identity fields, including `subject_key_identifier_hex`
  when the signer uses that form. A missing security directory is observed
  absence of that table, not proof the image is unsigned in every catalog sense.
  Signatures are not verified. See the
  PE certificate guide (REA repository: `docs/pe-certificates.md`).

## PE import and delay-load tables: `inspect_pe_imports`

- PE import and delay-load tables: `inspect_pe_imports` with the explicit
  local PE32/PE32+ file. This built-in target-free inspection requires no
  Windows SDK. Preserve DLL names, named and ordinal functions, ILT/IAT RVAs,
  delay-load descriptors, and the pefile import hash of the standard import
  table. A missing import directory is observed absence of that table, not
  proof the image never imported APIs through another table. Bound snapshots
  and loaded IAT contents remain unobserved. See the
  PE import guide (REA repository: `docs/pe-imports.md`).

## Windows Shell Link shortcuts: `inspect_windows_shortcut`

- Windows Shell Link shortcuts: `inspect_windows_shortcut` with the explicit
  local `.lnk` file. This built-in target-free inspection requires no Windows
  SDK or COM. Preserve header flags and FILETIMEs, IDList items, LinkInfo
  volume and network names, StringData arguments and icon location, ExtraData
  signatures, and Tracker droid facts labelled derived. Unknown IDList items
  and ExtraData signatures stay raw with SHA-256. The target path is not
  resolved or executed. See the
  Windows shortcut guide (REA repository: `docs/guides/native/windows-shortcut.md`).

## PE TLS callbacks and load configuration: `inspect_pe_load_config`

- PE TLS callbacks and load configuration: `inspect_pe_load_config` with the
  explicit local PE32/PE32+ file. This built-in target-free inspection requires
  no Windows SDK. Preserve callback VAs as strings with their RVA, file offset
  and section, and the size-covered security cookie, SafeSEH, CFG,
  EH-continuation and XFG fields. Guard-flag mitigation claims are inferred
  linker declarations, not proof of enforcement. A missing directory is observed
  absence of that declaration. See the
  PE load configuration guide (REA repository: `docs/pe-load-config.md`).

## ELF, PE, and Mach-O hardening: `inspect_binary_hardening`

- ELF, PE, and Mach-O hardening: `inspect_binary_hardening` with the explicit
  local file. This built-in target-free inspection requires no pwntools or other
  host tool. One image per Mach-O slice. Each property is `enabled`, `disabled`,
  `partial`, `unknown`, or `not_applicable`, with the header field or import
  behind it. A missing stack-protector or fortify import is `unknown`, not
  proof the protection was omitted. Authenticode and Mach-O code signatures
  report presence, not validity. Hardened runtime stays unknown and names
  `inspect_signature`. The image is not executed. See the
  binary hardening guide (REA repository: `docs/binary-hardening.md`).

## ELF note tables: `inspect_elf_notes`

- ELF note tables: `inspect_elf_notes` with the explicit local ELF32/ELF64
  file. This built-in target-free inspection requires no disassembler. Preserve
  PT_NOTE and SHT_NOTE ranges, owners, types, descriptor SHA-256, and GNU
  build-id or ABI-tag fields. A missing table is observed absence of those
  declarations, not proof the image never carried notes. See the
  ELF notes guide (REA repository: `docs/elf-notes.md`).

## DWARF compile units: `inspect_dwarf_units`

<!-- keywords: debug information, source files, optimisation level, optimization, compiler flags -->

- DWARF compile units: `inspect_dwarf_units` with the explicit local ELF,
  Mach-O, or PE file, or the DWARF file inside a `.dSYM` bundle. This built-in
  target-free inspection requires no disassembler. It reads DWARF 2 through 5
  unit headers and the unit DIE: name, compilation directory, producer,
  language, and `dwo_name`, including compressed ELF sections. Page with
  `offset` and `limit`. Partial coverage means a later unit could not be
  framed or a declared `.debug_info` was not read. Absent `.debug_info`
  applies to this file only. Per-unit gaps stay in `issues`. Child DIEs, types,
  line tables, and location expressions are not read. Universal Mach-O
  requires `architecture`. See the
  DWARF compile units guide (REA repository: `docs/guides/native/dwarf-units.md`).

## Separate ELF debug files: `inspect_elf_debug_link`

- Separate ELF debug files: `inspect_elf_debug_link` with the explicit local
  ELF32/ELF64 file. This built-in target-free inspection requires no
  disassembler and does not search for debug files. Preserve the
  `.gnu_debuglink` name and CRC32, `.gnu_debugaltlink` build-id, GNU build-id,
  and lookup path strings. Those paths are not opened. Pass `candidate_path`
  only for one file you already selected; the verdict is matches,
  does_not_match, or cannot_verify. A missing section is observed absence only
  when section names are complete. The `.gnu_debugdata` xz payload is not
  decoded. See the
  ELF debug files guide (REA repository: `docs/guides/native/elf-debug-link.md`).

## ELF load-time dynamic dependencies: `inspect_elf_dependencies`

- ELF load-time dynamic dependencies: `inspect_elf_dependencies` with the
  explicit local ELF32/ELF64 `ET_EXEC` or `ET_DYN` file. This built-in
  target-free inspection requires no disassembler or dynamic loader. Preserve
  ordered `DT_NEEDED` names (duplicates included), `DT_SONAME`, `DT_RPATH` /
  `DT_RUNPATH` as written including `$ORIGIN` / `$LIB` / `$PLATFORM` tokens,
  decoded `DT_FLAGS` / `DT_FLAGS_1`, `PT_INTERP`, GNU version requirements and
  definitions, derived per-namespace maxima, and undefined `.dynsym` imports
  joined to `library@version` when known. A missing `PT_DYNAMIC` is an observed
  empty inventory, not proof another overlay carried dynamic metadata.
  Relocatable objects use `inspect_kernel_module`; core dumps use
  `inspect_recorded_crash`. For large inventories prefer `detail: "summary"`
  plus `inspect_analysis_view` kind `elf-dependencies`. CLI summary requires
  `--evidence_output`. See the
  ELF dependencies guide (REA repository: `docs/elf-dependencies.md`).

## Code that runs before `main` or at exit in ELF or Mach-O: `inspect_native_initializers`

- Code that runs before `main` or at exit in ELF or Mach-O:
  `inspect_native_initializers` with the explicit local file (and
  `architecture` for a universal Mach-O). This built-in inspection requires no
  disassembler. Preserve slot and target addresses, the `resolution` of each
  entry, and its limitations. An `unresolved` slot is not a zero pointer, and a
  missing table is not proof that no constructor exists. See the
  initializer guide (REA repository: `docs/guides/native/native-initializers.md`).

## ELF unwind function ranges: `inspect_elf_unwind_ranges`

- ELF unwind function ranges: `inspect_elf_unwind_ranges` with the explicit
  local ELF32/ELF64 file. This built-in target-free inspection requires no
  disassembler. Preserve FDE start, end, size, containing section, exact
  symbol name, CIE index, LSDA, and personality. Page with `offset` and
  `limit`. A missing `.eh_frame` is observed absence of that declaration,
  not proof the image has no functions. `.debug_frame` is reported present
  or absent and is not decoded. CFA instructions are counted and not
  evaluated. See the
  ELF unwind ranges guide (REA repository: `docs/guides/native/elf-unwind-ranges.md`).

## Apple `.ips` crash reports: `inspect_apple_ips`

- Apple `.ips` crash reports: `inspect_apple_ips` with the explicit local
  file. This built-in target-free inspection requires no Xcode, atos, or
  pwntools. Preserve first-line metadata, `bug_type` as a string, process and
  exception facts, lossless integer registers, usedImages UUIDs, and
  documented classification matches. Only `bug_type` `"309"` yields a crash
  body; other types, including `"288"` stackshots, return no crash result.
  Select an optional `join_path` for UUID-and-architecture matching to one
  local Mach-O or dSYM; preserve slice identity and unjoined reasons. Joined
  static addresses do not resolve function names or dSYM symbols. See the
  Apple IPS guide (REA repository: `docs/apple-ips.md`).

## Linux kernel module metadata: `inspect_kernel_module`

- Linux kernel module metadata: `inspect_kernel_module` with the explicit local
  ELF32/ELF64 relocatable file. This built-in target-free inspection requires
  no Linux host or `modinfo`. Preserve `.modinfo` key order and duplicate keys,
  `__versions` CRC hex, section file ranges, and the appended signature
  trailer's PKCS#7 SHA-256. A missing section is observed absence when section
  names are known, not proof the module never carried that metadata.
  `struct module` is not decoded. The signature is not validated. gzip, xz, and
  zstd containers are unsupported; decompress into a separate file with an
  external codec utility, then inspect the decompressed `ET_REL` image. See the
  kernel module guide (REA repository: `docs/kernel-modules.md`).

## Linux kernel version and build config (`CONFIG_*` options such as `CONFIG_SECURITY_SELINUX`): `inspect_kernel_build_config`

- Linux kernel version and build config (`CONFIG_*` options such as
  `CONFIG_SECURITY_SELINUX`): `inspect_kernel_build_config` with the explicit
  local `vmlinux`, raw `Image`, x86 `bzImage`, or `configs.ko`. This built-in
  target-free inspection requires no Linux host or `extract-ikconfig`. Preserve
  the banner version, config SHA-256, option count, and value kinds; use `name`
  for one option. An `IKCFG_ST` string is a config only with a valid gzip member
  and `IKCFG_ED`. An absent config may mean the kernel was built without
  `CONFIG_IKCONFIG`. Non-gzip payloads are unsupported; decompress externally,
  then inspect the result. See the
  kernel build config guide (REA repository: `docs/guides/native/kernel-build-config.md`).

## CPython 3.7–3.15 `.pyc` header, nested marshal code objects and bytecode identity: `inspect_python_pyc`

- CPython 3.7–3.15 `.pyc` header, nested marshal code objects and bytecode
  identity: `inspect_python_pyc` with the explicit local file. This built-in
  target-free inspection requires no Python installation. Preserve magic,
  PEP 552 hash or mtime/size, nested names, and bytecode SHA-256. Bytecode is
  not decompiled, and a decoded header does not prove the matching `.py` is
  present. See the
  CPython pyc guide (REA repository: `docs/python-pyc.md`).

## Erlang BEAM IFF container: `inspect_erlang_beam`

- Erlang BEAM IFF container: `inspect_erlang_beam` with the explicit local
  `.beam` file. This built-in target-free inspection requires no Erlang
  installation. Preserve chunk names, atom order, export/import/lambda tables,
  and the Code header. For selected facts, prefer `detail: "summary"` plus a
  `beam` view (collection, names/indices, fields and paging), retaining the full
  Evidence. CLI summary requires `--evidence_output`. Missing table counts stay
  null; decoded empty tables count zero. Bytecode is not executed. See the
  Erlang BEAM guide (REA repository: `docs/erlang-beam.md`).

## NuGet `.nupkg` package identity, dependency groups and ZIP inventory: `inspect_nuget_nupkg`

- NuGet `.nupkg` package identity, dependency groups and ZIP inventory:
  `inspect_nuget_nupkg` with the explicit local file. This built-in
  target-free inspection does not restore the package, execute it, or contact a
  feed. Preserve identity fields as present, dependency version ranges as
  spelled, and path-derived member roles. Missing, ambiguous, or malformed
  `.nuspec` members still return the inventory with limitations. Encrypted
  members are listed and not extracted. See the
  NuGet packages guide (REA repository: `docs/guides/managed/nuget-nupkg.md`).

## Explicit local SQLite database snapshot: `inspect_sqlite_database`

- Explicit local SQLite database snapshot: `inspect_sqlite_database`. Inspect
  with Node.js 24.x >=24.15 or 26+ providing native SQLite limits. Read schema
  first (compact inventory by default), or select an exact ordinary table
  and `columns` when rows are needed. Defaults are selected-table schema and
  20 rows; request `schema_scope: "database"` for the complete stored schema. Preserve both database and existing sibling WAL identity; row samples
  report truncation and have unspecified order. Use a quiescent snapshot rather
  than assuming a live database/WAL pair was copied atomically. See the
  SQLite guide (REA repository: `docs/guides/data/sqlite-databases.md`).

## Explicit Linux ELF file for offline layout, symbols, relocations or static mitigation evidence: `inspect_binary_layout`

- Explicit Linux ELF file for offline layout, symbols, relocations or static
  mitigation evidence: `inspect_binary_layout`. This target-free operation uses
  caller-supplied pwntools without opening a disassembler database. Preserve its
  raw locations and inference/coverage limits; see the
  offline binary guide (REA repository: `docs/guides/native/binary-diagnostics.md`).

## Supplied Linux ELF64 amd64 or AArch64 core: `inspect_recorded_crash`

- Supplied Linux ELF64 amd64 or AArch64 core: `inspect_recorded_crash`, with
  caller-supplied pwntools (`REA_PWNTOOLS_PYTHON`). Read every recorded
  thread, raw note and source-bound register without opening a live target.
  Historical PIDs do not select live processes. Request `include_debugger_context`
  only when core-only mapping candidates help; see the
  recorded crash guide (REA repository: `docs/guides/native/recorded-crashes.md`).

## PE resource type/name/language trees and static icon group references: `inspect_pe_resources`

- PE resource type/name/language trees and static icon group references:
  `inspect_pe_resources` with an explicit path. This portable operation requires
  no active target or engine; opaque payloads retain file ranges and SHA-256.

## PE export directories and ELF dynamic-symbol exports: `inspect_native_exports`

- PE export directories and ELF dynamic-symbol exports: `inspect_native_exports`
  with an explicit path; portable, no active target or engine.

## OpenAPI or GraphQL API contract file: `inspect_api_contract`

<!-- keywords: openapi, swagger, graphql schema, api spec, endpoints of a spec -->

- OpenAPI or GraphQL API contract file: `inspect_api_contract` with the
  file's path; for GraphQL SDL set `contract_format: "graphql-sdl"` (CLI
  `--contract-format graphql-sdl`). It reads the declared operations, paths
  and types offline and calls nothing.

## Native code or data with no analysis provider ready: `inspect_with_objdump`

<!-- keywords: string literal, rodata, read data at an address, without provider, no provider -->

- Native code or data with no analysis provider ready: `inspect_with_objdump`
  with operation `symbols`, or `disassemble` and `symbol` for one function.
  A string or constant whose address the disassembly shows is read by GDB
  without running the program: `rea debug-with-gdb 'x/s 0x2008' --executable
  <path>`. The provider refusal lists these for its file.

<!-- Generated by `npm run skill:routes` from upstream's SKILL.md (scripts/skill-routes/). Edit the fork corrections in scripts/lib/skill-routes.mjs, not this file. -->
