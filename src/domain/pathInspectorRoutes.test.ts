import { describe, expect, it } from "vitest";

import {
  elfRoutes,
  MACHO_ROUTES,
  NEXT_PROBE_LIMIT,
  pathProbes,
  PE_ROUTES,
  providerFreeProbes,
  readElfRouteFacts,
  sniffPathFormat,
} from "./pathInspectorRoutes.js";

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const first = (head: Uint8Array, name = "input", size = head.length) =>
  sniffPathFormat(head, name, size)?.routes[0];

describe("sniffPathFormat", () => {
  it.each([
    ["SQLite", text("SQLite format 3\0rest"), "inspect_sqlite_database", {}],
    ["GGUF", text("GGUF\x03\0\0\0"), "inspect_model_artifact", {}],
    [
      "a HAR",
      text('{"log":{"version":"1.2","entries":[]}}'),
      "inspect_web_network_capture",
      { format: "har" },
    ],
    [
      "a qlog",
      text('{"qlog_version":"0.3","traces":[]}'),
      "inspect_web_network_capture",
      { format: "qlog" },
    ],
    [
      "OpenAPI",
      text('{"openapi":"3.1.0","paths":{}}'),
      "inspect_api_contract",
      {},
    ],
    ["Swagger", text('{"swagger":"2.0"}'), "inspect_api_contract", {}],
    [
      "GraphQL SDL",
      text("schema { query: Query }\ntype Query { a: Int }\n"),
      "inspect_api_contract",
      { format: "graphql-sdl" },
    ],
    [
      "an Apple crash report",
      text('{"bug_type":"309","timestamp":"x"}'),
      "inspect_apple_ips",
      {},
    ],
    [
      "a Maven POM",
      text(
        '<?xml version="1.0"?><project xmlns="http://maven.apache.org/POM/4.0.0">',
      ),
      "inspect_maven_gradle_metadata",
      {},
    ],
    [
      "Gradle module metadata",
      text('{"formatVersion":"1.1","component":{"group":"g"}}'),
      "inspect_maven_gradle_metadata",
      {},
    ],
    [
      "EVM hex",
      text("0x6080604052600436\n"),
      "inspect_evm_interface",
      { encoding: "hex" },
    ],
    [
      "raw EVM",
      Uint8Array.of(0x60, 0x80, 0x60, 0x40, 0x52, 0x00),
      "inspect_evm_interface",
      { encoding: "raw" },
    ],
    [
      "a pcap",
      Uint8Array.of(0xd4, 0xc3, 0xb2, 0xa1, 2, 0, 4, 0),
      "inspect_pcap_capture",
      {},
    ],
    [
      "a pcapng",
      Uint8Array.of(0x0a, 0x0d, 0x0d, 0x0a, 0x1c, 0, 0, 0),
      "inspect_pcap_capture",
      {},
    ],
    ["a BEAM", text("FOR1\0\0\0\x10BEAMAtU8"), "inspect_erlang_beam", {}],
    [
      "a shortcut",
      Uint8Array.of(0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0, 0, 0),
      "inspect_windows_shortcut",
      {},
    ],
    [
      "a devicetree",
      Uint8Array.of(0xd0, 0x0d, 0xfe, 0xed, 0, 0, 0, 0x40),
      "inspect_devicetree",
      {},
    ],
    [
      "IL2CPP metadata",
      Uint8Array.of(0xaf, 0x1b, 0xb1, 0xfa, 0x1d, 0, 0, 0),
      "inspect_il2cpp_metadata",
      {},
    ],
  ] as const)("routes %s to its inspector", (_, head, operation, args) => {
    const route = first(head);
    expect(route?.operation).toBe(operation);
    expect(route?.fields ?? {}).toEqual(args);
  });

  it("routes Python bytecode and a safetensors file by their headers", () => {
    const pyc = new Uint8Array(16);
    pyc.set([0xcb, 0x0d, 0x0d, 0x0a]);
    expect(first(pyc)?.operation).toBe("inspect_python_pyc");
    const header = text(
      '{"a":{"dtype":"F32","shape":[1],"data_offsets":[0,4]}}',
    );
    const model = new Uint8Array(8 + header.length + 4);
    new DataView(model.buffer).setBigUint64(0, BigInt(header.length), true);
    model.set(header, 8);
    expect(first(model, "m", model.length)?.operation).toBe(
      "inspect_model_artifact",
    );
  });

  it("claims nothing for ordinary text or unknown bytes", () => {
    expect(sniffPathFormat(text("hello world\n"), "notes.txt", 12)).toBe(
      undefined,
    );
    expect(sniffPathFormat(text('{"name":"x"}'), "package.json", 12)).toBe(
      undefined,
    );
    expect(sniffPathFormat(Uint8Array.of(1, 2, 3, 0), "blob", 4)).toBe(
      undefined,
    );
  });
});

describe("elfRoutes", () => {
  const facts = (
    type: "executable" | "shared-object" | "core" | "relocatable",
    sections: readonly string[],
    interpreter = true,
  ) => elfRoutes({ type, interpreter, sections });

  it.each([
    ["a core file", facts("core", []), "inspect_recorded_crash"],
    [
      "a kernel module",
      facts("relocatable", [".modinfo", ".text"]),
      "inspect_kernel_module",
    ],
    [
      "a Go program",
      facts("executable", [".go.buildinfo"]),
      "inspect_go_binary",
    ],
    ["a Rust program", facts("executable", [".dep-v0"]), "inspect_rust_binary"],
    [
      "a library",
      facts("shared-object", [".dynamic", ".debug_info"], false),
      "inspect_native_exports",
    ],
    [
      "a PIE with DWARF",
      facts("shared-object", [".dynamic", ".debug_info"]),
      "inspect_dwarf_units",
    ],
    [
      "a stripped program",
      facts("executable", [".dynamic"]),
      "inspect_binary_hardening",
    ],
  ] as const)(
    "starts %s with its most specific inspector",
    (_, routes, operation) => {
      expect(routes[0]?.operation).toBe(operation);
    },
  );

  it("keeps a provider-free reading and the deep provider within the cap", () => {
    const routes = elfRoutes({
      type: "shared-object",
      interpreter: false,
      sections: [".go.buildinfo", ".dep-v0", ".debug_info", ".dynamic"],
    });
    const { probes } = pathProbes(routes, "/x");
    expect(probes.length).toBeLessThanOrEqual(NEXT_PROBE_LIMIT);
    expect(probes.map(({ operation }) => operation)).toEqual(
      expect.arrayContaining(["inspect_with_objdump", "open_binary"]),
    );
  });

  it("orders PE and Mach-O routes with their judgment first", () => {
    expect(PE_ROUTES[0]?.operation).toBe("inspect_managed_artifact");
    expect(PE_ROUTES.length).toBeLessThanOrEqual(NEXT_PROBE_LIMIT);
    expect(MACHO_ROUTES[0]?.operation).toBe("inspect_binary_hardening");
  });
});

describe("readElfRouteFacts", () => {
  /** A little-endian ELF64 with the given type, an interpreter and sections. */
  const elf64 = (type: number, names: readonly string[]): Uint8Array => {
    const strings = ["", ...names].join("\0") + "\0";
    const shstrOffset = 64 + 56;
    const shoff = shstrOffset + strings.length;
    const sections = names.length + 2;
    const file = new Uint8Array(shoff + sections * 64);
    const view = new DataView(file.buffer);
    file.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
    view.setUint16(16, type, true);
    view.setBigUint64(32, 64n, true); // e_phoff
    view.setBigUint64(40, BigInt(shoff), true);
    view.setUint16(54, 56, true); // e_phentsize
    view.setUint16(56, 1, true); // e_phnum
    view.setUint16(58, 64, true); // e_shentsize
    view.setUint16(60, sections, true);
    view.setUint16(62, sections - 1, true); // e_shstrndx
    view.setUint32(64, 3, true); // PT_INTERP
    file.set(new TextEncoder().encode(strings), shstrOffset);
    let name = 1;
    names.forEach((section, index) => {
      view.setUint32(shoff + (index + 1) * 64, name, true);
      name += section.length + 1;
    });
    const table = shoff + (sections - 1) * 64;
    view.setBigUint64(table + 24, BigInt(shstrOffset), true);
    view.setBigUint64(table + 32, BigInt(strings.length), true);
    return file;
  };
  const reader = (file: Uint8Array) => async (offset: number, length: number) =>
    file.subarray(offset, offset + length);

  it("reads the type, interpreter and section names", async () => {
    await expect(
      readElfRouteFacts(reader(elf64(3, [".dynamic", ".debug_info"]))),
    ).resolves.toEqual({
      type: "shared-object",
      interpreter: true,
      sections: [".dynamic", ".debug_info"],
    });
    await expect(
      readElfRouteFacts(reader(elf64(4, []))),
    ).resolves.toMatchObject({ type: "core" });
  });

  it("answers nothing for bytes that are not ELF", async () => {
    await expect(readElfRouteFacts(reader(text("MZ")))).resolves.toBe(
      undefined,
    );
  });
});

describe("pathProbes", () => {
  it("binds each route to its path field and keeps fixed fields", () => {
    const { probes } = pathProbes(
      [
        {
          operation: "inspect_web_network_capture",
          pathField: "capture_path",
          fields: { format: "har" },
          rationale: "r",
          authority: "artifact-bytes",
        },
        {
          operation: "extract_artifact",
          pathField: null,
          rationale: "r",
          authority: "artifact-bytes",
        },
        {
          operation: "open_binary",
          unbound: true,
          rationale: "r",
          authority: "native-analysis-provider",
        },
      ],
      "/tmp/c.har",
    );
    expect(
      probes.map(({ operation, arguments: call }) => ({ operation, call })),
    ).toEqual([
      {
        operation: "inspect_web_network_capture",
        call: { capture_path: "/tmp/c.har", format: "har" },
      },
      { operation: "extract_artifact", call: {} },
      { operation: "open_binary", call: undefined },
    ]);
  });

  it("names objdump and a static GDB read when no provider is ready", () => {
    expect(
      providerFreeProbes("/w/licensed", "elf").map(
        ({ operation, arguments: call }) => [operation, call],
      ),
    ).toEqual([
      ["inspect_binary_hardening", { path: "/w/licensed" }],
      ["inspect_elf_dependencies", { path: "/w/licensed" }],
      ["inspect_with_objdump", { path: "/w/licensed", operation: "symbols" }],
      [
        "inspect_with_objdump",
        { path: "/w/licensed", operation: "disassemble", symbol: "SYMBOL" },
      ],
      ["gdb_console", { executable: "/w/licensed", command: "x/s ADDRESS" }],
    ]);
    expect(providerFreeProbes("/w/db.hop", "analysis-database")).toEqual([]);
  });
});
