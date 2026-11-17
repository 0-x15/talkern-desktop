# Talkern para escritorio

La app de Talkern para Windows, Mac y Linux: una ventana propia que carga Talkern web, con avisos del sistema, globo de no leídos, enlaces `talkern://`, permisos de micrófono y cámara, compartir pantalla y actualización automática. La web de dentro se actualiza sola; esta app solo cambia cuando cambia lo nativo.

- `pnpm install`
- `pnpm start` (producción), `pnpm start:staging`, `pnpm start:local` (localhost:3001)
- `pnpm run pack:dir` → app sin empaquetar en `dist/` para probar; `pnpm dist` → instaladores en `dist/` (DMG universal, instalador de Windows x64/arm64, AppImage y .deb)
- `pnpm release` → construye y sube a la Release de GitHub (lo usa la CI; de ahí se actualizan las apps instaladas)

Sin firma, Mac pide abrir con clic derecho → Abrir y Windows «Más información → Ejecutar de todos modos». Las firmas (Apple Developer, Azure Trusted Signing) se añaden con las variables de entorno de electron-builder.

## Publicar una versión

1. Sube `version` en `package.json` (por ejemplo `0.1.1`; una beta, `0.2.0-beta.1`), commit a `main`.
2. Etiqueta y sube la etiqueta: `git tag v0.1.1 && git push origin v0.1.1`.
3. La CI crea la Release en borrador, construye el instalador de Linux (AppImage y .deb) y, si la firma está configurada, los de Windows (x64 y ARM) y Mac; los prueba (arranque del AppImage; instalación silenciosa en Windows y arranque) y publica la Release. Las apps instaladas se actualizan solas; una beta (`-beta.N`) solo llega a quien tenga «Recibir versiones beta».
4. Si algo falla, la Release se queda en borrador (no la ve nadie): corrige, borra la etiqueta y vuelve a etiquetar.

**Nada se publica sin firma.** Un sistema sin firma configurada no se construye, y talkern.com lo enseña como «próximamente».

- **Windows**: variable del repositorio `PUBLISH_WINDOWS=true` y los secretos del proveedor: con Azure Trusted Signing, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` y `AZURE_CLIENT_SECRET` (y `win.azureSignOptions` en `package.json`); con un certificado propio en la nube o en archivo, `WIN_CSC_LINK` y `WIN_CSC_KEY_PASSWORD` (o un script de firma propio en `win.signtoolOptions.sign`).
- **Mac**: `PUBLISH_MAC=true` y, de la cuenta de Apple Developer (99 $/año), el certificado «Developer ID Application» en base64 (`MAC_CSC_LINK`) con su contraseña (`MAC_CSC_KEY_PASSWORD`), más `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` y `APPLE_TEAM_ID` para notarizar.
