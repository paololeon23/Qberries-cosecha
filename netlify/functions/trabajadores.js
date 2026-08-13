/**
 * Proxy: lista trabajadores desde TRABAJADORES_SCRIPT_URL + API_TOKEN.
 * La app cachea la respuesta en el dispositivo (1ª carga).
 * POST { pin?, force? } → { ok, byDni, count, cachedAt }
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

function normalizeWorkers(payload) {
  const byDni = {};
  const push = (dni, nombre, cargo, celular) => {
    const key = digits(dni);
    if (!key || key.length < 8) return;
    const name = String(nombre || "").trim().toUpperCase();
    if (!name) return;
    byDni[key] = {
      nombre: name,
      cargo: String(cargo || "").trim().toUpperCase(),
      celular: digits(celular),
    };
  };

  if (!payload) return byDni;

  if (payload.byDni && typeof payload.byDni === "object") {
    Object.entries(payload.byDni).forEach(([dni, info]) => {
      if (typeof info === "string") push(dni, info, "", "");
      else if (info && typeof info === "object") {
        push(dni, info.nombre || info.name, info.cargo, info.celular || info.telefono);
      }
    });
    return byDni;
  }

  const list =
    (Array.isArray(payload.data) && payload.data) ||
    (Array.isArray(payload.trabajadores) && payload.trabajadores) ||
    (Array.isArray(payload.rows) && payload.rows) ||
    (Array.isArray(payload) && payload) ||
    [];

  list.forEach((row) => {
    if (!row || typeof row !== "object") return;
    push(
      row.dni || row.DNI || row.documento,
      row.nombre || row.NOMBRE || row.apellidosNombres || row.name,
      row.cargo || row.CARGO || row.puesto,
      row.celular || row.CELULAR || row.telefono || row.TELEFONO
    );
  });

  return byDni;
}

async function callScript(url, token, action) {
  const attempts = [
    {
      method: "POST",
      body: JSON.stringify({ action, token, apiToken: token }),
    },
    {
      method: "GET",
      qs: `?action=${encodeURIComponent(action)}&token=${encodeURIComponent(token)}`,
    },
  ];

  let lastErr = null;
  for (const a of attempts) {
    try {
      const res = await fetch(a.method === "GET" ? url + a.qs : url, {
        method: a.method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Api-Token": token,
        },
        body: a.method === "POST" ? a.body : undefined,
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      if (!res.ok || !data) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      if (data.ok === false) {
        lastErr = data.message || data.error || "script error";
        continue;
      }
      return data;
    } catch (err) {
      lastErr = err.message || String(err);
    }
  }
  throw new Error(lastErr || "No se pudo leer trabajadores");
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

  const scriptUrl = String(
    process.env.TRABAJADORES_SCRIPT_URL || process.env.APPS_SCRIPT_URL || ""
  ).trim();
  const apiToken = String(process.env.API_TOKEN || "").trim();
  const loginPin = String(process.env.LOGIN_PIN || "").trim();

  if (!scriptUrl || !apiToken) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({
        ok: false,
        error: "TRABAJADORES_SCRIPT_URL o API_TOKEN no configurados",
      }),
    };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ ok: false, error: "JSON inválido" }),
    };
  }

  if (loginPin && body.pin && String(body.pin) !== loginPin) {
    return {
      statusCode: 401,
      headers: cors,
      body: JSON.stringify({ ok: false, error: "Sesión / PIN inválido" }),
    };
  }

  try {
    const actions = [
      "listarTrabajadores",
      "getTrabajadores",
      "trabajadores",
      "listar",
    ];
    let raw = null;
    let lastErr = null;
    for (const action of actions) {
      try {
        raw = await callScript(scriptUrl, apiToken, action);
        const byDni = normalizeWorkers(raw);
        if (Object.keys(byDni).length) {
          return {
            statusCode: 200,
            headers: cors,
            body: JSON.stringify({
              ok: true,
              source: "trabajadores-script",
              action,
              count: Object.keys(byDni).length,
              cachedAt: new Date().toISOString(),
              byDni,
            }),
          };
        }
        lastErr = "respuesta vacía";
      } catch (err) {
        lastErr = err.message || String(err);
      }
    }

    return {
      statusCode: 502,
      headers: cors,
      body: JSON.stringify({
        ok: false,
        error: lastErr || "Sin trabajadores en la API",
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: cors,
      body: JSON.stringify({
        ok: false,
        error: err.message || "Error al llamar trabajadores",
      }),
    };
  }
};
