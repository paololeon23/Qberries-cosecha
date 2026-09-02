    /**
    * ============================================================
    * API · SUPERVISORES — Q Berries
    * Cosecha, altas manuales y vínculos QR en hojas separadas
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
    *  POST { action: "registrarCosecha", data: {...}, token }
    *  POST { action: "registrarManual", data: {...}, token }
    *  GET/POST  action=listarVinculos [&dni=][&limit=]
    *  GET/POST  action=existeVinculo  &dni=
    *  GET/POST  action=ping
    *
    * DATA-SUPERVISORES (fila 1):
    * DNI | NOMBRE | CELULAR | GRUPO LIC | GRUPO | NOMBRE SUPERVISOR GLOBAL | DNI INICIO SESION | ULTIMA HORA REGISTRO
    * Hoja 1: historial detallado anterior (ya no recibe registros nuevos)
    * DATA-MANUAL: resumen de cada registro, sin ID visible
    * DATA-COSECHA-SUMA / DATA-COSECHA-DESCARTE / DATA-COSECHA-RESTA:
    *   detalle unificado por tipo (1 fila por trabajador, todos los supervisores)
    * TRABAJADORES-MANUALES: trabajadores agregados manualmente
    */

    var SHEET_NAME = 'DATA-SUPERVISORES';
    var HARVEST_SHEET_NAME = 'Hoja 1';
    var SUMMARY_SHEET_NAME = 'DATA-MANUAL';
    var MANUAL_SHEET_NAME = 'TRABAJADORES-MANUALES';

    /** Hojas de detalle separadas por tipo (no mezclar Suma / Descarte / Resta). */
    var DETAIL_SHEETS = {
      SUMA: 'DATA-COSECHA-SUMA',
      DESCARTE: 'DATA-COSECHA-DESCARTE',
      RESTA: 'DATA-COSECHA-RESTA'
    };

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

    var HARVEST_HEADERS = [
      'ID REGISTRO',
      'FECHA',
      'HORA GUARDADO',
      'TIPO',
      'DNI TRABAJADOR',
      'NOMBRE TRABAJADOR',
      'MAÑANA',
      'TARDE',
      'TOTAL TRABAJADOR',
      'TOTAL GENERAL',
      'LOTE',
      'VARIEDAD',
      'OBSERVACION',
      'DNI SUPERVISOR',
      'NOMBRE SUPERVISOR'
    ];

    var MANUAL_HEADERS = [
      'FECHA',
      'HORA GUARDADO',
      'DNI TRABAJADOR',
      'NOMBRE TRABAJADOR',
      'DNI SUPERVISOR',
      'NOMBRE SUPERVISOR'
    ];

    var SUMMARY_HEADERS = [
      'NOMBRE DEL SUPERVISOR',
      'TIPO',
      'TOTAL TURNO DÍA',
      'TOTAL TURNO TARDE',
      'TOTAL DE TODO',
      'TOTAL DE TRABAJADORES',
      'LOTE O LOTES',
      'VARIOS LOTES',
      'DÍA',
      'HORA REGISTRO'
    ];

    /** Detalle por trabajador (como Excel de campo). */
    var DETAIL_HEADERS = [
      'DNI',
      'NOMBRES Y APELLIDOS',
      'MAÑANA',
      'TARDE',
      'TOTAL-UNIDADES',
      'LOTE',
      'VARIEDAD',
      'OBSERVACION',
      'SUPERVISOR',
      'FECHA'
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
            alreadyRegistered: !!savedGet.alreadyRegistered,
            message: savedGet.message || '',
            data: savedGet
          });
        }
        if (action === 'registrarCosecha') {
          var cosechaGet = parseDataParam_(p);
          var savedCosechaGet = registrarCosecha_(cosechaGet);
          return jsonOut_({
            ok: true,
            api: 'supervisores',
            action: 'registrarCosecha',
            created: !!savedCosechaGet.created,
            duplicate: !!savedCosechaGet.duplicate,
            data: savedCosechaGet
          });
        }
        if (action === 'registrarManual') {
          var manualGet = parseDataParam_(p);
          var savedManualGet = registrarManual_(manualGet);
          return jsonOut_({
            ok: true,
            api: 'supervisores',
            action: 'registrarManual',
            created: !!savedManualGet.created,
            updated: !!savedManualGet.updated,
            data: savedManualGet
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
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch (_) {}
        }

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
            alreadyRegistered: !!saved.alreadyRegistered,
            message: saved.message || '',
            data: saved
          });
        }
        if (action === 'registrarCosecha') {
          var savedCosecha = registrarCosecha_(data);
          return jsonOut_({
            ok: true,
            api: 'supervisores',
            action: 'registrarCosecha',
            created: !!savedCosecha.created,
            duplicate: !!savedCosecha.duplicate,
            data: savedCosecha
          });
        }
        if (action === 'registrarManual') {
          var savedManual = registrarManual_(data);
          return jsonOut_({
            ok: true,
            api: 'supervisores',
            action: 'registrarManual',
            created: !!savedManual.created,
            updated: !!savedManual.updated,
            data: savedManual
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
        got = lock.tryLock(8000);
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

        var rawLic = clean_(d.grupoLic || '').toUpperCase().replace(/_/g, ' ');
        var grupoLic = '';
        if (/NO\s*TENGO/.test(rawLic)) {
          grupoLic = 'NO TENGO';
        } else {
          var gLicNum = rawLic.replace(/\D/g, '');
          if (gLicNum && Number(gLicNum) >= 1 && Number(gLicNum) <= 60) {
            grupoLic = 'GRUPO LIC ' + ('0' + Number(gLicNum)).slice(-2);
          }
        }
        if (!grupoLic) throw new Error('Falta Grupo LIC (01 al 60 o No tengo)');

        var rawGrupo = clean_(d.grupo || '').toUpperCase().replace(/_/g, ' ');
        var grupo = '';
        if (/NO\s*TENGO/.test(rawGrupo)) {
          grupo = 'NO TENGO';
        } else {
          var gNum = rawGrupo.replace(/\D/g, '');
          if (gNum && Number(gNum) >= 1 && Number(gNum) <= 60) {
            grupo = 'GRUPO ' + ('0' + Number(gNum)).slice(-2);
          }
        }
        if (!grupo) throw new Error('Falta Grupo (01 al 60 o No tengo)');

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
        var rowIndex = findDniRow_(sh, dni, lastRow);

        var row = [dni, nombre, celular, grupoLic, grupo, supervisorGlobal, dniSesion, hora];

        if (rowIndex > 0) {
          sh.getRange(rowIndex, 1, 1, HEADERS.length).setValues([row]);
          return {
            dni: dni,
            nombre: nombre,
            celular: celular,
            grupoLic: grupoLic,
            grupo: grupo,
            supervisorGlobal: supervisorGlobal,
            dniSesion: dniSesion,
            hora: hora,
            updated: true,
            created: false,
            alreadyRegistered: true,
            message: 'Ya se tiene este DNI registrado',
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
          alreadyRegistered: false,
          message: 'Fue guardado correctamente',
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

    function localIdKey_(id) {
      return 'lid:' + String(id || '').trim();
    }

    /** Evita doble POST del mismo registro (reintentos / doble clic). Solo LEE. */
    function isDuplicateLocalId_(id) {
      var key = localIdKey_(id);
      if (!key || key === 'lid:') return false;
      try {
        if (CacheService.getScriptCache().get(key)) return true;
      } catch (_) {}
      return false;
    }

    /** Marcar localId solo después de escribir en el Sheet. */
    function markLocalIdDone_(id) {
      var key = localIdKey_(id);
      if (!key || key === 'lid:') return;
      try {
        CacheService.getScriptCache().put(key, '1', 21600);
      } catch (_) {}
    }

    /**
    * Guarda resumen en DATA-MANUAL + detalle unificado en DATA-COSECHA.
    */
    function registrarCosecha_(d) {
      d = d || {};
      var localId = clean_(d.localId || d.id);
      if (localId && isDuplicateLocalId_(localId)) {
        return { created: false, duplicate: true, rows: 0, detailRows: 0 };
      }

      var workers = Array.isArray(d.workers) ? d.workers : [];
      var supervisorDni = digits_(d.supervisorDni);
      if (!workers.length) throw new Error('Faltan trabajadores');
      if (!supervisorDni) throw new Error('Falta DNI del supervisor');

      var lock = LockService.getScriptLock();
      var got = false;
      try {
        got = lock.tryLock(8000);
        if (!got) throw new Error('El servidor está ocupado. Intente de nuevo.');

        var shDetail = detailSheetForType_(d.tipo);
        if (localId && detailRowsExistAny_(localId)) {
          if (localId) markLocalIdDone_(localId);
          return {
            created: false,
            duplicate: true,
            rows: 0,
            detailRows: 0,
            detailSheet: shDetail.getName()
          };
        }

        var detailRows = saveHarvestDetail_(d, localId);
        if (!detailRows) {
          throw new Error('No se pudo guardar el detalle (revise DNI y nombres)');
        }
        var summaryCreated = saveHarvestSummary_(d);

        if (detailRows > 0 || summaryCreated) {
          if (localId) markLocalIdDone_(localId);
        }

        return {
          created: detailRows > 0 || summaryCreated,
          duplicate: detailRows === 0 && !summaryCreated,
          rows: detailRows,
          detailRows: detailRows,
          summaryCreated: !!summaryCreated,
          detailSheet: shDetail.getName(),
          tipo: summaryType_(d.tipo)
        };
      } finally {
        if (got) {
          try { lock.releaseLock(); } catch (_) {}
        }
      }
    }

    /**
    * DATA-MANUAL: una sola fila de resumen por guardado.
    * Los duplicados se detectan comparando las columnas visibles; no usa ID.
    */
    function saveHarvestSummary_(d) {
      var workers = Array.isArray(d.workers) ? d.workers : [];
      var stats = buildSummaryLoteStats_(workers, d);
      var lotes = stats.order;
      var totalDia = 0;
      var totalTarde = 0;
      var colDia = 0;
      var colTarde = 0;
      var colTrabajadores = 0;
      var colLotes = '';
      var sep = ' , ';

      for (var li = 0; li < lotes.length; li++) {
        totalDia += stats.map[lotes[li]].manana;
        totalTarde += stats.map[lotes[li]].tarde;
      }

      function workersOnLote_(lote) {
        var entry = stats.map[lote] || {};
        return Object.keys(entry.dnis || {}).length;
      }

      if (lotes.length > 1) {
        colDia = lotes
          .map(function (lote) { return stats.map[lote].manana; })
          .join(sep);
        colTarde = lotes
          .map(function (lote) { return stats.map[lote].tarde; })
          .join(sep);
        colTrabajadores = lotes
          .map(function (lote) { return workersOnLote_(lote); })
          .join(sep);
        colLotes = lotes.join(sep);
      } else {
        colDia = totalDia;
        colTarde = totalTarde;
        colTrabajadores = lotes.length
          ? workersOnLote_(lotes[0])
          : countUniqueWorkers_(workers);
        colLotes = lotes.length ? lotes[0] : '';
      }

      var fecha = clean_(d.fecha) || Utilities.formatDate(
        new Date(),
        'America/Lima',
        'yyyy-MM-dd'
      );
      var row = [
        clean_(d.supervisorNombre).toUpperCase(),
        summaryType_(d.tipo),
        colDia,
        colTarde,
        totalDia + totalTarde,
        colTrabajadores,
        colLotes,
        lotes.length > 1 ? 'SI' : 'NO',
        fecha,
        formatHora_(d.horaGuardado)
      ];

      var sh = summarySheet_();
      if (summaryRowExists_(sh, row)) return false;
      sh.getRange(sh.getLastRow() + 1, 1, 1, SUMMARY_HEADERS.length)
        .setValues([row]);
      return true;
    }

    /**
    * Detalle por tipo: SUMA / DESCARTE / RESTA en hojas separadas.
    */
    function saveHarvestDetail_(d, localId) {
      d = d || {};
      localId = clean_(localId || d.localId || d.id);
      var workers = Array.isArray(d.workers) ? d.workers : [];
      if (!workers.length) return 0;

      var tipo = summaryType_(d.tipo);
      var sh = detailSheetForType_(tipo);
      if (localId && detailRowsExist_(sh, localId)) return 0;

      var fecha =
        clean_(d.fecha) ||
        Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd');
      var observacion = clean_(d.observacion || defaultObservacion_(d.tipo)).toUpperCase();
      var variedad = clean_(d.variedad).toUpperCase();
      var loteBase = formatHarvestLote_(d);
      var supervisorNombre = clean_(d.supervisorNombre).toUpperCase();

      if (!countUniqueWorkers_(workers)) return 0;

      var rows = [];
      var seen = {};
      for (var i = 0; i < workers.length; i++) {
        var w = workers[i] || {};
        var dni = digits_(w.dni);
        if (!dni || dni.length < 8) continue;
        var nombre = clean_(w.nombre || w.name).toUpperCase();
        if (!nombre) continue;
        var lote = formatWorkerLote_(w, d, loteBase);
        var rowKey = dni + '|' + lote;
        if (seen[rowKey]) continue;
        seen[rowKey] = true;

        var manana = number_(w.manana);
        var tarde = number_(w.tarde);
        var total = number_(w.total);
        if (!(total > 0)) total = manana + tarde;

        rows.push([
          dni,
          nombre,
          manana,
          tarde,
          total,
          lote,
          variedad,
          observacion,
          rows.length === 0 ? supervisorNombre : '',
          formatHarvestFecha_(fecha)
        ]);
      }

      if (!rows.length) return 0;
      var startRow = sh.getLastRow() + 1;
      sh.getRange(startRow, 1, rows.length, DETAIL_HEADERS.length).setValues(rows);
      sh.getRange(startRow, 1, rows.length, 1).setNumberFormat('@');
      return rows.length;
    }

    function countUniqueWorkers_(workers) {
      var seen = {};
      var n = 0;
      for (var i = 0; i < workers.length; i++) {
        var dni = digits_(workers[i] && workers[i].dni);
        if (!dni || dni.length < 8 || seen[dni]) continue;
        seen[dni] = true;
        n++;
      }
      return n;
    }

    function detailRowsExist_(sh, localId) {
      localId = clean_(localId);
      if (!localId) return false;
      return isDuplicateLocalId_(localId);
    }

    /** Anti-duplicado global por localId (caché del servidor). */
    function detailRowsExistAny_(localId) {
      localId = clean_(localId);
      if (!localId) return false;
      return isDuplicateLocalId_(localId);
    }

    function detailSheetNameForType_(tipo) {
      var key = summaryType_(tipo);
      return DETAIL_SHEETS[key] || DETAIL_SHEETS.SUMA;
    }

    function formatHarvestLote_(d) {
      d = d || {};
      if (Array.isArray(d.lotes) && d.lotes.length > 1) {
        return '';
      }
      if (Array.isArray(d.lotes) && d.lotes.length === 1) {
        return normalizeLoteToken_(d.lotes[0]);
      }
      var raw = normalizeLoteToken_(d.lote || d.codLote || d.loteCodigo);
      if (raw.indexOf(',') >= 0) return '';
      if (raw) return raw;
      return '';
    }

    function normalizeLoteToken_(value) {
      var lote = clean_(value).toUpperCase();
      if (!lote) return '';
      if (lote.indexOf(',') >= 0) {
        lote = clean_(lote.split(',')[0]).toUpperCase();
      }
      return lote;
    }

    function formatWorkerLote_(worker, payload, fallback) {
      worker = worker || {};
      payload = payload || {};
      var fromWorker = clean_(worker.lote || worker.codLote || worker.loteCodigo).toUpperCase();
      if (fromWorker) return fromWorker;
      var fb = clean_(fallback).toUpperCase();
      if (fb) return fb;
      return formatHarvestLote_(payload);
    }

    function defaultObservacion_(tipo) {
      var t = summaryType_(tipo);
      if (t === 'DESCARTE') return 'DESCARTE - DESHIDRATADO';
      if (t === 'RESTA') return 'RESTA';
      return 'SUMA';
    }

    function addUniqueLote_(list, value) {
      var lote = clean_(value).toUpperCase();
      if (lote && list.indexOf(lote) < 0) list.push(lote);
    }

    /** Totales mañana/tarde/trabajadores por lote (solo desde filas reales). */
    function buildSummaryLoteStats_(workers, d) {
      d = d || {};
      workers = Array.isArray(workers) ? workers : [];
      var loteMap = {};
      var order = [];

      function ensureLote(value) {
        var lote = normalizeLoteToken_(value);
        if (!lote) return '';
        if (!loteMap[lote]) {
          loteMap[lote] = { manana: 0, tarde: 0, dnis: {} };
          order.push(lote);
        }
        return lote;
      }

      for (var i = 0; i < workers.length; i++) {
        var w = workers[i] || {};
        var lote = ensureLote(formatWorkerLote_(w, d, ''));
        if (!lote) continue;
        var dni = digits_(w.dni);
        loteMap[lote].manana += number_(w.manana);
        loteMap[lote].tarde += number_(w.tarde);
        if (dni && dni.length >= 8) loteMap[lote].dnis[dni] = true;
      }

      order = order.filter(function (lote) {
        var entry = loteMap[lote] || {};
        var workersCount = Object.keys(entry.dnis || {}).length;
        return workersCount > 0 || number_(entry.manana) + number_(entry.tarde) > 0;
      });

      if (Array.isArray(d.lotes) && d.lotes.length) {
        var preferred = [];
        for (var j = 0; j < d.lotes.length; j++) {
          var key = normalizeLoteToken_(d.lotes[j]);
          if (key && loteMap[key] && preferred.indexOf(key) < 0) {
            preferred.push(key);
          }
        }
        for (var k = 0; k < order.length; k++) {
          if (preferred.indexOf(order[k]) < 0) preferred.push(order[k]);
        }
        order = preferred;
      }

      return { order: order, map: loteMap };
    }

    function summaryType_(value) {
      var tipo = clean_(value).toUpperCase();
      if (tipo.indexOf('DESCARTE') >= 0) return 'DESCARTE';
      if (tipo.indexOf('DESCUENTO') >= 0 || tipo.indexOf('RESTA') >= 0) return 'RESTA';
      return 'SUMA';
    }

    function summaryRowExists_(sh, row) {
      if (!sh || sh.getLastRow() < 2) return false;
      var values = sh
        .getRange(2, 1, sh.getLastRow(), SUMMARY_HEADERS.length)
        .getDisplayValues();
      var expected = row.map(function (value) { return clean_(value); }).join('|');
      for (var i = 0; i < values.length; i++) {
        var current = values[i]
          .map(function (value) { return clean_(value); })
          .join('|');
        if (current === expected) return true;
      }
      return false;
    }

    /** Altas manuales reportadas desde el celular, en hoja separada. */
    function registrarManual_(d) {
      d = d || {};
      var dni = digits_(d.dni);
      var nombre = clean_(d.nombre).toUpperCase();
      if (dni.length !== 8) throw new Error('DNI manual inválido');
      if (!nombre) throw new Error('Falta nombre del trabajador manual');

      var lock = LockService.getScriptLock();
      var got = false;
      try {
        got = lock.tryLock(8000);
        if (!got) throw new Error('El servidor está ocupado. Intente de nuevo.');
        var sh = manualSheet_();
        var fecha = clean_(d.fecha) || Utilities.formatDate(
          new Date(),
          'America/Lima',
          'yyyy-MM-dd'
        );
        var row = [
          fecha,
          formatHora_(d.horaGuardado),
          dni,
          nombre,
          digits_(d.supervisorDni),
          clean_(d.supervisorNombre).toUpperCase()
        ];
        var rowIndex = findValueRow_(sh, 3, dni);
        if (rowIndex > 0) {
          sh.getRange(rowIndex, 1, 1, MANUAL_HEADERS.length).setValues([row]);
          return { dni: dni, created: false, updated: true };
        }
        sh.getRange(sh.getLastRow() + 1, 1, 1, MANUAL_HEADERS.length)
          .setValues([row]);
        return { dni: dni, created: true, updated: false };
      } finally {
        if (got) {
          try { lock.releaseLock(); } catch (_) {}
        }
      }
    }

    function findDniRow_(sh, dni, lastRow) {
    dni = digits_(dni);
    if (!dni || !sh) return -1;
    lastRow = lastRow || sh.getLastRow();
    if (lastRow < 2) return -1;

    // Leer toda la columna A (A2:Aúltima) — evita fallos de TextFinder / formato número
    var colA = sh.getRange('A2:A' + lastRow).getValues();
    for (var i = 0; i < colA.length; i++) {
      if (digits_(colA[i][0]) === dni) return i + 2;
    }
    return -1;
  }

    function findValueRow_(sh, column, value) {
      value = clean_(value);
      if (!sh || !value || sh.getLastRow() < 2) return -1;
      var values = sh
        .getRange(2, column, sh.getLastRow(), 1)
        .getDisplayValues();
      for (var i = 0; i < values.length; i++) {
        if (clean_(values[i][0]) === value) return i + 2;
      }
      return -1;
    }

    function existeVinculo_(dni) {
      dni = digits_(dni);
      if (!dni) return null;
      var sh = sheet_();
      var lastRow = sh.getLastRow();
      var rowIndex = findDniRow_(sh, dni, lastRow);
      if (rowIndex < 2) return null;
      var r = sh.getRange(rowIndex, 1, 1, HEADERS.length).getValues()[0];
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

    var _shCache = null;
    var _harvestShCache = null;
    var _detailShCache = {};
    var _manualShCache = null;

    function sheet_() {
      if (_shCache) return _shCache;
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) throw new Error('No hay spreadsheet activo. Abre DATA-SUPERVISORES.');
      migrateLegacyVinculoSheet_(ss);
      var sh = ss.getSheetByName(SHEET_NAME);
      if (!sh) sh = ss.insertSheet(SHEET_NAME);
      ensureHeaders_(sh);
      _shCache = sh;
      return sh;
    }

    function harvestSheet_() {
      if (_harvestShCache) return _harvestShCache;
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) throw new Error('No hay spreadsheet activo');
      migrateLegacyVinculoSheet_(ss);
      var sh = ss.getSheetByName(HARVEST_SHEET_NAME);
      if (!sh) sh = ss.insertSheet(HARVEST_SHEET_NAME);
      ensureTableHeaders_(sh, HARVEST_HEADERS);
      _harvestShCache = sh;
      return sh;
    }

    function summarySheet_() {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) throw new Error('No hay spreadsheet activo');
      migrateLegacyManualSheet_(ss);
      var sh = ss.getSheetByName(SUMMARY_SHEET_NAME);
      if (!sh) {
        var blankLegacy = ss.getSheetByName('Hoja 2');
        if (blankLegacy && blankLegacy.getLastRow() === 0) {
          blankLegacy.setName(SUMMARY_SHEET_NAME);
          sh = blankLegacy;
        } else {
          sh = ss.insertSheet(SUMMARY_SHEET_NAME);
        }
        ss.setActiveSheet(sh);
        ss.moveActiveSheet(2);
      }
      ensureExactSummaryHeaders_(ss, sh);
      return ss.getSheetByName(SUMMARY_SHEET_NAME);
    }

    function detailSheetForType_(tipo) {
      var key = summaryType_(tipo);
      var name = detailSheetNameForType_(tipo);
      if (_detailShCache[name]) return _detailShCache[name];
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) throw new Error('No hay spreadsheet activo');
      var sh = ss.getSheetByName(name);
      if (!sh) sh = ss.insertSheet(name);
      ensureExactDetailHeaders_(ss, sh, name);
      sh = ss.getSheetByName(name);
      styleDetailHeaders_(sh, key);
      _detailShCache[name] = sh;
      return sh;
    }

    function ensureExactDetailHeaders_(ss, sh, sheetName) {
      sheetName = clean_(sheetName) || sh.getName();
      if (!sh.getLastRow()) {
        writeTableHeaders_(sh, DETAIL_HEADERS);
        return;
      }
      var current = sh
        .getRange(1, 1, 1, Math.max(sh.getLastColumn(), DETAIL_HEADERS.length))
        .getDisplayValues()[0]
        .slice(0, DETAIL_HEADERS.length)
        .map(function (value) { return clean_(value).toUpperCase(); });
      var expected = DETAIL_HEADERS.map(function (value) {
        return clean_(value).toUpperCase();
      });
      if (current.join('|') === expected.join('|')) return;

      var backupName = sheetName + '-ANTERIOR-' + Utilities.formatDate(
        new Date(),
        'America/Lima',
        'yyyyMMdd-HHmmss'
      );
      sh.setName(backupName);
      var fresh = ss.insertSheet(sheetName);
      writeTableHeaders_(fresh, DETAIL_HEADERS);
    }

    function styleDetailHeaders_(sh, tipoKey) {
      var bg = '#5ead51';
      if (tipoKey === 'DESCARTE') bg = '#c45c26';
      if (tipoKey === 'RESTA') bg = '#b42318';
      sh.getRange(1, 1, 1, DETAIL_HEADERS.length)
        .setFontWeight('bold')
        .setBackground(bg)
        .setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }

    function manualSheet_() {
      if (_manualShCache) return _manualShCache;
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) throw new Error('No hay spreadsheet activo');
      migrateLegacyManualSheet_(ss);
      var sh = ss.getSheetByName(MANUAL_SHEET_NAME);
      if (!sh) sh = ss.insertSheet(MANUAL_SHEET_NAME);
      ensureTableHeaders_(sh, MANUAL_HEADERS);
      _manualShCache = sh;
      return sh;
    }

    /**
    * Conserva las altas manuales antiguas: la anterior "Hoja 2" se mueve
    * a TRABAJADORES-MANUALES antes de crear el nuevo resumen DATA-MANUAL.
    */
    function migrateLegacyManualSheet_(ss) {
      if (ss.getSheetByName(MANUAL_SHEET_NAME)) return;
      var legacy = ss.getSheetByName('Hoja 2');
      if (!legacy || legacy.getLastRow() < 1 || legacy.getLastColumn() < 4) return;
      var headers = legacy
        .getRange(1, 1, 1, legacy.getLastColumn())
        .getDisplayValues()[0]
        .map(function (value) { return clean_(value).toUpperCase(); });
      if (
        headers.indexOf('DNI TRABAJADOR') >= 0 &&
        headers.indexOf('NOMBRE TRABAJADOR') >= 0
      ) {
        legacy.setName(MANUAL_SHEET_NAME);
      }
    }

    function ensureExactSummaryHeaders_(ss, sh) {
      if (!sh.getLastRow()) {
        writeTableHeaders_(sh, SUMMARY_HEADERS);
        return;
      }
      var current = sh
        .getRange(1, 1, 1, Math.max(sh.getLastColumn(), SUMMARY_HEADERS.length))
        .getDisplayValues()[0]
        .slice(0, SUMMARY_HEADERS.length)
        .map(function (value) { return clean_(value).toUpperCase(); });
      var expected = SUMMARY_HEADERS.map(function (value) {
        return clean_(value).toUpperCase();
      });
      if (current.join('|') === expected.join('|')) return;

      // No borrar información previa: apartarla y crear la estructura correcta.
      var backupName = 'DATA-MANUAL-ANTERIOR-' + Utilities.formatDate(
        new Date(),
        'America/Lima',
        'yyyyMMdd-HHmmss'
      );
      sh.setName(backupName);
      var fresh = ss.insertSheet(SUMMARY_SHEET_NAME);
      writeTableHeaders_(fresh, SUMMARY_HEADERS);
      ss.setActiveSheet(fresh);
      ss.moveActiveSheet(2);
    }

    /**
    * La versión anterior usaba Hoja 1 para vínculos. Si detecta esos
    * encabezados, la renombra para liberar Hoja 1 sin perder información.
    */
    function migrateLegacyVinculoSheet_(ss) {
      if (ss.getSheetByName(SHEET_NAME)) return;
      var legacy = ss.getSheetByName('Hoja 1');
      if (!legacy || legacy.getLastColumn() < 3 || legacy.getLastRow() < 1) return;
      var headers = legacy
        .getRange(1, 1, 1, legacy.getLastColumn())
        .getValues()[0]
        .map(function (value) { return clean_(value).toUpperCase(); });
      if (
        headers[0] === 'DNI' &&
        headers.indexOf('CELULAR') >= 0 &&
        headers.indexOf('NOMBRE SUPERVISOR GLOBAL') >= 0
      ) {
        legacy.setName(SHEET_NAME);
      }
    }

    function ensureTableHeaders_(sh, headers) {
      var lastRow = sh.getLastRow();
      var first = lastRow
        ? clean_(sh.getRange(1, 1).getValue()).toUpperCase()
        : '';
      if (!lastRow || !first) {
        sh.clear();
        writeTableHeaders_(sh, headers);
        return;
      }
      if (first !== headers[0]) {
        throw new Error(
          'La hoja "' + sh.getName() + '" tiene encabezados incompatibles'
        );
      }
    }

    function writeTableHeaders_(sh, headers) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#5ead51')
        .setFontColor('#ffffff');
    }

    function ensureHeaders_(sh) {
      var lastCol = sh.getLastColumn();
      var first = String(sh.getRange(1, 1).getValue() || '')
        .trim()
        .toUpperCase();
      if (first === 'DNI' && lastCol >= HEADERS.length) return;

      var lastRow = sh.getLastRow();
      if (lastRow === 0 || lastCol === 0) {
        writeHeaders_(sh);
        return;
      }
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

    function formatHarvestFecha_(fecha) {
      var raw = clean_(fecha);
      if (!raw) {
        return Utilities.formatDate(new Date(), 'America/Lima', 'd/MM/yyyy');
      }
      var parts = raw.split('-');
      if (parts.length === 3) {
        return Number(parts[2]) + '/' + parts[1] + '/' + parts[0];
      }
      return raw;
    }

    function formatHora_(value) {
      var date = value ? new Date(value) : new Date();
      if (isNaN(date.getTime())) date = new Date();
      return Utilities.formatDate(date, 'America/Lima', 'hh:mm:ss a');
    }

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
