#!/usr/bin/env node
// Tidewater: a topic board served from memory. Routes are a table of
// [method, pattern, handler]; pages are rendered on the server and the
// script under assets/ talks to the JSON routes. Node standard library only.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import { TopicBoard } from "./topics.mjs";
import * as views from "./views.mjs";

const ASSETS = new Map([
  ["/assets/board.js", "text/javascript; charset=utf-8"],
  ["/assets/board.css", "text/css; charset=utf-8"],
]);

const json = (status, body) => ({
  status,
  type: "application/json; charset=utf-8",
  body: JSON.stringify(body),
});
const html = (status, body) => ({
  status,
  type: "text/html; charset=utf-8",
  body,
});
const noSuch = () => json(404, { error: "not_found" });

/** Every archive row of the export, far more than one screen of data. */
const archive = () =>
  Array.from({ length: 1600 }, (_, index) => ({
    row: index + 1,
    code: `QB-${String((index + 1) * 7919).padStart(8, "0")}`,
    kind: "archive",
  }));

const jsonBody = async (request) => {
  let raw = "";
  for await (const chunk of request.setEncoding("utf8")) raw += chunk;
  try {
    const value = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
};

const withTopic = (board, id, found) => {
  const topic = /^\d+$/.test(id) ? board.get(Number(id)) : undefined;
  return topic === undefined ? noSuch() : found(topic);
};

const withInput = async (request, accepted) => {
  const input = await jsonBody(request);
  return input === undefined
    ? json(400, { error: "invalid_json" })
    : accepted(input);
};

const reply = ({ status, body }) => json(status, body);

/** @param {TopicBoard} board */
const routes = (board) => [
  ["GET", /^\/$/, () => html(200, views.home(board.search()))],
  ["GET", /^\/about$/, () => html(200, views.about())],
  [
    "GET",
    /^\/topic$/,
    ({ url }) => {
      const id = url.searchParams.get("id") ?? "";
      const topic = /^\d+$/.test(id) ? board.get(Number(id)) : undefined;
      return topic === undefined
        ? html(404, views.missing())
        : html(200, views.topic(topic));
    },
  ],
  [
    "GET",
    /^\/api\/export$/,
    () =>
      json(200, {
        format: "topics-export/1",
        topics: board.search(),
        archive: archive(),
      }),
  ],
  [
    "GET",
    /^\/api\/topics$/,
    ({ url }) => {
      const items = board.search(url.searchParams.get("q") ?? "");
      return json(200, { items, total: items.length });
    },
  ],
  [
    "POST",
    /^\/api\/topics$/,
    ({ request }) => withInput(request, (input) => reply(board.add(input))),
  ],
  [
    "GET",
    /^\/api\/topics\/([^/]+)$/,
    ({ match }) => withTopic(board, match[1], (topic) => json(200, topic)),
  ],
  [
    "PUT",
    /^\/api\/topics\/([^/]+)$/,
    ({ request, match }) =>
      withInput(request, (input) =>
        withTopic(board, match[1], (topic) =>
          reply(board.change(topic, input)),
        ),
      ),
  ],
  [
    "DELETE",
    /^\/api\/topics\/([^/]+)$/,
    ({ match }) =>
      withTopic(board, match[1], (topic) => reply(board.drop(topic))),
  ],
];

const answer = async (table, request) => {
  const url = new URL(request.url ?? "/", "http://board.invalid");
  const asset = ASSETS.get(url.pathname);
  if (asset !== undefined && request.method === "GET")
    return {
      status: 200,
      type: asset,
      body: await readFile(new URL(`.${url.pathname}`, import.meta.url)),
    };
  let pathKnown = false;
  for (const [method, pattern, handler] of table) {
    const match = pattern.exec(url.pathname);
    if (match === null) continue;
    pathKnown = true;
    if (method === request.method) return handler({ request, url, match });
  }
  if (url.pathname.startsWith("/api/"))
    return pathKnown ? json(405, { error: "method_not_allowed" }) : noSuch();
  return html(pathKnown ? 405 : 404, views.missing());
};

/**
 * Serve the board on a loopback port (0 picks a free one).
 * @param {{ port?: number }} [options]
 * @returns {Promise<{ origin: string, reset(): void, close(): Promise<void> }>}
 */
export const startBoard = async ({ port = 0 } = {}) => {
  const board = new TopicBoard();
  const table = routes(board);
  const server = createServer((request, response) => {
    answer(table, request)
      .catch((error) => ({
        status: 500,
        type: "text/plain",
        body: String(error),
      }))
      .then(({ status, type, body }) => {
        response.writeHead(status, {
          "content-type": type,
          "content-length": Buffer.byteLength(body),
        });
        response.end(body);
      });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const { port: bound } = /** @type {import("node:net").AddressInfo} */ (
    server.address()
  );
  return {
    origin: `http://127.0.0.1:${bound}`,
    reset: () => board.reset(),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const board = await startBoard({ port: Number(process.env.PORT ?? 0) });
  process.stdout.write(`${board.origin}\n`);
}
