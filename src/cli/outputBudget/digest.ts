/**
 * The digest (contract section 5): what replaces a result over the answer
 * budget. Answer first: the facts the command found and its brief, then the
 * shape of what was left out, the limitation count, the saved file, and at
 * most three commands that read the saved file and work as printed.
 *
 * Pure: no I/O, deterministic. The caller saves the document first and passes
 * the reference; `render` measures the digest as it will be written.
 */
import { createHash } from "node:crypto";

import type { OutputFilterPath } from "../outputFilter.js";
import { cutText, type Brief, type BriefBuilder } from "./briefs.js";
import { shellWord, type OutputBudgetSource } from "./policy.js";
import {
  isRange,
  joinPath,
  resolveTargets,
  type SelectionTarget,
} from "./selection.js";
import { COUNTED_TOKENS_RULE, countedTokens } from "./tokenBound.js";

export const DIGEST_VERSION = 1;
/** Bytes of limitation sentences a digest states at most. */
const LIMITATION_ALLOWANCE_BYTES = 2500;
const MAX_RESULT_FACTS = 16;
const MAX_OMITTED_ROWS = 6;
const MAX_FACT_STRING_BYTES = 80;
const TEXT_ROW_BYTES = 500;
const SMALL_LIST_BYTES = 200;
/** A page, or a whole part offered unsliced, fits this share of the budget. */
const PAGE_SHARE = 0.7;
const MAX_PAGE_ROWS = 50;
const MAX_COVERAGE_FACTS = 8;
const MAX_INCOMPLETE_FLAGS = 12;
const FACT_DEPTH = 4;
const PART_DEPTH = 6;
const FLAG_DEPTH = 8;
const FLAG_ROWS = 50;

/** Evidence envelope keys at the root: provenance, never the answer. */
const ENVELOPE = new Set([
  "evidence_format",
  "subject",
  "provider",
  "analysis_profile",
  "predicate_type",
  "parameters",
  "raw_result",
  "environment",
  "relationship_coverage",
  "locations",
  "evidence_links",
  "caller_input_path",
  "caller_input_paths",
  "limitations",
]);
const OPAQUE_ID = /^(?:[a-z][a-z0-9]{1,7}_)?[0-9a-f]{64}$/u;
const KEEP_ID_KEYS = new Set(["evidence_id", "parent_evidence_id"]);
/** A key that may be written in a printed path: target text never becomes a path. */
export const ADDRESSABLE_KEY = /^[A-Za-z0-9_-]+$/u;
/** Key names that state incompleteness; their values are always shown. */
const INCOMPLETE_KEY =
  /^(?:truncated|.*_truncated|complete|source_complete|has_more|next_offset|next_cursor|next_row_offset|omitted_count|partial)$/u;

type Json = Readonly<Record<string, unknown>>;
type Scalar = string | number | boolean;

const isRecord = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isEvidence = (document: unknown): document is Json =>
  isRecord(document) &&
  typeof document.evidence_id === "string" &&
  "normalized_result" in document;
const isWrapper = (
  document: unknown,
): document is Json & {
  readonly summary: Json;
  readonly evidence_bundle: Json;
} =>
  isRecord(document) &&
  isRecord(document.summary) &&
  isRecord(document.evidence_bundle);
const hasLimitations = (
  node: unknown,
): node is Json & { readonly limitations: readonly unknown[] } =>
  isRecord(node) &&
  Array.isArray(node.limitations) &&
  node.limitations.length > 0;
const utf8 = (text: string): number => Buffer.byteLength(text, "utf8");
const jsonBytes = (value: unknown): number =>
  utf8(JSON.stringify(value) ?? "null");
const incompleteValue = (key: string, value: unknown): boolean =>
  key === "complete" || key === "source_complete"
    ? value === false
    : key === "next_offset" ||
        key === "next_cursor" ||
        key === "next_row_offset"
      ? value !== null && value !== undefined
      : value === true || (typeof value === "number" && value > 0);

/** Serialized size of every container, measured once. */
const measure = (root: unknown): ((node: unknown) => number) => {
  const sizes = new Map<object, number>();
  const visit = (node: unknown): number => {
    if (node === null || typeof node !== "object") return jsonBytes(node);
    let total = 2;
    if (Array.isArray(node))
      node.forEach((child, index) => {
        total += visit(child) + (index > 0 ? 1 : 0);
      });
    else {
      let index = 0;
      for (const [key, child] of Object.entries(node)) {
        if (child === undefined) continue;
        total +=
          utf8(JSON.stringify(key)) + 1 + visit(child) + (index > 0 ? 1 : 0);
        index += 1;
      }
    }
    sizes.set(node, total);
    return total;
  };
  visit(root);
  return (node) =>
    node !== null && typeof node === "object"
      ? (sizes.get(node) ?? jsonBytes(node))
      : jsonBytes(node);
};

/** Bytes `--json --filter-output <path>` adds around the selected value. */
const envelopeBytes = (path: string): number => {
  let bytes = 1;
  for (const part of path.split(/(\[\d+,\d+\])/u).filter(Boolean)) {
    if (part.startsWith("[")) bytes += 2;
    else
      for (const key of part.split(".").filter(Boolean)) bytes += utf8(key) + 5;
  }
  return bytes;
};

/** Every flag that says the document itself is partial, wherever it is. */
const incompleteness = (
  targets: readonly SelectionTarget[],
): {
  readonly found: readonly (readonly [string, unknown])[];
  readonly more: number;
} => {
  const found: [string, unknown][] = [];
  let more = 0;
  const visit = (node: unknown, path: string, depth: number): void => {
    if (depth > FLAG_DEPTH) return;
    if (Array.isArray(node)) {
      node.slice(0, FLAG_ROWS).forEach((child, index) => {
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
      const here = joinPath(path, key);
      if (
        INCOMPLETE_KEY.test(key) &&
        (value === null || typeof value !== "object") &&
        incompleteValue(key, value)
      ) {
        if (found.length < MAX_INCOMPLETE_FLAGS) found.push([here, value]);
        else more += 1;
      } else visit(value, here, depth + 1);
    }
  };
  for (const target of targets) {
    if (isRange(target))
      target.node
        .slice(target.from, Math.min(target.to, target.from + FLAG_ROWS))
        .forEach((row, index) => {
          visit(
            row,
            `${target.path}[${String(target.from + index)},${String(target.from + index + 1)}]`,
            1,
          );
        });
    else visit(target.node, target.path, 0);
  }
  return { found, more };
};

type Start = readonly [Json, string, number, boolean];

/** Scalars and counts, breadth first, in document order (contract 5.1). */
const facts = (
  starts: readonly Start[],
  flags: readonly (readonly [string, unknown])[],
  handles: readonly (readonly [string, unknown])[],
  coverage: readonly (readonly [string, unknown])[],
): { readonly shown: Record<string, unknown>; readonly more: number } => {
  const out: Record<string, unknown> = {};
  let count = 0;
  let more = 0;
  const put = (path: string, value: unknown): void => {
    if (Object.hasOwn(out, path)) return;
    if (count < MAX_RESULT_FACTS) {
      out[path] = value;
      count += 1;
    } else more += 1;
  };
  for (const [path, value] of handles) put(path, value);
  for (const [path, value] of coverage)
    if (!Object.hasOwn(out, path)) {
      out[path] = value;
      count += 1;
    }
  const queue: Start[] = [...starts];
  while (queue.length > 0) {
    const [node, path, depth, envelope] = queue.shift()!;
    const numbers = Object.entries(node).filter(
      ([, value]) => typeof value === "number",
    );
    const allZero =
      numbers.length >= 3 && numbers.every(([, value]) => value === 0);
    if (allZero && path !== "") put(path, { all_zero: numbers.length });
    for (const [key, value] of Object.entries(node)) {
      if (!ADDRESSABLE_KEY.test(key)) continue;
      if (envelope && ENVELOPE.has(key)) continue;
      if (key === "limitations" || value === null || value === undefined)
        continue;
      const here = joinPath(path, key);
      if (typeof value === "number") {
        if (!allZero) put(here, value);
      } else if (typeof value === "boolean") put(here, value);
      else if (typeof value === "string") {
        if (utf8(value) > MAX_FACT_STRING_BYTES) continue;
        if (OPAQUE_ID.test(value) && !KEEP_ID_KEYS.has(key)) continue;
        put(here, value);
      } else if (Array.isArray(value)) {
        if (
          value.length > 0 &&
          value.every((item) => item === null || typeof item !== "object") &&
          jsonBytes(value) <= SMALL_LIST_BYTES
        )
          put(here, value);
        else if (
          value.length === 1 &&
          isRecord(value[0]) &&
          depth < FACT_DEPTH &&
          !hasLimitations(value[0])
        )
          queue.push([value[0], `${here}[0,1]`, depth + 1, false]);
      } else if (isRecord(value) && depth < FACT_DEPTH) {
        // A part that states its own limitations is never quoted from.
        if (hasLimitations(value)) continue;
        queue.push([value, here, depth + 1, false]);
      }
    }
  }
  for (const [path, value] of flags)
    if (!Object.hasOwn(out, path)) out[path] = value;
  return { shown: out, more };
};

/** Scalars directly under an object keyed `coverage` or `completeness`. */
const coverageFacts = (
  starts: readonly Start[],
): readonly (readonly [string, unknown])[] => {
  const found: [string, unknown][] = [];
  const visit = (node: Json, path: string, depth: number): void => {
    if (depth > 3) return;
    for (const [key, value] of Object.entries(node)) {
      if (!ADDRESSABLE_KEY.test(key) || !isRecord(value)) continue;
      const here = joinPath(path, key);
      if (key === "coverage" || key === "completeness") {
        for (const [inner, scalar] of Object.entries(value))
          if (
            ADDRESSABLE_KEY.test(inner) &&
            found.length < MAX_COVERAGE_FACTS &&
            (typeof scalar === "boolean" ||
              typeof scalar === "number" ||
              (typeof scalar === "string" &&
                utf8(scalar) <= MAX_FACT_STRING_BYTES))
          )
            found.push([`${here}.${inner}`, scalar]);
      } else if (!hasLimitations(value)) visit(value, here, depth + 1);
    }
  };
  for (const [node, path, depth] of starts) visit(node, path, depth);
  return found;
};

/** A part that was left out, as `omitted` lists it. */
interface PartRow {
  readonly path: string;
  readonly bytes: number;
  rows?: number;
  keys?: readonly string[];
  of?: string;
  page?: number;
  text?: true;
  lines?: number;
  keys_count?: number;
  limitations?: number;
  also?: string[];
  readonly node?: unknown;
  readonly from?: number;
  readonly to?: number;
  readonly of_rows?: number;
  readonly selected?: boolean;
  readonly object?: boolean;
}

const scalarKind = (value: unknown): string =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

const covers = (path: string, other: string): boolean =>
  path === other ||
  other.startsWith(`${path}.`) ||
  other.startsWith(`${path}[`) ||
  path.startsWith(`${other}.`) ||
  path.startsWith(`${other}[`);

/** The parts of the targets that were left out (contract 5.2). */
const parts = (
  targets: readonly SelectionTarget[],
  size: (node: unknown) => number,
  fitsWhole: (bytes: number, path: string) => boolean,
): { readonly listed: PartRow[]; readonly more: number } => {
  const collections: PartRow[] = [];
  const objects: PartRow[] = [];
  let unlisted = 0;
  const text = (value: string, here: string): void => {
    const bytes = jsonBytes(value);
    if (bytes > TEXT_ROW_BYTES)
      collections.push({
        path: here,
        text: true,
        lines: value.split("\n").length,
        bytes,
        node: value,
      });
  };
  const objectRow = (value: Json, here: string): PartRow => ({
    path: here,
    keys_count: Object.keys(value).length,
    bytes: size(value),
    ...(hasLimitations(value) ? { limitations: value.limitations.length } : {}),
  });
  const array = (
    value: readonly unknown[],
    here: string,
    depth: number,
  ): void => {
    if (value.length === 0) return;
    const bytes = size(value);
    const first = value[0];
    if (value.length === 1 && !fitsWhole(bytes, here)) {
      // One row that cannot be read whole: its parts are listed instead.
      const inside = `${here}[0,1]`;
      if (isRecord(first)) {
        objects.push(objectRow(first, inside));
        if (depth < PART_DEPTH) object(first, inside, depth + 1);
      } else if (Array.isArray(first)) array(first, inside, depth + 1);
      else if (typeof first === "string") text(first, inside);
      return;
    }
    const row: PartRow = {
      path: here,
      rows: value.length,
      bytes,
      node: value,
      from: 0,
      to: value.length,
    };
    if (isRecord(first))
      row.keys = Object.keys(first)
        .filter((key) => ADDRESSABLE_KEY.test(key))
        .slice(0, 6);
    else row.of = scalarKind(first);
    if (bytes <= SMALL_LIST_BYTES && row.keys === undefined) return;
    collections.push(row);
  };
  const object = (node: Json, path: string, depth: number): void => {
    for (const [key, value] of Object.entries(node)) {
      if (value === null || value === undefined) continue;
      if (!ADDRESSABLE_KEY.test(key)) {
        if (
          typeof value === "object" ||
          (typeof value === "string" && jsonBytes(value) > TEXT_ROW_BYTES)
        )
          unlisted += 1;
        continue;
      }
      const here = joinPath(path, key);
      if (
        key === "limitations" &&
        Array.isArray(value) &&
        value.every((s) => typeof s === "string")
      )
        continue;
      if (Array.isArray(value)) array(value, here, depth);
      else if (typeof value === "string") text(value, here);
      else if (isRecord(value)) {
        objects.push(objectRow(value, here));
        if (depth < PART_DEPTH) object(value, here, depth + 1);
      }
    }
  };
  for (const target of targets) {
    if (isRange(target)) {
      const first = target.node[target.from];
      let bytes = 2;
      for (let index = target.from; index < target.to; index += 1)
        bytes += size(target.node[index]) + (index > target.from ? 1 : 0);
      collections.push({
        path: target.path,
        rows: target.to - target.from,
        bytes,
        node: target.node,
        from: target.from,
        to: target.to,
        of_rows: target.node.length,
        selected: true,
        ...(isRecord(first)
          ? {
              keys: Object.keys(first)
                .filter((key) => ADDRESSABLE_KEY.test(key))
                .slice(0, 6),
            }
          : { of: scalarKind(first) }),
      });
    } else if (isRecord(target.node)) object(target.node, target.path, 0);
    else if (Array.isArray(target.node)) array(target.node, target.path, 0);
    else if (typeof target.node === "string")
      collections.push({
        path: target.path === "" ? "." : target.path,
        text: true,
        lines: target.node.split("\n").length,
        bytes: jsonBytes(target.node),
        node: target.node,
      });
  }
  collections.sort(
    (left, right) =>
      right.bytes - left.bytes || (left.path < right.path ? -1 : 1),
  );
  // Equal collections under two names (raw_result mirrors normalized_result) are listed once.
  const seen = new Map<string, PartRow>();
  const unique: PartRow[] = [];
  for (const row of collections) {
    const key =
      row.bytes < 64 || row.selected === true
        ? undefined
        : `${String(row.bytes)}:${createHash("sha256")
            .update(JSON.stringify(row.node) ?? "")
            .digest("hex")}`;
    const prior = key === undefined ? undefined : seen.get(key);
    if (prior !== undefined) {
      (prior.also ??= []).push(row.path);
      continue;
    }
    if (key !== undefined) seen.set(key, row);
    unique.push(row);
  }
  const listed = unique.slice(0, MAX_OMITTED_ROWS);
  // Free rows: the largest objects that neither hold nor lie inside a listed collection.
  if (listed.length < MAX_OMITTED_ROWS) {
    objects.sort((left, right) => right.bytes - left.bytes);
    for (const candidate of objects) {
      if (listed.length >= MAX_OMITTED_ROWS) break;
      if (candidate.bytes <= TEXT_ROW_BYTES) continue;
      if (
        listed.some((row) =>
          [row.path, ...(row.also ?? [])].some((path) =>
            covers(candidate.path, path),
          ),
        )
      )
        continue;
      listed.push({ ...candidate, object: true });
    }
  }
  return {
    listed,
    more:
      Math.max(
        0,
        unique.length - listed.filter((row) => row.object !== true).length,
      ) + unlisted,
  };
};

interface LimitationScan {
  readonly count: number;
  readonly scoped: readonly string[];
  readonly elsewhere: number;
  readonly paths: readonly string[];
}

const valueAt = (document: unknown, path: string): unknown => {
  let node = document;
  for (const key of path.split("."))
    node = isRecord(node) ? node[key] : undefined;
  return node;
};

/** Limitation sentences (contract 6.1): each distinct sentence of the stated scopes once. */
const limitationScan = (
  document: unknown,
  targets: readonly SelectionTarget[],
  whole: boolean,
  quotedScopes: readonly string[],
): LimitationScan => {
  const scoped: string[] = [];
  const paths: string[] = [];
  const add = (list: unknown, path: string): void => {
    if (!Array.isArray(list)) return;
    let any = false;
    for (const sentence of list)
      if (typeof sentence === "string") {
        any = true;
        if (!scoped.includes(sentence)) scoped.push(sentence);
      }
    if (any && !paths.includes(path)) paths.push(path);
  };
  if (whole) {
    const base = isWrapper(document) ? document.summary : document;
    const prefix = isWrapper(document) ? "summary" : "";
    if (isRecord(base)) {
      add(base.limitations, joinPath(prefix, "limitations"));
      if (isRecord(base.normalized_result))
        add(
          base.normalized_result.limitations,
          joinPath(prefix, "normalized_result.limitations"),
        );
    }
    for (const path of quotedScopes) {
      const node = valueAt(document, path);
      if (isRecord(node)) add(node.limitations, `${path}.limitations`);
    }
  } else
    for (const target of targets)
      if (!isRange(target) && isRecord(target.node))
        add(target.node.limitations, joinPath(target.path, "limitations"));
  const all = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (isRecord(node))
      for (const [key, value] of Object.entries(node)) {
        if (key === "limitations" && Array.isArray(value)) {
          for (const sentence of value)
            if (typeof sentence === "string") all.add(sentence);
        } else walk(value);
      }
  };
  for (const target of targets)
    walk(
      isRange(target) ? target.node.slice(target.from, target.to) : target.node,
    );
  for (const sentence of scoped) all.add(sentence);
  return {
    count: all.size,
    scoped,
    elsewhere: all.size - scoped.length,
    paths,
  };
};

const firstSentences = (
  scoped: readonly string[],
  allowance: number,
): readonly string[] => {
  const shown: string[] = [];
  let used = 0;
  for (const sentence of scoped) {
    const cost = jsonBytes(sentence) + 1;
    if (used + cost > allowance) break;
    shown.push(sentence);
    used += cost;
  }
  return shown;
};

/** The file a digest names. */
export interface DigestSaved {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  /** Present when the file is an `--evidence_output` bundle that holds the record. */
  readonly evidence_id?: string;
}

/** The limit the digest must fit. */
export interface DigestLimit {
  /** Rendered bytes (with `--token-limit`, `floor(1.3 N)` or the flag's n). */
  readonly bytes: number;
  /** Counted tokens, under `--token-limit`. */
  readonly tokens?: number;
  /** True when `bytes` binds on its own (not only as the shadow of `tokens`). */
  readonly bytesLimited?: boolean;
  readonly source: OutputBudgetSource;
}

export interface DigestInput {
  /** The CLI command (for `saved-output show`, the command recorded with the file). */
  readonly command: string;
  /** The complete saved document. */
  readonly document: unknown;
  /** The `--filter-output` expression this digest describes, and its parsed paths. */
  readonly filter?: {
    readonly expression: string;
    readonly paths: readonly OutputFilterPath[];
  };
  /** Rendered bytes of the result that did not fit (`budget.result_bytes`). */
  readonly resultBytes: number;
  /** The display format (`budget.format`). */
  readonly format: string;
  readonly limit: DigestLimit;
  readonly saved: DigestSaved;
  /** The command that reads the saved file, as printed: `<cli> saved-output show <id>`. */
  readonly reader: string;
  /** The command's brief ({@link digestBrief}). */
  readonly brief?: BriefBuilder | undefined;
  /** Digest paths that may quote the target ({@link targetText}). */
  readonly untrusted?: true | readonly string[] | undefined;
  /** True when the command has `--evidence_output`. */
  readonly evidenceOutputOption?: boolean;
  /** The digest as it will be written, for measuring; compact JSON and a newline by default. */
  readonly render?: (digest: DigestDocument) => string;
}

/** The digest's one top-level key, so no field can be mistaken for a result's. */
export interface DigestDocument {
  readonly rea_digest: DigestBody;
}

export interface DigestBody {
  version: number;
  command: string;
  untrusted_content?: true | readonly string[];
  filter?: string;
  result: Record<string, unknown>;
  result_more?: number;
  brief?: Record<string, unknown>;
  omitted: Record<string, unknown>[];
  omitted_more?: number;
  limitations: {
    count: number;
    stated?: readonly string[];
    not_stated?: number;
    in_omitted_parts?: number;
  };
  saved: DigestSaved;
  budget: {
    bytes: number;
    source: OutputBudgetSource;
    result_bytes: number;
    format: string;
    tokens?: number;
    counted?: string;
    core_over?: true;
  };
  complete?: string;
  next: string[];
}

/** Compact JSON with one newline, as `--json` writes to a pipe. */
export const renderDigestJson = (digest: DigestDocument): string =>
  `${JSON.stringify(digest)}\n`;

/** The one line naming every way to every byte that works for this call. */
export const completeLine = (
  source: OutputBudgetSource,
  evidenceOutputOption: boolean,
): string =>
  source === "default"
    ? `Every byte: redirect stdout to a file, ${evidenceOutputOption ? "pass --evidence_output <file>, " : ""}or pass --output-budget off.`
    : `Every byte: pass --output-budget off${evidenceOutputOption ? ", or --evidence_output <file>" : ""}.`;

const ORDER: readonly (keyof DigestBody)[] = [
  "version",
  "command",
  "untrusted_content",
  "filter",
  "result",
  "result_more",
  "brief",
  "omitted",
  "omitted_more",
  "limitations",
  "saved",
  "budget",
  "complete",
  "next",
];

/** The body in the contract's key order, without absent keys. */
const ordered = (body: DigestBody): DigestBody => {
  const out: Record<string, unknown> = {};
  for (const key of ORDER) if (body[key] !== undefined) out[key] = body[key];
  return out as unknown as DigestBody;
};

/**
 * Build the digest of a complete document, or of the part a `--filter-output`
 * expression selects (built over the saved document, so its paths stay
 * absolute). The fit order of contract 5.4 is applied until the digest as
 * rendered is within the limit; what is left is the core, which is never cut
 * (`budget.core_over` when even it is over).
 */
export const buildDigest = (input: DigestInput): DigestDocument => {
  const limitBytes = input.limit.bytes;
  const whole = input.filter === undefined;
  const document = input.document;
  const { targets } = resolveTargets(document, input.filter?.paths);
  const size = measure(document);
  const reader = input.reader;
  const render = input.render ?? renderDigestJson;
  const pageAllowance = (path: string): number =>
    Math.floor(limitBytes * PAGE_SHARE) - envelopeBytes(path);
  const fitsWhole = (bytes: number, path: string): boolean =>
    bytes <= pageAllowance(path);

  // What the digest reads from (contract 5.1).
  const evidence = whole && isEvidence(document);
  const wrapper = whole && isWrapper(document);
  const handles: (readonly [string, unknown])[] = [];
  const starts: Start[] = [];
  if (evidence) {
    handles.push(["evidence_id", document.evidence_id]);
    if (typeof document.operation === "string")
      handles.push(["operation", document.operation]);
    if (isRecord(document.normalized_result))
      starts.push([document.normalized_result, "normalized_result", 1, false]);
  } else if (wrapper) {
    for (const [key, value] of Object.entries(document.evidence_bundle))
      if (
        ADDRESSABLE_KEY.test(key) &&
        (value === null || typeof value !== "object")
      )
        handles.push([`evidence_bundle.${key}`, value]);
    const summary = document.summary;
    if (isEvidence(summary)) {
      handles.push(["summary.evidence_id", summary.evidence_id]);
      if (isRecord(summary.normalized_result))
        starts.push([
          summary.normalized_result,
          "summary.normalized_result",
          2,
          false,
        ]);
    } else starts.push([summary, "summary", 1, false]);
  } else
    for (const target of targets)
      if (!isRange(target) && isRecord(target.node))
        starts.push([
          target.node,
          target.path,
          0,
          target.path === "" && isEvidence(target.node),
        ]);
  const flags = incompleteness(targets);
  const coverage = coverageFacts(starts);
  const { shown: result, more: factsMore } = facts(
    starts,
    flags.found,
    handles,
    coverage,
  );
  const handlePaths = new Set([
    ...handles.map(([path]) => path),
    ...Object.keys(result).filter(
      (path) =>
        path === "parent_evidence_id" || path.endsWith(".parent_evidence_id"),
    ),
  ]);
  const coveragePaths = new Set(coverage.map(([path]) => path));
  const flagPaths = new Set(flags.found.map(([path]) => path));

  const left = parts(targets, size, fitsWhole);

  // Pages and commands (contract 5.3).
  const pageRows = (
    array: readonly unknown[],
    from: number,
    to: number,
    path: string,
  ): number => {
    const allowance = pageAllowance(path);
    let used = 0;
    let rows = 0;
    for (let index = from; index < to && rows < MAX_PAGE_ROWS; index += 1) {
      const cost = size(array[index]) + (rows > 0 ? 1 : 0);
      if (used + cost > allowance) break;
      used += cost;
      rows += 1;
    }
    return Math.max(1, rows);
  };
  const pageOf = (row: PartRow, from = row.from ?? 0): number => {
    const to = row.to ?? 0;
    const span = to - from;
    let rows = pageRows(row.node as readonly unknown[], from, to, row.path);
    // Never the selection itself again: a page is always smaller than its range.
    if (row.selected === true && rows >= span)
      rows = Math.max(1, Math.floor(span / 2));
    return Math.min(rows, span);
  };
  const slice = (row: PartRow, from = row.from ?? 0): string =>
    `${row.path}[${String(from)},${String(from + pageOf(row, from))}]`;
  const commandFor = (row: PartRow): string => {
    if (row.text === true) return `${reader} --text ${shellWord(row.path)}`;
    if (row.rows !== undefined)
      return row.selected !== true && fitsWhole(row.bytes, row.path)
        ? `${reader} --filter-output ${shellWord(row.path)}`
        : `${reader} --filter-output ${shellWord(slice(row))}`;
    return `${reader} --filter-output ${shellWord(row.path)}`;
  };
  for (const row of left.listed)
    if (
      row.rows !== undefined &&
      (row.selected === true || !fitsWhole(row.bytes, row.path))
    )
      row.page = pageOf(row);
  const textFallback =
    left.listed.length === 0
      ? targets
          .filter(
            (target) =>
              !isRange(target) &&
              target.node !== null &&
              typeof target.node === "object",
          )
          .slice(0, 1)
          .map(
            (target) =>
              `${reader} --text ${shellWord(target.path === "" ? "." : target.path)}`,
          )
      : [];

  let limitations = limitationScan(document, targets, whole, []);
  const omittedView = (row: PartRow): Record<string, unknown> => {
    const out: Record<string, unknown> = { path: row.path };
    if (row.text === true) {
      out.text = true;
      out.lines = row.lines;
      out.bytes = row.bytes;
    } else if (row.rows !== undefined) {
      out.rows = row.rows;
      out.bytes = row.bytes;
      if (row.keys !== undefined) out.keys = row.keys;
      if (row.of !== undefined) out.of = row.of;
      if (row.page !== undefined) out.page = row.page;
      if (row.selected === true) {
        out.from = row.from;
        out.of_rows = row.of_rows;
      }
    } else {
      out.keys_count = row.keys_count;
      out.bytes = row.bytes;
      if (row.limitations !== undefined) out.limitations = row.limitations;
    }
    if (row.also !== undefined) out.also = row.also;
    return out;
  };
  const listed = [...left.listed];
  const body: DigestBody = {
    version: DIGEST_VERSION,
    command: input.command,
    ...(input.untrusted === undefined
      ? {}
      : { untrusted_content: input.untrusted }),
    ...(whole ? {} : { filter: input.filter.expression }),
    result,
    ...(flags.more + factsMore > 0
      ? { result_more: flags.more + factsMore }
      : {}),
    omitted: listed.map(omittedView),
    ...(left.more > 0 ? { omitted_more: left.more } : {}),
    limitations: { count: limitations.count },
    saved: {
      file: input.saved.file,
      bytes: input.saved.bytes,
      sha256: input.saved.sha256,
      ...(input.saved.evidence_id === undefined
        ? {}
        : { evidence_id: input.saved.evidence_id }),
    },
    budget: {
      bytes: limitBytes,
      source: input.limit.source,
      result_bytes: input.resultBytes,
      format: input.format,
      ...(input.limit.tokens === undefined
        ? {}
        : { tokens: input.limit.tokens, counted: COUNTED_TOKENS_RULE }),
    },
    complete: completeLine(
      input.limit.source,
      input.evidenceOutputOption === true,
    ),
    next: [],
  };
  let notStated = 0;
  const setLimitations = (shown: readonly string[], withheld: number): void => {
    notStated = withheld;
    body.limitations = {
      count: limitations.count,
      ...(shown.length > 0 ? { stated: shown } : {}),
      ...(withheld > 0 ? { not_stated: withheld } : {}),
      ...(limitations.elsewhere > 0
        ? { in_omitted_parts: limitations.elsewhere }
        : {}),
    };
  };
  const stateLimitations = (): void => {
    const shown = firstSentences(
      limitations.scoped,
      LIMITATION_ALLOWANCE_BYTES,
    );
    setLimitations(shown, limitations.scoped.length - shown.length);
  };
  stateLimitations();

  let brief: Brief | undefined;
  const current =
    input.filter === undefined
      ? undefined
      : `${reader} --filter-output ${shellWord(input.filter.expression)}`;
  const assembleNext = (): void => {
    const next: string[] = [];
    if (brief?.next !== undefined && body.brief !== undefined)
      for (const tail of brief.next(body.brief)) next.push(`${reader} ${tail}`);
    if (notStated > 0 && limitations.paths.length > 0)
      next.push(
        `${reader} --filter-output ${shellWord(limitations.paths.join(","))}`,
      );
    const shownByBrief = new Set(
      body.brief === undefined ? [] : (brief?.covers ?? []),
    );
    const rows = listed.filter(
      (row) => row.rows !== undefined && !shownByBrief.has(row.path),
    );
    const texts = listed.filter((row) => row.text === true);
    // A one-line text over the budget (an encoded payload) comes after everything else.
    const payloads = texts.filter(
      (row) => (row.lines ?? 0) <= 1 && !fitsWhole(row.bytes, row.path),
    );
    const readable = texts.filter((row) => !payloads.includes(row));
    const order = [
      rows[0],
      readable[0],
      ...listed.filter(
        (row) => !payloads.includes(row) && !shownByBrief.has(row.path),
      ),
      ...payloads,
    ].filter((row): row is PartRow => row !== undefined);
    for (const row of order) next.push(commandFor(row));
    next.push(...textFallback);
    body.next = [...new Set(next)]
      .filter((command) => command !== current)
      .slice(0, 3);
  };
  const text = (): string => render({ rea_digest: ordered(body) });
  const over = (): boolean => {
    const rendered = text();
    if (input.limit.tokens !== undefined)
      return (
        countedTokens(rendered) > input.limit.tokens ||
        (input.limit.bytesLimited === true && utf8(rendered) > limitBytes)
      );
    return utf8(rendered) > limitBytes;
  };
  assembleNext();
  if (input.brief !== undefined && whole) {
    const room = limitBytes - utf8(text()) - 96;
    const helpers = {
      room,
      cut: cutText,
      page: (path: string, from = 0): string | undefined => {
        const node = valueAt(document, path);
        if (!Array.isArray(node) || from >= node.length) return undefined;
        const row: PartRow = {
          path,
          bytes: size(node),
          node,
          from: 0,
          to: node.length,
        };
        return `${path}[${String(from)},${String(from + pageOf(row, from))}]`;
      },
    };
    brief = room > 0 ? input.brief(helpers) : undefined;
    if (brief !== undefined) {
      if (brief.scopes !== undefined && brief.scopes.length > 0) {
        limitations = limitationScan(document, targets, whole, brief.scopes);
        stateLimitations();
      }
      body.brief = brief.value;
      assembleNext();
    }
  }

  // Fit (contract 5.4): whole items only, each step from the end.
  // 1. omitted rows, down to 1
  while (over() && body.omitted.length > 1) {
    body.omitted.pop();
    listed.pop();
    body.omitted_more = (body.omitted_more ?? 0) + 1;
    assembleNext();
  }
  // 2. the brief's lists item by item down to 1, then the brief whole
  if (brief !== undefined && body.brief !== undefined) {
    for (const key of brief.lists ?? []) {
      const list = body.brief[key];
      if (!Array.isArray(list)) continue;
      while (over() && list.length > 1) {
        list.pop();
        body.brief[`${key}_more`] = Number(body.brief[`${key}_more`] ?? 0) + 1;
        assembleNext();
      }
    }
    if (over()) {
      delete body.brief;
      brief = undefined;
      // The brief's scopes no longer qualify anything shown.
      limitations = limitationScan(document, targets, whole, []);
      stateLimitations();
      assembleNext();
    }
  }
  const dropFact = (key: string): void => {
    delete body.result[key];
    body.result_more = (body.result_more ?? 0) + 1;
  };
  const lastFact = (test: (key: string) => boolean): string | undefined =>
    Object.keys(body.result).reverse().find(test);
  // 3. facts that are not protected
  while (over()) {
    const victim = lastFact(
      (key) =>
        !handlePaths.has(key) && !coveragePaths.has(key) && !flagPaths.has(key),
    );
    if (victim === undefined) break;
    dropFact(victim);
  }
  // 4. stated limitation sentences
  while (over() && (body.limitations.stated?.length ?? 0) > 0) {
    const shown = (body.limitations.stated ?? []).slice(0, -1);
    setLimitations(shown, notStated + 1);
    assembleNext();
  }
  // 5. next commands, down to 1
  while (over() && body.next.length > 1) body.next.pop();
  // 6. coverage facts, then incompleteness flags (handles stay)
  while (over()) {
    const victim =
      lastFact((key) => coveragePaths.has(key)) ??
      lastFact((key) => flagPaths.has(key) && !handlePaths.has(key));
    if (victim === undefined) break;
    dropFact(victim);
  }
  // 7. the complete line
  if (over()) delete body.complete;
  if (over()) body.budget.core_over = true;
  return { rea_digest: ordered(body) };
};
