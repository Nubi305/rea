const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const fs = require("node:fs/promises");

const FEED = "https://updates.parceldesk.example.test/desktop/stable";

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.loadFile(path.join(__dirname, "renderer", "index.html"));
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  return window;
}

ipcMain.handle("labels:print", async (_event, parcel) => {
  const file = path.join(app.getPath("temp"), `label-${parcel.id}.txt`);
  await fs.writeFile(file, `${parcel.recipient}\n${parcel.weightKg} kg\n`);
  return file;
});

ipcMain.handle("settings:read", async () => {
  const file = path.join(app.getPath("userData"), "settings.json");
  return JSON.parse(await fs.readFile(file, "utf8"));
});

ipcMain.on("updates:check", () => {
  autoUpdater.checkForUpdates();
});

app.whenReady().then(() => {
  autoUpdater.setFeedURL({ provider: "generic", url: FEED });
  autoUpdater.autoDownload = false;
  createWindow();
});

app.on("window-all-closed", () => app.quit());
