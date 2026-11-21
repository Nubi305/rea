document.querySelector("#print").addEventListener("click", async () => {
  const settings = await window.desk.readSettings();
  const file = await window.desk.printLabel({ id: 41, recipient: settings.lastRecipient, weightKg: 2.5 });
  document.title = `Printed ${file}`;
});
document.querySelector("#update").addEventListener("click", () => window.desk.checkForUpdates());
