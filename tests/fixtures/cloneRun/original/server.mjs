#!/usr/bin/env node
// Fixture original for clone runs: "Quillbrook", a small topic board.
// Server-rendered pages plus a client script that calls a JSON API. The
// rules a rebuild has to discover by probing are in `store`: how a slug is
// made and kept, how titles are normalised and compared, list order, and
// which topics cannot be deleted. Node standard library only.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC = new URL("./public/", import.meta.url);
const SEED = [
  { id: 1, title: "Welcome", slug: "welcome", pinned: true },
  { id: 2, title: "Release notes", slug: "release-notes", pinned: false },
  { id: 3, title: "Team handbook", slug: "team-handbook", pinned: false },
];
const SEEDED_AT = "2026-01-05T09:00:00.000Z";

function createStore() {
  let topics = [];
  let nextId = 1;

  function reset() {
    topics = SEED.map(function (topic) {
      return Object.assign({}, topic, { createdAt: SEEDED_AT });
    });
    nextId = SEED.length + 1;
  }

  function ordered() {
    return topics.slice().sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.id - b.id;
    });
  }

  function find(id) {
    for (let i = 0; i < topics.length; i += 1)
      if (topics[i].id === id) return topics[i];
    return null;
  }

  function slugFor(title) {
    let base = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    base = base.slice(0, 24).replace(/-+$/, "");
    if (base === "") base = "topic";
    let slug = base;
    let n = 2;
    while (
      topics.some(function (topic) {
        return topic.slug === slug;
      })
    ) {
      slug = base + "-" + n;
      n += 1;
    }
    return slug;
  }

  // Returns { title } or { status, body } for a refused title.
  function checkTitle(raw, selfId) {
    if (typeof raw !== "string")
      return { status: 422, body: { error: "title_required" } };
    const title = raw.trim().replace(/\s+/g, " ");
    if (title.length < 3 || title.length > 48)
      return { status: 422, body: { error: "title_length", min: 3, max: 48 } };
    const lowered = title.toLowerCase();
    for (let i = 0; i < topics.length; i += 1)
      if (topics[i].id !== selfId && topics[i].title.toLowerCase() === lowered)
        return {
          status: 409,
          body: { error: "title_taken", id: topics[i].id },
        };
    return { title: title };
  }

  reset();
  return {
    reset: reset,
    find: find,
    list: function (query) {
      const all = ordered();
      if (!query) return all;
      const needle = query.toLowerCase();
      return all.filter(function (topic) {
        return topic.title.toLowerCase().indexOf(needle) !== -1;
      });
    },
    create: function (input) {
      const checked = checkTitle(input.title, 0);
      if (!checked.title) return checked;
      const topic = {
        id: nextId,
        title: checked.title,
        slug: slugFor(checked.title),
        pinned: input.pinned === true,
        createdAt: new Date().toISOString(),
      };
      nextId += 1;
      topics.push(topic);
      return { status: 201, body: topic };
    },
    update: function (topic, input) {
      if (input.title !== undefined) {
        const checked = checkTitle(input.title, topic.id);
        if (!checked.title) return checked;
        // The slug is assigned once; a rename keeps it.
        topic.title = checked.title;
      }
      if (typeof input.pinned === "boolean") topic.pinned = input.pinned;
      return { status: 200, body: topic };
    },
    remove: function (topic) {
      if (topic.pinned) return { status: 409, body: { error: "pinned" } };
      topics = topics.filter(function (other) {
        return other !== topic;
      });
      return { status: 200, body: { deleted: topic.id } };
    },
  };
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(title, body) {
  return (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' +
    escapeHtml(title) +
    ' - Quillbrook</title>\n<link rel="stylesheet" href="/style.css">\n</head>\n<body>\n' +
    '<header>\n<h1>Quillbrook</h1>\n<nav aria-label="Sections">\n<a href="/">Topics</a>\n<a href="/about">About</a>\n</nav>\n</header>\n' +
    "<main>\n" +
    body +
    "</main>\n<footer>Quillbrook keeps your team's topics in one place.</footer>\n" +
    '<script src="/app.js"></script>\n</body>\n</html>\n'
  );
}

function topicRow(topic) {
  return (
    '<li><a href="/topic?id=' +
    topic.id +
    '">' +
    escapeHtml(topic.title) +
    "</a> <code>" +
    escapeHtml(topic.slug) +
    "</code>" +
    (topic.pinned ? " <strong>pinned</strong>" : "") +
    "</li>\n"
  );
}

function homePage(store) {
  return layout(
    "Topics",
    "<h2>Topics</h2>\n" +
      '<form id="find-form">\n<label>Find <input type="text" name="q"></label>\n<button type="submit">Search</button>\n</form>\n' +
      '<ul id="topics" aria-label="Topic list">\n' +
      store.list("").map(topicRow).join("") +
      "</ul>\n<h2>New topic</h2>\n" +
      '<form id="add-form">\n<label>Title <input type="text" name="title"></label>\n' +
      '<label><input type="checkbox" name="pinned"> Pinned</label>\n<button type="submit">Add topic</button>\n</form>\n' +
      '<div id="notice"></div>\n',
  );
}

function topicPage(topic) {
  return layout(
    topic.title,
    '<h2 id="topic-title">' +
      escapeHtml(topic.title) +
      "</h2>\n<p>Slug: <code>" +
      escapeHtml(topic.slug) +
      "</code></p>\n<p>" +
      (topic.pinned ? "This topic is pinned." : "This topic is not pinned.") +
      '</p>\n<form id="rename-form" data-id="' +
      topic.id +
      '">\n<label>New title <input type="text" name="title"></label>\n<button type="submit">Rename</button>\n</form>\n' +
      '<button type="button" id="delete-topic" data-id="' +
      topic.id +
      '">Delete topic</button>\n<div id="notice"></div>\n',
  );
}

function aboutPage() {
  return layout(
    "About",
    "<h2>About</h2>\n<p>Quillbrook is a shared board of topics. Each topic gets a short address made from its first title.</p>\n" +
      "<p>Pinned topics stay at the top of the list.</p>\n",
  );
}

function missingPage() {
  return layout(
    "Not found",
    '<h2>No such topic</h2>\n<p><a href="/">Back to topics</a></p>\n',
  );
}

// More than 64 KiB, so a capture with default limits never records it.
function exportDocument(store) {
  const rows = [];
  for (let n = 1; n <= 1600; n += 1)
    rows.push({
      row: n,
      code: "QB-" + String(n * 7919).padStart(8, "0"),
      kind: "archive",
    });
  return { format: "topics-export/1", topics: store.list(""), archive: rows };
}

function readBody(request) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    request.on("data", function (chunk) {
      chunks.push(chunk);
    });
    request.on("end", function () {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
}

function sendHtml(response, status, html) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
  });
  response.end(html);
}

async function sendFile(response, name, type) {
  const bytes = await readFile(new URL(name, PUBLIC));
  response.writeHead(200, {
    "content-type": type,
    "content-length": bytes.length,
  });
  response.end(bytes);
}

async function handleApi(store, request, response, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[1] === "export" && parts.length === 2 && request.method === "GET")
    return sendJson(response, 200, exportDocument(store));
  if (parts[1] !== "topics" || parts.length > 3)
    return sendJson(response, 404, { error: "not_found" });

  let input = {};
  if (request.method === "POST" || request.method === "PUT") {
    try {
      input = JSON.parse(await readBody(request));
    } catch {
      return sendJson(response, 400, { error: "invalid_json" });
    }
    if (input === null || typeof input !== "object" || Array.isArray(input))
      return sendJson(response, 400, { error: "invalid_json" });
  }

  if (parts.length === 2) {
    if (request.method === "GET") {
      const items = store.list(url.searchParams.get("q") || "");
      return sendJson(response, 200, { items: items, total: items.length });
    }
    if (request.method === "POST") {
      const made = store.create(input);
      return sendJson(response, made.status, made.body);
    }
    return sendJson(response, 405, { error: "method_not_allowed" });
  }

  const topic = /^[0-9]+$/.test(parts[2]) ? store.find(Number(parts[2])) : null;
  if (topic === null) return sendJson(response, 404, { error: "not_found" });
  if (request.method === "GET") return sendJson(response, 200, topic);
  if (request.method === "PUT") {
    const changed = store.update(topic, input);
    return sendJson(response, changed.status, changed.body);
  }
  if (request.method === "DELETE") {
    const removed = store.remove(topic);
    return sendJson(response, removed.status, removed.body);
  }
  return sendJson(response, 405, { error: "method_not_allowed" });
}

async function handle(store, request, response) {
  const url = new URL(request.url, "http://fixture.invalid");
  if (url.pathname.startsWith("/api/"))
    return handleApi(store, request, response, url);
  if (request.method !== "GET") return sendHtml(response, 405, missingPage());
  if (url.pathname === "/") return sendHtml(response, 200, homePage(store));
  if (url.pathname === "/about") return sendHtml(response, 200, aboutPage());
  if (url.pathname === "/app.js")
    return sendFile(response, "app.js", "text/javascript; charset=utf-8");
  if (url.pathname === "/style.css")
    return sendFile(response, "style.css", "text/css; charset=utf-8");
  if (url.pathname === "/topic") {
    const id = url.searchParams.get("id") || "";
    const topic = /^[0-9]+$/.test(id) ? store.find(Number(id)) : null;
    return topic === null
      ? sendHtml(response, 404, missingPage())
      : sendHtml(response, 200, topicPage(topic));
  }
  return sendHtml(response, 404, missingPage());
}

/**
 * Start the original on a loopback port (0 picks a free one).
 * @param {{ port?: number }} [options]
 * @returns {Promise<{ origin: string, reset(): void, close(): Promise<void> }>}
 */
export async function startOriginal(options = {}) {
  const store = createStore();
  const server = createServer(function (request, response) {
    handle(store, request, response).catch(function (error) {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(String(error));
    });
  });
  await new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.listen(options.port || 0, "127.0.0.1", resolve);
  });
  return {
    origin: "http://127.0.0.1:" + server.address().port,
    reset: store.reset,
    close: function () {
      return new Promise(function (resolve) {
        server.closeAllConnections();
        server.close(resolve);
      });
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const site = await startOriginal({ port: Number(process.env.PORT || 0) });
  process.stdout.write(
    site.origin + " (" + fileURLToPath(import.meta.url) + ")\n",
  );
}
