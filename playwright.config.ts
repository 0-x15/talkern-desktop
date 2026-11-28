import { defineConfig } from "@playwright/test";

/**
 * Pruebas de la app de escritorio (fase 5 de la auditoría): arrancan Electron de verdad contra la web local
 * (TALKERN_URL, por defecto http://localhost:3001) y comprueban lo que el navegador no puede: qué sale al sistema,
 * qué se queda dentro de la ventana, dónde arranca la app y cómo llega un enlace talkern://. Se corren en local
 * antes de publicar: `pnpm test`.
 */
export default defineConfig({
  testDir: "tests",
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
});
