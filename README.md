# QBerries · Supervisores Cosecha

Prototipo móvil (PWA) para registro de cosecha de arándanos.

## Acceso (como app real)

1. Escanea el carnet QR (solo Supervisores de Cosecha).
2. Ingresa la contraseña personal (validada en Netlify, no en el celular).
3. La sesión queda en ese dispositivo hasta **Cerrar sesión**.
4. Guardar vínculos exige un token firmado de esa sesión.

## Variables de entorno (Netlify)

En **Site configuration → Environment variables** configure:

| Variable | Uso |
|----------|-----|
| `LOGIN_PIN` | Contraseña de prueba compartida (ej. `231223`) |
| `SUPERVISOR_PINS` | Opcional: `{"DNI":"clave",...}` una clave por supervisor |
| `API_TOKEN` | Token secreto hacia Apps Script + firma de sesión |
| `APPS_SCRIPT_URL` | URL del Web App de Google Apps Script |

Si configura `SUPERVISOR_PINS`, cada DNI usa su clave; si no, todos usan `LOGIN_PIN`. El cliente no lee estas variables: valida vía `/.netlify/functions/login`.

Plantilla: `.env.example`

## Desplegar en Netlify

1. Suba este repo a GitHub (o arrastre la carpeta a Netlify).
2. Build settings: publish `.` · functions `netlify/functions` (ya en `netlify.toml`).
3. Configure las variables en Netlify (nunca en el código).
4. Deploy.

## Local

Abra la app con el servidor Netlify/local. El primer acceso con contraseña necesita internet (validación en servidor).

## Instalar con QR

Página de instalación: `/instalar/` (por ejemplo `https://qberries-cosecha.netlify.app/instalar/`).

- QR listo para imprimir: `assets/qr-instalar-app.png`.
- La página detecta el celular: en **Android** muestra un botón que instala la app;
  en **iPhone** guía los tres pasos de Safari (Compartir → Añadir a pantalla de inicio),
  porque iOS no permite instalar por código.
- La propia página dibuja su QR, así que si cambia el dominio el código se actualiza solo.
- También se llega desde la app: **Ayuda → engranaje → QR para instalar en otro celular**.

## Offline / PWA

- Primera visita **con internet** instala la app en caché (Service Worker).
- Después funciona **sin internet** si ya hay sesión en el dispositivo.
- Subir a la nube solo con conexión (Netlify + Apps Script).
- En el celular: “Agregar a pantalla de inicio” para usarla como app.
