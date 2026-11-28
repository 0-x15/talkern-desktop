// Puente entre Talkern web y la app (docs/fundamentos.md, app de escritorio).
// Corre aislado: la web solo ve `window.talkernDesktop`, nada de Node. Lo que no pasa por
// contextBridge no llega a la web (fase 5 de la auditoría, TK-055), así que aquí no se redefine nada.
const { contextBridge, ipcRenderer } = require("electron");

// La versión la pasa el proceso principal como argumento del renderizador (TK-054).
const version = (process.argv.find((a) => a.startsWith("--talkern-version=")) ?? "").slice("--talkern-version=".length);

contextBridge.exposeInMainWorld("talkernDesktop", {
  version,
  platform: process.platform,
  /** Globo de no leídos: número (0 lo quita) o true para el punto sin número. */
  setBadge: (value) => ipcRenderer.send("badge", value),
  /** Trae la ventana al frente (al pulsar un aviso). */
  focus: () => ipcRenderer.send("focus"),
  /** Reunión en curso o no: la app lo refleja en la bandeja y pregunta al cerrar o salir. */
  setCallActive: (active) => ipcRenderer.send("call", Boolean(active)),
  /** Un aviso nativo: la app lo enseña y, al pulsarlo, navega a su enlace. */
  notify: (notification) => ipcRenderer.send("notify", notification),
  /** Descargar un archivo (dirección firmada): la app lo guarda en Descargas y avisa al terminar (TK-098). */
  download: (url) => ipcRenderer.send("download", String(url)),
  /** La web atendió un «navigate»; si no lo confirma nadie, la app carga la dirección (TK-075). */
  navigated: () => ipcRenderer.send("navigated"),
  /** La app pide navegar (enlace talkern://, aviso pulsado). Devuelve cómo dejar de escuchar. */
  onNavigate: (callback) => {
    const handler = (_event, url) => callback(url);
    ipcRenderer.on("navigate", handler);
    return () => ipcRenderer.removeListener("navigate", handler);
  },
  /** Cambios de estado: focus, blur, suspend, resume, online, offline. */
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("state", handler);
    return () => ipcRenderer.removeListener("state", handler);
  },
});
