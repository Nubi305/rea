/**
 * @template Context
 * @typedef {{ readonly name: string, readonly run: (context: Context) => Promise<string> }} CloneRunCase
 */
/**
 * @typedef {(
 *   | { name: string, outcome: "passed", detail: string, seconds: number }
 *   | { name: string, outcome: "failed", reason: string }
 *   | { name: string, outcome: "not-run" }
 * )} CloneRunCaseResult
 */

/**
 * Run the acceptance cases in order and report one line per case. A failed
 * case stops the run, because each case starts from the state the one before
 * it left. So does an interruption: the signal is read before every case, and
 * the commands of the case in hand are stopped by their owner, which fails it.
 * Nothing is verified unless every case passed.
 * @template Context
 * @param {readonly CloneRunCase<Context>[]} cases
 * @param {Context} context
 * @param {(line: string) => void} report
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ cases: CloneRunCaseResult[], verified: boolean }>}
 */
export const runCloneRunCases = async (cases, context, report, signal) => {
  /** @type {CloneRunCaseResult[]} */
  const results = [];
  let stopped = false;
  for (const { name, run } of cases) {
    if (stopped || signal?.aborted === true) {
      report(`not run: ${name}`);
      results.push({ name, outcome: "not-run" });
      continue;
    }
    const startedAt = performance.now();
    try {
      const detail = await run(context);
      report(`pass: ${name} -- ${detail}`);
      results.push({
        name,
        outcome: "passed",
        detail,
        seconds: Math.round((performance.now() - startedAt) / 100) / 10,
      });
    } catch (cause) {
      stopped = true;
      const failure = cause instanceof Error ? cause.message : String(cause);
      // An interrupted command fails as cancelled; say what cancelled it.
      const reason =
        signal?.aborted === true
          ? `${signal.reason instanceof Error ? signal.reason.message : String(signal.reason)} (${failure})`
          : failure;
      report(`FAIL: ${name} -- ${reason}`);
      results.push({ name, outcome: "failed", reason });
    }
  }
  return {
    cases: results,
    verified:
      results.length > 0 &&
      results.every(({ outcome }) => outcome === "passed"),
  };
};
