// The topic list of Tidewater as a file to save: a header line, then one
// line per topic in list order. A cell is quoted only when it has to be.
const SEPARATOR = ",";
const COLUMNS = [
  ["id", (topic) => topic.id],
  ["title", (topic) => topic.title],
  ["slug", (topic) => topic.slug],
  ["pinned", (topic) => (topic.pinned ? "yes" : "no")],
];

const cell = (value) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** @param {readonly { id: number, title: string, slug: string, pinned: boolean }[]} topics */
export const sheetOf = (topics) =>
  [
    COLUMNS.map(([name]) => name),
    ...topics.map((topic) => COLUMNS.map(([, read]) => cell(read(topic)))),
  ]
    .map((line) => `${line.join(SEPARATOR)}\n`)
    .join("");
