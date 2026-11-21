/**
 * `--schema-kind <kind,...>`: keep only the named alternatives of the
 * schema's unions that are told apart by a `kind` constant, such as the 58
 * view kinds of `inspect-analysis-view`. An outer discriminated union that
 * has none of the named kinds is replaced by a short stub that lists its
 * kinds, so the rest stays one call away; inside a selected alternative such
 * a union stays whole. Unions that no `kind` tells apart are kept.
 */

/** The flag that selects kinds in a `--schema` request. */
export const SCHEMA_KIND_FLAG = "--schema-kind";

type JsonObject = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const UNION_KEYS = ["oneOf", "anyOf"] as const;

/** The `kind` constants an alternative stands for, or undefined when none. */
const alternativeKinds = (schema: unknown): readonly string[] | undefined => {
  if (!isObject(schema)) return undefined;
  const properties = schema.properties;
  if (isObject(properties) && isObject(properties.kind)) {
    const kind = properties.kind;
    if (typeof kind.const === "string") return [kind.const];
    if (
      Array.isArray(kind.enum) &&
      kind.enum.every((v) => typeof v === "string")
    )
      return kind.enum as string[];
  }
  for (const key of UNION_KEYS) {
    const alternatives = schema[key];
    if (!Array.isArray(alternatives)) continue;
    const kinds = alternatives.map(alternativeKinds);
    if (kinds.every((list) => list !== undefined)) return kinds.flat();
  }
  return undefined;
};

/** What selection did, for the caller's report. */
export interface SchemaKindSelection {
  readonly schema: unknown;
  /** Selected kinds some union offered. */
  readonly matched: ReadonlySet<string>;
  /** Kinds of the outermost discriminated unions, for an error that lists them. */
  readonly available: ReadonlySet<string>;
}

export const selectSchemaKinds = (
  schema: unknown,
  selected: ReadonlySet<string>,
): SchemaKindSelection => {
  const matched = new Set<string>();
  const available = new Set<string>();
  const visit = (node: unknown, outermost: boolean): unknown => {
    if (Array.isArray(node)) return node.map((item) => visit(item, outermost));
    if (!isObject(node)) return node;
    for (const key of UNION_KEYS) {
      const alternatives = node[key];
      if (!Array.isArray(alternatives)) continue;
      const kinds = alternatives.map(alternativeKinds);
      if (kinds.some((list) => list === undefined)) continue;
      const all = kinds.flat() as string[];
      if (outermost) for (const kind of all) available.add(kind);
      const kept = alternatives.filter((_, index) =>
        kinds[index]!.some((kind) => selected.has(kind)),
      );
      for (const kind of all) if (selected.has(kind)) matched.add(kind);
      const rest = Object.fromEntries(
        Object.entries(node).filter(([name]) => name !== key),
      );
      // Inside a selected alternative, an unrelated union stays whole.
      if (kept.length === 0 && !outermost) continue;
      if (kept.length === 0)
        return {
          ...rest,
          description: `${typeof node.description === "string" ? `${node.description} ` : ""}One of the kinds ${all.join(", ")}; add a kind to ${SCHEMA_KIND_FLAG} to see its schema.`,
        };
      return {
        ...Object.fromEntries(
          Object.entries(rest).map(([name, value]) => [
            name,
            visit(value, outermost),
          ]),
        ),
        [key]: kept.map((alternative) => visit(alternative, false)),
      };
    }
    return Object.fromEntries(
      Object.entries(node).map(([name, value]) => [
        name,
        visit(value, outermost),
      ]),
    );
  };
  return { schema: visit(schema, true), matched, available };
};

/**
 * The kinds a `--schema` request names after the command, from
 * `--schema-kind a,b` or `--schema-kind=a,b`; undefined when not given.
 */
export const requestedSchemaKinds = (
  tokens: readonly string[],
): ReadonlySet<string> | undefined => {
  let value: string | undefined;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === SCHEMA_KIND_FLAG) value = tokens[(index += 1)] ?? "";
    else if (token.startsWith(`${SCHEMA_KIND_FLAG}=`))
      value = token.slice(SCHEMA_KIND_FLAG.length + 1);
  }
  if (value === undefined) return undefined;
  return new Set(
    value
      .split(",")
      .map((kind) => kind.trim())
      .filter((kind) => kind !== ""),
  );
};
