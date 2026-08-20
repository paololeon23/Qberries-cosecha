(() => {
  "use strict";

  const STORAGE_KEY = "qb-supervisores-guia-v5";
  const PERSONAS_KEY = "qb-trabajadores-v1";
  const SUPERVISORES_KEY = "qb-supervisores-cosecha-v2";
  const PERSONAS_META_KEY = "qb-trabajadores-meta-v1";
  const VINCULO_QUEUE_KEY = "qb-supervisores-vinculo-queue-v1";
  const CLOUD_DATA_QUEUE_KEY = "qb-supervisores-data-queue-v1";
  const DRIVE_QUEUE_KEY = "qb-supervisores-drive-queue-v1";
  const HARVEST_DRIVE_URL_KEY = "qb-supervisores-harvest-drive-url-v1";
  const VINCULO_DONE_KEY = "qb-supervisores-vinculo-done-v1";
  const CUSTOM_CATALOG_KEY = "qb-supervisores-catalog-extra-v1";
  const PIN_KEY = "qb-supervisores-pin-v2";
  const SESSION_KEY = "qb-supervisores-unlocked";
  const SESSION_PIN_KEY = "qb-supervisores-session-pin";
  const IDENTITY_KEY = "qb-supervisores-identity";
  const IDENTITY_LS_KEY = "qb-supervisores-identity-ls";
  const AUTH_SESSION_KEY = "qb-supervisores-auth-v1";
  const HARVEST_KEY = "qb-supervisores-harvest-v1";
  const HARVEST_HISTORY_KEY = "qb-supervisores-excel-history-v1";
  const HARVEST_SENT_KEY = "qb-supervisores-harvest-sent-v1";
  const GUIAS_HISTORY_KEY = "qb-supervisores-guias-history-v1";
  const SESSION_MANUAL_PERSONAS_KEY = "qb-supervisores-manual-personas-v1";
  const SESSION_WORKERS_KEY = "qb-supervisores-session-workers-v1";
  const SAVED_WORKERS_KEY = "qb-supervisores-saved-workers-v2";
  const LOGOUT_FLAG_KEY = "qb-supervisores-logout-v1";
  const CACHE_DAY_KEY = "qb-supervisores-cache-day-v1";
  const HISTORY_TTL_MS = 48 * 60 * 60 * 1000;
  const HISTORY_PAGE_SIZE = 8;
  const JARRAS_POR_JABA = 12;
  const FUNDO_DEFAULT = "Licapa";
  const FUNDO_OPTIONS = ["Licapa", "Licapa II"];
  const APP_VERSION = "v361";

  function normalizeFundo(value) {
    const raw = String(value || "").trim();
    if (!raw) return FUNDO_DEFAULT;
    const hit = FUNDO_OPTIONS.find(
      (f) => f.toLowerCase() === raw.toLowerCase()
    );
    return hit || FUNDO_DEFAULT;
  }
  const HARVEST_TYPES = [
    { key: "suma-jarras", label: "Suma de jarras", short: "Suma", observacion: "SUMAR JARRAS" },
    { key: "descuento-jarras", label: "Descuento jarras", short: "Resta", observacion: "DESCUENTO JARRAS" },
    { key: "descarte-deshidratado", label: "Descarte - deshidratado", short: "Descarte", observacion: "DESCARTE - DESHIDRATADO" },
  ];
  const DEFAULT_PIN = "";
  /** Contraseña en pausa: por ahora solo QR. Reactivar con true cuando toque. */
  const PASSWORD_REQUIRED = false;
  /** Por ahora: tras vincular NO pasar a Datos de campo */
  const SESSION_FORM_ENABLED = false;
  function getPage() {
    return document.body?.dataset?.page || "scan";
  }
  const TAB_SHELL_LS_KEY = "qb-tab-shells-v2";
  const tabShellCache = new Map();

  /** Unifica /registro/ y /registro/index.html para la caché de pestañas. */
  function normalizeTabShellKey(pathname) {
    try {
      let p = String(pathname || "/");
      if (!p.startsWith("/")) p = `/${p}`;
      p = p.replace(/\/index\.html$/i, "/");
      if (p.length > 1 && !p.endsWith("/")) p += "/";
      return p;
    } catch {
      return String(pathname || "/");
    }
  }

  function getTabShell(path) {
    const key = normalizeTabShellKey(path);
    return tabShellCache.get(key) || tabShellCache.get(path) || null;
  }

  function setTabShell(path, data) {
    const key = normalizeTabShellKey(path);
    if (!data?.html) return;
    tabShellCache.set(key, data);
    persistTabShellToStorage(key, data);
  }

  function clearTabShellStorage() {
    tabShellCache.clear();
    try {
      localStorage.removeItem(TAB_SHELL_LS_KEY);
      localStorage.removeItem("qb-tab-shells-v1");
    } catch {
      /* ignore */
    }
  }

  function loadTabShellsFromStorage() {
    try {
      const raw =
        localStorage.getItem(TAB_SHELL_LS_KEY) ||
        localStorage.getItem("qb-tab-shells-v1") ||
        "{}";
      const parsed = JSON.parse(raw);
      Object.entries(parsed).forEach(([path, data]) => {
        if (data && typeof data.html === "string" && data.html) {
          const key = normalizeTabShellKey(path);
          tabShellCache.set(key, {
            html: data.html,
            page: data.page || "",
            title: data.title || "QBerries",
          });
        }
      });
    } catch {
      /* ignore */
    }
  }

  function persistTabShellToStorage(path, data) {
    if (!path || !data?.html) return;
    try {
      const key = normalizeTabShellKey(path);
      const stored = JSON.parse(localStorage.getItem(TAB_SHELL_LS_KEY) || "{}");
      stored[key] = {
        html: data.html,
        page: data.page || "",
        title: data.title || "QBerries",
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(TAB_SHELL_LS_KEY, JSON.stringify(stored));
    } catch {
      /* ignore */
    }
  }
  const ROUTES = {
    scan: "/index.html",
    registro: "/registro/index.html",
    vinculo: "/vinculo/index.html",
  };
  /** En APK la UI vive en localhost; las funciones van al sitio Netlify. */
  const CLOUD_ORIGIN = "https://qberries-cosecha.netlify.app";

  /** Guías: fetch directo a Apps Script (no pasa por Netlify Functions). */
  function scriptGuiasUrl() {
    const fromCfg = String(window.QB_SCRIPT?.GUIAS || "").trim();
    return (
      fromCfg ||
      "https://script.google.com/macros/s/AKfycbxVryHDgOjOdiYRhFjBN1dxy6ozSzCwRMFKRW-6QM9h97Fraclys4ftTCM6Z9-vL5BX/exec"
    );
  }

  /** Excel → Drive: URL …/exec de Code-excel-drive.gs */
  function scriptExcelDriveUrl() {
    return String(window.QB_SCRIPT?.EXCEL_DRIVE || "").trim();
  }

  function isGuiasCloudAction(action) {
    return (
      action === "registrarGuias" || action === "sync_guias_cosecha"
    );
  }

  /**
   * POST directo al /exec de guías (como conteo en otras apps).
   * text/plain evita preflight CORS con Apps Script.
   */
  async function postGuiasToAppsScript(data) {
    const url = scriptGuiasUrl();
    if (!url) throw new Error("Falta URL de guías en api-config.js");
    const res = await fetch(url, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "registrarGuias",
        data: data || {},
      }),
    });
    const text = await res.text();
    const parsed = parseAppsScriptJson(text);
    if (!parsed) {
      console.warn("postGuiasToAppsScript empty/invalid", res.status, text?.slice?.(0, 200));
      return {
        ok: false,
        parsed: null,
        status: res.status,
        message: "El servidor no respondió bien. Reintente.",
      };
    }
    if (parsed.ok !== true) {
      return {
        ok: false,
        parsed,
        status: res.status,
        message: parsed.message || "No se pudo guardar en Guías",
      };
    }
    return { ok: true, parsed, status: res.status };
  }

  function parseAppsScriptJson(text) {
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = String(text || "").match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          parsed = null;
        }
      }
    }
    return parsed;
  }

  function bytesToBase64(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  /**
   * Sube el Excel del snapshot a la carpeta Drive configurada en Apps Script.
   * Devuelve { ok, url, name, message }.
   */
  async function uploadHarvestExcelToDrive(snapshot) {
    const url = scriptExcelDriveUrl();
    if (!url) {
      return {
        ok: false,
        message:
          "Falta configurar Drive: pegue la URL …/exec en api-config.js (EXCEL_DRIVE)",
      };
    }
    if (!snapshot) {
      return { ok: false, message: "No hay registro para subir" };
    }
    if (typeof XLSX === "undefined") {
      return { ok: false, message: "Excel no disponible · recargue la app" };
    }

    let fileName = "cosecha.xlsx";
    let base64 = "";
    try {
      const wb = buildHarvestWorkbook(snapshot);
      const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      fileName = safeXlsxShareName(harvestFileName(snapshot));
      base64 = bytesToBase64(bytes);
    } catch (err) {
      console.warn("uploadHarvestExcelToDrive build", err);
      return { ok: false, message: "No se pudo crear el Excel" };
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "uploadExcel",
          data: {
            fileName,
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            base64,
            // Carpeta Drive: Suma / Resta / Descarte (no mezclar)
            tipo: normalizeHarvestType(snapshot.tipo),
            observacion: harvestTypeObservacion(snapshot.tipo),
          },
        }),
      });
      const text = await res.text();
      const parsed = parseAppsScriptJson(text);
      if (parsed?.ok && parsed.url) {
        return {
          ok: true,
          url: String(parsed.url),
          name: String(parsed.name || fileName),
          fileId: parsed.fileId || "",
        };
      }
      return {
        ok: false,
        message:
          parsed?.message ||
          "No se pudo subir a Drive. Revise el script y el enlace de carpeta.",
      };
    } catch (err) {
      console.warn("uploadHarvestExcelToDrive", err);
      return { ok: false, message: "Error de red al subir a Drive" };
    }
  }

  function loadDriveQueue() {
    try {
      const q = JSON.parse(localStorage.getItem(DRIVE_QUEUE_KEY) || "[]");
      return Array.isArray(q) ? q : [];
    } catch {
      return [];
    }
  }

  function saveDriveQueue(queue) {
    localStorage.setItem(DRIVE_QUEUE_KEY, JSON.stringify(queue || []));
  }

  function isDriveUploadPending(snapshotId) {
    return loadDriveQueue().some((item) => item.id === String(snapshotId || ""));
  }

  function enqueueDriveUpload(snapshot) {
    if (!snapshot?.id) return false;
    const queue = loadDriveQueue().filter((item) => item.id !== snapshot.id);
    queue.push({
      id: snapshot.id,
      tipo: normalizeHarvestType(snapshot.tipo),
      fecha: snapshot.fecha || todayISO(),
      queuedAt: new Date().toISOString(),
    });
    saveDriveQueue(queue);
    updateNetworkUI();
    return true;
  }

  function loadHarvestDriveUrlMap() {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(HARVEST_DRIVE_URL_KEY) || "{}"
      );
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function getHarvestDriveUrl(snapshot) {
    if (!snapshot?.id) return "";
    const map = loadHarvestDriveUrlMap();
    return String(map[snapshot.id]?.url || map[snapshot.id] || "");
  }

  function saveHarvestDriveUrl(snapshot, url, name) {
    if (!snapshot?.id || !url) return;
    const map = loadHarvestDriveUrlMap();
    map[snapshot.id] = {
      url: String(url),
      name: String(name || ""),
      at: new Date().toISOString(),
    };
    try {
      localStorage.setItem(HARVEST_DRIVE_URL_KEY, JSON.stringify(map));
    } catch {
      /* ignore */
    }
  }

  async function flushDriveQueue() {
    if (!navigator.onLine) {
      return { sent: 0, remain: loadDriveQueue().length };
    }
    if (!scriptExcelDriveUrl()) {
      return { sent: 0, remain: loadDriveQueue().length };
    }
    const queue = loadDriveQueue();
    if (!queue.length) return { sent: 0, remain: 0 };

    const remain = [];
    let sent = 0;
    for (const item of queue) {
      const snapshot = historySnapshotById(item.id);
      if (!snapshot) continue; // registro fuera de TTL: descartar
      try {
        const result = await uploadHarvestExcelToDrive(snapshot);
        if (result.ok && result.url) {
          saveHarvestDriveUrl(snapshot, result.url, result.name);
          markHarvestSnapshotSent(snapshot);
          sent += 1;
        } else {
          remain.push(item);
        }
      } catch {
        remain.push(item);
      }
    }
    saveDriveQueue(remain);
    updateNetworkUI();
    if (sent > 0) {
      toast(
        remain.length
          ? `Drive: ${sent} subido(s) · ${remain.length} pendiente(s)`
          : `Drive: ${sent} Excel subido(s)`
      );
      renderHarvestHistory();
      renderHarvestDayChecklist();
    }
    return { sent, remain: remain.length };
  }

  async function shareDriveLink(link, fileName) {
    const text = `${fileName || "Excel"}\n${link}`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: fileName || "Excel QBerries", text });
        return true;
      }
    } catch (err) {
      if (err?.name === "AbortError") return true;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        toast("Enlace de Drive copiado");
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  /**
   * Sube a Drive o deja pendiente si no hay internet.
   * Si ya hay link, ofrece compartir el enlace.
   */
  async function uploadOrQueueHarvestToDrive(snapshot, button) {
    if (!snapshot) {
      toast("No hay registro para subir");
      return;
    }
    if (!scriptExcelDriveUrl()) {
      toast("Drive no configurado en la app");
      return;
    }

    const existing = getHarvestDriveUrl(snapshot);
    if (existing) {
      markHarvestSnapshotSent(snapshot);
      await shareDriveLink(existing, harvestFileName(snapshot));
      return;
    }

    if (!navigator.onLine) {
      enqueueDriveUpload(snapshot);
      toast("Sin internet · Drive en pendiente. Se sube al reconectar.");
      renderHarvestHistory();
      return;
    }

    if (button) setBtnLoading(button, true, "Subiendo…");
    try {
      const result = await uploadHarvestExcelToDrive(snapshot);
      if (!result.ok) {
        // Red falló: dejar pendiente para reintento
        enqueueDriveUpload(snapshot);
        toast(
          result.message
            ? `${result.message} · quedó pendiente`
            : "No se pudo subir · quedó pendiente"
        );
        renderHarvestHistory();
        return;
      }
      // Quitar de cola si estaba
      saveDriveQueue(loadDriveQueue().filter((item) => item.id !== snapshot.id));
      saveHarvestDriveUrl(snapshot, result.url, result.name);
      state.lastDriveExcelUrl = result.url;
      markHarvestSnapshotSent(snapshot);
      toast("Excel subido a Drive");
      toast(harvestDayProgressMessage());
      renderHarvestHistory();
      await shareDriveLink(result.url, result.name);
    } finally {
      if (button) setBtnLoading(button, false);
    }
  }

  async function uploadActiveHarvestToDrive(button) {
    await uploadOrQueueHarvestToDrive(state.activeExportSnapshot, button);
  }
  function isNativeApp() {
    try {
      const cap = window.Capacitor?.getPlatform?.() || "";
      return cap === "android" || cap === "ios";
    } catch {
      return false;
    }
  }
  let deferredInstallPrompt = null;
  function isPwaInstalled() {
    try {
      if (isNativeApp()) return true;
      if (window.matchMedia("(display-mode: standalone)").matches) return true;
      if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
      if (navigator.standalone === true) return true;
    } catch {
      /* ignore */
    }
    return false;
  }
  function syncProfileAppTools() {
    const ver = $("#profileAppVersion");
    if (ver) ver.textContent = `Versión ${APP_VERSION}`;
    const install = $("#btnProfileInstall");
    const done = $("#profileAppInstalled");
    const installed = isPwaInstalled();
    if (install) {
      install.hidden = installed;
      if (installed) install.setAttribute("hidden", "");
      else install.removeAttribute("hidden");
    }
    if (done) done.hidden = !installed;
  }
  async function installApp(button) {
    if (isPwaInstalled()) {
      toast("La app ya está instalada en este celular");
      syncProfileAppTools();
      return;
    }
    if (deferredInstallPrompt) {
      try {
        if (button) setBtnLoading(button, true, "Instalando…");
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice?.outcome === "accepted") {
          deferredInstallPrompt = null;
          toast("App instalada");
          syncProfileAppTools();
          if (button) setBtnLoading(button, false);
          return;
        }
      } catch {
        /* el sistema no mostró el diálogo */
      }
      if (button) setBtnLoading(button, false);
    }
    location.href = "/instalar/";
  }
  function isLocalDev() {
    const host = String(location.hostname || "");
    return host === "localhost" || host === "127.0.0.1";
  }
  function apiUrl(path) {
    const rel = path.startsWith("/") ? path : `/${path}`;
    return isNativeApp() || isLocalDev() ? `${CLOUD_ORIGIN}${rel}` : rel;
  }
  /** Catálogos desde el mismo origen (PWA Netlify + service worker). */
  function assetUrl(path) {
    const rel = path.startsWith("/") ? path : `/${path}`;
    return rel;
  }
  function reloadWithBust() {
    const url = new URL(location.href);
    url.searchParams.set("_cb", String(Date.now()));
    setTimeout(() => location.replace(url.href), 350);
  }
  async function fetchTabShellHtml(route, forceCloud = false) {
    const urls = [];
    if ((forceCloud || isNativeApp()) && navigator.onLine) {
      urls.push(`${CLOUD_ORIGIN}${route}?v=${APP_VERSION}&_=${Date.now()}`);
    }
    urls.push(route);
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          cache: forceCloud || isNativeApp() ? "no-store" : "force-cache",
        });
        if (res.ok) return await res.text();
      } catch {
        /* siguiente origen */
      }
    }
    throw new Error("tab shell fetch failed");
  }
  const API = {
    login: apiUrl("/.netlify/functions/login"),
    sync: apiUrl("/.netlify/functions/sync"),
    trabajadores: apiUrl("/.netlify/functions/trabajadores"),
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  let navigationLocked = false;
  let loaderDepth = 0;
  let loaderShownAt = 0;
  let loaderMinTimer = 0;
  let loaderFailsafe = 0;
  const LOADER_MIN_MS = 520;
  const LOADER_MAX_MS = 2800;
  const TAB_PAGES = ["registro", "vinculo"];

  function isTabPage(page) {
    return TAB_PAGES.includes(page);
  }

  function doHideAppLoader() {
    loaderMinTimer = 0;
    if (loaderFailsafe) {
      clearTimeout(loaderFailsafe);
      loaderFailsafe = 0;
    }
    $("#appLoader")?.setAttribute("hidden", "");
    document.body.classList.remove("app-busy");
  }

  function ensureAppLoader() {
    if ($("#appLoader")) return;
    const el = document.createElement("div");
    el.id = "appLoader";
    el.className = "app-loader";
    el.hidden = true;
    el.innerHTML =
      '<div class="app-loader-card" role="status" aria-live="polite">' +
      '<span class="qb-loader qb-loader--ring" aria-hidden="true"></span>' +
      '<p class="app-loader-msg" id="appLoaderMsg">Cargando…</p></div>';
    document.body.appendChild(el);
  }

  function showAppLoader(msg) {
    ensureAppLoader();
    loaderDepth += 1;
    if (loaderDepth === 1) loaderShownAt = Date.now();
    const m = $("#appLoaderMsg");
    if (m) m.textContent = msg || "Cargando…";
    const el = $("#appLoader");
    if (el) el.hidden = false;
    document.body.classList.add("app-busy");
    if (loaderFailsafe) clearTimeout(loaderFailsafe);
    loaderFailsafe = window.setTimeout(() => hideAppLoader(true), LOADER_MAX_MS);
  }

  function hideAppLoader(force) {
    if (force) {
      loaderDepth = 0;
      if (loaderMinTimer) {
        clearTimeout(loaderMinTimer);
        loaderMinTimer = 0;
      }
      doHideAppLoader();
      return;
    }
    loaderDepth = Math.max(0, loaderDepth - 1);
    if (loaderDepth > 0) return;
    const elapsed = Date.now() - loaderShownAt;
    const wait = Math.max(0, LOADER_MIN_MS - elapsed);
    if (wait > 0) {
      if (loaderMinTimer) clearTimeout(loaderMinTimer);
      loaderMinTimer = window.setTimeout(doHideAppLoader, wait);
    } else {
      doHideAppLoader();
    }
  }

  function setQrLoading(on, msg) {
    const overlay = $("#qrOverlay");
    const overlayTxt = $("#qrOverlayText");
    if (!overlay) return;
    overlay.classList.toggle("is-loading", !!on);
    if (on) {
      overlay.hidden = false;
      if (overlayTxt) overlayTxt.textContent = msg || "Procesando…";
    } else if (overlayTxt && !state.camStream) {
      overlayTxt.textContent = "Toque para activar la cámara";
    }
  }

  function setBtnLoading(btn, on, label) {
    if (!btn) return;
    if (on) {
      if (!btn.dataset.loaderOrig) btn.dataset.loaderOrig = btn.innerHTML;
      btn.disabled = true;
      btn.classList.add("is-loading");
      btn.innerHTML =
        '<span class="qb-loader qb-loader--ring-sm" aria-hidden="true"></span>' +
        `<span>${escapeHtml(label || "Espere…")}</span>`;
      return;
    }
    btn.disabled = false;
    btn.classList.remove("is-loading");
    if (btn.dataset.loaderOrig) {
      btn.innerHTML = btn.dataset.loaderOrig;
      delete btn.dataset.loaderOrig;
      hydrateIcons(btn);
    }
  }

  function setInlineLoading(el, on, msg) {
    if (!el) return;
    if (on) {
      if (el.dataset.loaderOrig === undefined) {
        el.dataset.loaderOrig = el.textContent || "";
      }
      el.innerHTML =
        '<span class="inline-load">' +
        '<span class="qb-loader qb-loader--dots" aria-hidden="true"></span>' +
        `<span>${escapeHtml(msg || "Cargando…")}</span></span>`;
      return;
    }
    if (el.dataset.loaderOrig !== undefined) {
      el.textContent = el.dataset.loaderOrig;
      delete el.dataset.loaderOrig;
    }
  }
  /** Evita que dos flush simultáneos sobrescriban ítems encolados durante el envío. */
  let vinculoFlushTail = Promise.resolve();
  let cloudFlushTail = Promise.resolve();

  function isComputerScreen() {
    try {
      const cap = window.Capacitor?.getPlatform?.() || "";
      if (cap === "ios" || cap === "android") return false;
      const ua = String(navigator.userAgent || "");
      const touchPoints = Number(navigator.maxTouchPoints || 0);
      if (/iPhone|iPod|Android.+Mobile/i.test(ua)) return false;
      if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) return false;
      if (navigator.platform === "MacIntel" && touchPoints > 1) return false;
      const w = Number(window.innerWidth || 0);
      const longSide = Math.max(w, Number(window.innerHeight || 0));
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      const touch = touchPoints > 0 || coarse;
      /* Toggle device emulation (celular/tablet): viewport chico. */
      if (w <= 1024) return false;
      if (touch && longSide <= 1366) return false;
      return true;
    } catch {
      return false;
    }
  }

  function ensureComputerBlock() {
    if ($("#computerBlock")) return;
    const el = document.createElement("div");
    el.id = "computerBlock";
    el.className = "computer-block";
    el.setAttribute("role", "alertdialog");
    el.setAttribute("aria-live", "polite");
    el.innerHTML =
      '<div class="computer-block-card">' +
      '<img src="/assets/logo-qberries.png" alt="QBerries" />' +
      "<p>Esta aplicación solo se usa en celular o tablet.</p>" +
      "<p>No se puede usar en computadora.</p>" +
      "</div>";
    document.body.appendChild(el);
  }

  function syncComputerBlock() {
    const blocked = isComputerScreen();
    document.documentElement.classList.toggle("is-computer", blocked);
    if (blocked) ensureComputerBlock();
  }

  function applyPlatformClass() {
    try {
      const ua = String(navigator.userAgent || "");
      const cap = window.Capacitor?.getPlatform?.() || "";
      const isIOS = cap === "ios" || /iPhone|iPad|iPod/i.test(ua);
      const isAndroid = cap === "android" || (/Android/i.test(ua) && !isIOS);
      document.documentElement.classList.toggle("is-ios", !!isIOS);
      document.documentElement.classList.toggle("is-android", !!isAndroid);
    } catch {
      /* ignore */
    }
  }
  applyPlatformClass();
  syncComputerBlock();
  window.addEventListener("resize", syncComputerBlock);
  paintGreeting("#harvestSupervisor", getIdentity());

  try {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  } catch {
    /* ignore */
  }

  function runVinculoFlushExclusive(task) {
    const next = vinculoFlushTail.then(task, task);
    vinculoFlushTail = next.catch(() => {});
    return next;
  }

  function runCloudFlushExclusive(task) {
    const next = cloudFlushTail.then(task, task);
    cloudFlushTail = next.catch(() => {});
    return next;
  }

  function mergeVinculoQueueAfterFlush(snapshot, remain) {
    const snapDnis = new Set(snapshot.map((x) => String(x.dni || "")));
    const latest = loadVinculoQueue();
    const addedWhileFlushing = latest.filter(
      (x) => !snapDnis.has(String(x.dni || ""))
    );
    const merged = new Map();
    for (const item of [...remain, ...addedWhileFlushing]) {
      const dni = String(item.dni || "");
      if (!dni) continue;
      const prev = merged.get(dni);
      const tNew = Date.parse(item.queuedAt || 0) || 0;
      const tOld = prev ? Date.parse(prev.queuedAt || 0) || 0 : 0;
      if (!prev || tNew >= tOld) merged.set(dni, item);
    }
    return [...merged.values()];
  }

  function mergeCloudQueueAfterFlush(snapshot, remain) {
    const snapIds = new Set(snapshot.map((x) => String(x.id || "")));
    const latest = loadCloudDataQueue();
    const addedWhileFlushing = latest.filter(
      (x) => !snapIds.has(String(x.id || ""))
    );
    const merged = new Map();
    for (const item of [...remain, ...addedWhileFlushing]) {
      const id = String(item.id || "");
      if (!id) continue;
      merged.set(id, item);
    }
    return [...merged.values()];
  }

  function isInternalTabUrl(target) {
    try {
      const path = new URL(target, location.origin).pathname.replace(/index\.html$/i, "");
      return /^\/(registro|vinculo)\/?$/i.test(path);
    } catch {
      return false;
    }
  }

  function parseTabShell(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const phone = doc.querySelector("#phone");
    return {
      html: phone ? phone.innerHTML : "",
      page: doc.body?.dataset?.page || "",
      title: doc.title || "QBerries",
    };
  }

  function cacheCurrentTabShell() {
    const page = getPage();
    if (!isTabPage(page)) return;
    const phone = $("#phone");
    if (!phone) return;
    try {
      const cacheKey = normalizeTabShellKey(
        new URL(ROUTES[page], location.origin).pathname
      );
      // Guardar siempre con Conteo visible (no persistir Guías abierta)
      const wasGuias =
        page === "registro" &&
        ($("#harvestScreen")?.dataset?.panel === "guias" ||
          $("#guidesSheet")?.classList?.contains("is-active"));
      if (wasGuias) applyGuidesPanel(false);
      const entry = {
        html: phone.innerHTML,
        page,
        title: document.title,
      };
      if (wasGuias) applyGuidesPanel(true);
      setTabShell(cacheKey, entry);
    } catch {
      /* ignore */
    }
  }

  async function switchTabClient(target, replace = false) {
    closePicker();
    closeModal();
    closeSheets();
    const url = new URL(target, location.origin + "/");
    const cacheKey = normalizeTabShellKey(url.pathname);
    let cached = getTabShell(cacheKey);
    if (!cached) {
      loadTabShellsFromStorage();
      cached = getTabShell(cacheKey);
    }
    if (!cached) {
      try {
        const html = await fetchTabShellHtml(
          url.pathname + url.search,
          false
        );
        cached = parseTabShell(html);
        setTabShell(cacheKey, cached);
      } catch {
        loadTabShellsFromStorage();
        cached = getTabShell(cacheKey);
      }
    }
    const phone = $("#phone");
    if (!phone || !cached?.html) throw new Error("tab shell missing phone");
    cacheCurrentTabShell();
    phone.innerHTML = cached.html;
    document.body.dataset.page = cached.page;
    document.title = cached.title;
    state._guidesWarmed = false;
    const href = url.pathname + url.search;
    if (replace) history.replaceState({ qbTab: cached.page }, "", href);
    else history.pushState({ qbTab: cached.page }, "", href);
    bindPhoneHandlers();
    activateTabPage(cached.page);
    window.scrollTo(0, 0);
  }

  function activateTabPage(page) {
    closePicker();
    closeModal();
    closeSheets();
    closeWorkerIdModal();
    hydrateIcons($("#phone") || document);
    updateNetworkUI();
    syncTopnavVisibility();
    refreshTopnav();
    if (!hasQrLogin()) return;
    const id = state.identity || getIdentity();
    if (page === "registro") {
      paintGreeting("#harvestSupervisor", id);
      showHarvestHome(id);
      // Por defecto Conteo; openRequestedTab abre Guías solo si ?tab=guias
      let wantGuias = false;
      try {
        wantGuias = new URLSearchParams(location.search).get("tab") === "guias";
      } catch {
        wantGuias = false;
      }
      if (!wantGuias) applyGuidesPanel(false);
      loadCatalogs().catch(() => {});
    } else if (page === "vinculo") {
      showVinculoScreen(id);
    }
    openRequestedTab();
  }

  async function warmTabShells(forceCloud = false) {
    const routes = [ROUTES.registro, ROUTES.vinculo];
    await Promise.all(
      routes.map(async (route) => {
        try {
          const path = normalizeTabShellKey(
            new URL(route, location.origin).pathname
          );
          if (!forceCloud && getTabShell(path)) return;
          const html = await fetchTabShellHtml(route, forceCloud);
          const shell = parseTabShell(html);
          setTabShell(path, shell);
        } catch {
          /* offline: la pestaña actual ya está en pantalla */
        }
      })
    );
    cacheCurrentTabShell();
  }

  function beginNavigation(target, replace = false, opts = {}) {
    if (navigationLocked) return;
    navigationLocked = true;
    const tabSwitch =
      opts.tabSwitch ??
      (isInternalTabUrl(target) &&
        document.documentElement.classList.contains("has-session"));
    if (tabSwitch) {
      try {
        sessionStorage.removeItem("qb-action-loader");
        sessionStorage.removeItem("qb-tab-nav");
      } catch {
        /* ignore */
      }
      document.body.classList.add("app-tab-switch");
      switchTabClient(target, replace)
        .catch(() => {
          let href = target;
          try {
            href = new URL(target, location.origin + "/").href;
          } catch {
            href = target;
          }
          if (replace) location.replace(href);
          else location.href = href;
        })
        .finally(() => {
          window.setTimeout(() => {
            navigationLocked = false;
            document.body.classList.remove("app-tab-switch");
          }, 32);
        });
      return;
    }
    const msg = opts.loaderMsg || "Cargando…";
    showAppLoader(msg);
    try {
      sessionStorage.setItem("qb-action-loader", msg);
      sessionStorage.removeItem("qb-tab-nav");
    } catch {
      /* ignore */
    }
    document.body.classList.add("app-navigating");
    let href = target;
    try {
      href = new URL(target, location.origin + "/").href;
    } catch {
      href = target;
    }
    window.setTimeout(() => {
      navigationLocked = false;
    }, 650);
    if (replace) location.replace(href);
    else location.href = href;
  }

  function goTo(page, replace = false, opts = {}) {
    const target = ROUTES[page] || ROUTES.scan;
    if (navigationLocked) return;
    const currentPath = location.pathname.replace(/index\.html$/, "");
    const targetPath = new URL(target, location.origin).pathname.replace(/index\.html$/, "");
    if (currentPath === targetPath && !location.search) return;
    /* Sin loader solo al saltar entre pestañas ya abiertas (Registro ↔ Vincular). */
    const tabSwitch =
      opts.tabSwitch ??
      (isTabPage(page) &&
        isTabPage(getPage()) &&
        document.documentElement.classList.contains("has-session"));
    beginNavigation(target, replace, { tabSwitch, loaderMsg: opts.loaderMsg });
  }

  /**
   * El teclado del celular tapa parte de la pantalla sin cambiar la altura
   * del documento (iPhone) o la cambia tarde (Android). Se mide la ventana
   * visible real para que la app ocupe justo ese alto y no quede un hueco.
   */
  let applyViewportMetrics = () => {};

  /** Lee env(safe-area-inset-*) y, en Android, refuerza con visualViewport. */
  function readEnvInset(edge) {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;padding-" +
      edge +
      ":env(safe-area-inset-" +
      edge +
      ", 0px);";
    document.body.appendChild(probe);
    const val =
      parseFloat(
        getComputedStyle(probe).getPropertyValue("padding-" + edge)
      ) || 0;
    probe.remove();
    return val;
  }

  function syncSystemInsets() {
    const root = document.documentElement;
    if (!root.classList.contains("is-android")) return;
    let bottom = readEnvInset("bottom");
    const top = readEnvInset("top");
    const vv = window.visualViewport;
    if (vv && !document.body?.classList.contains("kb-open")) {
      const layoutH = window.innerHeight;
      const visibleH = Math.round(vv.height);
      const topOff = Math.max(0, Math.round(vv.offsetTop));
      const chrome = Math.max(0, layoutH - visibleH - topOff);
      if (chrome > 0 && chrome < 140) bottom = Math.max(bottom, chrome);
    }
    root.style.setProperty("--nav-safe-bottom", `${bottom}px`);
    root.style.setProperty("--nav-bar-total", `calc(var(--nav-inner-h) + ${bottom}px)`);
    root.style.setProperty("--android-safe-top", `${top}px`);
  }

  function resetViewportLayout() {
    document.body?.classList.remove("kb-open");
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    applyViewportMetrics();
    if (document.documentElement.classList.contains("is-android")) {
      syncSystemInsets();
      window.setTimeout(() => {
        applyViewportMetrics();
        syncSystemInsets();
      }, 100);
      window.setTimeout(() => {
        applyViewportMetrics();
        syncSystemInsets();
      }, 320);
    }
  }

  function setupViewportMetrics() {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let pendingFrame = 0;

    const activeField = () =>
      document.activeElement?.closest?.("input, textarea, select") || null;

    const isOverlayField = (field) =>
      !!field?.closest?.(
        ".manual-worker-backdrop, .modal-backdrop, .picker-backdrop, .export-preview-backdrop, .check-pick-backdrop, .profile-modal-backdrop"
      );

    const scrollFieldIntoView = (field) => {
      if (
        document.documentElement.classList.contains("is-android") &&
        isOverlayField(field)
      ) {
        return;
      }
      const scroller = field.closest(
        ".harvest-scroll, .guides-scroll, .guides-sheet, .vinculo-scroll, .home-scroll, .security-screen, .lock-screen, .export-preview, .picker, .manual-worker, .check-pick"
      );
      if (scroller) {
        const rect = field.getBoundingClientRect();
        const box = scroller.getBoundingClientRect();
        const pad = 12;
        if (rect.top < box.top + pad || rect.bottom > box.bottom - pad) {
          scroller.scrollTop += rect.top - box.top - (box.height - rect.height) / 2;
        }
        return;
      }
      field.scrollIntoView({ block: "center", behavior: "auto" });
    };

    const apply = () => {
      pendingFrame = 0;
      const height = Math.round(vv ? vv.height : window.innerHeight);
      const offsetTop = vv ? Math.round(vv.offsetTop) : 0;
      const keyboard = vv
        ? Math.max(0, Math.round(window.innerHeight - vv.height - offsetTop))
        : 0;
      const open = keyboard > 120;
      root.style.setProperty("--app-h", `${height}px`);
      root.style.setProperty("--kb-h", `${keyboard}px`);
      root.style.setProperty("--vv-top", `${offsetTop}px`);
      const vw = Math.max(320, Number(window.innerWidth || 390));
      const u = Math.max(0.82, Math.min(vw / 390, 1.14));
      root.style.setProperty("--u", `${u}px`);
      document.body?.classList.toggle("kb-open", open);
      if (root.classList.contains("is-android") && !open) syncSystemInsets();
      // iPhone empuja toda la ventana hacia arriba para destapar el campo y
      // debajo asoma el fondo del sistema (franja negra). No resetear mientras
      // hay un campo enfocado: se veía rebote y el input quedaba tapado otra vez.
      if (open && !activeField() && (window.scrollY || offsetTop)) {
        window.scrollTo(0, 0);
        if (root.scrollTop) root.scrollTop = 0;
        if (document.body?.scrollTop) document.body.scrollTop = 0;
      }
    };

    /** Un ajuste por frame: los eventos de teclado llegan en ráfaga. */
    const schedule = () => {
      if (pendingFrame) return;
      pendingFrame = requestAnimationFrame(apply);
    };

    const isFieldCovered = (el) => {
      const rect = el.getBoundingClientRect();
      const visible = vv ? vv.height : window.innerHeight;
      return rect.top < 8 || rect.bottom > visible - 8;
    };

    apply();
    applyViewportMetrics = apply;
    syncSystemInsets();
    if (vv) {
      vv.addEventListener("resize", schedule);
      vv.addEventListener("scroll", schedule);
    }
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("orientationchange", () => {
      setTimeout(() => {
        apply();
        syncSystemInsets();
      }, 250);
    });
    document.addEventListener("focusin", (e) => {
      const field = e.target?.closest?.("input, textarea, select");
      if (!field) return;
        setTimeout(() => {
          apply();
        if (
          document.documentElement.classList.contains("is-android") &&
          isOverlayField(field)
        ) {
          return;
        }
        if (isFieldCovered(field)) scrollFieldIntoView(field);
      }, 280);
    });
    document.addEventListener("focusout", () => {
      setTimeout(() => {
        if (activeField()) return;
        apply();
        if (document.documentElement.classList.contains("is-android")) {
          resetViewportLayout();
        }
      }, document.documentElement.classList.contains("is-android") ? 180 : 80);
    });
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function cacheDayStamp() {
    try {
      return localStorage.getItem(CACHE_DAY_KEY) || "";
    } catch {
      return "";
    }
  }

  function rememberCacheDay() {
    try {
      localStorage.setItem(CACHE_DAY_KEY, todayISO());
    } catch {
      /* ignore */
    }
  }

  function isNewCacheDay() {
    return cacheDayStamp() !== todayISO();
  }

  function catalogFetchCache() {
    return isNewCacheDay() ? "reload" : "force-cache";
  }

  function requestCacheRefresh() {
    try {
      const send = (sw) => sw && sw.postMessage({ type: "REFRESH_CACHE" });
      if (navigator.serviceWorker?.controller) {
        send(navigator.serviceWorker.controller);
        return;
      }
      navigator.serviceWorker?.ready?.then((reg) => send(reg.active)).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  function prefetchAppShell() {
    [
      "/",
      "/index.html",
      "/registro/index.html",
      "/vinculo/index.html",
      "/styles.css",
      "/app.js",
      "/icons.js",
      "/native-bridge.js",
      "/data/supervisores-cosecha.json",
      "/data/lotes-licapa.json",
      "/data/grupos-licapa.json",
      "/data/trabajadores.json",
      "/vendor/jsQR.min.js",
      "/vendor/xlsx.full.min.js",
      "/vendor/qrcode.min.js",
      "/vendor/jspdf.umd.min.js",
      "/vendor/sweetalert2.all.min.js",
    ].forEach((url) => {
      fetch(url).catch(() => {});
    });
  }

  function uid() {
    return (
      crypto.randomUUID?.() ||
      `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    );
  }

  const num = (v) => {
    const n = Number(String(v).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  };

  const fmt = (n) =>
    Number(n || 0).toLocaleString("es-PE", { maximumFractionDigits: 0 });

  const escapeHtml = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const ico = (name, cls = "ico") => window.QBIcons?.svg?.(name, cls) || "";

  /** @typedef {{
   *  id: string,
   *  numeroGuia: string,
   *  lote: string,
   *  codLote: string,
   *  modulo: string,
   *  turno: string,
   *  variedad: string,
   *  jarras: number|string,
   *  jabas: number|string,
   *  horaRecojo: string,
   * }} Guia */

  const GUIA_NUM_LEN = 6;

  function normalizeNumeroGuia(raw) {
    return String(raw || "").replace(/\D/g, "").slice(0, GUIA_NUM_LEN);
  }

  function formatNumeroGuiaDisplay(raw) {
    const digits = normalizeNumeroGuia(raw);
    return digits ? `N° ${digits.padStart(GUIA_NUM_LEN, "0")}` : "";
  }

  function formatNumeroGuiaInput(raw) {
    const digits = normalizeNumeroGuia(raw);
    return digits ? digits.padStart(GUIA_NUM_LEN, "0") : "";
  }

  const emptyGuia = () => ({
    id: uid(),
    numeroGuia: "",
    lote: "",
    codLote: "",
    modulo: "",
    turno: "",
    variedad: "",
    jarras: "",
    jabas: "",
    horaRecojo: "",
  });

  function migrateGuiaList(raw) {
    const g = raw && typeof raw === "object" ? raw : {};
    const fromLinea = (ln, id) => ({
      ...emptyGuia(),
      id: id || ln?.id || uid(),
      numeroGuia: normalizeNumeroGuia(ln?.numeroGuia || g.numeroGuia || ""),
      lote: ln?.lote || "",
      codLote: ln?.codLote || "",
      modulo: ln?.modulo || "",
      turno: ln?.turno || "",
      variedad: ln?.variedad || "",
      jarras: ln?.jarras ?? "",
      jabas: ln?.jabas ?? "",
      horaRecojo: ln?.horaRecojo || "",
    });
    if (Array.isArray(g.lineas) && g.lineas.length) {
      return g.lineas.map((ln, i) => fromLinea(ln, i === 0 ? g.id : undefined));
    }
    if (
      g.numeroGuia ||
      g.lote ||
      g.jarras ||
      g.jabas ||
      g.modulo ||
      g.variedad ||
      g.horaRecojo
    ) {
      return [fromLinea(g, g.id)];
    }
    return [emptyGuia()];
  }
  const emptySession = () => ({
    ready: false,
    ownerDni: "",
    fundo: FUNDO_DEFAULT,
    /** LIC 01–50 o NO_TENGO_POR_AHORA */
    grupoLic: "",
    supervisorDni: "",
    supervisorNombre: "",
    javeroDni: "",
    javeroNombre: "",
    fecha: todayISO(),
  });

  const emptyHarvestTypeDraft = () => ({
    lote: "",
    codLote: "",
    modulo: "",
    turno: "",
    variedad: "",
    workers: [],
  });

  const emptyHarvestByType = () =>
    HARVEST_TYPES.reduce((acc, item) => {
      acc[item.key] = emptyHarvestTypeDraft();
      return acc;
    }, {});

  const emptyHarvest = () => {
    const harvest = {
    fecha: todayISO(),
    tipo: "suma-jarras",
    lote: "",
    codLote: "",
    modulo: "",
    turno: "",
    variedad: "",
      byType: emptyHarvestByType(),
    workers: [],
    };
    const bucket = harvest.byType[harvest.tipo];
    harvest.lote = bucket.lote;
    harvest.codLote = bucket.codLote;
    harvest.modulo = bucket.modulo;
    harvest.turno = bucket.turno;
    harvest.variedad = bucket.variedad;
    harvest.workers = bucket.workers;
    return harvest;
  };

  const state = {
    session: emptySession(),
    guias: /** @type {Guia[]} */ ([]),
    harvest: emptyHarvest(),
    personas: /** @type {Record<string,{nombre:string,cargo?:string,celular?:string}>} */ ({}),
    supervisores: /** @type {Record<string,{nombre:string,cargo?:string,celular?:string}>} */ ({}),
    lotes: /** @type {{lote:string,codLote?:string,modulo:string,turno:string,variedad?:string}[]} */ ([]),
    grupos: /** @type {string[]} */ ([]),
    identity: /** @type {null|{dni:string,nombre:string,cargo:string}} */ (null),
    pendingConfirm: /** @type {null | (() => void)} */ (null),
    picker: /** @type {null | { kind: "grupo"|"lote", guiaId: string }} */ (null),
    timePicker: /** @type {null | { guiaId: string }} */ (null),
    timePickerDraft: /** @type {null | { hh: number, mm: number }} */ (null),
    /** Guía expandida en el acordeón (solo una abierta). */
    expandedGuiaId: /** @type {string|null} */ (null),
    netlifyReady: false,
    /** true = /.netlify/functions disponibles */
    cloudApi: false,
    unlocking: false,
    scanProcessing: false,
    pendingIdentity: null,
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    camStream: /** @type {MediaStream|null} */ (null),
    camTimer: 0,
    lastScanDni: "",
    lastScanAt: 0,
    thanksRedirect: false,
    thanksRedirectTimer: 0,
    activeExportSnapshot: null,
    activeExportSaved: false,
    previewDraftSnapshot: null,
    /** Borradores del modal por tipo (Suma/Resta/Descarte) sin perder datos. */
    previewDraftByType: /** @type {Record<string, object>} */ ({}),
    readyFilesAction: "share",
    readyFilesItems: [],
    historyPage: 0,
    guiasHistoryPage: 0,
    sessionManualPersonas: /** @type {Record<string,{nombre:string,manual?:boolean}>} */ ({}),
    /** Trabajadores agregados en esta sesión: viven hasta Cerrar sesión. */
    sessionWorkers: /** @type {Record<string,{nombre:string,manual?:boolean}>} */ ({}),
    audioCtx: /** @type {AudioContext|null} */ (null),
  };

  function hydrateIcons(root = document) {
    $$("[data-icon]", root).forEach((node) => {
      const name = node.getAttribute("data-icon");
      if (!name || !window.QBIcons) return;
      // Si el icono ya viene escrito en el HTML, no se vuelve a pintar:
      // reemplazarlo se veía como un parpadeo al abrir cada pestaña.
      if (node.firstElementChild?.tagName?.toLowerCase() === "svg") return;
      node.innerHTML = ico(
        name,
        node.classList.contains("field-ico") ? "ico ico-sm" : "ico"
      );
    });
  }

  function on(sel, event, handler) {
    const el = typeof sel === "string" ? $(sel) : sel;
    if (!el) return;
    el.addEventListener(event, handler);
  }
  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state.session = emptySession();
        state.guias = [];
        return;
      }
      const parsed = JSON.parse(raw);
      state.session = { ...emptySession(), ...(parsed.session || {}) };
      state.session.fundo = normalizeFundo(state.session.fundo);
      state.guias = Array.isArray(parsed.guias) ? parsed.guias : [];
    } catch {
      state.session = emptySession();
      state.guias = [];
    }
  }

  function saveStore() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 4,
        savedAt: new Date().toISOString(),
        session: state.session,
        guias: state.guias,
      })
    );
    updateMeta();
  }

  function loadHarvest() {
    try {
      const parsed = JSON.parse(localStorage.getItem(HARVEST_KEY) || "null");
      if (!parsed || typeof parsed !== "object") {
        state.harvest = emptyHarvest();
        attachCurrentHarvestDraft();
        return;
      }
      const storedDate = String(parsed.fecha || "").slice(0, 10);
      const today = todayISO();
      if (storedDate && storedDate !== today) {
        state.harvest = emptyHarvest();
        saveHarvest();
        return;
      }
      state.harvest = {
        ...emptyHarvest(),
        ...parsed,
      };
      hydrateHarvestByType(parsed);
    } catch {
      state.harvest = emptyHarvest();
      attachCurrentHarvestDraft();
    }
  }

  function saveHarvest() {
    syncCurrentHarvestDraft();
    localStorage.setItem(
      HARVEST_KEY,
      JSON.stringify({ ...state.harvest, savedAt: new Date().toISOString() })
    );
  }

  function savePersonas() {
    localStorage.setItem(PERSONAS_KEY, JSON.stringify(state.personas));
  }

  function rememberPersona(dni, nombre, cargo = "") {
    const key = String(dni || "").replace(/\D/g, "");
    const name = String(nombre || "").trim();
    if (!key || !name) return;
    state.personas[key] = {
      nombre: name.toUpperCase(),
      cargo: String(cargo || state.personas[key]?.cargo || "").toUpperCase(),
    };
    savePersonas();
  }

  /** Altas manuales: solo en el celular hasta cerrar sesión */
  function loadSessionManualPersonas() {
    try {
      const parsed = JSON.parse(
        sessionStorage.getItem(SESSION_MANUAL_PERSONAS_KEY) || "{}"
      );
      state.sessionManualPersonas =
        parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      state.sessionManualPersonas = {};
    }
  }

  function saveSessionManualPersonas() {
    sessionStorage.setItem(
      SESSION_MANUAL_PERSONAS_KEY,
      JSON.stringify(state.sessionManualPersonas || {})
    );
  }

  function rememberSessionPersona(dni, nombre) {
    const key = String(dni || "").replace(/\D/g, "");
    const name = String(nombre || "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
    if (key.length !== 8 || name.length < 3) return;
    state.sessionManualPersonas[key] = { nombre: name, manual: true };
    saveSessionManualPersonas();
  }

  function clearSessionManualPersonas() {
    state.sessionManualPersonas = {};
    sessionStorage.removeItem(SESSION_MANUAL_PERSONAS_KEY);
  }

  function sessionOwnerDni() {
    const id = state.identity || getIdentity() || {};
    return String(id.dni || "").replace(/\D/g, "");
  }

  /** Personal confirmado en registros: queda en el celular por supervisor. */
  function loadAllSavedWorkersByOwner() {
    try {
      const v2 = JSON.parse(localStorage.getItem(SAVED_WORKERS_KEY) || "null");
      if (v2?.byOwner && typeof v2.byOwner === "object") return { ...v2.byOwner };
    } catch {
      /* ignore */
    }
    try {
      const v1 = JSON.parse(localStorage.getItem(SESSION_WORKERS_KEY) || "null");
      if (v1?.workers && typeof v1.workers === "object") {
        const owner = String(v1.ownerDni || "").replace(/\D/g, "");
        if (owner) return { [owner]: v1.workers };
      }
    } catch {
      /* ignore */
    }
    return {};
  }

  function loadSessionWorkers() {
    const owner = sessionOwnerDni();
    const byOwner = loadAllSavedWorkersByOwner();
    const workers =
      owner && byOwner[owner] && typeof byOwner[owner] === "object"
        ? byOwner[owner]
        : {};
    const clean = {};
    Object.keys(workers).forEach((dni) => {
      const key = String(dni || "").replace(/\D/g, "");
      const nombre = String(workers[dni]?.nombre || "")
        .trim()
        .toUpperCase();
      if (key.length === 8 && nombre.length >= 3) {
        clean[key] = {
          nombre,
          manual: !!workers[dni]?.manual,
        };
      }
    });
    state.sessionWorkers = clean;
  }

  function saveSessionWorkers() {
    const owner = sessionOwnerDni();
    if (!owner) return;
    try {
      const byOwner = loadAllSavedWorkersByOwner();
      byOwner[owner] = state.sessionWorkers || {};
      localStorage.setItem(
        SAVED_WORKERS_KEY,
        JSON.stringify({
          byOwner,
          savedAt: new Date().toISOString(),
        })
      );
    } catch {
      /* sin espacio: el modal seguirá con lo que haya en memoria */
    }
  }

  function clearSessionWorkers() {
    state.sessionWorkers = {};
  }

  function rememberSessionWorker(dni, nombre, { manual = false, skipSave = false } = {}) {
    const key = String(dni || "").replace(/\D/g, "");
    const name = String(nombre || "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
    if (key.length !== 8 || name.length < 3) return false;
    if (!state.sessionWorkers || typeof state.sessionWorkers !== "object") {
      state.sessionWorkers = {};
    }
    const prev = state.sessionWorkers[key];
    state.sessionWorkers[key] = {
      nombre: name,
      manual: !!(manual || prev?.manual),
    };
    if (!skipSave) saveSessionWorkers();
    return true;
  }

  function captureSavedWorkers(workers) {
    let added = false;
    (workers || []).forEach((worker) => {
      if (
        rememberSessionWorker(worker?.dni, worker?.nombre, {
          manual: !!worker?.manual,
          skipSave: true,
        })
      ) {
        added = true;
      }
    });
    if (added) saveSessionWorkers();
  }

  function seedSavedWorkersFromHistory() {
    try {
      loadHarvestHistory().forEach((item) => captureSavedWorkers(item.workers));
    } catch {
      /* ignore */
    }
  }

  function seedSessionWorkersFromHarvest() {
    HARVEST_TYPES.forEach((item) => {
      harvestTypeBucket(item.key).workers.forEach((worker) => {
        rememberSessionWorker(worker.dni, worker.nombre, {
          manual: !!worker.manual,
        });
      });
    });
    seedSavedWorkersFromHistory();
  }

  function lookupPersona(dni) {
    const key = String(dni || "").replace(/\D/g, "");
    return (
      state.sessionManualPersonas[key] ||
      state.personas[key] ||
      null
    );
  }

  /** Solo supervisores de cosecha (Reporte Horas) pueden iniciar sesión */
  function lookupSupervisor(dni) {
    const key = String(dni || "").replace(/\D/g, "");
    return state.supervisores[key] || null;
  }

  function saveSupervisores() {
    localStorage.setItem(SUPERVISORES_KEY, JSON.stringify(state.supervisores));
  }

  function lookupNombre(dni) {
    return lookupPersona(dni)?.nombre || lookupSupervisor(dni)?.nombre || "";
  }

  function extractDni(text) {
    const raw = String(text || "");
    const m = raw.match(/\b(\d{8,12})\b/);
    if (m) return m[1];
    return raw.replace(/\D/g, "").slice(0, 12);
  }

  function loadCustomCatalog() {
    try {
      const raw = localStorage.getItem(CUSTOM_CATALOG_KEY);
      if (!raw) return { grupos: [], lotes: [] };
      const parsed = JSON.parse(raw);
      return {
        grupos: Array.isArray(parsed.grupos) ? parsed.grupos.map(String) : [],
        lotes: Array.isArray(parsed.lotes) ? parsed.lotes : [],
      };
    } catch {
      return { grupos: [], lotes: [] };
    }
  }

  function saveCustomCatalog(extra) {
    localStorage.setItem(CUSTOM_CATALOG_KEY, JSON.stringify(extra));
  }

  function mergeCatalogs(baseGrupos, baseLotes, extra) {
    const gSet = new Set();
    const grupos = [];
    [...baseGrupos, ...(extra.grupos || [])].forEach((g) => {
      const v = String(g || "").trim();
      if (!v) return;
      const key = v.toUpperCase();
      if (gSet.has(key)) return;
      gSet.add(key);
      grupos.push(v);
    });

    const lMap = new Map();
    [...baseLotes, ...(extra.lotes || [])].forEach((row) => {
      if (!row) return;
      const lote = String(row.lote || "").trim();
      if (!lote) return;
      const key = lote.toUpperCase();
      if (lMap.has(key)) return;
      lMap.set(key, {
        lote,
        codLote: String(row.codLote || "").trim(),
        modulo: String(row.modulo || "").trim(),
        turno: String(row.turno || "").trim(),
        variedad: String(row.variedad || "").trim(),
      });
    });

    const lotes = [...lMap.values()].sort((a, b) => {
      const na = Number(a.lote);
      const nb = Number(b.lote);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.lote.localeCompare(b.lote, "es");
    });

    return { grupos, lotes };
  }

  async function fetchCatalogFile(path) {
    const rel = path.startsWith("/") ? path : `/${path}`;
    try {
      const res = await fetch(rel, { cache: catalogFetchCache() });
      if (res.ok) return await res.json();
    } catch {
      /* offline */
    }
    return [];
  }

  async function loadCatalogs() {
    let baseGrupos = [];
    let baseLotes = [];
    try {
      const [grupos, lotes] = await Promise.all([
        fetchCatalogFile("/data/grupos-licapa.json"),
        fetchCatalogFile("/data/lotes-licapa.json"),
      ]);
      baseGrupos = Array.isArray(grupos) ? grupos : [];
      baseLotes = Array.isArray(lotes) ? lotes : [];
    } catch {
      /* offline / file:// */
    }
    const merged = mergeCatalogs(baseGrupos, baseLotes, loadCustomCatalog());
    state.grupos = merged.grupos;
    state.lotes = merged.lotes;
  }

  function findLote(lote) {
    const key = String(lote || "").trim().toUpperCase();
    if (!key) return null;
    return state.lotes.find((l) => String(l.lote).toUpperCase() === key) || null;
  }

  function addCustomGrupo(nombre) {
    const v = String(nombre || "").trim();
    if (!v) return null;
    const extra = loadCustomCatalog();
    const exists = [...state.grupos, ...extra.grupos].some(
      (g) => String(g).toUpperCase() === v.toUpperCase()
    );
    if (!exists) {
      extra.grupos.push(v);
      saveCustomCatalog(extra);
    }
    const merged = mergeCatalogs(state.grupos, state.lotes, extra);
    state.grupos = merged.grupos;
    state.lotes = merged.lotes;
    return v;
  }

  function addCustomLote(lote, modulo = "", turno = "", variedad = "") {
    const v = String(lote || "").trim();
    if (!v) return null;
    const extra = loadCustomCatalog();
    const exists = extra.lotes.some(
      (l) => String(l.lote).toUpperCase() === v.toUpperCase()
    );
    if (!exists && !findLote(v)) {
      extra.lotes.push({
        lote: v,
        codLote: "",
        modulo: String(modulo || "").trim(),
        turno: String(turno || "").trim(),
        variedad: String(variedad || "").trim(),
      });
      saveCustomCatalog(extra);
    }
    // re-merge: use current catalogs as base + extras
    const baseGrupos = state.grupos.filter(
      (g) =>
        !extra.grupos.some((x) => String(x).toUpperCase() === String(g).toUpperCase())
    );
    const baseLotes = state.lotes.filter(
      (l) =>
        !extra.lotes.some(
          (x) => String(x.lote).toUpperCase() === String(l.lote).toUpperCase()
        )
    );
    const merged = mergeCatalogs(baseGrupos, baseLotes, extra);
    state.grupos = merged.grupos;
    state.lotes = merged.lotes;
    return findLote(v);
  }

  function selectTrigger(icon, label, field, value, placeholder) {
    const shown = String(value || "").trim();
    return `
      <label class="guia-field">
        <span class="gf-label">${ico(icon, "ico ico-sm")} ${label}</span>
        <button type="button" class="select-trigger" data-pick="${field}" aria-label="${escapeHtml(label)}">
          ${
            shown
              ? `<span>${escapeHtml(shown)}</span>`
              : `<span class="ph">${escapeHtml(placeholder)}</span>`
          }
          <span class="chev">${ico("search", "ico")}</span>
        </button>
      </label>`;
  }

  function closePicker() {
    state.picker = null;
    $("#pickerQuery")?.blur();
    if (document.activeElement?.closest?.("#picker")) {
      try {
        document.activeElement.blur();
      } catch {
        /* ignore */
      }
    }
    const el = $("#picker");
    if (el) el.hidden = true;
    const q = $("#pickerQuery");
    if (q) q.value = "";
    const addBtn = $("#pickerAdd");
    if (addBtn) addBtn.hidden = false;
    resetViewportLayout();
  }

  function grupoLicList_() {
    const out = [
      { key: "NO_TENGO", primary: "No tengo", secondary: "LIC" },
    ];
    for (let n = 1; n <= 60; n++) {
      const num = String(n).padStart(2, "0");
      out.push({
        key: `GRUPO LIC ${num}`,
        primary: `Grupo LIC ${num}`,
        secondary: "LIC",
      });
    }
    return out;
  }

  /** Guías: LIC 1–50 + No tengo por ahora (después de Fundo). */
  function guidesLicList_() {
    const out = [
      {
        key: "NO_TENGO_POR_AHORA",
        primary: "No tengo por ahora",
        secondary: "LIC",
      },
    ];
    for (let n = 1; n <= 50; n++) {
      const num = String(n).padStart(2, "0");
      out.push({
        key: `LIC ${num}`,
        primary: `LIC ${num}`,
        secondary: "",
      });
    }
    return out;
  }

  function isGuidesLicNoTengo_(raw) {
    const s = String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/_/g, " ");
    return /NO\s*TENGO/.test(s);
  }

  function normGuidesLic_(raw) {
    if (isGuidesLicNoTengo_(raw)) return "NO_TENGO_POR_AHORA";
    const gNum = String(raw || "").replace(/\D/g, "");
    if (gNum && Number(gNum) >= 1 && Number(gNum) <= 50) {
      return `LIC ${String(Number(gNum)).padStart(2, "0")}`;
    }
    return "";
  }

  function displayGuidesLic_(raw) {
    const v = normGuidesLic_(raw);
    if (!v) return "";
    if (v === "NO_TENGO_POR_AHORA") return "No tengo por ahora";
    return v;
  }

  function isValidGuidesLic_(v) {
    return !!normGuidesLic_(v);
  }

  function grupoNumList_() {
    const out = [
      { key: "NO_TENGO", primary: "No tengo", secondary: "" },
    ];
    for (let n = 1; n <= 60; n++) {
      const num = String(n).padStart(2, "0");
      out.push({
        key: `GRUPO ${num}`,
        primary: `Grupo ${num}`,
        secondary: "",
      });
    }
    return out;
  }

  function isNoTengo_(raw) {
    const s = String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/_/g, " ");
    return /NO\s*TENGO/.test(s);
  }

  function isValidGrupoLic_(v) {
    return isNoTengo_(v) || /^GRUPO LIC ([0-5][0-9]|60)$/.test(v);
  }

  function isValidGrupoNum_(v) {
    return isNoTengo_(v) || /^GRUPO ([0-5][0-9]|60)$/.test(v);
  }

  function displayGrupo_(v) {
    if (isNoTengo_(v)) return "No tengo";
    return String(v || "").replace(/^GRUPO\s+/i, "Grupo ");
  }

  function normGrupoLic_(raw) {
    if (isNoTengo_(raw)) return "NO_TENGO";
    const gNum = String(raw || "").replace(/\D/g, "");
    if (gNum && Number(gNum) >= 1 && Number(gNum) <= 60) {
      return `GRUPO LIC ${String(Number(gNum)).padStart(2, "0")}`;
    }
    return "";
  }

  function normGrupoNum_(raw) {
    if (isNoTengo_(raw)) return "NO_TENGO";
    const gNum = String(raw || "").replace(/\D/g, "");
    if (gNum && Number(gNum) >= 1 && Number(gNum) <= 60) {
      return `GRUPO ${String(Number(gNum)).padStart(2, "0")}`;
    }
    return "";
  }

  function setVinGrupoLicUI(value) {
    const v = normGrupoLic_(value);
    const hidden = $("#vinGrupoLic");
    const label = $("#vinGrupoLicLabel");
    if (hidden) hidden.value = v;
    if (!label) return;
    if (v) {
      label.textContent = displayGrupo_(v);
      label.classList.remove("ph");
    } else {
      label.textContent = "Elegir";
      label.classList.add("ph");
    }
  }

  function setVinGrupoUI(value) {
    const v = normGrupoNum_(value);
    const hidden = $("#vinGrupo");
    const label = $("#vinGrupoLabel");
    if (hidden) hidden.value = v;
    if (!label) return;
    if (v) {
      label.textContent = displayGrupo_(v);
      label.classList.remove("ph");
    } else {
      label.textContent = "Elegir";
      label.classList.add("ph");
    }
  }

  function openPicker(kind, guiaId) {
    if (
      kind === "grupoLic" ||
      kind === "grupoNum" ||
      kind === "guidesLic" ||
      kind === "harvestLote" ||
      kind === "harvestType" ||
      kind === "fundo"
    ) {
      state.picker = { kind, guiaId: "" };
      const title = $("#pickerTitle");
      const query = $("#pickerQuery");
      const search = query?.closest(".picker-search");
      const addBtn = $("#pickerAdd");
      if (title) {
        title.textContent =
          kind === "grupoLic"
            ? "Buscar Grupo LIC"
            : kind === "guidesLic"
              ? "Seleccionar LIC"
              : kind === "grupoNum"
                ? "Buscar Grupo"
                : kind === "harvestType"
                  ? "Tipo de registro"
                  : kind === "fundo"
                    ? "Seleccionar fundo"
                    : "Buscar lote";
      }
      if (query) {
        query.placeholder =
          kind === "grupoLic"
            ? "Buscar Grupo LIC 01, 02…"
            : kind === "guidesLic"
              ? "Buscar LIC 01…50 o No tengo"
              : kind === "grupoNum"
                ? "Buscar Grupo 01, 02…"
                : "Buscar lote...";
        query.value = "";
      }
      if (search) {
        search.hidden = kind === "harvestType" || kind === "fundo";
      }
      if (addBtn) addBtn.hidden = true;
      renderPickerList();
      const backdrop = $("#picker");
      if (backdrop) {
        backdrop.hidden = false;
        hydrateIcons(backdrop);
      }
      if (kind !== "harvestType" && kind !== "fundo") {
        setTimeout(() => query?.focus(), 60);
      }
      return;
    }

    const guia = findGuia(guiaId);
    if (!guia) return;
    state.picker = { kind, guiaId };
    const title = $("#pickerTitle");
    const query = $("#pickerQuery");
    const search = query?.closest(".picker-search");
    const addBtn = $("#pickerAdd");
    if (title) {
      title.textContent = kind === "lote" ? "Buscar por lote" : "Buscar por grupo";
    }
    if (query) {
      query.placeholder =
        kind === "lote"
          ? "Buscar lote..."
          : "Buscar grupo...";
      query.value = "";
    }
    if (search) search.hidden = false;
    if (addBtn) {
      addBtn.hidden = false;
      addBtn.textContent = "Agregar uno";
    }
    renderPickerList();
    const backdrop = $("#picker");
    if (backdrop) {
      backdrop.hidden = false;
      hydrateIcons(backdrop);
    }
    setTimeout(() => query?.focus(), 60);
  }

  function pickerItems() {
    const ctx = state.picker;
    if (!ctx) return [];
    const q = String($("#pickerQuery")?.value || "")
      .trim()
      .toLowerCase();

    if (ctx.kind === "grupoLic") {
      return grupoLicList_().filter((g) => {
        if (!q) return true;
        if (isNoTengo_(g.key)) return "no tengo".includes(q) || q.includes("no");
        const n = String(parseInt(g.key.replace(/\D/g, ""), 10));
        return (
          g.primary.toLowerCase().includes(q) ||
          g.key.toLowerCase().includes(q) ||
          n.includes(q) ||
          q.includes("lic")
        );
      });
    }
    if (ctx.kind === "guidesLic") {
      return guidesLicList_().filter((g) => {
        if (!q) return true;
        if (isGuidesLicNoTengo_(g.key)) {
          return (
            "no tengo por ahora".includes(q) ||
            q.includes("no") ||
            q.includes("ahora")
          );
        }
        const n = String(parseInt(g.key.replace(/\D/g, ""), 10));
        return (
          g.primary.toLowerCase().includes(q) ||
          g.key.toLowerCase().includes(q) ||
          n.includes(q) ||
          q.includes("lic")
        );
      });
    }
    if (ctx.kind === "grupoNum") {
      return grupoNumList_().filter((g) => {
        if (!q) return true;
        if (isNoTengo_(g.key)) return "no tengo".includes(q) || q.includes("no");
        const n = String(parseInt(g.key.replace(/\D/g, ""), 10));
        return (
          g.primary.toLowerCase().includes(q) ||
          g.key.toLowerCase().includes(q) ||
          n.includes(q)
        );
      });
    }
    if (ctx.kind === "harvestType") {
      return HARVEST_TYPES.map((item) => {
        const locked = isHarvestTypeLocked(item.key);
        return {
          key: item.key,
          primary: item.label,
          secondary: locked ? "Bloqueada hoy" : "",
          raw: item,
        };
      });
    }
    if (ctx.kind === "fundo") {
      return FUNDO_OPTIONS.map((f) => ({
        key: f,
        primary: f,
        secondary: "",
        raw: f,
      }));
    }

    if (ctx.kind === "grupo") {
      return state.grupos
        .filter((g) => !q || String(g).toLowerCase().includes(q))
        .map((g) => ({
          key: g,
          primary: g,
          secondary: "",
          raw: g,
        }));
    }
    return state.lotes
      .filter((l) => {
        if (!q) return true;
        const loteQuery = q.replace(/^lote\s*/i, "").trim();
        const hay = `${l.lote} ${l.codLote || ""}`.toLowerCase();
        return hay.includes(loteQuery);
      })
      .map((l) => ({
        key: l.lote,
        primary: `Lote ${l.lote}`,
        secondary: `${l.modulo || "—"} · T${l.turno || "—"} · ${l.variedad || l.codLote || ""}`.replace(/\s·\s$/, ""),
        raw: l,
      }));
  }

  function renderPickerList() {
    const list = $("#pickerList");
    if (!list) return;
    const items = pickerItems();
    let selected = "";
    if (state.picker?.kind === "grupoLic") {
      selected = $("#vinGrupoLic")?.value || "";
    } else if (state.picker?.kind === "guidesLic") {
      selected = currentGuidesLic() || "";
    } else if (state.picker?.kind === "grupoNum") {
      selected = $("#vinGrupo")?.value || "";
    } else if (state.picker?.kind === "fundo") {
      selected = currentFundo();
    } else if (state.picker?.kind === "harvestLote") {
      selected = state.harvest.lote || "";
    } else if (state.picker?.kind === "harvestType") {
      selected = state.harvest.tipo || "suma-jarras";
    } else if (state.picker && findGuia(state.picker.guiaId)) {
      const guia = findGuia(state.picker.guiaId);
      if (state.picker.kind === "lote") {
        selected = guia?.lote || "";
      } else {
        selected = guia?.grupo || "";
      }
    }

    if (!items.length) {
      list.innerHTML = `<div class="picker-empty">Sin resultados.</div>`;
      return;
    }

    list.innerHTML = items
      .map((it) => {
        const active =
          String(selected || "").toUpperCase() === String(it.key).toUpperCase()
            ? " is-active"
            : "";
        const sec = it.secondary
          ? ` – <span>${escapeHtml(it.secondary)}</span>`
          : "";
        return `<button type="button" class="picker-item${active}" data-pick-value="${escapeHtml(it.key)}" role="option">
          <strong>${escapeHtml(it.primary)}</strong>${sec}
        </button>`;
      })
      .join("");
  }

  function applyPickerValue(value) {
    const ctx = state.picker;
    if (!ctx) return;
    const v = String(value || "").trim();
    if (!v) return;

    if (ctx.kind === "grupoLic") {
      setVinGrupoLicUI(v);
      closePicker();
      toast(displayGrupo_(normGrupoLic_(v)));
      return;
    }
    if (ctx.kind === "guidesLic") {
      setGuidesLic(v);
      closePicker();
      if ($("#guidesSummaryModal") && !$("#guidesSummaryModal").hidden) {
        renderGuidesSummaryCard();
      }
      toast(displayGuidesLic_(v) || "LIC");
      return;
    }
    if (ctx.kind === "grupoNum") {
      setVinGrupoUI(v);
      closePicker();
      toast(displayGrupo_(normGrupoNum_(v)));
      return;
    }
    if (ctx.kind === "harvestLote") {
      if (isHarvestTypeLocked(state.harvest.tipo)) {
        closePicker();
        toast("Tipo bloqueado · no se cambia el lote");
        return;
      }
      selectHarvestLote(v);
      closePicker();
      toast(`Lote ${v}`);
      return;
    }
    if (ctx.kind === "harvestType") {
      if (!HARVEST_TYPES.some((item) => item.key === v)) return;
      if (isHarvestTypeLocked(v)) {
        closePicker();
        switchHarvestType(v);
        toast(`${harvestTypeShort(v)} ya guardada · bloqueada`);
        return;
      }
      switchHarvestType(v);
      closePicker();
      toast(harvestTypeLabel(v));
      return;
    }
    if (ctx.kind === "fundo") {
      setGuidesFundo(v);
      closePicker();
      if ($("#guidesSummaryModal") && !$("#guidesSummaryModal").hidden) {
        renderGuidesSummaryCard();
      }
      toast(`Fundo ${v}`);
      return;
    }

    const guia = findGuia(ctx.guiaId);
    if (!guia) return;

    if (ctx.kind === "grupo") {
      guia.grupo = v;
    } else {
      const row = findLote(v);
      guia.lote = v;
      if (row) {
        if (row.modulo) guia.modulo = row.modulo;
        if (row.turno) guia.turno = row.turno;
        if (row.variedad) guia.variedad = row.variedad;
        if (row.codLote) guia.codLote = row.codLote;
      }
    }
    saveStore();
    closePicker();
    renderCards();
    toast(ctx.kind === "grupo" ? `Grupo ${v}` : `Lote ${v}`);
  }

  function onPickerAdd() {
    const ctx = state.picker;
    if (!ctx || ctx.kind === "grupoLic" || ctx.kind === "grupoNum" || ctx.kind === "guidesLic") return;
    const typed = String($("#pickerQuery")?.value || "").trim();
    if (!typed) {
      toast("Escriba arriba lo que desea agregar");
      $("#pickerQuery")?.focus();
      return;
    }
    if (ctx.kind === "grupo") {
      const g = addCustomGrupo(typed);
      if (g) applyPickerValue(g);
      return;
    }
    const row = addCustomLote(typed);
    if (row) applyPickerValue(row.lote);
  }

  function getPin() {
    return localStorage.getItem(PIN_KEY) || DEFAULT_PIN;
  }
  function setPin(pin) {
    localStorage.setItem(PIN_KEY, pin);
  }
  function isUnlocked() {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  }
  function sessionPin() {
    return sessionStorage.getItem(SESSION_PIN_KEY) || "";
  }

  /** Saludo: primer apellido (LEON ANTUNEZ CRISTOPHER → LEON). */
  function greetingName(full, fallback) {
    const parts = String(full || "")
      .trim()
      .toUpperCase()
      .split(/\s+/)
      .filter(Boolean);
    return parts[0] || fallback || "";
  }

  function identityFullName(identity) {
    const id = identity || state.identity || getIdentity() || {};
    const dni = String(id.dni || "").replace(/\D/g, "");
    const fromId = String(id.nombre || "").trim();
    if (fromId) return fromId;
    const fromCatalog = dni ? String(lookupSupervisor(dni)?.nombre || "").trim() : "";
    if (fromCatalog) return fromCatalog;
    try {
      const ls = JSON.parse(localStorage.getItem(IDENTITY_LS_KEY) || "null");
      if (ls?.nombre && (!dni || String(ls.dni || "").replace(/\D/g, "") === dni)) {
        return String(ls.nombre).trim();
      }
    } catch {
      /* ignore */
    }
    return "";
  }

  function paintGreeting(sel, identity) {
    const el = $(sel);
    if (!el) return;
    const name = greetingName(identityFullName(identity));
    if (name) {
      el.textContent = name;
      return;
    }
    const current = String(el.textContent || "").trim();
    if (current && current.toUpperCase() !== "SUPERVISOR") return;
    el.textContent = "Supervisor";
  }

  function getIdentity() {
    let fromSession = null;
    let fromLs = null;
    try {
      fromSession = JSON.parse(sessionStorage.getItem(IDENTITY_KEY) || "null");
    } catch {
      fromSession = null;
    }
    try {
      fromLs = JSON.parse(localStorage.getItem(IDENTITY_LS_KEY) || "null");
    } catch {
      fromLs = null;
    }
    const session = fromSession?.dni ? fromSession : null;
    const ls = fromLs?.dni ? fromLs : null;
    if (session && ls && String(session.dni).replace(/\D/g, "") === String(ls.dni).replace(/\D/g, "")) {
      if (!String(session.nombre || "").trim() && ls.nombre) {
        return { ...ls, ...session, nombre: ls.nombre };
      }
      return { ...ls, ...session, nombre: session.nombre || ls.nombre };
    }
    return session || ls;
  }

  function authenticatedDni() {
    try {
      const auth = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || "null");
      return String(auth?.dni || "").replace(/\D/g, "");
    } catch {
      return "";
    }
  }

  function authenticatedToken() {
    try {
      const auth = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || "null");
      return String(auth?.token || "");
    } catch {
      return "";
    }
  }

  function saveAuthenticatedSession(identity, token) {
    const dni = String(identity?.dni || "").replace(/\D/g, "");
    if (!dni) return;
    if (PASSWORD_REQUIRED && !token) return;
    localStorage.setItem(
      AUTH_SESSION_KEY,
      JSON.stringify({
        dni,
        token: token || `qr:${dni}`,
        authenticatedAt: new Date().toISOString(),
      })
    );
  }

  function clearAuthenticatedSession() {
    localStorage.removeItem(AUTH_SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_PIN_KEY);
  }

  function isVinculoComplete_(info) {
    if (!info) return false;
    const cel = String(info.celular || "").replace(/\D/g, "");
    const sup = String(info.supervisorGlobal || "").trim();
    return (
      cel.length >= 9 &&
      sup.length >= 3 &&
      isValidGrupoNum_(info.grupo) &&
      isValidGrupoLic_(info.grupoLic)
    );
  }

  /** Login de registro = QR/DNI válido en el listado. Sin esto no hay app. */
  function hasQrLogin() {
    const id = state.identity || getIdentity();
    if (!id?.dni) return false;
    const dni = String(id.dni).replace(/\D/g, "");
    if (PASSWORD_REQUIRED) {
      if (authenticatedDni() !== dni || !authenticatedToken()) return false;
    }
    const persona = lookupSupervisor(dni);
    if (!persona) {
      // JSON aún no cargado → no borrar (evita salto a seguridad en refresh)
      if (!Object.keys(state.supervisores || {}).length) {
        state.identity = id;
        return true;
      }
      // Ya vinculado en este celular → mantener sesión aunque falle el catálogo
      const done = vinculoDoneMap()[dni];
      if (isVinculoComplete_(done) || isVinculoComplete_(id)) {
        state.identity = {
          dni,
          nombre: id.nombre || "",
          cargo: id.cargo || "SUPERVISOR DE COSECHA",
          celular: done?.celular || id.celular || "",
          supervisorGlobal: done?.supervisorGlobal || id.supervisorGlobal || "",
          grupo: done?.grupo || id.grupo || "",
          grupoLic: done?.grupoLic || id.grupoLic || "",
          linked: true,
        };
        setIdentity(state.identity);
        return true;
      }
      return false;
    }
    const done = vinculoDoneMap()[dni] || {};
    state.identity = {
      dni,
      nombre: persona.nombre || id.nombre || "",
      cargo: persona.cargo || id.cargo || "SUPERVISOR DE COSECHA",
      celular: done.celular || persona.celular || id.celular || "",
      supervisorGlobal: done.supervisorGlobal || id.supervisorGlobal || "",
      grupo: done.grupo || id.grupo || "",
      grupoLic: done.grupoLic || id.grupoLic || "",
      linked: isVinculoComplete_(done) || isVinculoComplete_(id) || !!id.linked,
    };
    setIdentity(state.identity);
    return true;
  }

  /** Tras refresh / salir del navegador: recupera el último vínculo de este celular */
  /**
   * Tras cerrar sesión no se debe reconstruir al supervisor anterior:
   * la app tiene que exigir un nuevo escaneo de carnet.
   */
  function wasLoggedOut() {
    try {
      return localStorage.getItem(LOGOUT_FLAG_KEY) === "1";
    } catch {
      return false;
    }
  }

  function markLoggedOut() {
    try {
      localStorage.setItem(LOGOUT_FLAG_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  function clearLoggedOutFlag() {
    try {
      localStorage.removeItem(LOGOUT_FLAG_KEY);
    } catch {
      /* ignore */
    }
  }

  function restoreIdentityFromVinculo_() {
    if (wasLoggedOut()) return null;
    const existing = getIdentity();
    if (existing?.dni) {
      const dni = String(existing.dni).replace(/\D/g, "");
      const done = vinculoDoneMap()[dni] || {};
      const merged = {
        ...existing,
        dni,
        celular: done.celular || existing.celular || "",
        supervisorGlobal: done.supervisorGlobal || existing.supervisorGlobal || "",
        grupo: done.grupo || existing.grupo || "",
        grupoLic: done.grupoLic || existing.grupoLic || "",
        linked:
          !!existing.linked ||
          isVinculoComplete_(done) ||
          isVinculoComplete_(existing),
      };
      state.identity = merged;
      setIdentity(merged);
      return merged;
    }
    const map = vinculoDoneMap();
    let best = null;
    let bestAt = 0;
    Object.keys(map).forEach((dni) => {
      const info = map[dni] || {};
      if (!isVinculoComplete_(info)) return;
      const t = Date.parse(info.at || 0) || 0;
      if (t >= bestAt) {
        bestAt = t;
        const persona = lookupSupervisor(dni) || {};
        best = {
          dni: String(dni).replace(/\D/g, ""),
          nombre: persona.nombre || info.nombre || "",
          cargo: persona.cargo || "SUPERVISOR DE COSECHA",
          celular: info.celular || "",
          supervisorGlobal: info.supervisorGlobal || "",
          grupo: info.grupo || "",
          grupoLic: info.grupoLic || "",
          linked: true,
        };
      }
    });
    if (best?.dni) {
      setIdentity(best);
      return best;
    }
    return null;
  }

  /** Evita mezclar datos de otro DNI al refrescar el mismo dispositivo */
  function bindSessionToIdentity(dni) {
    const owner = String(dni || "").replace(/\D/g, "");
    if (!owner) return;
    const prev = String(state.session?.ownerDni || "").replace(/\D/g, "");
    if (prev && prev !== owner) {
      state.session = emptySession();
      state.guias = [];
    }
    state.session.ownerDni = owner;
    saveStore();
  }

  function setIdentity(identity) {
    state.identity = identity || null;
    try {
      if (identity) {
        sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
        localStorage.setItem(IDENTITY_LS_KEY, JSON.stringify(identity));
      } else {
        sessionStorage.removeItem(IDENTITY_KEY);
        localStorage.removeItem(IDENTITY_LS_KEY);
      }
    } catch {
      /* ignore */
    }
  }

  function hideAllScreens() {
    [
      "#lockScreen",
      "#securityScreen",
      "#vinculoScreen",
      "#harvestScreen",
      "#sessionScreen",
      "#appRoot",
    ].forEach((sel) => {
      const el = $(sel);
      if (el) el.hidden = true;
    });
  }

  function showSecurityLogin(msg, opts = {}) {
    state.scanProcessing = false;
    hideAppLoader(true);
    setQrLoading(false);
    $("#qrFrame")?.classList.remove("is-scanning");
    closeSheets();
    closePicker();
    const force = !!opts.force;
    if (!force) {
      const saved = restoreIdentityFromVinculo_() || getIdentity();
      const savedDni = String(saved?.dni || "").replace(/\D/g, "");
      if (
        savedDni &&
        (!PASSWORD_REQUIRED ||
          (authenticatedDni() === savedDni && authenticatedToken()))
      ) {
        state.identity = saved;
        setIdentity(saved);
        // Vincular es opcional: con DNI ya puede usar Registro
        showMainFlow();
        return;
      }
    } else {
      setIdentity(null);
    }
    if (getPage() !== "scan") {
      goTo("scan", true);
      return;
    }
    hideAllScreens();
    const screen = $("#securityScreen");
    if (screen) screen.hidden = false;
    hydrateIcons(screen);
    updateNetworkUI();
    const formMsg = $("#secMsg");
    if (formMsg) formMsg.textContent = msg || "";
    const found = $("#secFound");
    if (found) {
      found.hidden = true;
      found.classList.remove("is-found");
    }
    const overlay = $("#qrOverlay");
    const overlayTxt = $("#qrOverlayText");
    if (overlayTxt) overlayTxt.textContent = "Toque para activar la cámara";
    if (overlay) overlay.hidden = false;
    if ($("#btnStartCam")) $("#btnStartCam").hidden = false;
    if ($("#btnStopCam")) $("#btnStopCam").hidden = true;
    // Solo mostrar "Cerrar sesión" si ya hay sesión autenticada
    if ($("#btnSecBack")) {
      const hasSession = PASSWORD_REQUIRED
        ? !!(authenticatedDni() && authenticatedToken())
        : !!(getIdentity()?.dni || authenticatedDni());
      $("#btnSecBack").hidden = !hasSession;
    }
  }

  function showPasswordGate(identity) {
    stopCamera();
    state.pendingIdentity = identity;
    hideAllScreens();
    const screen = $("#lockScreen");
    if (screen) screen.hidden = false;
    const title = $("#loginTitle");
    const copy = $("#loginCopy");
    const hint = $("#pinHint");
    const input = $("#loginPass");
    const form = $("#loginForm");
    const msg = $("#pinMsg");
    if (title) title.textContent = "Confirme su identidad";
    if (copy) copy.textContent = `${identity.nombre} · DNI ${identity.dni}`;
    if (hint) hint.textContent = "Ingrese su contraseña personal";
    if (form) form.hidden = false;
    if (msg) msg.textContent = "";
    if (input) {
      input.value = "";
      input.focus();
    }
    hydrateIcons(screen);
    updateNetworkUI();
  }

  function ensureSessionGate() {
    sessionStorage.setItem(SESSION_KEY, "1");
    if (!sessionPin()) {
      sessionStorage.setItem(SESSION_PIN_KEY, getPin());
    }
  }

  function unlock(pin) {
    sessionStorage.setItem(SESSION_KEY, "1");
    if (pin) sessionStorage.setItem(SESSION_PIN_KEY, pin);
    else if (!sessionPin()) sessionStorage.setItem(SESSION_PIN_KEY, getPin());
    showSecurityLogin("");
  }

  function lock() {
    stopCamera();
    state.pendingIdentity = null;
    markLoggedOut();
    clearAuthenticatedSession();
    clearSessionManualPersonas();
    clearSessionWorkers();
    state.harvest = emptyHarvest();
    try {
      localStorage.removeItem(HARVEST_KEY);
    } catch {
      /* ignore */
    }
    setIdentity(null);
    requestCacheRefresh();
    if (getPage() === "scan") {
      showSecurityLogin("Escanee su carnet QR", { force: true });
    } else {
      goTo("scan", true);
    }
  }

  function requireQrLogin() {
    ensureSessionGate();
    if (!hasQrLogin()) {
      showSecurityLogin("Debe escanear su carnet QR");
      return false;
    }
    return true;
  }

  function showMainFlow() {
    stopCamera();
    ensureSessionGate();
    if (!hasQrLogin()) {
      showSecurityLogin("Escanee su carnet QR para continuar");
      return;
    }
    const id = state.identity || getIdentity();
    bindSessionToIdentity(id.dni);
    // El DNI habilita toda la app. Vincular es una ficha opcional de Sistemas.
    if (getPage() === "vinculo") {
      showVinculoScreen(id);
      return;
    }
    if (getPage() === "registro") {
      showHarvestHome(id);
      return;
    }
    // Desde el escáner: abrir Registro (vincular es opcional desde la pestaña).
    if (!SESSION_FORM_ENABLED) {
      goTo("registro", true);
      return;
    }
    if (needsVinculo(id)) {
      goTo("vinculo", true);
      return;
    }
    if (!state.session.ready) {
      hideAllScreens();
      $("#sessionScreen").hidden = false;
      fillSessionForm();
      if (id && !$("#sesSupDni").value) {
        $("#sesSupDni").value = id.dni;
        $("#sesSupNombre").value = id.nombre;
      }
      if ($("#sesHeroDni")) {
        $("#sesHeroDni").textContent = id?.dni ? `DNI ${id.dni}` : "";
      }
      hydrateIcons($("#sessionScreen"));
      updateNetworkUI();
      return;
    }
    hideAllScreens();
    $("#appRoot").hidden = false;
    hydrateIcons($("#appRoot"));
    renderSessionBanner();
    renderCards();
    updateKpis();
    updateNetworkUI();
  }

  function previewSecurityDni() {
    /* manual DNI removed — solo QR */
  }

  function validateSecurityDni(raw) {
    const dni = extractDni(raw);
    const p = lookupSupervisor(dni);
    if (!dni || dni.length < 8) {
      $("#secMsg").textContent = "QR sin DNI válido · intente de nuevo";
      return null;
    }
    if (!p) {
      $("#secMsg").textContent =
        `DNI ${dni} · No autorizado · solo Supervisores de Cosecha (COSTO DE COSECHA)`;
      return null;
    }
    return {
      dni,
      nombre: p.nombre,
      cargo: p.cargo || "SUPERVISOR DE COSECHA",
      celular: p.celular || "",
    };
  }

  /** Beep corto tipo escáner de código de barras */
  function playScanBeep(ok = true) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!state.audioCtx) state.audioCtx = new AC();
      const ctx = state.audioCtx;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(ok ? 1800 : 420, now);
      if (ok) {
        osc.frequency.exponentialRampToValueAtTime(2400, now + 0.06);
      }
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (ok ? 0.12 : 0.18));
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + (ok ? 0.14 : 0.2));
    } catch {
      /* sin audio */
    }
  }

  function vinculoDoneMap() {
    try {
      return JSON.parse(localStorage.getItem(VINCULO_DONE_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }

  function markVinculoDone(dni, celular, supervisorGlobal, grupo, grupoLic) {
    const key = String(dni || "").replace(/\D/g, "");
    if (!key) return;
    const map = vinculoDoneMap();
    const entry = {
      celular: String(celular || "").replace(/\D/g, ""),
      supervisorGlobal: String(supervisorGlobal || "")
        .trim()
        .toUpperCase(),
      grupo: normGrupoNum_(grupo),
      grupoLic: normGrupoLic_(grupoLic),
      at: new Date().toISOString(),
    };
    map[key] = entry;
    localStorage.setItem(VINCULO_DONE_KEY, JSON.stringify(map));
    const cur = state.identity || getIdentity() || {};
    if (String(cur.dni || "").replace(/\D/g, "") === key) {
      setIdentity({
        ...cur,
        dni: key,
        celular: entry.celular,
        supervisorGlobal: entry.supervisorGlobal,
        grupo: entry.grupo,
        grupoLic: entry.grupoLic,
        linked: true,
      });
    }
  }

  function needsVinculo(identity) {
    if (!identity?.dni) return true;
    const dni = String(identity.dni).replace(/\D/g, "");
    const done = vinculoDoneMap()[dni];
    if (isVinculoComplete_(done)) return false;
    if (isVinculoComplete_(identity)) {
      markVinculoDone(
        dni,
        identity.celular,
        identity.supervisorGlobal,
        identity.grupo,
        identity.grupoLic
      );
      return false;
    }
    return true;
  }

  function loadVinculoQueue() {
    try {
      const q = JSON.parse(localStorage.getItem(VINCULO_QUEUE_KEY) || "[]");
      return Array.isArray(q) ? q : [];
    } catch {
      return [];
    }
  }

  function saveVinculoQueue(q) {
    localStorage.setItem(VINCULO_QUEUE_KEY, JSON.stringify(q || []));
  }

  function buildVinculoPayload(raw) {
    const dni = String(raw?.dni || "").replace(/\D/g, "");
    const dniSesion = String(raw?.dniSesion || dni).replace(/\D/g, "") || dni;
    const celular = String(raw?.celular || "").replace(/\D/g, "");
    const nombre = String(raw?.nombre || "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
    const supervisorGlobal = String(raw?.supervisorGlobal || "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
    const grupoLic = normGrupoLic_(raw?.grupoLic);
    const grupo = normGrupoNum_(raw?.grupo);
    const hora =
      String(raw?.horaRegistro || raw?.hora || "").trim() ||
      new Date().toLocaleString("es-PE", { hour12: true });
    return {
      dni,
      nombre,
      celular,
      grupoLic,
      grupo,
      supervisorGlobal,
      dniSesion,
      horaRegistro: hora,
      hora,
      authToken: String(raw?.authToken || authenticatedToken()),
    };
  }

  function enqueueVinculo(payload) {
    const clean = buildVinculoPayload(payload);
    if (!clean.dni || clean.dni.length < 8) return;
    if (!/^9\d{8}$/.test(clean.celular)) return;
    if (!isValidGrupoLic_(clean.grupoLic)) return;
    if (!isValidGrupoNum_(clean.grupo)) return;
    if (!clean.supervisorGlobal || clean.supervisorGlobal.length < 3) return;
    const q = loadVinculoQueue();
    const next = q.filter((x) => String(x.dni) !== clean.dni);
    next.push({ ...clean, queuedAt: new Date().toISOString() });
    saveVinculoQueue(next);
    updateNetworkUI();
  }

  function loadCloudDataQueue() {
    try {
      const q = JSON.parse(localStorage.getItem(CLOUD_DATA_QUEUE_KEY) || "[]");
      return Array.isArray(q) ? q : [];
    } catch {
      return [];
    }
  }

  function saveCloudDataQueue(queue) {
    localStorage.setItem(CLOUD_DATA_QUEUE_KEY, JSON.stringify(queue || []));
  }

  function enqueueCloudData(action, data, id) {
    if (!action || !data) return;
    const key = String(id || data.id || uid());
    const queue = loadCloudDataQueue().filter((item) => item.id !== key);
    queue.push({
      id: key,
      action,
      data,
      queuedAt: new Date().toISOString(),
    });
    saveCloudDataQueue(queue);
    updateNetworkUI();
  }

  async function flushCloudDataQueue() {
    return runCloudFlushExclusive(async () => {
      if (!navigator.onLine) {
        updateNetworkUI();
        return { sent: 0, remain: loadCloudDataQueue().length };
      }

      const queue = loadCloudDataQueue();
      if (!queue.length) {
        updateNetworkUI();
        return { sent: 0, remain: 0 };
      }

      const guiasItems = queue.filter((item) => isGuiasCloudAction(item.action));
      const otherItems = queue.filter((item) => !isGuiasCloudAction(item.action));

      // Guías: directo a Apps Script (no necesita Netlify Functions)
      // Resto (cosecha/manuales): sí usa proxy Netlify
      if (otherItems.length && !canUseCloudApi()) {
        const ready = await ensureCloudReady_(3000);
        if (!ready && !guiasItems.length) {
          updateNetworkUI();
          return { sent: 0, remain: loadCloudDataQueue().length };
        }
      }

      const remain = [];
      let sent = 0;

      for (const item of queue) {
        try {
          if (isGuiasCloudAction(item.action)) {
            const result = await postGuiasToAppsScript(item.data);
            if (result.ok) sent += 1;
            else {
              console.warn("guias flush fail", result.message || result.parsed);
              remain.push(item);
            }
            continue;
          }

          if (!canUseCloudApi()) {
            remain.push(item);
            continue;
          }

          const response = await fetch(API.sync, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: item.action,
              authToken: authenticatedToken(),
              data: item.data,
            }),
          });
          const result = await response.json().catch(() => ({}));
          if (response.ok && result.ok === true) sent += 1;
          else remain.push(item);
        } catch {
          remain.push(item);
        }
      }

      saveCloudDataQueue(mergeCloudQueueAfterFlush(queue, remain));
      updateNetworkUI();
      const pending = loadCloudDataQueue().length;
      if (sent > 0 && pending === 0) toast("Datos enviados correctamente");
      return { sent, remain: pending };
    });
  }

  /** Solo proxy Netlify (/.netlify/functions/…) */
  function canUseCloudApi() {
    return !!navigator.onLine && !!state.cloudApi;
  }

  function canUseNetlifyProxy() {
    return canUseCloudApi();
  }

  function setThanksSyncStatus(text, mode) {
    const el = $("#thanksSyncStatus");
    if (!el) return;
    el.hidden = false;
    el.textContent = text;
    el.classList.remove("is-ok", "is-pending", "is-err");
    if (mode) el.classList.add(mode);
    // Confirmado por el servidor: no retener al supervisor en "gracias"
    if (mode === "is-ok" && state.thanksRedirect) scheduleRegistroRedirect(900);
  }

  /** Tras vincular, Registro se abre solo (el envío sigue en segundo plano). */
  function scheduleRegistroRedirect(ms = 2000) {
    state.thanksRedirect = true;
    clearTimeout(state.thanksRedirectTimer);
    state.thanksRedirectTimer = setTimeout(() => goTo("registro", true), ms);
  }

  function cancelRegistroRedirect() {
    state.thanksRedirect = false;
    clearTimeout(state.thanksRedirectTimer);
    state.thanksRedirectTimer = 0;
  }

  /** Detecta Netlify rápido (timeout corto) y deja lista la API */
  async function ensureCloudReady_(ms) {
    if (!navigator.onLine) {
      state.online = false;
      state.cloudApi = false;
      state.netlifyReady = false;
      return false;
    }
    state.online = true;
    if (state.cloudApi) return true;
    await detectNetlify(ms || 3500);
    return canUseCloudApi();
  }

  async function flushVinculoQueue() {
    return runVinculoFlushExclusive(async () => {
    state.online = navigator.onLine;
    if (!state.online) {
      updateNetworkUI();
      return {
        sent: 0,
        remain: loadVinculoQueue().length,
        reason: "offline",
        alreadyRegistered: false,
      };
    }
    if (!canUseCloudApi()) {
      const ready = await ensureCloudReady_(3000);
      if (!ready) {
        updateNetworkUI();
        return {
          sent: 0,
          remain: loadVinculoQueue().length,
          reason: "no-api",
          alreadyRegistered: false,
        };
      }
    }
    ensureSessionGate();
    const q = loadVinculoQueue();
    if (!q.length) {
      updateNetworkUI();
      return { sent: 0, remain: 0, reason: "empty", alreadyRegistered: false };
    }
    updateNetworkUI();
    const remain = [];
    let sent = 0;
    let lastError = "";
    let alreadyRegistered = false;
    let lastMessage = "";
    for (let i = 0; i < q.length; i++) {
      const item = q[i];
      const data = buildVinculoPayload(item);
      if (
        !data.dni ||
        !/^9\d{8}$/.test(data.celular) ||
        !isValidGrupoNum_(data.grupo) ||
        !isValidGrupoLic_(data.grupoLic) ||
        !data.supervisorGlobal
      ) {
        continue;
      }
      try {
        const body = {
          action: "registrarVinculo",
          authToken: data.authToken || authenticatedToken(),
          data,
        };
        const res = await fetch(API.sync, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 405) {
          state.cloudApi = false;
          state.netlifyReady = false;
          for (let j = i; j < q.length; j++) {
            remain.push(buildVinculoPayload(q[j]));
          }
          lastError = "API no disponible (405)";
          break;
        }
        const json = await res.json().catch(() => ({}));
        const nested = json && typeof json.data === "object" ? json.data : null;
        const nestedData =
          nested && typeof nested.data === "object" ? nested.data : nested;
        const ok = res.ok && (json.ok === true || nested?.ok === true);
        if (ok) {
          const msg = String(
            json.message ||
              nested?.message ||
              nestedData?.message ||
              ""
          );
          const wasRegistered = !!(
            json.alreadyRegistered === true ||
            nested?.alreadyRegistered === true ||
            nestedData?.alreadyRegistered === true ||
            /ya se tiene (este )?dni registrado/i.test(msg)
          );
          if (wasRegistered) alreadyRegistered = true;
          lastMessage = wasRegistered
            ? "Ya se tiene este DNI registrado"
            : "Fue guardado correctamente";
          markVinculoDone(
            data.dni,
            data.celular,
            data.supervisorGlobal,
            data.grupo,
            data.grupoLic
          );
          sent += 1;
        } else {
          lastError =
            json?.error ||
            nested?.message ||
            nested?.error ||
            json?.message ||
            "Error al guardar";
          if (
            json?.code === "UNAUTHORIZED" ||
            nested?.code === "UNAUTHORIZED"
          ) {
            lastError = "UNAUTHORIZED · revise API_TOKEN en Netlify";
          }
          remain.push({
            ...data,
            queuedAt: item.queuedAt || new Date().toISOString(),
          });
        }
      } catch (err) {
        lastError = String(err && err.message ? err.message : err);
        remain.push({
          ...data,
          queuedAt: item.queuedAt || new Date().toISOString(),
        });
      }
    }
      const mergedRemain = mergeVinculoQueueAfterFlush(q, remain);
      saveVinculoQueue(mergedRemain);
    updateNetworkUI();
      if (sent > 0 && mergedRemain.length === 0) {
      toast(
        alreadyRegistered
          ? "Ya se tiene este DNI registrado"
          : "Fue guardado correctamente"
      );
      } else if (sent > 0 && mergedRemain.length) {
        toast(`Enviado parcial · ${mergedRemain.length} pendiente(s)`);
    }
    return {
      sent,
        remain: mergedRemain.length,
      reason: lastError || "ok",
      alreadyRegistered,
      message: lastMessage,
    };
    });
  }

  function showVinculoThanks(identity, opts = {}) {
    // Cierra teclado: evita que la card quede “subida” con hueco abajo (iOS)
    try {
      const ae = document.activeElement;
      if (ae && typeof ae.blur === "function") ae.blur();
    } catch {
      /* ignore */
    }
    window.scrollTo(0, 0);

    stopCamera();
    hideAllScreens();
    const screen = $("#vinculoScreen");
    if (screen) {
      screen.hidden = false;
      screen.classList.add("is-thanks");
    }
    const form = $("#vinculoForm");
    const thanks = $("#vinculoThanks");
    if (form) form.hidden = false;
    if (thanks) {
      thanks.hidden = false;
      thanks.style.bottom = "0";
      thanks.style.transform = "translate3d(0,0,0)";
    }
    const dni = identity?.dni || state.identity?.dni || "";
    const nombre = identity?.nombre || state.identity?.nombre || "";
    if ($("#thanksDni")) $("#thanksDni").textContent = dni ? `DNI ${dni}` : "—";
    if ($("#thanksNombre")) $("#thanksNombre").textContent = nombre || "—";
    if ($("#vinHeroDni")) $("#vinHeroDni").textContent = dni ? `DNI ${dni}` : "";
    // Solo mostrar "ya registrado" si el servidor / reapertura lo indica (NO por solo guardar local)
    const status = $("#thanksSyncStatus");
    if (opts.alreadyRegistered) {
      setThanksSyncStatus("Ya se tiene este DNI registrado", "is-ok");
    } else if (status && !opts.keepStatus) {
      status.hidden = true;
      status.textContent = "";
      status.classList.remove("is-ok", "is-pending", "is-err");
    }
    hydrateIcons(screen);
    updateNetworkUI();

    const pinThanks_ = () => {
      window.scrollTo(0, 0);
      const card = $("#vinculoThanks");
      if (!card || card.hidden) return;
      card.style.bottom = "0";
      card.style.top = "auto";
      card.style.transform = "translate3d(0,0,0)";
    };
    requestAnimationFrame(pinThanks_);
    setTimeout(pinThanks_, 120);
    setTimeout(pinThanks_, 400);
  }

  function showVinculoScreen(identity) {
    if (getPage() !== "vinculo") {
      goTo("vinculo");
      return;
    }
    stopCamera();
    hideAllScreens();
    const screen = $("#vinculoScreen");
    if (screen) {
      screen.hidden = false;
      screen.classList.remove("is-thanks");
    }
    const form = $("#vinculoForm");
    const thanks = $("#vinculoThanks");
    if (form) form.hidden = false;
    if (thanks) thanks.hidden = true;
    const copy = screen?.querySelector(".vinculo-user div");
    if (copy) {
      const h1 = copy.querySelector("h1");
      if (h1) h1.textContent = "Vincular datos";
      copy.querySelectorAll(":scope > p:not(#vinHeroDni)").forEach((p) => p.remove());
    }
    hydrateIcons(screen);
    const dni = identity.dni || "";
    const nombre = identity.nombre || "";
    $("#vinDni").value = dni;
    $("#vinNombre").value = nombre;
    if ($("#vinDniShow")) $("#vinDniShow").textContent = dni || "—";
    if ($("#vinNombreShow")) $("#vinNombreShow").textContent = nombre || "—";
    const prev = vinculoDoneMap()[dni] || {};
    $("#vinEncargado").value = prev.supervisorGlobal || "";
    setVinGrupoLicUI(prev.grupoLic || "");
    setVinGrupoUI(prev.grupo || "");
    if ($("#vinHeroDni")) $("#vinHeroDni").textContent = dni ? `DNI ${dni}` : "";
    $("#vinCelular").value =
      identity.celular || prev.celular || "";
    updateNetworkUI();
    setTimeout(() => $("#vinCelular")?.focus(), 80);
  }

  function afterQrLogin(identity, authToken) {
    clearLoggedOutFlag();
    setIdentity(identity);
    saveAuthenticatedSession(identity, authToken || authenticatedToken());
    state.pendingIdentity = null;
    sessionStorage.setItem(SESSION_KEY, "1");
    bindSessionToIdentity(identity.dni);
    // Si entra otro supervisor, el listado anterior no se mezcla.
    loadSessionWorkers();
    seedSessionWorkersFromHarvest();
    toast(`Sesión · ${identity.nombre}`);
    // Vincular es opcional: abre Registro; el supervisor puede completar la ficha cuando quiera
    if (!SESSION_FORM_ENABLED) {
      stopCamera();
      try {
        goTo("registro", false, { loaderMsg: "Entrando a la app…" });
      } catch {
        hideAppLoader(true);
        location.href = new URL(ROUTES.registro, location.origin + "/").href;
      }
      return;
    }
    if (needsVinculo(identity)) {
      stopCamera();
      goTo("vinculo", false, { loaderMsg: "Entrando a la app…" });
      return;
    }
    showMainFlow();
    hideAppLoader();
  }

  async function startCamera() {
    // Detener stream previo sin restaurar overlay/botones de “idle”
    if (state.camTimer) {
      clearInterval(state.camTimer);
      state.camTimer = 0;
    }
    if (state.camStream) {
      state.camStream.getTracks().forEach((t) => t.stop());
      state.camStream = null;
    }
    const video = $("#qrVideo");
    const overlay = $("#qrOverlay");
    const frame = $("#qrFrame");
    if (!navigator.mediaDevices?.getUserMedia) {
      $("#secMsg").textContent = "Cámara no disponible en este dispositivo";
      toast("Se necesita cámara para escanear el carnet");
      if (overlay) overlay.hidden = false;
      if ($("#btnStartCam")) $("#btnStartCam").hidden = false;
      if ($("#btnStopCam")) $("#btnStopCam").hidden = true;
      return;
    }
    setQrLoading(true, "Activando cámara…");
    const startBtn = $("#btnStartCam");
    setBtnLoading(startBtn, true, "Activando cámara…");
    try {
      if (startBtn) startBtn.hidden = true;
      if ($("#btnStopCam")) $("#btnStopCam").hidden = false;
      $("#secMsg").textContent = "";
      state.camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      video.srcObject = state.camStream;
      await video.play();
      setQrLoading(false);
      if (overlay) overlay.hidden = true;
      if (frame) frame.classList.add("is-scanning");
      if ($("#btnStartCam")) $("#btnStartCam").hidden = true;
      if ($("#btnStopCam")) $("#btnStopCam").hidden = false;
      $("#secMsg").textContent = "Apunte al carnet QR";
      state.camTimer = window.setInterval(scanQrFrame, 280);
    } catch {
      $("#secMsg").textContent = "No se pudo abrir la cámara · revise permisos";
      toast("Active el permiso de cámara");
      setQrLoading(true, "Toque para activar la cámara");
      if ($("#btnStartCam")) $("#btnStartCam").hidden = false;
      if ($("#btnStopCam")) $("#btnStopCam").hidden = true;
      if (frame) frame.classList.remove("is-scanning");
    } finally {
      setBtnLoading(startBtn, false);
    }
  }

  function stopCamera() {
    if (state.camTimer) {
      clearInterval(state.camTimer);
      state.camTimer = 0;
    }
    if (state.camStream) {
      state.camStream.getTracks().forEach((t) => t.stop());
      state.camStream = null;
    }
    const video = $("#qrVideo");
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    $("#qrFrame")?.classList.remove("is-scanning");
    const overlay = $("#qrOverlay");
    const overlayTxt = $("#qrOverlayText");
    if (overlayTxt) overlayTxt.textContent = "Cámara detenida";
    if (overlay) {
      overlay.classList.remove("is-loading");
      overlay.hidden = false;
    }
    if ($("#btnStartCam")) $("#btnStartCam").hidden = false;
    if ($("#btnStopCam")) $("#btnStopCam").hidden = true;
  }

  function finishQrScan(ok) {
    if (state.scanProcessing) return;
    state.scanProcessing = true;
    if (state.camTimer) {
      clearInterval(state.camTimer);
      state.camTimer = 0;
    }
    playScanBeep(true);
    $("#secMsg").textContent = `DNI ${ok.dni} · ${ok.nombre}`;
    const box = $("#secFound");
    if (box) {
      box.hidden = false;
      box.classList.add("is-found");
      $("#secNombre").textContent = ok.nombre;
      $("#secCargo").textContent = ok.cargo || "SUPERVISOR DE COSECHA";
    }
    stopCamera();
    setQrLoading(true, "Carnet leído · verificando…");
    $("#qrFrame")?.classList.remove("is-scanning");
    window.setTimeout(() => {
      if (PASSWORD_REQUIRED) {
        state.scanProcessing = false;
        setQrLoading(false);
        showPasswordGate(ok);
        return;
      }
      showAppLoader("Entrando a la app…");
      try {
        afterQrLogin(ok, `qr:${ok.dni}`);
      } catch (err) {
        hideAppLoader(true);
        state.scanProcessing = false;
        toast("No se pudo entrar. Intente de nuevo");
      }
    }, 680);
  }

  function scanQrFrame() {
    const video = $("#qrVideo");
    const canvas = $("#qrCanvas");
    if (!video || !canvas || video.readyState < 2) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    if (typeof jsQR !== "function") return;
    const code = jsQR(img.data, img.width, img.height, {
      inversionAttempts: "attemptBoth",
    });
    if (!code?.data) return;
    const dni = extractDni(code.data);
    const now = Date.now();
    // Evita beep/mensaje en loop mientras el QR sigue en cámara
    if (
      dni &&
      dni === state.lastScanDni &&
      now - state.lastScanAt < 2500
    ) {
      return;
    }
    state.lastScanDni = dni || state.lastScanDni;
    state.lastScanAt = now;

    if (!dni) {
      playScanBeep(false);
      $("#secMsg").textContent = "QR leído · sin DNI válido";
      return;
    }
    const ok = validateSecurityDni(dni);
    if (!ok) {
      playScanBeep(false);
      return;
    }
    finishQrScan(ok);
  }

  function hydrateSupervisoresFromStorage() {
    try {
      const cached = localStorage.getItem(SUPERVISORES_KEY);
      if (!cached) return;
        const parsed = JSON.parse(cached);
        const next = {};
        Object.entries(parsed || {}).forEach(([k, v]) => {
          if (v && v.nombre) {
            next[String(k).replace(/\D/g, "")] = {
              nombre: String(v.nombre).toUpperCase(),
              cargo: String(v.cargo || "SUPERVISOR DE COSECHA").toUpperCase(),
              celular: String(v.celular || "").replace(/\D/g, ""),
              supervisorGlobal: String(
                v.supervisorGlobal || v.encargado || ""
              ).toUpperCase(),
            };
          }
        });
      if (Object.keys(next).length) state.supervisores = next;
    } catch {
      /* keep current */
    }
  }

  function applySupervisoresBundle(data) {
    const byDni = data?.byDni || data || {};
      const next = {};
      Object.entries(byDni).forEach(([dni, info]) => {
        const key = String(dni).replace(/\D/g, "");
        if (!key || !info) return;
        const nombre = String(info.nombre || info || "").toUpperCase();
        if (!nombre) return;
        next[key] = {
          nombre,
          cargo: String(info.cargo || "SUPERVISOR DE COSECHA").toUpperCase(),
          celular: String(info.celular || "").replace(/\D/g, ""),
          supervisorGlobal: String(
            info.supervisorGlobal || info.encargado || ""
          ).toUpperCase(),
        };
      });
      if (Object.keys(next).length) {
        state.supervisores = next;
        saveSupervisores();
      }
  }

  function hydratePersonasFromStorage() {
    try {
      const cached = localStorage.getItem(PERSONAS_KEY);
      if (!cached) return;
        const parsed = JSON.parse(cached);
        const next = {};
        Object.entries(parsed || {}).forEach(([k, v]) => {
          if (typeof v === "string") next[k] = { nombre: v, cargo: "", celular: "" };
          else if (v && v.nombre) {
            next[k] = {
              nombre: v.nombre,
              cargo: v.cargo || "",
              celular: v.celular || "",
            };
          }
        });
      if (Object.keys(next).length) state.personas = next;
    } catch {
      /* keep current */
    }
  }

  async function fetchLocalJson(url) {
    const path = url.startsWith("/") ? url : `/${url}`;
    const tries = [];
    if (isNativeApp() && navigator.onLine) {
      tries.push(`${CLOUD_ORIGIN}${path}?v=${APP_VERSION}&_=${Date.now()}`);
    }
    tries.push(assetUrl(path));
    tries.push(path);
    for (const target of tries) {
      try {
        const res = await fetch(target, {
          cache:
            isNativeApp() && target.startsWith(CLOUD_ORIGIN)
              ? "no-store"
              : catalogFetchCache(),
        });
        if (res.ok) return await res.json();
    } catch {
        /* offline: SW cache o localStorage ya cargados */
      }
    }
    return null;
  }

  async function loadSupervisores() {
    hydrateSupervisoresFromStorage();
    const data = await fetchLocalJson("/data/supervisores-cosecha.json");
    if (data) applySupervisoresBundle(data);

    const el = $("#trabCount");
    if (el) {
      const n = Object.keys(state.supervisores).length;
      el.textContent = n
        ? navigator.onLine
          ? "Listo para escanear · solo Supervisores de Cosecha"
          : "Listo para escanear · sin internet"
        : "Sin listado de supervisores";
    }
  }

  async function loadPersonas() {
    hydratePersonasFromStorage();

    const setCount = (extra = "") => {
      const el = $("#trabCount");
      if (!el) return;
      const nSup = Object.keys(state.supervisores || {}).length;
      if (nSup) {
        el.textContent = navigator.onLine
          ? "Listo para escanear · solo Supervisores de Cosecha"
          : "Listo para escanear · sin internet";
        return;
      }
      const n = Object.keys(state.personas).length;
      el.textContent = n
        ? `Listo para escanear${extra}`
        : `Preparando…${extra}`;
    };
    setCount("");

    const mergePersonaBundle = (data) => {
      const list = Array.isArray(data)
        ? data
        : Object.entries(data?.byDni || data || {});
      let added = 0;
      list.forEach((entry) => {
        const dni = Array.isArray(entry) ? entry[0] : entry.dni;
        const info = Array.isArray(entry) ? entry[1] : entry;
        const key = String(dni || "").replace(/\D/g, "");
        if (!key) return;
        const nombre = (info.nombre || info || "").toString().toUpperCase();
        const cargo = (info.cargo || "").toString().toUpperCase();
        const celular = String(info.celular || info.telefono || "").replace(
          /\D/g,
          ""
        );
        if (!nombre) return;
        state.personas[key] = {
          nombre,
          cargo,
          celular: celular || state.personas[key]?.celular || "",
        };
        added += 1;
      });
      return added;
    };

    const data = await fetchLocalJson("/data/trabajadores.json");
    if (data && mergePersonaBundle(data) > 0) {
          savePersonas();
          setCount(" · local");
    } else {
      setCount(Object.keys(state.personas).length ? " · local" : "");
    }
  }

  function parseISODate(iso) {
    const raw = String(iso || todayISO());
    const [y, m, d] = raw.split("-").map(Number);
    if (!y || !m || !d) {
      const now = new Date();
      return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate(), iso: todayISO() };
    }
    return { y, m, d, iso: raw };
  }

  const MESES_CORTO = [
    "ENE",
    "FEB",
    "MAR",
    "ABR",
    "MAY",
    "JUN",
    "JUL",
    "AGO",
    "SEP",
    "OCT",
    "NOV",
    "DIC",
  ];

  function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }

  function setRingProgress(el, day, monthDays) {
    if (!el) return;
    const circ = 2 * Math.PI * 30; // r=30
    const pct = Math.max(0.08, Math.min(1, day / monthDays));
    el.style.strokeDasharray = String(circ);
    el.style.strokeDashoffset = String(circ * (1 - pct));
  }

  function renderDateWidgets(iso) {
    const { y, m, d } = parseISODate(iso || state.session.fecha || todayISO());
    const mon = `${MESES_CORTO[m - 1] || ""} ${y}`;
    const dayStr = String(d);
    const dim = daysInMonth(y, m);

    const railDay = $("#railDay");
    const railMon = $("#railMon");
    if (railDay) railDay.textContent = dayStr;
    if (railMon) railMon.textContent = mon;
    setRingProgress($("#railRingProg"), d, dim);

    const sesDay = $("#sesDay");
    const sesMon = $("#sesMon");
    if (sesDay) sesDay.textContent = dayStr;
    if (sesMon) sesMon.textContent = mon;
    setRingProgress($("#sesRingProg"), d, dim);

    const ses = $("#sesFecha");
    if (ses && ses.value !== `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`) {
      ses.value = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    const rail = $("#railFechaInput");
    if (rail) rail.value = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function openDatePicker(inputId) {
    const el = $(inputId);
    if (!el) return;
    el.value = state.session.fecha || todayISO();
    try {
      if (typeof el.showPicker === "function") {
        el.showPicker();
        return;
      }
    } catch {
      /* fall through */
    }
    el.focus();
    el.click();
  }

  function applySessionFecha(iso) {
    const next = String(iso || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
    state.session.fecha = next;
    const ses = $("#sesFecha");
    if (ses) ses.value = next;
    saveStore();
    renderDateWidgets(next);
    renderSessionBanner();
    toast(`Fecha ${next.split("-").reverse().join("/")}`);
  }

  function fillSessionForm() {
    const s = state.session;
    $("#sesFundo").value = s.fundo || "";
    $("#sesSupDni").value = s.supervisorDni || "";
    $("#sesSupNombre").value = s.supervisorNombre || "";
    $("#sesJavDni").value = s.javeroDni || "";
    $("#sesJavNombre").value = s.javeroNombre || "";
    $("#sesFecha").value = s.fecha || todayISO();
    renderDateWidgets(s.fecha || todayISO());
  }

  function readSessionForm() {
    return {
      ready: true,
      fundo: $("#sesFundo").value.trim(),
      supervisorDni: $("#sesSupDni").value.replace(/\D/g, ""),
      supervisorNombre: $("#sesSupNombre").value.trim().toUpperCase(),
      javeroDni: $("#sesJavDni").value.replace(/\D/g, ""),
      javeroNombre: $("#sesJavNombre").value.trim().toUpperCase(),
      fecha: $("#sesFecha").value || state.session.fecha || todayISO(),
    };
  }

  function renderSessionBanner() {
    const s = state.session;
    const fundo = $("#sbFundo");
    const sup = $("#sbSup");
    if (fundo) fundo.textContent = s.fundo || "—";
    if (sup) {
      const name = s.supervisorNombre || "Supervisor";
      sup.textContent = name.length > 18 ? name.slice(0, 16) + "…" : name;
      sup.title = `${s.supervisorNombre || ""} · ${s.supervisorDni || ""}`;
    }
    renderDateWidgets(s.fecha || todayISO());
  }

  function harvestTotal() {
    return (state.harvest.workers || []).reduce(
      (sum, w) => sum + num(w.manana) + num(w.tarde),
      0
    );
  }

  function harvestTypeShort(value) {
    return (
      HARVEST_TYPES.find((item) => item.key === value)?.short ||
      harvestTypeLabel(value)
    );
  }

  function normalizeHarvestType(value) {
    return HARVEST_TYPES.some((item) => item.key === value)
      ? value
      : HARVEST_TYPES[0].key;
  }

  function normalizeHarvestWorker(worker) {
    return {
      id: worker?.id || uid(),
      dni: String(worker?.dni || "").replace(/\D/g, ""),
      nombre: String(worker?.nombre || "")
        .trim()
        .toUpperCase(),
      manana: Math.max(0, num(worker?.manana)),
      tarde: Math.max(0, num(worker?.tarde)),
      manual: !!worker?.manual,
    };
  }

  function cloneHarvestTypeDraft(draft) {
    const src = draft && typeof draft === "object" ? draft : {};
    return {
      lote: String(src.lote || ""),
      codLote: String(src.codLote || ""),
      modulo: String(src.modulo || ""),
      turno: String(src.turno || ""),
      variedad: String(src.variedad || ""),
      workers: Array.isArray(src.workers)
        ? src.workers.map(normalizeHarvestWorker)
        : [],
    };
  }

  function harvestTypeBucket(tipo) {
    const key = normalizeHarvestType(tipo);
    if (!state.harvest.byType || typeof state.harvest.byType !== "object") {
      state.harvest.byType = emptyHarvestByType();
    }
    if (!state.harvest.byType[key]) {
      state.harvest.byType[key] = emptyHarvestTypeDraft();
    }
    const bucket = state.harvest.byType[key];
    ["lote", "codLote", "modulo", "turno", "variedad"].forEach((field) => {
      if (typeof bucket[field] !== "string") bucket[field] = "";
    });
    if (!Array.isArray(bucket.workers)) bucket.workers = [];
    return bucket;
  }

  function syncCurrentHarvestDraft() {
    const key = normalizeHarvestType(state.harvest.tipo);
    if (!state.harvest.byType || typeof state.harvest.byType !== "object") {
      state.harvest.byType = emptyHarvestByType();
    }
    state.harvest.byType[key] = cloneHarvestTypeDraft({
      lote: state.harvest.lote,
      codLote: state.harvest.codLote,
      modulo: state.harvest.modulo,
      turno: state.harvest.turno,
      variedad: state.harvest.variedad,
      workers: state.harvest.workers,
    });
    state.harvest.workers = state.harvest.byType[key].workers;
  }

  function attachCurrentHarvestDraft() {
    state.harvest.tipo = normalizeHarvestType(state.harvest.tipo);
    const bucket = harvestTypeBucket(state.harvest.tipo);
    state.harvest.lote = bucket.lote;
    state.harvest.codLote = bucket.codLote;
    state.harvest.modulo = bucket.modulo;
    state.harvest.turno = bucket.turno;
    state.harvest.variedad = bucket.variedad;
    state.harvest.workers = bucket.workers;
  }

  function hydrateHarvestByType(parsed) {
    const byType = emptyHarvestByType();
    const source =
      parsed?.byType && typeof parsed.byType === "object" ? parsed.byType : {};
    const hasTypedShape = HARVEST_TYPES.some(
      (item) => source[item.key] && typeof source[item.key] === "object"
    );
    HARVEST_TYPES.forEach((item) => {
      byType[item.key] = cloneHarvestTypeDraft(source[item.key]);
    });
    const activeTipo = normalizeHarvestType(parsed?.tipo);
    const legacy = Array.isArray(parsed?.workers) ? parsed.workers : [];
    const hasTypedWorkers = HARVEST_TYPES.some(
      (item) => byType[item.key].workers.length
    );
    if (legacy.length && !hasTypedWorkers) {
      byType[activeTipo].workers = legacy.map(normalizeHarvestWorker);
    }
    // Solo migrar lote del formato viejo al tipo activo. Nunca copiarlo a los otros.
    if (!hasTypedShape && parsed?.lote) {
      byType[activeTipo].lote = String(parsed.lote || "");
      byType[activeTipo].codLote = String(parsed.codLote || "");
      byType[activeTipo].modulo = String(parsed.modulo || "");
      byType[activeTipo].turno = String(parsed.turno || "");
      byType[activeTipo].variedad = String(parsed.variedad || "");
    }
    state.harvest.tipo = activeTipo;
    state.harvest.byType = byType;
    attachCurrentHarvestDraft();
  }

  function clearHarvestWorkerForm() {
    if ($("#harvestWorkerDni")) $("#harvestWorkerDni").value = "";
    if ($("#harvestWorkerName")) $("#harvestWorkerName").value = "";
    if ($("#harvestWorkerMsg")) $("#harvestWorkerMsg").textContent = "";
  }

  function switchHarvestType(tipo) {
    const next = normalizeHarvestType(tipo);
    if (isHarvestTypeLocked(next) && normalizeHarvestType(state.harvest.tipo) !== next) {
      // Se puede mirar el checklist, pero no editar de nuevo ese tipo hoy
      toast(
        `${harvestTypeShort(next)} ya está guardada hoy · elija otra opción`
      );
    }
    if (state.harvest.tipo === next) {
      attachCurrentHarvestDraft();
      renderHarvest();
      return;
    }
    syncCurrentHarvestDraft();
    state.harvest.tipo = next;
    attachCurrentHarvestDraft();
    clearHarvestWorkerForm();
    saveHarvest();
    renderHarvest();
  }

  function resetHarvestTypeAfterSave(tipo) {
    const key = normalizeHarvestType(tipo);
    if (!state.harvest.byType || typeof state.harvest.byType !== "object") {
      state.harvest.byType = emptyHarvestByType();
    }
    // Limpia SOLO este tipo; Suma/Resta/Descarte de los demás se conservan
    state.harvest.byType[key] = emptyHarvestTypeDraft();
    if (state.previewDraftByType && typeof state.previewDraftByType === "object") {
      delete state.previewDraftByType[key];
    }
    if (normalizeHarvestType(state.harvest.tipo) === key) {
      attachCurrentHarvestDraft();
    }
    clearHarvestWorkerForm();
    document.querySelectorAll("[data-harvest-field]").forEach((input) => {
      input.value = "";
    });
    // Limpiar también lote visible del tipo guardado
    if (normalizeHarvestType(state.harvest.tipo) === key) {
      state.harvest.lote = "";
      state.harvest.codLote = "";
      state.harvest.modulo = "";
      state.harvest.turno = "";
      state.harvest.variedad = "";
      state.harvest.workers = [];
    }
    saveHarvest();
    renderHarvest();
  }

  function harvestOwnerMatches(item) {
    const identity = state.identity || getIdentity() || {};
    const supervisorDni = String(identity.dni || "").replace(/\D/g, "");
    const owner = String(item?.supervisorDni || "").replace(/\D/g, "");
    return !owner || !supervisorDni || owner === supervisorDni;
  }

  /** Clave única: 1 tabla por día + supervisor + tipo (Suma/Resta/Descarte). */
  function harvestDayTypeKey(snapshot) {
    if (!snapshot) return "";
    const fecha = String(snapshot.fecha || todayISO());
    const dni = String(
      snapshot.supervisorDni || state.identity?.dni || ""
    ).replace(/\D/g, "");
    const tipo = normalizeHarvestType(snapshot.tipo);
    return `${fecha}|${dni}|${tipo}`;
  }

  function todayReadySnapshots() {
    const history = loadHarvestHistory().filter(
      (item) => item.fecha === todayISO() && harvestOwnerMatches(item)
    );
    const latest = new Map();
    history.forEach((item) => {
      const tipo = normalizeHarvestType(item.tipo);
      if (!latest.has(tipo)) latest.set(tipo, item);
    });
    return HARVEST_TYPES.map((item) => latest.get(item.key)).filter(Boolean);
  }

  /** Ya guardada hoy → bloqueada (no se vuelve a llenar). */
  function isHarvestTypeLocked(tipo) {
    const key = normalizeHarvestType(tipo);
    return todayReadySnapshots().some(
      (snap) => normalizeHarvestType(snap.tipo) === key
    );
  }

  function setHarvestEditorLocked(locked) {
    const screen = $("#harvestScreen") || $("#conteoPanel");
    if (screen) screen.classList.toggle("is-type-locked", !!locked);
    const saveBtn = $("#btnHarvestSave");
    if (saveBtn) {
      saveBtn.disabled = !!locked;
      saveBtn.setAttribute("aria-disabled", locked ? "true" : "false");
    }
    const loteBtn = $("#btnHarvestLote");
    if (loteBtn) loteBtn.disabled = !!locked;
    $$("#harvestWorkerForm input, #harvestWorkerForm button").forEach((el) => {
      el.disabled = !!locked;
    });
    $$("#harvestWorkers [data-harvest-field]").forEach((el) => {
      el.disabled = !!locked;
    });
    const lockNote = $("#harvestTypeLockNote");
    if (lockNote) {
      if (locked) {
        lockNote.hidden = false;
        lockNote.textContent = `${harvestTypeShort(
          state.harvest.tipo
        )} ya guardada hoy · bloqueada. Siga con otra opción.`;
      } else {
        lockNote.hidden = true;
        lockNote.textContent = "";
      }
    }
  }

  function loadHarvestSentMap() {
    try {
      const parsed = JSON.parse(localStorage.getItem(HARVEST_SENT_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function harvestSentKey(snapshot) {
    if (!snapshot) return "";
    const dni = String(snapshot.supervisorDni || state.identity?.dni || "").replace(
      /\D/g,
      ""
    );
    const tipo = normalizeHarvestType(snapshot.tipo);
    const fecha = String(snapshot.fecha || todayISO());
    return `${fecha}|${dni}|${tipo}`;
  }

  function isHarvestSnapshotSent(snapshot) {
    if (!snapshot) return false;
    const map = loadHarvestSentMap();
    const key = harvestSentKey(snapshot);
    return !!(map[snapshot.id] || (key && map[key]));
  }

  function markHarvestSnapshotSent(snapshot) {
    if (!snapshot?.id) return;
    const map = loadHarvestSentMap();
    map[snapshot.id] = new Date().toISOString();
    const key = harvestSentKey(snapshot);
    if (key) map[key] = map[snapshot.id];
    try {
      localStorage.setItem(HARVEST_SENT_KEY, JSON.stringify(map));
    } catch {
      /* ignore */
    }
    renderHarvestDayChecklist();
    renderExportPreviewDayStatus();
    renderExportPreviewTypes(state.activeExportSnapshot);
  }

  /** Estado del día: Suma / Resta / Descarte — tengo o no, bloqueada, enviada. */
  function harvestDayTypeStatus() {
    const ready = todayReadySnapshots();
    const byTipo = new Map(
      ready.map((snap) => [normalizeHarvestType(snap.tipo), snap])
    );
    return HARVEST_TYPES.map((item) => {
      const snapshot = byTipo.get(item.key) || null;
      const saved = !!snapshot;
      const sent = saved && isHarvestSnapshotSent(snapshot);
      const locked = saved;
      return {
        key: item.key,
        short: item.short,
        label: item.label,
        saved,
        sent,
        locked,
        snapshot,
      };
    });
  }

  function harvestMissingTypesToday() {
    return harvestDayTypeStatus().filter((item) => !item.saved);
  }

  function harvestUnsentTypesToday() {
    return harvestDayTypeStatus().filter((item) => item.saved && !item.sent);
  }

  function harvestDayProgressMessage() {
    const status = harvestDayTypeStatus();
    const missing = status.filter((s) => !s.saved).map((s) => s.short);
    const unsent = status.filter((s) => s.saved && !s.sent).map((s) => s.short);
    if (!missing.length && !unsent.length) {
      return "Listo: Suma, Resta y Descarte guardados y en Drive.";
    }
    const parts = [];
    if (missing.length) parts.push(`Pendiente: ${missing.join(", ")}`);
    if (unsent.length) parts.push(`Falta subir a Drive: ${unsent.join(", ")}`);
    return parts.join(" · ");
  }

  function renderHarvestDayChecklist() {
    const root = $("#harvestDayChecklist");
    if (!root) return;
    const status = harvestDayTypeStatus();
    root.innerHTML = status
      .map((item) => {
        const cls = item.sent
          ? "is-sent"
          : item.locked
            ? "is-locked"
            : item.saved
              ? "is-saved"
              : "is-missing";
        const label = item.sent
          ? "En Drive"
          : item.locked
            ? "Bloqueada · ver"
            : item.saved
              ? "Guardada · ver"
              : "Sin registro";
        const canOpen =
          !!item.snapshot ||
          !!state.previewDraftByType?.[item.key] ||
          harvestDraftHasData(harvestTypeBucket(item.key));
        return `<button type="button" class="hdc-item ${cls}${
          canOpen ? " is-clickable" : ""
        }" data-harvest-check="${escapeHtml(item.key)}" aria-label="Ver ${escapeHtml(
          item.short
        )}">
          <strong>${escapeHtml(item.short)}</strong>
          <small>${label}</small>
        </button>`;
      })
      .join("");
  }

  /**
   * Abre el modal de Suma/Resta/Descarte SIN cambiar el formulario activo.
   * Así no se pierde ni se mezcla la data del tipo que se está llenando.
   */
  function openHarvestChecklistPreview(tipo) {
    const key = normalizeHarvestType(tipo);
    // Persistir lo que hay en pantalla, pero no cambiar state.harvest.tipo
    try {
      syncCurrentHarvestDraft();
      saveHarvest();
    } catch {
      /* ignore */
    }

    const snapshot =
      previewSnapshotsMap(state.activeExportSnapshot)[key] ||
      snapshotFromTypeDraft(key) ||
      null;

    if (!snapshot) {
      toast(
        `Sin registro de ${harvestTypeShort(key)} · complete y pulse Guardar`
      );
      return;
    }

    if (!isSnapshotSaved(snapshot)) rememberPreviewDraft(snapshot);
    openExportPreview(snapshot, { saved: isSnapshotSaved(snapshot) });
  }

  function renderExportPreviewDayStatus() {
    const el = $("#exportPreviewDayStatus");
    if (!el) return;
    el.textContent = harvestDayProgressMessage();
  }

  function focusNextMissingHarvestType() {
    const missing = harvestMissingTypesToday();
    if (!missing.length) return;
    const next = missing[0].key;
    if (normalizeHarvestType(state.harvest.tipo) !== next) {
      switchHarvestType(next);
    }
  }

  /** Registros de hoy listos para compartir o descargar (guardados + borrador activo). */
  function availableExportSnapshots() {
    const map = previewSnapshotsMap(state.activeExportSnapshot);
    const seen = new Set();
    const out = [];
    HARVEST_TYPES.forEach((item) => {
      const snap = map[item.key];
      if (!snap?.id || seen.has(snap.id)) return;
      seen.add(snap.id);
      out.push(snap);
    });
    return out;
  }

  function harvestTypeLabel(value) {
    return (
      HARVEST_TYPES.find((item) => item.key === value)?.label ||
      HARVEST_TYPES[0].label
    );
  }

  function harvestTypeObservacion(value) {
    return (
      HARVEST_TYPES.find((item) => item.key === value)?.observacion ||
      HARVEST_TYPES[0].observacion
    );
  }

  function renderHarvestType() {
    const value = state.harvest.tipo || HARVEST_TYPES[0].key;
    const input = $("#harvestType");
    const label = $("#harvestTypeLabel");
    if (input) input.value = value;
    if (label) {
      label.textContent = harvestTypeLabel(value);
      label.classList.remove("ph");
    }
  }

  function populateHarvestLotes() {
    const input = $("#harvestLote");
    const label = $("#harvestLoteLabel");
    const selected = String(state.harvest.lote || "");
    if (input) input.value = selected;
    if (!label) return;
    if (selected) {
      const lote = findLote(selected);
      label.textContent = lote
        ? `Lote ${lote.lote} · ${lote.modulo || "—"} · T${lote.turno || "—"}`
        : `Lote ${selected}`;
      label.classList.remove("ph");
    } else {
      label.textContent = "Seleccionar lote";
      label.classList.add("ph");
    }
  }

  function renderHarvestWorkers() {
    const root = $("#harvestWorkers");
    if (!root) return;
    const workers = state.harvest.workers || [];
    if (!workers.length) {
      root.innerHTML = `<div class="harvest-empty">${ico("users")}Agregue trabajadores para ${harvestTypeShort(state.harvest.tipo)}.</div>`;
    } else {
      root.innerHTML = workers
        .map((w, index) => {
          const manana = num(w.manana);
          const tarde = num(w.tarde);
          const total = manana + tarde;
          return `
            <article class="harvest-worker-row" data-worker-id="${w.id}">
              <button type="button" class="harvest-worker-person" data-worker-id-open aria-label="Ver nombre completo">
                <strong>${index + 1}. ${escapeHtml(w.nombre || "SIN NOMBRE")}</strong>
                <span>DNI ${escapeHtml(w.dni)}</span>
              </button>
              <input data-harvest-field="manana" type="number" inputmode="numeric" min="0" step="1" placeholder="00"${manana > 0 ? ` value="${manana}"` : ""} aria-label="Jarras mañana de ${escapeHtml(w.nombre)}" />
              <input data-harvest-field="tarde" type="number" inputmode="numeric" min="0" step="1" placeholder="00"${tarde > 0 ? ` value="${tarde}"` : ""} aria-label="Jarras tarde de ${escapeHtml(w.nombre)}" />
              <strong class="harvest-worker-total">${fmt(total)}</strong>
              <button type="button" class="harvest-worker-remove" data-harvest-remove aria-label="Quitar trabajador">${ico("x")}</button>
            </article>`;
        })
        .join("");
    }
    if ($("#harvestWorkerCount")) {
      $("#harvestWorkerCount").textContent = String(workers.length);
    }
    if ($("#harvestGrandTotal")) {
      $("#harvestGrandTotal").textContent = fmt(harvestTotal());
    }
  }

  function renderHarvest() {
    const identity = state.identity || getIdentity() || {};
    paintGreeting("#harvestSupervisor", identity);
    if ($("#harvestDate")) {
      $("#harvestDate").textContent = new Date(
        `${state.harvest.fecha || todayISO()}T12:00:00`
      ).toLocaleDateString("es-PE", {
        weekday: "long",
        day: "2-digit",
        month: "long",
      });
    }
    populateHarvestLotes();
    renderHarvestType();
    if ($("#harvestModulo")) $("#harvestModulo").textContent = state.harvest.modulo || "—";
    if ($("#harvestTurno")) $("#harvestTurno").textContent = state.harvest.turno || "—";
    if ($("#harvestVariedad")) $("#harvestVariedad").textContent = state.harvest.variedad || "—";
    renderHarvestWorkers();
    renderHarvestDayChecklist();
    setHarvestEditorLocked(isHarvestTypeLocked(state.harvest.tipo));
    hydrateIcons($("#harvestScreen"));
    updateNetworkUI();
  }

  function openProfileModal() {
    const identity = state.identity || getIdentity() || {};
    const sheet = $("#profileModal");
    if (!sheet) return;
    const nombre = String(identityFullName(identity) || "Supervisor").trim().toUpperCase();
    const cargo =
      String(identity.cargo || "").trim() ||
      lookupSupervisor(identity.dni)?.cargo ||
      "SUPERVISOR DE COSECHA";
    if ($("#profileModalTitle")) {
      $("#profileModalTitle").textContent = greetingName(nombre, "Supervisor");
    }
    if ($("#profileDni")) {
      $("#profileDni").textContent = identity.dni
        ? String(identity.dni).replace(/\D/g, "")
        : "—";
    }
    if ($("#profileCargo")) {
      $("#profileCargo").textContent = String(cargo).toUpperCase();
    }
    if ($("#profileNombre")) {
      $("#profileNombre").textContent = nombre || "—";
    }
    sheet.hidden = false;
    sheet.removeAttribute("hidden");
    sheet.style.display = "flex";
    hydrateIcons(sheet);
    syncProfileAppTools();
    refreshTopnav();
  }

  function closeProfileModal() {
    const sheet = $("#profileModal");
    if (!sheet) return;
    sheet.hidden = true;
    sheet.setAttribute("hidden", "");
    sheet.style.display = "none";
    refreshTopnav();
    resetViewportLayout();
  }

  /** La navegación superior solo existe con sesión iniciada: nunca en el escaneo. */
  function syncTopnavVisibility() {
    const bar = $("#appTopnav");
    if (!bar) return;
    if (getPage() === "scan") {
      bar.hidden = true;
      bar.setAttribute("hidden", "");
      return;
    }
    const signedIn =
      !!(state.identity?.dni || getIdentity()?.dni) ||
      document.documentElement.classList.contains("has-session");
    bar.hidden = !signedIn;
    if (signedIn) bar.removeAttribute("hidden");
    else bar.setAttribute("hidden", "");
  }

  function markTabPressed(tab) {
    const bar = $("#appTopnav");
    if (!bar || !tab) return;
    $$("[data-tab]", bar).forEach((btn) => {
      const on = btn.dataset.tab === tab;
      btn.classList.toggle("is-active", on);
      btn.classList.toggle("active", on);
    });
  }

  function persistDraftBeforeNav() {
    persistAllLocalDrafts();
  }

  /** Lee inputs visibles de guías por si el SO cerró sin blur. */
  function syncGuidesFromDom() {
    if (!state.guias?.length) return;
    $$("#cards .guides-card").forEach((article) => {
      const guia = findGuia(article.dataset.id);
      if (!guia) return;
      const ng = article.querySelector('[data-field="numeroGuia"]');
      if (ng) guia.numeroGuia = normalizeNumeroGuia(ng.value);
      const hr = article.querySelector('[data-field="horaRecojo"]');
      if (hr) guia.horaRecojo = String(hr.value || "").trim();
      const ja = article.querySelector('[data-field="jarras"]');
      const jb = article.querySelector('[data-field="jabas"]');
      if (ja) guia.jarras = num(ja.value);
      if (jb) guia.jabas = num(jb.value);
    });
  }

  /** Lee jarras mañana/tarde visibles del registro de cosecha. */
  function syncHarvestWorkersFromDom() {
    if (!state.harvest?.workers?.length) return;
    $$("#harvestWorkers [data-worker-id]").forEach((row) => {
      const worker = state.harvest.workers.find(
        (w) => w.id === row.dataset.workerId
      );
      if (!worker) return;
      row.querySelectorAll("[data-harvest-field]").forEach((input) => {
        const field = input.dataset.harvestField;
        if (!field) return;
        const raw = String(input.value || "").trim();
        worker[field] = raw === "" ? 0 : Math.max(0, num(raw));
      });
    });
  }

  /**
   * Guarda todo en el celular (síncrono).
   * Se usa al cerrar/minimizar la app y antes de cambiar de pantalla.
   */
  function persistAllLocalDrafts() {
    try {
      syncGuidesFromDom();
      if (getPage() === "registro") {
        syncHarvestWorkersFromDom();
        if (state.harvest) saveHarvest();
      }
      saveStore();
      if (typeof saveSessionManualPersonas === "function") {
        saveSessionManualPersonas();
      }
    } catch {
      /* no bloquear cierre de la app */
    }
  }

  function setupLifecyclePersist() {
    const flush = () => persistAllLocalDrafts();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);

    const App = window.Capacitor?.Plugins?.App;
    if (App?.addListener) {
      App.addListener("pause", flush).catch(() => {});
      App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) flush();
      }).catch(() => {});
    }

    setInterval(() => {
      if (document.visibilityState === "hidden") return;
      flush();
    }, 30000);
  }

  function currentTab() {
    const profile = $("#profileModal");
    if (profile && !profile.hidden) return "perfil";
    const help = $("#helpSheet");
    if (help && !help.hidden) return "ayuda";
    const history = $("#historySheet");
    if (history && !history.hidden) return "excel";
    const screen = $("#harvestScreen");
    if (screen?.dataset?.panel === "guias") return "guias";
    const guides = $("#guidesSheet");
    if (guides?.classList?.contains("is-active")) return "guias";
    if (getPage() === "registro") return "registro";
    if (getPage() === "vinculo") return "vincular";
    return "";
  }

  function refreshTopnav() {
    syncTopnavVisibility();
    const bar = $("#appTopnav");
    if (!bar) return;
    const active = currentTab();
    $$("[data-tab]", bar).forEach((btn) => {
      const isActive = btn.dataset.tab === active;
      btn.classList.toggle("is-active", isActive);
      btn.classList.toggle("active", isActive);
      if (isActive) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
  }

  /** Cambia Conteo ↔ Guías sin reconstruir DOM (caché local, sin pestañeo). */
  function applyGuidesPanel(open) {
    const screen = $("#harvestScreen");
    const sheet = $("#guidesSheet");
    const conteo = $("#conteoPanel") || $(".harvest-scroll");
    const harvestDate = $("#harvestDate");
    const harvestHeadSmall = $(".harvest-head .harvest-user small");

    if (screen) screen.dataset.panel = open ? "guias" : "conteo";
    if (sheet) {
      sheet.classList.toggle("is-active", !!open);
      sheet.setAttribute("aria-hidden", open ? "false" : "true");
      sheet.hidden = false;
    }
    if (conteo) {
      conteo.classList.toggle("is-active", !open);
      conteo.hidden = false;
    }
    if (harvestDate) {
      harvestDate.textContent = open ? "Guía interna de cosecha" : "Registro del día";
    }
    if (harvestHeadSmall) {
      harvestHeadSmall.textContent = open
        ? "QBERRIES · GUÍAS"
        : "QBERRIES · SUPERVISORES";
    }
  }

  function closeGuidesSheet() {
    applyGuidesPanel(false);
    closeGuidesSummary();
    refreshTopnav();
  }

  function ensureGuidesSession() {
    if (!hasQrLogin()) return;
    const id = state.identity || getIdentity();
    if (!id?.dni) return;
    bindSessionToIdentity(id.dni);
    state.session.fundo = normalizeFundo(state.session.fundo || FUNDO_DEFAULT);
    state.session.fecha = todayISO();
    if (!state.session.supervisorDni) {
      state.session.supervisorDni = id.dni;
      state.session.supervisorNombre = String(
        identityFullName(id) || id.nombre || ""
      )
        .trim()
        .toUpperCase();
    }
    state.session.ready = true;
    saveStore();
  }

  function currentFundo() {
    return normalizeFundo(state.session.fundo || FUNDO_DEFAULT);
  }

  function setGuidesFundo(value) {
    state.session.fundo = normalizeFundo(value);
    saveStore();
    const label = $("#guidesFundoLabel");
    if (label) label.textContent = state.session.fundo;
  }

  function currentGuidesLic() {
    return normGuidesLic_(state.session.grupoLic || "");
  }

  function setGuidesLic(value) {
    state.session.grupoLic = normGuidesLic_(value);
    saveStore();
    renderGuidesLicLabel();
  }

  function renderGuidesLicLabel() {
    const label = $("#guidesLicLabel");
    if (!label) return;
    const txt = displayGuidesLic_(state.session.grupoLic);
    if (txt) {
      label.textContent = txt;
      label.classList.remove("ph");
    } else {
      label.textContent = "Elegir";
      label.classList.add("ph");
    }
  }

  function renderGuidesMeta() {
    const s = state.session;
    const fechaTxt = (s.fecha || todayISO()).split("-").reverse().join("/");
    const fundo = currentFundo();
    const label = $("#guidesFundoLabel");
    if (label) label.textContent = fundo;
    renderGuidesLicLabel();
    if ($("#guidesFecha")) $("#guidesFecha").textContent = fechaTxt;
    if ($("#guidesSupervisor")) {
      const nom = s.supervisorNombre || "Supervisor";
      const dni = s.supervisorDni ? ` · ${s.supervisorDni}` : "";
      $("#guidesSupervisor").textContent = `${nom}${dni}`;
    }
  }

  /** Prepara Guías en segundo plano (queda en caché del DOM). */
  function warmGuidesPanel() {
    if (getPage() !== "registro" || !hasQrLogin()) return;
    if (!$("#guidesSheet")) return;
    ensureGuidesSession();
    renderGuidesMeta();
    if (!state.guias.length) state.guias.push(emptyGuia());
    const cards = $("#cards");
    const needsPaint =
      !cards ||
      !cards.children.length ||
      !state._guidesWarmed;
    if (needsPaint) {
      renderCards();
      updateKpis();
      updateMeta();
      hydrateIcons($("#guidesSheet"));
      state._guidesWarmed = true;
    } else {
      updateKpis();
      renderGuidesMeta();
    }
  }

  function openGuidesSheet() {
    if (getPage() !== "registro") {
      persistDraftBeforeNav();
      beginNavigation("/registro/index.html?tab=guias", false, { tabSwitch: true });
      return;
    }
    closeHarvestHistory();
    const help = $("#helpSheet");
    if (help) help.hidden = true;
    closeProfileModal();
    const sheet = $("#guidesSheet");
    if (!sheet) return;

    markTabPressed("guias");
    applyGuidesPanel(true);
    refreshTopnav();

    // Contenido ya en caché: solo refresca meta/kpis; no re-hidrata todo
    warmGuidesPanel();
  }

  function guiaHasData(guia) {
    return !!(
      normalizeNumeroGuia(guia?.numeroGuia) ||
      String(guia?.lote || "").trim() ||
      num(guia?.jarras) > 0 ||
      num(guia?.jabas) > 0
    );
  }

  function openGuidesSummary() {
    const modal = $("#guidesSummaryModal");
    const card = $("#guidesSummaryCard");
    if (!modal || !card) return;
    renderGuidesSummaryCard();
    modal.hidden = false;
    hydrateIcons(modal);
  }

  function closeGuidesSummary() {
    const modal = $("#guidesSummaryModal");
    if (modal) modal.hidden = true;
  }

  /** Id estable cola nube: 1 pendiente por supervisor + día + fundo. */
  function guiasCloudQueueId(fecha, dni, fundo) {
    const day = String(fecha || todayISO()).trim();
    const dig = String(dni || "").replace(/\D/g, "") || "x";
    const f = normalizeFundo(fundo)
      .toLowerCase()
      .replace(/\s+/g, "-");
    return `guias-${day}-${dig}-${f}`;
  }

  function buildGuiasSyncPayload() {
    const identity = state.identity || getIdentity();
    const fecha = state.session.fecha || todayISO();
    const supervisorDni =
      state.session.supervisorDni || identity?.dni || "";
    const supervisorNombre =
      state.session.supervisorNombre || identity?.nombre || "";
    const fundo = currentFundo();
    const grupoLic = currentGuidesLic();
    const t0 = totals();
    const id = guiasCloudQueueId(fecha, supervisorDni, fundo);
    const savedAt = new Date().toISOString();
    return {
      id,
      /** Identifica este envío (anti doble-POST); distinto si vuelve a guardar */
      sendId: `${id}|${savedAt}|${t0.jarras}|${t0.jabas}|${t0.guias}`,
      savedAt,
      horaGuardado: savedAt,
      fecha,
      fundo,
      grupoLic,
      securityCode: identity?.dni || supervisorDni || "",
      supervisorDni,
      supervisorNombre,
      operator: identity,
      session: {
        fecha,
        fundo,
        grupoLic,
        supervisorDni,
        supervisorNombre,
      },
      guias: (state.guias || []).map((g) => ({
        id: g.id,
        numeroGuia: g.numeroGuia,
        lote: g.lote,
        modulo: g.modulo,
        turno: g.turno,
        variedad: g.variedad,
        jarras: g.jarras,
        jabas: g.jabas,
        horaRecojo: g.horaRecojo,
      })),
      totals: {
        guias: t0.guias,
        jarras: t0.jarras,
        jabas: t0.jabas,
      },
    };
  }

  /** Encola (reemplaza mismo id) y no pierde el dato si no hay internet. */
  function queueGuiasForCloud(payload) {
    if (!payload?.id) return false;
    enqueueCloudData("registrarGuias", payload, payload.id);
    return true;
  }

  /**
   * Guarda guías en el celular y las encola para la nube.
   * Nunca depende de internet: sin red queda pendiente y se sube al reconectar.
   * @returns {null | object} payload listo para subir, o null si falta datos
   */
  function persistAndQueueGuias() {
    saveStore();
    const payload = buildGuiasSyncPayload();
    if (!payload.supervisorDni && !payload.supervisorNombre) return null;
    queueGuiasForCloud(payload);
    updateNetworkUI();
    return payload;
  }

  function flushGuiasInBackground() {
    flushCloudDataQueue()
      .then((result) => {
        if (result?.sent > 0 && result.remain === 0) {
          toast("Guías subidas al servidor");
        } else if (result?.remain > 0 && navigator.onLine) {
          toast("Guías pendientes · se reintentará solo");
        } else if (!navigator.onLine) {
          toast("Sin internet · guías pendientes de subir");
        }
      })
      .catch(() => {
        toast("No se pudo subir guías · quedan pendientes");
      });
  }

  function saveGuidesSummary(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (!requireQrLogin()) return;
    if (state.savingGuias) return;
    if (!state.guias.length) {
      toast("No hay guías para guardar");
      return;
    }
    if (!isValidGuidesLic_(state.session.grupoLic)) {
      toast("Seleccione LIC (01–50) o No tengo por ahora");
      openPicker("guidesLic");
      return;
    }

    const btnSave = $("#btnSaveGuidesSummary");
    const btnCancel = $("#btnCancelGuidesSummary");
    const btnClose = $("#btnCloseGuidesSummary");

    // Solo guardar (celular + nube). NO descarga Excel.
    state.savingGuias = true;
    if (btnSave) btnSave.disabled = true;
    if (btnCancel) btnCancel.disabled = true;
    if (btnClose) btnClose.disabled = true;

    const payload = persistAndQueueGuias();
    if (!payload) {
      state.savingGuias = false;
      if (btnSave) btnSave.disabled = false;
      if (btnCancel) btnCancel.disabled = false;
      if (btnClose) btnClose.disabled = false;
      toast("Falta supervisor para guardar");
      return;
    }

    pushGuiasHistory(payload);
    saveStore();

    // Tras guardar: limpiar inputs / guías de pantalla (sesión del supervisor se mantiene)
    state.guias = [emptyGuia()];
    state.expandedGuiaId = state.guias[0].id;
    saveStore();

    closeGuidesSummary();
    renderCards();
    updateKpis();
    updateMeta();
    updateNetworkUI();

    if (!navigator.onLine) {
      toast("Guardado · pantalla limpia · pendiente de subir");
    } else {
      toast("Guardado · pantalla limpia · subiendo…");
    }

    flushGuiasInBackground();
    setTimeout(() => {
      state.savingGuias = false;
      if (btnSave) btnSave.disabled = false;
      if (btnCancel) btnCancel.disabled = false;
      if (btnClose) btnClose.disabled = false;
    }, 1500);
  }

  function formatGuiaLoteSummary(guia) {
    const loteNum = String(guia?.lote || "")
      .replace(/^Q/i, "")
      .trim();
    if (!loteNum) return "—";
    const modRaw = String(guia?.modulo || "").trim().toUpperCase();
    const modulo = modRaw ? (modRaw.startsWith("M") ? modRaw : `M${modRaw}`) : "";
    const turno = String(guia?.turno || "").replace(/^T/i, "").trim();
    const parts = [`LT${loteNum}`];
    if (modulo) parts.push(modulo);
    if (turno) parts.push(`T${turno}`);
    return parts.join("-");
  }

  function renderGuidesSummaryCard() {
    const card = $("#guidesSummaryCard");
    if (!card) return;
    const s = state.session;
    const t = totals();
    const fechaTxt = (s.fecha || todayISO()).split("-").reverse().join("/");
    const sup = s.supervisorNombre || "Supervisor";
    const rows = state.guias.filter(
      (g) =>
        normalizeNumeroGuia(g.numeroGuia) ||
        g.lote ||
        num(g.jarras) ||
        num(g.jabas)
    );
    const tableRows = rows.length
      ? rows
          .map((g, idx) => {
            const numTxt = formatNumeroGuiaInput(g.numeroGuia) || "—";
            const loteTxt = formatGuiaLoteSummary(g);
            return `
            <tr>
              <td class="gs-td-idx">${idx + 1}</td>
              <td class="gs-td-num">${escapeHtml(numTxt)}</td>
              <td class="gs-td-lote"><strong>${escapeHtml(loteTxt)}</strong></td>
              <td class="gs-td-qty">${fmt(num(g.jarras))}</td>
              <td class="gs-td-qty">${fmt(num(g.jabas))}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td class="gs-empty" colspan="5">Sin guías registradas</td></tr>`;
    card.innerHTML = `
      <div class="gs-paper">
        <div class="gs-paper-head">
          <img src="/assets/logo-qberries.png" alt="" />
          <div>
            <small>REGISTRO DE GUÍA INTERNA DE COSECHA</small>
            <h3>Q Berries · ${escapeHtml(currentFundo())}</h3>
          </div>
        </div>
        <div class="gs-paper-meta">
          <div class="gs-meta-fecha"><small>FECHA</small><strong>${fechaTxt}</strong></div>
          <div class="gs-meta-fundo"><small>FUNDO</small><strong>${escapeHtml(currentFundo())}</strong></div>
          <div class="gs-meta-lic"><small>LIC</small><strong>${escapeHtml(
            displayGuidesLic_(state.session.grupoLic) || "—"
          )}</strong></div>
          <div class="gs-meta-sup"><small>SUPERVISOR</small><strong title="${escapeHtml(sup)}">${escapeHtml(sup)}</strong></div>
        </div>
        <div class="gs-table-wrap">
          <table class="gs-table">
            <thead>
              <tr>
                <th>#</th>
                <th>N° Guía</th>
                <th>Lote</th>
                <th>Jarras</th>
                <th>Jabas</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
        <footer class="gs-paper-total">
          <span>TOTAL · ${rows.length} guía${rows.length === 1 ? "" : "s"}</span>
          <strong>${fmt(t.jarras)} jarras · ${fmt(t.jabas)} jabas</strong>
        </footer>
      </div>`;
  }

  function onTabbarClick(tab) {
    if (navigationLocked) return;
    cancelRegistroRedirect();

    if (tab === "guias") {
      openGuidesSheet();
      return;
    }
    closeGuidesSheet();

    // Misma pestaña: no redirigir (salvo scroll suave / sheets).
    if (tab === "perfil") {
      openProfileModal();
      refreshTopnav();
      return;
    }
    if (tab === "ayuda") {
      openAyuda();
      return;
    }
    if (tab === "excel") {
      if ($("#historySheet")) {
        openHarvestHistory();
        return;
      }
      persistDraftBeforeNav();
      beginNavigation("/registro/index.html?tab=excel", false, { tabSwitch: true });
      return;
    }
    if (tab === "registro" && getPage() === "registro") {
      applyGuidesPanel(false);
      $("#conteoPanel")?.scrollTo?.({ top: 0, behavior: "smooth" });
      $(".harvest-scroll")?.scrollTo?.({ top: 0, behavior: "smooth" });
      refreshTopnav();
      return;
    }
    if (tab === "vincular" && getPage() === "vinculo") {
      refreshTopnav();
      return;
    }

    const id = state.identity || getIdentity();
    if (!id?.dni || !hasQrLogin()) {
      toast("Escanee su carnet para continuar");
      if (getPage() !== "scan") goTo("scan");
      return;
    }

    // El borrador se guarda en localStorage (síncrono): al terminar esta línea
    // ya está en disco, así que se navega en el mismo instante del toque.
    persistDraftBeforeNav();

    if (tab === "vincular") {
      goTo("vinculo");
      return;
    }
    if (tab === "registro") {
      goTo("registro");
      return;
    }
    if (tab === "agregar") {
      if (getPage() !== "registro") {
        beginNavigation("/registro/index.html?tab=agregar", false, { tabSwitch: true });
        return;
      }
      const input = $("#harvestWorkerDni");
      // Enfocar y dejar que el ajuste de teclado centre el campo una sola vez.
      input?.focus();
    }
  }

  function openRequestedTab() {
    let tab = "";
    try {
      tab = new URLSearchParams(location.search).get("tab") || "";
    } catch {
      return;
    }
    if (tab !== "agregar" && tab !== "excel" && tab !== "guias") return;
    try {
      const clean =
        getPage() === "registro"
          ? "/registro/index.html"
            : location.pathname;
      history.replaceState(null, "", clean);
    } catch {
      /* ignore */
    }
    if (tab === "guias") {
      openGuidesSheet();
      return;
    }
    if (tab === "excel" && $("#historySheet")) {
      openHarvestHistory();
      return;
    }
    if (getPage() === "registro") onTabbarClick(tab);
  }

  function loadHarvestHistory() {
    let list = [];
    try {
      const parsed = JSON.parse(
        localStorage.getItem(HARVEST_HISTORY_KEY) || "[]"
      );
      list = Array.isArray(parsed) ? parsed : [];
    } catch {
      list = [];
    }
    const minTime = Date.now() - HISTORY_TTL_MS;
    const fresh = list
      .filter((item) => Date.parse(item?.savedAt || 0) >= minTime)
      .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
      .slice(0, 50);
    try {
      localStorage.setItem(HARVEST_HISTORY_KEY, JSON.stringify(fresh));
    } catch {
      /* almacenamiento lleno: conservar lo que ya existe */
    }
    return fresh;
  }

  function makeHarvestSnapshot() {
    syncCurrentHarvestDraft();
    const id = state.identity || getIdentity() || {};
    const h = state.harvest;
    const tipo = normalizeHarvestType(h.tipo);
    const prev = state.previewDraftByType?.[tipo];
    const existing = todayReadySnapshots().find(
      (snap) => normalizeHarvestType(snap.tipo) === tipo
    );
    return {
      id: existing?.id || prev?.id || uid(),
      savedAt: new Date().toISOString(),
      fecha: h.fecha || todayISO(),
      tipo,
      lote: h.lote || "",
      codLote: h.codLote || "",
      modulo: h.modulo || "",
      turno: h.turno || "",
      variedad: h.variedad || "",
      supervisor: id.nombre || "SUPERVISOR",
      supervisorDni: id.dni || "",
      workers: (h.workers || []).map((w) => ({
        dni: w.dni,
        nombre: w.nombre,
        manana: num(w.manana),
        tarde: num(w.tarde),
      })),
    };
  }

  /** ¿El borrador de un tipo tiene datos para mostrar en modal/tabla? */
  function harvestDraftHasData(draft) {
    if (!draft || typeof draft !== "object") return false;
    if (String(draft.lote || "").trim()) return true;
    return (draft.workers || []).some(
      (w) =>
        String(w?.dni || "").replace(/\D/g, "").length === 8 ||
        num(w?.manana) > 0 ||
        num(w?.tarde) > 0
    );
  }

  /**
   * Snapshot desde la caché local de un tipo (Suma/Resta/Descarte)
   * sin perder lo ingresado al cambiar de pestaña o abrir el modal.
   */
  function snapshotFromTypeDraft(tipo) {
    syncCurrentHarvestDraft();
    const key = normalizeHarvestType(tipo);
    const bucket = harvestTypeBucket(key);
    if (!harvestDraftHasData(bucket)) return null;
    const id = state.identity || getIdentity() || {};
    if (!state.previewDraftByType || typeof state.previewDraftByType !== "object") {
      state.previewDraftByType = {};
    }
    const prev = state.previewDraftByType[key];
    const snapshot = {
      id: prev?.id || uid(),
      savedAt: prev?.savedAt || new Date().toISOString(),
      fecha: state.harvest.fecha || todayISO(),
      tipo: key,
      lote: bucket.lote || "",
      codLote: bucket.codLote || "",
      modulo: bucket.modulo || "",
      turno: bucket.turno || "",
      variedad: bucket.variedad || "",
      supervisor: id.nombre || "SUPERVISOR",
      supervisorDni: id.dni || "",
      workers: (bucket.workers || []).map((w) => ({
        dni: w.dni,
        nombre: w.nombre,
        manana: num(w.manana),
        tarde: num(w.tarde),
      })),
    };
    state.previewDraftByType[key] = snapshot;
    return snapshot;
  }

  function rememberPreviewDraft(snapshot) {
    if (!snapshot) return;
    const key = normalizeHarvestType(snapshot.tipo);
    if (!state.previewDraftByType || typeof state.previewDraftByType !== "object") {
      state.previewDraftByType = {};
    }
    state.previewDraftByType[key] = snapshot;
    state.previewDraftSnapshot = snapshot;
  }

  function snapshotTotal(snapshot) {
    return (snapshot?.workers || []).reduce(
      (sum, w) => sum + num(w.manana) + num(w.tarde),
      0
    );
  }

  function buildHarvestSyncPayload(snapshot) {
    return {
      localId: snapshot.id,
      id: snapshot.id,
      fecha: snapshot.fecha || todayISO(),
      horaGuardado: snapshot.savedAt || new Date().toISOString(),
      tipo: harvestTypeLabel(snapshot.tipo).toUpperCase(),
      observacion: harvestTypeObservacion(snapshot.tipo),
      totalGeneral: snapshotTotal(snapshot),
      lote: harvestLoteCode(snapshot),
      variedad: snapshot.variedad || "",
      supervisorDni: String(snapshot.supervisorDni || "").replace(/\D/g, ""),
      supervisorNombre: String(snapshot.supervisor || "").trim().toUpperCase(),
      workers: (snapshot.workers || []).map((worker) => ({
        dni: String(worker.dni || "").replace(/\D/g, ""),
        nombre: String(worker.nombre || "").trim().toUpperCase(),
        manana: num(worker.manana),
        tarde: num(worker.tarde),
        total: num(worker.manana) + num(worker.tarde),
      })),
    };
  }

  function harvestLoteCode(snapshot) {
    const loteNum = String(snapshot?.lote || "")
      .replace(/^Q/i, "")
      .trim();
    const turno = String(snapshot?.turno || "").replace(/^T/i, "").trim();
    const modulo = String(snapshot?.modulo || "").trim().toUpperCase();
    if (!loteNum) return snapshot?.codLote || "";
    const parts = [`LT${loteNum}`];
    if (turno) parts.push(`T${turno}`);
    if (modulo) parts.push(modulo.startsWith("M") ? modulo : `M${modulo}`);
    return parts.join("-");
  }

  function harvestExcelRows(snapshot) {
    const lote = harvestLoteCode(snapshot);
    const observacion = harvestTypeObservacion(snapshot.tipo);
    return (snapshot.workers || []).map((w, index) => ({
      DNI: w.dni,
      "NOMBRES Y APELLIDOS": w.nombre,
      "MAÑANA": num(w.manana),
      TARDE: num(w.tarde),
      "TOTAL-UNIDADES": num(w.manana) + num(w.tarde),
      LOTE: lote,
      VARIEDAD: snapshot.variedad || "",
      OBSERVACION: observacion,
      SUPERVISOR: index === 0 ? snapshot.supervisor || "" : "",
    }));
  }

  /** Primer nombre + apellido paterno (catálogo: APELLIDOS NOMBRES). */
  function filePersonName(full) {
    const parts = String(full || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase()
      .split(" ")
      .filter(Boolean);
    if (!parts.length) return "SUPERVISOR";
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[1]} ${parts[0]}`;
    return `${parts[2]} ${parts[0]}`;
  }

  /** Nombre: primer nombre y apellido · tipo · día-mes */
  function harvestFileName(snapshot) {
    const supervisor = filePersonName(
      snapshot.supervisor || identityFullName() || "SUPERVISOR"
    );
    const [y, m, d] = String(snapshot.fecha || todayISO()).split("-");
    const diaMes = m && d ? `${d}-${m}` : todayISO().slice(5).split("-").reverse().join("-");
    const tipo = harvestTypeShort(snapshot.tipo)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "")
      .trim();
    return `${supervisor} ${tipo || "Suma"} ${diaMes}.xlsx`;
  }

  function buildHarvestWorkbook(snapshot) {
    if (typeof XLSX === "undefined") throw new Error("xlsx-unavailable");
    const rows = harvestExcelRows(snapshot);
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 13 },
      { wch: 32 },
      { wch: 11 },
      { wch: 11 },
      { wch: 19 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 26 },
    ];
    if (rows.length) ws["!autofilter"] = { ref: `A1:I${rows.length + 1}` };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Registro");
    return wb;
  }

  const XLSX_SHARE_MIME =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  /** Nombre seguro para Web Share / WhatsApp (ASCII, .xlsx). */
  function safeXlsxShareName(raw) {
    let name = String(raw || "cosecha.xlsx")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._ -]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    if (!name.toLowerCase().endsWith(".xlsx")) name = `${name || "cosecha"}.xlsx`;
    return name;
  }

  /**
   * Crea un File real .xlsx (Uint8Array + MIME Office).
   * Crítico en Android Chrome: File([Uint8Array]) suele pasar canShare
   * mejor que File([Blob]).
   */
  function createXlsxFile(bytes, fileName) {
    const name = safeXlsxShareName(fileName);
    const data =
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (!data.byteLength) return null;
    try {
      return new File([data], name, {
        type: XLSX_SHARE_MIME,
        lastModified: Date.now(),
      });
    } catch {
      try {
        const blob = new Blob([data], { type: XLSX_SHARE_MIME });
        return new File([blob], name, {
          type: XLSX_SHARE_MIME,
          lastModified: Date.now(),
        });
      } catch {
        return null;
      }
    }
  }

  function buildHarvestFile(snapshot) {
    const wb = buildHarvestWorkbook(snapshot);
    const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    return createXlsxFile(bytes, harvestFileName(snapshot));
  }

  /** Solo muestra el resumen: guardar ocurre dentro del modal */
  function previewHarvestSummary() {
    // Persistir en caché local antes de abrir modal/tabla
    saveHarvest();
    const tipo = normalizeHarvestType(state.harvest.tipo);
    if (isHarvestTypeLocked(tipo)) {
      toast(
        `${harvestTypeShort(tipo)} ya está guardada hoy · no se puede duplicar`
      );
      focusNextMissingHarvestType();
      return null;
    }
    if (!state.harvest.lote) {
      toast("Seleccione el lote antes de continuar");
      $("#btnHarvestLote")?.focus();
      return null;
    }
    if (!(state.harvest.workers || []).length) {
      toast("Agregue al menos un trabajador");
      $("#harvestWorkerDni")?.focus();
      return null;
    }
    if (harvestTotal() <= 0) {
      toast("Ingrese las jarras de mañana o tarde");
      return null;
    }
    const snapshot =
      snapshotFromTypeDraft(state.harvest.tipo) || makeHarvestSnapshot();
    rememberPreviewDraft(snapshot);
    openExportPreview(snapshot, { saved: false });
    return snapshot;
  }

  /** Guarda 1 sola tabla por tipo/día (reemplaza si existiera). */
  function upsertHarvestHistory(snapshot) {
    if (!snapshot) return null;
    const history = loadHarvestHistory();
    const key = harvestDayTypeKey(snapshot);
    const existing = history.find((item) => harvestDayTypeKey(item) === key);
    const nextSnap = {
      ...snapshot,
      id: existing?.id || snapshot.id,
      savedAt: new Date().toISOString(),
    };
    const next = [
      nextSnap,
      ...history.filter((item) => harvestDayTypeKey(item) !== key),
    ].slice(0, 50);
    try {
      localStorage.setItem(HARVEST_HISTORY_KEY, JSON.stringify(next));
    } catch {
      return null;
    }
    return nextSnap;
  }

  function persistHarvestSnapshot(snapshot, opts = {}) {
    if (!snapshot) return null;
    const silent = !!opts.silent;
    const skipReset = !!opts.skipReset;
    const tipo = normalizeHarvestType(snapshot.tipo);

    // Seguridad: no permitir segunda tabla del mismo tipo hoy
    if (
      isHarvestTypeLocked(tipo) &&
      !loadHarvestHistory().some((item) => item.id === snapshot.id)
    ) {
      if (!silent) {
        toast(
          `${harvestTypeShort(tipo)} ya tiene una tabla hoy · no se duplica`
        );
      }
      return null;
    }

    if (
      state.activeExportSaved &&
      state.activeExportSnapshot?.id === snapshot.id
    ) {
      return snapshot;
    }

    const savedSnap = upsertHarvestHistory(snapshot);
    if (!savedSnap) {
      if (!silent) toast("No hay espacio para guardar el historial");
      return null;
    }

    state.activeExportSnapshot = savedSnap;
    state.activeExportSaved = true;
    updateExportPreviewSavedUI();
    enqueueCloudData(
      "registrarCosecha",
      buildHarvestSyncPayload(savedSnap),
      savedSnap.id
    );
    // Limpia solo ESTE tipo; deja Resta/Descarte (u otras) intactas
    if (!skipReset) resetHarvestTypeAfterSave(savedSnap.tipo);
    if (state.previewDraftSnapshot?.id === savedSnap.id) {
      state.previewDraftSnapshot = savedSnap;
    }
    if (!silent) toast(`${harvestTypeShort(savedSnap.tipo)} guardada · formulario limpio`);
    captureSavedWorkers(savedSnap.workers);
    flushCloudDataQueue().catch(() => {});
    renderExportPreviewTypes(savedSnap);
    return savedSnap;
  }

  /** Guarda, limpia ese tipo y muestra qué falta (Suma / Resta / Descarte). */
  async function commitHarvestSnapshot() {
    const snapshot = state.activeExportSnapshot;
    if (!snapshot) return null;
    if (state.activeExportSaved) {
      toast("Este registro ya está guardado y bloqueado");
      renderExportPreviewDayStatus();
      return snapshot;
    }
    const btn = $("#btnCommitHarvest");
    setBtnLoading(btn, true, "Guardando…");
    showAppLoader("Guardando registro…");
    try {
      await new Promise((r) => window.setTimeout(r, 420));
      const saved = persistHarvestSnapshot(snapshot, { skipReset: false });
      if (!saved) return null;
      state.previewDraftSnapshot = null;
      renderHarvestDayChecklist();
      renderExportPreviewDayStatus();
      renderExportPreviewTypes(saved);
      focusNextMissingHarvestType();
      toast(harvestDayProgressMessage());
      return saved;
    } finally {
      hideAppLoader();
      setBtnLoading(btn, false);
    }
  }

  function updateExportPreviewSavedUI() {
    const saved = !!state.activeExportSaved;
    const btn = $("#btnCommitHarvest");
    const kicker = $("#exportPreviewKicker");
    if (btn) {
      btn.hidden = saved;
      btn.disabled = saved;
    }
    if (kicker) {
      kicker.textContent = saved ? "REGISTRO GUARDADO" : "RESUMEN DEL DÍA";
    }
  }

  function previewSnapshotsMap(current) {
    const map = {};
    // 1) Ya guardados hoy (historial)
    todayReadySnapshots().forEach((item) => {
      map[normalizeHarvestType(item.tipo)] = item;
    });
    // 2) Borradores en caché local por tipo (no se pierden al cambiar Suma/Resta/Descarte)
    HARVEST_TYPES.forEach((item) => {
      const key = item.key;
      if (map[key] && isSnapshotSaved(map[key])) return;
      const cached = state.previewDraftByType?.[key];
      const fromDraft = snapshotFromTypeDraft(key);
      if (fromDraft) map[key] = fromDraft;
      else if (cached) map[key] = cached;
    });
    // 3) El que está abierto ahora
    const draft = state.previewDraftSnapshot;
    if (draft) map[normalizeHarvestType(draft.tipo)] = draft;
    if (current) map[normalizeHarvestType(current.tipo)] = current;
    return map;
  }

  function isSnapshotSaved(snapshot) {
    if (!snapshot?.id) return false;
    if (loadHarvestHistory().some((item) => item.id === snapshot.id)) {
      return true;
    }
    if (state.previewDraftSnapshot?.id === snapshot.id && !state.activeExportSaved) {
      return false;
    }
    return false;
  }

  function renderExportPreviewTypes(current) {
    const root = $("#exportPreviewTypes");
    if (!root) return;
    const active = current || state.activeExportSnapshot;
    const status = harvestDayTypeStatus();
    const map = previewSnapshotsMap(active);
    // Siempre visibles: así el supervisor ve qué archivos ya están listos.
    root.hidden = false;
    root.innerHTML = status
      .map((item) => {
        const snapshot = map[item.key] || item.snapshot;
        const on = snapshot && snapshot.id === active?.id;
        const mark = item.sent ? " ✓✓" : item.saved || snapshot ? " ✓" : "";
        return `<button type="button" class="${on ? "is-on" : ""}" data-preview-type="${
          item.key
        }" ${snapshot ? "" : "disabled"}>${escapeHtml(item.short)}${mark}</button>`;
      })
      .join("");
    renderExportPreviewDayStatus();
  }

  function openExportPreview(snapshot, opts = {}) {
    if (!snapshot) return;
    state.activeExportSnapshot = snapshot;
    // Desde el historial ya está guardado; desde "Ver resumen" todavía no.
    state.activeExportSaved = opts.saved !== false;
    if (!state.activeExportSaved) state.previewDraftSnapshot = snapshot;
    updateExportPreviewSavedUI();
    renderExportPreviewTypes(snapshot);
    renderExportPreviewDayStatus();
    const rows = $("#exportPreviewRows");
    if (rows) {
      rows.innerHTML = harvestExcelRows(snapshot)
        .map(
          (row) => `<tr>
            <td>${escapeHtml(row.DNI)}</td>
            <td>${escapeHtml(row["NOMBRES Y APELLIDOS"])}</td>
            <td>${fmt(row["MAÑANA"])}</td>
            <td>${fmt(row.TARDE)}</td>
            <td>${fmt(row["TOTAL-UNIDADES"])}</td>
            <td>${escapeHtml(row.LOTE)}</td>
            <td>${escapeHtml(row.VARIEDAD)}</td>
            <td>${escapeHtml(row.OBSERVACION)}</td>
            <td>${escapeHtml(row.SUPERVISOR)}</td>
          </tr>`
        )
        .join("");
    }
    const saved = new Date(snapshot.savedAt);
    const meta = $("#exportPreviewMeta");
    if (meta) {
      meta.textContent = `${harvestTypeShort(snapshot.tipo)} · ${snapshot.fecha} · Lote ${
        snapshot.codLote || snapshot.lote || "—"
      } · ${snapshot.workers.length} trabajador(es) · ${snapshot.supervisor}`;
      if (!Number.isNaN(saved.getTime())) {
        meta.textContent += ` · ${saved.toLocaleTimeString("es-PE", {
          hour: "2-digit",
          minute: "2-digit",
        })}`;
      }
    }
    if ($("#exportPreviewTotal")) {
      $("#exportPreviewTotal").textContent = `${fmt(
        snapshotTotal(snapshot)
      )} jarras`;
    }
    const modal = $("#exportPreview");
    if (modal) modal.hidden = false;
    hydrateIcons(modal);
  }

  function closeExportPreview() {
    // Al cerrar el modal NO se borra lo ingresado: queda en caché por tipo
    saveHarvest();
    const modal = $("#exportPreview");
    if (modal) modal.hidden = true;
    resetViewportLayout();
    renderHarvestDayChecklist();
    renderHarvest();
  }

  /** No cierra a ciegas si falta Suma/Resta/Descarte o enviar. */
  function requestCloseExportPreview() {
    const missing = harvestMissingTypesToday();
    const unsent = harvestUnsentTypesToday();
    if (!missing.length && !unsent.length) {
      closeExportPreview();
      return;
    }
    const lines = [];
    if (missing.length) {
      lines.push(`Falta registrar: ${missing.map((m) => m.short).join(", ")}`);
    }
    if (unsent.length) {
      lines.push(`Falta enviar: ${unsent.map((m) => m.short).join(", ")}`);
    }
    confirmModal(
      "Conteo incompleto",
      `${lines.join(". ")}. ¿Cerrar igual?`,
      () => closeExportPreview(),
      "Cerrar igual"
    );
  }

  function downloadHarvestSnapshot(snapshot, opts = {}) {
    if (!snapshot) return false;
    // Desde resumen / historial: un solo Excel (opts.single o por defecto true en preview)
    const forceSingle = opts.single !== false;
    if (!forceSingle) {
      const ready = availableExportSnapshots();
      if (ready.length > 1) {
        openReadyFilesModal("download", ready);
        return false;
      }
    }
    try {
      const wb = buildHarvestWorkbook(snapshot);
      const ok = downloadXlsxWorkbook(wb, harvestFileName(snapshot));
      if (ok && !opts.silent) toast("Excel descargado");
      return ok;
    } catch {
      if (!opts.silent) toast("No se pudo crear el Excel");
      return false;
    }
  }

  function harvestShareFile(snapshot) {
    try {
      return buildHarvestFile(snapshot);
    } catch (err) {
      console.warn("harvestShareFile", err);
      return null;
    }
  }

  function harvestShareFileCandidates(snapshot) {
    const file = harvestShareFile(snapshot);
    return file ? [file] : [];
  }

  function canShareFiles(files) {
    if (!files?.length || typeof navigator.share !== "function") return false;
    if (typeof navigator.canShare !== "function") {
      // Safari antiguo: canShare puede no existir; share con files sí.
      return true;
    }
    try {
      return !!navigator.canShare({ files });
    } catch {
      return false;
    }
  }

  function isShareAbort(err) {
    if (!err) return false;
    if (err.name === "AbortError") return true;
    const msg = String(err.message || err || "").toLowerCase();
    return (
      msg.includes("abort") ||
      msg.includes("cancel") ||
      msg.includes("dismiss") ||
      msg.includes("share canceled") ||
      msg.includes("share cancelled")
    );
  }

  /** Último recurso: solo cuando el dispositivo no puede Web Share de archivos. */
  function fallbackDownloadExcelShare(snapshot) {
    toast(
      "Este dispositivo no permite compartir archivos directamente. El Excel se descargará para que puedas adjuntarlo manualmente."
    );
    downloadHarvestSnapshot(snapshot, { single: true, silent: true });
  }

  /**
   * Compartir Excel → menú nativo del sistema (WhatsApp, Telegram, etc.).
   * 1) Genera .xlsx  2) File real  3) canShare({files})  4) navigator.share
   * AbortError = usuario canceló → NO descargar.
   * Debe llamarse en el mismo gesto de click (sin await previo).
   */
  function shareOneExcelNative(snapshot) {
    if (!snapshot) {
      toast("No hay registro para enviar");
      return;
    }
    if (typeof XLSX === "undefined") {
      toast("Espere a que cargue el Excel e intente otra vez");
      return;
    }

    let file = null;
    try {
      file = harvestShareFile(snapshot);
    } catch (err) {
      console.warn("shareOneExcelNative build", err);
    }
    if (!(file instanceof File)) {
      toast("No se pudo crear el Excel");
      return;
    }

    const files = [file];
    const title = file.name;
    const native = window.QBNative;

    // APK Capacitor: Share plugin nativo (mismo menú del sistema)
    if (native?.isNative?.() && typeof native.shareExcelFiles === "function") {
      native
        .shareExcelFiles(files, { title })
        .then((res) => {
          if (res?.ok) {
            markHarvestSnapshotSent(snapshot);
            toast(harvestDayProgressMessage());
            return;
          }
          // Si el plugin falla, intentar Web Share del WebView
          tryWebShareExcel(files, title, snapshot);
        })
        .catch((err) => {
          if (native.isShareCancelled?.(err) || isShareAbort(err)) return;
          tryWebShareExcel(files, title, snapshot);
        });
      return;
    }

    tryWebShareExcel(files, title, snapshot);
  }

  function tryWebShareExcel(files, title, snapshot) {
    if (typeof navigator.share !== "function") {
      fallbackDownloadExcelShare(snapshot);
      return;
    }

    let shareFile = files[0];
    if (!(shareFile instanceof File)) {
      fallbackDownloadExcelShare(snapshot);
      return;
    }

    // Android Chrome: canShare debe pasar con el File .xlsx
    if (!canShareFiles([shareFile])) {
      // Reintento: mismos bytes, MIME octet-stream (algunos WebView lo aceptan)
      try {
        const alt = new File([shareFile], shareFile.name, {
          type: "application/octet-stream",
          lastModified: Date.now(),
        });
        if (canShareFiles([alt])) shareFile = alt;
        else {
          fallbackDownloadExcelShare(snapshot);
          return;
        }
      } catch {
        fallbackDownloadExcelShare(snapshot);
        return;
      }
    }

    // Solo files + title. NO enviar `text` vacío: en Android WhatsApp
    // a veces comparte solo texto y pierde el adjunto.
    const payload = { files: [shareFile], title };

    // Llamada inmediata (mismo turno del click → conserva user gesture)
    navigator
      .share(payload)
      .then(() => {
        markHarvestSnapshotSent(snapshot);
        toast(harvestDayProgressMessage());
      })
      .catch((err) => {
        if (isShareAbort(err)) return;
        console.warn("navigator.share", err);
        fallbackDownloadExcelShare(snapshot);
      });
  }

  // Alias por compatibilidad con llamadas anteriores
  function shareOneExcelWhatsApp(snapshot) {
    shareOneExcelNative(snapshot);
  }

  function pickShareablePayload(files) {
    if (!files?.length || typeof navigator.share !== "function") return null;
    const one = files[0];
    if (!(one instanceof File)) return null;
    if (!canShareFiles([one])) return null;
    return { files: [one], title: one.name };
  }

  /** Menú nativo · siempre 1 archivo */
  function shareFilesNow(payload, { onOk, onFail } = {}) {
    const one = payload?.files?.[0];
    if (!(one instanceof File)) {
      onFail?.();
      return false;
    }
    const files = [one];
    const title = payload.title || one.name || "Excel QBerries";
    const native = window.QBNative;
    if (native?.isNative?.() && typeof native.shareExcelFiles === "function") {
      native
        .shareExcelFiles(files, { title })
        .then((res) => {
          if (res?.ok) onOk?.();
          else onFail?.();
        })
        .catch((err) => {
          if (native.isShareCancelled?.(err) || isShareAbort(err)) return;
          onFail?.(err);
        });
      return true;
    }
    if (!canShareFiles(files)) {
      onFail?.({ reason: "cannot-share-files" });
      return false;
    }
    navigator
      .share({ files, title })
      .then(() => onOk?.())
      .catch((err) => {
        if (isShareAbort(err)) return;
        onFail?.(err);
      });
    return true;
  }

  function shareExcelDocuments(snapshots) {
    const list = (snapshots || []).filter(Boolean);
    if (!list.length) {
      toast("No hay registro para enviar");
      return;
    }
    if (list.length > 1) {
      toast("Se comparte 1 Excel (el seleccionado)");
    }
    // Nunca varios archivos en el mismo menú Compartir
    shareOneExcelNative(list[0]);
  }

  function shareHarvestFromPreview() {
    const current = state.activeExportSnapshot;
    if (!current) {
      toast("No hay registro para enviar");
      return;
    }
    shareOneExcelNative(current);
  }

  function shareHarvestSnapshot(snapshot) {
    if (!snapshot) {
      toast("No hay registro para compartir");
      return;
    }
    shareOneExcelNative(snapshot);
  }

  function openReadyFilesModal(action, files) {
    const sheet = $("#readyFiles");
    const list = $("#readyFilesList");
    const items = files?.length ? files : availableExportSnapshots();
    if (!items.length) {
      toast("Aún no hay archivos listos");
      return;
    }
    state.readyFilesAction = action === "download" ? "download" : "share";
    state.readyFilesItems = items.slice();
    if (!sheet || !list) {
      confirmReadyFilesAction(items);
      return;
    }
    const title = $("#readyFilesTitle");
    if (title) {
      title.textContent =
        state.readyFilesAction === "download"
          ? "¿Qué Excel desea guardar?"
          : "Compartir archivo";
    }
    if ($("#readyFilesAll")) $("#readyFilesAll").checked = true;
    const copy = $("#readyFilesCopy");
    if (copy) {
      copy.textContent =
        state.readyFilesAction === "share" && items.length > 1
          ? "Marque el Excel y pulse Compartir. Se abre el menú del celular (WhatsApp, Drive, Gmail, etc.)."
          : state.readyFilesAction === "download"
            ? "Elija qué Excel guardar en el celular."
            : "Se abre el menú Compartir del celular para enviar el archivo.";
    }
    const allSend = $("#btnReadyFilesAllSend");
    if (allSend) {
      const showMass = state.readyFilesAction === "share" && items.length > 1;
      allSend.hidden = !showMass;
      allSend.textContent = `Compartir (${items.length})`;
    }
    list.innerHTML = HARVEST_TYPES.map((type) => {
      const item = items.find(
        (snap) => normalizeHarvestType(snap.tipo) === type.key
      );
      if (!item) {
        return `<label class="check-pick-item is-disabled">
          <input type="checkbox" disabled />
          <span>
            <strong>${escapeHtml(type.short)}</strong>
            <small>Sin registro hoy</small>
          </span>
        </label>`;
      }
      return `<label class="check-pick-item">
          <input type="checkbox" data-ready-id="${escapeHtml(item.id)}" checked />
          <span>
            <strong>${escapeHtml(type.short)}</strong>
            <small>${item.workers?.length || 0} trabajador(es) · ${fmt(
        snapshotTotal(item)
      )} jarras · Lote ${escapeHtml(item.codLote || item.lote || "—")}</small>
          </span>
        </label>`;
    }).join("");
    const go = $("#btnReadyFilesGo");
    if (go) {
      go.textContent =
        state.readyFilesAction === "download"
          ? "Guardar Excel"
          : items.length > 1
            ? "Compartir los que marqué"
            : "Compartir archivo";
    }
    sheet.hidden = false;
    sheet.removeAttribute("hidden");
    hydrateIcons(sheet);
    list.scrollTop = 0;
  }

  function closeReadyFiles() {
    const sheet = $("#readyFiles");
    if (!sheet) return;
    sheet.hidden = true;
    sheet.setAttribute("hidden", "");
    resetViewportLayout();
  }

  function selectedReadySnapshots() {
    const checked = $$("#readyFilesList [data-ready-id]:checked").map(
      (input) => input.dataset.readyId
    );
    if (!checked.length) return [];
    const all = state.readyFilesItems?.length
      ? state.readyFilesItems
      : availableExportSnapshots();
    return all.filter((item) => checked.includes(item.id));
  }

  function confirmReadyFiles() {
    const selected = selectedReadySnapshots();
    if (!selected.length) {
      toast("Seleccione al menos un archivo");
      return;
    }
    closeReadyFiles();
    confirmReadyFilesAction(selected);
  }

  function confirmReadyFilesAction(selected) {
    const picks = selected || [];
    if (state.readyFilesAction === "download") {
      picks.forEach((item) => downloadHarvestSnapshot(item, { single: true }));
      return;
    }
    // Compartir: un solo Excel en el menú nativo (el primero marcado)
    if (picks.length > 1) {
      toast("Se abre Compartir con 1 Excel. Marque solo uno si desea otro.");
    }
    shareOneExcelNative(picks[0]);
  }

  function shareHarvestSnapshots(snapshots) {
    const list = (snapshots || []).filter(Boolean);
    if (!list.length) return;
    shareOneExcelNative(list[0]);
  }

  function renderHarvestHistory() {
    const root = $("#historyList");
    const pager = $("#historyPager");
    if (!root) return;
    const history = loadHarvestHistory();
    if (!history.length) {
      state.historyPage = 0;
      root.innerHTML =
        '<div class="history-empty">Aún no hay archivos guardados en las últimas 48 horas.</div>';
      if (pager) pager.hidden = true;
      return;
    }

    const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
    if (state.historyPage >= totalPages) state.historyPage = totalPages - 1;
    if (state.historyPage < 0) state.historyPage = 0;
    const page = state.historyPage;
    const start = page * HISTORY_PAGE_SIZE;
    const slice = history.slice(start, start + HISTORY_PAGE_SIZE);

    root.innerHTML = slice
      .map((item) => {
        const saved = new Date(item.savedAt);
        const when = Number.isNaN(saved.getTime())
          ? ""
          : saved.toLocaleString("es-PE", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            });
        const driveUrl = getHarvestDriveUrl(item);
        const drivePending = !driveUrl && isDriveUploadPending(item.id);
        return `<article class="history-item" data-history-id="${escapeHtml(
          item.id
        )}">
          <div class="history-item-top">
            <h3>${escapeHtml(harvestLoteCode(item) || "Sin lote")} · ${escapeHtml(
              harvestTypeShort(item.tipo)
            )}</h3>
            <time>${escapeHtml(when)}</time>
          </div>
          <p>${item.workers?.length || 0} trabajador(es) · ${fmt(
            snapshotTotal(item)
          )} jarras · ${escapeHtml(item.variedad || "Sin variedad")}<br>${escapeHtml(
            item.supervisor || ""
          )}${
            drivePending
              ? `<br><em class="history-drive-note">Drive pendiente de subir</em>`
              : driveUrl
                ? `<br><em class="history-drive-note is-ok">En Drive</em>`
                : ""
          }</p>
          <div class="history-item-actions">
            <button type="button" data-history-action="preview">Ver</button>
            <button type="button" data-history-action="download">Descargar</button>
            <button type="button" class="history-drive-btn${
              drivePending ? " is-pending" : driveUrl ? " is-ready" : ""
            }" data-history-action="drive">${
              drivePending
                ? "Drive pendiente"
                : driveUrl
                  ? "Compartir Drive"
                  : "Subir Drive"
            }</button>
          </div>
        </article>`;
      })
      .join("");

    if (pager) {
      const from = start + 1;
      const to = Math.min(start + HISTORY_PAGE_SIZE, history.length);
      pager.hidden = false;
      const label = $("#historyPageLabel");
      const prev = $("#btnHistoryPrev");
      const next = $("#btnHistoryNext");
      if (label) {
        label.textContent = `${from}–${to} de ${history.length} · pág. ${
          page + 1
        }/${totalPages}`;
      }
      if (prev) prev.disabled = page <= 0;
      if (next) next.disabled = page >= totalPages - 1;
    }
  }

  function historySnapshotById(id) {
    return loadHarvestHistory().find((item) => item.id === id) || null;
  }

  /* ---------- Guías history ---------- */
  function loadGuiasHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(GUIAS_HISTORY_KEY) || "[]");
      const list = Array.isArray(parsed) ? parsed : [];
      const minTime = Date.now() - HISTORY_TTL_MS;
      return list
        .filter((item) => Date.parse(item?.savedAt || 0) >= minTime)
        .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
        .slice(0, 50);
    } catch {
      return [];
    }
  }

  function saveGuiasHistory(list) {
    try {
      localStorage.setItem(GUIAS_HISTORY_KEY, JSON.stringify(list));
    } catch { /* full */ }
  }

  function pushGuiasHistory(payload) {
    if (!payload) return;
    const entry = {
      id: uid(),
      savedAt: new Date().toISOString(),
      fecha: payload.fecha || todayISO(),
      fundo: payload.fundo || "",
      supervisor: payload.supervisorNombre || "",
      supervisorDni: payload.supervisorDni || "",
      totalGuias: payload.totals?.guias || 0,
      totalJarras: payload.totals?.jarras || 0,
      totalJabas: payload.totals?.jabas || 0,
      guias: (payload.guias || []).map((g) => ({
        numeroGuia: g.numeroGuia || "",
        lote: g.lote || "",
        jarras: g.jarras || 0,
        jabas: g.jabas || 0,
      })),
    };
    const history = loadGuiasHistory();
    history.unshift(entry);
    saveGuiasHistory(history.slice(0, 50));
  }

  function renderGuiasHistory() {
    const root = $("#guiasHistoryList");
    const pager = $("#guiasHistoryPager");
    if (!root) return;
    const history = loadGuiasHistory();
    if (!history.length) {
      state.guiasHistoryPage = 0;
      root.innerHTML = '<div class="history-empty">Aún no hay guías guardadas en las últimas 48 horas.</div>';
      if (pager) pager.hidden = true;
      return;
    }
    const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
    const page = Math.min(Math.max(state.guiasHistoryPage || 0, 0), totalPages - 1);
    state.guiasHistoryPage = page;
    const start = page * HISTORY_PAGE_SIZE;
    const slice = history.slice(start, start + HISTORY_PAGE_SIZE);

    root.innerHTML = slice
      .map((item) => {
        const saved = new Date(item.savedAt);
        const when = Number.isNaN(saved.getTime())
          ? ""
          : saved.toLocaleString("es-PE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        return `<article class="history-item">
          <div class="history-item-top">
            <h3>${escapeHtml(item.fundo || "Licapa")} · ${item.totalGuias || 0} guía(s)</h3>
            <time>${escapeHtml(when)}</time>
          </div>
          <p>${fmt(item.totalJarras)} jarras · ${fmt(item.totalJabas)} jabas<br>${escapeHtml(item.supervisor || "")}</p>
        </article>`;
      })
      .join("");

    if (pager) {
      pager.hidden = false;
      const label = $("#guiasHistoryPageLabel");
      const prev = $("#btnGuiasHistoryPrev");
      const next = $("#btnGuiasHistoryNext");
      if (label) label.textContent = `${start + 1}–${Math.min(start + HISTORY_PAGE_SIZE, history.length)} de ${history.length} · pág. ${page + 1}/${totalPages}`;
      if (prev) prev.disabled = page <= 0;
      if (next) next.disabled = page >= totalPages - 1;
    }
  }

  function switchHistoryTab(tab) {
    const conteoPanel = $("#historyPanelConteo");
    const guiasPanel = $("#historyPanelGuias");
    $$("#historyTabs .history-tab").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.historyTab === tab);
    });
    if (conteoPanel) conteoPanel.hidden = tab !== "conteo";
    if (guiasPanel) guiasPanel.hidden = tab !== "guias";
    if (tab === "guias") renderGuiasHistory();
    else renderHarvestHistory();
  }

  function openHarvestHistory() {
    state.historyPage = 0;
    state.guiasHistoryPage = 0;
    closeGuidesSheet();
    const sheet = $("#historySheet");
    if (!sheet) return;
    renderHarvestHistory();
    renderGuiasHistory();
    switchHistoryTab("conteo");
    hydrateIcons(sheet);
    sheet.hidden = false;
    refreshTopnav();
  }

  function closeHarvestHistory() {
    const sheet = $("#historySheet");
    if (sheet) sheet.hidden = true;
    refreshTopnav();
    resetViewportLayout();
  }

  /**
   * Solo limpia lo que está en pantalla (inputs / borradores).
   * No toca sesión, historial guardado, colas ni caché del navegador.
   */
  function clearFormInputsOnly(button) {
    confirmModal(
      "Limpiar formularios",
      "Se borrarán solo los datos en pantalla (guías y conteo en curso). La sesión y el historial se mantienen.",
      () => {
        setBtnLoading(button, true, "Limpiando…");
        try {
          // Guías: una tarjeta vacía
          state.guias = [emptyGuia()];
          state.expandedGuiaId = state.guias[0]?.id || null;
          saveStore();
          if (typeof renderCards === "function") renderCards();

          // Conteo: solo tipos que aún no están guardados/bloqueados hoy
          if (!state.harvest.byType || typeof state.harvest.byType !== "object") {
            state.harvest.byType = emptyHarvestByType();
          }
          HARVEST_TYPES.forEach((item) => {
            if (isHarvestTypeLocked(item.key)) return;
            state.harvest.byType[item.key] = emptyHarvestTypeDraft();
            if (
              state.previewDraftByType &&
              typeof state.previewDraftByType === "object"
            ) {
              delete state.previewDraftByType[item.key];
            }
          });

          if (
            state.previewDraftSnapshot &&
            !isHarvestTypeLocked(state.previewDraftSnapshot.tipo)
          ) {
            state.previewDraftSnapshot = null;
          }
          if (
            state.activeExportSnapshot &&
            !isSnapshotSaved(state.activeExportSnapshot)
          ) {
            state.activeExportSnapshot = null;
            state.activeExportSaved = false;
          }

          attachCurrentHarvestDraft();
          clearHarvestWorkerForm();
          document.querySelectorAll("[data-harvest-field]").forEach((input) => {
            input.value = "";
          });
          if (!isHarvestTypeLocked(state.harvest.tipo)) {
            state.harvest.lote = "";
            state.harvest.codLote = "";
            state.harvest.modulo = "";
            state.harvest.turno = "";
            state.harvest.variedad = "";
            state.harvest.workers = [];
          }
          saveHarvest();
          renderHarvest();
          renderHarvestDayChecklist();

          toast("Inputs limpios · sesión e historial intactos");
        } catch {
          toast("No se pudo limpiar · intente de nuevo");
        } finally {
          setBtnLoading(button, false);
        }
      },
      "Limpiar"
    );
  }

  async function clearAppCache(button) {
    // Compat: el botón del perfil solo limpia inputs (no borra sesión/caché).
    clearFormInputsOnly(button);
  }

  async function updateApp(button) {
    setBtnLoading(button, true, "Actualizando…");
    try {
      clearTabShellStorage();
      try {
        localStorage.removeItem(CACHE_DAY_KEY);
      } catch {
        /* ignore */
      }

      if (!isNativeApp()) {
        // Mantener SW activo: refrescar assets y recargar (no unregister + refresh)
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
        requestCacheRefresh();
        try {
          const reg = await navigator.serviceWorker?.getRegistration?.();
          reg?.waiting?.postMessage?.({ type: "SKIP_WAITING" });
          reg?.active?.postMessage?.({ type: "SKIP_WAITING" });
        } catch {
          /* ignore */
        }
      }

      if (navigator.onLine) {
        await warmTabShells(true);
        await detectNetlify(5000);
        await Promise.all([
          loadSupervisores(),
          loadPersonas(),
          loadCatalogs(),
        ]);
        if (canUseCloudApi()) {
          await flushVinculoQueue().catch(() => {});
          await flushCloudDataQueue().catch(() => {});
        }
        updateNetworkUI();
        toast(
          canUseCloudApi()
            ? "Actualizado · Netlify conectado"
            : navigator.onLine
              ? "Actualizado · revise internet o Netlify"
              : "Actualizado · sin internet"
        );
      } else {
        toast("Sin internet · se recarga con datos del celular");
      }

      reloadWithBust();
    } catch {
      toast("No se pudo actualizar");
      setBtnLoading(button, false);
    }
  }

  function openAyuda() {
    let sheet = $("#helpSheet");
    if (!sheet) {
      sheet = document.createElement("aside");
      sheet.id = "helpSheet";
      sheet.className = "help-sheet";
      sheet.innerHTML = `
        <div class="help-head">
          <button type="button" class="app-back app-back--on-light help-back" aria-label="Volver">Atrás</button>
          <h2>Ayuda</h2>
          <button type="button" class="help-settings" aria-label="Configuración de la app">
            ${ico("settings")}
          </button>
        </div>
        <p class="help-lead">Guía rápida para el registro en campo.</p>
        <ul>
          <li><strong>Vincular:</strong> registre una sola vez su celular, grupo y supervisor global.</li>
          <li><strong>Registro:</strong> elija el lote; el módulo, turno y variedad se completan solos.</li>
          <li><strong>Agregar:</strong> escriba el DNI (8 dígitos) y el nombre aparece del listado.</li>
          <li><strong>Sin base:</strong> toque usuarios, complete DNI y nombre; se guarda en Data Manuales cuando haya internet.</li>
          <li><strong>Jarras:</strong> anote mañana y tarde por separado; el total se suma solo.</li>
          <li><strong>Guardar:</strong> revise el resumen antes de compartirlo o descargarlo.</li>
          <li><strong>Excel:</strong> consulte las últimas 48 horas; use Subir a Drive o Descargar.</li>
          <li><strong>Sin internet:</strong> puede navegar, registrar guías y cosecha; todo queda en el celular y sube al reconectar.</li>
        </ul>
        <button type="button" class="help-close">Entendido</button>
        <div class="app-tools-backdrop" hidden>
          <section class="app-tools-modal" role="dialog" aria-modal="true" aria-labelledby="appToolsTitle">
            <div class="app-tools-head">
              <div>
                <small>MANTENIMIENTO</small>
                <h3 id="appToolsTitle">Configuración de la app</h3>
              </div>
              <button type="button" class="app-tools-close" aria-label="Cerrar">${ico("x")}</button>
            </div>
            <p>${
              "Borre la caché de la app (service worker) y luego toque Actualizar app. Sus registros de cosecha, historial y sesión no se eliminan."
            }</p>
            <a class="app-tools-install" href="/instalar/">${ico("download")} Instalar en el celular</a>
            <button type="button" class="app-tools-cache">${ico("trash")} Limpiar formularios</button>
            <button type="button" class="app-tools-update">${ico("refresh")} Actualizar app</button>
          </section>
        </div>`;
      ($(".stage") || document.body).appendChild(sheet);
      const closeHelp = () => {
        sheet.hidden = true;
        refreshTopnav();
      };
      sheet.querySelector(".help-close")?.addEventListener("click", closeHelp);
      sheet.querySelector(".help-back")?.addEventListener("click", closeHelp);
      const tools = sheet.querySelector(".app-tools-backdrop");
      sheet.querySelector(".help-settings")?.addEventListener("click", () => {
        if (tools) tools.hidden = false;
      });
      sheet.querySelector(".app-tools-close")?.addEventListener("click", () => {
        if (tools) tools.hidden = true;
      });
      tools?.addEventListener("click", (event) => {
        if (event.target === tools) tools.hidden = true;
      });
    }
    sheet.hidden = false;
    refreshTopnav();
  }

  function showHarvestHome(identity) {
    if (getPage() !== "registro") {
      goTo("registro");
      return;
    }
    stopCamera();
    if (identity?.dni) {
      state.identity = identity;
      setIdentity(identity);
      bindSessionToIdentity(identity.dni);
    }
    const screen = $("#harvestScreen");
    if (screen) {
      screen.hidden = false;
    }
    // Siempre Conteo al entrar; Guías solo si ?tab=guias (openRequestedTab)
    applyGuidesPanel(false);
    renderHarvest();
    // Guías queda montada en caché para el cambio de pestaña sin pestañeo
    requestAnimationFrame(() => {
      try {
        warmGuidesPanel();
      } catch {
        /* ignore */
      }
    });
    Promise.all([loadCatalogs(), loadPersonas()])
      .then(renderHarvest)
      .catch(() => renderHarvest());
  }

  function selectHarvestLote(value) {
    const lote = findLote(value);
    state.harvest.lote = lote?.lote || "";
    state.harvest.codLote = lote?.codLote || "";
    state.harvest.modulo = lote?.modulo || "";
    state.harvest.turno = lote?.turno || "";
    state.harvest.variedad = lote?.variedad || "";
    saveHarvest();
    renderHarvest();
  }

  function previewHarvestWorker() {
    const dni = String($("#harvestWorkerDni")?.value || "").replace(/\D/g, "");
    if ($("#harvestWorkerDni") && $("#harvestWorkerDni").value !== dni) {
      $("#harvestWorkerDni").value = dni.slice(0, 8);
    }
    const persona = lookupPersona(dni) || lookupSupervisor(dni);
    const name = $("#harvestWorkerName");
    const msg = $("#harvestWorkerMsg");
    if (name) name.value = persona?.nombre || "";
    if (msg) {
      msg.textContent =
        dni.length === 8 && !persona
          ? "DNI no está en la base · toque el ícono de usuarios"
          : dni.length && dni.length < 8
            ? "El DNI debe tener 8 dígitos"
            : "";
    }
  }

  function openManualWorker() {
    const sheet = $("#manualWorker");
    if (!sheet) {
      toast("No se pudo abrir el registro");
      return;
    }
    const typed = String($("#harvestWorkerDni")?.value || "")
      .replace(/\D/g, "")
      .slice(0, 8);
    if ($("#manualWorkerDni")) $("#manualWorkerDni").value = typed;
    if ($("#manualWorkerName")) {
      $("#manualWorkerName").value = String(
        $("#harvestWorkerName")?.value || ""
      ).trim();
    }
    sheet.hidden = false;
    sheet.removeAttribute("hidden");
    sheet.style.display = "flex";
    hydrateIcons(sheet);
    setTimeout(() => {
      const focusEl =
        typed.length === 8 ? $("#manualWorkerName") : $("#manualWorkerDni");
      focusEl?.focus();
    }, 80);
  }

  function closeManualWorker() {
    $("#manualWorkerDni")?.blur();
    $("#manualWorkerNombre")?.blur();
    const sheet = $("#manualWorker");
    if (!sheet) return;
    sheet.hidden = true;
    sheet.setAttribute("hidden", "");
    sheet.style.display = "none";
    resetViewportLayout();
  }

  function pushHarvestWorker(dni, nombre, { fromManual = false } = {}) {
    if (isHarvestTypeLocked(state.harvest.tipo)) {
      toast(
        `${harvestTypeShort(state.harvest.tipo)} ya está guardada · no se edita`
      );
      return false;
    }
    const key = String(dni || "").replace(/\D/g, "");
    const name = String(nombre || "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
    if (key.length !== 8) {
      toast("El DNI debe tener exactamente 8 dígitos");
      return false;
    }
    if (name.length < 3) {
      toast("Ingrese el nombre completo");
      return false;
    }
    if (state.harvest.workers.some((w) => w.dni === key)) {
      toast("Este DNI ya está agregado");
      return false;
    }
    if (fromManual) {
      rememberSessionPersona(key, name);
    } else {
      rememberPersona(key, name);
    }
    // Queda en el listado de la sesión para Suma / Resta / Descarte.
    rememberSessionWorker(key, name, { manual: !!fromManual });
    state.harvest.workers.push({
      id: uid(),
      dni: key,
      nombre: name,
      manana: 0,
      tarde: 0,
      manual: !!fromManual,
    });
    saveHarvest();
    renderHarvestWorkers();
    return true;
  }

  function copyYesterdayWorkers() {
    openWorkerPick();
  }

  function localSavedWorkersPool() {
    const current = new Set(
      (state.harvest.workers || []).map((worker) =>
        String(worker.dni || "").replace(/\D/g, "")
      )
    );
    return Object.entries(state.sessionWorkers || {})
      .map(([dni, info]) => {
        const key = String(dni || "").replace(/\D/g, "");
        const nombre = String(info?.nombre || "").trim().toUpperCase();
        if (key.length !== 8 || !nombre || current.has(key)) return null;
        return {
          dni: key,
          nombre,
          source: info?.manual ? "Manual" : "Guardado",
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }

  function openWorkerPick() {
    const sheet = $("#workerPick");
    const list = $("#workerPickList");
    if (!sheet || !list) {
      toast("No se pudo abrir la lista");
      return;
    }
    const pool = localSavedWorkersPool();
    if (!pool.length) {
      toast("Aún no hay personal guardado. Confirme un registro y los DNI quedan aquí");
      return;
    }
    if ($("#workerPickAll")) $("#workerPickAll").checked = false;
    if ($("#workerPickQuery")) $("#workerPickQuery").value = "";
    renderWorkerPickList(pool);
    sheet.hidden = false;
    sheet.removeAttribute("hidden");
    hydrateIcons(sheet);
    setTimeout(() => $("#workerPickQuery")?.focus(), 80);
  }

  function renderWorkerPickList(pool, query = "") {
    const list = $("#workerPickList");
    if (!list) return;
    const q = String(query || "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const filtered = !q
      ? pool
      : pool.filter((worker) => {
          const nombre = String(worker.nombre || "")
            .toUpperCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
          const dni = String(worker.dni || "");
          return nombre.includes(q) || dni.includes(q.replace(/\D/g, "") || q);
        });
    if (!filtered.length) {
      list.innerHTML =
        '<div class="check-pick-empty">No hay coincidencias con esa búsqueda.</div>';
      if ($("#workerPickAll")) $("#workerPickAll").checked = false;
      return;
    }
    list.innerHTML = filtered
      .map(
        (worker) => `<label class="check-pick-item">
          <input type="checkbox" data-pick-dni="${escapeHtml(worker.dni)}" />
          <span>
            <strong>${escapeHtml(worker.nombre)}</strong>
            <small>DNI ${escapeHtml(worker.dni)}${
          worker.source ? ` · ${escapeHtml(worker.source)}` : ""
        }</small>
          </span>
        </label>`
      )
      .join("");
    if ($("#workerPickAll")) $("#workerPickAll").checked = false;
  }

  function filterWorkerPickList() {
    renderWorkerPickList(
      localSavedWorkersPool(),
      $("#workerPickQuery")?.value || ""
    );
  }

  function closeWorkerPick() {
    const sheet = $("#workerPick");
    if (!sheet) return;
    sheet.hidden = true;
    sheet.setAttribute("hidden", "");
    resetViewportLayout();
  }

  function applyWorkerPick() {
    const selected = $$("#workerPickList [data-pick-dni]:checked");
    if (!selected.length) {
      toast("Seleccione al menos un trabajador");
      return;
    }
    const pool = new Map(
      localSavedWorkersPool().map((worker) => [worker.dni, worker])
    );
    let added = 0;
    selected.forEach((input) => {
      const worker = pool.get(input.dataset.pickDni);
      if (!worker) return;
      if (pushHarvestWorker(worker.dni, worker.nombre)) added += 1;
    });
    closeWorkerPick();
    if (!added) {
      toast("Esos trabajadores ya están en este tipo");
      return;
    }
    toast(
      `${added} trabajador${added === 1 ? "" : "es"} agregado${added === 1 ? "" : "s"} a ${harvestTypeShort(state.harvest.tipo)}`
    );
  }

  function addHarvestWorker() {
    const dni = String($("#harvestWorkerDni")?.value || "").replace(/\D/g, "");
    const persona = lookupPersona(dni) || lookupSupervisor(dni);
    const msg = $("#harvestWorkerMsg");
    if (dni.length !== 8) {
      if (msg) msg.textContent = "El DNI debe tener exactamente 8 dígitos";
      return;
    }
    if (!persona?.nombre) {
      if (msg) {
        msg.textContent =
          "DNI no está en la base · toque el ícono de usuarios";
      }
      openManualWorker();
      return;
    }
    if (!pushHarvestWorker(dni, persona.nombre)) {
      if (msg) msg.textContent = "Este DNI ya está agregado";
      return;
    }
    if ($("#harvestWorkerDni")) $("#harvestWorkerDni").value = "";
    if ($("#harvestWorkerName")) $("#harvestWorkerName").value = "";
    if (msg) msg.textContent = "";
    $("#harvestWorkerDni")?.focus();
    toast("Trabajador agregado");
  }

  function saveManualWorker(e) {
    e?.preventDefault?.();
    const dni = String($("#manualWorkerDni")?.value || "")
      .replace(/\D/g, "")
      .slice(0, 8);
    const nombre = String($("#manualWorkerName")?.value || "").trim();
    if ($("#manualWorkerDni")) $("#manualWorkerDni").value = dni;
    if (dni.length !== 8) {
      toast("El DNI debe tener exactamente 8 dígitos");
      $("#manualWorkerDni")?.focus();
      return;
    }
    if (nombre.length < 3) {
      toast("Ingrese el nombre completo");
      $("#manualWorkerName")?.focus();
      return;
    }
    if (!pushHarvestWorker(dni, nombre, { fromManual: true })) return;
    if ($("#harvestWorkerDni")) $("#harvestWorkerDni").value = "";
    if ($("#harvestWorkerName")) $("#harvestWorkerName").value = "";
    if ($("#harvestWorkerMsg")) $("#harvestWorkerMsg").textContent = "";
    closeManualWorker();
    const identity = state.identity || getIdentity() || {};
    enqueueCloudData(
      "registrarManual",
      {
        fecha: todayISO(),
        horaGuardado: new Date().toISOString(),
        dni,
        nombre: nombre.toUpperCase(),
        supervisorDni: String(identity.dni || "").replace(/\D/g, ""),
        supervisorNombre: String(identity.nombre || "").trim().toUpperCase(),
      },
      `manual:${dni}`
    );
    flushCloudDataQueue().catch(() => {});
    toast(
      navigator.onLine
        ? "Trabajador guardado · enviando a Data Manuales"
        : "Trabajador guardado · pendiente de sincronizar"
    );
  }

  function onHarvestWorkersInput(e) {
    if (isHarvestTypeLocked(state.harvest.tipo)) return;
    const input = e.target.closest("[data-harvest-field]");
    if (!input) return;
    const row = input.closest("[data-worker-id]");
    const worker = state.harvest.workers.find((w) => w.id === row?.dataset.workerId);
    if (!worker) return;
    const field = input.dataset.harvestField;
    const raw = String(input.value || "").trim();
    worker[field] = raw === "" ? 0 : Math.max(0, num(raw));
    // Si quedó vacío o en cero, deja solo el placeholder "00".
    if (!worker[field]) input.value = "";
    const totalEl = row.querySelector(".harvest-worker-total");
    if (totalEl) totalEl.textContent = fmt(num(worker.manana) + num(worker.tarde));
    if ($("#harvestGrandTotal")) $("#harvestGrandTotal").textContent = fmt(harvestTotal());
    saveHarvest();
  }

  function onHarvestWorkersClick(e) {
    const personBtn = e.target.closest("[data-worker-id-open]");
    if (personBtn) {
      const row = personBtn.closest("[data-worker-id]");
      const worker = state.harvest.workers.find((w) => w.id === row?.dataset.workerId);
      if (worker) openWorkerIdModal(worker);
      return;
    }
    const btn = e.target.closest("[data-harvest-remove]");
    if (!btn) return;
    const row = btn.closest("[data-worker-id]");
    const worker = state.harvest.workers.find((w) => w.id === row?.dataset.workerId);
    if (!worker) return;
    confirmModal(
      "Quitar trabajador",
      `¿Quitar a ${worker.nombre} del registro de hoy?`,
      () => {
        state.harvest.workers = state.harvest.workers.filter(
          (w) => w.id !== worker.id
        );
        saveHarvest();
        renderHarvestWorkers();
        alertOk("Trabajador quitado", worker.nombre || "");
      }
    );
  }

  function openWorkerIdModal(worker) {
    const sheet = $("#workerIdModal");
    if (!sheet || !worker) return;
    const nombre = String(worker.nombre || "SIN NOMBRE").trim().toUpperCase();
    const dni = String(worker.dni || "").replace(/\D/g, "") || "—";
    if ($("#workerIdModalName")) $("#workerIdModalName").textContent = nombre;
    if ($("#workerIdModalDni")) $("#workerIdModalDni").textContent = dni;
    sheet.hidden = false;
    sheet.removeAttribute("hidden");
    sheet.style.display = "flex";
    hydrateIcons(sheet);
  }

  function closeWorkerIdModal() {
    const sheet = $("#workerIdModal");
    if (!sheet) return;
    sheet.hidden = true;
    sheet.setAttribute("hidden", "");
    sheet.style.display = "none";
    resetViewportLayout();
  }

  function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.hidden = true;
    }, 2200);
  }

  function swalReady() {
    return typeof window.Swal !== "undefined" && typeof window.Swal.fire === "function";
  }

  /** Confirmaciones bonitas (SweetAlert2). Si no carga, usa el modal clásico. */
  function confirmModal(title, body, onOk, okLabel = "Eliminar") {
    const label = String(okLabel || "Eliminar");
    const danger = /eliminar|quitar|vaciar|borrar|cerrar/i.test(
      `${title} ${label}`
    );

    if (swalReady()) {
      window.Swal.fire({
        title: String(title || "Confirmar"),
        text: String(body || ""),
        icon: danger ? "warning" : "question",
        showCancelButton: true,
        focusCancel: true,
        reverseButtons: true,
        confirmButtonText: label,
        cancelButtonText: "Cancelar",
        buttonsStyling: false,
        customClass: {
          popup: "qb-swal",
          title: "qb-swal-title",
          htmlContainer: "qb-swal-text",
          actions: "qb-swal-actions",
          confirmButton: danger
            ? "qb-swal-btn qb-swal-btn--danger"
            : "qb-swal-btn qb-swal-btn--ok",
          cancelButton: "qb-swal-btn qb-swal-btn--cancel",
          icon: "qb-swal-icon",
        },
      }).then((result) => {
        if (result.isConfirmed && typeof onOk === "function") onOk();
      });
      return;
    }

    const modal = $("#modal");
    const modalTitle = $("#modalTitle");
    const modalBody = $("#modalBody");
    const modalOk = $("#modalOk");
    if (!modal || !modalTitle || !modalBody) {
      if (typeof onOk === "function" && window.confirm(`${title}\n\n${body}`)) {
        onOk();
      }
      return;
    }
    modalTitle.textContent = title;
    modalBody.textContent = body;
    if (modalOk) modalOk.textContent = label;
    state.pendingConfirm = onOk;
    modal.hidden = false;
  }

  /** Aviso rápido OK (éxito / info) con SweetAlert si está disponible. */
  function alertOk(title, text = "") {
    if (!swalReady()) {
      toast(text || title);
      return;
    }
    window.Swal.fire({
      icon: "success",
      title: String(title || "Listo"),
      text: String(text || ""),
      timer: 1800,
      showConfirmButton: false,
      buttonsStyling: false,
      customClass: {
        popup: "qb-swal qb-swal--toastish",
        title: "qb-swal-title",
        htmlContainer: "qb-swal-text",
        icon: "qb-swal-icon",
      },
    });
  }
  function closeModal() {
    const modal = $("#modal");
    if (modal) modal.hidden = true;
    state.pendingConfirm = null;
    resetViewportLayout();
  }
  function closeSheets() {
    $$(".sheet").forEach((s) => (s.hidden = true));
  }
  function openSheet(id) {
    closeSheets();
    const el = document.getElementById(id);
    if (el) el.hidden = false;
  }

  function totals() {
    return state.guias.reduce(
      (acc, g) => {
        acc.jarras += num(g.jarras);
        acc.jabas += num(g.jabas);
        acc.guias += 1;
        return acc;
      },
      { guias: 0, jarras: 0, jabas: 0, cantidad: 0 }
    );
  }

  function updateKpis() {
    const t = totals();
    t.cantidad = t.jarras;
    const g = $("#kpiGuias");
    const gh = $("#kpiGuiasHero");
    const j = $("#kpiJarras");
    const b = $("#kpiJabas");
    const fj = $("#guidesFooterJarras");
    const fjb = $("#guidesFooterJabas");
    if (g) g.textContent = fmt(t.guias);
    if (gh) gh.textContent = `GUÍAS: ${String(t.guias).padStart(2, "0")}`;
    if (j) j.textContent = fmt(t.jarras);
    if (b) b.textContent = fmt(t.jabas);
    if (fj) fj.textContent = fmt(t.jarras);
    if (fjb) fjb.textContent = fmt(t.jabas);
  }

  function updateMeta() {
    /* Totales solo en el panel inferior (KPI). */
  }

  function updateClock() {
    renderDateWidgets(state.session.fecha || todayISO());
  }

  function updateNetworkUI() {
    state.online = navigator.onLine;
    const pending =
      loadVinculoQueue().length + loadCloudDataQueue().length;
    const onlineLabel = state.online ? "Con internet" : "Sin internet";
    const pendingLabel = `${pending} pendiente${pending === 1 ? "" : "s"}`;
    let label = onlineLabel;
    let mode = "is-online";
    if (!state.online) {
      label = pending ? "Sin internet · pendiente" : "Sin internet";
      mode = "is-offline";
    } else if (pending) {
      label = canUseCloudApi()
        ? `Pendiente · ${pending}`
        : isNativeApp()
          ? `Pendiente · ${pending} · sin nube`
        : `Pendiente · ${pending}`;
      mode = "is-pending";
    } else if (isNativeApp() && state.cloudApi) {
      label = "Con internet · nube OK";
      mode = "is-online";
    } else if (isNativeApp() && !state.cloudApi) {
      label = "Con internet · sin nube";
      mode = "is-pending";
    }

    document.querySelectorAll("#netPill, [data-net-status]").forEach((pill) => {
      pill.classList.remove("is-online", "is-offline", "is-pending");
      pill.classList.add(mode);
      pill.title = label;
      const txt = pill.querySelector(".status-text");
      if (txt) txt.textContent = label;
    });

    document.querySelectorAll("[data-net-online]").forEach((el) => {
      el.classList.toggle("is-online", !!state.online);
      el.classList.toggle("is-offline", !state.online);
      const t = el.querySelector(".net-online-text");
      if (t) t.textContent = onlineLabel;
      el.title = onlineLabel;
    });
    document.querySelectorAll("[data-net-pending]").forEach((el) => {
      el.classList.toggle("has-pending", pending > 0);
      const t = el.querySelector(".net-pending-text");
      if (t) t.textContent = pendingLabel;
      el.title = pendingLabel;
    });

    const chip = $("#netChip");
    const text = $("#netChipText");
    const lock = $("#netBadgeLock");
    if (chip) {
      chip.classList.toggle("is-offline", !state.online);
      chip.classList.toggle("is-pending", !!state.online && pending > 0);
    }
    if (text) text.textContent = label;
    const chipIco = $("#netChipIco");
    if (chipIco) {
      chipIco.innerHTML = ico(
        !state.online ? "wifiOff" : pending ? "cloud" : "wifi",
        "ico"
      );
    }
    if (lock) {
      lock.innerHTML = `${ico(state.online ? "wifi" : "wifiOff", "ico")} ${label}`;
    }
    const hint = $("#offlineHint");
    if (hint) {
      hint.textContent = !state.online
        ? "Sin internet · se guarda local y sube solo"
        : pending
          ? `${pending} pendiente(s) de subir`
          : "Conectado · puede subir a la nube";
    }
    updateClock();
  }

  function fieldRow(icon, label, field, value, opts = {}) {
    const type = opts.type || "text";
    const extra = opts.extra || "";
    const emptyQty =
      type === "number" &&
      (value === "" || value == null || String(value).trim() === "" || num(value) === 0);
    const ph = opts.placeholder || (type === "number" ? "00" : "");
    const valueAttr = emptyQty
      ? ""
      : value !== "" && value != null
        ? ` value="${escapeHtml(value)}"`
        : "";
    return `
      <label class="guia-field">
        <span class="gf-label">${ico(icon, "ico ico-sm")} ${label}</span>
        <input data-field="${field}" type="${type}"${valueAttr} placeholder="${escapeHtml(ph)}" autocomplete="off" ${extra} />
      </label>`;
  }

  function renderCards() {
    const root = $("#cards");
    if (!root) return;
    if (!state.guias.length) {
      root.innerHTML = `<div class="empty">${ico("clipboard", "ico")}<br/>Sin guías aún.<br/>Toque abajo para agregar una.</div>`;
      state.expandedGuiaId = null;
      state._guidesWarmed = true;
      updateKpis();
      updateMeta();
      return;
    }

    // Si no hay expandida válida, abrir la primera (solo al cargar).
    if (
      !state.expandedGuiaId ||
      !state.guias.some((g) => g.id === state.expandedGuiaId)
    ) {
      state.expandedGuiaId = state.guias[0].id;
    }

    root.innerHTML = state.guias
      .map((g, idx) => {
        const loteTriggerLabel = g.lote
          ? `Lote ${g.lote} · ${g.modulo || "—"} · T${g.turno || "—"}`
          : "Buscar lote";
        const numVal = formatNumeroGuiaInput(g.numeroGuia);
        const isOpen = g.id === state.expandedGuiaId;
        const collapsed = isOpen ? "" : " is-collapsed";
        return `
        <section class="guides-card harvest-field-card${collapsed}" data-id="${g.id}">
          <header class="guides-card-head">
            <div class="guides-card-index" aria-hidden="true">${String(idx + 1).padStart(2, "0")}</div>
            <div class="guides-num-wrap">
              <span class="guides-num-label">GUÍA</span>
              <div class="guides-num-field${numVal ? " is-filled" : ""}">
                <span class="guides-num-prefix">N°</span>
                <input
                  data-field="numeroGuia"
                  type="text"
                  inputmode="numeric"
                  maxlength="${GUIA_NUM_LEN}"
                  placeholder="000000"
                  value="${escapeHtml(numVal)}"
                  aria-label="Número de guía"
                  autocomplete="off"
                />
              </div>
            </div>
            <label class="guides-hora-field">
              <span class="guides-num-label">HORA</span>
              <input data-field="horaRecojo" type="text" inputmode="numeric" placeholder="09:15" value="${escapeHtml(g.horaRecojo || "")}" autocomplete="off" aria-label="Hora recojo" readonly />
            </label>
            <button
              type="button"
              class="guides-card-toggle"
              data-act="toggle-guia"
              aria-label="Expandir o colapsar guía"
              aria-expanded="${isOpen ? "true" : "false"}"
            >
              <span data-icon="chevronDown"></span>
            </button>
            <button type="button" class="guides-card-del" data-act="del-guia" aria-label="Quitar guía">
              <span data-icon="trash"></span>
            </button>
          </header>

          <div class="guides-card-body">
            <div class="harvest-section-title">
              <div>
                <small>UBICACIÓN DE COSECHA</small>
                <h2>Seleccione el lote</h2>
          </div>
              </div>
            <label class="harvest-lote-control">
              <span class="sr-only">Lote</span>
              <button type="button" class="select-trigger harvest-lote-trigger" data-pick="lote" aria-label="Seleccionar lote">
                <span class="${g.lote ? "" : "ph"}">${escapeHtml(loteTriggerLabel)}</span>
                <span class="chev" data-icon="search"></span>
              </button>
            </label>
            <div class="harvest-location-grid">
              <div><small>MODULO</small><strong>${escapeHtml(g.modulo || "—")}</strong></div>
              <div><small>TURNO</small><strong>${escapeHtml(g.turno || "—")}</strong></div>
              <div><small>VARIEDAD</small><strong>${escapeHtml(g.variedad || "—")}</strong></div>
            </div>

            <div class="harvest-section-title guides-section-gap">
              <div>
                <small>CANTIDADES</small>
                <h2>1 jaba = 12 jarras</h2>
          </div>
          </div>
            <div class="harvest-add-box guides-qty-box">
              <div class="guides-qty-grid">
              <label class="guides-qty-field">
                <span>Jarras</span>
                <input data-field="jarras" type="number" inputmode="numeric" min="0" step="1" placeholder="00" value="${num(g.jarras) > 0 ? num(g.jarras) : ""}" autocomplete="off" />
              </label>
              <label class="guides-qty-field">
                <span>Jabas</span>
                <input data-field="jabas" type="number" inputmode="numeric" min="0" step="1" placeholder="00" value="${num(g.jabas) > 0 ? num(g.jabas) : ""}" autocomplete="off" />
              </label>
              </div>
            </div>
          </div>
        </section>`;
      })
      .join("");

    hydrateIcons(root);
    state._guidesWarmed = true;
    updateKpis();
    updateMeta();
  }

  function addGuiaAndOpen() {
    const nueva = emptyGuia();
    state.guias.push(nueva);
    state.expandedGuiaId = nueva.id;
    saveStore();
    renderCards();
    $("#cards")?.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function findGuia(id) {
    return state.guias.find((g) => g.id === id);
  }

  function parseHHMM(value) {
    const m = String(value || "")
      .trim()
      .match(/^(\d{1,2})\s*:\s*(\d{1,2})/);
    if (!m) return null;
    const hh = Math.max(0, Math.min(23, num(m[1])));
    const mm = Math.max(0, Math.min(59, num(m[2])));
    return { hh, mm };
  }

  function formatHHMM(hh, mm) {
    const H = String(Math.max(0, Math.min(23, num(hh)))).padStart(2, "0");
    const M = String(Math.max(0, Math.min(59, num(mm)))).padStart(2, "0");
    return `${H}:${M}`;
  }

  function roundMinutesTo5(hh, mm) {
    const total = Math.max(0, Math.min(23, num(hh))) * 60 + Math.max(0, Math.min(59, num(mm)));
    const rounded = Math.round(total / 5) * 5;
    const hh2 = Math.floor(rounded / 60) % 24;
    const mm2 = rounded % 60;
    return { hh: hh2, mm: mm2 };
  }

  function syncHoraPickerUI() {
    const modal = $("#horaPickerModal");
    if (!modal || modal.hidden) return;
    const draft = state.timePickerDraft;
    if (!draft) return;
    const hh = String(draft.hh).padStart(2, "0");
    const mm = String(draft.mm).padStart(2, "0");
    $("#horaPickerHour") && ($("#horaPickerHour").textContent = hh);
    $("#horaPickerMin") && ($("#horaPickerMin").textContent = mm);
    $("#horaPickerNow") && ($("#horaPickerNow").textContent = `${hh}:${mm}`);
  }

  function openHoraRecojoPicker(guiaId) {
    const modal = $("#horaPickerModal");
    if (!modal) return;
    const guia = findGuia(guiaId);
    if (!guia) return;
    const parsed = parseHHMM(guia.horaRecojo);
    const d = new Date();
    const hh = parsed ? parsed.hh : d.getHours();
    const mm = parsed ? parsed.mm : d.getMinutes();

    state.timePicker = { guiaId };
    state.timePickerDraft = { hh, mm };

    modal.hidden = false;
    modal.removeAttribute("hidden");
    modal.style.display = "grid";
    syncHoraPickerUI();
    resetViewportLayout();
  }

  function closeHoraRecojoPicker() {
    const modal = $("#horaPickerModal");
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("hidden", "");
    modal.style.display = "none";
    state.timePicker = null;
    state.timePickerDraft = null;
    resetViewportLayout();
  }

  function applyHoraRecojoFromPicker({ roundTo5 = false } = {}) {
    const ctx = state.timePicker;
    const guia = ctx ? findGuia(ctx.guiaId) : null;
    const draft = state.timePickerDraft;
    if (!guia || !draft) return;

    let hh = draft.hh;
    let mm = draft.mm;
    if (roundTo5) {
      const r = roundMinutesTo5(hh, mm);
      hh = r.hh;
      mm = r.mm;
    }

    guia.horaRecojo = formatHHMM(hh, mm);

    const article = $(`#cards [data-id="${guia.id}"]`);
    const input = article?.querySelector('input[data-field="horaRecojo"]');
    if (input) input.value = guia.horaRecojo;

    saveStore();
    updateKpis();
    updateMeta();
    if ($("#guidesSummaryModal") && !$("#guidesSummaryModal").hidden) {
      renderGuidesSummaryCard();
    }

    closeHoraRecojoPicker();
  }

  function applyJabaJarra(el, guia) {
    const field = el.dataset.field;
    if (field === "jabas") {
      const raw = String(el.value || "").replace(/[^\d.]/g, "");
      const n = raw === "" ? 0 : num(raw);
      guia.jabas = n > 0 ? n : "";
      if (!n) el.value = "";
      const article = el.closest(".guides-card");
      const jarrasInput = article?.querySelector('[data-field="jarras"]');
      if (n > 0) {
        guia.jarras = n * JARRAS_POR_JABA;
        if (jarrasInput) jarrasInput.value = String(guia.jarras);
      } else {
        guia.jarras = "";
        if (jarrasInput) jarrasInput.value = "";
      }
    } else if (field === "jarras") {
      const raw = String(el.value || "").replace(/[^\d.]/g, "");
      const n = raw === "" ? 0 : num(raw);
      guia.jarras = n > 0 ? n : "";
      if (!n) el.value = "";
    }
  }

  function onCardsClick(e) {
    const pickBtn = e.target.closest("[data-pick]");
    if (pickBtn) {
      const article = pickBtn.closest(".guides-card");
      const guia = findGuia(article?.dataset.id);
      const kind = pickBtn.dataset.pick;
      if (guia && kind === "lote") {
        openPicker(kind, guia.id);
      }
      return;
    }

    const horaInput = e.target?.closest?.('input[data-field="horaRecojo"]');
    if (horaInput) {
      const article = horaInput.closest(".guides-card");
      const guia = findGuia(article?.dataset.id);
      if (!guia) return;
      e.preventDefault();
      e.stopPropagation();
      openHoraRecojoPicker(guia.id);
      return;
    }

    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === "add-guia") {
      if (!requireQrLogin()) return;
      addGuiaAndOpen();
      return;
    }

    const article = btn.closest(".guides-card");
    if (act === "toggle-guia") {
      if (!article) return;
      const id = article.dataset.id || "";
      const wasCollapsed = article.classList.contains("is-collapsed");
      if (wasCollapsed) {
        // Abrir solo esta; cerrar las demás
        state.expandedGuiaId = id;
        $$("#cards .guides-card").forEach((card) => {
          const open = card.dataset.id === id;
          card.classList.toggle("is-collapsed", !open);
          const t = card.querySelector('[data-act="toggle-guia"]');
          if (t) t.setAttribute("aria-expanded", open ? "true" : "false");
        });
      } else {
        article.classList.add("is-collapsed");
        btn.setAttribute("aria-expanded", "false");
        if (state.expandedGuiaId === id) state.expandedGuiaId = null;
      }
      return;
    }

    const guia = findGuia(article?.dataset.id);
    if (!guia) return;

    if (act === "del-guia") {
      const doDel = () => {
        state.guias = state.guias.filter((g) => g.id !== guia.id);
        if (state.expandedGuiaId === guia.id) {
          state.expandedGuiaId = state.guias.length
            ? state.guias[state.guias.length - 1].id
            : null;
        }
        saveStore();
        renderCards();
        alertOk("Guía eliminada");
      };
      if (guiaHasData(guia)) {
        confirmModal("Quitar guía", "Esta guía tiene datos. ¿Eliminarla?", doDel);
      } else doDel();
    }
  }

  function onCardsInput(e) {
    const el = e.target;
    if (!el.dataset.field) return;
    const article = el.closest(".guides-card");
    const guia = findGuia(article?.dataset.id);
    if (!guia) return;
    const field = el.dataset.field;

    if (field === "numeroGuia") {
      guia.numeroGuia = normalizeNumeroGuia(el.value);
      el.value = guia.numeroGuia;
      const wrap = el.closest(".guides-num-field");
      wrap?.classList.toggle("is-filled", !!guia.numeroGuia);
    } else if (field === "jabas" || field === "jarras") {
      applyJabaJarra(el, guia);
    } else if (field === "horaRecojo") {
      guia.horaRecojo = el.value.trim();
    }

    saveStore();
    updateKpis();
    updateMeta();
    if ($("#guidesSummaryModal") && !$("#guidesSummaryModal").hidden) {
      renderGuidesSummaryCard();
    }
  }

  function onCardsBlur(e) {
    const el = e.target;
    if (el?.dataset?.field !== "numeroGuia") return;
    const article = el.closest(".guides-card");
    const guia = findGuia(article?.dataset.id);
    if (!guia) return;
    guia.numeroGuia = normalizeNumeroGuia(el.value);
    el.value = formatNumeroGuiaInput(guia.numeroGuia);
    saveStore();
  }

  function bindDniLookup(dniId, nombreId) {
    const dniEl = $(dniId);
    const nomEl = $(nombreId);
    if (!dniEl || !nomEl) return;
    const apply = () => {
      const dni = dniEl.value.replace(/\D/g, "");
      dniEl.value = dni;
      const found = lookupNombre(dni);
      nomEl.value = found || "";
    };
    dniEl.addEventListener("input", apply);
    dniEl.addEventListener("blur", apply);
  }

  function rowsFromGuias() {
    const s = state.session;
    const rows = [];
    state.guias.forEach((g, gi) => {
      rows.push({
        Nro: String(gi + 1),
        NumeroGuia: formatNumeroGuiaDisplay(g.numeroGuia),
        Fundo: currentFundo(),
      SupervisorDNI: s.supervisorDni,
      Supervisor: s.supervisorNombre,
        JaveroDNI: "",
        Javero: "",
        Fecha: s.fecha || todayISO(),
      Modulo: g.modulo,
      Turno: g.turno,
      Lote: g.lote,
      Variedad: g.variedad,
      Jarras: num(g.jarras),
      Jabas: num(g.jabas),
        HoraRecojo: g.horaRecojo || "",
      });
    });
    return rows;
  }

  function dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }

  /**
   * Descarga un .xlsx de forma fiable en PWA / celular / tablet.
   * No limpia datos de la app. Devuelve true si el archivo se disparó.
   */
  function downloadXlsxWorkbook(wb, filename) {
    const name = String(filename || `qberries-${dateStamp()}.xlsx`).replace(
      /[^\w.\- ()]+/g,
      "_"
    );
    if (typeof XLSX === "undefined") {
      toast("Excel no disponible · recargue la app");
      return false;
    }
    try {
      const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([new Uint8Array(bytes)], {
        type: XLSX_SHARE_MIME,
      });
      // Descargar = descarga. Compartir nativo solo vía botón Compartir Excel.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
          a.remove();
        } catch {
          /* ignore */
        }
      }, 2500);
      return true;
    } catch (err) {
      try {
        XLSX.writeFile(wb, name);
        return true;
      } catch {
        console.warn("downloadXlsxWorkbook", err);
        toast("No se pudo descargar el Excel");
        return false;
      }
    }
  }

  function exportExcel(opts = {}) {
    if (!requireQrLogin()) return false;
    if (typeof XLSX === "undefined") {
      if (!opts.silent) toast("Excel no disponible");
      return false;
    }
    const rows = rowsFromGuias();
    if (!rows.length) {
      if (!opts.silent) toast("No hay guías para exportar");
      return false;
    }
    const t = totals();
    rows.push({
      Nro: "",
      NumeroGuia: "",
      Fundo: "",
      SupervisorDNI: "",
      Supervisor: "",
      JaveroDNI: "",
      Javero: "",
      Fecha: "",
      Modulo: "",
      Turno: "",
      Lote: "TOTAL",
      Variedad: "",
      Jarras: t.jarras,
      Jabas: t.jabas,
      HoraRecojo: "",
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Guias");
    const ok = downloadXlsxWorkbook(wb, `guias-cosecha-${dateStamp()}.xlsx`);
    if (ok && !opts.silent) toast("Excel descargado");
    return ok;
  }

  function exportPdf() {
    if (!requireQrLogin()) return;
    const jspdf = window.jspdf?.jsPDF;
    if (!jspdf) {
      toast("PDF no disponible");
      return;
    }
    const s = state.session;
    const t = totals();
    const doc = new jspdf({ unit: "pt", format: "a4" });
    let y = 40;
    doc.setFontSize(13);
    doc.text("QBerries · Guías de cosecha", 40, y);
    y += 18;
    doc.setFontSize(10);
    doc.text(`Fundo ${s.fundo} · ${s.fecha}`, 40, y);
    y += 14;
    doc.text(
      `Supervisor: ${s.supervisorNombre} (${s.supervisorDni}) · Javero: ${s.javeroNombre} (${s.javeroDni})`,
      40,
      y
    );
    y += 14;
    doc.text(
      `TOTALES: ${t.guias} guías · ${fmt(t.jarras)} jarras · ${fmt(t.jabas)} jabas`,
      40,
      y
    );
    y += 20;
    state.guias.forEach((g, i) => {
      if (y > 760) {
        doc.addPage();
        y = 40;
      }
      doc.text(
        `Guía ${i + 1}: ${g.grupo || "—"} · ${g.lote || "—"} · ${g.modulo || "—"} / T${g.turno || "—"} · ${g.variedad || "—"} · ${fmt(num(g.jarras))} j / ${fmt(num(g.jabas))} b`,
        40,
        y
      );
      y += 16;
    });
    doc.save(`guias-cosecha-${dateStamp()}.pdf`);
    toast("PDF guardado");
  }

  async function syncToCloud() {
    if (!requireQrLogin()) return;
    if (state.savingGuias) return;
    if (!state.guias.length) {
      toast("No hay guías para subir");
      return;
    }

    state.savingGuias = true;
    const payload = persistAndQueueGuias();
    if (!payload) {
      state.savingGuias = false;
      toast("Falta supervisor para subir");
      return;
    }

    if (!navigator.onLine) {
      state.savingGuias = false;
      toast("Guardado en el celular · pendiente hasta tener internet");
      return;
    }

    toast("Subiendo…");
    try {
      const result = await flushCloudDataQueue();
      if (result?.sent > 0 && result.remain === 0) {
        toast("Guías subidas al servidor");
      } else if (result?.remain > 0) {
        toast("Pendiente de subir · se reintentará solo");
      }
    } catch {
      toast("Guardado en el celular · pendiente hasta tener internet");
    } finally {
      state.savingGuias = false;
    }
  }

  function vaciarRegistro() {
    confirmModal(
      "Vaciar guías",
      "Se borrarán todas las guías. La sesión del supervisor se mantiene.",
      () => {
        state.guias = [];
        saveStore();
        renderCards();
        alertOk("Guías vaciadas", "Puede volver a registrar");
      }
    );
  }

  async function verifyPinRemote(pin, dni) {
    const res = await fetch(API.login, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, dni }),
    });
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok && data.ok === true,
      error: data.error,
      token: String(data.token || ""),
    };
  }

  async function detectNetlify(timeoutMs) {
    if (!navigator.onLine) {
      state.netlifyReady = false;
      state.cloudApi = false;
      return false;
    }

    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl
      ? setTimeout(() => ctrl.abort(), Math.max(1200, timeoutMs || 3500))
      : 0;
    try {
      const res = await fetch(API.sync, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ping", pin: sessionPin() || "" }),
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (res.status === 405) {
        state.netlifyReady = false;
        state.cloudApi = false;
        return false;
      }
      state.netlifyReady =
        res.status === 200 || res.status === 401 || res.status === 500 || res.status === 502;
      state.cloudApi = res.status !== 404 && res.status !== 405;
      if (res.status === 200) {
        await res.json().catch(() => ({}));
      }
      return !!state.cloudApi;
    } catch {
      state.netlifyReady = false;
      state.cloudApi = false;
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function attemptLogin(pin) {
    if (state.unlocking) return;
    const password = String(pin || "").trim();
    const identity = state.pendingIdentity;
    if (!identity?.dni) {
      lock();
      return;
    }
    if (!password) {
      const m = $("#pinMsg");
      if (m) m.textContent = "Ingrese la contraseña";
      return;
    }
    state.unlocking = true;
    const msg = $("#pinMsg");
    if (msg) msg.textContent = "Verificando…";
    const btn = $("#btnLogin");
    const lock = $("#lockScreen");
    if (lock) lock.classList.add("is-busy");
    setBtnLoading(btn, true, "Verificando…");
    showAppLoader("Verificando contraseña…");
    try {
      if (!navigator.onLine) {
        if (msg) msg.textContent = "Necesita internet para validar el primer acceso";
        hideAppLoader();
        return;
      }
      const result = await verifyPinRemote(password, identity.dni);
      if (result.ok && result.token) {
        const loaderMsg = $("#appLoaderMsg");
        if (loaderMsg) loaderMsg.textContent = "Entrando a la app…";
        afterQrLogin(identity, result.token);
        toast("Identidad confirmada");
      } else {
        hideAppLoader();
        if (msg) msg.textContent = result.error || "Contraseña incorrecta";
        if ($("#loginPass")) {
          $("#loginPass").value = "";
          $("#loginPass").focus();
        }
      }
    } catch {
      hideAppLoader();
      if (msg) msg.textContent = "No se pudo validar. Revise su conexión";
    } finally {
      state.unlocking = false;
      if (lock) lock.classList.remove("is-busy");
      setBtnLoading(btn, false);
    }
  }

  function cambiarPin() {
    const actual = prompt("Contraseña actual:");
    if (actual === null) return;
    if (actual !== getPin()) {
      toast("Contraseña actual incorrecta");
      return;
    }
    const nuevo = prompt("Nueva contraseña (mín. 6):");
    if (nuevo === null) return;
    if (String(nuevo).trim().length < 6) {
      toast("Demasiado corta");
      return;
    }
    const otro = prompt("Confirme la nueva contraseña:");
    if (otro !== nuevo) {
      toast("No coinciden");
      return;
    }
    setPin(String(nuevo).trim());
    toast("Contraseña actualizada");
  }

  async function importPersonas(file) {
    if (typeof XLSX === "undefined") {
      toast("Lector Excel no cargado");
      return;
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    let n = 0;
    data.forEach((r, i) => {
      if (i === 0 && String(r[0]).toLowerCase().includes("dni")) return;
      const dni = String(r[0] ?? "").replace(/\D/g, "");
      const nombre = String(r[1] ?? "").trim();
      if (dni && nombre) {
        state.personas[dni] = {
          nombre: nombre.toUpperCase(),
          cargo: String(r[2] ?? "").trim().toUpperCase(),
        };
        n += 1;
      }
    });
    savePersonas();
    toast(`${n} personas cargadas`);
  }

  function bindPhoneHandlers() {
    on("#cards", "click", onCardsClick);
    on("#cards", "input", onCardsInput);
    on("#cards", "change", onCardsInput);
    on("#cards", "focusout", onCardsBlur);

    on("#pickerClose", "click", closePicker);
    on("#pickerAdd", "click", onPickerAdd);
    on("#pickerQuery", "input", renderPickerList);
    on("#pickerList", "click", (e) => {
      const item = e.target.closest("[data-pick-value]");
      if (!item) return;
      applyPickerValue(item.dataset.pickValue);
    });
    on("#picker", "click", (e) => {
      if (e.target?.id === "picker") closePicker();
    });

    bindDniLookup("#sesSupDni", "#sesSupNombre");
    bindDniLookup("#sesJavDni", "#sesJavNombre");

    on("#btnGuidesResumen", "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!requireQrLogin()) return;
      openGuidesSummary();
    });
    on("#btnCloseGuidesSummary", "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (state.savingGuias) return;
      closeGuidesSummary();
    });
    on("#btnCancelGuidesSummary", "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (state.savingGuias) return;
      closeGuidesSummary();
    });
    on("#btnSaveGuidesSummary", "click", saveGuidesSummary);
    on("#btnGuidesFundo", "click", () => openPicker("fundo"));
    on("#btnGuidesLic", "click", () => openPicker("guidesLic"));
    on("#guidesSummaryModal", "click", (e) => {
      if (state.savingGuias) return;
      if (e.target?.id === "guidesSummaryModal") closeGuidesSummary();
    });
    // Clicks dentro del diálogo no cierran el modal
    on(".guides-summary-dialog", "click", (e) => {
      e.stopPropagation();
    });

    on("#horaPickerModal", "click", (e) => {
      const step = e.target?.closest?.("[data-hora-act]");
      if (!step || !state.timePickerDraft) return;
      const act = step.dataset.horaAct;

      if (act === "hour-inc") state.timePickerDraft.hh = (state.timePickerDraft.hh + 1) % 24;
      if (act === "hour-dec") state.timePickerDraft.hh = (state.timePickerDraft.hh + 23) % 24;
      if (act === "min-inc") state.timePickerDraft.mm = (state.timePickerDraft.mm + 1) % 60;
      if (act === "min-dec") state.timePickerDraft.mm = (state.timePickerDraft.mm + 59) % 60;

      syncHoraPickerUI();
    });

    on("#horaPickerModal", "click", (e) => {
      // Cerrado si se toca el backdrop, no el contenido.
      if (e.target?.id === "horaPickerModal") closeHoraRecojoPicker();
    });

    on("#btnHoraExacta", "click", () => applyHoraRecojoFromPicker({ roundTo5: false }));
    on("#btnHoraCancelar", "click", closeHoraRecojoPicker);
    on("#btnHoraConfirmar", "click", () => applyHoraRecojoFromPicker({ roundTo5: true }));

    on("#btnSecBack", "click", () => {
      stopCamera();
      lock();
    });
    on("#btnThanksRescan", "click", () => {
      cancelRegistroRedirect();
      stopCamera();
      const screen = $("#vinculoScreen");
      if (screen) screen.classList.remove("is-thanks");
      const thanks = $("#vinculoThanks");
      if (thanks) thanks.hidden = true;
      lock();
    });
    on("#btnThanksContinue", "click", () => {
      cancelRegistroRedirect();
      goTo("registro");
    });
    on("#btnVinculoBack", "click", () => {
      cancelRegistroRedirect();
      goTo("registro");
    });
    on("#appTopnav", "click", (e) => {
      const btn = e.target?.closest?.("[data-tab]");
      if (!btn) return;
      // Se marca al instante: la pestaña responde aunque la página tarde en abrir.
      markTabPressed(btn.dataset.tab);
      onTabbarClick(btn.dataset.tab);
    });
    on("#btnHomeProfile", "click", openProfileModal);
    on("#btnCloseProfile", "click", closeProfileModal);
    on("#profileModal", "click", (e) => {
      if (e.target?.id === "profileModal") closeProfileModal();
    });
    on("#btnProfileLogout", "click", () => {
      closeProfileModal();
      confirmModal(
        "Cerrar sesión",
        "¿Está seguro de cerrar sesión? Tendrá que escanear su carnet otra vez.",
        () => lock(),
        "Cerrar sesión"
      );
    });
    on("#btnHarvestSave", "click", previewHarvestSummary);
    on("#harvestDayChecklist", "click", (e) => {
      const item = e.target?.closest?.("[data-harvest-check]");
      if (!item) return;
      e.preventDefault();
      openHarvestChecklistPreview(item.dataset.harvestCheck);
    });
    on("#btnCommitHarvest", "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      commitHarvestSnapshot();
    });
    on("#btnCloseExportPreview", "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      requestCloseExportPreview();
    });
    on("#exportPreview", "click", (e) => {
      if (e.target?.id === "exportPreview") requestCloseExportPreview();
    });
    on(".export-preview", "click", (e) => {
      e.stopPropagation();
    });
    on("#btnDownloadHarvest", "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      downloadHarvestSnapshot(state.activeExportSnapshot, { single: true });
    });
    on("#btnUploadDriveHarvest", "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadActiveHarvestToDrive(e.currentTarget);
    });
    on("#exportPreviewTypes", "click", (e) => {
      const btn = e.target?.closest?.("[data-preview-type]");
      if (!btn || btn.disabled) return;
      const tipo = btn.dataset.previewType;
      // Refresca desde caché local (byType) para no perder jarras/trabajadores
      saveHarvest();
      const snapshot =
        previewSnapshotsMap(state.activeExportSnapshot)[tipo] ||
        snapshotFromTypeDraft(tipo);
      if (!snapshot) return;
      if (!isSnapshotSaved(snapshot)) rememberPreviewDraft(snapshot);
      openExportPreview(snapshot, { saved: isSnapshotSaved(snapshot) });
    });
    on("#btnCopyYesterdayWorkers", "click", copyYesterdayWorkers);
    on("#btnCloseWorkerPick", "click", closeWorkerPick);
    on("#workerPick", "click", (e) => {
      if (e.target?.id === "workerPick") closeWorkerPick();
    });
    on("#workerPickAll", "change", (e) => {
      $$("#workerPickList [data-pick-dni]").forEach((input) => {
        input.checked = !!e.target.checked;
      });
    });
    on("#workerPickQuery", "input", filterWorkerPickList);
    on("#btnWorkerPickAdd", "click", applyWorkerPick);
    on("#btnCloseReadyFiles", "click", closeReadyFiles);
    on("#readyFiles", "click", (e) => {
      if (e.target?.id === "readyFiles") closeReadyFiles();
    });
    on("#readyFilesAll", "change", (e) => {
      $$("#readyFilesList [data-ready-id]").forEach((input) => {
        input.checked = !!e.target.checked;
      });
    });
    on("#readyFilesList", "change", (e) => {
      if (!e.target?.matches?.("[data-ready-id]")) return;
      const boxes = $$("#readyFilesList [data-ready-id]");
      const allBox = $("#readyFilesAll");
      if (!allBox || !boxes.length) return;
      allBox.checked = boxes.every((input) => input.checked);
    });
    on("#btnReadyFilesGo", "click", confirmReadyFiles);
    on("#btnReadyFilesAllSend", "click", () => {
      const all = state.readyFilesItems?.length
        ? state.readyFilesItems
        : availableExportSnapshots();
      if (!all.length) {
        toast("Aún no hay archivos listos");
        return;
      }
      closeReadyFiles();
      shareOneExcelNative(all[0]);
      if (all.length > 1) {
        toast("Compartiendo 1 Excel. Repita para los demás.");
      }
    });
    on("#btnCloseHistory", "click", closeHarvestHistory);
    on("#historyTabs", "click", (e) => {
      const btn = e.target?.closest?.("[data-history-tab]");
      if (btn) switchHistoryTab(btn.dataset.historyTab);
    });
    on("#btnHistoryPrev", "click", () => {
      if (state.historyPage <= 0) return;
      state.historyPage -= 1;
      renderHarvestHistory();
      $("#historyList")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
    on("#btnHistoryNext", "click", () => {
      state.historyPage += 1;
      renderHarvestHistory();
      $("#historyList")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
    on("#btnGuiasHistoryPrev", "click", () => {
      if ((state.guiasHistoryPage || 0) <= 0) return;
      state.guiasHistoryPage -= 1;
      renderGuiasHistory();
    });
    on("#btnGuiasHistoryNext", "click", () => {
      state.guiasHistoryPage = (state.guiasHistoryPage || 0) + 1;
      renderGuiasHistory();
    });
    on("#historyList", "click", (e) => {
      const button = e.target?.closest?.("[data-history-action]");
      const item = e.target?.closest?.("[data-history-id]");
      if (!button || !item) return;
      const snapshot = historySnapshotById(item.dataset.historyId);
      if (!snapshot) return;
      const action = button.dataset.historyAction;
      if (action === "preview") {
        closeHarvestHistory();
        openExportPreview(snapshot);
      } else if (action === "download") {
        downloadHarvestSnapshot(snapshot, { single: true });
      } else if (action === "drive") {
        uploadOrQueueHarvestToDrive(snapshot, button);
      }
    });
    on("#btnHarvestLogout", "click", () => {
      confirmModal(
        "Cerrar sesión",
        "¿Está seguro de cerrar sesión? Tendrá que escanear su carnet otra vez.",
        () => lock(),
        "Cerrar sesión"
      );
    });
    on("#btnHarvestLote", "click", () => openPicker("harvestLote"));
    on("#btnHarvestType", "click", () => openPicker("harvestType"));
    on("#btnManualWorker", "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openManualWorker();
    });
    // Respaldo: cualquier clic en el ícono de usuarios abre el modal
    on("#harvestScreen", "click", (e) => {
      const btn = e.target?.closest?.("#btnManualWorker, .harvest-users-btn");
      if (!btn) return;
      e.preventDefault();
      openManualWorker();
    });
    on("#btnCloseManualWorker", "click", closeManualWorker);
    on("#manualWorker", "click", (e) => {
      if (e.target?.id === "manualWorker") closeManualWorker();
    });
    on("#manualWorkerForm", "submit", saveManualWorker);
    on("#manualWorkerDni", "input", (e) => {
      e.target.value = String(e.target.value || "")
        .replace(/\D/g, "")
        .slice(0, 8);
    });
    on("#harvestWorkerDni", "input", previewHarvestWorker);
    on("#harvestWorkerForm", "submit", (e) => {
      e.preventDefault();
      addHarvestWorker();
    });
    on("#harvestWorkers", "input", onHarvestWorkersInput);
    on("#harvestWorkers", "click", onHarvestWorkersClick);
    on("#btnCloseWorkerId", "click", closeWorkerIdModal);
    on("#workerIdModal", "click", (e) => {
      if (e.target?.id === "workerIdModal") closeWorkerIdModal();
    });
    on("#btnStartCam", "click", () => startCamera());
    on("#btnStopCam", "click", stopCamera);
    on("#btnVinGrupoLic", "click", () => openPicker("grupoLic"));
    on("#btnVinGrupo", "click", () => openPicker("grupoNum"));

    on("#vinculoForm", "submit", async (e) => {
      e.preventDefault();
      if (!requireQrLogin()) return;
      const id = state.identity || getIdentity();
      const rawCel = String($("#vinCelular")?.value || "").trim();
      if (rawCel && /[^\d\s\-()+]/.test(rawCel)) {
        toast("El celular debe ser solo números");
        return;
      }
      const celular = rawCel.replace(/\D/g, "");
      if (!/^9\d{8}$/.test(celular)) {
        toast("Celular inválido: 9 dígitos y debe empezar con 9");
        return;
      }
      const grupoLic = String($("#vinGrupoLic")?.value || "").trim().toUpperCase();
      const grupo = String($("#vinGrupo")?.value || "").trim().toUpperCase();
      if (!isValidGrupoLic_(grupoLic)) {
        toast("Elija Grupo LIC o No tengo");
        openPicker("grupoLic");
        return;
      }
      if (!isValidGrupoNum_(grupo)) {
        toast("Elija Grupo o No tengo");
        openPicker("grupoNum");
        return;
      }
      const supervisorGlobal = String($("#vinEncargado")?.value || "")
        .trim()
        .replace(/\s+/g, " ")
        .toUpperCase();
      if (!supervisorGlobal || supervisorGlobal.length < 3) {
        toast("Escriba el nombre del supervisor global");
        return;
      }
      const hora = new Date().toLocaleString("es-PE", { hour12: true });
      const payload = buildVinculoPayload({
        dni: id.dni,
        nombre: id.nombre || "",
        celular,
        grupoLic,
        grupo,
        supervisorGlobal,
        dniSesion: id.dni,
        horaRegistro: hora,
        hora,
      });
      markVinculoDone(id.dni, celular, supervisorGlobal, grupo, grupoLic);
      if (state.personas[id.dni]) {
        state.personas[id.dni].celular = celular;
        savePersonas();
      }
      enqueueVinculo(payload);
      const vinBtn = $("#vinculoForm")?.querySelector('[type="submit"]');
      setBtnLoading(vinBtn, true, "Guardando…");
      showAppLoader("Guardando datos…");
      showVinculoThanks({
        dni: id.dni,
        nombre: id.nombre || "",
      });
      scheduleRegistroRedirect();

      // Sin internet: guarda local y sube al reconectar
      if (!navigator.onLine) {
        setBtnLoading(vinBtn, false);
        hideAppLoader();
        toast("Guardado · se enviará con internet");
        setThanksSyncStatus(
          "Sin internet · guardado en el celular · se subirá al reconectar",
          "is-pending"
        );
        return;
      }

      setThanksSyncStatus("Detectando internet · enviando…", "is-pending");
      (async () => {
        const ready = await ensureCloudReady_(2500);
        if (!ready) {
          toast("Guardado · pendiente de subir");
          setThanksSyncStatus(
            "Guardado en el celular · pendiente de subir",
            "is-pending"
          );
          return;
        }
        setThanksSyncStatus("Enviando…", "is-pending");
        try {
          const result = await flushVinculoQueue();
          if (result.sent > 0 && result.remain === 0) {
            const already =
              result.alreadyRegistered ||
              /ya se tiene (este )?dni registrado/i.test(String(result.message || ""));
            setThanksSyncStatus(
              already
                ? "Ya se tiene este DNI registrado"
                : "Fue guardado correctamente",
              "is-ok"
            );
          } else if (!navigator.onLine) {
            setThanksSyncStatus(
              "Sin internet · se subirá al reconectar",
              "is-pending"
            );
          } else {
            setThanksSyncStatus(
              result.reason && result.reason !== "ok"
                ? `No subió: ${result.reason}`
                : "Pendiente de subir",
              "is-err"
            );
            toast("No se pudo subir · reintente");
          }
        } catch {
          setThanksSyncStatus(
            "Guardado local · se reintentará",
            "is-pending"
          );
        } finally {
          setBtnLoading(vinBtn, false);
          hideAppLoader();
        }
      })();
      return;
    });

    on("#sessionForm", "submit", (e) => {
      e.preventDefault();
      if (!requireQrLogin()) return;
      const next = readSessionForm();
      if (!next.fundo || !next.supervisorDni || !next.javeroDni) {
        toast("Complete fundo y DNIs");
        return;
      }
      if (!next.supervisorNombre || !next.javeroNombre) {
        toast("Complete los nombres");
        return;
      }
      if (!next.fecha) next.fecha = todayISO();
      rememberPersona(next.supervisorDni, next.supervisorNombre);
      rememberPersona(next.javeroDni, next.javeroNombre);
      state.session = next;
      if (!state.guias.length) state.guias.push(emptyGuia());
      saveStore();
      toast("Datos de campo listos");
      showMainFlow();
    });

    on("#btnAgregarGuia", "click", () => {
      if (!requireQrLogin()) return;
      addGuiaAndOpen();
    });

    const openSessionEdit = () => {
      if (!requireQrLogin()) return;
      closeSheets();
      state.session.ready = false;
      saveStore();
      showMainFlow();
    };
    on("#btnEditSession", "click", openSessionEdit);
    on("#btnEditSession2", "click", openSessionEdit);

    $$(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".nav-item").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const panel = btn.dataset.panel;
        if (panel === "export") openSheet("sheetExport");
        else if (panel === "ajustes") openSheet("sheetAjustes");
        else if (panel === "menu") openSheet("sheetMenu");
        else closeSheets();
      });
    });

    $$("[data-close-sheet]").forEach((b) =>
      b.addEventListener("click", () => {
        closeSheets();
        $$(".nav-item").forEach((n) =>
          n.classList.toggle("active", n.dataset.panel === "registro")
        );
      })
    );

    on("#btnMenu", "click", () => {
      $$(".nav-item").forEach((b) =>
        b.classList.toggle("active", b.dataset.panel === "menu")
      );
      openSheet("sheetMenu");
    });
    on("#btnRailPdf", "click", () => {
      if (!requireQrLogin()) return;
      closeSheets();
      exportPdf();
    });
    on("#btnRailMore", "click", () => {
      if (!requireQrLogin()) return;
      $$(".nav-item").forEach((b) =>
        b.classList.toggle("active", b.dataset.panel === "menu")
      );
      openSheet("sheetMenu");
    });
    on("#btnRailDate", "click", () => {
      if (!requireQrLogin()) return;
      openDatePicker("#railFechaInput");
    });
    on("#btnSesDate", "click", () => openDatePicker("#sesFecha"));
    on("#railFechaInput", "change", (e) => applySessionFecha(e.target.value));
    on("#sesFecha", "change", (e) => {
      const v = e.target.value;
      if (!v) return;
      state.session.fecha = v;
      renderDateWidgets(v);
    });

    on("#btnExportExcel", "click", exportExcel);
    on("#btnExportPdf", "click", exportPdf);
    on("#btnSyncCloud", "click", () => {
      closeSheets();
      syncToCloud();
    });
    on("#btnVaciar", "click", vaciarRegistro);
    on("#btnMenuExcel", "click", () => {
      closeSheets();
      exportExcel();
    });
    on("#btnMenuPdf", "click", () => {
      closeSheets();
      exportPdf();
    });
    on("#btnMenuVaciar", "click", () => {
      closeSheets();
      vaciarRegistro();
    });

    on("#btnUpdPersonas", "click", () => $("#filePersonas")?.click());
    on("#filePersonas", "change", async (e) => {
      const f = e.target.files?.[0];
      if (f) await importPersonas(f);
      e.target.value = "";
    });

    on("#btnCambiarPin", "click", cambiarPin);
    on("#btnBloquear", "click", () => {
      closeSheets();
      lock();
    });
    on("#modalCancel", "click", closeModal);
    on("#modalOk", "click", () => {
      const fn = state.pendingConfirm;
      closeModal();
      fn?.();
    });
    on("#loginForm", "submit", (e) => {
      e.preventDefault();
      attemptLogin($("#loginPass")?.value);
    });
    on("#btnCancelLogin", "click", () => {
      state.pendingIdentity = null;
      setIdentity(null);
      showSecurityLogin("Escanee otro carnet", { force: true });
    });
  }

  function bind() {
    const scrollParent_ = (el) =>
      el?.closest?.(
        ".picker-list, #vinculoScreen:not(.is-thanks) .vinculo-scroll, #vinculoScreen:not(.is-thanks), .session-screen, .security-screen, .app-scroll, .harvest-scroll, .guides-scroll, .guides-sheet, .home-scroll, .export-preview, .history-sheet, .help-sheet"
      );

    if (!bind._global) {
      bind._global = true;
      window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        syncProfileAppTools();
      });
      window.addEventListener("appinstalled", () => {
        deferredInstallPrompt = null;
        syncProfileAppTools();
        toast("App instalada en este celular");
      });

      document.addEventListener(
        "touchstart",
        (e) => {
          const s = scrollParent_(e.target);
          const tableWrap = e.target?.closest?.(".export-preview-table-wrap");
          if (tableWrap && e.touches[0]) tableWrap._touchY = e.touches[0].clientY;
          if (s && e.touches[0]) s._touchY = e.touches[0].clientY;
        },
        { passive: true }
      );

      const lockOverscroll = (e) => {
        const tableWrap = e.target?.closest?.(".export-preview-table-wrap");
        if (tableWrap) {
          const canScrollY = tableWrap.scrollHeight > tableWrap.clientHeight + 1;
          const canScrollX = tableWrap.scrollWidth > tableWrap.clientWidth + 1;
          if (!canScrollY && !canScrollX) return;
          if (canScrollY) {
            const atTop = tableWrap.scrollTop <= 0;
            const atBottom =
              tableWrap.scrollTop + tableWrap.clientHeight >=
              tableWrap.scrollHeight - 1;
            let dy = 0;
            if (e.type === "wheel") dy = e.deltaY;
            else if (e.touches && e.touches[0]) {
              dy =
                (tableWrap._touchY || e.touches[0].clientY) -
                e.touches[0].clientY;
            }
            if ((atTop && dy < 0) || (atBottom && dy > 0)) e.preventDefault();
          }
          return;
        }
        const pickerList = e.target?.closest?.(".picker-list");
        if (pickerList) {
          const canScroll = pickerList.scrollHeight > pickerList.clientHeight + 1;
          if (!canScroll) return;
          const atTop = pickerList.scrollTop <= 0;
          const atBottom =
            pickerList.scrollTop + pickerList.clientHeight >=
            pickerList.scrollHeight - 1;
          let dy = 0;
          if (e.type === "wheel") dy = e.deltaY;
          else if (e.touches && e.touches[0]) {
            dy =
              (pickerList._touchY || e.touches[0].clientY) -
              e.touches[0].clientY;
          }
          if ((atTop && dy < 0) || (atBottom && dy > 0)) e.preventDefault();
          return;
        }

        if ($("#vinculoScreen")?.classList.contains("is-thanks")) {
          e.preventDefault();
          return;
        }
        const s = scrollParent_(e.target);
        if (!s) {
          e.preventDefault();
          return;
        }
        const canScroll = s.scrollHeight > s.clientHeight + 1;
        if (!canScroll) {
          e.preventDefault();
          return;
        }
        const atTop = s.scrollTop <= 0;
        const atBottom = s.scrollTop + s.clientHeight >= s.scrollHeight - 1;
        let dy = 0;
        if (e.type === "wheel") dy = e.deltaY;
        else if (e.touches && e.touches[0])
          dy = (s._touchY || e.touches[0].clientY) - e.touches[0].clientY;
        if ((atTop && dy < 0) || (atBottom && dy > 0)) e.preventDefault();
      };
      document.addEventListener("wheel", lockOverscroll, { passive: false });
      document.addEventListener("touchmove", lockOverscroll, { passive: false });

      window.addEventListener("popstate", () => {
        if (!document.documentElement.classList.contains("has-session")) return;
        if (!isInternalTabUrl(location.pathname)) return;
        if (navigationLocked) return;
        navigationLocked = true;
        document.body.classList.add("app-tab-switch");
        switchTabClient(location.pathname + location.search, true)
          .catch(() => {
            location.reload();
          })
          .finally(() => {
            navigationLocked = false;
            document.body.classList.remove("app-tab-switch");
          });
      });

      document.addEventListener("click", (e) => {
        const cacheBtn = e.target?.closest?.(".app-tools-cache");
        if (cacheBtn && !cacheBtn.disabled) {
          e.preventDefault();
          clearAppCache(cacheBtn);
          return;
        }
        const updateBtn = e.target?.closest?.(".app-tools-update");
        if (updateBtn && !updateBtn.disabled) {
          e.preventDefault();
          updateApp(updateBtn);
          return;
        }
        const installBtn = e.target?.closest?.(".app-tools-install, #btnProfileInstall");
        if (installBtn && installBtn.tagName !== "A") {
          e.preventDefault();
          installApp(installBtn);
        }
      });

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible" || !navigator.onLine) return;
        flushDriveQueue().catch(() => {});
        detectNetlify(2500)
          .then((ok) => {
            updateNetworkUI();
            if (ok) {
              flushVinculoQueue().catch(() => {});
              flushCloudDataQueue().catch(() => {});
            }
          })
          .catch(() => {});
      });
    }

    bindPhoneHandlers();
  }

  async function init() {
    try {
      let actionLoaderMsg = null;
      try {
        actionLoaderMsg = sessionStorage.getItem("qb-action-loader");
        if (actionLoaderMsg) sessionStorage.removeItem("qb-action-loader");
      } catch {
        /* ignore */
      }
      const hasSession = document.documentElement.classList.contains("has-session");
      if (hasSession) {
        document.body.classList.remove("app-booting");
        document.body.classList.add("app-ready");
        try {
          sessionStorage.removeItem("qb-tab-nav");
        } catch {
          /* ignore */
        }
      }
      ensureAppLoader();
      if (actionLoaderMsg) showAppLoader(actionLoaderMsg);
      if (
        !hasSession &&
        document.body.classList.contains("app-booting") &&
        !document.querySelector(".app-boot-msg")
      ) {
        const bootMsg = document.createElement("p");
        bootMsg.className = "app-boot-msg";
        bootMsg.textContent = "Iniciando QBerries…";
        document.body.appendChild(bootMsg);
      }
      setupViewportMetrics();
      hydrateIcons();
      closePicker();
      closeModal();
      closeSheets();
      loadStore();
      loadTabShellsFromStorage();
      loadHarvest();
      loadSessionManualPersonas();
      loadSessionWorkers();
      // Todo trabajador ya cargado entra al listado de la sesión.
      seedSessionWorkersFromHarvest();
      // Si había altas manuales en el registro del día, rehidratarlas en sesión
      (state.harvest.workers || []).forEach((w) => {
        if (w?.manual && w.dni && w.nombre) {
          rememberSessionPersona(w.dni, w.nombre);
        }
      });
      Object.entries(state.sessionWorkers || {}).forEach(([dni, info]) => {
        if (info?.manual) rememberSessionPersona(dni, info.nombre);
      });
      state.guias = (state.guias || []).flatMap((g) => migrateGuiaList(g));

      // Data local al instante: DNI/QR validan sin esperar internet
      hydrateSupervisoresFromStorage();
      hydratePersonasFromStorage();

      // Pantalla YA (no dejar blanco mientras carga datos)
      restoreIdentityFromVinculo_();
      updateNetworkUI();
      if (hasQrLogin()) {
        sessionStorage.setItem(SESSION_KEY, "1");
        showMainFlow();
      } else {
        clearAuthenticatedSession();
        setIdentity(null);
        showSecurityLogin("", { force: true });
      }

      bind();
      setupLifecyclePersist();
      refreshTopnav();
      openRequestedTab();
      cacheCurrentTabShell();
      warmTabShells().catch(() => {});
      document.body.classList.remove("app-booting");
      document.body.classList.add("app-ready");
      if (actionLoaderMsg) hideAppLoader();
      else hideAppLoader(true);
      setInterval(updateClock, 30000);

      // Datos en segundo plano (no bloquean UI)
      if (navigator.onLine) {
        detectNetlify(2500)
          .then((ok) => {
            if (ok) {
              flushVinculoQueue().catch(() => {});
              flushCloudDataQueue().catch(() => {});
            }
          })
          .catch(() => {
            state.netlifyReady = false;
            state.cloudApi = false;
          });
      } else {
        state.netlifyReady = false;
        state.cloudApi = false;
      }

      const trabEl = $("#trabCount");
      if (trabEl && getPage() === "scan") {
        setInlineLoading(trabEl, true, "Cargando supervisores…");
      }
        loadSupervisores()
          .then(() => {
            const el = $("#trabCount");
          if (el && getPage() === "scan" && !SESSION_FORM_ENABLED) {
            setInlineLoading(el, false);
            el.textContent = navigator.onLine
              ? "Listo para escanear · solo Supervisores de Cosecha"
              : "Listo para escanear · sin internet";
            }
            updateNetworkUI();
          })
        .catch(() => {
          const el = $("#trabCount");
          if (el && getPage() === "scan") {
            setInlineLoading(el, false);
            el.textContent = "Listo para escanear";
          }
        });
        loadPersonas()
          .then(() => {
          if (getPage() === "registro" && $("#harvestScreen") && !$("#harvestScreen").hidden) {
              renderHarvest();
            }
          })
          .catch(() => {});
      if (getPage() === "registro") {
        loadCatalogs().catch(() => {});
      }

      window.addEventListener("online", () => {
        state.online = true;
        updateNetworkUI();
        toast("Internet recuperado · subiendo…");
        loadSupervisores().catch(() => {});
        loadPersonas().catch(() => {});
        flushDriveQueue().catch(() => {});
        ensureCloudReady_(2000)
          .then(async (ok) => {
            if (!ok) return null;
            const result = await flushVinculoQueue();
            await flushCloudDataQueue();
            return result;
          })
          .then((result) => {
            if (!result || result.sent <= 0) return;
            if (result.alreadyRegistered) {
              setThanksSyncStatus(
                "Ya se tiene este DNI registrado",
                "is-ok"
              );
            } else if (result.remain === 0) {
              setThanksSyncStatus("Fue guardado correctamente", "is-ok");
            }
          })
          .catch(() => {});
      });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden || !navigator.onLine) return;
        flushDriveQueue().catch(() => {});
        ensureCloudReady_(2000)
          .then((ok) =>
            ok
              ? Promise.all([flushVinculoQueue(), flushCloudDataQueue()])
              : null
          )
          .catch(() => {});
      });
      window.addEventListener("offline", () => {
        state.online = false;
        updateNetworkUI();
        toast("Sin internet · se guarda en el celular");
      });

      setInterval(() => {
        if (!navigator.onLine) return;
        if (loadDriveQueue().length) flushDriveQueue().catch(() => {});
        if (!loadVinculoQueue().length && !loadCloudDataQueue().length) return;
        ensureCloudReady_(2000)
          .then((ok) =>
            ok
              ? Promise.all([flushVinculoQueue(), flushCloudDataQueue()])
              : null
          )
          .catch(() => {});
      }, 8000);

      // Failsafe por ruta: nunca mezclar pantallas de apartados distintos.
      setTimeout(() => {
        const expected = {
          scan: "#securityScreen",
          vinculo: "#vinculoScreen",
          registro: "#harvestScreen",
        }[getPage()];
        if (!expected) return;
        const screen = $(expected);
        if (!screen || screen.hidden) {
          if (getPage() === "scan") showSecurityLogin("");
          else if (getPage() === "registro" && hasQrLogin()) showHarvestHome(getIdentity());
          else if (getPage() === "vinculo" && hasQrLogin()) showVinculoScreen(getIdentity());
          else goTo("scan", true);
        }
      }, 1200);

      if ("serviceWorker" in navigator && location.protocol.startsWith("http") && !isNativeApp()) {
        try {
          const reg = await navigator.serviceWorker.register(`/sw.js?v=${APP_VERSION}`, {
            scope: "/",
          });
          reg.update?.().catch(() => {});
          prefetchAppShell();
          if (isNewCacheDay()) {
            requestCacheRefresh();
          }
          rememberCacheDay();
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      if (getPage() === "scan") showSecurityLogin("");
      else goTo("scan", true);
      const msg = $("#secMsg") || $("#pinMsg");
      if (msg) msg.textContent = "Error al iniciar. Ctrl+F5 para recargar.";
    }
  }

  function startWhenVisible() {
    // Páginas pre-renderizadas: no arrancar hasta que el usuario entre, para no
    // duplicar envíos ni abrir la cámara antes de tiempo.
    if (document.prerendering) {
      document.addEventListener("prerenderingchange", startWhenVisible, {
        once: true,
      });
      return;
    }
    init();
  }

  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    navigationLocked = false;
    document.body.classList.remove("app-navigating", "app-tab-switch", "app-booting");
    document.body.classList.add("app-ready");
    hideAppLoader(true);
    refreshTopnav();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startWhenVisible);
  } else {
    startWhenVisible();
  }
})();
