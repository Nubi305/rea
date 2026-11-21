/**
 * The answer budget's surface for the CLI result writer (package A2 calls
 * these; nothing below reads the process or its streams):
 *
 * - {@link budgetResult}: a rendered result plus the policy gives either
 *   "print as is" or a digest whose complete document is already saved.
 * - {@link budgetError}: a failure projection gives either "print as is" or
 *   the bounded error.
 * - {@link savedReader}: the command prefix that reads a saved document.
 */
import { jsonParts } from "../../domain/jsonSerialization.js";
import { ERROR_BUDGET_BYTES } from "../../domain/outputBudget.js";
import type { OutputFilterPath } from "../outputFilter.js";
import { boundError } from "./boundedError.js";
import { digestBrief } from "./briefs.js";
import {
  buildDigest,
  type DigestDocument,
  type DigestSaved,
} from "./digest.js";
import { shellWord, targetText, type OutputBudgetPolicy } from "./policy.js";
import {
  aboutOf,
  fileReference,
  saveDocument,
  type SavedOutputStoreOptions,
  type SavedReference,
  type StoreFailure,
} from "./store.js";
import { countedTokenCounter } from "./tokenBound.js";

/** Bytes of the complete document as the saved file holds it: compact JSON, one newline. */
export function* savedDocumentParts(document: unknown): Generator<string> {
  yield* jsonParts(document);
  yield "\n";
}

/** The command prefix that reads a saved document, as printed. */
export const savedReader = (
  cli: string,
  saved:
    | { readonly kind: "store"; readonly id: string }
    | {
        readonly kind: "file";
        readonly file: string;
        readonly evidenceId?: string | undefined;
      },
): string =>
  saved.kind === "store"
    ? `${cli} saved-output show ${saved.id}`
    : `${cli} saved-output show ${shellWord(saved.file)}${saved.evidenceId === undefined ? "" : ` --evidence-id ${shellWord(saved.evidenceId)}`}`;

/** The stderr line when the budget could not be applied (contract 4 step 7). */
export const notSavedNotice = (failure: StoreFailure): string =>
  `rea: answer budget not applied: cannot save to ${failure.directory ?? "any store directory"} (${failure.code}). The complete result follows.`;

/** A document that is already saved, so a digest of it saves nothing (`saved-output show`). */
export interface AlreadySaved {
  readonly saved: DigestSaved;
  /** The reader prefix every printed command starts with. */
  readonly reader: string;
}

/** A record the command already published with `--detail complete --evidence_output <file>` (contract 8.2). */
export interface PublishedEvidence {
  readonly file: string;
  /** Bytes from the publication receipt. */
  readonly bytes: number;
  readonly evidenceId: string;
}

export interface BudgetResultInput {
  /** The CLI command (for `saved-output show`, the command recorded with the file). */
  readonly command: string;
  /** The complete, unfiltered document the command returned. */
  readonly document: unknown;
  /** `--filter-output`, when given and valid. */
  readonly filter?: {
    readonly expression: string;
    readonly paths: readonly OutputFilterPath[];
  };
  /** The display format (`json`, `toon`, `yaml`, `md`, `jsonl`...). */
  readonly format: string;
  /**
   * The selection as the writer would write it (format, envelope, trailing
   * newline), produced lazily; it is read only until it passes the limit, and
   * to the end when it does (for `budget.result_bytes`).
   */
  readonly rendered: Iterable<string>;
  readonly policy: OutputBudgetPolicy;
  /** How a printed command spells REA ({@link selfCommand}). */
  readonly cli: string;
  readonly store: SavedOutputStoreOptions;
  /** True when the command has `--evidence_output`. */
  readonly evidenceOutputOption?: boolean;
  readonly publishedEvidence?: PublishedEvidence | undefined;
  readonly alreadySaved?: AlreadySaved | undefined;
  /** The digest as it will be written; compact JSON and a newline by default. */
  readonly render?: (digest: DigestDocument) => string;
}

export type BudgetOutcome =
  /** Print the result exactly as today. */
  | { readonly kind: "as-is" }
  /** Print `digest` in place of the result; `saved` is durable already. */
  | {
      readonly kind: "digest";
      readonly digest: DigestDocument;
      readonly saved: DigestSaved;
      /** The store file written for it, when one was. */
      readonly stored?: SavedReference;
      /** A line to write before the digest (agent marker with stdout in a file). */
      readonly fileNotice?: string;
    }
  /** Nothing could be saved: print the result as today and `notice` on stderr. */
  | {
      readonly kind: "not-saved";
      readonly failure: StoreFailure;
      readonly notice: string;
    };

/** Count rendered parts until they pass the limit, then to the end. */
const measureRendered = (
  parts: Iterable<string>,
  limitBytes: number,
  limitTokens: number | undefined,
  bytesLimited: boolean,
): { readonly over: boolean; readonly bytes: number } => {
  let bytes = 0;
  const tokens = limitTokens === undefined ? undefined : countedTokenCounter();
  for (const part of parts) {
    bytes += Buffer.byteLength(part, "utf8");
    tokens?.add(part);
  }
  const overTokens =
    tokens !== undefined &&
    limitTokens !== undefined &&
    tokens.tokens > limitTokens;
  const overBytes =
    (limitTokens === undefined || bytesLimited) && bytes > limitBytes;
  return { over: overTokens || overBytes, bytes };
};

/**
 * Decide what a result prints (contract section 4, steps 6 and 7). With the
 * budget off, or a rendering within the limit, the answer is "as is". Over the
 * limit, the complete unfiltered document is saved first (or the published
 * bundle, or the file it was read from, is named), then the digest of the
 * selection is built.
 */
export const budgetResult = async (
  input: BudgetResultInput,
): Promise<BudgetOutcome> => {
  const policy = input.policy;
  if (!policy.active) return { kind: "as-is" };
  const measured = measureRendered(
    input.rendered,
    policy.limitBytes,
    policy.tokenLimit,
    policy.bytesLimited,
  );
  if (!measured.over) return { kind: "as-is" };
  let saved: DigestSaved;
  let reader: string;
  let stored: SavedReference | undefined;
  if (input.alreadySaved !== undefined) {
    saved = input.alreadySaved.saved;
    reader = input.alreadySaved.reader;
  } else if (input.publishedEvidence !== undefined) {
    const read = await fileReference(input.publishedEvidence.file);
    saved = {
      file: input.publishedEvidence.file,
      bytes: input.publishedEvidence.bytes,
      sha256: read.sha256,
      evidence_id: input.publishedEvidence.evidenceId,
    };
    reader = savedReader(input.cli, {
      kind: "file",
      file: input.publishedEvidence.file,
      evidenceId: input.publishedEvidence.evidenceId,
    });
  } else {
    const result = await saveDocument(
      input.store,
      () => savedDocumentParts(input.document),
      { command: input.command, about: aboutOf(input.document) },
    );
    if (!result.ok)
      return {
        kind: "not-saved",
        failure: result.error,
        notice: notSavedNotice(result.error),
      };
    stored = result.value;
    saved = {
      file: result.value.file,
      bytes: result.value.bytes,
      sha256: result.value.sha256,
    };
    reader = savedReader(input.cli, { kind: "store", id: result.value.id });
  }
  const digest = buildDigest({
    command: input.command,
    document: input.document,
    ...(input.filter === undefined ? {} : { filter: input.filter }),
    resultBytes: measured.bytes,
    format: input.format,
    limit: {
      bytes: policy.limitBytes,
      ...(policy.tokenLimit === undefined ? {} : { tokens: policy.tokenLimit }),
      bytesLimited: policy.bytesLimited,
      source: policy.source,
    },
    saved,
    reader,
    brief: digestBrief(input.command, input.document),
    untrusted: targetText(input.command),
    evidenceOutputOption: input.evidenceOutputOption === true,
    ...(input.render === undefined ? {} : { render: input.render }),
  });
  return {
    kind: "digest",
    digest,
    saved,
    ...(stored === undefined ? {} : { stored }),
    ...(policy.fileNotice === undefined
      ? {}
      : { fileNotice: policy.fileNotice }),
  };
};

export interface BudgetErrorInput {
  readonly command: string;
  /** The failure projection the writer would print (`code`, `message`, `remediation`...). */
  readonly error: Readonly<Record<string, unknown>>;
  readonly policy: OutputBudgetPolicy;
  readonly cli: string;
  readonly store: SavedOutputStoreOptions;
  readonly render?: (document: Readonly<Record<string, unknown>>) => string;
}

export type ErrorOutcome =
  | { readonly kind: "as-is" }
  | {
      readonly kind: "bounded";
      readonly document: Readonly<Record<string, unknown>>;
      readonly saved: readonly SavedReference[];
    }
  | {
      readonly kind: "not-saved";
      readonly failure: StoreFailure;
      readonly notice: string;
    };

/**
 * Bound a failure projection (contract section 7) while the budget is active.
 * Argument failures written by `report()` are not passed here.
 */
export const budgetError = async (
  input: BudgetErrorInput,
): Promise<ErrorOutcome> => {
  if (!input.policy.active) return { kind: "as-is" };
  const result = await boundError({
    command: input.command,
    error: input.error,
    cli: input.cli,
    limitBytes: ERROR_BUDGET_BYTES,
    save: (value) =>
      saveDocument(input.store, () => savedDocumentParts(value), {
        command: input.command,
        about: aboutOf(value),
      }),
    ...(input.render === undefined ? {} : { render: input.render }),
  });
  if (!result.ok)
    return {
      kind: "not-saved",
      failure: result.error,
      notice: notSavedNotice(result.error),
    };
  return {
    kind: "bounded",
    document: result.value.document,
    saved: result.value.saved,
  };
};
