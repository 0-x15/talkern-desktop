// Talkern para escritorio (docs/fundamentos.md, decisión del 18 de noviembre de 2026).
// Una ventana que carga Talkern web; aquí vive solo lo que el navegador no puede dar:
// bandeja, globo de no leídos, enlaces talkern://, permisos de medios, compartir
// pantalla, actualización automática.
import { app, BrowserWindow, Menu, Tray, Notification, nativeImage, shell, session, ipcMain, desktopCapturer, nativeTheme, powerMonitor } from "electron";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { autoUpdater } = require("electron-updater");
const here = path.dirname(fileURLToPath(import.meta.url));

const SITE = process.env.TALKERN_URL ?? "https://talkern.com";
const SITE_HOST = new URL(SITE).host;
// Solo el sitio configurado (y su «www»): las capacidades nativas no se conceden a otros orígenes.
const SITE_HOSTS = new Set([SITE_HOST, SITE_HOST.startsWith("www.") ? SITE_HOST.slice(4) : `www.${SITE_HOST}`]);
const isMac = process.platform === "darwin";

let win = null;
let tray = null;
let quitting = false;
let callActive = false;

// Ajustes de la app (nunca tokens: la sesión vive en el almacén de cookies de Electron).
const SETTINGS_FILE = () => path.join(app.getPath("userData"), "ajustes.json");
const DEFAULT_SETTINGS = { closeToTray: true, launchAtLogin: false, channel: "latest", bounds: null };
let settings = { ...DEFAULT_SETTINGS };
function loadSettings() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(SETTINGS_FILE(), "utf8")) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}
function saveSettings(patch) {
  settings = { ...settings, ...patch };
  try {
    writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
  } catch {
    /* sin disco: se queda en memoria */
  }
}

/** Versión mínima admitida por la web (compatibilidad web–app): si estamos por debajo, hay que actualizar. */
async function checkMinimumVersion() {
  try {
    const res = await fetch(`${SITE}/desktop/version.json`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const minimum = typeof data?.minimum === "string" ? data.minimum : null;
    if (minimum && compareVersions(app.getVersion(), minimum) < 0 && win) {
      win.loadFile(path.join(here, "actualizar.html"), { query: { site: SITE, minimum, current: app.getVersion(), note: typeof data?.note === "string" ? data.note : "" } });
      showWindow();
    }
  } catch {
    /* sin red o sin archivo: se sigue */
  }
}
function compareVersions(a, b) {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Una sola instancia: el segundo arranque (o un enlace talkern://) llega a la que ya corre.
if (!app.requestSingleInstanceLock()) app.quit();

function isSiteUrl(url) {
  try {
    return SITE_HOSTS.has(new URL(url).host);
  } catch {
    return false;
  }
}

/** talkern://w/percent/c/general → https://talkern.com/w/percent/c/general */
function fromDeepLink(link) {
  try {
    const u = new URL(link);
    if (u.protocol !== "talkern:") return null;
    return new URL(`/${u.host}${u.pathname}${u.search}`, SITE).toString();
  } catch {
    return null;
  }
}

/** Navegar dentro de la web ya cargada (sin recargar); si no hay web cargada, cargarla. */
function navigateTo(url) {
  if (!win) return;
  const absolute = (() => {
    try {
      return new URL(url, SITE).toString();
    } catch {
      return null;
    }
  })();
  if (!absolute || !isSiteUrl(absolute)) return;
  if (isSiteUrl(win.webContents.getURL())) win.webContents.send("navigate", absolute);
  else win.loadURL(absolute);
}

function openInApp(url) {
  navigateTo(url);
  showWindow();
}

function sendState(state) {
  if (win && !win.isDestroyed()) win.webContents.send("state", state);
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  const bounds = settings.bounds && typeof settings.bounds === "object" ? settings.bounds : {};
  win = new BrowserWindow({
    width: bounds.width ?? 1280,
    height: bounds.height ?? 820,
    x: bounds.x,
    y: bounds.y,
    minWidth: 760,
    minHeight: 520,
    title: "Talkern",
    icon: path.join(here, "..", "build", "icon.png"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121316" : "#f5f7fa",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });
  // Prueba de humo (TALKERN_SMOKE=1): carga la web sin enseñar la ventana y sale; para la CI y para comprobar que arranca.
  const smoke = Boolean(process.env.TALKERN_SMOKE);
  win.once("ready-to-show", () => {
    if (!smoke) win.show();
  });
  if (smoke) {
    const done = (what) => {
      console.log(`smoke: ${what} ${win?.webContents.getURL() ?? ""}`);
      quitting = true;
      app.quit();
    };
    win.webContents.once("did-finish-load", () => done("ok"));
    win.webContents.once("did-fail-load", (_e, code, desc) => done(`fallo ${code} ${desc}`));
    setTimeout(() => done("tiempo agotado"), 20_000);
  }
  win.webContents.session.setSpellCheckerLanguages(["es-ES", "en-US"]);
  win.loadURL(SITE);

  // Los enlaces de fuera se abren en el navegador; los de Talkern, aquí.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSiteUrl(url)) {
      win.loadURL(url);
    } else {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!isSiteUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Cerrar la ventana no cierra la app: sigue en la bandeja (o en el dock) y avisando. En una reunión, se dice claro.
  win.on("close", (event) => {
    saveSettings({ bounds: win.getNormalBounds() });
    if (quitting) return;
    if (!settings.closeToTray && !isMac) {
      quitting = true;
      app.quit();
      return;
    }
    event.preventDefault();
    if (isMac) app.hide();
    else win.hide();
    if (callActive && Notification.isSupported()) {
      const note = new Notification({ title: "Talkern", body: "La reunión sigue en marcha. Abre Talkern desde la bandeja para volver o colgar.", silent: true });
      note.on("click", showWindow);
      note.show();
    }
  });
  win.on("closed", () => {
    win = null;
  });
  win.on("focus", () => sendState("focus"));
  win.on("blur", () => sendState("blur"));
  // Sin conexión (o Talkern caído): la página propia, que reintenta sola y vuelve a la web.
  win.webContents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !isSiteUrl(url)) return;
    win.loadFile(path.join(here, "offline.html"), { query: { site: SITE } });
  });
}

/** Un aviso nativo pedido por la web: título, texto y enlace de Talkern. Al pulsarlo, se navega y se trae la ventana. */
function notify(payload) {
  if (!payload || typeof payload !== "object") return;
  const title = typeof payload.title === "string" ? payload.title.slice(0, 120) : "";
  const body = typeof payload.body === "string" ? payload.body.slice(0, 300) : "";
  const url = typeof payload.url === "string" ? payload.url : "";
  if (!title || !Notification.isSupported()) return;
  const note = new Notification({ title, body, silent: false });
  note.on("click", () => {
    showWindow();
    if (url) navigateTo(url);
  });
  note.show();
}

function setCallActive(active) {
  callActive = active;
  tray?.setToolTip(active ? "Talkern · en una reunión" : "Talkern");
}

/** Salir con una reunión en curso: se pregunta antes de colgar. */
async function quitFromMenu() {
  if (callActive && win) {
    const { dialog } = await import("electron");
    const { response } = await dialog.showMessageBox(win, { type: "question", buttons: ["Colgar y salir", "Seguir en la reunión"], defaultId: 1, cancelId: 1, message: "Estás en una reunión", detail: "Si sales de Talkern, la reunión se cuelga." });
    if (response !== 0) return;
  }
  app.quit();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(here, "..", "build", "icon.png")).resize({ width: 18, height: 18 });
  if (isMac) icon.setTemplateImage(false);
  tray = new Tray(icon);
  tray.setToolTip("Talkern");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir Talkern", click: showWindow },
      { type: "separator" },
      { label: "Salir", click: () => void quitFromMenu() },
    ]),
  );
  tray.on("click", showWindow);
}

/** Globo de no leídos: en Mac y Linux, el del dock; en Windows, una marca sobre el icono de la barra de tareas. */
function setBadge(value) {
  const count = typeof value === "number" ? Math.max(0, Math.floor(value)) : value ? 1 : 0;
  if (process.platform === "win32") {
    if (!win) return;
    if (count === 0) return win.setOverlayIcon(null, "");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="#ff3b30"/><text x="16" y="21" font-family="Arial" font-weight="700" font-size="${count > 9 ? 14 : 18}" fill="#fff" text-anchor="middle">${typeof value === "number" ? (count > 99 ? "99+" : count) : "•"}</text></svg>`;
    win.setOverlayIcon(nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`), typeof value === "number" ? `${count} sin leer` : "Sin leer");
    return;
  }
  // En Mac, true (sin número) es el punto «•» del dock.
  if (isMac && typeof value !== "number" && value) {
    app.dock?.setBadge("•");
    return;
  }
  app.setBadgeCount(count);
  if (isMac && count === 0) app.dock?.setBadge("");
}

function settingsMenu() {
  return {
    label: "Ajustes",
    submenu: [
      { label: "Al cerrar la ventana, seguir en la bandeja", type: "checkbox", checked: settings.closeToTray, click: (item) => saveSettings({ closeToTray: item.checked }) },
      {
        label: "Abrir Talkern al iniciar sesión en el ordenador",
        type: "checkbox",
        checked: settings.launchAtLogin,
        click: (item) => {
          saveSettings({ launchAtLogin: item.checked });
          app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true });
        },
      },
      { type: "separator" },
      { label: "Recibir versiones beta", type: "checkbox", checked: settings.channel === "beta", click: (item) => { saveSettings({ channel: item.checked ? "beta" : "latest" }); autoUpdater.channel = settings.channel; autoUpdater.allowPrerelease = settings.channel === "beta"; } },
    ],
  };
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { label: "Edición", role: "editMenu" },
    {
      label: "Ver",
      submenu: [
        { label: "Inicio de Talkern", accelerator: "CmdOrCtrl+Shift+H", click: () => openInApp(`${SITE}/app`) },
        { role: "reload" },
        settingsMenu(),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      label: "Ayuda",
      submenu: [
        { label: "Buscar actualizaciones", click: () => autoUpdater.checkForUpdatesAndNotify().catch(() => {}) },
        { label: `Versión ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  // Permisos de medios y avisos solo para Talkern; el resto, denegado.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ["media", "notifications", "clipboard-read", "clipboard-sanitized-write", "display-capture", "fullscreen"];
    callback(allowed.includes(permission) && isSiteUrl(webContents.getURL()));
  });
  // Compartir pantalla: de momento la pantalla principal (el selector con miniaturas, en la siguiente versión).
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
      callback(sources[0] ? { video: sources[0], audio: "loopback" } : {});
    });
  });
  if (!app.isDefaultProtocolClient("talkern")) app.setAsDefaultProtocolClient("talkern");
  loadSettings();
  buildMenu();
  createWindow();
  createTray();
  // Cada mensaje del puente se acepta solo si lo manda la web de Talkern, nunca otra página.
  const fromSite = (event) => isSiteUrl(event.senderFrame?.url ?? "");
  ipcMain.on("badge", (event, value) => {
    if (fromSite(event) && (typeof value === "number" || typeof value === "boolean")) setBadge(value);
  });
  ipcMain.on("focus", (event) => {
    if (fromSite(event)) showWindow();
  });
  ipcMain.on("notify", (event, payload) => {
    if (fromSite(event)) notify(payload);
  });
  ipcMain.on("call", (event, active) => {
    if (fromSite(event)) setCallActive(Boolean(active));
  });
  // Al suspender y despertar el equipo, la web lo sabe y se reconecta.
  powerMonitor.on("suspend", () => sendState("suspend"));
  powerMonitor.on("resume", () => sendState("resume"));
  // Actualización automática: al arrancar y cada seis horas.
  autoUpdater.autoDownload = true;
  autoUpdater.channel = settings.channel;
  autoUpdater.allowPrerelease = settings.channel === "beta";
  const check = () => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    void checkMinimumVersion();
  };
  check();
  setInterval(check, 6 * 60 * 60 * 1000);
});

app.on("second-instance", (_event, argv) => {
  const link = argv.find((a) => a.startsWith("talkern://"));
  const url = link ? fromDeepLink(link) : null;
  if (url) openInApp(url);
  else showWindow();
});
app.on("open-url", (event, link) => {
  event.preventDefault();
  const url = fromDeepLink(link);
  if (url) openInApp(url);
});
app.on("activate", () => {
  if (win) showWindow();
  else createWindow();
});
app.on("before-quit", () => {
  quitting = true;
});
app.on("window-all-closed", () => {
  // Nada: la app sigue en la bandeja hasta «Salir».
});
