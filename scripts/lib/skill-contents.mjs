// Build-time presentation of the skill's files. The authored files stay as
// upstream writes them, so merges stay mechanical; the copies that ship
// (skills/ and the Cursor plugin) get two changes:
//
// - a reference longer than CONTENTS_MIN_LINES lines starts with a contents
//   list of its second- and third-level headings, so a partial read shows the
//   whole scope;
// - a Markdown link that leaves the package becomes its text and its address,
//   so no link sends an agent off the machine.

export const CONTENTS_MIN_LINES = 100;
export const CONTENTS_LABEL = "Contents:";

const REPOSITORY_DOCS = "https://github.com/morluto/rea/blob/main/";

const lineCount = (text) =>
  text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;

/** Second- and third-level ATX headings outside fenced code, in order. */
export const contentsHeadings = (text) => {
  const headings = [];
  let fence;
  for (const line of text.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence !== undefined) {
      if (
        marker !== undefined &&
        marker[0] === fence[0] &&
        marker.length >= fence.length
      )
        fence = undefined;
      continue;
    }
    if (marker !== undefined) {
      fence = marker;
      continue;
    }
    const heading = /^(#{2,3})[ \t]+(.+?)[ \t]*#*[ \t]*$/u.exec(line);
    if (heading?.[1] !== undefined && heading[2] !== undefined)
      headings.push({ level: heading[1].length, title: heading[2] });
  }
  return headings;
};

const withContents = (text) => {
  const headings = contentsHeadings(text);
  if (headings.length === 0) return text;
  const list = headings
    .map(
      ({ level, title: heading }) => `${level === 3 ? "  " : ""}- ${heading}`,
    )
    .join("\n");
  // Before the title: guidance indexes text under headings only, so the list
  // does not make the whole guide match every query its headings would.
  return `${CONTENTS_LABEL}\n\n${list}\n\n${text}`;
};

/** Replace links that leave the package with their text and address. */
export const localizeLinks = (text) =>
  text.replaceAll(
    /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/gu,
    (_match, label, address) =>
      address.startsWith(REPOSITORY_DOCS)
        ? `${label} (REA repository: \`${address.slice(REPOSITORY_DOCS.length)}\`)`
        : `${label} (\`${address}\`)`,
  );

/** The shipped text of one skill file, from its authored text. */
export const packagedSkillFile = (relativePath, authored) => {
  const text = localizeLinks(authored);
  return relativePath.startsWith("references/") &&
    relativePath.endsWith(".md") &&
    lineCount(authored) > CONTENTS_MIN_LINES
    ? withContents(text)
    : text;
};
