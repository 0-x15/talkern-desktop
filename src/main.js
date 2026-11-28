// Talkern para escritorio (docs/fundamentos.md, decisión del 18 de noviembre de 2026).
// Una ventana que carga Talkern web; aquí vive solo lo que el navegador no puede dar:
// bandeja, globo de no leídos, enlaces talkern://, permisos de medios, compartir
// pantalla, descargas, actualización automática.
import { app, BrowserWindow, Menu, Tray, Notification, nativeImage, shell, session, ipcMain, desktopCapturer, nativeTheme, powerMonitor, dialog } from "electron";
import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const here = path.dirname(fileURLToPath(import.meta.url));

const SITE = process.env.TALKERN_URL ?? "https://talkern.com";
const SITE_HOST = new URL(SITE).host;
// Solo el sitio configurado (y su «www»): las capacidades nativas no se conceden a otros orígenes.
const SITE_HOSTS = new Set([SITE_HOST, SITE_HOST.startsWith("www.") ? SITE_HOST.slice(4) : `www.${SITE_HOST}`]);
const isMac = process.platform === "darwin";
// Lo único que sale al navegador del sistema (fase 5 de la auditoría, TK-035): páginas web, correo y teléfono. Un esquema
// cualquiera (smb:, ms-msdt:, search-ms:, esquemas propios) no se abre: en Windows son vías conocidas de ejecución o engaño.
const SAFE_EXTERNAL = new Set(["https:", "http:", "mailto:", "tel:"]);

let win = null;
let tray = null;
let quitting = false;
let quitConfirmed = false;
let callActive = false;
/** Idioma de los textos propios de la app (páginas, avisos del sistema): el del equipo, español si no es inglés. */
let lang = "es";
const T = {
  es: {
    downloaded: "Descargado",
    downloadFailed: "No se pudo descargar",
    callGoesOn: "La reunión sigue en marcha. Abre Talkern desde la bandeja para volver o colgar.",
    quitTitle: "Estás en una reunión",
    quitBody: "Si sales de Talkern, cuelgas.",
    quitYes: "Colgar y salir",
    quitNo: "Seguir en la reunión",
    inCall: "Talkern · en una reunión",
    share: "Compartir pantalla",
  },
  en: {
    downloaded: "Downloaded",
    downloadFailed: "Could not download",
    callGoesOn: "The meeting is still on. Open Talkern from the tray to go back or hang up.",
    quitTitle: "You are in a meeting",
    quitBody: "Quitting Talkern hangs up.",
    quitYes: "Hang up and quit",
    quitNo: "Stay in the meeting",
    inCall: "Talkern · in a meeting",
    share: "Share screen",
  },
};
const t = (key) => T[lang][key] ?? T.es[key];

// Ajustes de la app (nunca tokens: la sesión vive en el almacén de cookies de Electron, cifrado).
const SETTINGS_FILE = () => path.join(app.getPath("userData"), "ajustes.json");
const DEFAULT_SETTINGS = { closeToTray: true, launchAtLogin: false, channel: "latest", bounds: null, maximized: false };
// Instalada desde Microsoft Store (paquete MSIX): las actualizaciones las trae la tienda (sin electron-updater),
// y el arranque con el sistema se controla en Configuración de Windows → Aplicaciones → Inicio.
const FROM_STORE = Boolean(process.windowsStore);
const STORE_UPDATES_URL = "ms-windows-store://downloadsandupdates";
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
      win.loadFile(path.join(here, "actualizar.html"), { query: { site: SITE, minimum, current: app.getVersion(), note: typeof data?.note === "string" ? data.note : "", store: FROM_STORE ? "1" : "0", lang } });
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

// La prueba de humo usa su propio nombre y carpeta de datos: nunca choca con la app instalada ni con sus cookies.
if (process.env.TALKERN_SMOKE) {
  app.setName("Talkern Smoke");
  app.setPath("userData", path.join(app.getPath("temp"), "talkern-smoke"));
}
// Las pruebas de Playwright (pnpm test) también traen su carpeta de datos propia.
if (process.env.TALKERN_PW_USER_DATA) app.setPath("userData", process.env.TALKERN_PW_USER_DATA);

// Una sola instancia: el segundo arranque (o un enlace talkern://) llega a la que ya corre.
if (!app.requestSingleInstanceLock()) app.quit();

function isSiteUrl(url) {
  try {
    return SITE_HOSTS.has(new URL(url).host);
  } catch {
    return false;
  }
}

/** Una página de la app (espacios, entrada, administración), no una página pública del sitio (portada, términos, precios). */
function isAppPath(url) {
  try {
    return /^\/(?:[a-z]{2}\/)?(w|app|admin|login|registro|entrar|invitacion|r)(\/|$)/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Abre en el navegador del sistema solo lo que es seguro abrir (TK-035). Devuelve si se abrió. */
function openExternal(url) {
  try {
    const parsed = new URL(url);
    if (!SAFE_EXTERNAL.has(parsed.protocol)) return false;
    void shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
}

/**
 * talkern://w/percent/c/general → https://talkern.com/w/percent/c/general. Las vueltas de Google (app móvil y
 * escritorio comparten el flujo): talkern://entrar?token_hash=… y talkern://google?ok=1 van a /entrar, que canjea
 * el token o abre Ajustes › Integraciones con el resultado.
 */
function fromDeepLink(link) {
  try {
    const u = new URL(link);
    if (u.protocol !== "talkern:") return null;
    if (u.host === "google") return new URL(`/entrar?google=${encodeURIComponent(u.searchParams.get("ok") === "1" ? "ok" : (u.searchParams.get("error") ?? "error"))}`, SITE).toString();
    return new URL(`/${u.host}${u.pathname}${u.search}`, SITE).toString();
  } catch {
    return null;
  }
}

/** Un enlace talkern:// que llegó con la app cerrada (macOS: open-url antes de la ventana; Windows y Linux: en argv). */
let pendingLink = process.argv.find((a) => a.startsWith("talkern://")) ?? null;
let navigateAck = null;

/**
 * Navegar dentro de la web ya cargada (sin recargar); si no hay web cargada, cargarla. La web confirma con
 * «navigated»; si nadie escucha (fuera de un espacio, TK-075), se carga la dirección directamente.
 */
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
  if (isSiteUrl(win.webContents.getURL())) {
    win.webContents.send("navigate", absolute);
    clearTimeout(navigateAck);
    navigateAck = setTimeout(() => {
      navigateAck = null;
      if (win && !win.isDestroyed()) win.loadURL(absolute);
    }, 700);
  } else {
    win.loadURL(absolute);
  }
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
      // La versión llega al puente por aquí (TK-054): el preload aislado no ve el entorno del proceso principal.
      additionalArguments: [`--talkern-version=${app.getVersion()}`],
    },
  });
  // Prueba de humo (TALKERN_SMOKE=1): carga la web sin enseñar la ventana y sale; para la CI y para comprobar que arranca.
  const smoke = Boolean(process.env.TALKERN_SMOKE);
  win.once("ready-to-show", () => {
    if (smoke) return;
    // La ventana vuelve como se dejó (TK-057): maximizada si lo estaba.
    if (settings.maximized) win.maximize();
    win.show();
  });
  if (smoke) {
    const done = (what) => {
      console.log(`smoke: ${what} ${win?.webContents.getURL() ?? ""}`);
      // En Windows la salida de consola de la app empaquetada no llega a la CI: el resultado va a un archivo.
      if (process.env.TALKERN_SMOKE_FILE) fs.writeFileSync(process.env.TALKERN_SMOKE_FILE, `${what}\n`);
      quitting = true;
      quitConfirmed = true;
      app.quit();
    };
    win.webContents.once("did-finish-load", () => done("ok"));
    win.webContents.once("did-fail-load", (_e, code, desc) => done(`fallo ${code} ${desc}`));
    setTimeout(() => done("tiempo agotado"), 20_000);
  }
  win.webContents.session.setSpellCheckerLanguages(["es-ES", "en-US"]);
  // Corrector (pulido pequeño, parte 3, 26-11-2026): botón derecho sobre una palabra subrayada → las
  // sugerencias del diccionario y «Añadir al diccionario»; donde se escribe, cortar, copiar y pegar.
  win.webContents.on("context-menu", (_event, params) => {
    const items = [];
    if (params.misspelledWord) {
      const suggestions = params.dictionarySuggestions.slice(0, 6);
      for (const suggestion of suggestions) {
        items.push({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) });
      }
      if (suggestions.length === 0) items.push({ label: "Sin sugerencias", enabled: false });
      items.push({ type: "separator" });
      items.push({ label: "Añadir al diccionario", click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: "separator" });
    }
    if (params.isEditable) {
      items.push({ role: "cut", enabled: params.editFlags.canCut }, { role: "copy", enabled: params.editFlags.canCopy }, { role: "paste", enabled: params.editFlags.canPaste });
    } else if (params.selectionText.trim()) {
      items.push({ role: "copy" });
    }
    if (items.length === 0) return;
    Menu.buildFromTemplate(items).popup({ window: win });
  });
  // Se arranca en la app (TK-038): la web lleva a entrar sin sesión y al último espacio con ella; o al enlace con el
  // que se abrió la app (TK-037).
  const start = (pendingLink && fromDeepLink(pendingLink)) || `${SITE}/app`;
  pendingLink = null;
  win.loadURL(start);

  // Lo que pide otra ventana: las páginas de la app, aquí (sin pisar la actual: Atrás vuelve); las páginas públicas del
  // sitio y los enlaces de fuera, en el navegador del sistema (TK-036), solo si el esquema es seguro (TK-035).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSiteUrl(url) && isAppPath(url)) navigateTo(url);
    else openExternal(url);
    return { action: "deny" };
  });
  // Ninguna navegación ni redirección del servidor saca la ventana de Talkern (TK-070): lo de fuera, al navegador.
  const guardNavigation = (event, url) => {
    if (isSiteUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  };
  win.webContents.on("will-navigate", guardNavigation);
  win.webContents.on("will-redirect", guardNavigation);

  // Cerrar la ventana no cierra la app: sigue en la bandeja (o en el dock) y avisando. En una reunión, se dice claro.
  win.on("close", (event) => {
    saveSettings({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
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
      const note = new Notification({ title: "Talkern", body: t("callGoesOn"), silent: true });
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
    win.loadFile(path.join(here, "offline.html"), { query: { site: SITE, lang } });
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
  tray?.setToolTip(active ? t("inCall") : "Talkern");
}

/** Salir con una reunión en curso: se pregunta antes de colgar (también con Cmd+Q o Alt+F4: before-quit pasa por aquí). */
async function quitFromMenu() {
  if (callActive && win && !quitConfirmed) {
    const { response } = await dialog.showMessageBox(win, { type: "question", buttons: [t("quitYes"), t("quitNo")], defaultId: 1, cancelId: 1, message: t("quitTitle"), detail: t("quitBody") });
    if (response !== 0) return;
  }
  quitConfirmed = true;
  quitting = true;
  app.quit();
}

/**
 * «Descargar» desde la web (TK-098): la descarga la hace la propia app, a la carpeta de descargas, sin pasar por el
 * navegador del sistema; al terminar, un aviso que abre la carpeta. Solo direcciones https (o la del sitio local).
 */
function download(url) {
  if (!win) return;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && SITE.startsWith("http://"))) return;
    win.webContents.downloadURL(parsed.toString());
  } catch {
    /* dirección inválida: nada */
  }
}
function uniquePath(dir, name) {
  const clean = (name || "archivo").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 150);
  const ext = path.extname(clean);
  const base = clean.slice(0, clean.length - ext.length) || "archivo";
  let candidate = path.join(dir, `${base}${ext}`);
  for (let i = 2; existsSync(candidate) && i < 1000; i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="#ff3b30"/><text x="16" y="21" font-family="Arial" font-weight="700" font-size="${count > 99 ? 12 : count > 9 ? 15 : 18}" fill="#fff" text-anchor="middle">${count > 99 ? "99+" : count}</text></svg>`;
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
      // En Mac cerrar la ventana nunca sale de la app (es lo normal en ese sistema): la opción no se enseña (TK-056).
      ...(isMac ? [] : [{ label: "Al cerrar la ventana, seguir en la bandeja", type: "checkbox", checked: settings.closeToTray, click: (item) => saveSettings({ closeToTray: item.checked }) }]),
      FROM_STORE
        ? { label: "Abrir al iniciar sesión: en Configuración de Windows → Aplicaciones → Inicio", enabled: false }
        : {
            label: "Abrir Talkern al iniciar sesión en el ordenador",
            type: "checkbox",
            checked: settings.launchAtLogin,
            click: (item) => {
              saveSettings({ launchAtLogin: item.checked });
              app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true });
            },
          },
      { type: "separator" },
      FROM_STORE
        ? { label: "Las versiones nuevas llegan desde Microsoft Store", enabled: false }
        : { label: "Recibir versiones beta", type: "checkbox", checked: settings.channel === "beta", click: (item) => { saveSettings({ channel: item.checked ? "beta" : "latest" }); autoUpdater.channel = settings.channel; autoUpdater.allowPrerelease = item.checked; } },
    ],
  };
}

function buildMenu() {
  const history = () => win?.webContents.navigationHistory;
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: "about" }, { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { label: "Salir de Talkern", accelerator: "Command+Q", click: () => void quitFromMenu() }] }] : []),
    { label: "Edición", role: "editMenu" },
    {
      label: "Ver",
      submenu: [
        { label: "Inicio de Talkern", accelerator: "CmdOrCtrl+Shift+H", click: () => openInApp(`${SITE}/app`) },
        // Atrás y Adelante (TK-036): una página abierta desde un enlace de la app se deshace como en el navegador.
        { label: "Atrás", accelerator: isMac ? "Command+[" : "Alt+Left", click: () => { if (history()?.canGoBack()) history().goBack(); } },
        { label: "Adelante", accelerator: isMac ? "Command+]" : "Alt+Right", click: () => { if (history()?.canGoForward()) history().goForward(); } },
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
        FROM_STORE
          ? { label: "Actualizaciones en Microsoft Store", click: () => openExternal(STORE_UPDATES_URL) || shell.openExternal(STORE_UPDATES_URL) }
          : { label: "Buscar actualizaciones", click: () => autoUpdater.checkForUpdatesAndNotify().catch(() => {}) },
        { label: `Versión ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Compartir pantalla (TK-099): en macOS 15 o posterior, el selector del sistema; en el resto, una ventana propia con
 * las pantallas y las ventanas abiertas (miniaturas). Si el sistema no da fuentes, la web recibe el fallo en el acto.
 */
function pickSource() {
  return desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: true }).then((sources) => {
    if (sources.length === 0) return null;
    return new Promise((resolve) => {
      const picker = new BrowserWindow({
        parent: win ?? undefined,
        modal: Boolean(win),
        width: 760,
        height: 560,
        resizable: false,
        minimizable: false,
        maximizable: false,
        title: t("share"),
        backgroundColor: nativeTheme.shouldUseDarkColors ? "#121316" : "#f5f7fa",
        webPreferences: { preload: path.join(here, "selector-preload.cjs"), contextIsolation: true, sandbox: true },
      });
      let settled = false;
      const finish = (id) => {
        if (settled) return;
        settled = true;
        ipcMain.removeListener("share-pick", onPick);
        resolve(sources.find((s) => s.id === id) ?? null);
        if (!picker.isDestroyed()) picker.close();
      };
      const onPick = (event, id) => {
        if (event.sender === picker.webContents) finish(typeof id === "string" ? id : null);
      };
      ipcMain.on("share-pick", onPick);
      picker.on("closed", () => finish(null));
      picker.removeMenu();
      picker.webContents.once("did-finish-load", () => {
        picker.webContents.send(
          "sources",
          sources.map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith("screen:") ? "screen" : "window", thumbnail: s.thumbnail.toDataURL(), icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null })),
        );
      });
      picker.loadFile(path.join(here, "selector.html"), { query: { lang } });
    });
  });
}

app.whenReady().then(() => {
  lang = app.getLocale().toLowerCase().startsWith("en") ? "en" : "es";
  // Permisos de medios y avisos solo para Talkern; el resto, denegado.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ["media", "notifications", "clipboard-read", "clipboard-sanitized-write", "display-capture", "fullscreen"];
    callback(allowed.includes(permission) && isSiteUrl(webContents.getURL()));
  });
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      pickSource()
        .then((source) => callback(source ? { video: source, ...(process.platform === "win32" && source.id.startsWith("screen:") ? { audio: "loopback" } : {}) } : {}))
        .catch(() => callback({}));
    },
    { useSystemPicker: true },
  );
  // Descargas (TK-098): a la carpeta de descargas con el nombre del archivo, sin preguntar, y un aviso al terminar.
  session.defaultSession.on("will-download", (_event, item) => {
    const savePath = uniquePath(app.getPath("downloads"), item.getFilename());
    item.setSavePath(savePath);
    item.once("done", (_e, state) => {
      if (!Notification.isSupported()) return;
      const ok = state === "completed";
      const note = new Notification({ title: ok ? t("downloaded") : t("downloadFailed"), body: path.basename(savePath), silent: true });
      if (ok) note.on("click", () => shell.showItemInFolder(savePath));
      note.show();
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
  ipcMain.on("download", (event, url) => {
    if (fromSite(event) && typeof url === "string") download(url);
  });
  // La web confirma que atendió un «navigate»: si no llega, navigateTo carga la dirección (TK-075).
  ipcMain.on("navigated", (event) => {
    if (!fromSite(event)) return;
    clearTimeout(navigateAck);
    navigateAck = null;
  });
  // Al suspender y despertar el equipo, la web lo sabe y se reconecta.
  powerMonitor.on("suspend", () => sendState("suspend"));
  powerMonitor.on("resume", () => sendState("resume"));
  // Actualización automática: al arrancar y cada seis horas (desde la tienda, solo la versión mínima).
  autoUpdater.autoDownload = true;
  autoUpdater.channel = settings.channel;
  autoUpdater.allowPrerelease = settings.channel === "beta";
  const check = () => {
    if (!FROM_STORE) autoUpdater.checkForUpdatesAndNotify().catch(() => {});
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
  // Con la app aún arrancando (macOS), el enlace espera a la ventana (TK-037).
  if (!win) {
    pendingLink = link;
    return;
  }
  const url = fromDeepLink(link);
  if (url) openInApp(url);
});
app.on("activate", () => {
  if (win) showWindow();
  else createWindow();
});
// Salir en plena reunión (Cmd+Q, Alt+F4 con «cerrar sale», apagado): se pregunta una vez (TK-100).
app.on("before-quit", (event) => {
  if (callActive && !quitConfirmed && win && !win.isDestroyed()) {
    event.preventDefault();
    void quitFromMenu();
    return;
  }
  quitting = true;
});
app.on("window-all-closed", () => {
  // Nada: la app sigue en la bandeja hasta «Salir».
});
