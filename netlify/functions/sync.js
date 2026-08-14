/**
 * Proxy seguro a Google Apps Script · Supervisores (vínculos).
 * Env Netlify: APPS_SCRIPT_URL + API_TOKEN (+ LOGIN_PIN opcional).
 * POST { action, data|payload, pin }
 * Envía solo campos precisos al Sheet.
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

/** Solo lo que va al Sheet DATA-SUPERVISORES */
function sanitizeVinculo(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const dni = digits(src.dni);
  const celular = digits(src.celular || src.telefono);
  const dniSesion = digits(src.dniSesion || src.dniInicioSesion || dni) || dni;
  const licN = padGrupo_(src.grupoLic);
  const gN = padGrupo_(src.grupo);
  return {
    dni,
    nombre: cleanText(src.nombre || src.name),
    celular,
    grupoLic: licN ? `GRUPO LIC ${licN}` : "",
    grupo: gN ? `GRUPO ${gN}` : "",
    supervisorGlobal: cleanText(
      src.supervisorGlobal || src.nombreSupervisorGlobal || src.encargado
    ),
    dniSesion,
    horaRegistro: String(src.horaRegistro || src.hora || "").trim(),
    hora: String(src.hora || src.horaRegistro || "").trim(),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: cors,
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
  }

  const scriptUrl = String(process.env.APPS_SCRIPT_URL || "").trim();
  const apiToken = String(process.env.API_TOKEN || "").trim();
  // loginPin no se usa aquí: seguridad = API_TOKEN
  void process.env.LOGIN_PIN;

  if (!scriptUrl || !apiToken) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({
        ok: false,
        error: "APPS_SCRIPT_URL o API_TOKEN no configurados en Netlify",
      }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ ok: false, error: "JSON inválido" }),
    };
  }

  // Seguridad = API_TOKEN hacia Apps Script.
  // LOGIN_PIN solo aplica al login (si lo activan); no bloquear sync por PIN del cliente.
  const action = String(body.action || "registrarVinculo").trim();
  const rawData = body.data ?? body.payload ?? body;
  const data =
    action === "registrarVinculo" ? sanitizeVinculo(rawData) : rawData;

  if (action === "registrarVinculo") {
    if (!data.dni || data.dni.length < 8) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ ok: false, error: "DNI inválido" }),
      };
    }
    if (!/^9\d{8}$/.test(data.celular)) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({
          ok: false,
          error: "Celular inválido: 9 dígitos comenzando con 9",
        }),
      };
    }
    if (!data.supervisorGlobal || data.supervisorGlobal.length < 3) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({
          ok: false,
          error: "Falta nombre del supervisor global",
        }),
      };
    }
    if (!/^GRUPO LIC ([0-5][0-9]|60)$/.test(String(data.grupoLic || ""))) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({
          ok: false,
          error: "Grupo LIC inválido (01 al 60)",
        }),
      };
    }
    if (!/^GRUPO ([0-5][0-9]|60)$/.test(String(data.grupo || ""))) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({
          ok: false,
          error: "Grupo inválido (01 al 60)",
        }),
      };
    }
  }

  const outbound = {
    source: "supervisores",
    action,
    token: apiToken,
    data,
    payload: data,
    at: new Date().toISOString(),
  };

  try {
    const res = await fetch(scriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
        "X-Api-Token": apiToken,
      },
      body: JSON.stringify(outbound),
    });

    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }

    const ok = res.ok && parsed && parsed.ok !== false;
    return {
      statusCode: ok ? 200 : 502,
      headers: cors,
      body: JSON.stringify({
        ok,
        status: res.status,
        data: parsed,
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: cors,
      body: JSON.stringify({
        ok: false,
        error: err.message || "Error al llamar Apps Script",
      }),
    };
  }
};
