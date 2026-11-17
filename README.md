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

- **Windows (Microsoft Store)**: la tienda firma el paquete. Identidad de Partner Center (pública, en `package.json` → `build.appx` y en las variables del repositorio `APPX_IDENTITY_NAME`, `APPX_PUBLISHER` y `APPX_PUBLISHER_DISPLAY_NAME`): `Talkern.Talkern`, `CN=149B951D-AE97-4545-8FFD-37464BE2AD3E`, «Talkern»; ficha https://apps.microsoft.com/detail/9NS88B503GPZ. Con ellas, cada etiqueta construye el paquete `.appx`, lo prueba (instalado con un certificado de prueba) y lo guarda como artefacto de la ejecución; se sube a mano en Partner Center (la subida automática por la API de la tienda, más adelante). La app instalada desde la tienda no usa electron-updater: las versiones nuevas llegan por la tienda. El «Store ID» de la ficha va en la web (`WINDOWS_STORE_ID`) para enlazarla.
- **Windows (instalador .exe directo, opcional, con certificado)**: `PUBLISH_WINDOWS=true` y los secretos del proveedor: con Azure Trusted Signing, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` y `AZURE_CLIENT_SECRET` (y `win.azureSignOptions` en `package.json`); con un certificado propio, `WIN_CSC_LINK` y `WIN_CSC_KEY_PASSWORD`.
- **Mac**: `PUBLISH_MAC=true` y, de la cuenta de Apple Developer (99 $/año), el certificado «Developer ID Application» en base64 (`MAC_CSC_LINK`) con su contraseña (`MAC_CSC_KEY_PASSWORD`), más `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` y `APPLE_TEAM_ID` para notarizar.
