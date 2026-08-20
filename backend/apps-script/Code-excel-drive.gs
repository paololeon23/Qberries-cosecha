/**
 * ============================================================
 * API · SUBIR EXCEL A DRIVE — Q Berries  (SCRIPT SEPARADO)
 * ============================================================
 *
 * SETUP
 * 1) En Google Drive cree (o abra) la carpeta donde deben caer los Excel.
 * 2) Copie el enlace de la carpeta, ej.:
 *    https://drive.google.com/drive/folders/1ABC...xyz
 * 3) Péguelo abajo en DRIVE_FOLDER_LINK (o solo el ID en DRIVE_FOLDER_ID).
 * 4) Extensiones → Apps Script (proyecto NUEVO, vacío) → pegue ESTE archivo.
 * 5) Guardar → Implementar → Nueva versión → Aplicación web
 *    - Ejecutar como: Yo
 *    - Quién tiene acceso: Cualquier persona
 * 6) Copie la URL …/exec → api-config.js → QB_SCRIPT.EXCEL_DRIVE
 * 7) La primera vez Google pedirá permiso de Drive: autorice con su cuenta.
 *
 * ENDPOINTS
 *  GET/POST  action=ping
 *  POST { action: "uploadExcel", data: { fileName, base64, mimeType? } }
 *
 * Respuesta uploadExcel:
 *  { ok:true, api:"excel-drive", url, fileId, name }
 */

/** Pegue aquí el enlace completo de la carpeta Drive (recomendado). */
var DRIVE_FOLDER_LINK =
  'https://drive.google.com/drive/folders/12LXC0NmHtzv5ebmluOPFb8l9Wj08duZA?usp=sharing';

/**
 * Opcional: solo el ID de la carpeta (si no usa el enlace de arriba).
 * Ejemplo: 1ABC...xyz
 */
var DRIVE_FOLDER_ID = '12LXC0NmHtzv5ebmluOPFb8l9Wj08duZA';

var XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

var _jsonpCb = '';

function doGet(e) {
  e = e || { parameter: {} };
  var p = e.parameter || {};
  _jsonpCb = String(p.callback || '').trim();
  var action = String(p.action || 'ping').trim();
  try {
    if (action === 'ping') {
      var folder = resolveFolder_();
      return jsonOut_({
        ok: true,
        api: 'excel-drive',
        ts: nowIso_(),
        folderId: folder.getId(),
        folderName: folder.getName()
      });
    }
    return jsonOut_({ ok: false, api: 'excel-drive', message: 'Acción GET no válida' });
  } catch (err) {
    return jsonOut_({
      ok: false,
      api: 'excel-drive',
      message: String(err && err.message ? err.message : err).replace(/^Error:\s*/i, '')
    });
  }
}

function doPost(e) {
  try {
    var body = parseBody_(e);
    var action = String(body.action || '').trim();
    var data = body.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (ignore) {
        data = {};
      }
    }
    data = data || {};

    if (action === 'ping') {
      var folderPing = resolveFolder_();
      return jsonOut_({
        ok: true,
        api: 'excel-drive',
        ts: nowIso_(),
        folderId: folderPing.getId(),
        folderName: folderPing.getName()
      });
    }

    if (action === 'uploadExcel') {
      var saved = uploadExcel_(data);
      return jsonOut_({
        ok: true,
        api: 'excel-drive',
        action: 'uploadExcel',
        url: saved.url,
        fileId: saved.fileId,
        name: saved.name
      });
    }

    return jsonOut_({
      ok: false,
      api: 'excel-drive',
      message: 'Acción no válida: ' + action
    });
  } catch (err) {
    return jsonOut_({
      ok: false,
      api: 'excel-drive',
      message: String(err && err.message ? err.message : err).replace(/^Error:\s*/i, '')
    });
  }
}

function uploadExcel_(data) {
  var fileName = safeFileName_(data.fileName || data.name || 'cosecha.xlsx');
  var b64 = String(data.base64 || data.content || '').replace(/\s+/g, '');
  if (!b64) throw new Error('Falta el archivo (base64)');
  if (b64.length > 12 * 1024 * 1024) {
    throw new Error('El Excel es demasiado grande para subir');
  }

  var mime = String(data.mimeType || data.type || XLSX_MIME).trim() || XLSX_MIME;
  var bytes = Utilities.base64Decode(b64);
  var blob = Utilities.newBlob(bytes, mime, fileName);
  var folder = resolveFolder_();
  var file = folder.createFile(blob);

  // Enlace usable para pasar por WhatsApp / correo
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (shareErr) {
    // Si la cuenta restringe "cualquiera con el link", igual devolvemos getUrl()
  }

  return {
    fileId: file.getId(),
    name: file.getName(),
    url: file.getUrl()
  };
}

function resolveFolder_() {
  var id = String(DRIVE_FOLDER_ID || '').trim();
  if (!id) id = folderIdFromLink_(DRIVE_FOLDER_LINK);
  if (!id) {
    throw new Error(
      'Configure DRIVE_FOLDER_LINK o DRIVE_FOLDER_ID en Code-excel-drive.gs con el enlace de su carpeta Drive'
    );
  }
  try {
    return DriveApp.getFolderById(id);
  } catch (err) {
    throw new Error(
      'No se pudo abrir la carpeta Drive. Revise el enlace/ID y que esta cuenta tenga acceso: ' + id
    );
  }
}

function folderIdFromLink_(link) {
  var s = String(link || '').trim();
  if (!s || /PEGUE_AQUI/i.test(s)) return '';
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s) && s.indexOf('/') < 0) return s;
  var m =
    s.match(/\/folders\/([a-zA-Z0-9_-]+)/) ||
    s.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
    s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}

function safeFileName_(name) {
  var n = String(name || 'cosecha.xlsx')
    .replace(/[\\\/\?\*\|<>":]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  if (!/\.xlsx$/i.test(n)) n += '.xlsx';
  return n || 'cosecha.xlsx';
}

function parseBody_(e) {
  var raw = '';
  if (e && e.postData && e.postData.contents != null) {
    raw = String(e.postData.contents);
  } else if (e && e.parameter && e.parameter.data) {
    return {
      action: String(e.parameter.action || '').trim(),
      data: e.parameter.data
    };
  }
  raw = String(raw || '').trim();
  if (!raw) return { action: '', data: {} };
  try {
    return JSON.parse(raw);
  } catch (err) {
    var m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch (ignore) {}
    }
    throw new Error('JSON de entrada no válido');
  }
}

function nowIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Lima', "yyyy-MM-dd'T'HH:mm:ss");
}

function jsonOut_(obj) {
  var text = JSON.stringify(obj);
  if (_jsonpCb) {
    return ContentService.createTextOutput(_jsonpCb + '(' + text + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

/** Prueba rápida en el editor (Run). */
function testPing() {
  var folder = resolveFolder_();
  Logger.log(folder.getName() + ' · ' + folder.getId());
}
