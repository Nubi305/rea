# Context ledger

The context ledger measures what REA puts into an agent's context, on any
built checkout, with no model involved. It runs scripted tasks through REA's
MCP server and CLI, reads the skill, drives the clone-run loop on the
repository's own fixture pair, and writes one row per measurement in three
units. It is the outside judge (J1) of the plan that followed the context
audit: a change that makes REA cheaper for an agent lowers rows; a change that
makes it dearer raises them, and `--check` fails.

It is a development tool. It does not ship in the package (`package.json#files`
lists neither `scripts/context-ledger` nor its inputs) and the repository does
not depend on the tokenizer it counts with.

## Run it

```sh
# once per machine: the real BPE tokenizer, into a cache outside the repository
node scripts/context-ledger/install-tokenizer.mjs

# a built checkout (npm run build:cached), measured from any directory
REA_BROWSER_EXECUTABLE=/path/to/chromium \
  node scripts/context-ledger/run.mjs --rea /path/to/checkout \
  --check scripts/context-ledger/ceilings.json
```

A complete default run takes about two minutes on a 4-CPU machine shared with
other work; `--full` adds the full CLI census, about two more. The ledger runs
one REA process at a time and stops every process it starts.

| Option                    | Meaning                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--rea <dir>`             | The built checkout to measure: its `scripts/rea.mjs`, its skill, its fixtures.                                                                                                      |
| `--only <ids>`            | Comma-separated row ids or prefixes (`mcp`, `cli.census`, `skill.body`).                                                                                                            |
| `--out <dir>`             | Where `ledger.json` and `ledger.md` go (default `<work>/report`).                                                                                                                   |
| `--check <file>`          | Compare with a ceilings file; exit 1 when a row breaks its ceiling.                                                                                                                 |
| `--full`                  | Run the full in-repository CLI census (105 calls) as well as the quick one (15).                                                                                                    |
| `--require-real-tokens`   | Exit 3 when the tokenizer is missing, and fail every o200k ceiling it cannot check.                                                                                                 |
| `--work <dir>`            | Work folder (default `/tmp/rea-context-ledger`); emptied at the start. Paths under it appear in REA's answers, so compare runs made with the same `--work`.                         |
| `--tokenizer-dir <dir>`   | Tokenizer cache (default `$REA_LEDGER_TOKENIZER_DIR` or `~/.cache/rea-context-ledger/tokenizer`).                                                                                   |
| `--browser <file>`        | Chromium for the clone-loop rows (default `$REA_BROWSER_EXECUTABLE`). Without one, those rows are marked not measured. `REA_BROWSER_NO_SANDBOX` is passed through (default `true`). |
| `--port <n>`              | First of two loopback ports for the fixture servers (default 5380).                                                                                                                 |
| `--node <file>`           | Node.js that runs REA (default the one running the ledger; the baselines used 22.23.5, on which the SQLite inspector answers that it needs Node 24.15).                             |
| `--census-inputs <dir>`   | Use another directory as the census `inputs/` (for reproducing the audit with its own inputs).                                                                                      |
| `--keep-raw <dir>`        | Keep every reply the ledger measured, for inspection.                                                                                                                               |
| `--write-ceilings <file>` | Lower the ceilings in `<file>` to this run's values (see below).                                                                                                                    |

Exit status: 0 measured (and within the ceilings when `--check` was given), 1 a
ceiling was broken, 2 a usage or setup error, 3 real tokens required but absent.

## Units

Every row that measures text is counted three ways:

- **bytes**: UTF-8 bytes of what the agent receives;
- **tokenx**: REA's own estimate, the estimator behind `rea --token-count`
  (`tokenx`, already a dependency);
- **o200k**: real BPE tokens, `o200k_base` through `gpt-tokenizer` 4.1.2, the
  audit's proxy. No tokenizer for Anthropic's models exists offline, so those
  counts are not taken. tokenx is off by +23% to -39% against o200k depending
  on content, so it is reported but rarely used as a ceiling.

When the tokenizer is absent the ledger still runs: bytes and tokenx are
reported, o200k columns read "not measured", and rows whose ceiling is in o200k
are left unchecked (failed with `--require-real-tokens`).

## Rows

Each row answers one row of the plan's J1 table where there is one. The audit
column is the number the audit published for commit 77500a5; the measured
columns are this ledger on that commit (`baselines/rea-snap-77500a5.json`) and
on 0e089b3 (`baselines/rea-judge-0e089b3.json`), both with the default `--work`.

| Row                              | Unit                     | Plan row                               |                                Audit |   77500a5 |   0e089b3 |
| -------------------------------- | ------------------------ | -------------------------------------- | -----------------------------------: | --------: | --------: |
| `mcp.ten-calls.default`          | o200k                    | Ten MCP calls, default arguments       |   118,999 (94,516 tokenx; 342,377 B) |   118,156 |   118,158 |
| `mcp.ten-calls.summary`          | o200k                    | Ten MCP calls, summary asked each time |     11,837 (12,136 tokenx; 44,694 B) |    10,912 |    10,914 |
| `mcp.status.default`             | bytes                    | Default status call                    |                               18,613 |    18,613 |    18,615 |
| `mcp.bundle.default`             | bytes                    | -                                      |                              350,811 |   349,452 |   349,452 |
| `mcp.page.one-row`               | bytes                    | -                                      |                                7,850 |     7,655 |     7,655 |
| `mcp.catalogue`                  | tokenx                   | -                                      |                               97,146 |    97,146 |    97,146 |
| `mcp.catalogue.model-visible`    | o200k                    | -                                      |                               70,015 |    70,015 |    70,015 |
| `mcp.instructions`               | o200k                    | -                                      |                                  488 |       488 |       488 |
| `guidance.search.mean`           | o200k                    | Guidance search reply                  |                                1,748 |     1,748 |     1,751 |
| `guidance.search.no-match`       | count                    | -                                      |                                    2 |         2 |         2 |
| `cli.census.largest`             | bytes                    | CLI census, largest first answer       |            1,022,291 (same 15 calls) | 1,022,084 | 1,022,084 |
| `cli.census.total`               | bytes                    | CLI census, total first-answer bytes   |            1,562,267 (same 15 calls) | 1,487,216 | 1,487,218 |
| `cli.census.over-2000`           | count                    | -                                      |                    9 (same 15 calls) |         9 |         9 |
| `cli.census-full.largest`        | bytes, --full            | CLI census, largest first answer       |               15,886,925 (121 calls) | 1,023,454 | 1,023,454 |
| `cli.census-full.total`          | bytes, --full            | CLI census, total first-answer bytes   |               24,792,993 (121 calls) | 3,892,111 | 3,892,117 |
| `cli.census-full.over-2000`      | count, --full            | -                                      |                       58 (121 calls) |        25 |        25 |
| `cli.mistakes.largest`           | bytes                    | Largest error                          |                            1,022,734 | 1,022,458 | 1,022,458 |
| `cli.help`                       | bytes                    | `rea --help`                           |                               29,484 |    29,484 |    29,651 |
| `cli.help.command`               | bytes                    | -                                      |                                2,096 |     2,096 |     2,096 |
| `cli.setup.one-client`           | o200k                    | Setup output for one client            |                    11,207 (34,011 B) |     6,675 |     6,675 |
| `cli.progress.stderr`            | bytes                    | -                                      |                                5,159 |     5,159 |     5,159 |
| `skill.body`                     | o200k                    | Skill body                             |                               10,840 |    10,840 |    10,840 |
| `skill.lines-lost-at-carry-over` | lines                    | -                                      |     382 (cut at line 307 of skills/) |       381 |       381 |
| `skill.loaded-per-request`       | o200k                    | Skill loaded per request (15 requests) |                               14,080 |    14,080 |    14,115 |
| `skill.routes-clear`             | count (higher is better) | Routes clear on the 15 requests        |                                    7 |         7 |         7 |
| `clone.loop.stdout`              | o200k, timing            | Clone loop stdout per scenario         |                   32,166 (116,804 B) |    30,959 |    31,183 |
| `clone.verdict.ten-items`        | chars, timing            | Ten-item verdict                       |                               11,126 |     8,006 |     8,050 |
| `clone.behavior`                 | bytes, timing            | behavior/ on the trial replay          |                 81,011 (topics.json) |    81,011 |    81,011 |
| `clone.step-read`                | o200k, timing            | One step read                          | 2,056 to 15,947 (trial, not fixture) |     1,504 |     1,511 |

What each row runs:

- **mcp.\***: one `rea mcp` server per session, spoken to over stdio by a
  small JSON-RPC client (no SDK), in a throwaway home. A reply is measured as
  the text blocks a client forwards, joined by newlines. The ten calls are the
  audit's task: guidance search, open a zip, inventory, static JavaScript
  analysis, a page of modules, a HAR, static against observed endpoints, an
  OpenAPI document, a native helper's hardening, saving the Evidence; once
  with default arguments, once with `detail: "summary"` wherever a tool takes
  it.
- **guidance.\***: `rea guidance --query <q>` in the CLI's default format for
  the twenty queries in `inputs/guidance-queries.json`.
- **cli.census.\***: first calls with `--json` appended, from
  `inputs/cli-census.jsonl` (the audit's baseline specs that need only
  in-repository inputs). A call is successful when it exits 0 or prints a
  verdict or health report with its own exit, as in the audit.
- **cli.mistakes.largest**: the audit's typical mistakes
  (`inputs/cli-mistakes.jsonl`), after two setup calls that create the files
  the "already exists" mistakes collide with.
- **cli.help\***, **cli.setup.one-client**, **cli.progress.stderr**: the text
  itself; setup runs with `--dry-run` in a home of its own.
- **skill.\***: the authored skill under
  `.agents/skills/reverse-engineer-anything`. The routing rows come from
  `inputs/skill-routes.json` (see "Redo the skill trace").
- **clone.\***: the fixture original and clone of `tests/fixtures/cloneRun`
  served on two loopback ports; `init-clone-run`, an evaluation of the empty
  folder, the main scenario and declared differences added the way the
  repository's own end-to-end run adds them, then evaluate and run each
  printed capture command after restarting its side, until the verdict is done
  or eight rounds pass. A `rea` shim on `PATH` makes the printed commands read
  `rea ...` whatever the checkout's path. The ten-item verdict copies the
  finished folder, adds the download and export scenarios and edits the clone
  after capture.

## What it does not show

These are bytes and proxy tokens, not agent success. A smaller answer that
leaves out what the agent needed lowers a row and makes the agent worse; the
plan's standing rules (nothing reachable today may become unreachable, a
shorter answer names where the rest is) and the agent benchmarks (J2, J3)
judge that. The ledger also does not measure:

- token counts in Anthropic's own tokenizer (none exists offline);
- calls an agent would make, retries, peak context or total tokens of a run;
- whether a route in the skill is the right one or reads clearly: that is a
  reading judgment, recorded by hand in `inputs/skill-routes.json`;
- behavior/ on the blind trial's run folder (the plan's 2.28 MB): that folder
  is not in the repository. `clone.behavior` is the fixture loop's, a much
  smaller run, and cannot be compared with the plan's figure;
- the full 121-call CLI census of the audit: about a third of its calls need
  inputs built from npm packages or with Go, Rust, Java, Python or a WASM
  toolchain, or files produced by earlier browser captures. Those specs are
  listed as skipped in the full census row's detail. `--census-inputs` with
  the audit's own inputs directory runs them.

## Determinism

Two runs on the same checkout with the same `--work` give the same value for
every row except those marked timing-dependent (`clone.*`): browser captures
differ by a few bytes and digest characters, and a lost reply body can add a
round. Their ceilings carry a 2% tolerance.

Two things are part of every measurement and must be held fixed to compare:

- **paths**. REA prints input and output paths; a longer `--work` makes every
  answer longer by the difference, once per path it prints.
- **digests**. Replies are full of 64-hex-digit identifiers derived from
  content and paths. Equal-length digests cost different numbers of BPE
  tokens, so two checkouts that print byte-identical answers apart from their
  digests differ by up to about 1% in o200k (and tokenx) on digest-heavy rows.
  Treat o200k changes under about 1% on those rows as noise; bytes do not
  have this noise.

## Inputs

Everything the ledger measures REA on is in `inputs/`, as text with an
`.input` suffix on every file (and on `node_modules.input`, which git would
otherwise ignore), so the repository's formatter and linter leave the bytes
alone. Binaries are built at run time: the ten-call task's ELF with
`cc -O1` (byte-identical to the audit's with GCC 13.3 on x86-64), the census
ELF with `cc -g -O0` and `strip`, zip archives with fixed timestamps, a SQLite
file through `node:sqlite`, a safetensors file. An input that cannot be built
(no C compiler, Node without `node:sqlite`) makes the rows that need it read
"not measured" with the reason. Nothing outside the repository is read at run
time except the tokenizer cache and the browser.

## Ceilings

`ceilings.json` holds, per row, the unit, the ceiling and the plan's target:

```json
"mcp.ten-calls.default": { "metric": "o200k", "ceiling": 118158, "target": "at most 20,000", "target_value": 20000 }
```

`--check ceilings.json` fails when a row's value is above its ceiling (below,
for a row marked `"better": "higher"`, such as routes clear), beyond the stated
tolerance for timing-dependent rows. A row with no value on the run (not
selected, no browser, no tokenizer) is reported unchecked.

The ceilings are a ratchet. They were set from 0e089b3, the head of the work
branch when the ledger was written. A change that lowers a row should lower
its ceiling in the same commit:

```sh
node scripts/context-ledger/run.mjs --rea . --full \
  --write-ceilings scripts/context-ledger/ceilings.json
```

`--write-ceilings` only moves ceilings down (up, for higher-is-better rows).
A row that got worse keeps its ceiling and is listed; raising one needs
`--raise-reason "<why>"`, which is recorded under the entry's `raised` with
the commit. Write the reason for a reader who was not there. Targets are the
plan's and change only when the plan does.

## Add a row

1. Describe it in `lib/rows.mjs` (`ROWS`): what it measures, the unit its
   ceiling is read in, which way is better, the plan row it answers, and why it
   is timing-dependent if it is.
2. Produce it in the section file under `rows/` that owns its kind of
   measurement, and add its id to that section's list (`MCP_ROWS`,
   `CLI_ROWS`, `SKILL_ROWS`, `CLONE_ROWS`). Use `context.count(text)` for the
   three units, `measuredRow` for a value and `skippedRow` with a reason when
   it cannot be measured on this run.
3. Keep inputs small and in `inputs/` with the `.input` suffix; build binaries
   at run time.
4. Run the ledger twice and confirm the row is the same both times, or mark it
   timing-dependent with the reason.
5. Record its value with `--write-ceilings`, add the plan's target by hand,
   and refresh the baselines (`--full --out` and copy `ledger.json`).

## Redo the skill trace

`skill.loaded-per-request` and `skill.routes-clear` depend on a hand trace:
for each of fifteen requests, the line of SKILL.md that gives the route, the
references the route tells the agent to read, and whether the route is clear.
The trace in `inputs/skill-routes.json` was made by the audit (census-skill
`10-routing-test.mjs`) and is bound to the SKILL.md body by its SHA-256. When
the body changes, both rows read "not measured: needs a new trace". To redo
it, read the new body as an agent would for each request in the file, update
`route_file_line`, `anchor` (that line, verbatim), `references`, `verdict` and
`clear`, then set `skill_body_sha256` to the new body's digest (frontmatter
removed: the text after the closing `---` line). The ledger prints the digest
it expects in the row's reason.

## Reproducing the audit

The ledger reproduces the audit's published numbers on 77500a5 where the
inputs and paths can be the same. Commands, from the worktree:

```sh
S=<a folder whose path has the length of the audit's scratch folder>
node scripts/context-ledger/run.mjs --rea /path/to/77500a5 --only mcp --work "$S"
node scripts/context-ledger/run.mjs --rea /path/to/77500a5 --only cli.census,cli.mistakes \
  --full --census-inputs <the audit's census inputs folder>
```

| Audit number                                                                                                                                                                                              | Ledger on 77500a5                                                                                                                                                                     | Why they differ                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ten calls with summaries: 44,694 B, 12,136 tokenx, 11,837 o200k                                                                                                                                           | 44,694 B, 12,161 tokenx, 11,889 o200k (`--work` of the audit's path length)                                                                                                           | Bytes are identical call by call. With 64-hex identifiers masked, all ten replies are the audit's text exactly. The identifiers derive from content and paths, which differ in characters though not in length, and equal-length hex strings cost different numbers of tokens: +0.2% tokenx, +0.4% o200k.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Ten calls with default arguments: 342,377 B, 94,516 tokenx, 118,999 o200k                                                                                                                                 | 342,380 B, 94,539 tokenx, 119,053 o200k (same `--work`)                                                                                                                               | As above; the 3 bytes are the inventory of the zip the ledger builds (the audit's was made by another zip tool).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Default status 18,613 B; catalogue 97,146 tokenx (352,159 B, 78,806 o200k); model-visible 70,015 o200k; instructions 488 o200k; one-row page 7,850 B                                                      | identical                                                                                                                                                                             |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Default evidence bundle 350,811 B                                                                                                                                                                         | 350,817 B (same `--work`)                                                                                                                                                             | the zip, as above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Guidance search mean 1,748 o200k; `rea --help` 29,484 B; one command's help 2,096 B; progress on standard error 5,159 B (1,167 o200k); skill body 10,840 o200k; loaded per request 14,080; routes clear 7 | identical, also with the default `--work`                                                                                                                                             |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 5,000-token carry-over cuts at file line 307; 382 of 681 body lines lost                                                                                                                                  | body line 300 in both; file line 306; 381 of 680 lines                                                                                                                                | The audit cut the packaged copy under `skills/`, which has one more frontmatter line, and counted the empty string after the final newline as a line. The ledger reads the authored copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Setup for one client about 11,207 o200k (34,011 B)                                                                                                                                                        | 11,405 o200k (34,486 B) with a home path about as long as the audit's; 6,675 (26,346 B) with the default `--work`                                                                     | Setup's dry run prints configuration paths under `$HOME` for 43 clients, so its size follows the length of the home directory's path. The plan's figure is a property of the audit's home path as much as of REA.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Largest error 1,022,734 B                                                                                                                                                                                 | 1,022,786 B with the audit's inputs; 1,022,458 B with the repository's                                                                                                                | +13 bytes per printed path: the ledger's census folder was 13 characters longer. The repository's inputs differ from the audit's (another ELF build, another zip).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CLI census: largest 15,886,925 B; total 24,792,993 B over 121 successful calls; 58 over 2,000 tokens                                                                                                      | With the audit's inputs: largest 15,886,964 B, 69 successful of 105 calls, 20,560,767 B, 33 over 2,000. With the repository's inputs: largest 1,023,454 B, 54 of 87, 3,892,111 B, 25. | Cannot be reproduced from the repository: 64 of the audit's 169 baseline calls need files from earlier captures, a browser target or a clone run, which the census does not replay; 18 more need inputs that are not in the repository (Go, Rust, Java, Python and WASM builds, a V8 code cache, a NuGet package, and the 27 KB bundle of three npm packages behind the 15.9 MB answer). With the audit's inputs, 24 of 105 answers are byte-identical and the rest differ by 13 bytes per printed path, except: `guided-workflows.render` (two audit specs share the id; the ledger keeps the first, the audit's table the other's result), `doctor`, `doctor.target`, `providers`, `capabilities`, `list-cutter-sessions` and `setup.dry-run` (the audit used the real home directory; the ledger always a throwaway one), `inspect-desktop-application` and `extract-artifact.*` (they print one path per file), and `inspect-sqlite-database*`, one byte shorter (not investigated). The quick census's 15 calls on the audit's results: largest 1,022,291 B, total 1,562,267 B, 9 over 2,000; the ledger with the audit's inputs prints 1,022,330 and 1,562,478 (paths) and 9. |
| Clone loop 32,166 o200k (116,804 B)                                                                                                                                                                       | 31,923 (116,044 B) in a scratch folder; 30,959 with the default `--work`                                                                                                              | Same loop: init, an evaluation of the empty folder, round 1, four captures, round 2 done. Captures are within 1 byte of the audit's. The referee's printed commands read `rea ...` here (a shim on `PATH`) where the audit's read `node /home/user/rea-snap/scripts/rea.mjs ...`, and the run folder's path differs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Ten-item verdict 11,126 characters                                                                                                                                                                        | 8,006                                                                                                                                                                                 | The same ten items (two missing captures per side for download and export, two stale clone captures of topics); shorter by the `rea` spelling and the paths in each of the ten commands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| behavior/topics.json 81,011 B                                                                                                                                                                             | 81,011 B                                                                                                                                                                              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| One step read 2,056 to 15,947 tokens                                                                                                                                                                      | 1,504 o200k                                                                                                                                                                           | The audit's figures are on the blind trial's 242-step capture; the ledger reads step 1 of a 47-step fixture capture.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
