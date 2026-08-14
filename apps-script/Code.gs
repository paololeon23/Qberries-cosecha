  /**
  * ============================================================
  * API · SUPERVISORES — Q Berries (DATA-SUPERVISORES)
  * Spreadsheet exclusivo de vínculos QR (NO mezclar con Tarjeta/Pases)
  * ============================================================
  *
  * SETUP
  * 1) Abre el Google Sheet «DATA-SUPERVISORES»
  * 2) Extensiones → Apps Script → pega ESTE archivo completo
  * 3) Propiedades del script → API_TOKEN = (mismo que Netlify)
  *    O edita DEFAULT_API_TOKEN abajo (vacío a propósito)
  * 4) Guardar → Implementar → Nueva versión → Aplicación web
  *    - Ejecutar como: Yo
  *    - Quién tiene acceso: Cualquier persona
  * 5) Copia la URL …/exec → SOLO a Netlify env APPS_SCRIPT_URL
  *    (NO la pongas en el JS público de la app)
  *
  * SEGURIDAD
  *  - Toda petición exige token (body.token / ?token=)
  *  - La app pública habla con /.netlify/functions/sync (proxy)
  *  - Usa el MISMO API_TOKEN que en Netlify
  *
  * ENDPOINTS
  *  POST { action: "registrarVinculo", data: {...}, token }
  *  GET/POST  action=listarVinculos [&dni=][&limit=]
  *  GET/POST  action=existeVinculo  &dni=
  *  GET/POST  action=ping
  *
  * Hoja (fila 1):
  * DNI | NOMBRE | CELULAR | GRUPO LIC | GRUPO | NOMBRE SUPERVISOR GLOBAL | DNI INICIO SESION | ULTIMA HORA REGISTRO
  */

  var SHEET_NAME = 'Hoja 1';

  /**
  * Token por defecto vacío a propósito (Netlify secrets scan).
  * Configúralo en: Apps Script → Configuración del proyecto → Propiedades
  *   Clave: API_TOKEN
  *   Valor: el mismo que en Netlify
  */
  var DEFAULT_API_TOKEN = '';

  var HEADERS = [
    'DNI',
    'NOMBRE',
    'CELULAR',
    'GRUPO LIC',
    'GRUPO',
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
        return jsonOut_({ ok: true, api: 'supervisores', ts: nowIso_() });
      }
      if (
        action === 'registrarVinculo' ||
        action === 'guardarVinculo' ||
        action === 'vincular'
      ) {
        // Live Server (JSONP): mismos campos que POST, aplanados en query
        var dataGet = {};
        try {
          if (p.data) dataGet = JSON.parse(String(p.data));
        } catch (_) {}
        var flat = {
          dni: p.dni || dataGet.dni,
          nombre: p.nombre || dataGet.nombre,
          celular: p.celular || dataGet.celular,
          grupoLic: p.grupoLic || dataGet.grupoLic,
          grupo: p.grupo || dataGet.grupo,
          supervisorGlobal:
            p.supervisorGlobal ||
            p.encargado ||
            dataGet.supervisorGlobal ||
            dataGet.encargado,
          dniSesion: p.dniSesion || dataGet.dniSesion || p.dni || dataGet.dni,
          horaRegistro: p.horaRegistro || p.hora || dataGet.horaRegistro || dataGet.hora,
          hora: p.hora || p.horaRegistro || dataGet.hora || dataGet.horaRegistro
        };
        var savedGet = registrarVinculo_(flat);
        return jsonOut_({
          ok: true,
          api: 'supervisores',
          action: 'registrarVinculo',
          updated: !!savedGet.updated,
          created: !!savedGet.created,
          data: savedGet
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

      if (
        (!action || action === 'undefined' || action === 'null') &&
        data &&
        (data.dni || data.celular)
      ) {
        action = 'registrarVinculo';
      }

      if (action === 'ping') {
        return jsonOut_({ ok: true, api: 'supervisores', ts: nowIso_() });
      }
      if (
        action === 'registrarVinculo' ||
        action === 'guardarVinculo' ||
        action === 'vincular'
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

  /** Token obligatorio (proxy Netlify lo envía; URL directa sin token = rechazada) */
  function expectedToken_() {
    try {
      var fromProps = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
      if (fromProps && String(fromProps).trim()) return String(fromProps).trim();
    } catch (_) {}
    return String(DEFAULT_API_TOKEN || '').trim();
  }

  /** Valida token sin throw (evita Depurador). '' = OK */
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

  function assertToken_(src) {
    var err = checkToken_(src);
    if (err) throw new Error(err);
  }

  /* -------------------- Lógica -------------------- */

  /**
  * Upsert por DNI (rápido): lock + busca solo columna A + escribe 1 fila.
  * Columnas: DNI | NOMBRE | CELULAR | GRUPO LIC | GRUPO | NOMBRE SUPERVISOR GLOBAL | DNI INICIO SESION | ULTIMA HORA REGISTRO
  */
  function registrarVinculo_(d) {
    d = d || {};
    var lock = LockService.getScriptLock();
    var got = false;
    try {
      got = lock.tryLock(30000);
      if (!got) throw new Error('El servidor está ocupado. Intente de nuevo.');

      var dni = digits_(d.dni || d.dniTrabajador);
      if (!dni || dni.length < 8) {
        throw new Error('Falta DNI válido (8–12 dígitos)');
      }

      var celular = digits_(d.celular || d.telefono || d.phone);
      if (!celular || !/^9\d{8}$/.test(celular)) {
        throw new Error('Celular inválido: 9 dígitos y debe comenzar con 9');
      }

      var nombre = clean_(d.nombre || d.name).toUpperCase();

      var gLicNum = clean_(d.grupoLic || '').replace(/\D/g, '');
      var grupoLic = '';
      if (gLicNum && Number(gLicNum) >= 1 && Number(gLicNum) <= 60) {
        grupoLic = 'GRUPO LIC ' + ('0' + Number(gLicNum)).slice(-2);
      }
      if (!grupoLic) throw new Error('Falta Grupo LIC (01 al 60)');

      var gNum = clean_(d.grupo || '').replace(/\D/g, '');
      var grupo = '';
      if (gNum && Number(gNum) >= 1 && Number(gNum) <= 60) {
        grupo = 'GRUPO ' + ('0' + Number(gNum)).slice(-2);
      }
      if (!grupo) throw new Error('Falta Grupo (01 al 60)');

      var supervisorGlobal = clean_(
        d.supervisorGlobal || d.nombreSupervisorGlobal || d.encargado || ''
      ).toUpperCase();
      if (!supervisorGlobal || supervisorGlobal.length < 3) {
        throw new Error('Falta el nombre del supervisor global');
      }

      var dniSesion = digits_(d.dniSesion || d.dniInicioSesion || d.dniLogin || dni);
      if (!dniSesion || dniSesion.length < 8) dniSesion = dni;

      var hora =
        clean_(d.horaRegistro || d.hora || d.horaGuardado) ||
        Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy hh:mm:ss a');

      var sh = sheet_();
      var lastRow = sh.getLastRow();
      var rowIndex = -1;

      if (lastRow >= 2) {
        var colA = sh.getRange(2, 1, lastRow, 1).getValues();
        for (var i = 0; i < colA.length; i++) {
          if (digits_(colA[i][0]) === dni) {
            rowIndex = i + 2;
            break;
          }
        }
      }

      // DNI | NOMBRE | CELULAR | GRUPO LIC | GRUPO | SUPERVISOR | DNI SESION | HORA
      var row = [dni, nombre, celular, grupoLic, grupo, supervisorGlobal, dniSesion, hora];

      if (rowIndex > 0) {
        var prev = sh.getRange(rowIndex, 1, 1, HEADERS.length).getValues()[0] || [];
        if (!nombre && clean_(prev[1])) row[1] = clean_(prev[1]).toUpperCase();
        if (!grupoLic && clean_(prev[3])) row[3] = clean_(prev[3]).toUpperCase();
        if (!grupo && clean_(prev[4])) row[4] = clean_(prev[4]).toUpperCase();
        if (!supervisorGlobal && clean_(prev[5])) row[5] = clean_(prev[5]).toUpperCase();
        if (!dniSesion && digits_(prev[6])) row[6] = digits_(prev[6]);
        sh.getRange(rowIndex, 1, 1, HEADERS.length).setValues([row]);
        return {
          dni: dni,
          nombre: row[1],
          celular: row[2],
          grupoLic: row[3],
          grupo: row[4],
          supervisorGlobal: row[5],
          dniSesion: row[6],
          hora: row[7],
          updated: true,
          created: false,
          syncStatus: 'synced'
        };
      }

      var start = sh.getLastRow() + 1;
      sh.getRange(start, 1, 1, HEADERS.length).setValues([row]);
      return {
        dni: dni,
        nombre: nombre,
        celular: celular,
        grupoLic: grupoLic,
        grupo: grupo,
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
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return null;
    var colA = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < colA.length; i++) {
      if (digits_(colA[i][0]) === dni) {
        var r = sh.getRange(i + 2, 1, 1, HEADERS.length).getValues()[0];
        return {
          dni: digits_(r[0]),
          nombre: clean_(r[1]),
          celular: digits_(r[2]),
          grupoLic: clean_(r[3]),
          grupo: clean_(r[4]),
          supervisorGlobal: clean_(r[5]),
          dniSesion: digits_(r[6]),
          hora: r[7] != null ? String(r[7]) : ''
        };
      }
    }
    return null;
  }

  function listarVinculos_(params) {
    params = params || {};
    var filtro = digits_(params.dni);
    var sh = sheet_();
    var lastRow = sh.getLastRow();
    if (lastRow < 2) {
      return { ok: true, api: 'supervisores', count: 0, data: [] };
    }
    var data = sh.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
    var out = [];
    for (var i = 0; i < data.length; i++) {
      var dni = digits_(data[i][0]);
      if (!dni) continue;
      if (filtro && dni !== filtro) continue;
      out.push({
        dni: dni,
        nombre: clean_(data[i][1]),
        celular: digits_(data[i][2]),
        grupoLic: clean_(data[i][3]),
        grupo: clean_(data[i][4]),
        supervisorGlobal: clean_(data[i][5]),
        dniSesion: digits_(data[i][6]),
        hora: data[i][7] != null ? String(data[i][7]) : ''
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
        sh.insertRowBefore(1);
        writeHeaders_(sh);
      }
      return;
    }

    // Migración: GRUPO LIC (D) + GRUPO (E)
    var headers = sh.getRange(1, 1, 1, Math.max(lastCol, HEADERS.length)).getValues()[0];
    var hasGrupoLic = false;
    var hasGrupo = false;
    for (var h = 0; h < headers.length; h++) {
      var name = String(headers[h] || '').trim().toUpperCase();
      if (name === 'GRUPO LIC') hasGrupoLic = true;
      if (name === 'GRUPO') hasGrupo = true;
    }
    if (!hasGrupoLic) {
      sh.insertColumnAfter(3); // después de CELULAR
      sh.getRange(1, 4)
        .setValue('GRUPO LIC')
        .setFontWeight('bold')
        .setBackground('#5ead51')
        .setFontColor('#ffffff');
      hasGrupo = false; // índices se corren
      headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), HEADERS.length)).getValues()[0];
      for (var h2 = 0; h2 < headers.length; h2++) {
        if (String(headers[h2] || '').trim().toUpperCase() === 'GRUPO') hasGrupo = true;
      }
    }
    if (!hasGrupo) {
      sh.insertColumnAfter(4);
      sh.getRange(1, 5)
        .setValue('GRUPO')
        .setFontWeight('bold')
        .setBackground('#5ead51')
        .setFontColor('#ffffff');
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

  /* -------------------- Pruebas (solo ping · rápido) -------------------- */

  /**
  * Cómo probar (sin Depurador):
  * 1) Elige "testPing" o "myFunction"
  * 2) Ejecutar ▶ (NO Depurar)
  * 3) Ver → Registros → {"ok":true,"api":"supervisores",...}
  */
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
