// Topic rules of Tidewater, written from the observed behaviour of the board
// it replaces: titles are trimmed and single-spaced, unique without regard to
// case, 3 to 48 characters; an address is assigned once; pinned topics list
// first and cannot be deleted.
import { slugOf } from "./slug.mjs";

const FIRST_TOPICS = [
  ["Welcome", "welcome", true],
  ["Release notes", "release-notes", false],
  ["Team handbook", "team-handbook", false],
];
const FIRST_TOPICS_AT = "2026-01-05T09:00:00.000Z";
const TITLE_RANGE = { min: 3, max: 48 };

const refusal = (status, body) => ({ status, body });

export class TopicBoard {
  /** @type {Map<number, { id: number, title: string, slug: string, pinned: boolean, createdAt: string }>} */
  #byId = new Map();
  #sequence = 0;

  constructor() {
    this.reset();
  }

  reset() {
    this.#byId = new Map();
    this.#sequence = 0;
    for (const [title, slug, pinned] of FIRST_TOPICS)
      this.#insert({ title, slug, pinned, createdAt: FIRST_TOPICS_AT });
  }

  #insert(fields) {
    this.#sequence += 1;
    const topic = { id: this.#sequence, ...fields };
    this.#byId.set(topic.id, topic);
    return topic;
  }

  get(id) {
    return this.#byId.get(id);
  }

  search(text = "") {
    const wanted = text.toLowerCase();
    return [...this.#byId.values()]
      .filter((topic) => topic.title.toLowerCase().includes(wanted))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.id - b.id);
  }

  #title(value, ownId) {
    if (typeof value !== "string")
      return refusal(422, { error: "title_required" });
    const title = value.split(/\s+/).filter(Boolean).join(" ");
    if (title.length < TITLE_RANGE.min || title.length > TITLE_RANGE.max)
      return refusal(422, { error: "title_length", ...TITLE_RANGE });
    const folded = title.toLowerCase();
    for (const other of this.#byId.values())
      if (other.id !== ownId && other.title.toLowerCase() === folded)
        return refusal(409, { error: "title_taken", id: other.id });
    return { title };
  }

  add({ title: value, pinned }) {
    const checked = this.#title(value, undefined);
    if (checked.title === undefined) return checked;
    const slugs = new Set([...this.#byId.values()].map((topic) => topic.slug));
    return refusal(
      201,
      this.#insert({
        title: checked.title,
        slug: slugOf(checked.title, (candidate) => slugs.has(candidate)),
        pinned: pinned === true,
        createdAt: new Date().toISOString(),
      }),
    );
  }

  change(topic, { title: value, pinned }) {
    if (value !== undefined) {
      const checked = this.#title(value, topic.id);
      if (checked.title === undefined) return checked;
      topic.title = checked.title;
    }
    if (typeof pinned === "boolean") topic.pinned = pinned;
    return refusal(200, topic);
  }

  drop(topic) {
    if (topic.pinned) return refusal(409, { error: "pinned" });
    this.#byId.delete(topic.id);
    return refusal(200, { deleted: topic.id });
  }
}
