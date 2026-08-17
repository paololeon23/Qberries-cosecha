(() => {
  "use strict";

  const STORAGE_KEY = "qb-supervisores-guia-v5";
  const PERSONAS_KEY = "qb-trabajadores-v1";
  const SUPERVISORES_KEY = "qb-supervisores-cosecha-v1";
  const PERSONAS_META_KEY = "qb-trabajadores-meta-v1";
  const VINCULO_QUEUE_KEY = "qb-supervisores-vinculo-queue-v1";
  const CLOUD_DATA_QUEUE_KEY = "qb-supervisores-data-queue-v1";
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
  const SESSION_MANUAL_PERSONAS_KEY = "qb-supervisores-manual-personas-v1";
  const HISTORY_TTL_MS = 48 * 60 * 60 * 1000;
  const HISTORY_PAGE_SIZE = 8;
  const APP_VERSION = "v153";
  const HARVEST_TYPES = [
    { key: "suma-jarras", label: "Suma de jarras", observacion: "SUMAR JARRAS" },
    { key: "descuento-jarras", label: "Descuento jarras", observacion: "DESCUENTO JARRAS" },
    { key: "descarte-deshidratado", label: "Descarte - deshidratado", observacion: "DESCARTE - DESHIDRATADO" },
  ];
  const DEFAULT_PIN = "";
  /** Contraseña en pausa: por ahora solo QR. Reactivar con true cuando toque. */
  const PASSWORD_REQUIRED = false;
  /** Por ahora: tras vincular NO pasar a Datos de campo */
  const SESSION_FORM_ENABLED = false;
  const PAGE = document.body?.dataset?.page || "scan";
  const ROUTES = {
    scan: "/index.html",
    inicio: "/inicio/",
    vinculo: "/vinculo/",
    registro: "/registro/",
  };
  const API = {
    login: "/.netlify/functions/login",
    sync: "/.netlify/functions/sync",
    trabajadores: "/.netlify/functions/trabajadores",
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  let navigationLocked = false;

  function beginNavigation(target, replace = false) {
    if (navigationLocked) return;
    navigationLocked = true;
    document.body.classList.add("app-navigating");
    if (replace) location.replace(target);
    else location.assign(target);
  }

  function goTo(page, replace = false) {
    const target = ROUTES[page] || ROUTES.scan;
    if (navigationLocked) return;
    const currentPath = location.pathname.replace(/index\.html$/, "");
    const targetPath = new URL(target, location.origin).pathname.replace(/index\.html$/, "");
    if (currentPath === targetPath && !location.search) return;
    beginNavigation(target, replace);
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
   *  grupo: string,
   *  modulo: string,
   *  turno: string,
   *  lote: string,
   *  variedad: string,
   *  jarras: number|string,
   *  jabas: number|string
   * }} Guia */

  const emptySession = () => ({
    ready: false,
    ownerDni: "",
    fundo: "",
    supervisorDni: "",
    supervisorNombre: "",
    javeroDni: "",
    javeroNombre: "",
    fecha: todayISO(),
  });

  const emptyGuia = () => ({
    id: uid(),
    grupo: "",
    modulo: "",
    turno: "",
    lote: "",
    variedad: "",
    jarras: "",
    jabas: "",
  });

  const emptyHarvest = () => ({
    fecha: todayISO(),
    tipo: "suma-jarras",
    lote: "",
    codLote: "",
    modulo: "",
    turno: "",
    variedad: "",
    workers: [],
  });

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
    netlifyReady: false,
    /** true = /.netlify/functions disponibles */
    cloudApi: false,
    unlocking: false,
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
    historyPage: 0,
    sessionManualPersonas: /** @type {Record<string,{nombre:string,manual?:boolean}>} */ ({}),
    audioCtx: /** @type {AudioContext|null} */ (null),
  };

  function hydrateIcons(root = document) {
    $$("[data-icon]", root).forEach((node) => {
      const name = node.getAttribute("data-icon");
      if (!name || !window.QBIcons) return;
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
        return;
      }
      state.harvest = {
        ...emptyHarvest(),
        ...parsed,
        workers: Array.isArray(parsed.workers)
          ? parsed.workers.map((w) => ({
              id: w.id || uid(),
              dni: String(w.dni || "").replace(/\D/g, ""),
              nombre: String(w.nombre || "").trim().toUpperCase(),
              manana: Math.max(0, num(w.manana)),
              tarde: Math.max(0, num(w.tarde)),
              manual: !!w.manual,
            }))
          : [],
      };
    } catch {
      state.harvest = emptyHarvest();
    }
  }

  function saveHarvest() {
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

  async function loadCatalogs() {
    let baseGrupos = [];
    let baseLotes = [];
    try {
      const [gRes, lRes] = await Promise.all([
        fetch("/data/grupos-licapa.json", { cache: "force-cache" }),
        fetch("/data/lotes-licapa.json", { cache: "force-cache" }),
      ]);
      if (gRes.ok) baseGrupos = await gRes.json();
      if (lRes.ok) baseLotes = await lRes.json();
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
    const el = $("#picker");
    if (el) el.hidden = true;
    const q = $("#pickerQuery");
    if (q) q.value = "";
    const addBtn = $("#pickerAdd");
    if (addBtn) addBtn.hidden = false;
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
      kind === "harvestLote" ||
      kind === "harvestType"
    ) {
      state.picker = { kind, guiaId: "" };
      const title = $("#pickerTitle");
      const query = $("#pickerQuery");
      const search = query?.closest(".picker-search");
      const addBtn = $("#pickerAdd");
      if (title) {
        title.textContent = kind === "grupoLic"
          ? "Buscar Grupo LIC"
          : kind === "grupoNum"
            ? "Buscar Grupo"
            : kind === "harvestType"
              ? "Tipo de registro"
              : "Buscar lote";
      }
      if (query) {
        query.placeholder = kind === "grupoLic"
            ? "Buscar Grupo LIC 01, 02…"
            : kind === "grupoNum"
              ? "Buscar Grupo 01, 02…"
              : "Buscar lote...";
        query.value = "";
      }
      if (search) search.hidden = kind === "harvestType";
      if (addBtn) addBtn.hidden = true;
      renderPickerList();
      const backdrop = $("#picker");
      if (backdrop) {
        backdrop.hidden = false;
        hydrateIcons(backdrop);
      }
      if (kind !== "harvestType") setTimeout(() => query?.focus(), 60);
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
      return HARVEST_TYPES.map((item) => ({
        key: item.key,
        primary: item.label,
        secondary: "",
        raw: item,
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
    } else if (state.picker?.kind === "grupoNum") {
      selected = $("#vinGrupo")?.value || "";
    } else if (state.picker?.kind === "harvestLote") {
      selected = state.harvest.lote || "";
    } else if (state.picker?.kind === "harvestType") {
      selected = state.harvest.tipo || "suma-jarras";
    } else if (state.picker && findGuia(state.picker.guiaId)) {
      selected =
        state.picker.kind === "lote"
          ? findGuia(state.picker.guiaId).lote
          : findGuia(state.picker.guiaId).grupo;
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
    if (ctx.kind === "grupoNum") {
      setVinGrupoUI(v);
      closePicker();
      toast(displayGrupo_(normGrupoNum_(v)));
      return;
    }
    if (ctx.kind === "harvestLote") {
      selectHarvestLote(v);
      closePicker();
      toast(`Lote ${v}`);
      return;
    }
    if (ctx.kind === "harvestType") {
      if (!HARVEST_TYPES.some((item) => item.key === v)) return;
      state.harvest.tipo = v;
      saveHarvest();
      renderHarvestType();
      closePicker();
      toast(harvestTypeLabel(v));
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
      }
    }
    saveStore();
    closePicker();
    renderCards();
    toast(ctx.kind === "grupo" ? `Grupo ${v}` : `Lote ${v}`);
  }

  function onPickerAdd() {
    const ctx = state.picker;
    if (!ctx || ctx.kind === "grupoLic" || ctx.kind === "grupoNum") return;
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

  function getIdentity() {
    try {
      const fromSession = JSON.parse(sessionStorage.getItem(IDENTITY_KEY) || "null");
      if (fromSession?.dni) return fromSession;
    } catch {
      /* ignore */
    }
    try {
      return JSON.parse(localStorage.getItem(IDENTITY_LS_KEY) || "null");
    } catch {
      return null;
    }
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
  function restoreIdentityFromVinculo_() {
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
        // Vincular es opcional: con DNI ya puede usar Inicio / Registro
        showMainFlow();
        return;
      }
    } else {
      setIdentity(null);
    }
    if (PAGE !== "scan") {
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
    if (found) found.hidden = true;
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
    clearAuthenticatedSession();
    clearSessionManualPersonas();
    state.harvest = emptyHarvest();
    try {
      localStorage.removeItem(HARVEST_KEY);
    } catch {
      /* ignore */
    }
    setIdentity(null);
    if (PAGE === "scan") {
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
    if (PAGE === "vinculo") {
      showVinculoScreen(id);
      return;
    }
    if (PAGE === "registro") {
      showHarvestHome(id);
      return;
    }
    if (PAGE === "inicio") {
      renderHomeDashboard();
      return;
    }
    // Desde el escáner: abrir Inicio (vincular es opcional desde la pestaña +).
    if (!SESSION_FORM_ENABLED) {
      goTo("inicio", true);
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
    if (!navigator.onLine) {
      updateNetworkUI();
      return { sent: 0, remain: loadCloudDataQueue().length };
    }
    if (!canUseCloudApi()) {
      const ready = await ensureCloudReady_(3000);
      if (!ready) {
        updateNetworkUI();
        return { sent: 0, remain: loadCloudDataQueue().length };
      }
    }
    const queue = loadCloudDataQueue();
    if (!queue.length) {
      updateNetworkUI();
      return { sent: 0, remain: 0 };
    }
    const remain = [];
    let sent = 0;
    for (const item of queue) {
      try {
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
    saveCloudDataQueue(remain);
    updateNetworkUI();
    if (sent > 0 && !remain.length) toast("Datos enviados correctamente");
    return { sent, remain: remain.length };
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

  /** Tras vincular, Inicio se abre solo (el envío sigue en segundo plano). */
  function scheduleRegistroRedirect(ms = 2000) {
    state.thanksRedirect = true;
    clearTimeout(state.thanksRedirectTimer);
    state.thanksRedirectTimer = setTimeout(() => goTo("inicio", true), ms);
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
    saveVinculoQueue(remain);
    updateNetworkUI();
    if (sent > 0 && remain.length === 0) {
      toast(
        alreadyRegistered
          ? "Ya se tiene este DNI registrado"
          : "Fue guardado correctamente"
      );
    } else if (sent > 0 && remain.length) {
      toast(`Enviado parcial · ${remain.length} pendiente(s)`);
    }
    return {
      sent,
      remain: remain.length,
      reason: lastError || "ok",
      alreadyRegistered,
      message: lastMessage,
    };
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
    if (PAGE !== "vinculo") {
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
    setIdentity(identity);
    saveAuthenticatedSession(identity, authToken || authenticatedToken());
    state.pendingIdentity = null;
    sessionStorage.setItem(SESSION_KEY, "1");
    bindSessionToIdentity(identity.dni);
    toast(`Sesión · ${identity.nombre}`);
    // Vincular es opcional: abre Inicio; el supervisor puede completar la ficha cuando quiera
    if (!SESSION_FORM_ENABLED) {
      stopCamera();
      goTo("inicio");
      return;
    }
    if (needsVinculo(identity)) {
      stopCamera();
      goTo("vinculo");
      return;
    }
    showMainFlow();
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
    if (!navigator.mediaDevices?.getUserMedia) {
      $("#secMsg").textContent = "Cámara no disponible en este dispositivo";
      toast("Se necesita cámara para escanear el carnet");
      if (overlay) overlay.hidden = false;
      if ($("#btnStartCam")) $("#btnStartCam").hidden = false;
      if ($("#btnStopCam")) $("#btnStopCam").hidden = true;
      return;
    }
    try {
      if ($("#btnStartCam")) $("#btnStartCam").hidden = true;
      if ($("#btnStopCam")) $("#btnStopCam").hidden = false;
      if (overlay) overlay.hidden = true;
      $("#secMsg").textContent = "";
      state.camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      video.srcObject = state.camStream;
      await video.play();
      if (overlay) overlay.hidden = true;
      if ($("#btnStartCam")) $("#btnStartCam").hidden = true;
      if ($("#btnStopCam")) $("#btnStopCam").hidden = false;
      $("#secMsg").textContent = "";
      state.camTimer = window.setInterval(scanQrFrame, 280);
    } catch {
      $("#secMsg").textContent = "No se pudo abrir la cámara · revise permisos";
      toast("Active el permiso de cámara");
      if (overlay) {
        const t = $("#qrOverlayText");
        if (t) t.textContent = "Toque para activar la cámara";
        overlay.hidden = false;
      }
      if ($("#btnStartCam")) $("#btnStartCam").hidden = false;
      if ($("#btnStopCam")) $("#btnStopCam").hidden = true;
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
    const overlay = $("#qrOverlay");
    const overlayTxt = $("#qrOverlayText");
    if (overlayTxt) overlayTxt.textContent = "Cámara detenida";
    if (overlay) overlay.hidden = false;
    if ($("#btnStartCam")) $("#btnStartCam").hidden = false;
    if ($("#btnStopCam")) $("#btnStopCam").hidden = true;
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
    playScanBeep(true);
    $("#secMsg").textContent = `DNI ${ok.dni} · ${ok.nombre}`;
    const box = $("#secFound");
    if (box) {
      box.hidden = false;
      $("#secNombre").textContent = ok.nombre;
      $("#secCargo").textContent = ok.cargo || "SUPERVISOR DE COSECHA";
    }
    stopCamera();
    if (PASSWORD_REQUIRED) {
      showPasswordGate(ok);
    } else {
      afterQrLogin(ok, `qr:${ok.dni}`);
    }
  }

  async function loadSupervisores() {
    // Caché local primero
    try {
      const cached = localStorage.getItem(SUPERVISORES_KEY);
      if (cached) {
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
        state.supervisores = next;
      }
    } catch {
      state.supervisores = {};
    }

    try {
      if (!navigator.onLine && Object.keys(state.supervisores || {}).length) {
        const elOff = $("#trabCount");
        if (elOff) {
          elOff.textContent = "Listo para escanear · modo sin internet";
        }
        return;
      }
      const res = await fetch("/data/supervisores-cosecha.json", {
        cache: "force-cache",
      });
      if (!res.ok) throw new Error("catalogo");
      const data = await res.json();
      const byDni = data.byDni || data;
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
    } catch {
      /* keep cache */
    }

    const el = $("#trabCount");
    if (el) {
      const n = Object.keys(state.supervisores).length;
      el.textContent = n
        ? "Listo para escanear · solo Supervisores de Cosecha"
        : "Sin listado de supervisores";
    }
  }

  async function loadPersonas() {
    // 1) Cache local primero (rápido)
    try {
      const cached = localStorage.getItem(PERSONAS_KEY);
      if (cached) {
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
        state.personas = next;
      }
    } catch {
      state.personas = {};
    }

    const setCount = (extra = "") => {
      const el = $("#trabCount");
      if (!el) return;
      const n = Object.keys(state.personas).length;
      const nSup = Object.keys(state.supervisores || {}).length;
      if (nSup) {
        el.textContent = "Listo para escanear · solo Supervisores de Cosecha";
        return;
      }
      el.textContent = n
        ? `Listo para escanear${extra}`
        : `Preparando…${extra}`;
    };
    setCount("");

    // 2) Catálogo offline completo (trabajadores) → seed mínimo (personas)
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

    try {
      const res = await fetch("/data/trabajadores.json", {
        cache: "force-cache",
      });
      if (res.ok) {
        const data = await res.json();
        const n = mergePersonaBundle(data);
        if (n > 0) {
          savePersonas();
          setCount(" · local");
        }
      }
    } catch {
      /* ignore */
    }

    if (Object.keys(state.personas).length < 10) {
      try {
        const res = await fetch("/data/personas.json", {
          cache: "force-cache",
        });
        if (res.ok) {
          const data = await res.json();
          if (mergePersonaBundle(data) > 0) {
            savePersonas();
            setCount(" · local");
          }
        }
      } catch {
        /* ignore */
      }
    }

    // 3) Solo proxy Netlify
    if (!canUseNetlifyProxy()) {
      setCount(Object.keys(state.personas).length ? " · local" : "");
      return;
    }
    try {
      const meta = JSON.parse(localStorage.getItem(PERSONAS_META_KEY) || "{}");
      const age = Date.now() - Number(meta.at || 0);
      const fresh = age > 0 && age < 1000 * 60 * 60 * 12; // 12h
      if (fresh && Object.keys(state.personas).length > 100) {
        setCount(" · lista");
        return;
      }
      const res = await fetch(API.trabajadores, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: sessionPin() || undefined }),
      });
      if (res.status === 405) {
        throw new Error("no-api");
      }
      if (!res.ok) throw new Error("api");
      const json = await res.json();
      if (json?.ok && json.byDni) {
        Object.entries(json.byDni).forEach(([dni, info]) => {
          const key = String(dni).replace(/\D/g, "");
          if (!key || !info?.nombre) return;
          state.personas[key] = {
            nombre: String(info.nombre).toUpperCase(),
            cargo: String(info.cargo || "").toUpperCase(),
            celular: String(info.celular || "").replace(/\D/g, ""),
          };
        });
        savePersonas();
        localStorage.setItem(
          PERSONAS_META_KEY,
          JSON.stringify({ at: Date.now(), source: "api" })
        );
        setCount(" · nube");
      }
    } catch {
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
      root.innerHTML = `<div class="harvest-empty">${ico("users")}Agregue trabajadores por DNI para comenzar.</div>`;
    } else {
      root.innerHTML = workers
        .map((w, index) => {
          const total = num(w.manana) + num(w.tarde);
          return `
            <article class="harvest-worker-row" data-worker-id="${w.id}">
              <div class="harvest-worker-person">
                <strong>${index + 1}. ${escapeHtml(w.nombre || "SIN NOMBRE")}</strong>
                <span>DNI ${escapeHtml(w.dni)}</span>
              </div>
              <input data-harvest-field="manana" type="number" inputmode="numeric" min="0" step="1" value="${num(w.manana)}" aria-label="Jarras mañana de ${escapeHtml(w.nombre)}" />
              <input data-harvest-field="tarde" type="number" inputmode="numeric" min="0" step="1" value="${num(w.tarde)}" aria-label="Jarras tarde de ${escapeHtml(w.nombre)}" />
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
    const firstName = String(identity.nombre || "Supervisor")
      .trim()
      .split(/\s+/)[0];
    if ($("#harvestSupervisor")) $("#harvestSupervisor").textContent = firstName;
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
    hydrateIcons($("#harvestScreen"));
    updateNetworkUI();
  }

  function renderHomeDashboard() {
    if (PAGE !== "inicio") return;
    const identity = state.identity || getIdentity() || {};
    const firstName = String(identity.nombre || "Supervisor")
      .trim()
      .split(/\s+/)[0];
    if ($("#homeSupervisor")) $("#homeSupervisor").textContent = firstName;
    if ($("#homeDate")) {
      $("#homeDate").textContent = new Date(`${todayISO()}T12:00:00`).toLocaleDateString(
        "es-PE",
        { weekday: "long", day: "2-digit", month: "long" }
      );
    }

    const total = harvestTotal();
    const workers = state.harvest.workers || [];
    if ($("#homeTodayTotal")) {
      $("#homeTodayTotal").textContent = `${fmt(total)} ${total === 1 ? "jarra" : "jarras"}`;
    }
    if ($("#homeTodayWorkers")) {
      $("#homeTodayWorkers").textContent = `${workers.length} ${
        workers.length === 1 ? "trabajador" : "trabajadores"
      }`;
    }
    if ($("#homeTodayLote")) {
      $("#homeTodayLote").textContent = state.harvest.lote
        ? harvestLoteCode(state.harvest)
        : "Lote pendiente";
    }

    const root = $("#homeRecentList");
    if (root) {
      const history = loadHarvestHistory().slice(0, 3);
      if (!history.length) {
        root.innerHTML = `
          <div class="home-recent-empty">
            ${ico("berry")}
            <div><strong>Aún no hay registros guardados</strong><span>Su actividad de hoy y ayer aparecerá aquí.</span></div>
          </div>`;
      } else {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayIso = [
          yesterday.getFullYear(),
          String(yesterday.getMonth() + 1).padStart(2, "0"),
          String(yesterday.getDate()).padStart(2, "0"),
        ].join("-");
        root.innerHTML = history
          .map((item) => {
            const amount = snapshotTotal(item);
            const loteCode = harvestLoteCode(item) || "Sin lote";
            const dayLabel =
              item.fecha === todayISO()
                ? "Hoy"
                : item.fecha === yesterdayIso
                  ? "Ayer"
                  : new Date(`${item.fecha || todayISO()}T12:00:00`).toLocaleDateString(
                      "es-PE",
                      { weekday: "short", day: "2-digit", month: "short" }
                    );
            const dayFull = new Date(
              `${item.fecha || todayISO()}T12:00:00`
            ).toLocaleDateString("es-PE", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            });
            return `
              <button type="button" class="home-recent-item" data-home-action="excel">
                <span class="home-recent-icon">${ico("clipboard")}</span>
                <span class="home-recent-main">
                  <strong>${escapeHtml(loteCode)}</strong>
                  <small>${escapeHtml(dayLabel)} · ${escapeHtml(dayFull)} · ${(item.workers || []).length} trabajadores</small>
                </span>
                <span class="home-recent-total">${fmt(amount)}<small>jarras</small></span>
              </button>`;
          })
          .join("");
      }
    }
    hydrateIcons($("#homeDashboard"));
    updateNetworkUI();
  }

  function openProfileModal() {
    const identity = state.identity || getIdentity() || {};
    const sheet = $("#profileModal");
    if (!sheet) return;
    const nombre = String(identity.nombre || "Supervisor").trim().toUpperCase();
    const cargo =
      String(identity.cargo || "").trim() ||
      lookupSupervisor(identity.dni)?.cargo ||
      "SUPERVISOR DE COSECHA";
    if ($("#profileModalTitle")) {
      $("#profileModalTitle").textContent =
        nombre.split(/\s+/)[0] || "Supervisor";
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
  }

  function closeProfileModal() {
    const sheet = $("#profileModal");
    if (!sheet) return;
    sheet.hidden = true;
    sheet.setAttribute("hidden", "");
    sheet.style.display = "none";
  }

  function onTabbarClick(tab) {
    if (navigationLocked) return;
    cancelRegistroRedirect();
    if (tab === "ayuda") {
      openAyuda();
      return;
    }
    const id = state.identity || getIdentity();
    if (!id?.dni || !hasQrLogin()) {
      toast("Escanee su carnet para continuar");
      if (PAGE !== "scan") goTo("scan");
      return;
    }
    if (tab === "vincular") {
      if (PAGE === "vinculo") return;
      goTo("vinculo");
      return;
    }
    if (tab === "inicio") {
      if (PAGE !== "inicio") goTo("inicio");
      else $(".home-scroll")?.scrollTo?.({ top: 0, behavior: "smooth" });
      return;
    }
    if (tab === "registro") {
      if (PAGE !== "registro") goTo("registro");
      else $(".harvest-scroll")?.scrollTo?.({ top: 0, behavior: "smooth" });
      return;
    }
    if (tab === "agregar") {
      if (PAGE !== "registro") {
        beginNavigation("/registro/?tab=agregar");
        return;
      }
      const input = $("#harvestWorkerDni");
      input?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      setTimeout(() => input?.focus(), 220);
      return;
    }
    if (tab === "excel") {
      // Abrir historial en la misma pantalla (sin recargar) para evitar pestañeo.
      if ($("#historySheet")) {
        openHarvestHistory();
        return;
      }
      beginNavigation("/inicio/?tab=excel");
      return;
    }
  }

  function openRequestedTab() {
    let tab = "";
    try {
      tab = new URLSearchParams(location.search).get("tab") || "";
    } catch {
      return;
    }
    if (tab !== "agregar" && tab !== "excel") return;
    try {
      const clean =
        PAGE === "inicio"
          ? "/inicio/"
          : PAGE === "registro"
            ? "/registro/"
            : location.pathname;
      history.replaceState(null, "", clean);
    } catch {
      /* ignore */
    }
    if (tab === "excel" && $("#historySheet")) {
      openHarvestHistory();
      return;
    }
    if (PAGE === "registro") onTabbarClick(tab);
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
    const id = state.identity || getIdentity() || {};
    const h = state.harvest;
    return {
      id: uid(),
      savedAt: new Date().toISOString(),
      fecha: h.fecha || todayISO(),
      tipo: h.tipo || HARVEST_TYPES[0].key,
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

  function snapshotTotal(snapshot) {
    return (snapshot?.workers || []).reduce(
      (sum, w) => sum + num(w.manana) + num(w.tarde),
      0
    );
  }

  function buildHarvestSyncPayload(snapshot) {
    return {
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

  /** Nombre pedido en campo: supervisor de cosecha + día */
  function harvestFileName(snapshot) {
    const supervisor = String(snapshot.supervisor || "SUPERVISOR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
    const [y, m, d] = String(snapshot.fecha || todayISO()).split("-");
    const dia = y && m && d ? `${d}-${m}-${y}` : todayISO();
    const tipo = harvestTypeLabel(snapshot.tipo)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
    return `${supervisor || "SUPERVISOR"} ${dia} ${tipo}.xlsx`;
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

  function buildHarvestFile(snapshot) {
    const wb = buildHarvestWorkbook(snapshot);
    const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const name = harvestFileName(snapshot);
    const type =
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const blob = new Blob([new Uint8Array(bytes)], { type });
    try {
      return new File([blob], name, { type, lastModified: Date.now() });
    } catch {
      // Algunos navegadores antiguos no tienen File; el Blob igual sirve.
      try {
        Object.defineProperty(blob, "name", { value: name });
      } catch {
        /* ignore */
      }
      return blob;
    }
  }

  /** Solo muestra el resumen: guardar ocurre dentro del modal */
  function previewHarvestSummary() {
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
    const snapshot = makeHarvestSnapshot();
    openExportPreview(snapshot, { saved: false });
    return snapshot;
  }

  /** Guarda en el historial (una sola vez por resumen) */
  async function commitHarvestSnapshot() {
    const snapshot = state.activeExportSnapshot;
    if (!snapshot) return null;
    if (state.activeExportSaved) {
      toast("Este registro ya está guardado");
      return snapshot;
    }
    const history = loadHarvestHistory();
    if (history.some((item) => item.id === snapshot.id)) {
      state.activeExportSaved = true;
      updateExportPreviewSavedUI();
      enqueueCloudData(
        "registrarCosecha",
        buildHarvestSyncPayload(snapshot),
        snapshot.id
      );
      flushCloudDataQueue().catch(() => {});
      return snapshot;
    }
    try {
      localStorage.setItem(
        HARVEST_HISTORY_KEY,
        JSON.stringify([snapshot, ...history].slice(0, 50))
      );
    } catch {
      toast("No hay espacio para guardar el historial");
      return null;
    }
    state.activeExportSaved = true;
    updateExportPreviewSavedUI();
    enqueueCloudData(
      "registrarCosecha",
      buildHarvestSyncPayload(snapshot),
      snapshot.id
    );
    toast(
      navigator.onLine
        ? "Registro guardado · enviando"
        : "Registro guardado · pendiente de enviar"
    );
    flushCloudDataQueue().catch(() => {});
    return snapshot;
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

  function openExportPreview(snapshot, opts = {}) {
    if (!snapshot) return;
    state.activeExportSnapshot = snapshot;
    // Desde el historial ya está guardado; desde "Ver resumen" todavía no.
    state.activeExportSaved = opts.saved !== false;
    updateExportPreviewSavedUI();
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
      meta.textContent = `${snapshot.fecha} · Lote ${
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
    const modal = $("#exportPreview");
    if (modal) modal.hidden = true;
  }

  function downloadHarvestSnapshot(snapshot) {
    if (!snapshot) return;
    try {
      const wb = buildHarvestWorkbook(snapshot);
      XLSX.writeFile(wb, harvestFileName(snapshot));
      toast("Excel descargado");
    } catch {
      toast("No se pudo crear el Excel");
    }
  }

  function harvestShareText(snapshot) {
    return `QBerries · Cosecha ${snapshot.fecha} · Lote ${
      harvestLoteCode(snapshot) || snapshot.codLote || snapshot.lote || "—"
    } · ${snapshot.workers.length} trabajador(es) · ${snapshotTotal(
      snapshot
    )} jarras`;
  }

  function openWhatsAppWithText(text) {
    const encoded = encodeURIComponent(text);
    const ua = String(navigator.userAgent || "");
    if (/Android/i.test(ua)) {
      location.href = `intent://send?text=${encoded}#Intent;scheme=whatsapp;package=com.whatsapp;end`;
      return;
    }
    if (/iPhone|iPad|iPod/i.test(ua)) {
      location.href = `whatsapp://send?text=${encoded}`;
      return;
    }
    window.open(`https://api.whatsapp.com/send?text=${encoded}`, "_blank");
  }

  async function shareHarvestSnapshot(snapshot) {
    if (!snapshot) {
      toast("No hay registro para compartir");
      return;
    }
    if (typeof XLSX === "undefined") {
      toast("Espere a que cargue el Excel e intente otra vez");
      return;
    }

    let file = null;
    try {
      file = buildHarvestFile(snapshot);
    } catch {
      file = null;
    }

    const text = harvestShareText(snapshot);

    // 1) Mejor opción en celular: menú nativo con el Excel adjunto.
    if (file && typeof navigator.share === "function") {
      const fileAttempts = [
        { files: [file] },
        { files: [file], text },
        { files: [file], title: harvestFileName(snapshot), text },
      ];
      for (const shareData of fileAttempts) {
        try {
          await navigator.share(shareData);
          toast("Elija WhatsApp para enviar el Excel");
          return;
        } catch (err) {
          if (err?.name === "AbortError") return;
        }
      }
    }

    // 2) Si no se pudo adjuntar, abrir WhatsApp con el resumen.
    //    El archivo se descarga aparte solo si el usuario toca Descargar Excel.
    try {
      openWhatsAppWithText(
        `${text}\n\nDesde QBerries: si no llegó el Excel, toque Descargar Excel y adjúntelo en el chat.`
      );
      toast("Abriendo WhatsApp");
      return;
    } catch {
      toast("No se pudo abrir WhatsApp. Use Descargar Excel");
    }
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
        return `<article class="history-item" data-history-id="${escapeHtml(
          item.id
        )}">
          <div class="history-item-top">
            <h3>${escapeHtml(harvestLoteCode(item) || "Sin lote")}</h3>
            <time>${escapeHtml(when)}</time>
          </div>
          <p>${item.workers?.length || 0} trabajador(es) · ${fmt(
            snapshotTotal(item)
          )} jarras · ${escapeHtml(item.variedad || "Sin variedad")}<br>${escapeHtml(
            item.supervisor || ""
          )}</p>
          <div class="history-item-actions">
            <button type="button" data-history-action="preview">Ver</button>
            <button type="button" data-history-action="share">Compartir</button>
            <button type="button" data-history-action="download">Descargar</button>
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

  function openHarvestHistory() {
    state.historyPage = 0;
    renderHarvestHistory();
    const sheet = $("#historySheet");
    if (sheet) sheet.hidden = false;
    hydrateIcons(sheet);
  }

  function closeHarvestHistory() {
    const sheet = $("#historySheet");
    if (sheet) sheet.hidden = true;
  }

  async function clearAppCache(button) {
    if (button) {
      button.disabled = true;
      button.textContent = "Borrando…";
    }
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      toast("Caché borrada · sus registros siguen guardados");
      if (button) button.textContent = "Caché borrada";
    } catch {
      toast("No se pudo borrar la caché");
      if (button) {
        button.disabled = false;
        button.textContent = "Borrar caché";
      }
    }
  }

  async function updateApp(button) {
    if (button) {
      button.disabled = true;
      button.textContent = "Actualizando…";
    }
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration("/");
        await registration?.update();
      }
    } catch {
      /* la recarga de red sigue siendo el respaldo */
    }
    location.reload();
  }

  function openAyuda() {
    let sheet = $("#helpSheet");
    if (!sheet) {
      sheet = document.createElement("aside");
      sheet.id = "helpSheet";
      sheet.className = "help-sheet";
      sheet.innerHTML = `
        <div class="help-head">
          <h2>Recomendaciones</h2>
          <button type="button" class="help-settings" aria-label="Configuración de la app">
            ${ico("settings")}
          </button>
        </div>
        <p class="help-lead">Guía rápida para el registro en campo.</p>
        <ul>
          <li><strong>Vincular:</strong> registre una sola vez su celular, grupo y supervisor global.</li>
          <li><strong>Inicio:</strong> elija el lote; el modulo, turno y variedad se completan solos.</li>
          <li><strong>Agregar:</strong> escriba el DNI (8 dígitos) y el nombre aparece del listado.</li>
          <li><strong>Sin base:</strong> toque usuarios, complete DNI y nombre; se guarda en Data Manuales cuando haya internet.</li>
          <li><strong>Jarras:</strong> anote mañana y tarde por separado; el total se suma solo.</li>
          <li><strong>Guardar:</strong> revise el resumen antes de compartirlo o descargarlo.</li>
          <li><strong>Excel:</strong> consulte las últimas 48 horas y comparta el archivo por WhatsApp.</li>
          <li><strong>Sin internet:</strong> todo queda guardado en el celular y sube al reconectar.</li>
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
            <p>Borre la caché y luego actualice para descargar la versión más reciente. Sus registros guardados no se eliminan.</p>
            <button type="button" class="app-tools-cache">${ico("trash")} Borrar caché</button>
            <button type="button" class="app-tools-update">${ico("refresh")} Actualizar app</button>
            <small class="app-version">Versión de la app: ${APP_VERSION}</small>
          </section>
        </div>`;
      ($("#phone") || document.body).appendChild(sheet);
      sheet
        .querySelector(".help-close")
        ?.addEventListener("click", () => (sheet.hidden = true));
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
      const cacheButton = sheet.querySelector(".app-tools-cache");
      cacheButton?.addEventListener("click", () => clearAppCache(cacheButton));
      const updateButton = sheet.querySelector(".app-tools-update");
      updateButton?.addEventListener("click", () => updateApp(updateButton));
    }
    sheet.hidden = false;
  }

  function showHarvestHome(identity) {
    if (PAGE !== "registro") {
      goTo("registro");
      return;
    }
    stopCamera();
    if (identity?.dni) {
      state.identity = identity;
      setIdentity(identity);
      bindSessionToIdentity(identity.dni);
    }
    hideAllScreens();
    const screen = $("#harvestScreen");
    if (screen) screen.hidden = false;
    renderHarvest();
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
    const sheet = $("#manualWorker");
    if (!sheet) return;
    sheet.hidden = true;
    sheet.setAttribute("hidden", "");
    sheet.style.display = "none";
  }

  function pushHarvestWorker(dni, nombre, { fromManual = false } = {}) {
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
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayIso = [
      yesterday.getFullYear(),
      String(yesterday.getMonth() + 1).padStart(2, "0"),
      String(yesterday.getDate()).padStart(2, "0"),
    ].join("-");
    const identity = state.identity || getIdentity() || {};
    const supervisorDni = String(identity.dni || "").replace(/\D/g, "");
    const records = loadHarvestHistory().filter((item) => {
      if (item.fecha !== yesterdayIso) return false;
      const owner = String(item.supervisorDni || "").replace(/\D/g, "");
      return !owner || !supervisorDni || owner === supervisorDni;
    });
    if (!records.length) {
      toast("No hay trabajadores guardados del día anterior");
      return;
    }

    const existing = new Set(
      (state.harvest.workers || []).map((worker) => worker.dni)
    );
    const previous = new Map();
    records.forEach((record) => {
      (record.workers || []).forEach((worker) => {
        const dni = String(worker.dni || "").replace(/\D/g, "");
        const nombre = String(worker.nombre || "").trim().toUpperCase();
        if (dni.length === 8 && nombre && !previous.has(dni)) {
          previous.set(dni, nombre);
        }
      });
    });

    let copied = 0;
    previous.forEach((nombre, dni) => {
      if (existing.has(dni)) return;
      state.harvest.workers.push({
        id: uid(),
        dni,
        nombre,
        manana: 0,
        tarde: 0,
        manual: false,
      });
      existing.add(dni);
      copied += 1;
    });

    if (!copied) {
      toast("Los trabajadores de ayer ya están agregados");
      return;
    }
    saveHarvest();
    renderHarvestWorkers();
    toast(`${copied} trabajador${copied === 1 ? "" : "es"} copiado${copied === 1 ? "" : "s"} de ayer`);
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
    const input = e.target.closest("[data-harvest-field]");
    if (!input) return;
    const row = input.closest("[data-worker-id]");
    const worker = state.harvest.workers.find((w) => w.id === row?.dataset.workerId);
    if (!worker) return;
    const field = input.dataset.harvestField;
    worker[field] = Math.max(0, num(input.value));
    const totalEl = row.querySelector(".harvest-worker-total");
    if (totalEl) totalEl.textContent = fmt(num(worker.manana) + num(worker.tarde));
    if ($("#harvestGrandTotal")) $("#harvestGrandTotal").textContent = fmt(harvestTotal());
    saveHarvest();
  }

  function onHarvestWorkersClick(e) {
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
      }
    );
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

  function confirmModal(title, body, onOk, okLabel = "Eliminar") {
    const modal = $("#modal");
    const modalTitle = $("#modalTitle");
    const modalBody = $("#modalBody");
    const modalOk = $("#modalOk");
    if (!modal || !modalTitle || !modalBody) return;
    modalTitle.textContent = title;
    modalBody.textContent = body;
    if (modalOk) modalOk.textContent = okLabel;
    state.pendingConfirm = onOk;
    modal.hidden = false;
  }
  function closeModal() {
    const modal = $("#modal");
    if (modal) modal.hidden = true;
    state.pendingConfirm = null;
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
        acc.cantidad += num(g.jarras) + num(g.jabas);
        return acc;
      },
      { guias: state.guias.length, jarras: 0, jabas: 0, cantidad: 0 }
    );
  }

  function updateKpis() {
    const t = totals();
    const g = $("#kpiGuias");
    const gh = $("#kpiGuiasHero");
    const j = $("#kpiJarras");
    const b = $("#kpiJabas");
    if (g) g.textContent = fmt(t.guias);
    if (gh) gh.textContent = `GUÍAS: ${String(t.guias).padStart(2, "0")}`;
    if (j) j.textContent = fmt(t.jarras);
    if (b) b.textContent = fmt(t.jabas);
  }

  function updateMeta() {
    const s = state.session;
    const t = totals();
    const fechaTxt = s.fecha
      ? s.fecha.split("-").reverse().join("/")
      : "—";
    const meta = $("#metaLine");
    if (meta) {
      meta.textContent = s.ready
        ? `Fecha ${fechaTxt} · ${t.guias} guía(s) · ${fmt(t.jarras)} jarras + ${fmt(t.jabas)} jabas = ${fmt(t.cantidad)} · guardado`
        : "Complete la sesión para registrar";
    }
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
        : `Pendiente · ${pending}`;
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
    const ph = opts.placeholder || "";
    const extra = opts.extra || "";
    return `
      <label class="guia-field">
        <span class="gf-label">${ico(icon, "ico ico-sm")} ${label}</span>
        <input data-field="${field}" type="${type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(ph)}" autocomplete="off" ${extra} />
      </label>`;
  }

  function renderCards() {
    const root = $("#cards");
    if (!root) return;
    if (!state.guias.length) {
      root.innerHTML = `<div class="empty">${ico("clipboard", "ico")}<br/>Sin guías aún.<br/>Toque + para agregar (6 o más).</div>`;
      updateKpis();
      updateMeta();
      return;
    }

    root.innerHTML = state.guias
      .map((g, idx) => {
        const fecha = state.session.fecha
          ? state.session.fecha.split("-").reverse().join("/")
          : "—";
        const sub = `Fecha ${fecha} · G${g.grupo || "—"} · L${g.lote || "—"}`;
        const qJ = num(g.jarras);
        const qB = num(g.jabas);
        return `
        <article class="card guia-card" data-id="${g.id}">
          <div class="guia-card-head">
            <div class="guia-num">${idx + 1}</div>
            <div class="titles">
              <strong>Guía de cosecha</strong>
              <span>${escapeHtml(sub)}</span>
            </div>
            <span class="tag-soft">${escapeHtml(g.modulo || "Mod")}</span>
            <button type="button" class="btn btn-sm btn-danger-outline" data-act="del-guia" aria-label="Quitar">${ico("trash")}</button>
          </div>
          <div class="guia-grid">
            ${selectTrigger("layers", "Grupo", "grupo", g.grupo, "Elegir grupo")}
            ${selectTrigger("tag", "Lote", "lote", g.lote, "Elegir lote")}
            ${fieldRow("grid", "Modulo", "modulo", g.modulo, { placeholder: "Auto del lote" })}
            ${fieldRow("hash", "Turno", "turno", g.turno, { placeholder: "Auto del lote" })}
            ${fieldRow("leaf", "Variedad", "variedad", g.variedad, { placeholder: "Sekoya Pop" })}
            <div class="qty-block">
              <div class="qty-head">Cantidad · se guarda y se suma</div>
              <div class="qty-row">
                ${fieldRow("berry", "Jarras", "jarras", g.jarras, { type: "number", placeholder: "0", extra: 'inputmode="numeric" min="0" step="1" class="qty-input"' })}
                ${fieldRow("package", "Jabas", "jabas", g.jabas, { type: "number", placeholder: "0", extra: 'inputmode="numeric" min="0" step="1" class="qty-input"' })}
              </div>
            </div>
          </div>
          <div class="guia-subtotal">
            <span>SUBTOTAL GUÍA</span>
            <b>${fmt(qJ)} jarras · ${fmt(qB)} jabas</b>
          </div>
        </article>`;
      })
      .join("");

    updateKpis();
    updateMeta();
  }

  function findGuia(id) {
    return state.guias.find((g) => g.id === id);
  }

  function onCardsClick(e) {
    const pickBtn = e.target.closest("[data-pick]");
    if (pickBtn) {
      const article = pickBtn.closest(".card");
      const guia = findGuia(article?.dataset.id);
      const kind = pickBtn.dataset.pick;
      if (guia && (kind === "grupo" || kind === "lote")) {
        openPicker(kind, guia.id);
      }
      return;
    }

    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === "add-guia") {
      if (!requireQrLogin()) return;
      state.guias.push(emptyGuia());
      saveStore();
      renderCards();
      $("#cards").lastElementChild?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    const article = btn.closest(".card");
    const guia = findGuia(article?.dataset.id);
    if (!guia) return;

    if (act === "del-guia") {
      const hasData = Object.entries(guia).some(
        ([k, v]) => k !== "id" && String(v || "").trim()
      );
      const doDel = () => {
        state.guias = state.guias.filter((g) => g.id !== guia.id);
        saveStore();
        renderCards();
        toast("Guía quitada");
      };
      if (hasData) {
        confirmModal("Quitar guía", "Esta guía tiene datos. ¿Eliminarla?", doDel);
      } else doDel();
    }
  }

  function onCardsInput(e) {
    const el = e.target;
    if (!el.dataset.field) return;
    const article = el.closest(".card");
    const guia = findGuia(article?.dataset.id);
    if (!guia) return;
    const field = el.dataset.field;
    if (field === "jarras" || field === "jabas") {
      const raw = String(el.value || "").replace(/[^\d.]/g, "");
      el.value = raw;
      guia[field] = raw === "" ? "" : num(raw);
    } else {
      guia[field] = el.value;
    }
    saveStore();
    const sub = article.querySelector(".guia-subtotal b");
    if (sub) {
      sub.textContent = `${fmt(num(guia.jarras))} jarras · ${fmt(num(guia.jabas))} jabas`;
    }
    const span = article.querySelector(".titles span");
    if (span) {
      const fecha = state.session.fecha
        ? state.session.fecha.split("-").reverse().join("/")
        : "—";
      span.textContent = `Fecha ${fecha} · G${guia.grupo || "—"} · L${guia.lote || "—"}`;
    }
    const tag = article.querySelector(".tag-soft");
    if (tag && field === "modulo") {
      tag.textContent = guia.modulo || "Mod";
    }
    updateKpis();
    updateMeta();
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
    return state.guias.map((g, i) => ({
      Nro: i + 1,
      Fundo: s.fundo,
      SupervisorDNI: s.supervisorDni,
      Supervisor: s.supervisorNombre,
      JaveroDNI: s.javeroDni,
      Javero: s.javeroNombre,
      Fecha: s.fecha,
      Grupo: g.grupo,
      Modulo: g.modulo,
      Turno: g.turno,
      Lote: g.lote,
      Variedad: g.variedad,
      Jarras: num(g.jarras),
      Jabas: num(g.jabas),
    }));
  }

  function dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }

  function exportExcel() {
    if (!requireQrLogin()) return;
    if (typeof XLSX === "undefined") {
      toast("Excel no disponible");
      return;
    }
    const rows = rowsFromGuias();
    if (!rows.length) {
      toast("No hay guías para exportar");
      return;
    }
    const t = totals();
    rows.push({
      Nro: "",
      Fundo: "",
      SupervisorDNI: "",
      Supervisor: "",
      JaveroDNI: "",
      Javero: "",
      Fecha: "",
      Grupo: "TOTAL",
      Modulo: "",
      Turno: "",
      Lote: "",
      Variedad: "",
      Jarras: t.jarras,
      Jabas: t.jabas,
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Guias");
    XLSX.writeFile(wb, `guias-cosecha-${dateStamp()}.xlsx`);
    toast("Excel guardado");
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
    if (!state.online) {
      toast("Sin internet · intente al reconectar");
      return;
    }
    const identity = state.identity || getIdentity();
    if (!state.netlifyReady || !state.cloudApi) {
      toast("Subida solo en Netlify · despliegue el sitio");
      return;
    }
    const pin = sessionPin();
    if (!pin) {
      toast("Bloquee e inicie sesión de nuevo");
      return;
    }
    toast("Subiendo…");
    try {
      const res = await fetch(API.sync, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin,
          action: "sync_guias_cosecha",
          payload: {
            savedAt: new Date().toISOString(),
            securityCode: identity.dni,
            operator: identity,
            session: state.session,
            guias: state.guias,
            totals: totals(),
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) toast("Registro subido");
      else toast(data.error || "Error al subir");
    } catch {
      toast("Sin conexión al servidor");
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
        toast("Guías vaciadas");
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
    if (btn) btn.disabled = true;
    try {
      if (!navigator.onLine) {
        if (msg) msg.textContent = "Necesita internet para validar el primer acceso";
        return;
      }
      const result = await verifyPinRemote(password, identity.dni);
      if (result.ok && result.token) {
        afterQrLogin(identity, result.token);
        toast("Identidad confirmada");
      } else {
        if (msg) msg.textContent = result.error || "Contraseña incorrecta";
        if ($("#loginPass")) {
          $("#loginPass").value = "";
          $("#loginPass").focus();
        }
      }
    } catch {
      if (msg) msg.textContent = "No se pudo validar. Revise su conexión";
    } finally {
      state.unlocking = false;
      if (btn) btn.disabled = false;
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

  function bind() {
    const scrollParent_ = (el) =>
      el?.closest?.(
        ".picker-list, #vinculoScreen:not(.is-thanks) .vinculo-scroll, #vinculoScreen:not(.is-thanks), .session-screen, .security-screen, .app-scroll, .harvest-scroll, .home-scroll, .export-preview, .history-sheet, .help-sheet"
      );

    document.addEventListener(
      "touchstart",
      (e) => {
        const s = scrollParent_(e.target);
        if (s && e.touches[0]) s._touchY = e.touches[0].clientY;
      },
      { passive: true }
    );

    const lockOverscroll = (e) => {
      // La tabla del Excel se desliza en horizontal: no bloquear el gesto
      if (e.target?.closest?.(".export-preview-table-wrap")) return;
      // El listado del select (Grupo / Grupo LIC) debe poder deslizar
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

    on("#cards", "click", onCardsClick);
    on("#cards", "input", onCardsInput);
    on("#cards", "change", onCardsInput);

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
      goTo("inicio");
    });
    on("#appTabbar", "click", (e) => {
      const btn = e.target?.closest?.("[data-tab]");
      if (btn) onTabbarClick(btn.dataset.tab);
    });
    on("#homeDashboard", "click", (e) => {
      const button = e.target?.closest?.("[data-home-action]");
      if (!button) return;
      onTabbarClick(button.dataset.homeAction);
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
    on("#btnCommitHarvest", "click", commitHarvestSnapshot);
    on("#btnCloseExportPreview", "click", closeExportPreview);
    on("#exportPreview", "click", (e) => {
      if (e.target?.id === "exportPreview") closeExportPreview();
    });
    on("#btnDownloadHarvest", "click", () =>
      downloadHarvestSnapshot(state.activeExportSnapshot)
    );
    on("#btnShareHarvest", "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      shareHarvestSnapshot(state.activeExportSnapshot);
    });
    on("#btnCloseHistory", "click", closeHarvestHistory);
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
      } else if (action === "share") {
        shareHarvestSnapshot(snapshot);
      } else if (action === "download") {
        downloadHarvestSnapshot(snapshot);
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
    on("#btnCopyYesterdayWorkers", "click", copyYesterdayWorkers);
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
      showVinculoThanks({
        dni: id.dni,
        nombre: id.nombre || "",
      });
      scheduleRegistroRedirect();

      // Sin internet: guarda local y sube al reconectar
      if (!navigator.onLine) {
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
      state.guias.push(emptyGuia());
      saveStore();
      renderCards();
      $("#cards")?.lastElementChild?.scrollIntoView({ behavior: "smooth" });
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

  async function init() {
    try {
      hydrateIcons();
      closePicker();
      closeModal();
      closeSheets();
      loadStore();
      loadHarvest();
      loadSessionManualPersonas();
      // Si había altas manuales en el registro del día, rehidratarlas en sesión
      (state.harvest.workers || []).forEach((w) => {
        if (w?.manual && w.dni && w.nombre) {
          rememberSessionPersona(w.dni, w.nombre);
        }
      });
      state.guias = (state.guias || []).map((g) => ({
        ...emptyGuia(),
        ...g,
        id: g.id || uid(),
        jarras: g.jarras ?? g.jarrasJabas ?? "",
        jabas: g.jabas ?? "",
      }));

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
      openRequestedTab();
      document.body.classList.remove("app-booting");
      document.body.classList.add("app-ready");
      setInterval(updateClock, 30000);

      // Datos en segundo plano (no bloquean UI)
      if (navigator.onLine) {
        detectNetlify(2500)
          .then(() => {})
          .catch(() => {
            state.netlifyReady = false;
            state.cloudApi = false;
          });
      } else {
        state.netlifyReady = false;
        state.cloudApi = false;
      }

      if (PAGE === "scan") {
        loadSupervisores()
          .then(() => {
            const el = $("#trabCount");
            if (el && !SESSION_FORM_ENABLED) {
              el.textContent =
                "Listo para escanear · solo Supervisores de Cosecha";
            }
            updateNetworkUI();
          })
          .catch(() => {});
      }

      if (PAGE === "registro") {
        loadCatalogs().catch(() => {});
        loadPersonas()
          .then(() => {
            if ($("#harvestScreen") && !$("#harvestScreen").hidden) {
              renderHarvest();
            }
          })
          .catch(() => {});
      }

      window.addEventListener("online", () => {
        state.online = true;
        updateNetworkUI();
        toast("Internet recuperado · subiendo…");
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
        if (!loadVinculoQueue().length && !loadCloudDataQueue().length) return;
        ensureCloudReady_(2000)
          .then((ok) =>
            ok
              ? Promise.all([flushVinculoQueue(), flushCloudDataQueue()])
              : null
          )
          .catch(() => {});
      }, 8000);

      if (canUseCloudApi()) {
        flushVinculoQueue().catch(() => {});
        flushCloudDataQueue().catch(() => {});
      }

      // Failsafe por ruta: nunca mezclar pantallas de apartados distintos.
      setTimeout(() => {
        const expected = {
          scan: "#securityScreen",
          inicio: "#homeDashboard",
          vinculo: "#vinculoScreen",
          registro: "#harvestScreen",
        }[PAGE];
        if (!expected) return;
        const screen = $(expected);
        if (!screen || screen.hidden) {
          if (PAGE === "scan") showSecurityLogin("");
          else if (PAGE === "inicio" && hasQrLogin()) renderHomeDashboard();
          else if (PAGE === "registro" && hasQrLogin()) showHarvestHome(getIdentity());
          else if (PAGE === "vinculo" && hasQrLogin()) showVinculoScreen(getIdentity());
          else goTo("scan", true);
        }
      }, 1200);

      if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
        try {
          const reg = await navigator.serviceWorker.register("/sw.js?v=153", {
            scope: "/",
          });
          reg.update?.().catch(() => {});
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      if (PAGE === "scan") showSecurityLogin("");
      else goTo("scan", true);
      const msg = $("#secMsg") || $("#pinMsg");
      if (msg) msg.textContent = "Error al iniciar. Ctrl+F5 para recargar.";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
