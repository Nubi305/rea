const json = (reply) => {
  if (reply.status === 401) throw new Error("signed out");
  return reply.status === 204 ? null : reply.json();
};
const send = (method, body) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const listParcels = (depot) =>
  fetch(`/api/v3/parcels?depot=${encodeURIComponent(depot)}`).then(json);
export const listDepots = () => fetch("/api/v3/depots").then(json);
export const bookParcel = (parcel) => fetch("/api/v3/parcels", send("POST", parcel)).then(json);
export const setStatus = (id, status) =>
  fetch("/api/v3/parcels/status", send("PUT", { id, status })).then(json);
export const signOut = () => fetch("/api/v3/session", { method: "DELETE" });
export const ping = () => fetch("/api/v3/health").then(json);

export function openBoard(onChange) {
  const socket = new WebSocket("wss://live.courier.example.test/board");
  socket.addEventListener("message", (event) => onChange(JSON.parse(event.data)));
  return socket;
}
