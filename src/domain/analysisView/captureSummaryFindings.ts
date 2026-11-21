import type { JsonValue } from "../jsonValue.js";
import {
  sharedOrigin,
  summaryFinding,
  withoutOrigin,
  type SummaryFinding,
} from "./summaryFindings.js";

type Fields = Readonly<Record<string, JsonValue>>;

const fields = (value: JsonValue | undefined): Fields | null =>
  value !== null &&
  value !== undefined &&
  typeof value === "object" &&
  !Array.isArray(value)
    ? value
    : null;

const text = (value: JsonValue | undefined): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const number = (value: JsonValue | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** One record's headline, read from its preview (the redaction owner's selection). */
interface RecordLine {
  readonly ordinal: number;
  readonly method: string;
  readonly address: string;
  readonly status: number | undefined;
  readonly time: number | undefined;
}

/** The address a producer reported: a URL, or mitmproxy's parts. */
const address = (request: Fields): string => {
  const url = text(request.url);
  if (url !== undefined) return url;
  const path = text(request.path);
  const host = text(request.authority) ?? text(request.host);
  const scheme = text(request.scheme);
  if (path !== undefined && host !== undefined && scheme !== undefined)
    return `${scheme}://${host}${path}`;
  return path ?? "(address not previewed)";
};

const recordLine = (
  ordinal: number,
  reported: JsonValue,
): RecordLine | undefined => {
  const record = fields(reported);
  const request = fields(record?.request);
  if (record === null || request === null) return undefined;
  const response = fields(record.response);
  const status =
    number(response?.status) ?? number(response?.status_code) ?? undefined;
  return {
    ordinal,
    method: text(request.method) ?? "?",
    address: address(request),
    // HAR reports 0 for a request that received no response.
    status: status === 0 ? undefined : status,
    time: number(record.time),
  };
};

const failed = (line: RecordLine): boolean =>
  line.status === undefined || line.status >= 400;

const format = (line: RecordLine, origin: string | undefined): string =>
  `#${String(line.ordinal)} ${line.method} ${withoutOrigin(line.address, origin)} ${
    line.status === undefined ? "no-response" : String(line.status)
  }${line.time === undefined ? "" : ` ${String(Math.round(line.time))}ms`}`;

/**
 * One line per HTTP record (ordinal, method, address, status, time): failed
 * records first in capture order, then the rest slowest first. Records that
 * are not HTTP exchanges (qlog events) have no line.
 */
export const captureSummaryFindings = (
  previews: readonly {
    readonly ordinal: number;
    readonly reported: JsonValue;
  }[],
): SummaryFinding[] => {
  const lines = previews.flatMap((preview) => {
    const line = recordLine(preview.ordinal, preview.reported);
    return line === undefined ? [] : [line];
  });
  const failures = lines.filter(failed);
  const rest = lines
    .filter((line) => !failed(line))
    .sort(
      (left, right) =>
        (right.time ?? -1) - (left.time ?? -1) || left.ordinal - right.ordinal,
    );
  const ordered = [...failures, ...rest];
  const origin = sharedOrigin(ordered.map((line) => line.address));
  const finding = summaryFinding(
    "requests_failed_first_then_slowest",
    ordered.map((line) => format(line, origin)),
    { kind: "capture", limit: 20 },
  );
  return [origin === undefined ? finding : { ...finding, origin }];
};
