import type { JsonValue } from "../../domain/jsonValue.js";
import type { ScenarioBehaviorComparison } from "../../domain/scenarioBehaviorComparison.js";

/**
 * A capture's own address in what its application prints.
 * Contract: docs/specs/reconstruction/clone-runs/spec.md, "The comparer",
 * rule **Origin**.
 *
 * An application that prints its own address prints another text at another
 * address. The left side's address is therefore read as the right side's, the
 * way a declared rename reads one name as another: in the left's values, at
 * the point each is compared, and never by a placeholder, which a right side
 * could print itself. The right side's values are compared as they are, so a
 * right side that prints anything but its own address there differs. Two
 * forms are replaced, in one pass over the text:
 *
 * - the capture's start origin (`http://127.0.0.1:4101`), only where it ends:
 *   a longer host or another port is another origin;
 * - the bare `host:port` of an origin that names its port
 *   (`127.0.0.1:4101`), not at the end of a longer host and not when a digit
 *   follows. An origin on its scheme's default port has no such form: its
 *   bare host is a name like any other, which a rename can declare.
 */

type AppliedAddress = NonNullable<
  ScenarioBehaviorComparison["addresses_applied"]
>[number];

/** Reads the own address of captures as the address `to`, counting the values it changed. */
export interface OwnAddressReader {
  /** The start origin every own address is read as. */
  readonly to: string;
  /** `text` of a capture that started at `origin`, with that capture's own address read as `to`. */
  readonly text: (text: string, origin: string) => string;
  /** Whether a capture that started at `origin` prints another address than `to`. */
  readonly applies: (origin: string) => boolean;
  /** Each replaced form that changed at least one value, with how many. */
  readonly applied: () => AppliedAddress[];
}

const escapePattern = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** The `host:port` of an origin that names its port, or null. */
const namedHostAndPort = (origin: string): string | null => {
  const url = URL.parse(origin);
  return url === null || url.port === "" ? null : url.host;
};

const addressMapper = (
  origin: string,
  to: string,
  counts: AppliedAddress[],
): ((text: string) => string) => {
  const host = namedHostAndPort(origin);
  const toHost = URL.parse(to)?.host ?? "";
  const forms: { readonly origin: AppliedAddress; host?: AppliedAddress } = {
    origin: { from: origin, to, values: 0 },
  };
  if (host !== null && toHost !== "" && toHost !== host)
    forms.host = { from: host, to: toHost, values: 0 };
  counts.push(forms.origin, ...(forms.host === undefined ? [] : [forms.host]));
  const pattern = new RegExp(
    `${escapePattern(origin)}(?![\\w-]|:\\d|\\.[\\w-])${
      forms.host === undefined
        ? ""
        : `|(?<![\\w.-])${escapePattern(forms.host.from)}(?!\\d)`
    }`,
    "gu",
  );
  return (text) => {
    const changed = new Set<AppliedAddress>();
    const mapped = text.replaceAll(pattern, (match) => {
      const form =
        match === origin ? forms.origin : (forms.host ?? forms.origin);
      changed.add(form);
      return form.to;
    });
    for (const form of changed) form.values += 1;
    return mapped;
  };
};

/** A reader that reads every capture's own address as the start origin `to`. */
export const ownAddressReader = (to: string): OwnAddressReader => {
  const counts: AppliedAddress[] = [];
  const mappers = new Map<string, (text: string) => string>();
  const applies = (origin: string): boolean => origin !== to;
  return {
    to,
    applies,
    text: (text, origin) => {
      if (!applies(origin)) return text;
      let mapper = mappers.get(origin);
      if (mapper === undefined) {
        mapper = addressMapper(origin, to, counts);
        mappers.set(origin, mapper);
      }
      return mapper(text);
    },
    applied: () =>
      counts.filter(({ values }) => values > 0).map((form) => ({ ...form })),
  };
};

/** Apply `map` to every string value of a JSON value, never to a field name. */
const mapJsonStrings = (
  value: JsonValue,
  map: (text: string) => string,
): JsonValue => {
  if (typeof value === "string") return map(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((item) => mapJsonStrings(item, map));
  return Object.fromEntries(
    Object.entries(value).map(([key, member]) => [
      key,
      mapJsonStrings(member, map),
    ]),
  );
};

/** Apply `map` to a text body and to every string value of a JSON body; any other body is returned as it is. */
export const mapBodyStrings = <
  Body extends
    | { readonly kind: "json"; readonly value: JsonValue }
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "none" | "base64" },
>(
  body: Body,
  map: (text: string) => string,
): Body =>
  body.kind === "json"
    ? { ...body, value: mapJsonStrings(body.value, map) }
    : body.kind === "text"
      ? { ...body, text: map(body.text) }
      : body;
