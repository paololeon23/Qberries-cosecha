/**
 * ============================================================
 * API · GUÍAS — Q Berries  (SCRIPT SEPARADO)
 * Solo totales compactos por supervisor · NO mezclar con vínculos/cosecha
 * ============================================================
 *
 * SETUP (otro proyecto Apps Script + otro Sheet)
 * 1) Crea un Google Sheet nuevo, ej. «DATA-GUIAS-QBERIES»
 * 2) Extensiones → Apps Script → pega ESTE archivo completo
 * 3) Guardar → Implementar → Nueva versión → Aplicación web
 *    - Ejecutar como: Yo
 *    - Quién tiene acceso: Cualquier persona
 * 4) Copia la URL …/exec → api-config.js → QB_SCRIPT.GUIAS
 *    (la app hace POST directo; Netlify solo sirve HTML/JS)
 *    Guías NO usa API_TOKEN ni Netlify Functions.
 *
 * ENDPOINTS
 *  POST { action: "registrarGuias", data: {...} }
 *  GET  ?action=listarGuias&fecha=YYYY-MM-DD&dni=70839380&limit=200
 *  GET/POST action=ping
 *
 * HOJA DATA-GUIAS (cada guardado = UNA FILA NUEVA, se acumula):
 * NOMBRE SUPERVISOR | DNI SUPERVISOR | FECHA | GRUPO LIC | TOTAL JARRAS | TOTAL JABAS |
 * JARRAS DESCARTE | JABAS DESCARTE | FUNDO | LOTES | N° GUIAS | CANTIDAD GUIAS | REGISTRO MANUAL | HORA SUBIDA
 * - Cada subida agrega fila (12:00 y 18:00 = 2 filas). No pisa la anterior.
 * - Anti-duplicado solo por sendId (reintento de red del mismo envío).
 * - TOTAL JARRAS / TOTAL JABAS / CANTIDAD GUIAS / REGISTRO MANUAL: números (para sumar fácil)
 * - JARRAS DESCARTE / JABAS DESCARTE: inputs DESCARTE / DESHIDRATADO de la app. 0 = vacío
 * - CANTIDAD GUIAS = conteo de N° en la lista (exacto)
 * - REGISTRO MANUAL: cantidad manual (aumento o descuento). 0 = vacío / no aplica
 * - FUNDO va junto a LOTES: "Licapa I" | "Licapa I - Licapa II" | "Licapa I - Licapa II - Licapa III"
 * - GRUPO LIC: LIC 01–70 o NO TENGO POR AHORA
 */

var SHEET_NAME = 'DATA-GUIAS';

var HEADERS = [
  'NOMBRE SUPERVISOR',
  'DNI SUPERVISOR',
  'FECHA',
  'GRUPO LIC',
  'TOTAL JARRAS',
  'TOTAL JABAS',
  'JARRAS DESCARTE',
  'JABAS DESCARTE',
  'FUNDO',
  'LOTES',
  'N° GUIAS',
  'CANTIDAD GUIAS',
  'REGISTRO MANUAL',
  'HORA SUBIDA'
];

var FUNDO_ORDER_ = ['Licapa I', 'Licapa II', 'Licapa III'];

var _jsonpCb = '';

function doGet(e) {
  var fromEditor = typeof e === 'undefined' || e === null;
  e = e || { parameter: {} };
  var p = e.parameter || {};
  _jsonpCb = String(p.callback || '').trim();
  var action = String(p.action || 'ping').trim();

  try {
    if (action === 'ping') {
      return jsonOut_({ ok: true, api: 'guias', ts: nowIso_() });
    }
    if (action === 'registrarGuias' || action === 'sync_guias_cosecha') {
      var dataGet = parseDataParam_(p);
      var savedGet = registrarGuias_(dataGet);
      return jsonOut_({
        ok: true,
        api: 'guias',
        action: 'registrarGuias',
        created: !!savedGet.created,
        duplicate: !!savedGet.duplicate,
        data: savedGet
      });
    }
    if (action === 'listarGuias') {
      var listed = listarGuias_(p);
      return jsonOut_({
        ok: true,
        api: 'guias',
        action: 'listarGuias',
        data: listed
      });
    }
    return jsonOut_({ ok: false, api: 'guias', message: 'Acción GET no válida: ' + action });
  } catch (err) {
    var msgG = String(err && err.message ? err.message : err).replace(/^Error:\s*/i, '');
    var codeG = /no autorizado/i.test(msgG) ? 'UNAUTHORIZED' : 'ERROR';
    return jsonOut_({ ok: false, api: 'guias', code: codeG, message: msgG });
  }
}

function doPost(e) {
  try {
    var body = parseBody_(e);
    var data = body.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (_) {
        data = {};
      }
    }
    if (!data || typeof data !== 'object') data = body;

    var action = String(body.action || 'registrarGuias').trim();
    if (action === 'ping') {
      return jsonOut_({ ok: true, api: 'guias', ts: nowIso_() });
    }
    if (action === 'registrarGuias' || action === 'sync_guias_cosecha') {
      var saved = registrarGuias_(data);
      return jsonOut_({
        ok: true,
        api: 'guias',
        action: 'registrarGuias',
        created: !!saved.created,
        duplicate: !!saved.duplicate,
        data: saved
      });
    }
    return jsonOut_({ ok: false, api: 'guias', message: 'Acción POST no válida: ' + action });
  } catch (err) {
    var msg = String(err && err.message ? err.message : err).replace(/^Error:\s*/i, '');
    var code = /no autorizado/i.test(msg) ? 'UNAUTHORIZED' : 'ERROR';
    return jsonOut_({ ok: false, api: 'guias', code: code, message: msg });
  }
}

function sendIdKey_(id) {
  return 'gsend:' + String(id || '').trim();
}

function buildSendId_(d) {
  d = d || {};
  var totals = d.totals && typeof d.totals === 'object' ? d.totals : {};
  return clean_(
    d.sendId ||
      [
        clean_(d.id),
        clean_(d.savedAt || d.horaGuardado),
        String(number_(totals.jarras)),
        String(number_(totals.jabas)),
        String(number_(totals.guias || totals.cantidadGuias)),
      ].join('|')
  );
}

/**
 * ¿Este sendId ya se guardó bien?
 * Solo LEE la caché. Nunca marca aquí (si falla el Sheet, el reintento debe poder escribir).
 */
function isDuplicateSend_(d) {
  var sendId = buildSendId_(d);
  if (!sendId || sendId === '||||') return false;
  var key = sendIdKey_(sendId);
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get(key)) return true;
  } catch (_) {}
  return false;
}

/** Marcar sendId solo cuando el Sheet ya se escribió. */
function markSendIdDone_(d) {
  var sendId = buildSendId_(d);
  if (!sendId || sendId === '||||') return;
  try {
    CacheService.getScriptCache().put(sendIdKey_(sendId), '1', 21600);
  } catch (_) {}
}

function registrarGuias_(d) {
  d = d || {};
  var session = d.session && typeof d.session === 'object' ? d.session : {};
  var guias = Array.isArray(d.guias) ? d.guias : [];
  var totals = d.totals && typeof d.totals === 'object' ? d.totals : {};
  var operator = d.operator && typeof d.operator === 'object' ? d.operator : {};
  var supervisorNombre = clean_(
    d.supervisorNombre ||
      session.supervisorNombre ||
      operator.nombre ||
      ''
  ).toUpperCase();
  var supervisorDni = digits_(
    d.supervisorDni ||
      session.supervisorDni ||
      operator.dni ||
      d.securityCode ||
      ''
  );
  if (!supervisorDni) {
    throw new Error('Falta DNI del supervisor');
  }
  if (!supervisorNombre) {
    throw new Error('Falta nombre del supervisor');
  }
  if (!guias.length && !(Number(totals.jarras) > 0 || Number(totals.jabas) > 0)) {
    throw new Error('No hay guías para guardar');
  }

  var lock = LockService.getScriptLock();
  var got = false;
  try {
    got = lock.tryLock(8000);
    if (!got) throw new Error('El servidor está ocupado. Intente de nuevo.');
    if (isDuplicateSend_(d)) {
      return {
        created: false,
        updated: false,
        duplicate: true,
        rows: 0,
        supervisorNombre: supervisorNombre,
        supervisorDni: supervisorDni
      };
    }
    var result = saveGuiasSummary_(d, session, guias, totals, supervisorNombre, supervisorDni);
    // Solo después de escribir en el Sheet
    markSendIdDone_(d);
    return {
      created: !!result.created,
      updated: !!result.updated,
      duplicate: !!result.duplicate,
      rows: 1,
      fundo: result.fundo || formatFundosSheet_([]),
      grupoLic: normalizeGuidesLic_(d.grupoLic || session.grupoLic),
      cantidadGuias: number_(result.cantidadGuias),
      supervisorNombre: supervisorNombre,
      supervisorDni: supervisorDni
    };
  } finally {
    if (got) {
      try {
        lock.releaseLock();
      } catch (_) {}
    }
  }
}

function formatGuiaLoteCompact_(g) {
  var loteNum = clean_(g && g.lote).replace(/^Q/i, '');
  if (!loteNum) return '';
  var modRaw = clean_(g && g.modulo).toUpperCase();
  var modulo = modRaw ? (modRaw.indexOf('M') === 0 ? modRaw : 'M' + modRaw) : '';
  var turno = clean_(g && g.turno).replace(/^T/i, '');
  var parts = ['LT' + loteNum];
  if (modulo) parts.push(modulo);
  if (turno) parts.push('T' + turno);
  return parts.join('-');
}

function addUniqueLote_(list, value) {
  var lote = clean_(value).toUpperCase();
  if (lote && list.indexOf(lote) < 0) list.push(lote);
}

/** Cuenta ítems no vacíos de "003015, 003016, …" (como LARGO - LARGO(SUSTITUIR) + 1). */
function countGuiasFromList_(text) {
  var raw = clean_(text);
  if (!raw) return 0;
  var parts = String(raw).split(',');
  var n = 0;
  for (var i = 0; i < parts.length; i++) {
    if (clean_(parts[i])) n++;
  }
  return n;
}

/** "Licapa I" | "Licapa I - Licapa II" | "Licapa I - Licapa II - Licapa III" */
function formatFundosSheet_(fundos) {
  var list = Array.isArray(fundos) ? fundos.slice() : [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var f = normalizeFundo_(list[i]);
    if (f && out.indexOf(f) < 0) out.push(f);
  }
  out.sort(function (a, b) {
    return FUNDO_ORDER_.indexOf(a) - FUNDO_ORDER_.indexOf(b);
  });
  if (!out.length) return 'Licapa I';
  return out.join(' - ');
}

/**
 * Cada guardado agrega UNA fila nueva (se acumula).
 * No pisa filas anteriores del mismo día.
 */
function saveGuiasSummary_(d, session, guias, totals, supervisorNombre, supervisorDni) {
  var jarras = 0;
  var jabas = 0;
  var nGuiasConDato = 0;
  var lotes = [];
  var numerosGuia = [];
  var fundos = [];

  for (var i = 0; i < guias.length; i++) {
    var g = guias[i] || {};
    var numGuia = clean_(g.numeroGuia).replace(/\D/g, '');
    var j = number_(g.jarras);
    var b = number_(g.jabas);
    if (!numGuia && !clean_(g.lote) && !(j > 0) && !(b > 0)) continue;
    nGuiasConDato++;
    jarras += j;
    jabas += b;
    var loteTxt = formatGuiaLoteCompact_(g);
    if (loteTxt) addUniqueLote_(lotes, loteTxt);
    if (numGuia) addUniqueLote_(numerosGuia, numGuia);
    var fundoG = normalizeFundo_(g.fundo);
    if (fundoG && fundos.indexOf(fundoG) < 0) fundos.push(fundoG);
  }

  // Jarras/jabas: preferir KPI del cliente si viene
  if (nGuiasConDato === 0) {
    if (Number(totals.jarras) > 0) jarras = number_(totals.jarras);
    if (Number(totals.jabas) > 0) jabas = number_(totals.jabas);
  } else {
    if (Number(totals.jarras) > 0) jarras = number_(totals.jarras);
    if (Number(totals.jabas) > 0) jabas = number_(totals.jabas);
  }

  // CANTIDAD GUIAS = conteo exacto de N° (frontend o lista construida)
  var cantidadGuias = numerosGuia.length;
  if (Number(totals.cantidadGuias) > 0) {
    cantidadGuias = number_(totals.cantidadGuias);
  } else if (Number(totals.guias) > 0 && cantidadGuias === 0) {
    // fallback solo si no hubo N° en el array
    cantidadGuias = number_(totals.guias);
  }
  if (cantidadGuias === 0 && nGuiasConDato > 0) {
    cantidadGuias = nGuiasConDato;
  }

  if (cantidadGuias === 0 && !(jarras > 0 || jabas > 0)) {
    throw new Error('No hay guías para guardar');
  }

  var fecha =
    clean_(d.fecha || session.fecha) ||
    Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd');

  // FUNDO junto a LOTES: preferir fundos de cada guía
  var fundoTxt = fundos.length
    ? formatFundosSheet_(fundos)
    : formatFundosSheet_(String(clean_(d.fundo) || session.fundo || '').split(/,| - /));

  var grupoLic = normalizeGuidesLic_(d.grupoLic || session.grupoLic);
  var numerosTxt = numerosGuia.join(', ');
  if (numerosTxt) cantidadGuias = countGuiasFromList_(numerosTxt);

  var ajuste = number_(
    d.ajusteJarras != null
      ? d.ajusteJarras
      : totals.ajusteJarras != null
        ? totals.ajusteJarras
        : session.ajusteJarras != null
          ? session.ajusteJarras
          : d.aumentoJarras != null
            ? d.aumentoJarras
            : totals.aumentoJarras != null
              ? totals.aumentoJarras
              : d.descuentoJarras != null
                ? d.descuentoJarras
                : totals.descuentoJarras != null
                  ? totals.descuentoJarras
                  : session.descuentoJarras
  );
  if (!(ajuste > 0)) ajuste = 0;

  var descarteJarras = number_(
    d.descarteJarras != null
      ? d.descarteJarras
      : totals.descarteJarras != null
        ? totals.descarteJarras
        : session.descarteJarras
  );
  if (!(descarteJarras > 0)) descarteJarras = 0;

  var descarteJabas = number_(
    d.descarteJabas != null
      ? d.descarteJabas
      : totals.descarteJabas != null
        ? totals.descarteJabas
        : session.descarteJabas
  );
  if (!(descarteJabas > 0)) descarteJabas = 0;

  var row = [
    supervisorNombre,
    supervisorDni,
    fecha,
    grupoLic,
    jarras,
    jabas,
    descarteJarras,
    descarteJabas,
    fundoTxt,
    lotes.join(', '),
    numerosTxt,
    cantidadGuias,
    ajuste, // REGISTRO MANUAL (aumento o descuento)
    formatHora_(d.horaGuardado || d.savedAt || new Date())
  ];

  var sh = sheet_();
  var newRow = sh.getLastRow() + 1;
  sh.getRange(newRow, 1, 1, HEADERS.length).setValues([row]);
  sh.getRange(newRow, 2).setNumberFormat('@').setValue(String(supervisorDni));
  return {
    created: true,
    updated: false,
    duplicate: false,
    fundo: fundoTxt,
    cantidadGuias: cantidadGuias
  };
}

function normalizeGuidesLic_(value) {
  var raw = clean_(value);
  if (!raw) return '';
  var up = raw.toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
  if (/NO\s*TENGO/.test(up)) return 'NO TENGO POR AHORA';
  var digits = up.replace(/\D/g, '');
  var n = Number(digits);
  if (n >= 1 && n <= 70) {
    var num = n < 10 ? '0' + n : String(n);
    return 'LIC ' + num;
  }
  return raw;
}

function normalizeFundo_(value) {
  var raw = clean_(value);
  if (!raw) return 'Licapa I';
  var up = raw.toUpperCase().replace(/\s+/g, ' ');
  if (up === 'LICAPA III' || up === 'LICAPA 3' || up === 'LICAPAIII') return 'Licapa III';
  if (up === 'LICAPA II' || up === 'LICAPA 2' || up === 'LICAPAII') return 'Licapa II';
  if (
    up === 'LICAPA I' ||
    up === 'LICAPA 1' ||
    up === 'LICAPAI' ||
    up === 'LICAPA'
  ) {
    return 'Licapa I';
  }
  return 'Licapa I';
}

/**
 * GET listarGuias — filas del día (rápido, lee solo columnas necesarias).
 * ?action=listarGuias&fecha=2026-09-01&dni=70839380&limit=200
 */
function listarGuias_(params) {
  params = params || {};
  var fecha =
    normalizeFechaRow_(params.fecha) ||
    Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd');
  var dniFilter = digits_(params.dni);
  var limit = Math.min(500, Math.max(1, number_(params.limit) || 200));

  var sh = sheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return { fecha: fecha, count: 0, items: [] };
  }

  var data = sh.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var items = [];
  for (var i = data.length - 1; i >= 0; i--) {
    var row = data[i];
    var rowFecha = normalizeFechaRow_(row[2]);
    if (rowFecha !== fecha) continue;
    var rowDni = digits_(row[1]);
    if (dniFilter && rowDni.indexOf(dniFilter) < 0) continue;

    items.push({
      supervisorNombre: clean_(row[0]).toUpperCase(),
      supervisorDni: rowDni,
      fecha: rowFecha,
      grupoLic: clean_(row[3]),
      totalJarras: number_(row[4]),
      totalJabas: number_(row[5]),
      descarteJarras: number_(row[6]),
      descarteJabas: number_(row[7]),
      fundo: clean_(row[8]),
      lotes: clean_(row[9]),
      numerosGuias: clean_(row[10]),
      cantidadGuias: number_(row[11]),
      registroManual: number_(row[12]),
      horaSubida: clean_(row[13]),
      rowNum: i + 2,
      subido: true
    });
    if (items.length >= limit) break;
  }

  return { fecha: fecha, count: items.length, items: items };
}

function normalizeFechaRow_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'America/Lima', 'yyyy-MM-dd');
  }
  var s = clean_(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No hay spreadsheet activo. Abre el Sheet de Guías.');
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  ensureHeaders_(sh);
  return sh;
}

function headersMatchWanted_(headers) {
  if (!headers || headers.length < HEADERS.length) return false;
  for (var i = 0; i < HEADERS.length; i++) {
    if (clean_(headers[i]).toUpperCase() !== HEADERS[i].toUpperCase()) return false;
  }
  return true;
}

/**
 * Migra layout antiguo → nuevo (sin TOTAL GUIAS duplicado; AJUSTE → REGISTRO MANUAL).
 * Reescribe datos mapeando por nombre de columna (no pierde filas).
 */
function migrateSheetLayout_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var lastRow = sh.getLastRow();
  var headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  if (headersMatchWanted_(headers)) {
    styleHeaders_(sh);
    return;
  }

  var idx = {};
  for (var c = 0; c < headers.length; c++) {
    var key = clean_(headers[c]).toUpperCase();
    if (key) idx[key] = c;
  }
  function colOf(name) {
    var k = String(name || '').toUpperCase();
    return idx.hasOwnProperty(k) ? idx[k] : -1;
  }

  if (lastRow < 2) {
    sh.clear();
    writeHeaders_(sh);
    return;
  }

  var dataRowCount = Math.max(0, lastRow - 1);
  var data = dataRowCount
    ? sh.getRange(2, 1, dataRowCount, lastCol).getValues()
    : [];
  var out = [];
  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    var nTxt = colOf('N° GUIAS') >= 0 ? clean_(row[colOf('N° GUIAS')]) : '';
    var cantidad = countGuiasFromList_(nTxt);
    if (!cantidad && colOf('CANTIDAD GUIAS') >= 0) {
      cantidad = number_(row[colOf('CANTIDAD GUIAS')]);
    }
    if (!cantidad && colOf('TOTAL GUIAS') >= 0) {
      cantidad = number_(row[colOf('TOTAL GUIAS')]);
    }
    var fundoRaw = colOf('FUNDO') >= 0 ? clean_(row[colOf('FUNDO')]) : '';
    var fundoParts = fundoRaw ? fundoRaw.split(/,| - /) : [];
    var fundoTxt = formatFundosSheet_(fundoParts);

    var descJarras = 0;
    var descJabas = 0;
    if (colOf('JARRAS DESCARTE') >= 0) {
      descJarras = number_(row[colOf('JARRAS DESCARTE')]);
    } else if (colOf('DESCARTE DESHIDRATADO') >= 0) {
      descJarras = number_(row[colOf('DESCARTE DESHIDRATADO')]);
    }
    if (colOf('JABAS DESCARTE') >= 0) {
      descJabas = number_(row[colOf('JABAS DESCARTE')]);
    }

    out.push([
      colOf('NOMBRE SUPERVISOR') >= 0 ? row[colOf('NOMBRE SUPERVISOR')] : '',
      colOf('DNI SUPERVISOR') >= 0 ? String(row[colOf('DNI SUPERVISOR')]) : '',
      colOf('FECHA') >= 0 ? row[colOf('FECHA')] : '',
      colOf('GRUPO LIC') >= 0 ? row[colOf('GRUPO LIC')] : '',
      colOf('TOTAL JARRAS') >= 0 ? row[colOf('TOTAL JARRAS')] : '',
      colOf('TOTAL JABAS') >= 0 ? row[colOf('TOTAL JABAS')] : '',
      descJarras,
      descJabas,
      fundoTxt,
      colOf('LOTES') >= 0 ? row[colOf('LOTES')] : '',
      nTxt,
      cantidad,
      colOf('REGISTRO MANUAL') >= 0
        ? number_(row[colOf('REGISTRO MANUAL')])
        : colOf('AJUSTE') >= 0
          ? number_(row[colOf('AJUSTE')])
          : colOf('AUMENTO') >= 0
            ? number_(row[colOf('AUMENTO')])
            : colOf('DESCUENTO') >= 0
              ? number_(row[colOf('DESCUENTO')])
              : 0,
      colOf('HORA SUBIDA') >= 0 ? row[colOf('HORA SUBIDA')] : ''
    ]);
  }

  sh.clear();
  writeHeaders_(sh);
  if (out.length) {
    sh.getRange(2, 1, out.length, HEADERS.length).setValues(out);
    sh.getRange(2, 2, out.length, 1).setNumberFormat('@');
  }
}

function styleHeaders_(sh) {
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#e00b29')
    .setFontColor('#ffffff');
  if (sh.getLastRow() >= 2) {
    var dniRows = Math.max(0, sh.getLastRow() - 1);
    sh.getRange(2, 2, dniRows, 1).setNumberFormat('@');
  }
}

function ensureHeaders_(sh) {
  var lastRow = sh.getLastRow();
  var first = lastRow ? clean_(sh.getRange(1, 1).getValue()).toUpperCase() : '';
  if (!lastRow || !first) {
    sh.clear();
    writeHeaders_(sh);
    return;
  }
  if (first !== HEADERS[0].toUpperCase()) {
    throw new Error('La hoja "' + sh.getName() + '" tiene encabezados incompatibles');
  }

  // Quitar columnas vacías en el medio del encabezado
  var headerCount = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, headerCount).getDisplayValues()[0];
  for (var col = headers.length; col >= 1; col--) {
    if (!clean_(headers[col - 1])) {
      try {
        sh.deleteColumn(col);
      } catch (_) {}
    }
  }

  migrateSheetLayout_(sh);
}

function writeHeaders_(sh) {
  styleHeaders_(sh);
}

function parseDataParam_(params) {
  params = params || {};
  if (params.data && typeof params.data === 'object') return params.data;
  if (params.data) {
    try {
      return JSON.parse(String(params.data));
    } catch (_) {}
  }
  return params;
}

function number_(value) {
  var n = Number(value);
  return isFinite(n) ? n : 0;
}

function formatHora_(value) {
  var date = value ? new Date(value) : new Date();
  if (isNaN(date.getTime())) date = new Date();
  return Utilities.formatDate(date, 'America/Lima', 'hh:mm:ss a');
}

function parseBody_(e) {
  var raw = '';
  if (e && e.postData && e.postData.contents != null) {
    raw = String(e.postData.contents);
  } else if (e && e.parameter && e.parameter.data) {
    return {
      action: String(e.parameter.action || 'registrarGuias').trim(),
      data: e.parameter.data
    };
  }
  raw = String(raw || '').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    var m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch (ignore) {}
    }
    var out = {};
    var parts = raw.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv.length >= 2) {
        out[decodeURIComponent(kv[0])] = decodeURIComponent(
          kv.slice(1).join('=').replace(/\+/g, ' ')
        );
      }
    }
    return out;
  }
}

function jsonOut_(obj) {
  var out = JSON.stringify(obj);
  if (_jsonpCb) {
    return ContentService.createTextOutput(_jsonpCb + '(' + out + ')').setMimeType(
      ContentService.MimeType.JAVASCRIPT
    );
  }
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}

function nowIso_() {
  return new Date().toISOString();
}

function clean_(v) {
  if (v == null) return '';
  return String(v).trim();
}

function digits_(v) {
  return String(clean_(v) || '').replace(/\D/g, '');
}

/** Prueba rápida desde el editor */
function testPing() {
  Logger.log(doGet({ parameter: { action: 'ping' } }).getContent());
}

/** Simula un POST de la app (sin escribir si falla validación). */
function testRegistrarGuias() {
  var fake = {
    postData: {
      contents: JSON.stringify({
        action: 'registrarGuias',
        data: {
          sendId: 'test-editor-' + Date.now(),
          savedAt: new Date().toISOString(),
          fecha: Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd'),
          fundo: 'Licapa I - Licapa II',
          grupoLic: 'LIC 01',
          supervisorNombre: 'TEST EDITOR',
          supervisorDni: '00000000',
          guias: [
            {
              numeroGuia: '123456',
              fundo: 'Licapa I',
              lote: '5',
              modulo: 'M1',
              turno: '1',
              jarras: 12,
              jabas: 1
            },
            {
              numeroGuia: '123457',
              fundo: 'Licapa II',
              lote: '9',
              modulo: 'M1',
              turno: '2',
              jarras: 24,
              jabas: 2
            }
          ],
          descarteJarras: 24,
          descarteJabas: 2,
          totals: {
            guias: 2,
            cantidadGuias: 2,
            jarras: 36,
            jabas: 3,
            descarteJarras: 24,
            descarteJabas: 2
          }
        }
      })
    }
  };
  Logger.log(doPost(fake).getContent());
}
