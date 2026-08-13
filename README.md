# QBerries · Supervisores Cosecha

Prototipo móvil (PWA) para registro de cosecha de arándanos: **Grupo → Trabajador → Lote → Guías (jarras/jabas)**.

## Variables de entorno (Netlify) — igual que qpack

En **Site configuration → Environment variables** configure:

| Variable | Uso |
|----------|-----|
| `LOGIN_PIN` | Contraseña de acceso (definir solo en Netlify) |
| `API_TOKEN` | Token secreto hacia Apps Script (solo en Netlify) |
| `APPS_SCRIPT_URL` | URL del Web App de Google Apps Script |

En Netlify, ponga `LOGIN_PIN` = la contraseña de la empresa. El cliente no lee el env: valida vía `/.netlify/functions/login`.

Plantilla: `.env.example`

## Desplegar en Netlify

1. Suba este repo a GitHub (o arrastre la carpeta a Netlify).
2. Build settings: publish `.` · functions `netlify/functions` (ya en `netlify.toml`).
3. Configure las variables en Netlify (nunca en el código).
4. Deploy.

## Local

Abra `index.html`. Sin Functions, usa la misma contraseña por defecto.

## Offline / PWA

- Primera visita **con internet** instala la app en caché (Service Worker).
- Después funciona **sin internet**: registro, KPIs, Excel/PDF locales.
- Subir a la nube solo con conexión (Netlify + Apps Script).
- En el celular: “Agregar a pantalla de inicio” para usarla como app.
