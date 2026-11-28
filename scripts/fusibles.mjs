// Comprueba los fusibles de Electron de la app construida (fase 5 de la auditoría, TK-039 y TK-040): si alguno no está como
// debe, falla. Uso: node scripts/fusibles.mjs [ruta al ejecutable]; sin ruta, busca la app en dist/.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { FuseV1Options, FuseVersion, getCurrentFuseWire } from "@electron/fuses";

const EXPECTED = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
};
const NAMES = Object.fromEntries(Object.entries(FuseV1Options).map(([name, value]) => [value, name]));

function findBinary() {
  const dist = path.resolve("dist");
  if (!existsSync(dist)) return null;
  for (const dir of readdirSync(dist)) {
    const full = path.join(dist, dir);
    if (dir.startsWith("mac")) {
      const bin = path.join(full, "Talkern.app", "Contents", "MacOS", "Talkern");
      if (existsSync(bin)) return bin;
    }
    if (dir.endsWith("-unpacked")) {
      for (const candidate of ["Talkern.exe", "talkern", "Talkern"]) {
        const bin = path.join(full, candidate);
        if (existsSync(bin)) return bin;
      }
    }
  }
  return null;
}

const binary = process.argv[2] ?? findBinary();
if (!binary || !existsSync(binary)) {
  console.error("fusibles: no encuentro el ejecutable construido (pasa la ruta o construye con pnpm pack:dir)");
  process.exit(2);
}
const wire = await getCurrentFuseWire(binary);
if (wire.version !== FuseVersion.V1) {
  console.error(`fusibles: versión de fusibles inesperada (${wire.version})`);
  process.exit(1);
}
let bad = 0;
for (const [option, expected] of Object.entries(EXPECTED)) {
  // En el cable, 0x31 («1») es activado y 0x30 («0») desactivado.
  const state = wire[option];
  const enabled = state === 0x31 || state === "1" || state === 1;
  const ok = enabled === expected;
  console.log(`${ok ? "ok " : "MAL"} ${NAMES[option]}: ${enabled ? "activado" : "desactivado"}${ok ? "" : ` (debe estar ${expected ? "activado" : "desactivado"})`}`);
  if (!ok) bad++;
}
console.log(bad === 0 ? `fusibles correctos en ${binary}` : `${bad} fusible(s) mal en ${binary}`);
process.exit(bad === 0 ? 0 : 1);
