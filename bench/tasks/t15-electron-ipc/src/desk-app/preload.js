const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desk", {
  printLabel: (parcel) => ipcRenderer.invoke("labels:print", parcel),
  readSettings: () => ipcRenderer.invoke("settings:read"),
  checkForUpdates: () => ipcRenderer.send("updates:check"),
});
