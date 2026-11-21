import { bookParcel, listDepots, listParcels, setStatus } from "./api.js";

export class Board {
  constructor() {
    this.parcels = [];
    this.depots = [];
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish() {
    for (const listener of this.listeners) listener(this.parcels, this.depots);
  }

  async load(depot) {
    [this.depots, this.parcels] = await Promise.all([listDepots(), listParcels(depot)]);
    this.publish();
  }

  async book(recipient, weightKg) {
    const parcel = await bookParcel({ recipient: recipient.trim(), weightKg: Number(weightKg) });
    this.parcels = [...this.parcels, parcel].sort((a, b) => b.weightKg - a.weightKg);
    this.publish();
    return parcel;
  }

  async deliver(id) {
    const parcel = await setStatus(id, "delivered");
    this.parcels = this.parcels.map((item) => (item.id === id ? parcel : item));
    this.publish();
  }
}
