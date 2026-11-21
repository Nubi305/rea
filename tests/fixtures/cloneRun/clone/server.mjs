#!/usr/bin/env node
// Tidewater: a topic board served from memory. Pages are a table of path to
// renderer; the JSON API is two resources (the list and one topic) with a
// handler per method. Pages are rendered on the server and the script under
// assets/ talks to the API. Node standard library only.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import { addressOf, factsOf } from "./facts.mjs";
import { sheetOf } from "./sheet.mjs";
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
const notAllowed = () => json(405, { error: "method_not_allowed" });
const reply = ({ status, body }) => json(status, body);

/** Every archive row of the export, far more than one screen of data. */
const archive = () =>
  Array.from({ length: 1600 }, (_, index) => ({
    row: index + 1,
    code: `QB-${String((index + 1) * 7919).padStart(8, "0")}`,
    kind: "archive",
  }));

/** The request body as a JSON object, or undefined when it is anything else. */
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

/** @param {TopicBoard} board */
const pages = (board) =>
  new Map([
    ["/", () => html(200, views.home(board.search()))],
    ["/about", () => html(200, views.about())],
    ["/where", ({ host }) => html(200, views.where(host, addressOf(host)))],
    [
      "/topic",
      ({ url }) => {
        const id = url.searchParams.get("id") ?? "";
        const topic = /^\d+$/.test(id) ? board.get(Number(id)) : undefined;
        return topic === undefined
          ? html(404, views.missing())
          : html(200, views.topic(topic));
      },
    ],
    [
      "/topics.csv",
      () => ({
        status: 200,
        type: "text/csv; charset=utf-8",
        headers: { "content-disposition": 'attachment; filename="topics.csv"' },
        body: sheetOf(board.search()),
      }),
    ],
  ]);

/** @param {TopicBoard} board */
const resources = (board) => ({
  list: {
    GET: ({ url }) => {
      const items = board.search(url.searchParams.get("q") ?? "");
      return json(200, { items, total: items.length });
    },
    POST: ({ input }) => reply(board.add(input)),
  },
  topic: {
    GET: ({ topic }) => json(200, topic),
    PUT: ({ topic, input }) => reply(board.change(topic, input)),
    DELETE: ({ topic }) => reply(board.drop(topic)),
  },
});

const WRITES = new Set(["POST", "PUT"]);

/**
 * The API reads a path by its non-empty segments, so a trailing or doubled
 * slash names the same resource. A written body is judged before the topic
 * is looked up, and the topic before the method.
 */
const answerApi = async (board, api, request, url) => {
  const [, collection, id, ...deeper] = url.pathname
    .split("/")
    .filter((segment) => segment !== "");
  if (collection === "export" && id === undefined && request.method === "GET")
    return json(200, {
      format: "topics-export/1",
      topics: board.search(),
      archive: archive(),
    });
  if (collection === "board" && id === undefined && request.method === "GET")
    return json(200, factsOf(request.headers.host));
  if (collection !== "topics" || deeper.length > 0) return noSuch();
  const input = WRITES.has(request.method) ? await jsonBody(request) : {};
  if (input === undefined) return json(400, { error: "invalid_json" });
  if (id === undefined)
    return (api.list[request.method] ?? notAllowed)({ url, input });
  const topic = /^\d+$/.test(id) ? board.get(Number(id)) : undefined;
  if (topic === undefined) return noSuch();
  return (api.topic[request.method] ?? notAllowed)({ topic, input });
};

const answer = async (site, request) => {
  const url = new URL(request.url ?? "/", "http://board.invalid");
  if (url.pathname.startsWith("/api/"))
    return answerApi(site.board, site.api, request, url);
  if (request.method !== "GET") return html(405, views.missing());
  const asset = ASSETS.get(url.pathname);
  if (asset !== undefined)
    return {
      status: 200,
      type: asset,
      body: await readFile(new URL(`.${url.pathname}`, import.meta.url)),
    };
  const page = site.pages.get(url.pathname);
  return page === undefined
    ? html(404, views.missing())
    : page({ url, host: request.headers.host });
};

/**
 * Serve the board on a loopback port (0 picks a free one).
 * @param {{ port?: number }} [options]
 * @returns {Promise<{ origin: string, reset(): void, close(): Promise<void> }>}
 */
export const startBoard = async ({ port = 0 } = {}) => {
  const board = new TopicBoard();
  const site = { board, api: resources(board), pages: pages(board) };
  const server = createServer((request, response) => {
    answer(site, request)
      .catch((error) => ({
        status: 500,
        type: "text/plain",
        body: String(error),
      }))
      .then(({ status, type, body, headers = {} }) => {
        response.writeHead(status, {
          "content-type": type,
          "content-length": Buffer.byteLength(body),
          ...headers,
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
