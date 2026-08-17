import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Valida QR/DNI + contraseña y devuelve un comprobante firmado.
 * Pruebas: LOGIN_PIN=231223.
 * Producción: SUPERVISOR_PINS={"70839380":"clave-personal", ...}
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

  const masterPin = String(process.env.LOGIN_PIN || "").trim();
  const signingSecret = String(process.env.API_TOKEN || "").trim();
  let supervisorPins = {};
  try {
    supervisorPins = JSON.parse(process.env.SUPERVISOR_PINS || "{}");
  } catch {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ ok: false, error: "SUPERVISOR_PINS no es JSON válido" }),
    };
  }

  if ((!masterPin && !Object.keys(supervisorPins).length) || !signingSecret) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({
        ok: false,
        error: "Falta LOGIN_PIN/SUPERVISOR_PINS o API_TOKEN en Netlify",
      }),
    };
  }

  let pin = "";
  let dni = "";
  try {
    const body = JSON.parse(event.body || "{}");
    pin = String(body.pin || "").trim();
    dni = String(body.dni || "").replace(/\D/g, "");
  } catch {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ ok: false, error: "JSON inválido" }),
    };
  }

  if (!/^\d{8,12}$/.test(dni)) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ ok: false, error: "DNI inválido" }),
    };
  }

  const hasPersonalPins = Object.keys(supervisorPins).length > 0;
  const personalPin = String(supervisorPins[dni] || "").trim();
  if (hasPersonalPins && !personalPin) {
    return {
      statusCode: 403,
      headers: cors,
      body: JSON.stringify({ ok: false, error: "Supervisor sin acceso configurado" }),
    };
  }
  const expected = hasPersonalPins ? personalPin : masterPin;
  const providedBuffer = Buffer.from(pin);
  const expectedBuffer = Buffer.from(expected);
  const valid =
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer);

  if (!valid) {
    return {
      statusCode: 401,
      headers: cors,
      body: JSON.stringify({ ok: false, error: "Contraseña incorrecta" }),
    };
  }

  const payload = Buffer.from(
    JSON.stringify({ dni, issuedAt: Date.now(), version: 1 })
  ).toString("base64url");
  const signature = createHmac("sha256", signingSecret)
    .update(payload)
    .digest("base64url");

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({ ok: true, dni, token: `${payload}.${signature}` }),
  };
};
