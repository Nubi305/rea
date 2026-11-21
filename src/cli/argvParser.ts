import { z } from "zod";

import {
  CLI_BUILTIN_FLAGS,
  OUTPUT_SWITCHES,
  VALUED_OUTPUT_FLAGS,
} from "../cliBuiltinArguments.js";
import { err, ok, type Result } from "../domain/result.js";
import { editDistance } from "./commandSuggestion.js";
import {
  declaredOptionType,
  isCountOption,
  optionFlagName,
} from "./optionFields.js";

/**
 * REA's argv parser for one command: binds tokens to the command's
 * positionals and options, then validates them with the command's schemas.
 * Option keys are camelCase; each is spelled `--kebab-case` on the command
 * line and also accepted as `--camelCase`; a snake_case key is also accepted
 * in its kebab spelling (`--evidence-output` for `--evidence_output`), and
 * giving both spellings different values is refused. A boolean option is set by its
 * bare flag and cleared by `--no-<flag>`; `--flag=value` and `--flag value`
 * both bind a value; an array option collects every occurrence; a short
 * alias may be stacked (`-ab`) when all but the last are booleans or
 * counts; a count option adds one per occurrence (`-vvv`). `--` is
 * not a separator here: after the command it is an unknown flag. An unknown
 * long flag near a declared or global one names it (`Did you mean --detail?`).
 * The messages and field errors match what REA has always printed (#11654).
 */

/** One field that failed validation, as REA prints it. */
export interface CliFieldError {
  readonly code: string;
  /** The caller did not supply the field at all. */
  readonly missing: boolean;
  /** Dotted path within the positionals or options. */
  readonly path: string;
  readonly expected: string;
  readonly received: string;
  readonly message: string;
}

/**
 * Why argv was refused: a token the parser cannot bind (an unknown flag or a
 * missing value), or bound positionals or options their schema refused.
 */
export type CliArgvFailure =
  | {
      readonly kind: "parse";
      readonly message: string;
      /**
       * For an unknown long flag: the flag as typed and, when one is near, the
       * declared or global flag it most likely meant. The message does not
       * name the suggestion; the caller adds it once redaction has been
       * checked against the typed flag.
       */
      readonly unknownFlag?: {
        readonly typed: string;
        readonly suggestion?: string | undefined;
      };
    }
  | { readonly kind: "surplus"; readonly message: string }
  | { readonly kind: "boolean_literal"; readonly message: string }
  | {
      readonly kind: "validation";
      readonly message: string;
      readonly fieldErrors: readonly CliFieldError[];
      /** Original parser facts for command-specific safe constraint projection. */
      readonly issues: readonly z.core.$ZodIssue[];
    };

const parseFailure = (message: string): Result<never, CliArgvFailure> =>
  err({ kind: "parse", message });

/**
 * Global flags an unknown command flag may have meant. The update check's own
 * flag and the short help alias are internal or too short to suggest.
 */
const SUGGESTED_GLOBAL_FLAGS: readonly string[] = [
  ...new Set([
    ...VALUED_OUTPUT_FLAGS,
    ...OUTPUT_SWITCHES,
    ...CLI_BUILTIN_FLAGS,
  ]),
].filter((flag) => flag.startsWith("--") && flag !== "--incur-update-check");

/**
 * The flag nearest to `typed` (both spelled with their dashes), or undefined.
 * Near means an edit distance of at most 2, and at most half the typed name's
 * length so a two-letter typo is not read as some other short flag. The
 * smallest distance wins; the first candidate wins a tie. Case is ignored,
 * and so is the difference between `_` and `-`.
 */
const nearestFlag = (
  typed: string,
  candidates: readonly string[],
): string | undefined => {
  const name = typed.slice(2).toLowerCase();
  const threshold = Math.min(2, Math.floor(name.length / 2));
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = editDistance(
      name.replaceAll("_", "-"),
      candidate.slice(2).toLowerCase().replaceAll("_", "-"),
    );
    if (distance <= threshold && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
};

export interface CliArgvSchemas {
  /** Positionals in argv order; a final array field takes the rest. */
  readonly args?: z.ZodObject | undefined;
  readonly options?: z.ZodObject | undefined;
  /** Short alias by option key, such as `{ yes: "y" }`. */
  readonly alias?: Readonly<Record<string, string>> | undefined;
}

export interface CliParsedArgv {
  readonly args: Record<string, unknown>;
  readonly options: Record<string, unknown>;
}

const fieldOf = (
  schema: z.ZodObject | undefined,
  name: string,
): z.ZodType | undefined =>
  schema === undefined
    ? undefined
    : (schema.shape as Readonly<Record<string, z.ZodType>>)[name];

const isBoolean = (schema: z.ZodObject | undefined, name: string): boolean => {
  const field = fieldOf(schema, name);
  return (
    field !== undefined && declaredOptionType(field) instanceof z.ZodBoolean
  );
};

/** A count option (`.meta({ count: true })`) adds one per occurrence. */
const isCount = (schema: z.ZodObject | undefined, name: string): boolean => {
  const field = fieldOf(schema, name);
  return field !== undefined && isCountOption(field);
};

const isArray = (schema: z.ZodObject | undefined, name: string): boolean => {
  const field = fieldOf(schema, name);
  return field !== undefined && declaredOptionType(field) instanceof z.ZodArray;
};

/** Number and boolean options arrive as text; the schema validates the result. */
const coerce = (value: unknown, schema: z.ZodObject, name: string): unknown => {
  const field = fieldOf(schema, name);
  if (field === undefined || typeof value !== "string") return value;
  const type = declaredOptionType(field);
  if (type instanceof z.ZodNumber) return Number(value);
  if (type instanceof z.ZodBoolean) return value === "true";
  return value;
};

/** Whether the raw input holds the issue's whole path. */
const hasPath = (data: unknown, path: readonly PropertyKey[]): boolean => {
  let current = data;
  for (const part of path) {
    if (typeof current !== "object" || current === null) return false;
    if (!(part in current)) return false;
    current = (current as Record<PropertyKey, unknown>)[part];
  }
  return true;
};

/** Validate with `schema`, reporting each issue as a field error. */
export const validateCliInputs = (
  schema: z.ZodObject,
  data: Readonly<Record<string, unknown>>,
): Result<Record<string, unknown>, CliArgvFailure> => {
  const parsed = schema.safeParse(data);
  if (parsed.success) return ok(parsed.data);
  const { issues } = parsed.error;
  return err({
    kind: "validation",
    issues,
    message:
      issues.map(({ message }) => message).join("; ") || "Validation failed",
    fieldErrors: issues.map((issue) => ({
      code: issue.code,
      missing: !hasPath(data, issue.path),
      path: issue.path.join("."),
      expected: stringField(issue, "expected"),
      received: stringField(issue, "received"),
      message: issue.message,
    })),
  });
};

/** Zod reports `expected` (and older issues `received`) as text when present. */
const stringField = (issue: object, key: string): string =>
  (Reflect.get(issue, key) as string | undefined) ?? "";

/**
 * Boolean options whose value after `=` must be the literal `true` or
 * `false`, with the flag each is refused as. Any other text would be read as
 * the option turned off, which for these is the unsafe reading: a dry run
 * that runs, or an exit status that no longer follows the verdict.
 */
const STRICT_BOOLEAN_FLAGS: ReadonlyMap<string, string> = new Map([
  ["dryRun", "--dry-run"],
  ["exitCode", "--exit-code"],
]);

/** Bind and validate one command's argv. */
export const parseCliArgv = (
  argv: readonly string[],
  schemas: CliArgvSchemas,
): Result<CliParsedArgv, CliArgvFailure> => {
  const { args: argsSchema, options: optionsSchema, alias } = schemas;
  const known = new Set(
    optionsSchema === undefined ? [] : Object.keys(optionsSchema.shape),
  );
  const camelOf = new Map(
    [...known].flatMap((name) =>
      optionFlagName(name) === name
        ? []
        : [[optionFlagName(name), name] as const],
    ),
  );
  // A snake_case key also answers to its kebab spelling.
  const kebabOf = new Map(
    [...known].flatMap((name) => {
      const flag = optionFlagName(name);
      const kebab = flag.replaceAll("_", "-");
      return kebab === flag || known.has(kebab) || camelOf.has(kebab)
        ? []
        : [[kebab, name] as const];
    }),
  );
  /** Each option given in its kebab spelling, with the value it was given. */
  const kebabValues = new Map<string, unknown>();
  /** Each snake_case option given in its declared spelling, likewise. */
  const declaredValues = new Map<string, unknown>();
  let conflict: string | undefined;
  const record = (raw: string, name: string, value: unknown): void => {
    if (!name.includes("_") || isArray(optionsSchema, name)) return;
    const kebab = kebabOf.get(raw) === name;
    (kebab ? kebabValues : declaredValues).set(name, value);
    const other = (kebab ? declaredValues : kebabValues).get(name);
    if (other !== undefined && other !== value)
      conflict ??= `Conflicting values for --${optionFlagName(name)} and its spelling --${optionFlagName(name).replaceAll("_", "-")}; give the option once.`;
  };
  const optionName = (raw: string): string | undefined => {
    const name = camelOf.get(raw) ?? kebabOf.get(raw) ?? raw;
    return known.has(name) ? name : undefined;
  };
  const suggestionCandidates = (): readonly string[] => [
    ...[...known].flatMap((name) => [
      `--${optionFlagName(name)}`,
      ...(isBoolean(optionsSchema, name)
        ? [`--no-${optionFlagName(name)}`]
        : []),
    ]),
    ...SUGGESTED_GLOBAL_FLAGS,
  ];
  const unknownFlag = (typed: string): Result<never, CliArgvFailure> =>
    err({
      kind: "parse",
      message: `Unknown flag: ${typed}`,
      unknownFlag: {
        typed,
        suggestion: nearestFlag(typed, suggestionCandidates()),
      },
    });
  const aliasName = new Map(
    Object.entries(alias ?? {}).map(([name, short]) => [short, name] as const),
  );
  const positionals: string[] = [];
  const options: Record<string, unknown> = {};
  let invalidBooleanFlag: string | undefined;
  const set = (raw: string, name: string, value: string): void => {
    record(raw, name, value);
    if (value !== "true" && value !== "false" && isBoolean(optionsSchema, name))
      invalidBooleanFlag ??= STRICT_BOOLEAN_FLAGS.get(name);
    if (!isArray(optionsSchema, name)) {
      options[name] = value;
      return;
    }
    const existing = options[name];
    if (Array.isArray(existing)) existing.push(value);
    else options[name] = [value];
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token.startsWith("--no-") && token.length > 5) {
      const name = optionName(token.slice(5));
      if (name === undefined) return unknownFlag(token);
      record(token.slice(5), name, false);
      options[name] = false;
    } else if (token.startsWith("--")) {
      const equals = token.indexOf("=");
      if (equals !== -1) {
        const raw = token.slice(2, equals);
        const name = optionName(raw);
        if (name === undefined) return unknownFlag(`--${raw}`);
        set(raw, name, token.slice(equals + 1));
        continue;
      }
      const raw = token.slice(2);
      const name = optionName(raw);
      if (name === undefined)
        return token === "--"
          ? parseFailure(`Unknown flag: ${token}`)
          : unknownFlag(token);
      if (isCount(optionsSchema, name)) {
        options[name] = ((options[name] as number | undefined) ?? 0) + 1;
        continue;
      }
      if (isBoolean(optionsSchema, name)) {
        record(raw, name, true);
        options[name] = true;
        continue;
      }
      const value = argv[index + 1];
      if (value === undefined)
        return parseFailure(`Missing value for flag: ${token}`);
      set(raw, name, value);
      index += 1;
    } else if (token.startsWith("-") && token.length >= 2) {
      const shorts = token.slice(1);
      for (const [position, short] of [...shorts].entries()) {
        const name = aliasName.get(short);
        if (name === undefined) return parseFailure(`Unknown flag: -${short}`);
        if (isCount(optionsSchema, name)) {
          options[name] = ((options[name] as number | undefined) ?? 0) + 1;
          continue;
        }
        if (isBoolean(optionsSchema, name)) {
          options[name] = true;
          continue;
        }
        if (position !== shorts.length - 1)
          return parseFailure(
            `Non-boolean flag -${short} must be last in a stacked alias`,
          );
        const value = argv[index + 1];
        if (value === undefined)
          return parseFailure(`Missing value for flag: -${short}`);
        set(short, name, value);
        index += 1;
      }
    } else {
      positionals.push(token);
    }
  }
  if (conflict !== undefined) return parseFailure(conflict);
  // Check retained token facts before defaults or transforms can run. A later
  // valid occurrence must not hide an earlier invalid literal.
  if (invalidBooleanFlag !== undefined)
    return err({
      kind: "boolean_literal",
      message: `Invalid ${invalidBooleanFlag} value; use true or false.`,
    });
  const keys = Object.keys(argsSchema?.shape ?? {});
  const last = keys.at(-1);
  const variadic = last !== undefined && isArray(argsSchema, last);
  if (!variadic && positionals.length > keys.length)
    return err({
      kind: "surplus",
      message: `Unexpected positional arguments: ${positionals
        .slice(keys.length)
        .map((value) => JSON.stringify(value))
        .join(" ")}.`,
    });
  const rawArgs: Record<string, unknown> = {};
  if (argsSchema !== undefined) {
    for (const [position, key] of keys.entries()) {
      if (isArray(argsSchema, key)) {
        if (position !== keys.length - 1)
          throw new Error(
            `Variadic arg "${key}" must be the last key in the args schema`,
          );
        const rest = positionals.slice(position);
        if (rest.length > 0) rawArgs[key] = rest;
      } else if (positionals[position] !== undefined)
        rawArgs[key] = positionals[position];
    }
  }
  // Positionals are validated first; their failure is reported alone.
  const parsedArgs =
    argsSchema === undefined ? ok({}) : validateCliInputs(argsSchema, rawArgs);
  if (!parsedArgs.ok) return parsedArgs;
  if (optionsSchema === undefined)
    return ok({ args: parsedArgs.value, options: {} });
  for (const [name, value] of Object.entries(options))
    options[name] = coerce(value, optionsSchema, name);
  const parsedOptions = validateCliInputs(optionsSchema, options);
  return parsedOptions.ok
    ? ok({ args: parsedArgs.value, options: parsedOptions.value })
    : parsedOptions;
};
