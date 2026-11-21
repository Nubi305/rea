// What every cell starts from: an empty workspace with a throwaway home that
// holds the skill as the checkout under test installs it, and a `rea` shim
// for that checkout. Nothing here writes outside the workspace and its cell
// directory.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { checkoutFacts, parseJson, runRea } from "./proc.mjs";

export const CELL_SCHEMA = "rea.bench.cell/1";

/** Paths the harness writes into shell scripts must survive single quotes. */
const safePath = (path) => {
  if (/['\s\\]/u.test(path))
    throw new Error(
      `${path}: a path with a quote, a backslash or white space cannot be used`,
    );
  return path;
};

const emptyOrAbsent = (directory) =>
  !existsSync(directory) || readdirSync(directory).length === 0;

/**
 * The two directories of a cell: the workspace the agent works in, and the
 * cell directory beside it that holds what the agent must not read (the
 * prompt, the cell description, a private copy of what it studies).
 */
export const cellPaths = (workspace, cellDir) => {
  const root = safePath(resolve(workspace));
  const cell = safePath(resolve(cellDir ?? `${root}.cell`));
  if (cell === root || cell.startsWith(`${root}/`))
    throw new Error("the cell directory must be outside the workspace");
  return {
    workspace: root,
    cell,
    home: join(root, "home"),
    shim: join(root, "bin", "rea"),
    shim_log: join(cell, "rea-calls.tsv"),
    cell_file: join(cell, "cell.json"),
    prompt_file: join(cell, "prompt.md"),
  };
};

// The shim notes each call (time, pid, command, mode) and then becomes the
// REA process, so exit status, signals and output are REA's own. HOME is the
// throwaway home: no REA command of a cell can write to the real one.
const shimText = (paths, rea) => `#!/bin/sh
# Benchmark shim for the REA checkout under test: ${rea.checkout}
command='(no command)'
mode=run
for argument in "$@"; do
  case "$argument" in
    --help|-h) mode=help ;;
    --schema) [ "$mode" = run ] && mode=schema ;;
    --llms|--llms-full) [ "$mode" = run ] && mode=llms ;;
    --version) [ "$mode" = run ] && mode=version ;;
    -*) ;;
    *) [ "$command" = '(no command)' ] && command=$(printf '%s' "$argument" | tr -c 'A-Za-z0-9_.-' '_' | cut -c1-80) ;;
  esac
done
[ "$command" = '(no command)' ] && [ "$mode" = run ] && mode=help
printf '%s\\t%s\\t%s\\t%s\\n' "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" "$$" "$command" "$mode" >> '${paths.shim_log}' 2>/dev/null
HOME='${paths.home}' exec '${rea.node}' '${rea.checkout}/scripts/rea.mjs' "$@"
`;

const findSkill = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name === "SKILL.md") return directory;
    if (entry.isDirectory()) {
      const found = findSkill(path);
      if (found !== null) return found;
    }
  }
  return null;
};

const installSkill = (paths, rea, client) => {
  const result = runRea(
    rea.checkout,
    ["setup", "--yes", "--json", "--client", client],
    { node: rea.node, env: { HOME: paths.home }, timeoutMs: 180_000 },
  );
  writeFileSync(join(paths.cell, "setup.json"), result.stdout);
  const skillDir = findSkill(paths.home);
  if (result.status !== 0 || skillDir === null)
    throw new Error(
      `rea setup did not install a skill into ${paths.home} (exit ${result.status}); see ${paths.cell}/setup.json`,
    );
  return {
    client,
    skill_dir: skillDir,
    setup_stdout_bytes: Buffer.byteLength(result.stdout),
    setup_status: parseJson(result.stdout)?.status ?? null,
  };
};

/**
 * Create a workspace and its cell directory for one REA checkout. Refuses a
 * workspace or cell directory that already holds something.
 */
export const createWorkspace = ({
  workspace,
  cellDir,
  checkout,
  node,
  client,
}) => {
  const paths = cellPaths(workspace, cellDir);
  if (!emptyOrAbsent(paths.workspace) || !emptyOrAbsent(paths.cell))
    throw new Error(
      `${paths.workspace} or ${paths.cell} is not empty: a cell starts from nothing`,
    );
  const rea = checkoutFacts(safePath(resolve(checkout)), safePath(node));
  for (const directory of [
    paths.cell,
    paths.home,
    join(paths.workspace, "bin"),
  ])
    mkdirSync(directory, { recursive: true });
  writeFileSync(paths.shim, shimText(paths, rea));
  chmodSync(paths.shim, 0o755);
  writeFileSync(paths.shim_log, "");
  return { paths, rea, skill: installSkill(paths, rea, client) };
};

/** Write the prompt and the cell description; returns the description. */
export const writeCell = (paths, prompt, description) => {
  writeFileSync(paths.prompt_file, prompt);
  const cell = {
    schema: CELL_SCHEMA,
    ...description,
    workspace: paths.workspace,
    cell_dir: paths.cell,
    shim_log: paths.shim_log,
    prompt_file: paths.prompt_file,
    prompt_sha256: createHash("sha256").update(prompt).digest("hex"),
    prompt_bytes: Buffer.byteLength(prompt),
  };
  writeFileSync(paths.cell_file, `${JSON.stringify(cell, null, 1)}\n`);
  return cell;
};

/** The cell a workspace belongs to. */
export const readCell = (workspace, cellFile) => {
  const file = cellFile ?? cellPaths(workspace).cell_file;
  if (!existsSync(file))
    throw new Error(`${file} is missing: pass --cell <cell.json>`);
  const cell = JSON.parse(readFileSync(file, "utf8"));
  if (cell.schema !== CELL_SCHEMA)
    throw new Error(`${file} is not a ${CELL_SCHEMA} description`);
  return cell;
};

/** Paths no agent under test may read, as the trial rules list them. */
export const forbiddenRoots = (paths, rea, extra = []) => [
  ...[...new Set([rea.checkout, ...extra.map((path) => resolve(path))])].map(
    (path) => ({ path, kind: "rea-checkout" }),
  ),
  { path: paths.cell, kind: "cell-private", allow_running: [] },
];
