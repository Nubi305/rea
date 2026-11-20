// The address rule of Tidewater topics: lower-case words joined by dashes,
// at most 24 characters, never ending in a dash, numbered when taken.
const LIMIT = 24;

/**
 * @param {string} title
 * @param {(candidate: string) => boolean} isTaken
 */
export const slugOf = (title, isTaken) => {
  const words = title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const stem = words.join("-").slice(0, LIMIT).replace(/-+$/, "") || "topic";
  for (let suffix = 1; ; suffix += 1) {
    const candidate = suffix === 1 ? stem : `${stem}-${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
};
