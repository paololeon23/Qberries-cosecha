import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Proxy seguro a Google Apps Script · vínculos, cosecha y altas manuales.
 * Env Netlify: APPS_SCRIPT_URL + API_TOKEN
 * POST { action, data|payload, pin }
 * El celular hace POST a esta function; esta function hace GET a Apps Script (más rápido).
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function digits(v) {
  return String(v || "").replace(/\D/g, "");
}

function cleanText(v) {
  return String(v || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function padGrupo_(n) {
  const num = Number(String(n || "").replace(/\D/g, ""));
  if (!num || num < 1 || num > 60) return "";
  return String(num).padStart(2, "0");
}

function isNoTengo(v) {
  const s = String(v || "")
    .trim()
    .toUpperCase()
    .replace(/_/g, " ");
  return /NO\s*TENGO/.test(s);
}

function normGrupoLic(v) {
  if (isNoTengo(v)) return "NO_TENGO";
  const n = padGrupo_(v);
  return n ? `GRUPO LIC ${n}` : "";
}

function normGrupoNum(v) {
  if (isNoTengo(v)) return "NO_TENGO";
  const n = padGrupo_(v);
  return n ? `GRUPO ${n}` : "";
}

function isValidGrupoLic(v) {
  return isNoTengo(v) || /^GRUPO LIC ([0-5][0-9]|60)$/.test(v);
}

function isValidGrupoNum(v) {
  return isNoTengo(v) || /^GRUPO ([0-5][0-9]|60)$/.test(v);
}

/** Solo lo que va al Sheet DATA-SUPERVISORES */
function sanitizeVinculo(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const dni = digits(src.dni);
  const celular = digits(src.celular || src.telefono);
  const dniSesion = digits(src.dniSesion || src.dniInicioSesion || dni) || dni;
  return {
    dni,
    nombre: cleanText(src.nombre || src.name),
    celular,
    grupoLic: normGrupoLic(src.grupoLic),
    grupo: normGrupoNum(src.grupo),
    supervisorGlobal: cleanText(
      src.supervisorGlobal || src.nombreSupervisorGlobal || src.encargado
    ),
    dniSesion,
    horaRegistro: String(src.horaRegistro || src.hora || "").trim(),
    hora: String(src.hora || src.horaRegistro || "").trim(),
  };
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: cors,
    body: JSON.stringify(payload),
  };
}

function verifyAuthToken(token, expectedDni, secret) {
  try {
    const [payload, suppliedSignature] = String(token || "").split(".");
    if (!payload || !suppliedSignature || !secret) return false;
    const expectedSignature = createHmac("sha256", secret)
      .update(payload)
      .digest("base64url");
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      return false;
    }
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return digits(claims?.dni) === digits(expectedDni);
  } catch {
    return false;
  }
}

async function callAppsScript(scriptUrl, params, method = "GET") {
  const u = new URL(String(scriptUrl).split("?")[0]);
  if (method === "GET") {
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v == null) return;
      u.searchParams.set(k, String(v));
    });
  }
  const res = await fetch(u.toString(), {
    method,
    redirect: "follow",
    headers: {
      Accept: "application/json, text/javascript, */*",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "POST" ? JSON.stringify(params || {}) : undefined,
  });
  const text = await res.text();
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
  return { res, text, parsed };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const scriptUrl = String(process.env.APPS_SCRIPT_URL || "").trim();
  const apiToken = String(process.env.API_TOKEN || "").trim();
  void process.env.LOGIN_PIN;

  if (!scriptUrl || !apiToken) {
    return json(500, {
      ok: false,
      error: "APPS_SCRIPT_URL o API_TOKEN no configurados en Netlify",
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "JSON inválido" });
  }

  const action = String(body.action || "registrarVinculo").trim();
  const rawData = body.data ?? body.payload ?? body;
  const data =
    action === "registrarVinculo" ? sanitizeVinculo(rawData) : rawData;

  if (action === "registrarVinculo") {
    if (!data.dni || data.dni.length < 8) {
      return json(400, { ok: false, error: "DNI inválido" });
    }
    // Contraseña en pausa: no exigir authToken (activar con REQUIRE_AUTH_TOKEN=1)
    const requireAuth =
      String(process.env.REQUIRE_AUTH_TOKEN || "").trim() === "1";
    if (
      requireAuth &&
      !verifyAuthToken(body.authToken, data.dni, apiToken)
    ) {
      return json(401, {
        ok: false,
        code: "AUTH_REQUIRED",
        error: "Sesión no válida. Escanee el carnet e ingrese su contraseña.",
      });
    }
    if (!/^9\d{8}$/.test(data.celular)) {
      return json(400, {
        ok: false,
        error: "Celular inválido: 9 dígitos comenzando con 9",
      });
    }
    if (!data.supervisorGlobal || data.supervisorGlobal.length < 3) {
      return json(400, {
        ok: false,
        error: "Falta nombre del supervisor global",
      });
    }
    if (!isValidGrupoLic(String(data.grupoLic || ""))) {
      return json(400, { ok: false, error: "Grupo LIC inválido" });
    }
    if (!isValidGrupoNum(String(data.grupo || ""))) {
      return json(400, { ok: false, error: "Grupo inválido" });
    }
  }
  if (action === "registrarCosecha") {
    const workers = Array.isArray(data?.workers) ? data.workers : [];
    if (!data?.id || !data?.fecha || !workers.length) {
      return json(400, {
        ok: false,
        error: "Registro de cosecha incompleto",
      });
    }
    if (!digits(data?.supervisorDni)) {
      return json(400, {
        ok: false,
        error: "Falta DNI del supervisor",
      });
    }
  }
  if (action === "registrarManual") {
    if (digits(data?.dni).length !== 8 || !cleanText(data?.nombre)) {
      return json(400, {
        ok: false,
        error: "Trabajador manual incompleto",
      });
    }
  }

  const params =
    action === "registrarVinculo"
      ? {
          action: "registrarVinculo",
          token: apiToken,
          dni: data.dni,
          nombre: data.nombre,
          celular: data.celular,
          grupo: data.grupo,
          grupoLic: data.grupoLic,
          supervisorGlobal: data.supervisorGlobal,
          dniSesion: data.dniSesion,
          horaRegistro: data.horaRegistro || data.hora,
          hora: data.hora || data.horaRegistro,
        }
      : action === "existeVinculo"
        ? {
            action: "existeVinculo",
            token: apiToken,
            dni: digits(rawData?.dni || data?.dni),
          }
        : action === "registrarCosecha" || action === "registrarManual"
          ? {
              action,
              token: apiToken,
              data: JSON.stringify(data),
            }
        : { action, token: apiToken };

  try {
    // 1) ¿El DNI ya existe en el Sheet?
    let alreadyRegistered = false;
    if (action === "registrarVinculo" && data.dni) {
      try {
        const check = await callAppsScript(scriptUrl, {
          action: "existeVinculo",
          token: apiToken,
          dni: data.dni,
        });
        if (check.parsed && check.parsed.ok === true && check.parsed.exists === true) {
          alreadyRegistered = true;
        }
      } catch {
        /* si falla el check, igual intentamos guardar */
      }
    }

    const usePost =
      action === "registrarCosecha" || action === "registrarManual";
    const { res, text, parsed } = await callAppsScript(
      scriptUrl,
      params,
      usePost ? "POST" : "GET"
    );
    const ok = !!(parsed && parsed.ok === true);
    if (!ok) {
      return json(502, {
        ok: false,
        status: res.status,
        error:
          parsed?.message ||
          parsed?.error ||
          (String(text || "").includes("<html")
            ? "Apps Script no respondió JSON. Implemente como aplicación web (Cualquier persona)."
            : "Error al guardar"),
        data: parsed || { raw: String(text || "").slice(0, 180) },
      });
    }

    alreadyRegistered = !!(
      alreadyRegistered ||
      parsed.alreadyRegistered === true ||
      parsed?.data?.alreadyRegistered === true
    );
    // Solo "ya registrado" si existía antes o el Script lo marca así (no por created)
    if (parsed.created === true || parsed?.data?.created === true) {
      alreadyRegistered = false;
    }
    const message = alreadyRegistered
      ? "Ya se tiene este DNI registrado"
      : "Fue guardado correctamente";

    return json(200, {
      ok: true,
      status: res.status,
      alreadyRegistered,
      updated: alreadyRegistered || !!(parsed.updated || parsed?.data?.updated),
      created: !alreadyRegistered && !!(parsed.created || parsed?.data?.created),
      message,
      data: parsed,
    });
  } catch (err) {
    return json(502, {
      ok: false,
      error: err.message || "Error al llamar Apps Script",
    });
  }
}
