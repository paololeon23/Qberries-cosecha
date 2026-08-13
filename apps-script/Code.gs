/**
 * ============================================================
 * API · SUPERVISORES — Q Berries (DATA-SUPERVISORES)
 * Spreadsheet: DATA-SUPERVISORES
 * ============================================================
 *
 * SETUP
 * 1) Abre el Google Sheet «DATA-SUPERVISORES»
 * 2) Extensiones → Apps Script → pega ESTE archivo completo
 * 3) Propiedades del script → API_TOKEN = (mismo valor que en Netlify)
 * 4) Guardar → Implementar → Nueva versión → Aplicación web
 *    - Ejecutar como: Yo
 *    - Quién tiene acceso: Cualquier persona
 * 5) URL …/exec → Netlify env APPS_SCRIPT_URL
 *
 * ENDPOINTS
 *  GET/POST  action=ping
 *  POST      action=registrarVinculo
 *            data: { dni, nombre, celular, supervisorGlobal|encargado,
 *                    dniSesion|dniInicioSesion, hora|horaRegistro }
 *            → upsert por DNI (sin duplicados)
 *  GET/POST  action=listarVinculos [&dni=]
 *  GET/POST  action=existeVinculo  &dni=
 *
 * Hoja (fila 1):
 * DNI | NOMBRE | CELULAR | NOMBRE SUPERVISOR GLOBAL | DNI INICIO SESION | ULTIMA HORA REGISTRO
 */

var SHEET_NAME = 'Hoja 1';
var DEFAULT_API_TOKEN = '';

var HEADERS = [
  'DNI',
  'NOMBRE',
  'CELULAR',
  'NOMBRE SUPERVISOR GLOBAL',
  'DNI INICIO SESION',
  'ULTIMA HORA REGISTRO'
];

var _jsonpCb = '';

/* -------------------- HTTP -------------------- */

function doGet(e) {
  var fromEditor = typeof e === 'undefined' || e === null;
  e = e || { parameter: {} };
  var p = e.parameter || {};
  _jsonpCb = String(p.callback || '').trim();
  var action = String(p.action || 'ping').trim();

  try {
    if (fromEditor && !clean_(p.token || p.apiToken || p.API_TOKEN)) {
      p.token = expectedToken_();
    }
    var tokErr = checkToken_(p);
    if (tokErr) {
      return jsonOut_({ ok: false, api: 'supervisores', code: 'UNAUTHORIZED', message: tokErr });
    }

    if (action === 'ping') {
      var ssPing = SpreadsheetApp.getActiveSpreadsheet();
      return jsonOut_({
        ok: true,
        api: 'supervisores',
        sheet: sheet_().getName(),
        spreadsheet: ssPing ? ssPing.getName() : '',
        ts: nowIso_()
      });
    }
    if (action === 'listarVinculos') {
      return jsonOut_(listarVinculos_(p));
    }
    if (action === 'existeVinculo') {
      var found = existeVinculo_(p.dni);
      return jsonOut_({
        ok: true,
        api: 'supervisores',
        exists: !!found,
        data: found || null,
        dni: digits_(p.dni)
      });
    }
    return jsonOut_({ ok: false, api: 'supervisores', message: 'Acción GET no válida: ' + action });
  } catch (err) {
    var msgGet = String(err && err.message ? err.message : err).replace(/^Error:\s*/i, '');
    var codeGet = /no autorizado/i.test(msgGet) ? 'UNAUTHORIZED' : 'ERROR';
    return jsonOut_({ ok: false, api: 'supervisores', code: codeGet, message: msgGet });
  }
}

function doPost(e) {
  _jsonpCb = '';
  try {
    var fromEditor = typeof e === 'undefined' || e === null;
    var body = parseBody_(e);
    if (e && e.parameter) {
      Object.keys(e.parameter).forEach(function (k) {
        if (body[k] == null) body[k] = e.parameter[k];
      });
    }
    if (fromEditor && !clean_(body.token || body.apiToken || body.API_TOKEN)) {
      body.token = expectedToken_();
    }

    var tokErrPost = checkToken_(body);
    if (tokErrPost) {
      return jsonOut_({ ok: false, api: 'supervisores', code: 'UNAUTHORIZED', message: tokErrPost });
    }

    var action = String(body.action || 'registrarVinculo').trim();
    var data = body.data || body.payload || body;

    // Si viene data de vínculo sin action clara, registrar igual
    if (
      (!action || action === 'undefined' || action === 'null') &&
      data &&
      (data.dni || data.celular)
    ) {
      action = 'registrarVinculo';
    }

    if (action === 'ping') {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      return jsonOut_({
        ok: true,
        api: 'supervisores',
        sheet: sheet_().getName(),
        spreadsheet: ss ? ss.getName() : '',
        ts: nowIso_()
      });
    }
    if (
      action === 'registrarVinculo' ||
      action === 'guardarVinculo' ||
      action === 'vincular' ||
      action === 'sync' ||
      action === 'registrar' ||
      action === 'guardar'
    ) {
      var saved = registrarVinculo_(data);
      return jsonOut_({
        ok: true,
        api: 'supervisores',
        action: 'registrarVinculo',
        updated: !!saved.updated,
        created: !!saved.created,
        data: saved
      });
    }
    if (action === 'listarVinculos') {
      return jsonOut_(listarVinculos_(body));
    }
    if (action === 'existeVinculo') {
      var foundP = existeVinculo_(data.dni || body.dni);
      return jsonOut_({
        ok: true,
        api: 'supervisores',
        exists: !!foundP,
        data: foundP || null
      });
    }
    return jsonOut_({ ok: false, api: 'supervisores', message: 'Acción POST no válida: ' + action });
  } catch (err) {
    var msg = String(err && err.message ? err.message : err).replace(/^Error:\s*/i, '');
    var code = /no autorizado/i.test(msg) ? 'UNAUTHORIZED' : 'ERROR';
    return jsonOut_({ ok: false, api: 'supervisores', code: code, message: msg });
  }
}

/* -------------------- Auth -------------------- */

function expectedToken_() {
  try {
    var fromProps = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (fromProps && String(fromProps).trim()) return String(fromProps).trim();
  } catch (_) {}
  return String(DEFAULT_API_TOKEN || '').trim();
}

function checkToken_(src) {
  src = src || {};
  var got = clean_(src.token || src.apiToken || src.API_TOKEN || '');
  var need = expectedToken_();
  if (!need) {
    return 'Configure API_TOKEN en Propiedades del script (Apps Script)';
  }
  if (!got || got !== need) {
    return 'No autorizado: token inválido o ausente';
  }
  return '';
}

/* -------------------- Lógica -------------------- */

/**
 * Upsert por DNI (sin duplicados).
 * Columnas:
 * DNI | NOMBRE | CELULAR | NOMBRE SUPERVISOR GLOBAL | DNI INICIO SESION | ULTIMA HORA REGISTRO
 */
function registrarVinculo_(d) {
  d = d || {};
  var lock = LockService.getScriptLock();
  var got = false;
  try {
    got = lock.tryLock(25000);
    if (!got) throw new Error('El servidor está ocupado. Intente de nuevo.');

    var dni = digits_(d.dni || d.dniTrabajador);
    if (!dni || dni.length < 8) {
      throw new Error('Falta DNI válido (8–12 dígitos)');
    }

    var celularRaw = String(d.celular || d.telefono || d.phone || '').trim();
    if (celularRaw && !/^\d+$/.test(celularRaw.replace(/[\s\-()+]/g, ''))) {
      throw new Error('El celular debe ser solo números');
    }
    var celular = digits_(celularRaw);
    if (!celular || !/^9\d{8}$/.test(celular)) {
      throw new Error('Celular inválido: debe tener 9 dígitos y comenzar con 9');
    }

    var nombre = clean_(d.nombre || d.name).toUpperCase();
    var supervisorGlobal = clean_(
      d.supervisorGlobal ||
        d.nombreSupervisorGlobal ||
        d.encargado ||
        d.supervisor ||
        d.supervisorNombre ||
        ''
    ).toUpperCase();
    if (!supervisorGlobal || supervisorGlobal.length < 3) {
      throw new Error('Falta el nombre del supervisor global');
    }
    var dniSesion = digits_(
      d.dniSesion || d.dniInicioSesion || d.dniLogin || d.dni || dni
    );
    if (!dniSesion || dniSesion.length < 8) dniSesion = dni;

    var hora =
      clean_(d.horaRegistro || d.hora || d.horaGuardado || d.ultimaHora) ||
      Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy hh:mm:ss a');

    var sh = sheet_();
    var data = sh.getDataRange().getValues();
    var rowIndex = -1;

    for (var i = 1; i < data.length; i++) {
      if (digits_(data[i][0]) === dni) {
        rowIndex = i + 1;
        break;
      }
    }

    // DNI | NOMBRE | CELULAR | NOMBRE SUPERVISOR GLOBAL | DNI INICIO SESION | ULTIMA HORA REGISTRO
    var row = [dni, nombre, celular, supervisorGlobal, dniSesion, hora];

    if (rowIndex > 0) {
      var prev = data[rowIndex - 1] || [];
      if (!nombre && clean_(prev[1])) row[1] = clean_(prev[1]).toUpperCase();
      if (!supervisorGlobal && clean_(prev[3])) row[3] = clean_(prev[3]).toUpperCase();
      if (!dniSesion && digits_(prev[4])) row[4] = digits_(prev[4]);
      // celular y hora siempre se actualizan con el nuevo registro
      sh.getRange(rowIndex, 1, 1, HEADERS.length).setValues([row]);
      return {
        dni: dni,
        nombre: row[1],
        celular: row[2],
        supervisorGlobal: row[3],
        dniSesion: row[4],
        hora: row[5],
        updated: true,
        created: false,
        syncStatus: 'synced'
      };
    }

    sh.appendRow(row);
    return {
      dni: dni,
      nombre: nombre,
      celular: celular,
      supervisorGlobal: supervisorGlobal,
      dniSesion: dniSesion,
      hora: hora,
      updated: false,
      created: true,
      syncStatus: 'synced'
    };
  } finally {
    if (got) {
      try {
        lock.releaseLock();
      } catch (_) {}
    }
  }
}

function existeVinculo_(dni) {
  dni = digits_(dni);
  if (!dni) return null;
  var sh = sheet_();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (digits_(data[i][0]) === dni) {
      return {
        dni: digits_(data[i][0]),
        nombre: clean_(data[i][1]),
        celular: digits_(data[i][2]),
        supervisorGlobal: clean_(data[i][3]),
        dniSesion: digits_(data[i][4]),
        hora: data[i][5] != null ? String(data[i][5]) : ''
      };
    }
  }
  return null;
}

function listarVinculos_(params) {
  params = params || {};
  var filtro = digits_(params.dni);
  var sh = sheet_();
  var data = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var dni = digits_(data[i][0]);
    if (!dni) continue;
    if (filtro && dni !== filtro) continue;
    out.push({
      dni: dni,
      nombre: clean_(data[i][1]),
      celular: digits_(data[i][2]),
      supervisorGlobal: clean_(data[i][3]),
      dniSesion: digits_(data[i][4]),
      hora: data[i][5] != null ? String(data[i][5]) : ''
    });
  }
  out.reverse();
  var limit = parseInt(params.limit, 10);
  if (!limit || limit < 1) limit = 2000;
  if (limit > 5000) limit = 5000;
  return {
    ok: true,
    api: 'supervisores',
    count: Math.min(out.length, limit),
    data: out.slice(0, limit)
  };
}

/* -------------------- Sheet helpers -------------------- */

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No hay spreadsheet activo. Abre DATA-SUPERVISORES.');

  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.getSheets()[0];
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  ensureHeaders_(sh);
  return sh;
}

function ensureHeaders_(sh) {
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow === 0 || lastCol === 0) {
    writeHeaders_(sh);
    return;
  }
  var first = String(sh.getRange(1, 1).getValue() || '')
    .trim()
    .toUpperCase();
  if (first !== 'DNI') {
    if (lastRow <= 1) {
      sh.clear();
      writeHeaders_(sh);
    } else {
      // Inserta fila de headers si hay datos sin cabecera
      sh.insertRowBefore(1);
      writeHeaders_(sh);
    }
  } else {
    // Asegura columnas con nombres actuales
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#5ead51')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
}

function writeHeaders_(sh) {
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#5ead51')
    .setFontColor('#ffffff');
}

/* -------------------- Utils -------------------- */

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    var out = {};
    var parts = String(e.postData.contents).split('&');
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

/* -------------------- Tests -------------------- */

function myFunction() {
  testPing();
}

function testPing() {
  try {
    var tok = expectedToken_();
    if (!tok) {
      Logger.log('ERROR: falta API_TOKEN en Propiedades del script');
      return;
    }
    Logger.log(doGet({ parameter: { action: 'ping', token: tok } }).getContent());
  } catch (err) {
    Logger.log('ERROR testPing: ' + err);
  }
}

function testRegistrar() {
  try {
    var tok = expectedToken_();
    var out = doPost({
      postData: {
        contents: JSON.stringify({
          action: 'registrarVinculo',
          token: tok,
          data: {
            dni: '42992833',
            nombre: 'PONCE RUIZ ISIDRO',
            celular: '913420257',
            supervisorGlobal: 'VERDE PINILLOS LUIS PABLITO',
            dniSesion: '42992833',
            hora: Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy hh:mm:ss a')
          }
        })
      }
    }).getContent();
    Logger.log(out);
  } catch (err) {
    Logger.log('ERROR testRegistrar: ' + err);
  }
}
