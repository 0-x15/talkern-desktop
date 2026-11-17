# Talkern para escritorio

La app de Talkern para Windows, Mac y Linux: una ventana propia que carga Talkern web, con avisos del sistema, globo de no leídos, enlaces `talkern://`, permisos de micrófono y cámara, compartir pantalla y actualización automática. La web de dentro se actualiza sola; esta app solo cambia cuando cambia lo nativo.

- `pnpm install`
- `pnpm start` (producción), `pnpm start:staging`, `pnpm start:local` (localhost:3001)
- `pnpm run pack:dir` → app sin empaquetar en `dist/` para probar; `pnpm dist` → instaladores en `dist/` (DMG universal, instalador de Windows x64/arm64, AppImage y .deb)
- `pnpm release` → publica en las Releases de GitHub (de ahí se actualizan las apps instaladas)

Sin firma, Mac pide abrir con clic derecho → Abrir y Windows «Más información → Ejecutar de todos modos». Las firmas (Apple Developer, Azure Trusted Signing) se añaden con las variables de entorno de electron-builder.
