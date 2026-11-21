// Reading shell command text an agent ran: which REA commands a command line
// invokes, directly or through a script the agent wrote earlier. This is a
// reader for accounting, not a shell: quoting is honoured, expansion is not,
// and a command it cannot read counts as running no REA command.

const SEPARATORS = new Set([";", "|", "&", "\n", "(", ")", "{", "}", "`"]);
const WRAPPERS = new Set([
  "time",
  "nohup",
  "exec",
  "command",
  "env",
  "sudo",
  "setsid",
  "stdbuf",
  "nice",
  "xargs",
  "then",
  "do",
  "else",
  "elif",
  "if",
  "while",
  "until",
  "!",
]);
const INTERPRETERS = new Set([
  "bash",
  "sh",
  "zsh",
  "source",
  ".",
  "node",
  "python",
  "python3",
]);
const INLINE_CODE_FLAGS = new Set(["-c", "-e", "--eval", "-p", "--print"]);
const TIMEOUT_VALUE_FLAGS = new Set(["-k", "-s", "--kill-after", "--signal"]);
const HELP_FLAGS = new Set(["--help", "-h"]);
const LLMS_FLAGS = new Set(["--llms", "--llms-full"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;
// `rea sub-command` inside code that is not shell: a spawn with an argument
// list, or a command line in a string. A sub-command without a hyphen is not
// read here: too many sentences contain "rea" and a word.
const SPAWNED =
  /["'`](?:[^"'`\s]*\/)?rea(?:-agents)?["'`]\s*,\s*\[?\s*["'`]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)["'`]/gu;
const QUOTED_LINE =
  /(?:^|[\s"'`/])rea(?:-agents)?\s+([a-z][a-z0-9]*(?:-[a-z0-9]+)+)/gu;

const baseName = (word) => word.slice(word.lastIndexOf("/") + 1);

const REDIRECT = />>?\s*(["']?)([^\s"'<>|;&]+)\1/u;

// The file a heredoc's command writes: the redirect of the same simple
// command, before the marker or after it. `cat > a.sh <<EOF` and
// `cat <<EOF > a.sh` both name a.sh; `python3 - <<EOF` names none.
const heredocTarget = (line, marker) => {
  const before = line.slice(0, marker.index);
  const command = before.slice(
    Math.max(
      before.lastIndexOf(";"),
      before.lastIndexOf("&"),
      before.lastIndexOf("|"),
    ) + 1,
  );
  const after = line.slice(marker.index + marker[0].length).split(/[;&|]/u)[0];
  const found = REDIRECT.exec(command) ?? REDIRECT.exec(after);
  return found === null ? null : found[2];
};

/**
 * Split heredoc bodies off a command. Returns the command without them and
 * each body with the file its command line writes, if it names one.
 */
export const splitHeredocs = (command) => {
  const lines = command.split("\n");
  const kept = [];
  const heredocs = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = /<<-?\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1/u.exec(line);
    kept.push(line);
    if (match === null) continue;
    const body = [];
    index += 1;
    while (index < lines.length && lines[index].trim() !== match[2]) {
      body.push(lines[index]);
      index += 1;
    }
    heredocs.push({
      line,
      target: heredocTarget(line, match),
      body: body.join("\n"),
    });
  }
  return { text: kept.join("\n"), heredocs };
};

const closeQuote = (text, start, quote) => {
  let index = start + 1;
  while (index < text.length && text[index] !== quote) {
    if (quote === '"' && text[index] === "\\") index += 1;
    index += 1;
  }
  return index;
};

/**
 * Split command text into simple commands, each a list of words. A quoted
 * word keeps its content without the quotes; `quoted` marks a word that held
 * a quote and `bare` one that began outside any.
 */
export const simpleCommands = (text) => {
  const commands = [];
  let words = [];
  let word = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "'" || char === '"') {
      const end = closeQuote(text, index, char);
      word ??= { text: "", quoted: false, bare: false };
      word.text += text.slice(index + 1, end);
      word.quoted = true;
      index = end;
    } else if (char === "\\" && index + 1 < text.length) {
      if (text[index + 1] !== "\n") {
        word ??= { text: "", quoted: false, bare: true };
        word.text += text[index + 1];
      }
      index += 1;
    } else if (char === "$" && text[index + 1] === "(") {
      endCommand();
      index += 1;
    } else if (char === "$" && text[index + 1] === "{") {
      const end = text.indexOf("}", index);
      const stop = end === -1 ? text.length - 1 : end;
      word ??= { text: "", quoted: false, bare: true };
      word.text += text.slice(index, stop + 1);
      index = stop;
    } else if (SEPARATORS.has(char)) {
      endCommand();
    } else if (char === " " || char === "\t") {
      endWord();
    } else {
      word ??= { text: "", quoted: false, bare: true };
      word.text += char;
    }
  }
  endCommand();
  return commands;
};

// `> file`, `2> file`, `2>&1` and `>file` are not arguments of a command.
const withoutRedirects = (words) => {
  const kept = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (word.bare && /^[0-9]*(?:>>?|<)$/u.test(word.text)) index += 1;
    else if (!(word.bare && /^[0-9]*(?:>>?|<)/u.test(word.text)))
      kept.push(word);
  }
  return kept;
};

const invocationOf = (words, extra = {}) => {
  const plain = withoutRedirects(words).map((arg) => arg.text);
  const sub = plain.find((arg) => !arg.startsWith("-")) ?? null;
  let mode = "run";
  if (plain.some((arg) => HELP_FLAGS.has(arg))) mode = "help";
  else if (plain.includes("--schema")) mode = "schema";
  else if (plain.some((arg) => LLMS_FLAGS.has(arg))) mode = "llms";
  else if (sub === null)
    mode = plain.includes("--version") ? "version" : "help";
  const suffix = mode === "run" ? "" : ` --${mode}`;
  return {
    command: sub,
    mode,
    key: sub === null ? `(no command)${suffix}` : `${sub}${suffix}`,
    text: ["rea", ...plain].join(" "),
    via_script: null,
    ...extra,
  };
};

const fromCode = (code, script) => {
  const found = [];
  for (const pattern of [SPAWNED, QUOTED_LINE])
    for (const match of code.matchAll(pattern))
      found.push(
        invocationOf([{ text: match[1], bare: true }], { via_script: script }),
      );
  return found;
};

const isReaWord = (word, state) => {
  const name = baseName(word.text);
  if (name === "rea" || name === "rea-agents") return true;
  const variable = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/u.exec(word.text);
  return variable !== null && state.variables.has(variable[1]);
};

const noteAssignment = (word, state) => {
  const [name, value] = [
    word.text.slice(0, word.text.indexOf("=")),
    word.text.slice(word.text.indexOf("=") + 1),
  ];
  const last = value.trim().split(/\s+/u).at(-1) ?? "";
  if (/(?:^|\/)rea(?:-agents)?$/u.test(last) || last.endsWith("rea.mjs"))
    state.variables.add(name);
};

// Words a command starts with that are not the command: assignments, wrappers
// and the options and duration of `timeout`.
const commandStart = (words, state) => {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (word.bare && ASSIGNMENT.test(word.text)) noteAssignment(word, state);
    else if (baseName(word.text) === "timeout") {
      index += 1;
      while (index < words.length && words[index].text.startsWith("-"))
        index += TIMEOUT_VALUE_FLAGS.has(words[index].text) ? 2 : 1;
    } else if (!WRAPPERS.has(baseName(word.text))) break;
    index += 1;
  }
  return index;
};

const firstOperand = (words, from) =>
  words.slice(from).find((word) => !word.text.startsWith("-")) ?? null;

const viaInterpreter = (words, start, state) => {
  const rest = words.slice(start + 1);
  const flagAt = rest.findIndex((word) => INLINE_CODE_FLAGS.has(word.text));
  if (flagAt !== -1 && rest[flagAt + 1] !== undefined) {
    const code = rest[flagAt + 1].text;
    return ["bash", "sh", "zsh"].includes(baseName(words[start].text))
      ? invocationsIn(code, state)
      : fromCode(code, null);
  }
  const operand = firstOperand(words, start + 1);
  if (operand === null) return [];
  if (operand.text.endsWith("rea.mjs"))
    return [invocationOf(words.slice(words.indexOf(operand) + 1))];
  return scriptInvocations(operand, state);
};

const scriptInvocations = (word, state) =>
  (state.scripts.get(baseName(word.text)) ?? []).map((invocation) => ({
    ...invocation,
    via_script: baseName(word.text),
  }));

const commandInvocations = (words, state) => {
  const start = commandStart(words, state);
  if (start >= words.length) return [];
  const head = words[start];
  const name = baseName(head.text);
  if (isReaWord(head, state)) return [invocationOf(words.slice(start + 1))];
  if (name === "npx" || name === "bunx") {
    const operand = firstOperand(words, start + 1);
    return operand !== null && /^rea-agents(?:@.*)?$/u.test(operand.text)
      ? [invocationOf(words.slice(words.indexOf(operand) + 1))]
      : [];
  }
  if (INTERPRETERS.has(name)) return viaInterpreter(words, start, state);
  return scriptInvocations(head, state);
};

/**
 * Every REA invocation a command line makes. `state` carries what earlier
 * commands of the same session set up: `variables` that hold the REA command
 * and `scripts` (base name to the invocations inside) the agent wrote.
 */
export function invocationsIn(command, state) {
  const { text, heredocs } = splitHeredocs(command);
  const found = simpleCommands(text).flatMap((words) =>
    commandInvocations(words, state),
  );
  // A heredoc fed straight to an interpreter runs now; one written to a file
  // is a script for later.
  for (const heredoc of heredocs)
    if (heredoc.target === null) found.push(...fromCode(heredoc.body, null));
  return found;
}

/** Remember a file an agent wrote if it invokes REA when it is run later. */
export const noteScript = (path, content, state) => {
  const scratch = { variables: new Set(state.variables), scripts: new Map() };
  const shell = /\.(?:sh|bash)$/u.test(path) || content.startsWith("#!");
  const invocations = shell
    ? invocationsIn(content, scratch)
    : fromCode(content, null);
  if (invocations.length > 0) state.scripts.set(baseName(path), invocations);
};

/** A fresh reading state for one transcript. */
export const newShellState = () => ({
  variables: new Set(),
  scripts: new Map(),
});
