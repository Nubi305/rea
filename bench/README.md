# Agent benchmarks for REA

These benchmarks measure agents using REA: whether they get the right answer,
and what it costs them in context. Two benchmarks share one harness.

- **Clone benchmark.** A fresh agent that has only the installed skill and the
  CLI clones a web application it has never seen. The score is the referee's
  verdict, agreement with the application's hidden rules, and the cost.
- **Task benchmark.** A fresh agent answers one small reverse-engineering
  question per task. The score is each expected fact right or wrong, whether
  its first REA command was the expected one, and the cost.

The harness has three parts and none of them calls a model:

1. **prepare** creates a cell: a workspace for one agent and the prompt it
   receives.
2. **the agent runs.** Here that is the workflow tool, launched by the lead
   with `harness/workflows/bench-cells.js`. Its transcript is the record.
3. **score** reads the workspace and the transcript and prints JSON.

The first half of this page is for whoever runs it. The second half says what
each number means and what it does not show: read that before quoting one.

## Running it

Every command runs from the repository root. Set these once:

```bash
REA=/path/to/checkout-under-test   # built; the build being measured
JUDGE=/path/to/judge-checkout      # built; the same for every row you compare
CLIENT=...                         # a client id `rea setup --client` accepts:
                                   # the client the agents run in
RUNS=/path/outside/every/checkout  # where cells go
OFF="--forbid /path/to/another/checkout --forbid /path/to/the/next"
```

`OFF` lists every other REA checkout and every other place on the machine
with answers in it (application sources, earlier runs, design notes). The
checkout under test and this repository are forbidden without being listed.
The paths go into the prompt, and a read under one is counted as a rule break.

Before the first run, and after any change to the harness:

```bash
node bench/harness/selftest.mjs --judge $JUDGE --ports 5300,5301 --client $CLIENT
```

It needs about two minutes and must end with every check passed.

### Clone benchmark

```bash
# 1. prepare: one cell per run. The two ports must be free.
node bench/harness/clone-prepare.mjs --app varnholt --workspace $RUNS/varnholt-a \
  --rea $REA --client $CLIENT --clone-name "Larkspur Desk" \
  --original-port 5310 --clone-port 5311 --id varnholt-a $OFF

# 2. the arguments of the workflow: labels and prompts of the prepared cells
node bench/harness/workflow-args.mjs --cell $RUNS/varnholt-a.cell/cell.json \
  > $RUNS/clone-args.json

# 3. launch bench/harness/workflows/bench-cells.js with the workflow tool,
#    passing the content of clone-args.json as args. Note the run's
#    transcript directory (it holds agent-<id>.jsonl files).

# 4. score, about a minute. It stops both applications.
node bench/harness/clone-score.mjs --workspace $RUNS/varnholt-a \
  --transcript /path/to/the/run/transcripts --judge $JUDGE \
  --out bench/results/clone/2026-11-22-varnholt-a.json
```

- `--id` names the cell; the agent's label is `bench:clone:<id>`. Give every
  cell of one workflow run its own id.
- `--clone-name` may not contain a product name of the original.
- To run a cell on a named model, write `--cell <cell.json>=<model>` in
  step 2. Each model needs its own cell: a workspace is used once.
- `--minutes` changes the time box in the prompt (80 by default, as in the
  first trial); `--spare-ports` tells the agent about more ports.
- A cell that is never scored leaves its original running:
  `$RUNS/varnholt-a.cell/original-ctl.sh stop` stops it.

### Task benchmark

```bash
# 1. prepare every task into one root. One free port, for the task with a page.
node bench/harness/task-prepare.mjs --root $RUNS/tasks-a --rea $REA \
  --client $CLIENT --node /path/to/node-24.15-or-newer --tag a --port 5330 $OFF

# 2. the arguments of the workflow
node bench/harness/workflow-args.mjs --root $RUNS/tasks-a > $RUNS/task-args.json

# 3. launch bench/harness/workflows/bench-cells.js with the workflow tool,
#    passing the content of task-args.json as args.

# 4. score every cell of the root. It stops the page's server.
node bench/harness/task-score.mjs --root $RUNS/tasks-a \
  --transcripts /path/to/the/run/transcripts \
  --out bench/results/tasks/2026-11-22-tasks-a.json
```

- `--node` is the Node that runs REA for the agent. `t07-sqlite-contents`
  needs 24.15 or newer; on an older one prepare skips it and says so (exit
  status 2).
- `--tag` goes into the labels (`bench:task:<task>.<tag>`). Use one root and
  one tag per model and per build: `--root $RUNS/tasks-b=<model>` in step 2
  names the model for that root, and several `--root` can go into one launch.
- `--task <id>` (repeatable) limits any of the steps to some tasks.
- Unless `--task` leaves it out, the root holds `t00-floor`; its transcript
  is the floor that step 4 takes off the others (see
  [The floor](#the-floor)).

### Without an agent

```bash
# Can this build still answer every task, and what does the reference route print?
node bench/harness/task-proof.mjs --rea $REA --node /path/to/node-24.15-or-newer

# Does an application fit the layout, and do its held-out scenarios hold?
node bench/harness/clone-check-app.mjs --app varnholt --judge $JUDGE --ports 5300,5301

# Score files as Markdown tables
node bench/harness/results-table.mjs --tasks bench/results
```

`task-proof.mjs` is a deterministic companion to the task benchmark: it runs
each task's reference route (`proof.steps` in `task.json`) and its naive first
call, checks that REA's output still holds every expected value, and prints the
bytes. `--write` records the result as `proof.json` beside each task; the
committed ones were measured on 0e089b3.

### Things that bite

- **A long `TMPDIR` stops the browser.** With a temporary directory path of
  93 characters Chromium did not start ("The selected browser could not
  start"). Leave `TMPDIR` unset or short.
- **Ports.** Prepare refuses a taken port. Chromium refuses some ports
  outright (5060, 5061, 6000 and others).
- **One heavy thing at a time.** A clone cell runs servers and a browser, so
  the workflow runs clone cells one after another and task cells together.
  `--parallel` or `--one-at-a-time` on `workflow-args.mjs` overrides that.
  The workflow tool documents its own cap: the number of CPUs minus two
  agents at once.
- **Labels find transcripts.** A score looks for the one agent with the
  cell's label in the directory you give it. Two agents with one label in one
  directory is an error; pass the transcript file instead.
- **The hub talks too.** Agents launched from a hub get the hub's own
  instructions. In the first trial the agent read a 6.9 KB hub file before
  starting. Such reads are in "other" and in `largest_results`.

## What a cell is

```
$RUNS/varnholt-a/            the workspace: all the agent is given
  bin/rea                    shim for the checkout under test
  home/                      throwaway home; the skill is installed here
  clone/  run/               empty: the clone's source and the run folder
$RUNS/varnholt-a.cell/       the cell directory: not for the agent
  cell.json                  the cell description the scorer reads
  prompt.md                  the prompt, byte for byte
  original/                  private copy of the application, running
  original-ctl.sh            the one control command the agent is given
  rea-calls.tsv              every REA call the shim saw
  setup.json                 what `rea setup` printed
```

A task cell has `input/` (the task's inputs, built from the sources in
`bench/tasks/<id>/`) instead of `clone/` and `run/`, and the agent writes
`answer.json` into the workspace. The page of `t12-page-click-request` is
served from a private copy in the cell directory.

The shim sets `HOME` to the throwaway home and then becomes the REA process,
so exit status, signals and output are REA's own, and no REA command of a cell
can write to the real home. Before that it appends one line to
`rea-calls.tsv`: time, process id, command, and whether it was a run, a help
or a schema call.

The prompts are in `harness/lib/prompts.mjs`. The clone prompt is the first
trial's cloner prompt with two differences that the task set: the skill is
already installed (the first agent installed it itself and read 25,295 bytes
of setup output), and the original is running when the agent starts. Change
anything else in it and later rows stop being comparable with earlier ones.

An agent under test reaches REA through the CLI and the installed skill files
only. Workflow agents cannot be given a private MCP server, so nothing here
measures REA's MCP surface: not the tool list, not tool search, not MCP
replies. The deterministic context ledger covers those.

## What each number means

### Referee (clone)

`referee.verdict` and `referee.exit_status` come from running
`evaluate-clone-run --exit-code --json` of the checkout under test on a copy
of the run folder: 0 is `done` or `done_with_waivers`, 1 `not_done`, 2
`stalled`. `referee.by_judge` is the same evaluation by the judge checkout.
`referee.recorded_in_run_folder` is the verdict the agent's own last
evaluation left in `gate.json`, and `recorded_differs` says when it is not the
recomputed one.

It does not show that the clone is right. It shows what the referee concludes
from the Evidence the agent recorded. Builds differ: the first trial's run
recorded `stalled`, and two later builds read the same folder as `not_done`.

### Hidden rules (clone)

Both applications are restarted clean, each held-out scenario is captured
twice per side through the judge checkout, and
`compare-scenario-behavior --detail complete` compares them under the
application's volatile fields plus one rename per product name to the clone's
name. `hidden.steps` are the judge's own step counts. A rule `agrees` when
every step it cites is `unchanged`, `disagrees` when one is `changed`, and is
`undecided` otherwise. `bench/clone/README.md` has the details.

- The original runs from the repository's copy, never from the cell's, so the
  agent cannot have changed it. The clone is restarted with the commands the
  run's own `target.json` records (`clone.commands.reset` and `stop`). A run
  that recorded none is `measured: false`.
- Agreement is only as wide as the held-out scenarios. The first trial's clone
  agrees on 23 of 23 rules here, while a person probing by hand found two
  rules it only partly matched (a rounding at exact half-way values, the text
  of one error message), neither on a step the scenarios take.
- The start page counts as a step. The first trial's clone reworded the About
  page, so `scenario_start` is `changed` in both scenarios (77 of 79 steps
  unchanged) and no rule cites it.
- The judge is pinned so that a change in the comparer cannot move this
  number between two rows. Change the judge and every row has to be scored
  again.

### Facts and first command (tasks)

`facts` lists each expected fact with `right: true` or `false`; a task is
`right` when all are. `task.json` gives the exact expected values. Comparison
forgives surrounding spaces, runs of spaces and the difference between `12`
and `"12"`; a fact marked `ignore_case` also forgives letter case; a set
ignores order and refuses an extra member. A missing field is wrong.

`first_command` compares the first REA command the agent ran to work on the
request with the task's `first_command.expected`. Help, schema and guidance
calls before it are counted (`rea_calls_before_it`), not judged. The result is
`expected`, `accepted` (a first step the task also allows, such as identifying
the file first), `other` or `none`. For the tasks whose naive first call
floods, `economical` says whether that first call carried one of the flags
that bound it.

- Right facts do not show that REA produced them. The prompt forbids opening
  the inputs with anything else, and `other_tool_use` lists every command that
  names an input and is not a REA command. Writing a scenario file that names
  an input looks the same as reading the input, so that list is for a person
  to read.
- `t18-process-run` is expected to fail on 0e089b3: the scenario file's fields
  are in no text an agent can reach through the CLI (`known_gap` in its
  `task.json`). It is there to show when that changes.

### Cost

All token counts are the provider's own, read from the transcript; a streamed
reply appears several times under one message id and is counted once.

| Field                      | Meaning                                                                      |
| -------------------------- | ---------------------------------------------------------------------------- |
| `turns`                    | replies of the model                                                         |
| `peak_context_tokens`      | the largest prompt of any turn: input, cache reads and cache writes together |
| `first_turn_prompt_tokens` | the prompt of the first turn: what the agent starts with                     |
| `prompt_tokens_all_turns`  | every turn's whole prompt added up, cached or not                            |
| `uncached_prompt_tokens`   | the part of that not read from the cache: input plus cache writes            |
| `output_tokens`            | everything the model wrote, including its thinking                           |
| `tool_calls`               | tool calls of any kind                                                       |
| `wall_minutes`             | first to last line of the transcript                                         |
| `model`                    | the model id as the transcript gives it                                      |
| `net_of_floor`             | the same with the harness floor taken off; null when no floor was given      |

`prompt_tokens_all_turns` grows with the square of a run's length, because
every turn sends the whole conversation again; most of it is read from the
cache. It is the number to watch for "how much did the agent have to carry",
and not a price. A run that compacts or resets its context shows a drop
between turns that these totals hide; no run has done so yet.

### What filled the context

Per tool result the transcript records text, not tokens, so this part is in
bytes. Every tool result falls into one of three buckets:

| Field              | Meaning                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| `context.rea`      | results of commands that ran REA, with `by_command` splitting them by REA command  |
| `context.skill`    | results of reads under the installed skill, with `by_file`                         |
| `context.other`    | every other tool result                                                            |
| `tool_input_bytes` | what the agent itself wrote as tool arguments: its commands and the files it wrote |
| `prompt_bytes`     | the prompt                                                                         |
| `largest_results`  | the eight largest tool results with their bucket                                   |

- A result is what reached the agent, after any `| head` of its own, not what
  REA printed. Reading a file REA saved earlier, with a script or a pager,
  counts as "other": only a command that runs REA counts as REA.
- A command line that runs several REA commands has its result divided
  equally among them, because the text does not say which printed what.
  `rea --help | head; rea x --help` splits one result in two halves.
- Which REA commands a command line runs is read from its text
  (`harness/lib/shell.mjs`): direct calls, calls through a variable, and
  scripts the agent wrote earlier in the same session. A loop counts once.
  Keys are the command, or the command with `--help` or `--schema`.
- `rea_invocations.from_shim_log` is the exact count from the shim, loops and
  scripts included. Where the two disagree, the shim is right about how many
  commands ran and the transcript is the only source for what reached the
  context.
- Bytes are not tokens. The context audit measured between 2.7 and 4.3 bytes
  per token on REA's outputs, fewest where an output is dense with hex ids;
  the context ledger has the ratio per command.

### Captures (clone)

`captures.by_shim_log` is the number of `capture-browser-scenario` runs the
shim saw: the number to quote. `in_transcript_text` counts them in command
text and is a lower bound. `evidence_files_in_run` is what the run folder
holds at the end. The first trial predates the shim: its row says "at least
28", and 48 Evidence files were left.

### Rule breaks

`rule_breaks` lists every tool call that names a path under a forbidden root:
a REA checkout, the cell directory, the original's source. Running the
original's control script is the one allowed use; reading it is not. A
recursive search rooted above a forbidden path is listed as
`search-covering-...`. A listed break is a mention to look at, not proof of a
read: the excerpt shows the command.

### The floor

An agent that does nothing still pays for the client's system text, its tool
list, the hub's instructions and the prompt. `t00-floor` measures that: its
prompt asks for a trivial answer file and says nothing about REA.

`task-score.mjs --root` takes the floor of the same root off every other cell
(`cost.net_of_floor`). For a clone cell, or a root without one:

```bash
node bench/harness/floor.mjs --transcript /path/to/transcripts \
  --label bench:task:t00-floor.a --out $RUNS/floor.json
node bench/harness/clone-score.mjs ... --floor $RUNS/floor.json
```

The floor's first prompt is in every turn of every run, so it comes off the
peak once and off `prompt_tokens_all_turns` once per turn:

```
net peak   = peak_context_tokens - floor.first_turn_prompt_tokens
net prompt = prompt_tokens_all_turns - turns * floor.first_turn_prompt_tokens
```

A floor belongs to one model, one client version and one hub; measure it in
the run it is taken off. No floor cell has been run yet. As an indication only:
the first turn of the first trial's cloner was 64,804 tokens with a 4,118-byte
prompt, so most of that is floor.

## Limits

- **One run is one sample.** The same cell run twice gives different numbers.
  Nothing here says how different; run a cell several times before reading a
  small difference as an effect.
- **CLI and skill files only**, as said above.
- **The agent is told to read the skill.** A workflow agent has no skill
  mechanism for a private home, so the prompt points it at `SKILL.md`. Whether
  a client would have triggered the skill on its own is not measured.
- **Tokens depend on the client.** The floor, tool definitions and how results
  are cut are the client's; numbers from two clients are not comparable
  without each one's floor.
- **Hidden agreement needs a clone that starts.** A clone whose recorded reset
  command fails is scored `measured: false`, the same as one that recorded no
  command.
- **Scoring changes nothing in the workspace**, except what the clone itself
  writes when it is started. `clone_tree.changed_by_scoring` says when that
  happened.

## The transcript reader, and a second driver

Everything the scorers know about an agent comes through one function,
`readTranscript(file)` in `harness/lib/transcript.mjs`. It returns:

```
{ file, label, started_at, ended_at, prompt,
  turns:      [{ id, at, model, prompt_tokens, uncached_prompt_tokens, output_tokens }],
  tool_calls: [{ id, name, input, at, result_at, result_text, result_bytes, is_error }],
  final_output }
```

`findTranscript(where, label)` picks the file: the one whose
`agent-<id>.meta.json` has `description` equal to the label, or `where` itself
when it is a `.jsonl` file.

A driver for a headless command-line agent, one command per cell, must:

1. start a fresh session whose first message is the cell's `prompt.md`, byte
   for byte, with a shell and file tools and nothing that knows REA (no REA
   MCP server, no other copy of the skill);
2. leave a transcript from which the shape above can be read: every model
   reply with its token counts (uncached input, cache reads, cache writes,
   output), every tool call with its input and the text of its result, and a
   time on each;
3. name the transcript by the cell's label, or hand its path to the scorer.

Teach `readTranscript` the driver's format and nothing else has to change:
the cost, context and rule-break readers and both scorers work on the shape,
and the tool names they know are `Bash` (`input.command`), `Read`, `Write`,
`Grep` and `Glob` (`input.file_path` or `input.path`).

## The tasks

Each task is `bench/tasks/<id>/`: `task.json` (the question, the inputs and how
they are built, the answer fields, the expected facts, the expected first
command and the reference route), `proof.json` (that route measured on
0e089b3) and the sources of the inputs. The repository tracks no binaries:
`task-prepare.mjs` builds them with `gcc`, `go`, `python3` and Node, and hides
the source paths from what it builds.

| Task                      | Question about                                             | First command                    | Reference route   | Naive first call | Audit |
| ------------------------- | ---------------------------------------------------------- | -------------------------------- | ----------------- | ---------------- | ----- |
| `t01-elf-hardening`       | Hardening of an ELF binary                                 | `inspect-binary-hardening`       | 1 call, 4,895 B   |                  | R14   |
| `t02-elf-licence-check`   | How a native program checks its licence key                | `inspect-with-objdump`           | 3 calls, 17,422 B | 262,937 B        | R1    |
| `t03-elf-dependencies`    | Run-time dependencies of an ELF binary                     | `inspect-elf-dependencies`       | 1 call, 5,662 B   |                  |       |
| `t04-elf-debug-sources`   | Source files and optimisation level from debug information | `inspect-dwarf-units`            | 1 call, 4,386 B   | 126,951 B        |       |
| `t05-library-exports`     | What a shared library exports                              | `inspect-native-exports`         | 1 call, 2,725 B   |                  |       |
| `t06-go-binary-identity`  | Which module a Go binary was built from                    | `inspect-go-binary`              | 1 call, 5,260 B   | 351,943 B        |       |
| `t07-sqlite-contents`     | What an application keeps in its SQLite database           | `inspect-sqlite-database`        | 3 calls, 19,147 B |                  | R13   |
| `t08-archive-inventory`   | Inventory of an archive                                    | `inspect-artifact`               | 1 call, 16,176 B  |                  |       |
| `t09-har-failures`        | Failed and slow requests in a recorded HAR                 | `inspect-web-network-capture`    | 1 call, 4,485 B   | 69,823 B         | R11   |
| `t10-openapi-operations`  | Operations of an OpenAPI description                       | `inspect-api-contract`           | 1 call, 6,901 B   |                  |       |
| `t11-version-diff`        | What changed between two versions of a package             | `inspect-artifact`               | 3 calls, 14,157 B |                  | R7    |
| `t12-page-click-request`  | The request a page sends when a button is clicked          | `capture-browser-scenario`       | 2 calls, 10,825 B | 16,370 B         | R9    |
| `t13-python-bytecode`     | What a compiled Python module defines                      | `inspect-python-pyc`             | 1 call, 6,985 B   |                  |       |
| `t14-js-bundle-endpoints` | Endpoints a minified web bundle calls                      | `analyze-javascript-application` | 2 calls, 11,241 B | 986,332 B        | R8    |
| `t15-electron-ipc`        | IPC surface of an unpacked Electron application            | `analyze-javascript-application` | 2 calls, 13,200 B | 644,152 B        | R3    |
| `t16-model-tensors`       | What a model file holds                                    | `inspect-model-artifact`         | 1 call, 5,044 B   |                  |       |
| `t17-evm-selectors`       | Function selectors of contract bytecode                    | `inspect-evm-interface`          | 1 call, 6,477 B   |                  |       |
| `t18-process-run`         | What a command prints and which files it touches           | `capture-process`                | 1 call, 10,023 B  |                  | R15   |

"Reference route" is the bytes REA printed on standard output for the calls
that give every expected fact, with the economical flags an agent has to know.
"Naive first call" is the same question asked the obvious way. "Audit" is the
routing request of the context audit that the task started from. Bytes move a
little with the length of the paths REA echoes.

The questions never name a REA command. A task that REA could not answer in
this container was left out rather than checked more loosely: nothing needs a
native analysis provider (Ghidra, IDA, JADX, Frida, binwalk, pwntools).

To add a task, copy a directory, write `task.json`, and run
`task-proof.mjs --task <id> --write` until the route holds every expected
value.

## Results

`bench/results/clone/` and `bench/results/tasks/` hold score files exactly as
the scorers wrote them; `--note "<text>"` (repeatable) adds free text to one.
Name a file by the date of the run, the application or `tasks`, and the build
or tag. `results-table.mjs` prints them as tables.

The baseline row is the first blind trial (2026-11-20), scored retroactively:

| Run        | Application | Referee                                     | Hidden rules agree | Steps unchanged | Peak context | Prompt tokens, all turns | Output tokens | Minutes | Tool calls | REA result bytes | Skill bytes | Other result bytes | Captures    |
| ---------- | ----------- | ------------------------------------------- | ------------------ | --------------- | ------------ | ------------------------ | ------------- | ------- | ---------- | ---------------- | ----------- | ------------------ | ----------- |
| 2026-11-20 | varnholt    | not_done (exit 1); the run recorded stalled | 23 of 23           | 77 of 79        | 475,393      | 27,111,526               | 226,499       | 50      | 100        | 170,570          | 76,652      | 196,255            | at least 28 |

Its `notes` say what differs from a prepared cell: the build it ran on
(branch head b68840e5 at the time; the verdict was recomputed with 77500a50),
the skill installed by the agent itself, no shim log, and the ports of the
replay. The model is in the file.

### How the scorers were proven

On 2026-11-21, against the judge at 0e089b3:

| Case                                                                                | Expected                          | Scored                                                 |
| ----------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------ |
| Task scorer, hand-written right answer with a synthetic transcript                  | right, first command expected     | right, 4 of 4 facts, `expected`                        |
| Task scorer, hand-written wrong answer, a read under a checkout, `strings` on input | wrong on three facts, both listed | 1 of 4 facts, one rule break, one other-tool use       |
| Clone scorer, the first trial's clone                                               | every rule agrees                 | 23 of 23 agree, 77 of 79 steps unchanged               |
| Clone scorer, a copy of that clone with one error code changed                      | exactly one rule disagrees        | `R09-weight-limit` disagrees, 22 agree, 76 of 79 steps |
| Clone scorer, varnholt against an exact copy of itself                              | every rule agrees                 | 23 of 23 agree, 79 of 79 steps unchanged               |
| Clone scorer, varnholt against the copy with one error code changed                 | exactly one rule disagrees        | `R09-weight-limit` disagrees, 22 agree                 |

`selftest.mjs` repeats all but the two rows about the first trial's clone,
which is not in the repository.

## Files

```
bench/
  README.md                 this page
  harness/
    clone-prepare.mjs       prepare a clone cell
    clone-score.mjs         score a clone cell
    clone-check-app.mjs     check an application and its held-out scenarios
    task-prepare.mjs        prepare task cells
    task-score.mjs          score task cells
    task-proof.mjs          the reference route of every task, no agent
    floor.mjs               the harness floor from a transcript
    workflow-args.mjs       the args of a workflow launch
    results-table.mjs       score files as tables
    selftest.mjs            the harness's own proof; selftest/ holds its cases
    workflows/              bench-cells.js, the script the workflow tool runs
    lib/                    readers and helpers; transcript.mjs is the one to
                            change for another driver
  clone/
    README.md               the layout an application must have
    apps/<id>/              one application: app.json, original/, hidden/
  tasks/<id>/               one task: task.json, proof.json, input sources
  results/                  score files
```

Nothing under `bench/` is part of the published package.
