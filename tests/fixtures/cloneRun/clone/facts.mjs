// What Tidewater says about itself: where this copy is served from, its plan,
// and the values it makes anew for every request.
import { randomUUID } from "node:crypto";

/** The address a browser reached this board at, from the host it asked for. */
export const addressOf = (host) => `http://${host}`;

const fresh = (count) => Array.from({ length: count }, () => randomUUID());

/** @param {string} host The host and port of the request. */
export const factsOf = (host) => ({
  address: `${addressOf(host)}/api/board`,
  host,
  plan: "free",
  tokens: fresh(2),
  sessions: [{ id: randomUUID() }, { id: "seed-session" }],
});
