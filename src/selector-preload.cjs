// Puente del selector de pantalla o ventana (fase 5 de la auditoría, TK-099): recibe las fuentes y devuelve la elegida.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("talkernSelector", {
  onSources: (callback) => ipcRenderer.on("sources", (_event, sources) => callback(sources)),
  pick: (id) => ipcRenderer.send("share-pick", id),
  cancel: () => ipcRenderer.send("share-pick", null),
});
