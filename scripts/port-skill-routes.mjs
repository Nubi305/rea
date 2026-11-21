#!/usr/bin/env node
// Regenerate the skill's route references from upstream's SKILL.md.
//
//   node scripts/port-skill-routes.mjs                  rewrite the references from the recorded copy
//   node scripts/port-skill-routes.mjs --check          fail when a reference differs from the recorded copy's port
//   node scripts/port-skill-routes.mjs --from-ref <ref> record upstream's SKILL.md at a git ref, then rewrite
//   node scripts/port-skill-routes.mjs --from-file <f>  record a SKILL.md file as upstream's, then rewrite
//
// During an upstream merge: take the fork's SKILL.md side of any conflict,
// run --from-ref with the merged tag, and review the diff of the references
// and of scripts/skill-routes/upstream-SKILL.md. A correction whose text
// upstream changed stops the port with its reason.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { portSkillRoutes } from "./lib/skill-routes.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIRECTORY = join(root, ".agents/skills/reverse-engineer-anything");
const UPSTREAM_SKILL_PATH = ".agents/skills/reverse-engineer-anything/SKILL.md";
const RECORD = join(root, "scripts/skill-routes/upstream-SKILL.md");
const PROVENANCE = join(root, "scripts/skill-routes/upstream.json");

const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--"))
    throw new Error(`${name} needs a value`);
  return value;
};
const known = new Set(["--check", "--from-ref", "--from-file"]);
for (const [index, argument] of argv.entries())
  if (argument.startsWith("--") && !known.has(argument))
    throw new Error(`Unknown option: ${argument}`);
  else if (!argument.startsWith("--") && !known.has(argv[index - 1] ?? ""))
    throw new Error(`Unexpected argument: ${argument}`);

const check = argv.includes("--check");
const fromRef = option("--from-ref");
const fromFile = option("--from-file");
if (check && (fromRef !== undefined || fromFile !== undefined))
  throw new Error("--check reads the recorded copy; it takes no source");

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

if (fromRef !== undefined || fromFile !== undefined) {
  const text =
    fromRef === undefined
      ? readFileSync(fromFile, "utf8")
      : execFileSync("git", ["show", `${fromRef}:${UPSTREAM_SKILL_PATH}`], {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
        });
  const commit =
    fromRef === undefined
      ? null
      : execFileSync("git", ["rev-parse", `${fromRef}^{commit}`], {
          cwd: root,
          encoding: "utf8",
        }).trim();
  const normalized = text.replaceAll("\r\n", "\n");
  writeFileSync(RECORD, normalized);
  writeFileSync(
    PROVENANCE,
    `${JSON.stringify(
      {
        source: fromRef ?? fromFile,
        commit,
        path: UPSTREAM_SKILL_PATH,
        sha256: sha256(normalized),
      },
      null,
      2,
    )}\n`,
  );
}

const recorded = readFileSync(RECORD, "utf8");
const provenance = JSON.parse(readFileSync(PROVENANCE, "utf8"));
if (sha256(recorded) !== provenance.sha256)
  throw new Error(
    `${RECORD} does not match the digest in ${PROVENANCE}; record upstream again with --from-ref`,
  );

const { files, notes } = portSkillRoutes(recorded);
const stale = [];
for (const [relativePath, content] of Object.entries(files)) {
  const path = join(SKILL_DIRECTORY, relativePath);
  let current;
  try {
    current = readFileSync(path, "utf8");
  } catch {
    current = undefined;
  }
  if (current === content) continue;
  if (check) stale.push(relativePath);
  else writeFileSync(path, content);
}
for (const note of notes) console.error(`note: ${note}`);
if (stale.length > 0) {
  console.error(
    `Stale skill route references: ${stale.join(", ")}; run npm run skill:routes`,
  );
  process.exit(1);
}
