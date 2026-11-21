/**
 * The bounded error (contract section 7): the same failure projection with the
 * same keys, at most about 1,500 bytes. Partial Evidence and oversized details
 * are saved and named instead of printed. No key the projection gives is ever
 * removed: agents are told to follow `remediation.action`.
 */
import { ERROR_BUDGET_BYTES } from "../../domain/outputBudget.js";
import { err, ok, type Result } from "../../domain/result.js";
import type { SavedReference, StoreFailure } from "./store.js";

type Json = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const utf8 = (text: string): number => Buffer.byteLength(text, "utf8");

/** Marker of a bounded error, beside the projection's own keys. */
export const BOUNDED_ERROR_VERSION = 1;
const REASON_DUPLICATE_CHARACTERS = 40;
const DETAIL_STRING_BYTES = 200;
const DETAIL_ISSUES = 5;
const MESSAGE_BYTES = 400;

export interface BoundedErrorInput {
  /** The CLI command that failed. */
  readonly command: string;
  /** The failure projection the writer would print today. */
  readonly error: Json;
  /** How a printed command spells REA ({@link selfCommand}). */
  readonly cli: string;
  /** Bytes the error may take; 1,500 by default. */
  readonly limitBytes?: number;
  /** Save a value in the store (the facade passes the store and the command). */
  readonly save: (
    value: unknown,
  ) => Promise<Result<SavedReference, StoreFailure>>;
  /** The error as it will be written, for measuring; compact JSON and a newline by default. */
  readonly render?: (document: Json) => string;
}

export interface BoundedError {
  /** The document to print in place of the error. */
  readonly document: Json;
  /** What was saved for it, in order. */
  readonly saved: readonly SavedReference[];
}

const cutAtCodePoint = (text: string, bytes: number): string => {
  const encoded = Buffer.from(text, "utf8");
  if (encoded.length <= bytes) return text;
  let end = bytes;
  while (end > 0 && ((encoded[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return encoded.subarray(0, end).toString("utf8");
};

/**
 * Apply edits E1 to E5 in order. When a save is needed and nothing can be
 * saved, the result is the store failure: the caller prints the error as
 * today, with the one stderr line of contract section 4 step 7.
 */
export const boundError = async (
  input: BoundedErrorInput,
): Promise<Result<BoundedError, StoreFailure>> => {
  const original = input.error;
  const limit = input.limitBytes ?? ERROR_BUDGET_BYTES;
  const render =
    input.render ?? ((document: Json) => `${JSON.stringify(document)}\n`);
  const out: Record<string, unknown> = { ...original };
  const details: Record<string, unknown> | undefined = isRecord(
    original.details,
  )
    ? { ...original.details }
    : undefined;
  const message = typeof original.message === "string" ? original.message : "";
  const next: string[] = [];
  const saved: SavedReference[] = [];
  const reader = (reference: SavedReference): string =>
    `${input.cli} saved-output show ${reference.id}`;

  // E1: the one MCP sentence becomes the CLI's own repair; nothing else touches remediation.
  if (
    isRecord(out.remediation) &&
    typeof out.remediation.action === "string" &&
    isRecord(out.recovery) &&
    out.recovery.kind === "inspect_input_contract"
  )
    out.remediation = {
      ...out.remediation,
      action: `Run '${input.cli} ${input.command} --help', correct the listed fields, then retry.`,
    };
  // E2: a long reason the message already states.
  if (
    details !== undefined &&
    typeof details.reason === "string" &&
    details.reason.length >= REASON_DUPLICATE_CHARACTERS &&
    message.includes(details.reason)
  )
    delete details.reason;
  // E3: partial Evidence is saved as its own file and named.
  if (
    details !== undefined &&
    isRecord(details.partial_observation) &&
    typeof details.partial_observation.evidence_id === "string"
  ) {
    const partial = details.partial_observation;
    const stored = await input.save(partial);
    if (!stored.ok) return err(stored.error);
    saved.push(stored.value);
    details.partial_observation = {
      kind: "saved-evidence",
      evidence_id: partial.evidence_id,
      operation:
        typeof partial.operation === "string" ? partial.operation : null,
      file: stored.value.file,
      bytes: stored.value.bytes,
      sha256: stored.value.sha256,
    };
    // It said nothing was retained; the partial Evidence now is.
    if (isRecord(details.source_closure)) {
      const { recovery: _recovery, ...closure } = details.source_closure;
      details.source_closure = closure;
    }
    next.push(reader(stored.value));
  }
  if (details !== undefined) out.details = details;
  const assembled = (): Json => ({
    ...out,
    bounded: BOUNDED_ERROR_VERSION,
    ...(next.length > 0 ? { next } : {}),
  });
  const over = (): boolean => utf8(render(assembled())) > limit;
  // E4: the complete error is saved; details keep scalars, short strings, issues and references.
  if (over()) {
    const stored = await input.save(original);
    if (!stored.ok) return err(stored.error);
    saved.push(stored.value);
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(details ?? {})) {
      if (
        key === "partial_observation" &&
        isRecord(value) &&
        value.kind === "saved-evidence"
      )
        kept[key] = value;
      else if (
        value === null ||
        typeof value === "boolean" ||
        typeof value === "number"
      )
        kept[key] = value;
      else if (typeof value === "string" && utf8(value) <= DETAIL_STRING_BYTES)
        kept[key] = value;
      else if (key === "issues" && Array.isArray(value))
        kept.issues = value
          .slice(0, DETAIL_ISSUES)
          .map((issue: unknown) =>
            isRecord(issue)
              ? { path: issue.path, reason: issue.reason }
              : issue,
          );
    }
    kept.complete_error = {
      file: stored.value.file,
      bytes: stored.value.bytes,
      sha256: stored.value.sha256,
    };
    out.details = kept;
    next.push(`${reader(stored.value)} --filter-output details`);
  }
  // E5: message and remediation.action are cut at a code point and say where the rest is.
  if (over()) {
    const cut = (text: string): string => {
      const shortened = cutAtCodePoint(text, MESSAGE_BYTES);
      return shortened === text
        ? text
        : `${shortened}… (cut; complete text: details.complete_error.file)`;
    };
    out.message = cut(message);
    if (isRecord(out.remediation) && typeof out.remediation.action === "string")
      out.remediation = {
        ...out.remediation,
        action:
          out.remediation.action === message
            ? out.message
            : cut(out.remediation.action),
      };
  }
  return ok({ document: assembled(), saved });
};
