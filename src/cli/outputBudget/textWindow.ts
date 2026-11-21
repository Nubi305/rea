/**
 * The raw-text reader behind `rea saved-output show <ref> --text <path>`:
 * a string as its own characters, any other value as JSON indented by two
 * spaces, in windows of whole lines that each name where the next starts.
 */

/** A window takes this share of the budget; the rest is the notice. */
const WINDOW_SHARE = 0.9;

export interface TextWindow {
  /** What to print: the window, then the notice line when the text was cut. */
  readonly text: string;
  /** Byte offset where the window ends (the next `--offset`). */
  readonly end: number;
  /** Bytes of the whole text. */
  readonly total: number;
  /** True when the window is the whole text from `offset`. */
  readonly complete: boolean;
}

/** The text a value is read as. */
export const textOf = (value: unknown): string =>
  typeof value === "string"
    ? value
    : (JSON.stringify(value, null, 2) ?? "null");

const withNewline = (text: string): string =>
  text.endsWith("\n") ? text : `${text}\n`;

/**
 * One window of `value` read as text, from byte `offset`.
 *
 * `limitBytes` undefined (the budget is off): everything from the offset,
 * without a notice. Otherwise a text that fits is printed whole; a longer one
 * is cut after the last whole line within 90% of the budget (a line longer
 * than that is cut on a code point) and followed by one notice line.
 * `path` is the selection as the caller wrote it, for the notice.
 */
export const textWindow = (
  value: unknown,
  path: string,
  offset: number,
  limitBytes: number | undefined,
): TextWindow => {
  const bytes = Buffer.from(textOf(value), "utf8");
  const total = bytes.length;
  let start = Math.min(Math.max(0, Math.floor(offset)), total);
  // An offset inside a code point starts at that code point.
  while (start > 0 && start < total && ((bytes[start] ?? 0) & 0xc0) === 0x80)
    start -= 1;
  if (limitBytes === undefined)
    return {
      text: withNewline(bytes.subarray(start).toString("utf8")),
      end: total,
      total,
      complete: true,
    };
  if (start === 0 && total + 1 <= limitBytes)
    return {
      text: withNewline(bytes.toString("utf8")),
      end: total,
      total,
      complete: true,
    };
  const room = Math.max(1, Math.floor(limitBytes * WINDOW_SHARE));
  let end = Math.min(total, start + room);
  if (end < total) {
    const lineEnd = bytes.lastIndexOf(0x0a, end - 1);
    if (lineEnd >= start) end = lineEnd + 1;
    else
      while (end > start + 1 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  }
  const body = bytes.subarray(start, end).toString("utf8");
  const linesBefore =
    start === 0
      ? 0
      : bytes.subarray(0, start).toString("utf8").split("\n").length - 1;
  const linesIn =
    body.split("\n").length - (body.endsWith("\n") || body === "" ? 1 : 0);
  const totalLines = textOf(value).split("\n").length;
  const notice = `[text ${path}: bytes ${String(start)}-${String(end)} of ${String(total)}, lines ${String(linesBefore + 1)}-${String(linesBefore + Math.max(linesIn, 1))} of ${String(totalLines)}${end < total ? `; next: --offset ${String(end)}` : ""}; to search it all: add --output-budget off and pipe to a search tool]`;
  return {
    text: `${withNewline(body)}${notice}\n`,
    end,
    total,
    complete: end >= total,
  };
};
