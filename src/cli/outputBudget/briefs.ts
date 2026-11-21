/**
 * Command-owned briefs (contract 5.5): for the commands agents call first, the
 * findings themselves, placed in a digest after everything else so that a
 * brief knows the room left. No command module changes for this; each entry
 * reads only the paths named in the contract's table.
 */
import { isRecord } from "../../kernel/isRecord.js";

/** A brief's own room: at most this, the referee's worklist excepted. */
export const BRIEF_ALLOWANCE_BYTES = 1200;
/** Characters a brief copies of one string (the worklist copies whole items). */
export const BRIEF_STRING_CHARACTERS = 160;

/** What a digest lends a brief while it is built. */
export interface BriefHelpers {
  /** Bytes the digest still has for the brief. */
  readonly room: number;
  /** `path[from,to]` for the first page of the array at a dotted path, from row `from`. */
  readonly page: (path: string, from?: number) => string | undefined;
  /** A string cut to `n` characters (on a code point), marked with an ellipsis. */
  readonly cut: (text: unknown, n: number) => unknown;
}

/** A built brief. */
export interface Brief {
  readonly value: Record<string, unknown>;
  /** Paths of the scopes it read, whose limitation sentences are stated with it. */
  readonly scopes?: readonly string[];
  /** Arrays of `value` the fit order may shorten from the end (counted in `<list>_more`). */
  readonly lists?: readonly string[];
  /** Paths whose rows the brief shows; no command is printed for them again. */
  readonly covers?: readonly string[];
  /** The tails of the brief's own commands (after the reader), from what is shown. */
  readonly next?: (
    value: Record<string, unknown> | undefined,
  ) => readonly string[];
}

export type BriefBuilder = (helpers: BriefHelpers) => Brief | undefined;

type Json = Readonly<Record<string, unknown>>;

const rows = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];
const at = (value: unknown, ...keys: readonly string[]): unknown => {
  let node = value;
  for (const key of keys) node = isRecord(node) ? node[key] : undefined;
  return node;
};

const countBy = (
  items: readonly unknown[],
  key: string,
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const item of items) {
    const name = String(isRecord(item) ? item[key] : item);
    out[name] = (out[name] ?? 0) + 1;
  }
  return out;
};

const jsonBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");

/** Shorten the named lists from the end until the brief fits its allowance. */
const fit = (
  value: Record<string, unknown>,
  lists: readonly string[],
  allowance: number,
): Record<string, unknown> | undefined => {
  for (const key of lists) {
    const list = value[key];
    if (!Array.isArray(list)) continue;
    while (jsonBytes(value) > allowance && list.length > 1) {
      list.pop();
      value[`${key}_more`] = Number(value[`${key}_more`] ?? 0) + 1;
    }
  }
  return jsonBytes(value) <= allowance ? value : undefined;
};

const shellWord = (value: string): string =>
  /^[A-Za-z0-9_@%+=:,./-]+$/u.test(value)
    ? value
    : `'${value.replaceAll("'", `'"'"'`)}'`;

const filterTail = (expression: string | undefined): readonly string[] =>
  expression === undefined ? [] : [`--filter-output ${shellWord(expression)}`];

/** A brief that takes at most {@link BRIEF_ALLOWANCE_BYTES} of the room. */
const standard =
  (build: (document: unknown) => BriefBuilder | undefined) =>
  (document: unknown): BriefBuilder | undefined => {
    const made = build(document);
    if (made === undefined) return undefined;
    return (helpers) => {
      const draft = made(helpers);
      if (draft === undefined) return undefined;
      const value = fit(
        draft.value,
        draft.lists ?? [],
        Math.min(BRIEF_ALLOWANCE_BYTES, helpers.room),
      );
      return value === undefined ? undefined : { ...draft, value };
    };
  };

const javascriptApplication = standard((document) => {
  const graph = at(document, "normalized_result", "graph");
  if (!isRecord(graph) || !Array.isArray(graph.nodes)) return undefined;
  return ({ page, cut }) => {
    const endpoints = rows(graph.nodes)
      .filter((node) => isRecord(node) && node.kind === "endpoint")
      .map((node) => at(node, "identity", "key") ?? at(node, "identity", "url"))
      .filter((key): key is string => typeof key === "string")
      .map((key) => cut(key, BRIEF_STRING_CHARACTERS));
    return {
      value: {
        nodes_by_kind: countBy(rows(graph.nodes), "kind"),
        edges_by_relation: countBy(rows(graph.edges), "relation"),
        endpoints: endpoints.slice(0, 20),
        ...(endpoints.length > 20
          ? { endpoints_more: endpoints.length - 20 }
          : {}),
      },
      lists: ["endpoints"],
      scopes: ["normalized_result.graph"],
      next: () => filterTail(page("normalized_result.graph.nodes")),
    };
  };
});

const artifact = standard((document) => {
  const result = at(document, "normalized_result");
  if (!isRecord(result)) return undefined;
  return ({ cut }) => {
    const files = rows(result.substeps)
      .flatMap((step) =>
        rows(at(step, "evidence", "normalized_result", "occurrences")),
      )
      .map((occurrence) => at(occurrence, "logical_path"))
      .filter((path): path is string => typeof path === "string")
      .map((path) => cut(path, BRIEF_STRING_CHARACTERS));
    return {
      value: {
        format: at(result, "subject", "root_format") ?? null,
        next_probes: rows(result.next_probes).map((probe) =>
          cut(probe, BRIEF_STRING_CHARACTERS),
        ),
        observations_by_kind: countBy(rows(result.observations), "kind"),
        unexplored: rows(result.unexplored_branches)
          .slice(0, 5)
          .map((branch) => ({
            reason: cut(at(branch, "reason"), BRIEF_STRING_CHARACTERS),
            next_probe: cut(at(branch, "next_probe"), BRIEF_STRING_CHARACTERS),
          })),
        files: files.slice(0, 20),
        ...(files.length > 20 ? { files_more: files.length - 20 } : {}),
      },
      lists: ["files", "unexplored", "next_probes"],
    };
  };
});

const browserScenario = standard((document) => {
  const steps =
    at(document, "normalized_result", "steps") ??
    at(document, "summary", "normalized_result", "summary", "steps");
  if (!Array.isArray(steps)) return undefined;
  return ({ cut }) => {
    const failures = rows(steps)
      .filter((step) => {
        const status =
          at(step, "status") ??
          at(step, "completeness", "status") ??
          "completed";
        return status !== "completed" && at(step, "error") != null;
      })
      .slice(0, 3)
      .map((step) => {
        const error = at(step, "error");
        return {
          step_id: at(step, "step_id") ?? null,
          status: at(step, "status") ?? null,
          error: cut(
            typeof error === "string" ? error : JSON.stringify(error),
            BRIEF_STRING_CHARACTERS,
          ),
        };
      });
    return {
      value: {
        steps: steps.length,
        steps_by_status: countBy(steps, "status"),
        ...(failures.length > 0 ? { first_failures: failures } : {}),
      },
      lists: ["first_failures"],
    };
  };
});

/**
 * The referee's worklist is the answer: its items whole and in order, as many
 * as the room holds. An item is shown whole or not at all, because its message
 * carries the reset instruction.
 */
const cloneRunEvaluation = (document: unknown): BriefBuilder | undefined => {
  const items = at(document, "next");
  if (!Array.isArray(items) || items.length === 0) return undefined;
  return ({ room, page }) => {
    const shown: unknown[] = [];
    let used = 64;
    for (const item of items) {
      const cost = jsonBytes(item) + 1;
      if (used + cost > room) break;
      shown.push(item);
      used += cost;
    }
    if (shown.length === 0) return undefined;
    return {
      value: {
        worklist: shown,
        ...(shown.length < items.length
          ? { worklist_more: items.length - shown.length }
          : {}),
      },
      lists: ["worklist"],
      covers: ["next"],
      next: (value) => {
        const count = rows(value?.worklist).length;
        return count < items.length ? filterTail(page("next", count)) : [];
      },
    };
  };
};

const providers = standard((document) => {
  const candidates = at(document, "analysis_provider_candidates");
  if (!Array.isArray(candidates)) return undefined;
  return () => ({
    value: {
      providers: Object.fromEntries(
        rows(candidates).map((candidate) => {
          const provider = at(candidate, "provider");
          return [
            String(isRecord(provider) ? provider.id : provider),
            at(candidate, "availability", "status") ?? null,
          ];
        }),
      ),
    },
  });
});

const doctor = standard((document) => {
  const checks = at(document, "checks");
  if (!Array.isArray(checks)) return undefined;
  return ({ cut }) => ({
    value: {
      failing_checks: rows(checks)
        .filter((check) => at(check, "ok") === false)
        .map((check) => ({
          name: at(check, "name") ?? null,
          detail: cut(at(check, "detail"), 120) ?? null,
        })),
    },
    lists: ["failing_checks"],
  });
});

const webPage = standard((document) => {
  const nodes = at(document, "normalized_result", "accessibility", "nodes");
  if (!Array.isArray(nodes)) return undefined;
  return ({ cut }) => ({
    value: {
      roles: countBy(
        rows(nodes).filter((node) => at(node, "ignored") !== true),
        "role",
      ),
      headings: rows(nodes)
        .filter((node) => at(node, "role") === "heading")
        .map((node) => cut(at(node, "name"), 80))
        .slice(0, 10),
    },
    lists: ["headings"],
  });
});

const webCaptures = standard((document) => {
  const steps = at(document, "normalized_result", "steps");
  if (!Array.isArray(steps)) return undefined;
  return () => ({ value: { steps_by_status: countBy(steps, "status") } });
});

const toolStdout = standard((document) => {
  const text = at(document, "normalized_result", "stdout");
  if (typeof text !== "string") return undefined;
  return ({ cut }) => {
    const lines = text.split("\n");
    return {
      value: {
        stdout_lines: lines.length,
        stdout_head: lines.slice(0, 8).map((line) => cut(line, 100)),
      },
      lists: ["stdout_head"],
    };
  };
});

const setup = standard((document) => {
  const planned = at(document, "plannedActions");
  if (!Array.isArray(planned)) return undefined;
  return ({ cut }) => ({
    value: {
      planned: rows(planned).map((action) => ({
        kind: at(action, "kind") ?? null,
        label: cut(at(action, "label"), 100) ?? null,
      })),
    },
    lists: ["planned"],
  });
});

const evidenceBundle = standard((document) => {
  const records = at(document, "records");
  if (!Array.isArray(records)) return undefined;
  return () => ({
    value: {
      records: rows(records).map((entry) => ({
        evidence_id: at(entry, "evidence_id") ?? null,
        operation: at(entry, "operation") ?? null,
      })),
    },
    lists: ["records"],
  });
});

const BRIEFS: Readonly<
  Record<string, (document: unknown) => BriefBuilder | undefined>
> = {
  "analyze-javascript-application": javascriptApplication,
  analyze: javascriptApplication,
  "inspect-artifact": artifact,
  "capture-browser-scenario": browserScenario,
  "evaluate-clone-run": cloneRunEvaluation,
  providers,
  capabilities: providers,
  doctor,
  "inspect-web-page": webPage,
  "compare-web-captures": webCaptures,
  "inspect-with-objdump": toolStdout,
  "debug-with-gdb": toolStdout,
  setup,
  "inspect-evidence-bundle": evidenceBundle,
};

/** The commands that own a brief. */
export const BRIEF_COMMANDS: readonly string[] = Object.keys(BRIEFS);

/**
 * The brief of `command` for `document`, as a function of the room the digest
 * has left; `undefined` when the command owns none or the document lacks its
 * paths. A brief that cannot be built is left out, never an error.
 */
export const digestBrief = (
  command: string,
  document: unknown,
): BriefBuilder | undefined => {
  const build = Object.hasOwn(BRIEFS, command) ? BRIEFS[command] : undefined;
  if (build === undefined) return undefined;
  try {
    const made = build(document);
    if (made === undefined) return undefined;
    return (helpers) => {
      try {
        return made(helpers);
      } catch {
        return undefined;
      }
    };
  } catch {
    return undefined;
  }
};

/** Cut a string to `n` characters on a code point, marked with an ellipsis. */
export const cutText = (text: unknown, n: number): unknown => {
  if (typeof text !== "string") return text;
  const points = Array.from(text);
  return points.length > n ? `${points.slice(0, n).join("")}…` : text;
};
