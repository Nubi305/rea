import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

/**
 * `inspect-artifact` routes a file it can place: for each format with a path
 * inspector, the first next probe is that inspector, printed as a command
 * that runs as printed, and running it does not refuse the same file. Every
 * fixture is built here from source; the repository keeps no binaries.
 */

const onPath = (tool: string): boolean =>
  (process.env.PATH ?? "")
    .split(":")
    .some((directory) => directory !== "" && existsSync(join(directory, tool)));

const C_PROGRAM = `#include <stdio.h>
#include <string.h>
int verify(const char *key) { return strcmp(key, "KEY-1") == 0; }
int main(int argc, char **argv) { printf("%d\\n", argc > 1 && verify(argv[1])); return 0; }
`;

const C_LIBRARY = `__attribute__((visibility("default"))) int tariff(int units) { return units * 3; }
`;

const GO_PROGRAM = `package main

import "fmt"

func main() { fmt.Println("agent") }
`;

const u64 = (value: number): Buffer => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
};

const safetensors = (): Buffer => {
  let header = JSON.stringify({
    "w.weight": { dtype: "F32", shape: [2], data_offsets: [0, 8] },
  });
  header += " ".repeat((8 - (header.length % 8)) % 8);
  return Buffer.concat([
    u64(header.length),
    Buffer.from(header),
    Buffer.alloc(8),
  ]);
};

const har = JSON.stringify({
  log: {
    version: "1.2",
    creator: { name: "fixture", version: "1" },
    entries: [
      {
        startedDateTime: "2026-01-01T00:00:00.000Z",
        time: 5,
        request: {
          method: "GET",
          url: "https://example.test/api/items",
          httpVersion: "HTTP/1.1",
          headers: [],
          queryString: [],
          cookies: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          headers: [],
          cookies: [],
          content: { size: 2, mimeType: "application/json", text: "[]" },
          redirectURL: "",
          headersSize: -1,
          bodySize: 2,
        },
        cache: {},
        timings: { send: 1, wait: 3, receive: 1 },
      },
    ],
  },
});

const openapi = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Fleet", version: "1" },
  paths: {
    "/vehicles": {
      get: {
        operationId: "listVehicles",
        responses: { "200": { description: "ok" } },
      },
    },
  },
});

interface Fixture {
  readonly name: string;
  /** The CLI command the first probe must name. */
  readonly expected: string;
  /** Tools the fixture's builder needs on PATH. */
  readonly needs?: readonly string[];
  /** Build the input and return its path. */
  readonly build: (directory: string) => Promise<string>;
}

const compile = (
  directory: string,
  name: string,
  source: string,
  flags: readonly string[],
) => {
  const sourcePath = join(directory, `${name}.c`);
  execFileSync("gcc", [...flags, "-o", join(directory, name), sourcePath]);
  return join(directory, name);
};

const FIXTURES: readonly Fixture[] = [
  {
    name: "an ELF executable",
    expected: "inspect-binary-hardening",
    needs: ["gcc"],
    build: async (directory) => {
      await writeFile(join(directory, "keyd.c"), C_PROGRAM);
      return compile(directory, "keyd", C_PROGRAM, ["-O1"]);
    },
  },
  {
    name: "an ELF executable with DWARF",
    expected: "inspect-dwarf-units",
    needs: ["gcc"],
    build: async (directory) => {
      await writeFile(join(directory, "tallyd.c"), C_PROGRAM);
      return compile(directory, "tallyd", C_PROGRAM, ["-O0", "-g"]);
    },
  },
  {
    name: "an ELF shared library",
    expected: "inspect-native-exports",
    needs: ["gcc"],
    build: async (directory) => {
      await writeFile(join(directory, "libtariff.c"), C_LIBRARY);
      const sourcePath = join(directory, "libtariff.c");
      const output = join(directory, "libtariff.so");
      execFileSync("gcc", ["-shared", "-fPIC", "-o", output, sourcePath]);
      return output;
    },
  },
  {
    name: "a Go executable",
    expected: "inspect-go-binary",
    needs: ["go"],
    build: async (directory) => {
      const module = join(directory, "agentd");
      await mkdir(module);
      await writeFile(join(module, "go.mod"), "module agentd\n\ngo 1.21\n");
      await writeFile(join(module, "main.go"), GO_PROGRAM);
      execFileSync(
        "go",
        ["build", "-trimpath", "-o", join(directory, "agentd.bin"), "."],
        {
          cwd: module,
          env: {
            ...process.env,
            CGO_ENABLED: "0",
            GOTOOLCHAIN: "local",
            GOPROXY: "off",
            GOFLAGS: "-buildvcs=false",
            GOCACHE: join(directory, "gocache"),
          },
        },
      );
      return join(directory, "agentd.bin");
    },
  },
  {
    name: "a SQLite database",
    expected: "inspect-sqlite-database",
    build: async (directory) => {
      const path = join(directory, "app.db");
      const database = new DatabaseSync(path);
      database.exec(
        "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users (name) VALUES ('ada');",
      );
      database.close();
      return path;
    },
  },
  {
    name: "a HAR capture",
    expected: "inspect-web-network-capture",
    build: async (directory) => {
      const path = join(directory, "checkout.har");
      await writeFile(path, har);
      return path;
    },
  },
  {
    name: "an OpenAPI document",
    expected: "inspect-api-contract",
    build: async (directory) => {
      const path = join(directory, "fleet-api.json");
      await writeFile(path, openapi);
      return path;
    },
  },
  {
    name: "a GraphQL schema",
    expected: "inspect-api-contract",
    build: async (directory) => {
      const path = join(directory, "schema.graphql");
      await writeFile(
        path,
        "type Query {\n  vehicle(id: ID!): Vehicle\n}\n\ntype Vehicle {\n  id: ID!\n}\n",
      );
      return path;
    },
  },
  {
    name: "Python bytecode",
    expected: "inspect-python-pyc",
    needs: ["python3"],
    build: async (directory) => {
      const source = join(directory, "ledger.py");
      const path = join(directory, "ledger.pyc");
      await writeFile(source, "def total(items):\n    return sum(items)\n");
      execFileSync("python3", [
        "-I",
        "-c",
        "import py_compile,sys; py_compile.compile(sys.argv[1], cfile=sys.argv[2], doraise=True)",
        source,
        path,
      ]);
      return path;
    },
  },
  {
    name: "a safetensors model",
    expected: "inspect-model-artifact",
    build: async (directory) => {
      const path = join(directory, "model.safetensors");
      await writeFile(path, safetensors());
      return path;
    },
  },
  {
    name: "EVM bytecode as hex",
    expected: "inspect-evm-interface",
    build: async (directory) => {
      const path = join(directory, "contract.hex");
      // A dispatcher comparing four selectors, then their bodies.
      await writeFile(
        path,
        "0x60806040526004361061003e575f3560e01c806370a0823114610043578063a9059cbb1461004b57806318160ddd146100535780633ccfd60b1461005b575b5f80fd005b60015f5260205ff35b60025f5260205ff35b60035f5260205ff35b60045f5260205ff3\n",
      );
      return path;
    },
  },
  {
    name: "a JavaScript application directory",
    expected: "analyze-javascript-application",
    build: async (directory) => {
      const app = join(directory, "webapp");
      await mkdir(app);
      await writeFile(
        join(app, "package.json"),
        JSON.stringify({ name: "webapp", main: "index.js" }),
      );
      await writeFile(
        join(app, "index.js"),
        "fetch('/api/items').then((response) => response.json());\n",
      );
      return app;
    },
  },
  {
    name: "a single JavaScript file",
    expected: "analyze-javascript-application",
    build: async (directory) => {
      const app = join(directory, "bundle");
      await mkdir(app);
      const path = join(app, "app.js");
      await writeFile(path, "export const load = () => fetch('/api/items');\n");
      return path;
    },
  },
];

/** Split a printed command into argv, honouring the single quotes it uses. */
const commandWords = (command: string): string[] =>
  [...command.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/gu)].map((match) =>
    match[1] === undefined ? match[2]! : match[1].replaceAll("'\\''", "'"),
  );

interface Probe {
  readonly operation: string;
  readonly command: string;
}

const probesOf = (json: unknown): readonly Probe[] => {
  const document = json as {
    normalized_result?: { next_probes?: Probe[] };
    details?: { next_probes?: Probe[] };
  };
  return (
    document.normalized_result?.next_probes ??
    document.details?.next_probes ??
    []
  );
};

// Codes that would mean the inspector refused this file itself.
const FILE_REFUSALS = new Set([
  "unsupported_target",
  "target_unavailable",
  "invalid_request",
]);

describe("inspect-artifact names the next inspector for a file it can place", () => {
  for (const fixture of FIXTURES)
    cliTest.skipIf((fixture.needs ?? []).some((tool) => !onPath(tool)))(
      fixture.name,
      async ({ cli }) => {
        const directory = await createTestTempDirectory("rea-inspect-routing-");
        const path = await fixture.build(directory);
        const inspected = await cli.run({
          arguments: ["inspect-artifact", path, "--json"],
          timeoutMs: 120_000,
        });
        const probes = probesOf(inspected.json);
        expect(probes.length).toBeGreaterThan(0);
        expect(probes.length).toBeLessThanOrEqual(8);
        const [rea, command, ...rest] = commandWords(probes[0]!.command);
        expect({ rea, command }).toEqual({
          rea: "rea",
          command: fixture.expected,
        });
        const followed = await cli.run({
          arguments: [command!, ...rest, "--json"],
          timeoutMs: 180_000,
        });
        const code = (followed.json as { code?: string } | undefined)?.code;
        expect(
          followed.exitCode === 0 || !FILE_REFUSALS.has(code ?? ""),
          `${probes[0]!.command} -> exit ${followed.exitCode} ${code ?? ""}`,
        ).toBe(true);
      },
      300_000,
    );
});
