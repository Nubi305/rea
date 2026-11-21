import type { RetainedBrowserScenarioCapture } from "../browserScenarioCapture.js";
import { boundedList } from "../boundedList.js";
import {
  sharedOrigin,
  summaryFinding,
  withoutOrigin,
  type SummaryFinding,
} from "./summaryFindings.js";

/** Requests a step line names before it counts the rest. */
const REQUESTS_PER_STEP = 8;

interface Exchange {
  readonly step: number;
  readonly method: string;
  readonly url: string;
  status: number | null;
  failed: boolean;
}

/**
 * One line per step: its outcome, then each request it issued as method,
 * address and status (or `failed` / `no-response`), in capture order.
 */
export const browserScenarioSummaryFindings = (
  capture: RetainedBrowserScenarioCapture,
): SummaryFinding[] => {
  const exchanges = new Map<string, Exchange>();
  for (const event of capture.events.items) {
    if (!("transaction_id" in event) || event.kind === "network-content")
      continue;
    let exchange = exchanges.get(event.transaction_id);
    if (exchange === undefined && event.kind === "request") {
      exchange = {
        step: event.step_index,
        method: event.method,
        url: event.url.url,
        status: null,
        failed: false,
      };
      exchanges.set(event.transaction_id, exchange);
    }
    if (exchange === undefined) continue;
    if (event.kind === "response") exchange.status ??= event.status;
    if (event.kind === "request-failed") exchange.failed = true;
  }
  const byStep = new Map<number, Exchange[]>();
  for (const exchange of exchanges.values()) {
    const list = byStep.get(exchange.step) ?? [];
    list.push(exchange);
    byStep.set(exchange.step, list);
  }
  const origin = sharedOrigin(
    [...exchanges.values()].map((exchange) => exchange.url),
  );
  const rows = capture.steps.map((step) => {
    const requests = byStep.get(step.step_index) ?? [];
    const shown = boundedList(requests, REQUESTS_PER_STEP);
    const named = shown.items.map(
      (exchange) =>
        `${exchange.method} ${withoutOrigin(exchange.url, origin)} ${
          exchange.status !== null
            ? String(exchange.status)
            : exchange.failed
              ? "failed"
              : "no-response"
        }`,
    );
    const more = shown.omitted;
    const outcome =
      step.status === "completed"
        ? "completed"
        : `${step.status}: ${step.error}`;
    return `step ${String(step.step_index)} ${step.step_id} ${step.action} ${outcome}${
      requests.length === 0
        ? "; no requests"
        : `; ${named.join("; ")}${more > 0 ? `; +${String(more)} more` : ""}`
    }`;
  });
  const finding = summaryFinding("steps", rows, {
    kind: "browser-scenario",
    collection: "transactions",
    limit: 20,
  });
  return [origin === undefined ? finding : { ...finding, origin }];
};
