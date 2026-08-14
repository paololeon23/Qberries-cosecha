/**
 * Valida contraseña contra LOGIN_PIN (env de Netlify).
 * POST { pin: "…" } → { ok: true }
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

export async function handler(event) {
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

  const expected = String(process.env.LOGIN_PIN || "").trim();
  if (!expected) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({
        ok: false,
        error: "LOGIN_PIN no configurado en Netlify",
      }),
    };
  }

  let pin = "";
  try {
    const body = JSON.parse(event.body || "{}");
    pin = String(body.pin || "").trim();
  } catch {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ ok: false, error: "JSON inválido" }),
    };
  }

  if (pin !== expected) {
    return {
      statusCode: 401,
      headers: cors,
      body: JSON.stringify({ ok: false, error: "Contraseña incorrecta" }),
    };
  }

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({ ok: true }),
  };
};
