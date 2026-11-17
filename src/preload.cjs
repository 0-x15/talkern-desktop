// Puente entre Talkern web y la app (docs/fundamentos.md, app de escritorio).
// Corre aislado: la web solo ve `window.talkernDesktop`, nada de Node.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("talkernDesktop", {
  version: process.env.TALKERN_DESKTOP_VERSION ?? "",
  platform: process.platform,
  /** Globo de no leídos: número (0 lo quita) o true para el punto sin número. */
  setBadge: (value) => ipcRenderer.send("badge", value),
  /** Trae la ventana al frente (al pulsar un aviso). */
  focus: () => ipcRenderer.send("focus"),
  /** Reunión en curso o no: la app lo refleja en la bandeja y avisa al cerrar o salir. */
  setCallActive: (active) => ipcRenderer.send("call", Boolean(active)),
  /** Un aviso nativo: la app lo enseña y, al pulsarlo, navega a su enlace. */
  notify: (notification) => ipcRenderer.send("notify", notification),
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

// El globo del navegador (Badging API) pasa a ser el del dock o la barra de tareas.
const toBadge = (n) => ipcRenderer.send("badge", typeof n === "number" ? n : true);
try {
  Object.defineProperty(navigator, "setAppBadge", { value: (n) => Promise.resolve(toBadge(n)), configurable: true });
  Object.defineProperty(navigator, "clearAppBadge", { value: () => Promise.resolve(ipcRenderer.send("badge", 0)), configurable: true });
} catch {
  /* sin Badging API */
}

// Al pulsar un aviso del sistema, la ventana vuelve al frente.
const NativeNotification = window.Notification;
if (NativeNotification) {
  const Wrapped = function (title, options) {
    const n = new NativeNotification(title, options);
    n.addEventListener("click", () => ipcRenderer.send("focus"));
    return n;
  };
  Wrapped.prototype = NativeNotification.prototype;
  Object.defineProperty(Wrapped, "permission", { get: () => NativeNotification.permission });
  Wrapped.requestPermission = (...args) => NativeNotification.requestPermission(...args);
  window.Notification = Wrapped;
}
