# Routing follow-up: what real agents ran into (benchmark run r1)

Source: `bench/results/tasks/2026-11-21-r1-notes.md` and the agents' own friction reports in
`fork/program/bench-r1-reports.json`. Every task was answered right on both builds, so these
are about turns and context, not correctness. This file decides what is done about each. The judge is the
same benchmark, run again on the build that carries the changes: fewer turns and no lost answers.

## Decisions

1. **The tools route the long tail, not the skill.** The router lists fifteen first steps and cannot list
   sixty formats. For a file an agent cannot place, the route is one call: `inspect_artifact` (CLI
   `rea inspect-artifact <path> --detail summary ...`) must name, for every format REA has a path inspector
   for, the inspector to run next, as a command that runs as printed. Today that table covers six operations
   and is wrong for a core file and a single JavaScript file (audit, census-skill opportunity 5). Files it
   must place include the ones agents missed in r1: an OpenAPI or GraphQL file, an ELF with debug
   information, EVM bytecode, a HAR, a SQLite file, a Python bytecode file, a model file. At most eight next
   probes per reply, about 20 tokens each. The skill gets one line: a file you cannot place goes to
   `inspect_artifact` first.
2. **A native binary with no analysis provider.** The refusal for a missing provider (3,570 bytes today)
   becomes one line per provider candidate with its fix, followed by the commands that work without one
   for that file: the path inspectors for its format, `inspect-with-objdump` for symbols and the
   disassembly of one function, and `debug-with-gdb` for reading code and data without running the program.
   The skill's refusal rule names the same two commands. `debug-with-gdb` must not need an inferior terminal
   when the program is not run, or its help must show the working static form.
3. **Searching for a command by a word.** `rea help <words>` that matches no family searches command names
   and their one-line descriptions and prints the matches, each with its one line. `rea guidance --query`
   must not answer `no_matches` for a word that is a command's name or is in its description: it returns the
   command's help pointer as a match. (The guidance package is changing ranking now; this builds on it.)
4. **The summary path must be cheaper than the full output, or it is not the default path.** For the HAR
   inspector the summary path cost thirteen turns against six. Three causes, each fixed where it lives:
   - a summary names the views that exist for its record, each as a command that runs as printed (the views
     package);
   - the evidence-file source's refusal for a bundle shows the working form with the id it needs;
   - `--filter-output` slices: the refusal for `[a,b,c]` shows the accepted form, and a path that selects a
     member of every row without an index (`items.reported`) works as the obvious projection.
     The answer budget's digest supersedes much of this for the CLI: its next commands must work as printed.
     The benchmark's HAR, archive, version-diff and page-click tasks are the check.
5. **CLI spellings in the first-step list.** Where a listed first step has a positional argument a reader
   cannot guess (the capture kind of the HAR inspector, the encoding of the EVM inspector), the CLI form in
   the body shows it.
6. **Skill size.** The body is at its limit (1,496 of 1,500 tokens). Decisions 1, 2 and 5 add three lines;
   the limit moves to 1,650 real tokens and 1,950 by the repository's estimate, and no further.

## Order

After the guidance and help package and the answer-budget core are merged: one package for decisions 1, 2,
3 and 5 (tool-side routing and the skill lines), and the views package for decision 4 together with the
audit's "limitations once" and "findings first" items.
