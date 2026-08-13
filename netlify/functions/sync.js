/**
 * Proxy seguro a Google Apps Script · Supervisores (vínculos).
 * Env Netlify: APPS_SCRIPT_URL + API_TOKEN (+ LOGIN_PIN opcional).
 * POST { action, data|payload, pin }
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

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
  const loginPin = String(process.env.LOGIN_PIN || "").trim();

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

  if (loginPin && String(body.pin || "") !== loginPin) {
    return {
      statusCode: 401,
      headers: cors,
      body: JSON.stringify({ ok: false, error: "Sesión / PIN inválido" }),
    };
  }

  const action = String(body.action || "registrarVinculo").trim();
  const data = body.data ?? body.payload ?? body;

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
