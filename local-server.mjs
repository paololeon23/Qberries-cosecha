/**
 * Servidor local para pruebas (reemplaza Live Server + Netlify Functions).
 * Uso:  npm start   →  http://127.0.0.1:5500
 *
 * Lee variables de .env (igual que Netlify):
 *   APPS_SCRIPT_URL, API_TOKEN, LOGIN_PIN, TRABAJADORES_SCRIPT_URL
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5500);
const require = createRequire(import.meta.url);

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) {
    const example = path.join(ROOT, ".env.example");
    if (fs.existsSync(example)) {
      fs.copyFileSync(example, envPath);
      console.log("→ Creado .env desde .env.example (edítelo si hace falta)");
    }
  }
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

function send(res, status, body, headers = {}) {
  const payload =
    typeof body === "string" || Buffer.isBuffer(body)
      ? body
      : JSON.stringify(body);
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function safeJoin(urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  const rel = decoded.replace(/^\/+/, "") || "index.html";
  const full = path.normalize(path.join(ROOT, rel));
  if (!full.startsWith(ROOT)) return null;
  return full;
}

function loadLocalTrabajadores() {
  const p = path.join(ROOT, "data", "trabajadores.json");
  if (!fs.existsSync(p)) return { ok: true, byDni: {}, count: 0, source: "empty" };
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  const byDni = data.byDni || data || {};
  return {
    ok: true,
    byDni,
    count: Object.keys(byDni).length,
    source: "local-trabajadores.json",
    cachedAt: new Date().toISOString(),
  };
}

async function runNetlifyHandler(name, event) {
  const file = path.join(ROOT, "netlify", "functions", `${name}.js`);
  // CommonJS handlers
  delete require.cache[require.resolve(file)];
  const mod = require(file);
  if (typeof mod.handler !== "function") {
    throw new Error(`Handler ${name} no encontrado`);
  }
  return mod.handler(event);
}

async function handleFunction(name, req, res) {
  if (req.method === "OPTIONS") {
    return send(res, 204, "");
  }

  const rawBody = req.method === "POST" || req.method === "PUT"
    ? await readBody(req)
    : "";

  // Login local: si no hay PIN, OK (pruebas)
  if (name === "login" && req.method === "POST") {
    const expected = String(process.env.LOGIN_PIN || "").trim();
    if (!expected) {
      return send(res, 200, { ok: true, local: true }, {
        "Content-Type": "application/json",
      });
    }
  }

  // Trabajadores: si no hay URL de catálogo, servir JSON local
  if (name === "trabajadores" && req.method === "POST") {
    const scriptUrl = String(
      process.env.TRABAJADORES_SCRIPT_URL || ""
    ).trim();
    if (!scriptUrl) {
      return send(res, 200, loadLocalTrabajadores(), {
        "Content-Type": "application/json",
      });
    }
  }

  try {
    const result = await runNetlifyHandler(name, {
      httpMethod: req.method,
      headers: req.headers,
      body: rawBody,
      rawUrl: req.url,
      path: req.url,
    });

    const status = result?.statusCode || 200;
    const headers = { ...(result?.headers || {}) };
    let body = result?.body ?? "";

    // Fallback trabajadores si Apps Script no responde catálogo
    if (name === "trabajadores" && status >= 400) {
      return send(res, 200, loadLocalTrabajadores(), {
        "Content-Type": "application/json",
      });
    }

    if (headers["Content-Type"] || headers["content-type"]) {
      return send(res, status, body, headers);
    }
    return send(res, status, body, {
      "Content-Type": "application/json",
      ...headers,
    });
  } catch (err) {
    if (name === "trabajadores") {
      return send(res, 200, loadLocalTrabajadores(), {
        "Content-Type": "application/json",
      });
    }
    console.error(`[local] ${name}:`, err);
    return send(
      res,
      500,
      { ok: false, error: err.message || String(err), local: true },
      { "Content-Type": "application/json" }
    );
  }
}

function serveStatic(req, res) {
  let filePath = safeJoin(req.url || "/");
  if (!filePath) return send(res, 403, "Forbidden");

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  if (!fs.existsSync(filePath)) {
    return send(res, 404, "Not found");
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const data = fs.readFileSync(filePath);
  return send(res, 200, data, { "Content-Type": type });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url || "/";
    const fn = url.match(/^\/\.netlify\/functions\/([a-zA-Z0-9_-]+)/);
    if (fn) {
      return await handleFunction(fn[1], req, res);
    }
    if (req.method === "OPTIONS") return send(res, 204, "");
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, { ok: false, error: "Method Not Allowed" }, {
        "Content-Type": "application/json",
      });
    }
    return serveStatic(req, res);
  } catch (err) {
    console.error(err);
    send(res, 500, "Server error");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const hasUrl = !!String(process.env.APPS_SCRIPT_URL || "").trim();
  const hasTok = !!String(process.env.API_TOKEN || "").trim();
  console.log("");
  console.log("  QBerries Supervisores · local");
  console.log(`  → http://127.0.0.1:${PORT}`);
  console.log(`  APPS_SCRIPT_URL: ${hasUrl ? "OK" : "FALTA en .env"}`);
  console.log(`  API_TOKEN:       ${hasTok ? "OK" : "FALTA en .env"}`);
  console.log("  No use Live Server: aquí sí funcionan los POST.");
  console.log("");
});
