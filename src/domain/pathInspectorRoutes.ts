/**
 * Which path inspector reads a file next. `inspect_artifact` names these for
 * the formats its inventory admits, and the target refusal names them for
 * files no executable or container reader admits (a SQLite file, a HAR, an
 * OpenAPI document, Python bytecode, a model file, EVM bytecode). Each probe
 * carries the contract arguments that run it on the inspected path; the CLI
 * renders them as a command that runs as printed.
 */

import { boundedList } from "./boundedList.js";

/** How a probe reaches its answer, as `inspect_artifact` reports it. */
export type PathProbeAuthority =
  | "artifact-bytes"
  | "managed-static-analysis"
  | "native-analysis-provider"
  | "ast-static-analysis";

/** One next step for a path: the tool, its fixed arguments and why. */
export interface PathRoute {
  readonly operation: string;
  readonly rationale: string;
  readonly authority: PathProbeAuthority;
  /** Contract fields the step sets besides the path, such as a capture format. */
  readonly fields?: Readonly<Record<string, string>>;
  /**
   * The contract field that takes the path (`path` unless named), or `null`
   * for a tool that reads the open session's target instead.
   */
  readonly pathField?: string | null;
  /** Run the tool on this path instead of the inspected one. */
  readonly path?: string;
  /** The step reads something other than the path (an extracted member). */
  readonly unbound?: true;
}

/**
 * A route bound to one path: the operation and the contract arguments that
 * run it as given. Adapters render the call (the CLI prints a command).
 */
export interface PathProbe {
  readonly operation: string;
  readonly arguments?: Readonly<Record<string, string>>;
  readonly rationale: string;
  readonly authority: PathProbeAuthority;
}

/** At most this many probes per reply (about 20 tokens each without the path). */
export const NEXT_PROBE_LIMIT = 8;

/** The contract arguments that run `route` on `path`. */
export const pathRouteArguments = (
  route: PathRoute,
  path: string,
): Readonly<Record<string, string>> => ({
  ...(route.pathField === null
    ? {}
    : { [route.pathField ?? "path"]: route.path ?? path }),
  ...route.fields,
});

/** Bind routes to a path and keep the first {@link NEXT_PROBE_LIMIT} distinct calls. */
export const pathProbes = (
  routes: readonly PathRoute[],
  path: string,
): { readonly probes: readonly PathProbe[]; readonly omitted: number } => {
  const key = (route: PathRoute) =>
    `${route.operation} ${JSON.stringify(route.fields ?? {})}`;
  const distinct = routes.filter(
    (route, index) =>
      routes.findIndex((other) => key(other) === key(route)) === index,
  );
  const bounded = boundedList(distinct, NEXT_PROBE_LIMIT);
  return {
    probes: bounded.items.map((route) => ({
      operation: route.operation,
      ...(route.unbound === true
        ? {}
        : { arguments: pathRouteArguments(route, path) }),
      rationale: route.rationale,
      authority: route.authority,
    })),
    omitted: bounded.omitted,
  };
};

const bytes = (route: Omit<PathRoute, "authority">): PathRoute => ({
  ...route,
  authority: "artifact-bytes",
});

const OBJDUMP_SYMBOLS = bytes({
  operation: "inspect_with_objdump",
  fields: { operation: "symbols" },
  rationale: "Symbol table without a provider.",
});

const DEEP_PROVIDER: PathRoute = {
  operation: "open_binary",
  rationale: "Decompile with a deep native provider.",
  authority: "native-analysis-provider",
};

// ---------------------------------------------------------------------------
// Native executables

/** Facts about an ELF file that choose its first inspector. */
export interface ElfRouteFacts {
  readonly type: "executable" | "shared-object" | "core" | "relocatable";
  /** Whether a PT_INTERP header names a program interpreter. */
  readonly interpreter: boolean;
  readonly sections: readonly string[];
}

/** The next inspectors for an ELF file, most specific first. */
export const elfRoutes = (facts: ElfRouteFacts): readonly PathRoute[] => {
  const has = (name: string): boolean => facts.sections.includes(name);
  if (facts.type === "core")
    return [
      bytes({
        operation: "inspect_recorded_crash",
        rationale: "Registers and signal of the crashed process.",
      }),
      bytes({
        operation: "inspect_elf_notes",
        rationale: "Core notes: process, files, auxiliary vector.",
      }),
    ];
  if (facts.type === "relocatable" && has(".modinfo"))
    return [
      bytes({
        operation: "inspect_kernel_module",
        rationale: "Linux kernel module metadata.",
      }),
      OBJDUMP_SYMBOLS,
    ];
  const library = facts.type === "shared-object" && !facts.interpreter;
  return [
    ...(has(".go.buildinfo") || has(".note.go.buildid")
      ? [
          bytes({
            operation: "inspect_go_binary",
            rationale: "Go version, modules and build settings.",
          }),
        ]
      : []),
    ...(has(".dep-v0")
      ? [
          bytes({
            operation: "inspect_rust_binary",
            rationale: "Embedded cargo dependency list.",
          }),
        ]
      : []),
    ...(library
      ? [
          bytes({
            operation: "inspect_native_exports",
            rationale: "Exported symbols of the library.",
          }),
        ]
      : []),
    ...(has(".debug_info") || has(".zdebug_info")
      ? [
          bytes({
            operation: "inspect_dwarf_units",
            rationale: "DWARF compile units: sources, producer, flags.",
          }),
        ]
      : []),
    bytes({
      operation: "inspect_binary_hardening",
      rationale: "RELRO, PIE, NX, canaries, RPATH.",
    }),
    ...(has(".dynamic")
      ? [
          bytes({
            operation: "inspect_elf_dependencies",
            rationale: "Needed libraries and symbol versions.",
          }),
        ]
      : []),
    OBJDUMP_SYMBOLS,
    DEEP_PROVIDER,
    bytes({
      operation: "inspect_elf_notes",
      rationale: "Build ID and ABI notes.",
    }),
  ];
};

/** The next inspectors for a Mach-O file or universal binary. */
export const MACHO_ROUTES: readonly PathRoute[] = [
  bytes({
    operation: "inspect_binary_hardening",
    rationale: "PIE, stack protection, code-signing flags.",
  }),
  bytes({
    operation: "inspect_signature",
    rationale: "Code signature and entitlements.",
  }),
  bytes({
    operation: "inspect_native_dispatch_metadata",
    rationale: "Objective-C and Swift classes and methods.",
  }),
  bytes({
    operation: "inspect_native_initializers",
    rationale: "Initializer and finalizer functions.",
  }),
  OBJDUMP_SYMBOLS,
  DEEP_PROVIDER,
];

/** The next inspectors for a PE file; managed metadata decides native work. */
export const PE_ROUTES: readonly PathRoute[] = [
  {
    operation: "inspect_managed_artifact",
    rationale:
      "Check execution-free CLI metadata before choosing a deep native provider.",
    authority: "managed-static-analysis",
  },
  bytes({
    operation: "inspect_pe_imports",
    rationale: "Imported DLLs and functions.",
  }),
  bytes({
    operation: "inspect_binary_hardening",
    rationale: "ASLR, DEP, CFG, signing flags.",
  }),
  bytes({
    operation: "inspect_native_exports",
    rationale: "Exported functions.",
  }),
  bytes({
    operation: "inspect_pe_resources",
    rationale: "Version info, icons, manifests.",
  }),
  bytes({
    operation: "inspect_pe_certificates",
    rationale: "Authenticode certificate identities.",
  }),
  {
    operation: "open_binary",
    rationale:
      "Open as native code only when managed inspection reports a native or mixed boundary.",
    authority: "native-analysis-provider",
  },
  bytes({
    operation: "inspect_pe_load_config",
    rationale: "TLS callbacks and load configuration.",
  }),
];

const readU16 = (data: Uint8Array, offset: number, little: boolean): number =>
  little
    ? data[offset]! | (data[offset + 1]! << 8)
    : (data[offset]! << 8) | data[offset + 1]!;

const readU32 = (data: Uint8Array, offset: number, little: boolean): number =>
  little
    ? (data[offset]! |
        (data[offset + 1]! << 8) |
        (data[offset + 2]! << 16) |
        (data[offset + 3]! << 24)) >>>
      0
    : ((data[offset]! << 24) |
        (data[offset + 1]! << 16) |
        (data[offset + 2]! << 8) |
        data[offset + 3]!) >>>
      0;

const readWord = (
  data: Uint8Array,
  offset: number,
  little: boolean,
  wide: boolean,
): number => {
  if (!wide) return readU32(data, offset, little);
  const low = readU32(data, offset + (little ? 0 : 4), little);
  const high = readU32(data, offset + (little ? 4 : 0), little);
  return high * 2 ** 32 + low;
};

/** Reads `length` bytes at `offset`; a short result means the file ended. */
export type ByteRangeReader = (
  offset: number,
  length: number,
) => Promise<Uint8Array>;

const MAX_ELF_SECTIONS = 4096;
const MAX_ELF_PROGRAM_HEADERS = 1024;
const MAX_SECTION_NAME_BYTES = 1_048_576;

/**
 * Read the facts {@link elfRoutes} needs from an ELF file's headers, section
 * names and program headers. `undefined` when the headers do not decode.
 */
export const readElfRouteFacts = async (
  read: ByteRangeReader,
): Promise<ElfRouteFacts | undefined> => {
  const header = await read(0, 64);
  if (
    header.length < 52 ||
    header[0] !== 0x7f ||
    header[1] !== 0x45 ||
    header[2] !== 0x4c ||
    header[3] !== 0x46
  )
    return undefined;
  const wide = header[4] === 2;
  const little = header[5] !== 2;
  if (wide && header.length < 64) return undefined;
  const type = readU16(header, 16, little);
  const phoff = readWord(header, wide ? 32 : 28, little, wide);
  const shoff = readWord(header, wide ? 40 : 32, little, wide);
  const at = wide ? 54 : 42;
  const phentsize = readU16(header, at, little);
  const phnum = readU16(header, at + 2, little);
  const shentsize = readU16(header, at + 4, little);
  const shnum = readU16(header, at + 6, little);
  const shstrndx = readU16(header, at + 8, little);
  let interpreter = false;
  if (phoff > 0 && phnum <= MAX_ELF_PROGRAM_HEADERS && phentsize >= 4) {
    const table = await read(phoff, phnum * phentsize);
    for (let index = 0; index < phnum; index += 1) {
      const offset = index * phentsize;
      if (offset + 4 > table.length) break;
      if (readU32(table, offset, little) === 3) interpreter = true;
    }
  }
  const sections: string[] = [];
  const entry = wide ? 64 : 40;
  if (
    shoff > 0 &&
    shnum <= MAX_ELF_SECTIONS &&
    shentsize >= entry &&
    shstrndx < shnum
  ) {
    const table = await read(shoff, shnum * shentsize);
    const field = (index: number, offset: number, wideField: boolean) =>
      readWord(table, index * shentsize + offset, little, wideField && wide);
    if (table.length >= shnum * shentsize) {
      const namesOffset = field(shstrndx, wide ? 24 : 16, true);
      const namesSize = Math.min(
        field(shstrndx, wide ? 32 : 20, true),
        MAX_SECTION_NAME_BYTES,
      );
      const names = await read(namesOffset, namesSize);
      for (let index = 0; index < shnum; index += 1) {
        const start = readU32(table, index * shentsize, little);
        if (start >= names.length) continue;
        let end = start;
        while (end < names.length && names[end] !== 0) end += 1;
        const name = new TextDecoder().decode(names.subarray(start, end));
        if (name.length > 0) sections.push(name);
      }
    }
  }
  return {
    type:
      type === 4
        ? "core"
        : type === 1
          ? "relocatable"
          : type === 3
            ? "shared-object"
            : "executable",
    interpreter,
    sections,
  };
};

// ---------------------------------------------------------------------------
// Files no executable or container reader admits

/** A file format a path inspector reads, recognized from its first bytes. */
export interface SniffedPathFormat {
  /** Short name for the format, for messages. */
  readonly label: string;
  readonly routes: readonly PathRoute[];
}

/** How many leading bytes {@link sniffPathFormat} examines. */
export const SNIFF_BYTES = 65_536;

const startsWith = (data: Uint8Array, prefix: readonly number[]): boolean =>
  prefix.every((value, index) => data[index] === value);

const ascii = (data: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...data.subarray(start, start + length));

const sniffed = (
  label: string,
  ...routes: readonly PathRoute[]
): SniffedPathFormat => ({ label, routes });

const textOf = (head: Uint8Array): string | undefined => {
  const sample = head.subarray(0, Math.min(head.length, 4096));
  if (sample.includes(0)) return undefined;
  return new TextDecoder("utf-8", { fatal: false }).decode(head);
};

const WEB_CAPTURE = (kind: string, label: string) =>
  sniffed(
    label,
    bytes({
      operation: "inspect_web_network_capture",
      pathField: "capture_path",
      fields: { format: kind },
      rationale: "Recorded requests and responses, offline.",
    }),
  );

const API_CONTRACT = sniffed(
  "OpenAPI document",
  bytes({
    operation: "inspect_api_contract",
    rationale: "Operations, types and field bindings.",
  }),
);

const GRAPHQL_CONTRACT = sniffed(
  "GraphQL schema",
  bytes({
    operation: "inspect_api_contract",
    fields: { format: "graphql-sdl" },
    rationale: "Types, fields and operations.",
  }),
);

const MODEL = (label: string) =>
  sniffed(
    label,
    bytes({
      operation: "inspect_model_artifact",
      rationale: "Header, tensors and metadata without weights.",
    }),
  );

const EVM = (encoding: "hex" | "raw") =>
  sniffed(
    "EVM bytecode",
    bytes({
      operation: "inspect_evm_interface",
      fields: { encoding },
      rationale: "Function selectors and interface candidates.",
    }),
  );

const sniffJson = (
  text: string,
  name: string,
): SniffedPathFormat | undefined => {
  const keys = (pattern: RegExp) => pattern.test(text);
  if (keys(/"log"\s*:/u) && keys(/"entries"\s*:/u))
    return WEB_CAPTURE("har", "HAR capture");
  if (keys(/"qlog_version"\s*:/u)) return WEB_CAPTURE("qlog", "qlog trace");
  if (keys(/"(?:openapi|swagger)"\s*:\s*"/u)) return API_CONTRACT;
  if (keys(/"bug_type"\s*:/u))
    return sniffed(
      "Apple crash report",
      bytes({
        operation: "inspect_apple_ips",
        rationale: "Crash report threads and images.",
      }),
    );
  if (
    (keys(/"formatVersion"\s*:/u) && keys(/"component"\s*:/u)) ||
    name.endsWith(".module")
  )
    return sniffed(
      "Gradle module metadata",
      bytes({
        operation: "inspect_maven_gradle_metadata",
        rationale: "Coordinates, variants and dependencies.",
      }),
    );
  return undefined;
};

const GRAPHQL_DEFINITION =
  /^\s*(?:extend\s+)?(?:type|schema|interface|enum|input|scalar|union|directive)\b/mu;

const sniffText = (
  text: string,
  name: string,
): SniffedPathFormat | undefined => {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) return sniffJson(trimmed, name);
  const hex = trimmed.trim().replace(/^0x/iu, "");
  if (
    /^(?:6080|6060)[0-9a-f]*$/iu.test(hex) &&
    hex.length % 2 === 0 &&
    hex.length >= 8
  )
    return EVM("hex");
  if (
    /\.(?:graphql|graphqls|gql)$/u.test(name) ||
    (GRAPHQL_DEFINITION.test(text) && /\btype\s+Query\b/u.test(text))
  )
    return GRAPHQL_CONTRACT;
  if (
    name.endsWith(".pom") ||
    name === "pom.xml" ||
    (trimmed.startsWith("<") && /<project\b/u.test(text) && /maven/u.test(text))
  )
    return sniffed(
      "Maven POM",
      bytes({
        operation: "inspect_maven_gradle_metadata",
        rationale: "Coordinates and dependencies without Maven.",
      }),
    );
  return undefined;
};

/**
 * Recognize, from its first bytes and its name, a file that a path inspector
 * reads. `undefined` when no inspector claims it.
 */
export const sniffPathFormat = (
  head: Uint8Array,
  fileName: string,
  fileSize: number,
): SniffedPathFormat | undefined => {
  const name = fileName.toLowerCase();
  if (ascii(head, 0, 16) === "SQLite format 3\0")
    return sniffed(
      "SQLite database",
      bytes({
        operation: "inspect_sqlite_database",
        rationale: "Schema, and table rows on request.",
      }),
    );
  if (ascii(head, 0, 4) === "GGUF") return MODEL("GGUF model");
  if (head.length >= 9 && fileSize > 8) {
    const length = readWord(head, 0, true, true);
    if (length > 1 && length <= fileSize - 8 && head[8] === 0x7b)
      return MODEL("safetensors model");
  }
  if (
    head.length >= 16 &&
    head[2] === 0x0d &&
    head[3] === 0x0a &&
    readU16(head, 0, true) >= 3300 &&
    readU16(head, 0, true) < 4000
  )
    return sniffed(
      "Python bytecode",
      bytes({
        operation: "inspect_python_pyc",
        rationale: "Header and code objects, never executed.",
      }),
    );
  if (
    [
      [0xa1, 0xb2, 0xc3, 0xd4],
      [0xd4, 0xc3, 0xb2, 0xa1],
      [0xa1, 0xb2, 0x3c, 0x4d],
      [0x4d, 0x3c, 0xb2, 0xa1],
      [0x0a, 0x0d, 0x0d, 0x0a],
    ].some((magic) => startsWith(head, magic))
  )
    return sniffed(
      "packet capture",
      bytes({
        operation: "inspect_pcap_capture",
        rationale: "Endpoints, DNS, TLS SNI and protocols.",
      }),
    );
  if (ascii(head, 0, 4) === "FOR1" && ascii(head, 8, 4) === "BEAM")
    return sniffed(
      "Erlang BEAM file",
      bytes({
        operation: "inspect_erlang_beam",
        rationale: "Atoms, exports and imports.",
      }),
    );
  if (startsWith(head, [0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0]))
    return sniffed(
      "Windows shortcut",
      bytes({
        operation: "inspect_windows_shortcut",
        rationale: "Link target and metadata, not resolved.",
      }),
    );
  if (startsWith(head, [0xd0, 0x0d, 0xfe, 0xed]))
    return sniffed(
      "devicetree blob",
      bytes({
        operation: "inspect_devicetree",
        rationale: "Nodes and properties.",
      }),
    );
  if (startsWith(head, [0xaf, 0x1b, 0xb1, 0xfa]))
    return sniffed(
      "IL2CPP metadata",
      bytes({
        operation: "inspect_il2cpp_metadata",
        rationale: "Type and method names, string literals.",
      }),
    );
  if (startsWith(head, [0x60, 0x80, 0x60, 0x40, 0x52])) return EVM("raw");
  const text = textOf(head);
  return text === undefined ? undefined : sniffText(text, name);
};

// ---------------------------------------------------------------------------
// Reading a native file without a deep provider

const NATIVE_FORMAT_ROUTES: Readonly<Record<string, readonly PathRoute[]>> = {
  elf: elfRoutes({
    type: "executable",
    interpreter: true,
    sections: [".dynamic"],
  }),
  "mach-o": MACHO_ROUTES,
  "mach-o-universal": MACHO_ROUTES,
  pe: PE_ROUTES,
};

/**
 * Calls that read a native file when no analysis provider is ready: two of
 * its format's path inspectors, objdump for symbols and one function's
 * disassembly, and GDB for reading code or data without running it. The
 * symbol and address are the caller's to fill in. Empty for a target that is
 * not a native file.
 */
export const providerFreeProbes = (
  path: string,
  format: string,
): readonly PathProbe[] => {
  const routes = NATIVE_FORMAT_ROUTES[format];
  if (routes === undefined) return [];
  const inspectors = routes.filter(
    ({ authority, operation }) =>
      authority !== "native-analysis-provider" &&
      operation !== "inspect_with_objdump",
  );
  return pathProbes(
    [
      ...boundedList(inspectors, 2).items,
      OBJDUMP_SYMBOLS,
      bytes({
        operation: "inspect_with_objdump",
        fields: { operation: "disassemble", symbol: "SYMBOL" },
        rationale: "One function's disassembly; fill in SYMBOL.",
      }),
      bytes({
        // start_gdb_session with this executable, then this console command.
        operation: "gdb_console",
        pathField: "executable",
        fields: { command: "x/s ADDRESS" },
        rationale: "Read a string or code at ADDRESS without running it.",
      }),
    ],
    path,
  ).probes;
};
