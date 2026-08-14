(() => {
  "use strict";

  const STORAGE_KEY = "qb-supervisores-guia-v5";
  const PERSONAS_KEY = "qb-trabajadores-v1";
  const SUPERVISORES_KEY = "qb-supervisores-cosecha-v1";
  const PERSONAS_META_KEY = "qb-trabajadores-meta-v1";
  const VINCULO_QUEUE_KEY = "qb-supervisores-vinculo-queue-v1";
  const VINCULO_DONE_KEY = "qb-supervisores-vinculo-done-v1";
  const CUSTOM_CATALOG_KEY = "qb-supervisores-catalog-extra-v1";
  const PIN_KEY = "qb-supervisores-pin-v2";
  const SESSION_KEY = "qb-supervisores-unlocked";
  const SESSION_PIN_KEY = "qb-supervisores-session-pin";
  const IDENTITY_KEY = "qb-supervisores-identity";
  const IDENTITY_LS_KEY = "qb-supervisores-identity-ls";
  const DEFAULT_PIN = "";
  /** Contraseña desactivada por ahora: acceso solo con QR */
  const PASSWORD_REQUIRED = false;
  /** Por ahora: tras vincular NO pasar a Datos de campo */
  const SESSION_FORM_ENABLED = false;
  const API = {
    login: "/.netlify/functions/login",
    sync: "/.netlify/functions/sync",
    trabajadores: "/.netlify/functions/trabajadores",
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

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

  const state = {
    session: emptySession(),
    guias: /** @type {Guia[]} */ ([]),
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
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    camStream: /** @type {MediaStream|null} */ (null),
    camTimer: 0,
    lastScanDni: "",
    lastScanAt: 0,
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

  function lookupPersona(dni) {
    const key = String(dni || "").replace(/\D/g, "");
    return state.personas[key] || null;
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
        fetch("data/grupos-licapa.json", { cache: "force-cache" }),
        fetch("data/lotes-licapa.json", { cache: "force-cache" }),
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
    if (kind === "grupoLic" || kind === "grupoNum") {
      state.picker = { kind, guiaId: "" };
      const title = $("#pickerTitle");
      const query = $("#pickerQuery");
      const addBtn = $("#pickerAdd");
      if (title) {
        title.textContent =
          kind === "grupoLic" ? "Buscar Grupo LIC" : "Buscar Grupo";
      }
      if (query) {
        query.placeholder =
          kind === "grupoLic"
            ? "Buscar Grupo LIC 01, 02…"
            : "Buscar Grupo 01, 02…";
        query.value = "";
      }
      if (addBtn) addBtn.hidden = true;
      renderPickerList();
      const backdrop = $("#picker");
      if (backdrop) {
        backdrop.hidden = false;
        hydrateIcons(backdrop);
      }
      setTimeout(() => query?.focus(), 60);
      return;
    }

    const guia = findGuia(guiaId);
    if (!guia) return;
    state.picker = { kind, guiaId };
    const title = $("#pickerTitle");
    const query = $("#pickerQuery");
    const addBtn = $("#pickerAdd");
    if (title) {
      title.textContent = kind === "lote" ? "Buscar por lote" : "Buscar por grupo";
    }
    if (query) {
      query.placeholder =
        kind === "lote"
          ? "Buscar lote, módulo o turno..."
          : "Buscar grupo...";
      query.value = "";
    }
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
        const hay = `${l.lote} ${l.codLote || ""} ${l.modulo} ${l.turno} ${l.variedad || ""}`.toLowerCase();
        return hay.includes(q);
      })
      .map((l) => ({
        key: l.lote,
        primary: l.lote,
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
      if (saved?.dni) {
        state.identity = saved;
        setIdentity(saved);
        if (!needsVinculo(saved)) {
          showMainFlow();
          return;
        }
        showVinculoScreen(saved);
        return;
      }
    } else {
      setIdentity(null);
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
    if ($("#btnSecBack")) $("#btnSecBack").hidden = false;
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
    if (PASSWORD_REQUIRED) {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_PIN_KEY);
      setIdentity(null);
      const input = $("#loginPass");
      if (input) input.value = "";
      $("#pinMsg").textContent = "";
      hideAllScreens();
      $("#lockScreen").hidden = false;
      input?.focus();
      return;
    }
    // Cambio de carnet: limpia identidad de sesión (el vínculo del DNI queda en el celular)
    setIdentity(null);
    ensureSessionGate();
    showSecurityLogin("Escanee su carnet QR", { force: true });
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
    if (needsVinculo(id)) {
      showVinculoScreen(id);
      return;
    }
    // Por ahora no entrar a Datos de campo / guías
    if (!SESSION_FORM_ENABLED) {
      showVinculoThanks(id, { alreadyRegistered: true });
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
    const pin = sessionPin() || getPin();
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
          pin,
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
    const copy = screen?.querySelector(".hero-head-copy");
    if (copy) {
      const h1 = copy.querySelector("h1");
      const p = copy.querySelector("p");
      if (h1) h1.textContent = "Vincular datos";
      if (p) p.textContent = "Complete celular y supervisor";
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

  function afterQrLogin(identity) {
    setIdentity(identity);
    bindSessionToIdentity(identity.dni);
    toast(`Sesión · ${identity.nombre}`);
    if (needsVinculo(identity)) {
      showVinculoScreen(identity);
      return;
    }
    // ya vinculado en este celular: mostrar gracias (sin re-guardar en silencio)
    if (!SESSION_FORM_ENABLED) {
      showVinculoThanks(identity, { alreadyRegistered: true });
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
    afterQrLogin(ok);
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
      const res = await fetch("data/supervisores-cosecha.json", {
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
    // Flujo actual = solo vínculo QR → no cargar catálogo pesado
    if (!SESSION_FORM_ENABLED) {
      const el = $("#trabCount");
      if (el) el.textContent = "Listo para escanear · solo Supervisores de Cosecha";
      return;
    }

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

    // 2) Bundle local (offline seed)
    try {
      const res = await fetch("data/trabajadores.json", { cache: "force-cache" });
      const data = await res.json();
      const byDni = data.byDni || data;
      Object.entries(byDni).forEach(([dni, info]) => {
        const key = String(dni).replace(/\D/g, "");
        if (!key) return;
        const nombre = (info.nombre || info || "").toString().toUpperCase();
        const cargo = (info.cargo || "").toString().toUpperCase();
        const celular = String(info.celular || info.telefono || "").replace(/\D/g, "");
        if (nombre) {
          state.personas[key] = {
            nombre,
            cargo,
            celular: celular || state.personas[key]?.celular || "",
          };
        }
      });
      savePersonas();
      setCount(" · local");
    } catch {
      /* ignore */
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

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.hidden = true;
    }, 2200);
  }

  function confirmModal(title, body, onOk) {
    $("#modalTitle").textContent = title;
    $("#modalBody").textContent = body;
    state.pendingConfirm = onOk;
    $("#modal").hidden = false;
  }
  function closeModal() {
    $("#modal").hidden = true;
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
    $("#metaLine").textContent = s.ready
      ? `Fecha ${fechaTxt} · ${t.guias} guía(s) · ${fmt(t.jarras)} jarras + ${fmt(t.jabas)} jabas = ${fmt(t.cantidad)} · guardado`
      : "Complete la sesión para registrar";
  }

  function updateClock() {
    renderDateWidgets(state.session.fecha || todayISO());
  }

  function updateNetworkUI() {
    state.online = navigator.onLine;
    const pending = loadVinculoQueue().length;
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
            <span class="tag-soft">${escapeHtml(g.modulo || "Mód")}</span>
            <button type="button" class="btn btn-sm btn-danger-outline" data-act="del-guia" aria-label="Quitar">${ico("trash")}</button>
          </div>
          <div class="guia-grid">
            ${selectTrigger("layers", "Grupo", "grupo", g.grupo, "Elegir grupo")}
            ${selectTrigger("tag", "Lote", "lote", g.lote, "Elegir lote")}
            ${fieldRow("grid", "Módulo", "modulo", g.modulo, { placeholder: "Auto del lote" })}
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
      tag.textContent = guia.modulo || "Mód";
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

  async function verifyPinRemote(pin) {
    const res = await fetch(API.login, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok === true, error: data.error };
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
      // En local / file:// siempre validar contra PIN local primero
      if (password === getPin()) {
        unlock(password);
        toast("Acceso correcto");
        return;
      }
      if (state.netlifyReady) {
        const result = await verifyPinRemote(password);
        if (result.ok) {
          unlock(password);
          toast("Acceso correcto");
        } else {
          if (msg) msg.textContent = result.error || "Contraseña incorrecta";
          if ($("#loginPass")) {
            $("#loginPass").value = "";
            $("#loginPass").focus();
          }
        }
      } else {
        if (msg) msg.textContent = "Contraseña incorrecta";
        if ($("#loginPass")) {
          $("#loginPass").value = "";
          $("#loginPass").focus();
        }
      }
    } catch {
      if (password === getPin()) {
        unlock(password);
        toast("Acceso local");
      } else if (msg) {
        msg.textContent = "Contraseña incorrecta";
      }
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
        ".picker-list, #vinculoScreen:not(.is-thanks), .session-screen, .security-screen, .app-scroll"
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
      stopCamera();
      const screen = $("#vinculoScreen");
      if (screen) screen.classList.remove("is-thanks");
      const thanks = $("#vinculoThanks");
      if (thanks) thanks.hidden = true;
      lock();
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
      showVinculoThanks({
        dni: id.dni,
        nombre: id.nombre || "",
      });

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
  }

  async function init() {
    try {
      ensureSessionGate();
      hydrateIcons();
      closePicker();
      closeModal();
      closeSheets();
      loadStore();
      state.guias = (state.guias || []).map((g) => ({
        ...emptyGuia(),
        ...g,
        id: g.id || uid(),
        jarras: g.jarras ?? g.jarrasJabas ?? "",
        jabas: g.jabas ?? "",
      }));

      // Pantalla YA (no dejar blanco mientras carga datos)
      restoreIdentityFromVinculo_();
      ensureSessionGate();
      updateNetworkUI();
      if (PASSWORD_REQUIRED && !isUnlocked()) {
        hideAllScreens();
        $("#lockScreen").hidden = false;
      } else if (hasQrLogin()) {
        showMainFlow();
      } else {
        showSecurityLogin("");
      }

      bind();
      setInterval(updateClock, 30000);

      // Datos en segundo plano (no bloquean UI)
      if (navigator.onLine) {
        detectNetlify(2500).catch(() => {
          state.netlifyReady = false;
          state.cloudApi = false;
        });
      } else {
        state.netlifyReady = false;
        state.cloudApi = false;
      }

      loadSupervisores()
        .then(() => {
          const el = $("#trabCount");
          if (el && !SESSION_FORM_ENABLED) {
            el.textContent = "Listo para escanear · solo Supervisores de Cosecha";
          }
          updateNetworkUI();
        })
        .catch(() => {});

      if (SESSION_FORM_ENABLED) {
        loadPersonas().catch(() => {});
        loadCatalogs().catch(() => {});
      }

      window.addEventListener("online", () => {
        state.online = true;
        updateNetworkUI();
        toast("Internet recuperado · subiendo…");
        ensureCloudReady_(2000)
          .then((ok) => (ok ? flushVinculoQueue() : null))
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
          .then((ok) => (ok ? flushVinculoQueue() : null))
          .catch(() => {});
      });
      window.addEventListener("offline", () => {
        state.online = false;
        updateNetworkUI();
        toast("Sin internet · se guarda en el celular");
      });

      setInterval(() => {
        if (!navigator.onLine) return;
        if (!loadVinculoQueue().length) return;
        ensureCloudReady_(2000)
          .then((ok) => (ok ? flushVinculoQueue() : null))
          .catch(() => {});
      }, 8000);

      if (canUseCloudApi()) {
        flushVinculoQueue().catch(() => {});
      }

      // Failsafe: si todo quedó oculto, mostrar escáner
      setTimeout(() => {
        const visible = [
          "#securityScreen",
          "#vinculoScreen",
          "#sessionScreen",
          "#appRoot",
          "#lockScreen",
        ].some((sel) => {
          const el = $(sel);
          return el && !el.hidden;
        });
        if (!visible) showSecurityLogin("");
      }, 1200);

      if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
        try {
          const reg = await navigator.serviceWorker.register("./sw.js?v=89");
          reg.update?.().catch(() => {});
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      showSecurityLogin("");
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
