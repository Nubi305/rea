// Rule breaks an agent's transcript shows: reads under paths the trial rules
// put off limits (the original's source, the hidden folder, a REA checkout).
// A mention is listed for a person to judge; only running the original's
// control script is known to be allowed.
import {
  commandInvocations,
  newShellState,
  noteScript,
  simpleCommands,
  splitHeredocs,
} from "./shell.mjs";

const READERS = new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "sed",
  "awk",
  "grep",
  "egrep",
  "rg",
  "wc",
  "strings",
  "xxd",
  "od",
  "hexdump",
  "cp",
  "diff",
  "cmp",
  "sha256sum",
  "md5sum",
  "vi",
  "vim",
  "nano",
  "tar",
  "zip",
]);
const SEARCHERS = new Set([
  "find",
  "grep",
  "egrep",
  "rg",
  "tree",
  "du",
  "locate",
  "ls",
]);
const PATH_CHARS = /[^\s"'`;|&()<>=,]+/u;

const baseName = (word) => word.slice(word.lastIndexOf("/") + 1);
const under = (path, root) => path === root || path.startsWith(`${root}/`);
const escaped = (text) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Every path under `root` that `text` spells out. */
const pathsUnder = (text, root) => {
  const pattern = new RegExp(
    `(?<![\\w./-])${escaped(root)}(?=/|[^\\w.-]|$)(?:/${PATH_CHARS.source})?`,
    "gu",
  );
  return [...text.matchAll(pattern)]
    .map((match) => match[0].replace(/[.,:]+$/u, ""))
    .filter((path) => under(path, root));
};

const commandWord = (words) => {
  const word = words.find(
    (item) => !(item.bare && /^[A-Za-z_]\w*=/u.test(item.text)),
  );
  return word === undefined ? null : baseName(word.text);
};

const bashBreaks = (command, forbidden) => {
  const found = [];
  const { text, heredocs } = splitHeredocs(command);
  for (const words of simpleCommands(text)) {
    const line = words.map((word) => word.text).join(" ");
    const head = commandWord(words);
    for (const root of forbidden) {
      for (const path of pathsUnder(line, root.path)) {
        const allowed = (root.allow_running ?? []).includes(path);
        if (allowed && !READERS.has(head)) continue;
        found.push({ kind: root.kind, path, how: head ?? "(assignment)" });
      }
      if (SEARCHERS.has(head) && searchCovers(words, root.path))
        found.push({
          kind: `search-covering-${root.kind}`,
          path: root.path,
          how: head,
        });
    }
  }
  for (const heredoc of heredocs)
    for (const root of forbidden)
      for (const path of pathsUnder(heredoc.body, root.path))
        if (!(root.allow_running ?? []).includes(path))
          found.push({ kind: root.kind, path, how: "(script text)" });
  return found;
};

// A recursive search rooted above a forbidden path reads it too.
const searchCovers = (words, root) => {
  const recursive =
    ["find", "tree", "du", "locate", "rg"].includes(
      baseName(words[0]?.text ?? ""),
    ) ||
    words.some(
      (word) =>
        /^-[A-Za-z]*[rR]/u.test(word.text) || word.text === "--recursive",
    );
  return (
    recursive &&
    words
      .slice(1)
      .some(
        (word) =>
          word.text.startsWith("/") &&
          word.text !== root &&
          under(root, word.text.replace(/\/+$/u, "") || "/"),
      )
  );
};

const toolBreaks = (call, forbidden) => {
  const { name, input } = call;
  if (name === "Bash")
    return bashBreaks(String(input.command ?? ""), forbidden);
  const path = String(
    input.file_path ?? input.path ?? input.notebook_path ?? "",
  );
  const found = [];
  for (const root of forbidden) {
    if (path !== "" && under(path, root.path))
      found.push({ kind: root.kind, path, how: name });
    else if (
      ["Grep", "Glob"].includes(name) &&
      path !== "" &&
      under(root.path, path)
    )
      found.push({ kind: `search-covering-${root.kind}`, path, how: name });
    for (const mentioned of pathsUnder(String(input.pattern ?? ""), root.path))
      found.push({ kind: root.kind, path: mentioned, how: name });
  }
  return found;
};

/**
 * Rule breaks in a transcript. `forbidden` lists `{ path, kind,
 * allow_running? }`: nothing under `path` may be read, and the files in
 * `allow_running` may be run (the original's control script) but not read.
 */
export const ruleBreaksOf = (transcript, forbidden) => {
  const breaks = transcript.tool_calls.flatMap((call, index) =>
    toolBreaks(call, forbidden).map((found) => ({
      ...found,
      call: index + 1,
      tool: call.name,
      excerpt: String(
        call.input.command ?? call.input.file_path ?? call.input.path ?? "",
      )
        .replaceAll(/\s+/gu, " ")
        .slice(0, 200),
    })),
  );
  const byKind = {};
  for (const found of breaks)
    byKind[found.kind] = (byKind[found.kind] ?? 0) + 1;
  return { count: breaks.length, by_kind: byKind, breaks };
};

const HARMLESS = new Set([
  "ls",
  "cd",
  "test",
  "[",
  "echo",
  "printf",
  "export",
  "realpath",
]);
const REQUESTERS = new Set([
  "curl",
  "wget",
  "http",
  "node",
  "python",
  "python3",
  "nc",
]);

const otherToolsInCommand = (command, subject, state) => {
  const found = [];
  for (const words of simpleCommands(splitHeredocs(command).text)) {
    if (commandInvocations(words, state).length > 0) continue;
    const line = words.map((word) => word.text).join(" ");
    const head = commandWord(words);
    if (head === null || HARMLESS.has(head)) continue;
    if (subject.inputDir !== null)
      for (const path of pathsUnder(line, subject.inputDir))
        found.push({ kind: "input-by-other-tool", path, how: head });
    if (
      subject.address !== null &&
      line.includes(subject.address) &&
      REQUESTERS.has(head)
    )
      found.push({
        kind: "address-by-other-tool",
        path: subject.address,
        how: head,
      });
  }
  return found;
};

/**
 * Places where an agent may have got at a task's input without REA: a tool
 * call that names a file under `inputDir`, or requests `address`, and is not
 * a REA command. Writing a scenario file that names an input looks the same
 * as reading the input, so this is a list for a person to read, not a
 * verdict.
 */
export const otherToolUseOf = (transcript, subject) => {
  const state = newShellState();
  const uses = [];
  transcript.tool_calls.forEach((call, index) => {
    const { name, input } = call;
    let found = [];
    if (name === "Bash") {
      // Scripts the agent wrote count as REA commands when they run REA.
      for (const heredoc of splitHeredocs(String(input.command ?? "")).heredocs)
        if (heredoc.target !== null)
          noteScript(heredoc.target, heredoc.body, state);
      found = otherToolsInCommand(String(input.command ?? ""), subject, state);
    } else if (["Read", "Grep", "Glob"].includes(name)) {
      const path = String(input.file_path ?? input.path ?? "");
      if (
        subject.inputDir !== null &&
        path !== "" &&
        under(path, subject.inputDir)
      )
        found = [{ kind: "input-by-other-tool", path, how: name }];
    }
    for (const item of found)
      uses.push({
        ...item,
        call: index + 1,
        tool: name,
        excerpt: String(input.command ?? input.file_path ?? input.path ?? "")
          .replaceAll(/\s+/gu, " ")
          .slice(0, 200),
      });
  });
  return { count: uses.length, uses };
};
