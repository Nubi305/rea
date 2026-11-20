// Tidewater in the browser: one delegated handler per page sends the form to
// the JSON API and patches the page from the reply.
const wording = new Map([
  ["title_required", "Enter a title"],
  ["title_length", "Title must be 3 to 48 characters"],
  ["title_taken", "That title is already in use"],
  ["pinned", "Pinned topics cannot be deleted"],
  ["not_found", "This topic no longer exists"],
]);

const say = (role, message) => {
  const line = Object.assign(document.createElement("p"), {
    textContent: message,
  });
  line.setAttribute("role", role);
  document.querySelector("[data-notice]").replaceChildren(line);
};

const api = async (method, path, payload) => {
  const reply = await fetch(path, {
    method,
    ...(payload === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
  });
  const body = await reply.json();
  if (!reply.ok) {
    say("alert", wording.get(body.error));
    return undefined;
  }
  return body;
};

const item = ({ id, title, slug, pinned }) => {
  const entry = document.createElement("li");
  entry.dataset.topic = String(id);
  const link = Object.assign(document.createElement("a"), {
    href: `/topic?id=${id}`,
    textContent: title,
  });
  const address = Object.assign(document.createElement("code"), {
    textContent: slug,
  });
  entry.append(link, " ", address);
  if (pinned)
    entry.append(
      " ",
      Object.assign(document.createElement("strong"), {
        textContent: "pinned",
      }),
    );
  return entry;
};

const titleOf = (form) => {
  const title = new FormData(form).get("title");
  if (String(title).trim() !== "") return String(title);
  say("alert", wording.get("title_required"));
  return undefined;
};

const actions = {
  async add(form) {
    const title = titleOf(form);
    if (title === undefined) return;
    const pinned = form.querySelector("[name=pinned]").checked;
    const made = await api("POST", "/api/topics", { title, pinned });
    if (made === undefined) return;
    const list = document.querySelector("[data-list]");
    const lastPinned = [...list.children].findLast((entry) =>
      entry.querySelector("strong"),
    );
    if (made.pinned && lastPinned) lastPinned.after(item(made));
    else if (made.pinned) list.prepend(item(made));
    else list.append(item(made));
    form.reset();
    say("status", `Added ${made.title}`);
  },
  async find(form) {
    const q = new FormData(form).get("q");
    const found = await api("GET", `/api/topics?q=${encodeURIComponent(q)}`);
    if (found === undefined) return;
    document
      .querySelector("[data-list]")
      .replaceChildren(...found.items.map(item));
    say("status", `${found.total} found`);
  },
  async rename(form) {
    const title = titleOf(form);
    if (title === undefined) return;
    const changed = await api("PUT", `/api/topics/${form.dataset.topic}`, {
      title,
    });
    if (changed === undefined) return;
    document.querySelector("[data-title]").textContent = changed.title;
    form.reset();
    say("status", "Renamed");
  },
  async delete(button) {
    const gone = await api("DELETE", `/api/topics/${button.dataset.topic}`);
    if (gone === undefined) return;
    button.disabled = true;
    say("status", "Topic deleted");
  },
};

document.addEventListener("submit", (event) => {
  const run = actions[event.target.dataset.action];
  if (run === undefined) return;
  event.preventDefault();
  void run(event.target);
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (button !== null) void actions[button.dataset.action](button);
});
