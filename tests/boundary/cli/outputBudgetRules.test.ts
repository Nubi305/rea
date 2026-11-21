/**
 * The answer budget's digest rules on real CLI documents and on synthetic
 * shapes the real ones lack (contract 5, 6.1, 6.2, 7, 13.3 "digest rules").
 *
 * The real documents are produced in this file by the built CLI from small
 * inputs written here; the budget is not wired into the CLI yet, so each run
 * prints today's complete bytes, which are also what the saved file must hold.
 * Printed commands are followed in process by a reader that applies the same
 * selection, projection and text window the reader command will.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import fc from "fast-check";
import { expect, it } from "vitest";

import {
  budgetError,
  budgetResult,
  savedDocumentParts,
} from "../../../src/cli/outputBudget/deliver.js";
import {
  ADDRESSABLE_KEY,
  buildDigest,
  renderDigestJson,
  type DigestBody,
} from "../../../src/cli/outputBudget/digest.js";
import {
  BRIEF_COMMANDS,
  digestBrief,
} from "../../../src/cli/outputBudget/briefs.js";
import {
  OUTPUT_BUDGET_OFF,
  resolveOutputBudget,
  selfCommand,
  targetText,
  type OutputBudgetPolicy,
} from "../../../src/cli/outputBudget/policy.js";
import {
  resolveTargets,
  unmatchedFilterMessage,
} from "../../../src/cli/outputBudget/selection.js";
import { textWindow } from "../../../src/cli/outputBudget/textWindow.js";
import {
  countedTokens,
  countedTokenWindow,
  countedTokenWindowWithin,
  MINIMUM_TOKEN_LIMIT,
} from "../../../src/cli/outputBudget/tokenBound.js";
import type { SavedOutputStoreOptions } from "../../../src/cli/outputBudget/store.js";
import {
  parseOutputFilter,
  type OutputFilterPath,
} from "../../../src/cli/outputFilter.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import type { TestCli } from "../../support/cli/cliFixture.js";

const BUDGET = 6000;
const MINIMUM = 2048;
const utf8 = (text: string): number => Buffer.byteLength(text, "utf8");
const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const paths = (expression: string): OutputFilterPath[] => {
  const parsed = parseOutputFilter(expression);
  if (!parsed.ok) throw new Error(`unparsable filter ${expression}`);
  return parsed.value;
};

// ---------------------------------------------------------------------------
// The reader a printed command starts, in process.

/** The writer's `--filter-output` projection (src/cli/cliResultOutput.ts), for measuring a printed command's reply. */
const project = (
  value: unknown,
  filter: readonly OutputFilterPath[],
): unknown => {
  const objectPaths = (
    node: unknown,
    list: readonly OutputFilterPath[],
  ): unknown => {
    if (node === null || typeof node !== "object") return {};
    const byKey = new Map<string, OutputFilterPath[]>();
    for (const [segment, ...tail] of list)
      if (segment !== undefined && "key" in segment)
        byKey.set(segment.key, [...(byKey.get(segment.key) ?? []), tail]);
    const out: Record<string, unknown> = {};
    for (const key of [...byKey.keys()].sort()) {
      if (!Object.hasOwn(node, key)) continue;
      const child = (node as Record<string, unknown>)[key];
      if (child === undefined) continue;
      const siblings = byKey.get(key)!;
      if (siblings.some((path) => path.length === 0)) out[key] = child;
      else {
        const projected = childPaths(child, siblings);
        if (projected !== undefined) out[key] = projected;
      }
    }
    return out;
  };
  const childPaths = (
    node: unknown,
    list: readonly OutputFilterPath[],
  ): unknown => {
    if (node === null || typeof node !== "object") return undefined;
    return Array.isArray(node) &&
      list.some((path) => path[0] !== undefined && "start" in path[0])
      ? slices(node, list)
      : objectPaths(node, list);
  };
  const clamp = (index: number, length: number): number => {
    const integer = Number.isNaN(index) ? 0 : Math.trunc(index);
    return integer < 0
      ? Math.max(length + integer, 0)
      : Math.min(integer, length);
  };
  const slices = (
    source: readonly unknown[],
    list: readonly OutputFilterPath[],
  ): unknown[] => {
    const selected = new Map<number, OutputFilterPath[]>();
    for (const [segment, ...tail] of list) {
      if (segment === undefined || "key" in segment) continue;
      for (
        let index = clamp(segment.start, source.length);
        index < clamp(segment.end, source.length);
        index += 1
      )
        selected.set(index, [...(selected.get(index) ?? []), tail]);
    }
    return [...selected.keys()]
      .sort((left, right) => left - right)
      .map((index) => {
        const siblings = selected.get(index)!;
        const item = source[index];
        return siblings.some((path) => path.length === 0)
          ? (item ?? null)
          : (childPaths(item, siblings) ?? {});
      });
  };
  if (Array.isArray(value)) {
    if (filter.some((path) => path[0] !== undefined && "start" in path[0]))
      return slices(value, filter);
    return value.map((item) => project(item, filter));
  }
  const only = filter[0];
  if (
    filter.length === 1 &&
    only?.length === 1 &&
    only[0] !== undefined &&
    "key" in only[0]
  ) {
    const key = only[0].key;
    if (!isRecord(value) || !Object.hasOwn(value, key)) return undefined;
    const selected = value[key];
    return typeof selected !== "object" || selected === null
      ? selected
      : { [key]: selected };
  }
  return objectPaths(value, filter);
};

interface Saved {
  readonly command: string;
  readonly document: unknown;
  readonly text: string;
  readonly sha256: string;
  readonly reader: string;
}

const savedOf = (command: string, document: unknown): Saved => {
  const text = [...savedDocumentParts(document)].join("");
  const hash = sha256(text);
  return {
    command,
    document,
    text,
    sha256: hash,
    reader: `rea saved-output show ${hash.slice(0, 12)}`,
  };
};

const digestFor = (
  saved: Saved,
  budget: number,
  filter?: string,
  resultBytes?: number,
) =>
  buildDigest({
    command: saved.command,
    document: saved.document,
    ...(filter === undefined
      ? {}
      : { filter: { expression: filter, paths: paths(filter) } }),
    resultBytes: resultBytes ?? utf8(saved.text),
    format: "json",
    limit: { bytes: budget, source: "default" },
    saved: {
      file: `/home/analyst/.cache/rea/saved-output/${saved.sha256}.${saved.command}.json`,
      bytes: utf8(saved.text),
      sha256: saved.sha256,
    },
    reader: saved.reader,
    brief:
      filter === undefined
        ? digestBrief(saved.command, saved.document)
        : undefined,
    untrusted: targetText(saved.command),
    evidenceOutputOption: true,
  });

type Reply =
  | { readonly kind: "content"; readonly text: string }
  | {
      readonly kind: "digest";
      readonly text: string;
      readonly digest: DigestBody;
    }
  | { readonly kind: "refused"; readonly text: string };

const words = (tail: string): string[] =>
  (tail.match(/'(?:[^']|'"'"')*'|\S+/gu) ?? []).map((word) =>
    word.startsWith("'") ? word.slice(1, -1).replaceAll(`'"'"'`, "'") : word,
  );

/** What `rea saved-output show <id> ...` prints for a printed command. */
const read = (saved: Saved, command: string, budget: number): Reply => {
  if (!command.startsWith(`${saved.reader} `))
    return { kind: "refused", text: `not a reader command: ${command}` };
  const args = words(command.slice(saved.reader.length + 1));
  const option = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const textPath = option("--text");
  if (textPath !== undefined) {
    const selection =
      textPath === "."
        ? { targets: [{ path: "", node: saved.document }] }
        : resolveTargets(saved.document, paths(textPath));
    const [target] = selection.targets;
    if (
      selection.targets.length !== 1 ||
      target === undefined ||
      "from" in target
    )
      return { kind: "refused", text: "--text needs one value" };
    return {
      kind: "content",
      text: textWindow(
        target.node,
        textPath,
        Number(option("--offset") ?? 0),
        budget,
      ).text,
    };
  }
  const filter = option("--filter-output");
  if (filter === undefined) {
    if (utf8(saved.text) <= budget)
      return { kind: "content", text: saved.text };
    const digest = digestFor(saved, budget);
    return {
      kind: "digest",
      text: renderDigestJson(digest),
      digest: digest.rea_digest,
    };
  }
  const selection = resolveTargets(saved.document, paths(filter));
  const refusal = unmatchedFilterMessage(selection);
  if (refusal !== undefined) return { kind: "refused", text: refusal };
  const projected = project(saved.document, paths(filter));
  const rendered = `${JSON.stringify(projected === undefined ? {} : projected)}\n`;
  if (utf8(rendered) <= budget) return { kind: "content", text: rendered };
  const digest = digestFor(saved, budget, filter, utf8(rendered));
  return {
    kind: "digest",
    text: renderDigestJson(digest),
    digest: digest.rea_digest,
  };
};

const shellWord = (value: string): string =>
  /^[A-Za-z0-9_@%+=:,./-]+$/u.test(value)
    ? value
    : `'${value.replaceAll("'", `'"'"'`)}'`;

/** The command a reader composes from one `omitted` row (contract 5.3). */
const rowCommand = (saved: Saved, row: Record<string, unknown>): string => {
  const path = String(row.path);
  if (row.text === true) return `${saved.reader} --text ${shellWord(path)}`;
  if (typeof row.rows === "number" && typeof row.page === "number") {
    const from = typeof row.from === "number" ? row.from : 0;
    return `${saved.reader} --filter-output ${shellWord(`${path}[${String(from)},${String(from + row.page)}]`)}`;
  }
  return `${saved.reader} --filter-output ${shellWord(path)}`;
};

interface FollowReport {
  readonly problems: string[];
  commands: number;
  deepest: number;
}

/**
 * Follow every printed command and every row's composed command (P1 to P4):
 * never the same command again on a path, never over the budget, never a
 * reply that selects as much as the digest it came from, content within
 * `hops`.
 */
const follow = (
  saved: Saved,
  first: DigestBody,
  budget: number,
  hops: number,
): FollowReport => {
  const report: FollowReport = { problems: [], commands: 0, deepest: 0 };
  const walk = (
    digest: DigestBody,
    seen: ReadonlySet<string>,
    hop: number,
  ): void => {
    report.deepest = Math.max(report.deepest, hop);
    const commands = [
      ...new Set([
        ...digest.next,
        ...digest.omitted.map((row) => rowCommand(saved, row)),
      ]),
    ];
    if (commands.length === 0)
      report.problems.push(`a digest at hop ${String(hop)} prints no command`);
    for (const command of commands) {
      report.commands += 1;
      if (seen.has(command)) {
        report.problems.push(`P1 repeats ${command}`);
        continue;
      }
      const reply = read(saved, command, budget);
      if (utf8(reply.text) > budget)
        report.problems.push(
          `P3 ${String(utf8(reply.text))} B from ${command}`,
        );
      if (reply.kind === "refused") {
        report.problems.push(`dead end ${command}: ${reply.text}`);
        continue;
      }
      if (reply.kind === "content") continue;
      if (reply.digest.budget.result_bytes >= digest.budget.result_bytes)
        report.problems.push(
          `P2 ${command} selects ${String(reply.digest.budget.result_bytes)} B of ${String(digest.budget.result_bytes)}`,
        );
      else if (hop >= hops)
        report.problems.push(
          `P4 no content within ${String(hops)} hops: ${command}`,
        );
      else walk(reply.digest, new Set([...seen, command]), hop + 1);
    }
  };
  walk(first, new Set(), 1);
  return report;
};

// ---------------------------------------------------------------------------
// Independent oracles for 6.1.

const FLAG_KEY =
  /^(?:truncated|.*_truncated|complete|source_complete|has_more|next_offset|next_cursor|next_row_offset|omitted_count|partial)$/u;
const flagged = (key: string, value: unknown): boolean =>
  key === "complete" || key === "source_complete"
    ? value === false
    : key === "next_offset" ||
        key === "next_cursor" ||
        key === "next_row_offset"
      ? value !== null && value !== undefined
      : value === true || (typeof value === "number" && value > 0);

/** Incompleteness flags in a document as 6.1 defines the search. */
const flagsIn = (document: unknown): string[] => {
  const found: string[] = [];
  const visit = (node: unknown, path: string, depth: number): void => {
    if (depth > 8) return;
    if (Array.isArray(node)) {
      node.slice(0, 50).forEach((child, index) => {
        visit(
          child,
          `${path}[${String(index)},${String(index + 1)}]`,
          depth + 1,
        );
      });
      return;
    }
    if (!isRecord(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (!ADDRESSABLE_KEY.test(key) || key === "raw_result") continue;
      const here = path === "" ? key : `${path}.${key}`;
      if (
        FLAG_KEY.test(key) &&
        (value === null || typeof value !== "object") &&
        flagged(key, value)
      )
        found.push(here);
      else visit(value, here, depth + 1);
    }
  };
  visit(document, "", 0);
  return found;
};

/** Distinct sentences of the root scope and, when a brief is shown, its scope. */
const scopeSentences = (
  document: unknown,
  briefScopes: readonly string[],
): number => {
  const sentences = new Set<string>();
  const add = (list: unknown): void => {
    if (Array.isArray(list))
      for (const sentence of list)
        if (typeof sentence === "string") sentences.add(sentence);
  };
  const base =
    isRecord(document) &&
    isRecord(document.summary) &&
    isRecord(document.evidence_bundle)
      ? document.summary
      : document;
  if (isRecord(base)) {
    add(base.limitations);
    if (isRecord(base.normalized_result))
      add(base.normalized_result.limitations);
  }
  for (const scope of briefScopes) {
    let node: unknown = document;
    for (const key of scope.split("."))
      node = isRecord(node) ? node[key] : undefined;
    if (isRecord(node)) add(node.limitations);
  }
  return sentences.size;
};

const PRINTABLE_PATH =
  /^(?:[A-Za-z0-9_-]+|\[\d+,\d+\])(?:\.[A-Za-z0-9_-]+|\[\d+,\d+\])*$/u;

// ---------------------------------------------------------------------------
// Real documents: today's CLI output on small inputs written here.

interface RealDocument {
  readonly name: string;
  readonly command: string;
  readonly stdout: string;
  readonly exitCode: number;
}

const HAR = {
  log: {
    version: "1.2",
    creator: { name: "fixture", version: "1" },
    entries: Array.from({ length: 4 }, (_, index) => ({
      startedDateTime: `2026-01-01T00:00:0${String(index)}.000Z`,
      time: 12,
      request: {
        method: index % 2 === 0 ? "GET" : "POST",
        url: `https://api.notes.example/v1/notes/${String(index)}?limit=20`,
        httpVersion: "HTTP/1.1",
        headers: [{ name: "accept", value: "application/json" }],
        queryString: [{ name: "limit", value: "20" }],
        cookies: [],
        headersSize: -1,
        bodySize: 0,
      },
      response: {
        status: 200,
        statusText: "OK",
        httpVersion: "HTTP/1.1",
        headers: [{ name: "content-type", value: "application/json" }],
        cookies: [],
        content: {
          size: 27,
          mimeType: "application/json",
          text: `[{"id":${String(index)},"title":"a"}]`,
        },
        redirectURL: "",
        headersSize: -1,
        bodySize: 27,
      },
      cache: {},
      timings: { send: 1, wait: 10, receive: 1 },
    })),
  },
};

const OPENAPI = {
  openapi: "3.0.3",
  info: { title: "Notes", version: "1.0.0" },
  paths: {
    "/v1/notes": {
      get: {
        operationId: "listNotes",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "ok" } },
      },
      post: {
        operationId: "createNote",
        responses: { "201": { description: "created" } },
      },
    },
    "/v1/notes/{id}": {
      delete: {
        operationId: "deleteNote",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: { "204": { description: "gone" } },
      },
    },
  },
};

const APP: Readonly<Record<string, string>> = {
  "package.json": `{"name":"notes-demo","version":"1.2.0","main":"src/main.js","dependencies":{"tinylib":"1.0.0"}}`,
  "src/api.js": `const BASE = "https://api.notes.example/v1";
async function fetchNotes() {
  const response = await fetch(\`\${BASE}/notes?limit=20\`, { headers: { accept: "application/json" } });
  return response.json();
}
async function saveNote(note) {
  const response = await fetch(BASE + "/notes", { method: "POST", body: JSON.stringify(note) });
  if (response.status === 409) throw new Error("duplicate");
  return response.json();
}
async function deleteNote(id) {
  return fetch(\`\${BASE}/notes/\${id}\`, { method: "DELETE" });
}
module.exports = { fetchNotes, saveNote, deleteNote };
`,
  "src/main.js": `const { fetchNotes, saveNote } = require("./api");
const tiny = require("tinylib");
async function start() {
  const notes = await fetchNotes();
  console.log(tiny.format(notes.length));
  await saveNote({ title: "hello", body: "world" });
}
start();
`,
  "node_modules/tinylib/index.js": "exports.format = (n) => `count=${n}`;\n",
  "node_modules/tinylib/package.json": `{"name":"tinylib","version":"1.0.0","main":"index.js"}`,
};

let realDocuments: Promise<readonly RealDocument[]> | undefined;

const produceRealDocuments = async (
  cli: TestCli,
): Promise<readonly RealDocument[]> => {
  const root = await createTestTempDirectory("rea-budget-real-");
  const app = join(root, "app");
  for (const [path, text] of Object.entries(APP)) {
    await mkdir(join(app, path, ".."), { recursive: true });
    await writeFile(join(app, path), text);
  }
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [path, text] of Object.entries(APP))
    await writer.add(path, new TextReader(text));
  await writeFile(join(root, "app.zip"), await writer.close());
  await writeFile(join(root, "capture.har"), JSON.stringify(HAR));
  await writeFile(join(root, "openapi.json"), JSON.stringify(OPENAPI));
  const bundle = join(root, "bundle.json");
  const environment = {
    HOME: join(root, "home"),
    XDG_CACHE_HOME: join(root, "home", ".cache"),
    NO_UPDATE_NOTIFIER: "1",
  };
  const runs: readonly (readonly [string, readonly string[]])[] = [
    ["analyze-javascript-application", ["analyze-javascript-application", app]],
    ["audit-release-exposure", ["audit-release-exposure", app]],
    ["inspect-artifact", ["inspect-artifact", join(root, "app.zip")]],
    [
      "inspect-artifact summary",
      [
        "inspect-artifact",
        join(root, "app.zip"),
        "--detail",
        "summary",
        "--evidence_output",
        bundle,
      ],
    ],
    [
      "inspect-artifact collision",
      [
        "inspect-artifact",
        join(root, "app.zip"),
        "--detail",
        "summary",
        "--evidence_output",
        bundle,
      ],
    ],
    ["extract-artifact", ["extract-artifact", join(root, "app.zip")]],
    [
      "inspect-web-network-capture",
      ["inspect-web-network-capture", join(root, "capture.har"), "har"],
    ],
    [
      "inspect-api-contract",
      ["inspect-api-contract", join(root, "openapi.json")],
    ],
    ["doctor", ["doctor"]],
    ["providers", ["providers"]],
    ["capabilities", ["capabilities"]],
    ["guidance", ["guidance", "--query", "javascript bundle"]],
    ["guided-workflows", ["guided-workflows"]],
    [
      "inspect-artifact missing file",
      ["inspect-artifact", join(root, "missing.zip")],
    ],
    [
      "inspect-evidence-bundle invalid",
      ["inspect-evidence-bundle", join(root, "openapi.json")],
    ],
  ];
  const documents: RealDocument[] = [];
  for (const [name, arguments_] of runs) {
    const result = await cli.run({
      arguments: [...arguments_, "--json"],
      cwd: root,
      environment,
    });
    documents.push({
      name,
      command: arguments_[0]!,
      stdout: result.stdout,
      exitCode: result.exitCode ?? -1,
    });
  }
  return documents;
};

const real = (cli: TestCli): Promise<readonly RealDocument[]> =>
  (realDocuments ??= produceRealDocuments(cli));

const isFailure = (document: unknown): document is Record<string, unknown> =>
  isRecord(document) &&
  typeof document.code === "string" &&
  isRecord(document.remediation);

const storeFor = async (): Promise<SavedOutputStoreOptions> => {
  const root = await createTestTempDirectory("rea-budget-store-");
  return {
    environment: { REA_SAVED_OUTPUT_DIR: join(root, "store") },
    platform: process.platform,
    cwd: join(root, "work"),
    home: undefined,
    tmpdir: root,
    getuid: process.getuid?.bind(process),
  };
};

const active = (bytes: number): OutputBudgetPolicy => {
  const resolved = resolveOutputBudget({
    flag: String(bytes),
    environment: {},
    stdoutKind: "other",
  });
  if (!resolved.ok) throw new Error(resolved.error.message);
  return resolved.value;
};

// ---------------------------------------------------------------------------

cliTest(
  "real documents: digest within the budget, saved bytes are today's bytes, and the 6.1 and 6.2 rules",
  { timeout: 240_000 },
  async ({ cli }) => {
    const documents = await real(cli);
    const results = documents.filter(
      (entry) => !isFailure(JSON.parse(entry.stdout)),
    );
    expect(results.length).toBeGreaterThanOrEqual(12);
    const store = await storeFor();
    let digests = 0;
    for (const budget of [BUDGET, MINIMUM]) {
      for (const entry of results) {
        const document: unknown = JSON.parse(entry.stdout);
        // The saved file holds exactly what --json writes to a pipe today.
        expect([...savedDocumentParts(document)].join(""), entry.name).toBe(
          entry.stdout,
        );
        const outcome = await budgetResult({
          command: entry.command,
          document,
          format: "json",
          rendered: [entry.stdout],
          policy: active(budget),
          cli: "rea",
          store,
          evidenceOutputOption: true,
        });
        if (utf8(entry.stdout) <= budget) {
          expect(outcome.kind, entry.name).toBe("as-is");
          continue;
        }
        if (outcome.kind !== "digest")
          throw new Error(`${entry.name}: ${outcome.kind}`);
        digests += 1;
        const body = outcome.digest.rea_digest;
        const text = renderDigestJson(outcome.digest);
        expect(utf8(text), entry.name).toBeLessThanOrEqual(budget);
        expect(body.budget.core_over, entry.name).toBeUndefined();
        // Expanding the saved file reproduces the document byte for byte.
        const savedBytes = await readFile(outcome.saved.file, "utf8");
        expect(savedBytes, entry.name).toBe(entry.stdout);
        expect(sha256(savedBytes)).toBe(outcome.saved.sha256);
        expect(body.saved.bytes).toBe(utf8(entry.stdout));
        // 6.1: stated plus not stated is every distinct sentence of the scopes shown.
        const briefScopes =
          body.brief !== undefined &&
          entry.command === "analyze-javascript-application"
            ? ["normalized_result.graph"]
            : [];
        expect(
          (body.limitations.stated?.length ?? 0) +
            (body.limitations.not_stated ?? 0),
          entry.name,
        ).toBe(scopeSentences(document, briefScopes));
        // 6.1: every incompleteness flag is a fact or counted.
        const flags = flagsIn(document);
        const missingFlags = flags.filter(
          (flag) => !Object.hasOwn(body.result, flag),
        );
        if (missingFlags.length > 0)
          expect(body.result_more ?? 0, entry.name).toBeGreaterThan(0);
        if (budget === BUDGET)
          expect(
            missingFlags.slice(0, 12 - Math.min(12, flags.length)),
            entry.name,
          ).toEqual([]);
        // 6.2: target text only as values; printed paths are addressable.
        for (const key of Object.keys(body.result))
          expect(key, entry.name).toMatch(PRINTABLE_PATH);
        for (const row of body.omitted)
          expect(String(row.path), entry.name).toMatch(PRINTABLE_PATH);
        expect(body.untrusted_content, entry.name).toEqual(
          targetText(entry.command),
        );
        if (entry.command === "doctor" || entry.command === "providers")
          expect(body.untrusted_content).toBeUndefined();
        if (entry.command === "analyze-javascript-application")
          expect(body.untrusted_content).toBe(true);
        expect(Object.keys(outcome.digest)).toEqual(["rea_digest"]);
      }
    }
    expect(digests).toBeGreaterThanOrEqual(12);
  },
);

cliTest(
  "real documents: printed commands lead to content and never repeat (P1 to P4)",
  { timeout: 240_000 },
  async ({ cli }) => {
    const documents = await real(cli);
    let followed = 0;
    for (const budget of [BUDGET, MINIMUM])
      for (const entry of documents) {
        const document: unknown = JSON.parse(entry.stdout);
        if (isFailure(document) || utf8(entry.stdout) <= budget) continue;
        const saved = savedOf(entry.command, document);
        const first = digestFor(saved, budget).rea_digest;
        // P1: the digest of a whole document never prints the reader without a selection.
        expect(first.next).not.toContain(saved.reader);
        const report = follow(saved, first, budget, 3);
        expect(report.problems, `${entry.name} at ${String(budget)}`).toEqual(
          [],
        );
        followed += report.commands;
      }
    expect(followed).toBeGreaterThan(40);
  },
);

cliTest(
  "real documents: the fit order removes items in the contract's order",
  { timeout: 240_000 },
  async ({ cli }) => {
    const documents = await real(cli);
    let observed = {
      briefDropped: 0,
      factsDropped: 0,
      statedDropped: 0,
      completeDropped: 0,
    };
    for (const entry of documents) {
      const document: unknown = JSON.parse(entry.stdout);
      if (isFailure(document) || utf8(entry.stdout) <= MINIMUM) continue;
      const saved = savedOf(entry.command, document);
      const roomy = digestFor(saved, 200_000).rea_digest;
      for (let budget = 6000; budget >= MINIMUM; budget -= 97) {
        const body = digestFor(saved, budget).rea_digest;
        const label = `${entry.name} at ${String(budget)}`;
        const hasBrief = body.brief !== undefined;
        const roomyFacts = Object.keys(roomy.result);
        const dropped = roomyFacts.filter(
          (key) => !Object.hasOwn(body.result, key),
        );
        const statedLost =
          (roomy.limitations.stated?.length ?? 0) >
          (body.limitations.stated?.length ?? 0);
        // Step 1 before step 2: a brief list is shortened or the brief dropped only when one omitted row is left.
        if (roomy.brief !== undefined && !hasBrief) {
          observed.briefDropped += 1;
          // Either the rows went first, or even the smallest brief beside one row is over the budget.
          if (body.omitted.length > 1) {
            const smallest: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(roomy.brief))
              smallest[key] = Array.isArray(value) ? value.slice(0, 1) : value;
            // A shown brief brings its scope's sentences and its own command.
            const candidate = {
              ...body,
              omitted: body.omitted.slice(0, 1),
              brief: smallest,
              limitations: roomy.limitations,
              next: roomy.next,
            };
            expect(
              utf8(renderDigestJson({ rea_digest: candidate })),
              label,
            ).toBeGreaterThan(budget);
          }
        }
        // Step 2 before step 3: a fact goes only after the brief is gone.
        if (dropped.length > 0) {
          observed.factsDropped += 1;
          expect(hasBrief, label).toBe(false);
          expect(body.omitted.length, label).toBeLessThanOrEqual(1);
        }
        // Handles are never dropped.
        for (const handle of [
          "evidence_id",
          "operation",
          "summary.evidence_id",
        ])
          if (Object.hasOwn(roomy.result, handle))
            expect(Object.hasOwn(body.result, handle), label).toBe(true);
        // Step 3 before step 4: a sentence goes only when no unprotected fact is left to drop.
        if (statedLost) {
          observed.statedDropped += 1;
          expect(hasBrief, label).toBe(false);
          expect(body.next.length, label).toBeGreaterThanOrEqual(1);
        }
        // Step 7 last: the complete line goes only when next is down to one and nothing is stated.
        if (body.complete === undefined) {
          observed.completeDropped += 1;
          expect(body.next.length, label).toBe(1);
          expect(body.limitations.stated ?? [], label).toEqual([]);
        }
        expect(
          utf8(renderDigestJson({ rea_digest: body })),
          label,
        ).toBeLessThanOrEqual(budget);
      }
    }
    // The order was exercised, not only vacuously true.
    expect(observed.briefDropped).toBeGreaterThan(0);
    expect(observed.factsDropped).toBeGreaterThan(0);
  },
);

cliTest(
  "real failures: bounded, same keys, remediation.action kept, partial Evidence saved",
  { timeout: 240_000 },
  async ({ cli }) => {
    const documents = await real(cli);
    const failures = documents.filter((entry) =>
      isFailure(JSON.parse(entry.stdout)),
    );
    expect(failures.map((entry) => entry.name).sort()).toEqual([
      "inspect-artifact collision",
      "inspect-artifact missing file",
      "inspect-evidence-bundle invalid",
    ]);
    const store = await storeFor();
    for (const entry of failures) {
      const error = JSON.parse(entry.stdout) as Record<string, unknown>;
      const outcome = await budgetError({
        command: entry.command,
        error,
        policy: active(BUDGET),
        cli: "node /opt/rea/scripts/rea.mjs",
        store,
      });
      if (outcome.kind !== "bounded") throw new Error(outcome.kind);
      const bounded = outcome.document;
      expect(
        utf8(`${JSON.stringify(bounded)}\n`),
        entry.name,
      ).toBeLessThanOrEqual(1500);
      expect(bounded.bounded).toBe(1);
      expect(bounded.code).toBe(error.code);
      expect(bounded.message).toBe(error.message);
      // No key of the projection is removed.
      for (const key of Object.keys(error))
        expect(Object.hasOwn(bounded, key), `${entry.name} ${key}`).toBe(true);
      expect(
        isRecord(bounded.remediation) &&
          typeof bounded.remediation.action === "string",
      ).toBe(true);
      const recovery = error.recovery;
      if (isRecord(recovery) && recovery.kind === "inspect_input_contract")
        expect((bounded.remediation as Record<string, unknown>).action).toBe(
          `Run 'node /opt/rea/scripts/rea.mjs ${entry.command} --help', correct the listed fields, then retry.`,
        );
      else expect(bounded.remediation).toEqual(error.remediation);
      const details = isRecord(error.details) ? error.details : {};
      if (isRecord(details.partial_observation)) {
        const reference = (bounded.details as Record<string, unknown>)
          .partial_observation as Record<string, unknown>;
        expect(reference).toMatchObject({
          kind: "saved-evidence",
          evidence_id: details.partial_observation.evidence_id,
        });
        const savedText = await readFile(String(reference.file), "utf8");
        expect(JSON.parse(savedText)).toEqual(details.partial_observation);
        expect(sha256(savedText)).toBe(reference.sha256);
        expect(
          (bounded.details as Record<string, unknown>).source_closure,
        ).not.toHaveProperty("recovery");
        expect(bounded.next).toEqual([
          `node /opt/rea/scripts/rea.mjs saved-output show ${String(reference.sha256).slice(0, 12)}`,
        ]);
        expect(utf8(entry.stdout)).toBeGreaterThan(6000);
      }
    }
    // With the budget off the error is printed as today.
    expect(
      await budgetError({
        command: "inspect-artifact",
        error: JSON.parse(failures[0]!.stdout) as Record<string, unknown>,
        policy: OUTPUT_BUDGET_OFF,
        cli: "rea",
        store,
      }),
    ).toEqual({ kind: "as-is" });
  },
);

// ---------------------------------------------------------------------------
// Synthetic shapes the real documents lack (contract-scripts/follow-shapes.mjs).

const lines = (
  n: number,
  line = "the quick brown fox jumps over the lazy dog",
): string =>
  Array.from({ length: n }, (_, index) => `${String(index)} ${line}`).join(
    "\n",
  );
const rowsOf = <T>(n: number, make: (index: number) => T): T[] =>
  Array.from({ length: n }, (_, index) => make(index));

const SHAPES: Readonly<Record<string, unknown>> = {
  "wide object of scalars": Object.fromEntries(
    rowsOf(1500, (index) => [`key_${String(index)}`, index * 7]),
  ),
  "one giant string": { stdout: lines(4000) },
  "one giant line": { blob: "A".repeat(40000) },
  "single row in single row": {
    a: [
      {
        b: [
          {
            c: rowsOf(300, (index) => ({
              id: index,
              name: `row ${String(index)}`,
              note: "x".repeat(40),
            })),
          },
        ],
      },
    ],
  },
  "fat rows": {
    items: rowsOf(5, (index) => ({
      id: index,
      parts: rowsOf(120, (j) => ({ j, v: "y".repeat(60) })),
      text: lines(200),
    })),
  },
  "array of arrays": { grid: rowsOf(40, (i) => rowsOf(40, (j) => i * j)) },
  "array of long strings": { lines: rowsOf(30, () => lines(60)) },
  "root array": rowsOf(400, (index) => ({
    id: index,
    label: `label ${String(index)}`,
    pad: "z".repeat(30),
  })),
  "keys that cannot be written": {
    "by path": Object.fromEntries(
      rowsOf(200, (index) => [
        `/api/v1/item.${String(index)}`,
        { hits: index, note: "n".repeat(40) },
      ]),
    ),
  },
  "deep nesting": (() => {
    let node: Record<string, unknown> = {
      leaf: rowsOf(200, (index) => ({ index, s: "q".repeat(50) })),
    };
    for (let depth = 0; depth < 9; depth += 1)
      node = { [`level_${String(depth)}`]: node, pad: depth };
    return node;
  })(),
  "one row, one huge scalar field": {
    records: [{ id: 1, payload: "B".repeat(30000), meta: { a: 1 } }],
  },
  "many small collections": Object.fromEntries(
    rowsOf(40, (i) => [
      `list_${String(i)}`,
      rowsOf(30, (j) => ({ j, s: "w".repeat(20) })),
    ]),
  ),
  "mixed evidence": {
    evidence_id: `ev_${"a".repeat(64)}`,
    operation: "x",
    limitations: ["Static only."],
    normalized_result: {
      coverage: { status: "partial", truncated: true },
      limitations: ["Bounded."],
      findings: rowsOf(90, (index) => ({ id: index, detail: lines(3) })),
      stdout: lines(900),
    },
  },
};

it("synthetic shapes: every path ends in content, without repeats or replies over the budget", () => {
  expect(Object.keys(SHAPES)).toHaveLength(13);
  for (const budget of [BUDGET, MINIMUM])
    for (const [name, document] of Object.entries(SHAPES)) {
      const saved = savedOf("synthetic", document);
      const first = digestFor(saved, budget);
      expect(utf8(renderDigestJson(first)), name).toBeLessThanOrEqual(budget);
      const report = follow(saved, first.rea_digest, budget, 12);
      expect(report.problems, `${name} at ${String(budget)}`).toEqual([]);
    }
});

it("pages are counted on the rows themselves, not on an average", () => {
  const document = {
    items: [
      ...rowsOf(3, (index) => ({ id: index, blob: "L".repeat(1500) })),
      ...rowsOf(200, (index) => ({ id: index })),
    ],
  };
  const saved = savedOf("synthetic", document);
  const body = digestFor(saved, BUDGET).rea_digest;
  const row = body.omitted.find((entry) => entry.path === "items");
  // 70% of 6,000 B holds two of the 1.5 KB rows; an average row is about 30 B and would claim 50.
  expect(row).toMatchObject({ rows: 203, page: 2 });
  expect(body.next).toContain(`${saved.reader} --filter-output 'items[0,2]'`);
  const reply = read(
    saved,
    `${saved.reader} --filter-output 'items[0,2]'`,
    BUDGET,
  );
  expect(reply.kind).toBe("content");
});

it("a digest of a selection keeps absolute paths and never offers the selection again", () => {
  const document = {
    a: { rows: rowsOf(300, (index) => ({ id: index, pad: "p".repeat(60) })) },
  };
  const saved = savedOf("synthetic", document);
  const body = digestFor(saved, BUDGET, "a.rows").rea_digest;
  expect(body.filter).toBe("a.rows");
  expect(body.omitted[0]).toMatchObject({
    path: "a.rows",
    from: 0,
    of_rows: 300,
  });
  expect(body.next).not.toContain(`${saved.reader} --filter-output a.rows`);
  for (const command of body.next) expect(command).toContain("a.rows[");
});

it("property: any document's digest fits the budget and its saved bytes expand to the document", () => {
  fc.assert(
    fc.property(
      fc.jsonValue({ maxDepth: 6 }),
      fc.integer({ min: MINIMUM, max: 9000 }),
      (value, budget) => {
        const document = { payload: value, filler: "f".repeat(budget) };
        const saved = savedOf("synthetic", document);
        expect(JSON.parse(saved.text)).toEqual(
          JSON.parse(JSON.stringify(document)),
        );
        expect(saved.text).toBe(`${JSON.stringify(document)}\n`);
        const digest = digestFor(saved, budget);
        expect(utf8(renderDigestJson(digest))).toBeLessThanOrEqual(budget);
        expect(digest.rea_digest.next.length).toBeGreaterThanOrEqual(1);
      },
    ),
    { numRuns: 150 },
  );
});

it("a brief is offered for every command the contract names and stays within its room", () => {
  expect([...BRIEF_COMMANDS].sort()).toEqual(
    [
      "analyze",
      "analyze-javascript-application",
      "capabilities",
      "capture-browser-scenario",
      "compare-web-captures",
      "debug-with-gdb",
      "doctor",
      "evaluate-clone-run",
      "inspect-artifact",
      "inspect-evidence-bundle",
      "inspect-web-page",
      "inspect-with-objdump",
      "providers",
      "setup",
    ].sort(),
  );
  // The referee's worklist: whole items in order, continued by the first printed command.
  const items = rowsOf(10, (index) => ({
    role: "builder",
    reason: "mismatch",
    file: `behavior/scenario-${String(index)}.md`,
    command: `rea capture-browser-scenario scenarios/s${String(index)}.json --evidence_output e${String(index)}.json`,
    message: `Item ${String(index)}: ${"the clone answers differently; ".repeat(10)}After a context reset, re-read the role card first.`,
  }));
  const saved = savedOf("evaluate-clone-run", {
    schema: "verdict/v1",
    verdict: "not_done",
    checks: { scenarios: 10 },
    next: items,
  });
  const body = digestFor(saved, BUDGET).rea_digest;
  const worklist = (body.brief?.worklist ?? []) as unknown[];
  expect(worklist.length).toBeGreaterThan(0);
  expect(worklist).toEqual(items.slice(0, worklist.length));
  expect(Number(body.brief?.worklist_more ?? 0) + worklist.length).toBe(10);
  expect(body.untrusted_content).toEqual(["brief.worklist.message"]);
  const collected = [...worklist];
  let command: string | undefined = body.next[0];
  for (
    let hop = 0;
    hop < 5 && collected.length < 10 && command !== undefined;
    hop += 1
  ) {
    const reply = read(saved, command, BUDGET);
    if (reply.kind !== "content") throw new Error(reply.text);
    const page = (JSON.parse(reply.text) as { next: unknown[] }).next;
    collected.push(...page);
    command = `${saved.reader} --filter-output 'next[${String(collected.length)},${String(Math.min(10, collected.length + page.length))}]'`;
  }
  expect(collected).toEqual(items);
});

// ---------------------------------------------------------------------------
// Policy, minimum budget, counted tokens, text window, selection.

it("resolves the budget in the contract's precedence, with the agent-marker tie-breaker", () => {
  const resolve = (input: Parameters<typeof resolveOutputBudget>[0]) => {
    const result = resolveOutputBudget(input);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  expect(
    resolve({
      flag: "off",
      environment: { REA_OUTPUT_BUDGET: "9000" },
      stdoutKind: "other",
    }).active,
  ).toBe(false);
  expect(
    resolve({
      flag: "3000",
      environment: { REA_OUTPUT_BUDGET: "off" },
      stdoutKind: "file",
    }),
  ).toMatchObject({
    active: true,
    limitBytes: 3000,
    source: "--output-budget",
    unflaggedFormat: "json",
  });
  expect(
    resolve({ environment: { REA_OUTPUT_BUDGET: "6000" }, stdoutKind: "file" }),
  ).toMatchObject({
    active: true,
    limitBytes: 6000,
    source: "REA_OUTPUT_BUDGET",
  });
  expect(
    resolve({ environment: { REA_OUTPUT_BUDGET: "off" }, stdoutKind: "other" })
      .active,
  ).toBe(false);
  expect(resolve({ environment: {}, stdoutKind: "file" })).toEqual({
    active: false,
    stdoutKind: "file",
    unflaggedFormat: "toon",
  });
  expect(resolve({ environment: {}, stdoutKind: "capture" })).toMatchObject({
    active: true,
    limitBytes: 6000,
    source: "default",
    unflaggedFormat: "json",
  });
  expect(resolve({ environment: {}, stdoutKind: "other" })).toMatchObject({
    active: true,
    source: "default",
    unflaggedFormat: "json",
  });
  expect(resolve({ environment: {}, stdoutKind: "terminal" })).toMatchObject({
    active: true,
    source: "default",
    unflaggedFormat: "toon",
  });
  // Ruling 1: a file of its own under an agent marker keeps the budget, and says how to get every byte.
  const marked = resolve({
    environment: { CLAUDECODE: "1" },
    stdoutKind: "file",
  });
  expect(marked).toMatchObject({
    active: true,
    limitBytes: 6000,
    source: "agent-marker",
    agentMarker: "CLAUDECODE",
  });
  expect(marked.active && marked.fileNotice).toContain("--output-budget off");
  expect(
    resolve({ environment: { REA_AGENT: "" }, stdoutKind: "file" }).active,
  ).toBe(false);
  expect(
    resolve({
      environment: { REA_AGENT: "x", REA_OUTPUT_BUDGET: "off" },
      stdoutKind: "file",
    }).active,
  ).toBe(false);
  // --token-limit replaces the limit while the budget is on.
  expect(
    resolve({ environment: {}, stdoutKind: "other", tokenLimit: 2000 }),
  ).toMatchObject({
    limitBytes: 2600,
    tokenLimit: 2000,
    source: "--token-limit",
  });
  expect(
    resolve({
      flag: "2048",
      environment: {},
      stdoutKind: "other",
      tokenLimit: 2000,
    }),
  ).toMatchObject({ limitBytes: 2048, tokenLimit: 2000, bytesLimited: true });
  expect(
    resolve({
      environment: {},
      stdoutKind: "other",
      tokenLimit: 500,
      tokenOffset: 0,
    }),
  ).toMatchObject({ limitBytes: 6000, source: "default" });
  // Invalid values and the minimum.
  for (const flag of ["2047", "1024", "-1", "6e3", "OFF", ""])
    expect(
      resolveOutputBudget({ flag, environment: {}, stdoutKind: "other" }),
    ).toMatchObject({ ok: false, error: { kind: "invalid-flag" } });
  expect(
    resolveOutputBudget({
      environment: { REA_OUTPUT_BUDGET: "big" },
      stdoutKind: "other",
    }),
  ).toMatchObject({ ok: false, error: { kind: "invalid-environment" } });
  expect(
    resolve({ flag: "2048", environment: {}, stdoutKind: "other" }),
  ).toMatchObject({ limitBytes: 2048 });
  expect(MINIMUM_TOKEN_LIMIT).toBe(1576);
  expect(
    resolveOutputBudget({
      environment: {},
      stdoutKind: "other",
      tokenLimit: 1575,
    }),
  ).toMatchObject({ ok: false, error: { kind: "token-limit" } });
  expect(
    resolve({ environment: {}, stdoutKind: "other", tokenLimit: 1576 }),
  ).toMatchObject({ limitBytes: 2048 });
});

it("names only the ways to every byte that work for the call", () => {
  const saved = savedOf("synthetic", SHAPES["root array"]);
  const withSource = (
    source: "default" | "REA_OUTPUT_BUDGET" | "agent-marker",
  ) =>
    buildDigest({
      command: "synthetic",
      document: saved.document,
      resultBytes: utf8(saved.text),
      format: "json",
      limit: { bytes: BUDGET, source },
      saved: { file: "/s/x.json", bytes: 1, sha256: saved.sha256 },
      reader: saved.reader,
      evidenceOutputOption: false,
    }).rea_digest.complete;
  expect(withSource("default")).toBe(
    "Every byte: redirect stdout to a file, or pass --output-budget off.",
  );
  expect(withSource("REA_OUTPUT_BUDGET")).toBe(
    "Every byte: pass --output-budget off.",
  );
  expect(withSource("agent-marker")).not.toContain("redirect");
});

it("spells printed commands the way the process was started", () => {
  const identity = { name: "rea-agents", version: "6.10.1" };
  expect(selfCommand(undefined, {}, "linux", identity)).toBe("rea");
  expect(
    selfCommand(
      { execPath: "/usr/bin/node", script: "/x/rea" },
      { npm_command: "exec" },
      "linux",
      identity,
    ),
  ).toBe("npx -y rea-agents@6.10.1");
  expect(
    selfCommand(
      { execPath: "/usr/bin/node", script: "/usr/local/bin/rea" },
      { PATH: "/usr/bin:/usr/local/bin" },
      "linux",
      identity,
    ),
  ).toBe("rea");
  expect(
    selfCommand(
      { execPath: "/usr/bin/node", script: "/work/my repo/scripts/rea.mjs" },
      { PATH: "/usr/bin" },
      "linux",
      identity,
    ),
  ).toBe("/usr/bin/node '/work/my repo/scripts/rea.mjs'");
});

it("counts tokens as an upper bound and windows text without gaps, overlaps or split code points", () => {
  expect(countedTokens("a".repeat(13))).toBe(10);
  expect(countedTokens("é")).toBe(2);
  const text = `${"ascii words and numbers 12345 ".repeat(50)}${"한국어 텍스트 😀 ".repeat(40)}${'{"k":"v"}'.repeat(30)}`;
  const total = countedTokens(text);
  let joined = "";
  let offset = 0;
  for (let guard = 0; guard < 1000 && offset < total; guard += 1) {
    const window = countedTokenWindowWithin(text, offset, 50);
    expect(countedTokens(window.text)).toBeLessThanOrEqual(50);
    expect(window.text).not.toMatch(/�/u);
    joined += window.text;
    expect(window.end).toBeGreaterThan(offset);
    offset = window.end;
  }
  expect(joined).toBe(text);
  expect(countedTokenWindow(text, 0, undefined)).toMatchObject({
    text,
    truncated: false,
    end: total,
  });
});

it("reads text in windows of whole lines that name the next offset", () => {
  const value = lines(2000);
  let offset = 0;
  let joined = "";
  for (let guard = 0; guard < 500; guard += 1) {
    const window = textWindow(
      value,
      "normalized_result.stdout",
      offset,
      BUDGET,
    );
    expect(utf8(window.text)).toBeLessThanOrEqual(BUDGET);
    const [body, notice] = [
      window.text.slice(0, window.text.lastIndexOf("[text ")),
      window.text.slice(window.text.lastIndexOf("[text ")),
    ];
    expect(notice).toContain("to search it all: add --output-budget off");
    joined += body;
    if (window.complete) break;
    expect(notice).toContain(`next: --offset ${String(window.end)}`);
    offset = window.end;
  }
  expect(joined).toBe(`${value}\n`);
  expect(textWindow(value, "x", 0, undefined).text).toBe(`${value}\n`);
  expect(textWindow({ a: 1 }, ".", 0, BUDGET).text).toBe(`{\n  "a": 1\n}\n`);
});

it("refuses a filter that matched nothing and says where it stopped", () => {
  const document = {
    normalized_result: { graph: { nodes: [{ id: 1 }, { id: 2 }] } },
    other: 1,
  };
  const message = (expression: string) =>
    unmatchedFilterMessage(resolveTargets(document, paths(expression)));
  expect(message("normalized_result.grpah")).toBe(
    "--filter-output matched nothing: normalized_result.grpah stops at normalized_result. Keys there: graph.",
  );
  expect(message("nope")).toBe(
    "--filter-output matched nothing: nope stops at the top level. Keys there: normalized_result, other.",
  );
  expect(message("normalized_result.graph.nodes.id")).toBe(
    "--filter-output matched nothing: normalized_result.graph.nodes.id stops at normalized_result.graph.nodes. There: an array of 2 rows; select rows with [start,end].",
  );
  expect(message("normalized_result.graph.nodes[5,9]")).toContain(
    "an array of 2 rows",
  );
  expect(message("nope,other")).toBeUndefined();
  expect(message("normalized_result.graph.nodes[0,1].id")).toBeUndefined();
});

it("with the budget off, or a result within it, says print as is and saves nothing", async () => {
  const store = await storeFor();
  const document = SHAPES["root array"];
  const rendered = [`${JSON.stringify(document)}\n`];
  expect(
    await budgetResult({
      command: "x",
      document,
      format: "json",
      rendered,
      policy: OUTPUT_BUDGET_OFF,
      cli: "rea",
      store,
    }),
  ).toEqual({ kind: "as-is" });
  expect(
    await budgetResult({
      command: "x",
      document: { a: 1 },
      format: "json",
      rendered: ['{"a":1}\n'],
      policy: active(BUDGET),
      cli: "rea",
      store,
    }),
  ).toEqual({ kind: "as-is" });
  const unsaved = await budgetResult({
    command: "x",
    document,
    format: "json",
    rendered,
    policy: active(BUDGET),
    cli: "rea",
    store: { ...store, environment: { REA_SAVED_OUTPUT_DIR: "relative/dir" } },
  });
  expect(unsaved.kind).toBe("not-saved");
  if (unsaved.kind === "not-saved")
    expect(unsaved.notice).toMatch(
      /^rea: answer budget not applied: cannot save to .*The complete result follows\.$/u,
    );
});
