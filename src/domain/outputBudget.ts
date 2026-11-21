/**
 * The answer budget's one setting: how many bytes of a result REA may put on
 * standard output (or in an MCP reply) before the rest is saved and named.
 *
 * Both process entries read it: the CLI policy (`src/cli/outputBudget/policy.ts`)
 * and the MCP server configuration. Neither imports the other; both parse here.
 */
import { err, ok, type Result } from "./result.js";

/** Rendered bytes a result may take when nothing else is set. */
export const DEFAULT_OUTPUT_BUDGET_BYTES = 6000;
/** The smallest budget that still holds a digest's core with a long store path. */
export const MINIMUM_OUTPUT_BUDGET_BYTES = 2048;
/** The largest budget accepted: any byte count a JavaScript number holds exactly. */
export const MAXIMUM_OUTPUT_BUDGET_BYTES = Number.MAX_SAFE_INTEGER;
/** Bytes a bounded error document may take. */
export const ERROR_BUDGET_BYTES = 1500;

/** The environment variable that sets the budget for a CLI process or an MCP server. */
export const OUTPUT_BUDGET_ENVIRONMENT = "REA_OUTPUT_BUDGET";

/** A parsed setting: a byte count, or `off` for today's complete output. */
export type OutputBudgetSetting = number | "off";

const DECIMAL = /^[0-9]+$/u;

/**
 * Parse one budget value as a caller wrote it: `off`, or a decimal byte count
 * of at least {@link MINIMUM_OUTPUT_BUDGET_BYTES}. `name` is the spelling the
 * message names (`--output-budget` or `REA_OUTPUT_BUDGET`).
 */
export const parseOutputBudget = (
  value: string,
  name: string = OUTPUT_BUDGET_ENVIRONMENT,
): Result<OutputBudgetSetting, string> => {
  if (value === "off") return ok("off");
  const bytes = DECIMAL.test(value) ? Number(value) : Number.NaN;
  if (
    Number.isSafeInteger(bytes) &&
    bytes >= MINIMUM_OUTPUT_BUDGET_BYTES &&
    bytes <= MAXIMUM_OUTPUT_BUDGET_BYTES
  )
    return ok(bytes);
  return err(
    `${name} must be off or a whole number of bytes of at least ${String(MINIMUM_OUTPUT_BUDGET_BYTES)}; received ${JSON.stringify(value)}.`,
  );
};

/**
 * Read `REA_OUTPUT_BUDGET` from a launch environment. Unset or empty is
 * `undefined` (the caller's default applies); an invalid value is an error the
 * process entry reports as a configuration error.
 */
export const outputBudgetFromEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
): Result<OutputBudgetSetting | undefined, string> => {
  const raw = environment.REA_OUTPUT_BUDGET;
  if (raw === undefined || raw === "") return ok(undefined);
  return parseOutputBudget(raw, OUTPUT_BUDGET_ENVIRONMENT);
};
