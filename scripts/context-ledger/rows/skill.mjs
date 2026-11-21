// Skill rows, read from the checkout's authored skill
// (.agents/skills/reverse-engineer-anything): the body's size, where a
// 5,000-token carry-over after compaction cuts it, and, from the audit's
// hand trace of fifteen requests, what a client loads per request and how
// many routes are clear. Ports census-skill 01-measure.mjs, 02-cutoff.mjs and
// 10-routing-test.mjs.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { INPUTS } from "../lib/inputs.mjs";
import { measuredRow, skippedRow } from "../lib/rows.mjs";

const SKILL = join(".agents", "skills", "reverse-engineer-anything");
const CARRY_OVER_TOKENS = 5000;

const splitFrontmatter = (text) => {
  const match = /^---\n[\s\S]*?\n---\n/u.exec(text);
  return match === null
    ? { frontmatterLines: 0, body: text }
    : {
        frontmatterLines: match[0].split("\n").length - 1,
        body: text.slice(match[0].length),
      };
};

/**
 * The first body line whose prefix exceeds the budget (1-based), found by
 * bisection since prefix counts only grow. Undefined when the body fits.
 */
const firstLineOver = (lines, tokens, budget) => {
  const prefix = (count) => tokens(`${lines.slice(0, count).join("\n")}\n`);
  if (prefix(lines.length) <= budget) return undefined;
  let low = 1;
  let high = lines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (prefix(middle) > budget) high = middle;
    else low = middle + 1;
  }
  return low;
};

const bodyLines = (body) => {
  const lines = body.split("\n");
  return body.endsWith("\n") ? lines.slice(0, -1) : lines;
};

const carryOverRow = (context, body, frontmatterLines) => {
  if (context.count("").o200k === null)
    return skippedRow(
      "skill.lines-lost-at-carry-over",
      "needs real tokens (o200k)",
    );
  const lines = bodyLines(body);
  const cut = firstLineOver(
    lines,
    (text) => context.count(text).o200k,
    CARRY_OVER_TOKENS,
  );
  const lost = cut === undefined ? 0 : lines.length - cut + 1;
  return measuredRow("skill.lines-lost-at-carry-over", {
    value: lost,
    detail: {
      body_lines: lines.length,
      first_body_line_over: cut ?? null,
      first_file_line_over: cut === undefined ? null : cut + frontmatterLines,
      note:
        cut === undefined
          ? "the whole body fits in 5,000 o200k tokens"
          : `a 5,000-token carry-over keeps body lines 1-${cut - 1} (file line ${cut + frontmatterLines} is the first one lost)`,
    },
  });
};

/** The fifteen traced requests: valid only for the body they were traced on. */
const routingRows = (context, skillDirectory, body, wanted) => {
  const trace = JSON.parse(
    readFileSync(join(INPUTS, "skill-routes.json"), "utf8"),
  );
  const digest = createHash("sha256").update(body).digest("hex");
  const ids = ["skill.loaded-per-request", "skill.routes-clear"].filter(wanted);
  if (digest !== trace.skill_body_sha256)
    return ids.map((id) =>
      skippedRow(
        id,
        `needs a new trace: inputs/skill-routes.json was traced on SKILL.md body sha256 ${trace.skill_body_sha256.slice(0, 12)}, this body is ${digest.slice(0, 12)}; see README.md, "Redo the skill trace"`,
      ),
    );
  const rows = [];
  if (wanted("skill.loaded-per-request")) {
    if (context.count("").o200k === null)
      rows.push(
        skippedRow("skill.loaded-per-request", "needs real tokens (o200k)"),
      );
    else {
      const bodyTokens = context.count(body).o200k;
      const loaded = trace.requests.map((request) => {
        const references = request.references.map((name) => {
          const file = join(skillDirectory, "references", name);
          return existsSync(file)
            ? context.count(readFileSync(file, "utf8")).o200k
            : 0;
        });
        return {
          id: request.id,
          o200k:
            bodyTokens + references.reduce((sum, tokens) => sum + tokens, 0),
        };
      });
      const total = loaded.reduce((sum, request) => sum + request.o200k, 0);
      rows.push(
        measuredRow("skill.loaded-per-request", {
          value: Math.round(total / loaded.length),
          detail: { requests: loaded },
        }),
      );
    }
  }
  if (wanted("skill.routes-clear"))
    rows.push(
      measuredRow("skill.routes-clear", {
        value: trace.requests.filter((request) => request.clear).length,
        detail: {
          of: trace.requests.length,
          note: "a reading judgment recorded in inputs/skill-routes.json, not computed",
        },
      }),
    );
  return rows;
};

export const SKILL_ROWS = [
  "skill.body",
  "skill.lines-lost-at-carry-over",
  "skill.loaded-per-request",
  "skill.routes-clear",
];

export const skillRows = async (context, wanted) => {
  const skillDirectory = join(context.checkout, SKILL);
  const file = join(skillDirectory, "SKILL.md");
  if (!existsSync(file))
    return SKILL_ROWS.filter(wanted).map((id) =>
      skippedRow(id, `${file} does not exist`),
    );
  const { frontmatterLines, body } = splitFrontmatter(
    readFileSync(file, "utf8"),
  );
  const rows = [];
  if (wanted("skill.body"))
    rows.push(
      measuredRow("skill.body", {
        units: context.count(body),
        detail: { lines: bodyLines(body).length },
      }),
    );
  if (wanted("skill.lines-lost-at-carry-over"))
    rows.push(carryOverRow(context, body, frontmatterLines));
  rows.push(...routingRows(context, skillDirectory, body, wanted));
  return rows;
};
