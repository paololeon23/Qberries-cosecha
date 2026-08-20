/**
 * Enlaces Apps Script · la app llama DIRECTO (sin Netlify Functions).
 * Netlify solo sirve HTML/JS. Si cambia el deploy, pegue la nueva URL aquí
 * y vuelva a subir el sitio.
 */
(function (global) {
  "use strict";
  global.QB_SCRIPT = Object.freeze({
    /** Guías → Code-guias.gs → Sheet DATA-GUIAS (sin token) */
    GUIAS:
      "https://script.google.com/macros/s/AKfycbxVryHDgOjOdiYRhFjBN1dxy6ozSzCwRMFKRW-6QM9h97Fraclys4ftTCM6Z9-vL5BX/exec",
  });
})(typeof window !== "undefined" ? window : globalThis);
