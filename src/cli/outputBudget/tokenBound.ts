/**
 * Counted tokens: the upper count `--token-limit` and `--token-offset` use.
 *
 * REA ships no tokenizer. Every ASCII byte counts 1/1.3 token and every other
 * byte one token, rounded up over the text. Measured against a real BPE
 * tokenizer on 21 content classes (census outputs, real sentences in seven
 * non-Latin scripts, random Latin-1, emoji, Hangul, Cyrillic, rare CJK, hex,
 * base64, punctuation, random printable ASCII), the count was never below the
 * real one. It is an upper count, not a real one: typical JSON delivers about
 * 38% of the number asked for.
 */
import { MINIMUM_OUTPUT_BUDGET_BYTES } from "../../domain/outputBudget.js";

/** Fixed-point units: an ASCII byte is 10 units, any other byte 13, a token 13. */
const ASCII_UNITS = 10;
const OTHER_UNITS = 13;
const TOKEN_UNITS = 13;

/** How the count was made, as the digest and the window notice state it. */
export const COUNTED_TOKENS_RULE =
  "1 token per 1.3 ASCII bytes and per other byte";

/** Bytes a token limit stands for: `floor(1.3 × tokens)`. */
export const tokenLimitBytes = (tokens: number): number =>
  Math.floor((tokens * TOKEN_UNITS) / ASCII_UNITS);

/** The smallest `--token-limit` that still holds a digest of the minimum budget. */
export const MINIMUM_TOKEN_LIMIT = Math.ceil(
  (MINIMUM_OUTPUT_BUDGET_BYTES * ASCII_UNITS) / TOKEN_UNITS,
);

const units = (byte: number): number =>
  byte < 0x80 ? ASCII_UNITS : OTHER_UNITS;

/** Counted tokens of a text (rounded up). */
export const countedTokens = (text: string): number => {
  let total = 0;
  for (const byte of Buffer.from(text, "utf8")) total += units(byte);
  return Math.ceil(total / TOKEN_UNITS);
};

/** An incremental counter, for text produced in parts. */
export const countedTokenCounter = () => {
  let total = 0;
  return {
    add(part: string): void {
      for (const byte of Buffer.from(part, "utf8")) total += units(byte);
    },
    get tokens(): number {
      return Math.ceil(total / TOKEN_UNITS);
    },
  };
};

export interface CountedTokenWindow {
  /** The code points of the window, never a split one. */
  readonly text: string;
  /** Counted position of the window's start, as asked. */
  readonly start: number;
  /** Counted position the next window starts at. */
  readonly end: number;
  /** Counted tokens of the whole text. */
  readonly total: number;
  /** True when the window is not the whole text. */
  readonly truncated: boolean;
}

/**
 * The code points whose first byte starts at counted position `offset` up to
 * (not including) `offset + limit`, where a code point's position is the
 * whole number of tokens counted before it. Consecutive windows
 * (`offset`, `offset + limit`, ...) partition the text without gaps or
 * overlap: this is the explicit `--token-offset` window. Because a code point
 * may end past the window's last position, its text can count up to four
 * tokens more than `limit`; a caller that needs a bound uses
 * {@link countedTokenWindowWithin}. Without `limit` the window runs to the end.
 */
export const countedTokenWindow = (
  text: string,
  offset: number,
  limit: number | undefined,
): CountedTokenWindow => {
  const bytes = Buffer.from(text, "utf8");
  let totalUnits = 0;
  for (const byte of bytes) totalUnits += units(byte);
  const total = Math.ceil(totalUnits / TOKEN_UNITS);
  const start = Math.max(0, Math.floor(offset));
  const stop = limit === undefined ? Infinity : start + Math.max(0, limit);
  let used = 0;
  let from = bytes.length;
  let to = bytes.length;
  let index = 0;
  while (index < bytes.length) {
    const position = Math.floor(used / TOKEN_UNITS);
    let width = 1;
    while (
      index + width < bytes.length &&
      ((bytes[index + width] ?? 0) & 0xc0) === 0x80
    )
      width += 1;
    if (position >= start && from === bytes.length) from = index;
    if (position >= stop) {
      to = index;
      break;
    }
    for (let k = 0; k < width; k += 1) used += units(bytes[index + k] ?? 0);
    index += width;
  }
  if (from > to) from = to;
  return {
    text: bytes.subarray(from, to).toString("utf8"),
    start,
    end: to < bytes.length ? stop : Math.max(total, start),
    total,
    truncated: from > 0 || to < bytes.length,
  };
};

/**
 * A window from counted position `offset` whose text counts at most `limit`
 * tokens. It uses the positions of {@link countedTokenWindow} and ends on a
 * position boundary: every code point whose position equals the window's end
 * belongs to the next window, so consecutive windows (`offset`, then each
 * window's `end`) partition the text. A window always holds at least the code
 * points of its first position.
 */
export const countedTokenWindowWithin = (
  text: string,
  offset: number,
  limit: number,
): CountedTokenWindow => {
  const bytes = Buffer.from(text, "utf8");
  let totalUnits = 0;
  for (const byte of bytes) totalUnits += units(byte);
  const total = Math.ceil(totalUnits / TOKEN_UNITS);
  const start = Math.max(0, Math.floor(offset));
  const budget = Math.max(1, limit) * TOKEN_UNITS;
  let used = 0;
  let index = 0;
  let from = -1;
  let fromUnits = 0;
  // Index and position of the first code point of each position seen in the window.
  let positionStart = -1;
  let positionStartIndex = -1;
  while (index < bytes.length) {
    const position = Math.floor(used / TOKEN_UNITS);
    let width = 1;
    while (
      index + width < bytes.length &&
      ((bytes[index + width] ?? 0) & 0xc0) === 0x80
    )
      width += 1;
    let cost = 0;
    for (let k = 0; k < width; k += 1) cost += units(bytes[index + k] ?? 0);
    if (position >= start) {
      if (from === -1) {
        from = index;
        fromUnits = used;
      }
      if (position !== positionStart) {
        positionStart = position;
        positionStartIndex = index;
      }
      if (used + cost - fromUnits > budget && position > start) {
        // The code points of this position move to the next window.
        return {
          text: bytes.subarray(from, positionStartIndex).toString("utf8"),
          start,
          end: positionStart,
          total,
          truncated: true,
        };
      }
    }
    used += cost;
    index += width;
  }
  return {
    text: from === -1 ? "" : bytes.subarray(from).toString("utf8"),
    start,
    end: Math.max(total, start),
    total,
    truncated: from > 0,
  };
};

/** The line printed after a cut window (contract 10.1). */
export const countedWindowNotice = (window: CountedTokenWindow): string =>
  `[window: tokens ${String(window.start)}-${String(window.end)} of ${String(window.total)}, counted as 1 per 1.3 ASCII bytes and 1 per other byte${window.end < window.total ? `; next: --token-offset ${String(window.end)}` : ""}]`;
