import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SITE = process.env.TALKERN_URL ?? "http://localhost:3001";

/** Arranca la app con su propia carpeta de datos (nunca la instalada) y, si se pide, un enlace talkern:// en argv. */
async function launch(extraArgs: string[] = []) {
  const userData = mkdtempSync(path.join(os.tmpdir(), "talkern-pw-"));
  const app = await electron.launch({
    args: [".", ...extraArgs],
    env: { ...process.env, TALKERN_URL: SITE, TALKERN_SMOKE: "", TALKERN_PW_USER_DATA: userData },
  });
  // Los avisos de permisos del sistema no bloquean la prueba.
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}

/** Intercepta shell.openExternal en el proceso principal y devuelve lo que se le pidió abrir. */
async function captureExternal(app: ElectronApplication) {
  await app.evaluate(({ shell }) => {
    const calls: string[] = [];
    (globalThis as unknown as { __external: string[] }).__external = calls;
    shell.openExternal = async (url: string) => {
      calls.push(url);
    };
  });
  return () => app.evaluate(() => (globalThis as unknown as { __external: string[] }).__external);
}

test("solo https, http, mailto y tel salen al navegador del sistema (TK-035); las páginas de la app no pisan la actual (TK-036)", async () => {
  const { app, page } = await launch();
  const external = await captureExternal(app);
  const before = page.url();
  await page.evaluate(() => {
    for (const url of ["smb://servidor/compartida", "x-audit-dsk://hola", "ms-msdt:/id PCWDiagnostic", "search-ms:query=talkern", "file:///etc/hosts", "https://example.com/doc", "mailto:hola@example.com", "tel:+34600000000"]) {
      window.open(url, "_blank");
    }
  });
  await expect.poll(external).toEqual(["https://example.com/doc", "mailto:hola@example.com", "tel:+34600000000"]);
  // Una página pública del sitio abierta en otra pestaña va al navegador; la ventana sigue donde estaba.
  await page.evaluate((site) => window.open(`${site}/terminos`, "_blank"), SITE);
  await expect.poll(external).toContain(`${SITE}/terminos`);
  expect(page.url()).toBe(before);
  await app.close();
});

test("una redirección del servidor hacia fuera de Talkern no se carga en la ventana (TK-070)", async () => {
  const { app, page } = await launch();
  const external = await captureExternal(app);
  const prevented = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    win.webContents.emit("will-redirect", event, "https://accounts.google.com/o/oauth2/v2/auth?x=1");
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect.poll(external).toContain("https://accounts.google.com/o/oauth2/v2/auth?x=1");
  const kept = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    win.webContents.emit("will-redirect", event, `${win.webContents.getURL().split("/").slice(0, 3).join("/")}/w/x`);
    return event.defaultPrevented;
  });
  expect(kept).toBe(false);
  expect(page.url()).toContain(new URL(SITE).host);
  await app.close();
});

test("la app arranca en la app, no en la portada (TK-038), y un enlace talkern:// recibido al arrancar llega a su destino (TK-037)", async () => {
  const { app, page } = await launch();
  await page.waitForURL((u) => u.pathname !== "/" && u.pathname !== "/es" && u.pathname !== "/en", { timeout: 20_000 });
  expect(new URL(page.url()).pathname).toMatch(/\/(login|w\/|app)/);
  await app.close();

  const second = await launch(["talkern://w/espacio-prueba/c/general"]);
  await second.page.waitForURL(/espacio-prueba|next=/, { timeout: 20_000 });
  const url = new URL(second.page.url());
  expect(`${url.pathname}${decodeURIComponent(url.search)}`).toContain("/w/espacio-prueba/c/general");
  await second.app.close();
});

test("el puente expone la versión y lo nuevo de la fase 5 (TK-054, TK-055), y una descarga va por la app (TK-098)", async () => {
  const { app, page } = await launch();
  const bridge = await page.evaluate(() => {
    const d = (window as unknown as { talkernDesktop?: Record<string, unknown> }).talkernDesktop;
    return d ? { version: d.version, keys: Object.keys(d).sort(), badge: typeof (navigator as unknown as { setAppBadge?: unknown }).setAppBadge } : null;
  });
  expect(bridge?.version).toMatch(/^\d+\.\d+\.\d+/);
  expect(bridge?.keys).toEqual(["download", "focus", "navigated", "notify", "onNavigate", "onState", "platform", "setBadge", "setCallActive", "version"]);
  // La app descarga con su propio motor (nada sale al navegador): se comprueba que downloadURL recibe la dirección.
  const downloads = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const seen: string[] = [];
    win.webContents.downloadURL = (url: string) => {
      seen.push(url);
    };
    (globalThis as unknown as { __downloads: string[] }).__downloads = seen;
    return seen.length;
  });
  expect(downloads).toBe(0);
  const external = await captureExternal(app);
  await page.evaluate(() => (window as unknown as { talkernDesktop: { download: (u: string) => void } }).talkernDesktop.download("https://files.example.com/adjunto.pdf?download=1"));
  await page.evaluate(() => (window as unknown as { talkernDesktop: { download: (u: string) => void } }).talkernDesktop.download("smb://servidor/x"));
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __downloads: string[] }).__downloads)).toEqual(["https://files.example.com/adjunto.pdf?download=1"]);
  expect(await external()).toEqual([]);
  await app.close();
});
