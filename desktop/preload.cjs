// Bridges the updater in main.mjs to the page's update toast
// (src/desktop-update.js). Sandboxed preloads must be CommonJS.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("surfaceDesktop", {
  onUpdateNotice(callback) {
    ipcRenderer.on("update-notice", (_event, notice) => callback(notice));
    // The startup check can find an update before the page has loaded.
    void ipcRenderer.invoke("update-pending").then((notice) => {
      if (notice) {
        callback(notice);
      }
    });
  },
  downloadUpdate() {
    ipcRenderer.send("update-download");
  }
});
