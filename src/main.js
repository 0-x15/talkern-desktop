// Talkern para escritorio (docs/fundamentos.md, decisión del 18 de noviembre de 2026).
// Una ventana que carga Talkern web; aquí vive solo lo que el navegador no puede dar:
// bandeja, globo de no leídos, enlaces talkern://, permisos de medios, compartir
// pantalla, actualización automática.
import { app, BrowserWindow, Menu, Tray, nativeImage, shell, session, ipcMain, desktopCapturer, nativeTheme } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { autoUpdater } = require("electron-updater");
const here = path.dirname(fileURLToPath(import.meta.url));

const SITE = process.env.TALKERN_URL ?? "https://talkern.com";
const SITE_HOSTS = new Set([new URL(SITE).host, "talkern.com", "www.talkern.com", "staging.talkern.com"]);
const isMac = process.platform === "darwin";

let win = null;
let tray = null;
let quitting = false;

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

function openInApp(url) {
  if (!win) return;
  win.loadURL(url);
  showWindow();
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
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

  // Cerrar la ventana no cierra la app: sigue en la bandeja (o en el dock) y avisando.
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    if (isMac) app.hide();
    else win.hide();
  });
  win.on("closed", () => {
    win = null;
  });
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
      { label: "Salir", click: () => app.quit() },
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

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { label: "Edición", role: "editMenu" },
    {
      label: "Ver",
      submenu: [
        { label: "Inicio de Talkern", accelerator: "CmdOrCtrl+Shift+H", click: () => openInApp(`${SITE}/app`) },
        { role: "reload" },
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
  buildMenu();
  createWindow();
  createTray();
  ipcMain.on("badge", (_event, value) => setBadge(value));
  ipcMain.on("focus", showWindow);
  // Actualización automática: al arrancar y cada seis horas.
  autoUpdater.autoDownload = true;
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 6 * 60 * 60 * 1000);
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
