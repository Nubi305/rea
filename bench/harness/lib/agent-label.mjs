// How a result names the agent under test: a label the lead chose when the
// cell was prepared (`--agent`), never the model id a transcript carries.
// The transcript reader still reads that id, so that cells can be told apart
// in memory; nothing here lets it into a score file.

export const DEFAULT_AGENT_LABEL = "unlabelled";

const LABEL = /^[A-Za-z0-9][\w.+-]{0,63}$/u;

/** A label as prepare accepts it: letters, digits, `.`, `_`, `+`, `-`. */
export const checkAgentLabel = (label) => {
  if (!LABEL.test(label))
    throw new Error(
      `--agent ${JSON.stringify(label)}: use 1 to 64 letters, digits, ".", "_", "+" or "-", starting with a letter or digit`,
    );
  return label;
};

/** The label of a cell; cells prepared before labels existed have none. */
export const agentLabelOf = (cell) => cell.agent ?? DEFAULT_AGENT_LABEL;

/** Every model id the transcripts' replies carry. */
export const modelIdsOf = (transcripts) =>
  new Set(
    transcripts.flatMap((transcript) =>
      (transcript.turns ?? []).map((turn) => turn.model).filter(Boolean),
    ),
  );

/**
 * Where a score would name a model: a key called `model`, or a string that
 * holds one of `modelIds`. Returns JSON pointers; empty when there is none.
 */
export const modelMentions = (value, modelIds, pointer = "") => {
  if (typeof value === "string")
    return [...modelIds].some((id) => value.includes(id)) ? [pointer] : [];
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      modelMentions(item, modelIds, `${pointer}/${index}`),
    );
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => [
    ...(key === "model" ? [`${pointer}/model`] : []),
    ...modelMentions(item, modelIds, `${pointer}/${key}`),
  ]);
};

/**
 * The text of a score file. Each path in `paths` (a map from a directory to
 * the name that stands for it, such as `<skill>`) is written by that name:
 * the client's own directories are no business of a result. Refuses a score
 * that would name a model.
 */
export const scoreText = (score, { modelIds, paths }) => {
  let text = `${JSON.stringify(score, null, 1)}\n`;
  const prefixes = Object.entries(paths)
    .filter(([path]) => path)
    .sort(([left], [right]) => right.length - left.length);
  for (const [path, name] of prefixes)
    text = text.replaceAll(JSON.stringify(path).slice(1, -1), name);
  const mentions = modelMentions(JSON.parse(text), modelIds);
  if (mentions.length > 0)
    throw new Error(
      `the score would name a model at ${mentions.join(", ")}: name the agent with --agent when preparing the cell`,
    );
  return text;
};
