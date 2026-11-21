import { openBoard, ping, signOut } from "./api.js";
import { Board } from "./store.js";

const board = new Board();
const list = document.querySelector("#parcels");
const form = document.querySelector("#book");
const notice = document.querySelector("#notice");

board.subscribe((parcels) => {
  list.replaceChildren(
    ...parcels.map((parcel) => {
      const row = document.createElement("li");
      row.textContent = `${parcel.recipient}: ${parcel.weightKg.toFixed(1)} kg (${parcel.status})`;
      const button = document.createElement("button");
      button.textContent = "Delivered";
      button.addEventListener("click", () => board.deliver(parcel.id));
      row.append(button);
      return row;
    }),
  );
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const parcel = await board.book(data.get("recipient"), data.get("weight"));
  notice.textContent = `Booked ${parcel.id}`;
});

document.querySelector("#sign-out").addEventListener("click", async () => {
  await signOut();
  location.assign("/signed-out");
});

openBoard((change) => {
  if (change.kind === "parcel") board.load(change.depot);
});
setInterval(ping, 60000);
board.load(new URLSearchParams(location.search).get("depot") ?? "north");
