# POS UI (`pos-ui`)

Angular 19 — punto de venta. Producción: **https://pos.appluxora.com**.

| API | URL prod |
|-----|----------|
| Identity (SSO) | `https://api-suite.appluxora.com` |
| POS backend (`pos-app`) | `https://api-pos.appluxora.com` (cuando esté desplegado) |

Deploy automático: push a `master`/`main` → GitHub Actions → `/opt/pos-ui/html`.  
Environment GitHub: **`POS_UI_CI_CD`**, secrets `POS_UI_DEPLOY_*`.

Ver [DEPLOY-FRONTENDS-APPLUXORA.md](../../docs/DEPLOY-FRONTENDS-APPLUXORA.md).

## Desarrollo

```bash
npm install
npm start
```

`http://localhost:4220` — APIs locales en `environment.ts`.

## Publicar manual

```powershell
.\deploy\publish-dist.ps1
```
