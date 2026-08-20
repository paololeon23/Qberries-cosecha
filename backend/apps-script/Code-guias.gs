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
  *  GET/POST action=ping
  *
  * HOJA DATA-GUIAS (1 fila por supervisor/día/fundo):
  * NOMBRE SUPERVISOR | DNI SUPERVISOR | FECHA | FUNDO | GRUPO LIC | TOTAL JARRAS | TOTAL JABAS | TOTAL GUIAS | LOTES | N° GUIAS | HORA SUBIDA
  * - TOTAL JARRAS / TOTAL JABAS / TOTAL GUIAS: números separados (para sumar fácil)
  * - LOTES y N° GUIAS: solo dato de respaldo
  * - FUNDO: Licapa o Licapa II
  * - GRUPO LIC: LIC 01–50 o NO TENGO POR AHORA
  */

  var SHEET_NAME = 'DATA-GUIAS';

  var HEADERS = [
    'NOMBRE SUPERVISOR',
    'DNI SUPERVISOR',
    'FECHA',
    'FUNDO',
    'GRUPO LIC',
    'TOTAL JARRAS',
    'TOTAL JABAS',
    'TOTAL GUIAS',
    'LOTES',
    'N° GUIAS',
    'HORA SUBIDA'
  ];

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
          String(number_(totals.guias)),
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

  /**
  * 1 fila por supervisor + día + fundo.
  * Totales numéricos separados; lotes y N° guías solo como dato.
  */
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
        fundo: normalizeFundo_(d.fundo || session.fundo),
        grupoLic: normalizeGuidesLic_(d.grupoLic || session.grupoLic),
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

  function saveGuiasSummary_(d, session, guias, totals, supervisorNombre, supervisorDni) {
    var jarras = 0;
    var jabas = 0;
    var nGuias = 0;
    var lotes = [];
    var numerosGuia = [];

    for (var i = 0; i < guias.length; i++) {
      var g = guias[i] || {};
      var numGuia = clean_(g.numeroGuia).replace(/\D/g, '');
      var j = number_(g.jarras);
      var b = number_(g.jabas);
      if (!numGuia && !clean_(g.lote) && !(j > 0) && !(b > 0)) continue;
      nGuias++;
      jarras += j;
      jabas += b;
      var loteTxt = formatGuiaLoteCompact_(g);
      if (loteTxt) addUniqueLote_(lotes, loteTxt);
      if (numGuia) addUniqueLote_(numerosGuia, numGuia);
    }

    // Totales: preferir lo calculado de las guías (evita contar tarjetas vacías).
    // Solo usar totals del cliente si no hubo ítems útiles en el array.
    if (nGuias === 0) {
      if (Number(totals.jarras) > 0) jarras = number_(totals.jarras);
      if (Number(totals.jabas) > 0) jabas = number_(totals.jabas);
      if (Number(totals.guias) > 0) nGuias = number_(totals.guias);
    } else {
      // Jarras/jabas del cliente suelen venir del KPI (ok); N° guías = ítems reales
      if (Number(totals.jarras) > 0) jarras = number_(totals.jarras);
      if (Number(totals.jabas) > 0) jabas = number_(totals.jabas);
    }

    if (nGuias === 0 && !(jarras > 0 || jabas > 0)) {
      throw new Error('No hay guías para guardar');
    }

    var fecha =
      clean_(d.fecha || session.fecha) ||
      Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd');
    var fundo = normalizeFundo_(d.fundo || session.fundo);
    var grupoLic = normalizeGuidesLic_(d.grupoLic || session.grupoLic);

    var row = [
      supervisorNombre,
      supervisorDni,
      fecha,
      fundo,
      grupoLic,
      jarras,
      jabas,
      nGuias,
      lotes.join(', '),
      numerosGuia.join(', '),
      formatHora_(d.horaGuardado || d.savedAt || new Date())
    ];

    var sh = sheet_();
    // 1 fila por supervisor + día + fundo → actualiza si ya existe (no duplica)
    var rowIndex = findGuiasRowByKey_(sh, supervisorDni, fecha, fundo);
    if (rowIndex > 0) {
      var prev = sh.getRange(rowIndex, 1, 1, HEADERS.length).getDisplayValues()[0];
      var same = true;
      for (var c = 0; c < HEADERS.length - 1; c++) {
        if (clean_(prev[c]) !== clean_(row[c])) {
          same = false;
          break;
        }
      }
      if (same) {
        sh.getRange(rowIndex, HEADERS.length).setValue(row[HEADERS.length - 1]);
        return { created: false, updated: false, duplicate: true };
      }
      sh.getRange(rowIndex, 1, 1, HEADERS.length).setValues([row]);
      // DNI siempre como texto (evita que 00000001 se vea como 1)
      sh.getRange(rowIndex, 2).setNumberFormat('@').setValue(supervisorDni);
      return { created: false, updated: true, duplicate: false };
    }

    var newRow = sh.getLastRow() + 1;
    sh.getRange(newRow, 1, 1, HEADERS.length).setValues([row]);
    sh.getRange(newRow, 2).setNumberFormat('@').setValue(supervisorDni);
    return { created: true, updated: false, duplicate: false };
  }

  function normalizeGuidesLic_(value) {
    var raw = clean_(value);
    if (!raw) return '';
    var up = raw.toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
    if (/NO\s*TENGO/.test(up)) return 'NO TENGO POR AHORA';
    var digits = up.replace(/\D/g, '');
    var n = Number(digits);
    if (n >= 1 && n <= 50) {
      var num = n < 10 ? '0' + n : String(n);
      return 'LIC ' + num;
    }
    return raw;
  }

  function normalizeFundo_(value) {
    var raw = clean_(value);
    if (!raw) return 'Licapa';
    var up = raw.toUpperCase().replace(/\s+/g, ' ');
    if (up === 'LICAPA II' || up === 'LICAPA 2' || up === 'LICAPAII') return 'Licapa II';
    return 'Licapa';
  }

  /** Clave anti-duplicado: DNI SUPERVISOR + FECHA + FUNDO */
  function findGuiasRowByKey_(sh, dni, fecha, fundo) {
    if (!sh || sh.getLastRow() < 2) return 0;
    var keyDni = digits_(dni);
    var keyFecha = clean_(fecha);
    var keyFundo = normalizeFundo_(fundo);
    if (!keyDni || !keyFecha) return 0;
    var values = sh.getRange(2, 1, sh.getLastRow(), 4).getDisplayValues();
    for (var i = 0; i < values.length; i++) {
      var rowDni = digits_(values[i][1]);
      var rowFecha = clean_(values[i][2]);
      var rowFundo = normalizeFundo_(values[i][3]);
      if (rowDni === keyDni && rowFecha === keyFecha && rowFundo === keyFundo) return i + 2;
    }
    return 0;
  }

  function sheet_() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error('No hay spreadsheet activo. Abre el Sheet de Guías.');
    var sh = ss.getSheetByName(SHEET_NAME);
    if (!sh) sh = ss.insertSheet(SHEET_NAME);
    ensureHeaders_(sh);
    return sh;
  }

  function ensureHeaders_(sh) {
    var lastRow = sh.getLastRow();
    var first = lastRow ? clean_(sh.getRange(1, 1).getValue()).toUpperCase() : '';
    if (!lastRow || !first) {
      sh.clear();
      writeHeaders_(sh);
      return;
    }
    if (first !== HEADERS[0]) {
      throw new Error('La hoja "' + sh.getName() + '" tiene encabezados incompatibles');
    }

    // Quitar columnas vacías en el medio del encabezado (ej. celda roja en blanco)
    var headerCount = Math.max(sh.getLastColumn(), 1);
    var headers = sh.getRange(1, 1, 1, headerCount).getDisplayValues()[0];
    for (var col = headers.length; col >= 1; col--) {
      if (!clean_(headers[col - 1])) {
        try {
          sh.deleteColumn(col);
        } catch (_) {}
      }
    }

    headerCount = Math.max(sh.getLastColumn(), 1);
    headers = sh.getRange(1, 1, 1, headerCount).getDisplayValues()[0];
    var hasGrupoLic = false;
    var i;
    for (i = 0; i < headers.length; i++) {
      if (clean_(headers[i]).toUpperCase() === 'GRUPO LIC') {
        hasGrupoLic = true;
        break;
      }
    }
    if (!hasGrupoLic) {
      sh.insertColumnAfter(4);
    }

    // Reescribir encabezados exactos (sin huecos)
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#e00b29')
      .setFontColor('#ffffff');
    sh.getRange(2, 2, Math.max(sh.getLastRow(), 2), 2).setNumberFormat('@');
  }

  function writeHeaders_(sh) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#e00b29')
      .setFontColor('#ffffff');
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
            fundo: 'Licapa',
            grupoLic: 'LIC 01',
            supervisorNombre: 'TEST EDITOR',
            supervisorDni: '00000000',
            guias: [
              {
                numeroGuia: '123456',
                lote: '5',
                modulo: 'M1',
                turno: '1',
                jarras: 12,
                jabas: 1
              }
            ],
            totals: { guias: 1, jarras: 12, jabas: 1 }
          }
        })
      }
    };
    Logger.log(doPost(fake).getContent());
  }
