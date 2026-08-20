/**
 * Fusiona DNI de Reporte_Horas (COSECHA) en data/trabajadores.json
 * Uso:
 *   node scripts/merge-trabajadores-from-xlsx.mjs "ruta1.xlsx" "ruta2.xlsx"
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import vm from "vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function loadXlsx() {
  const code = fs.readFileSync(path.join(root, "vendor", "xlsx.full.min.js"), "utf8");
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    require,
    Buffer,
    process,
    setTimeout,
    clearTimeout,
  };
  sandbox.global = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(code, sandbox, { timeout: 60000 });
  const XLSX = sandbox.XLSX || sandbox.module.exports || sandbox.exports;
  if (!XLSX?.read) throw new Error("No se pudo cargar vendor/xlsx.full.min.js");
  return XLSX;
}

function digits(v) {
  return String(v ?? "").replace(/\D/g, "");
}

function cleanName(v) {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normHeader(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function isCosecha(actividad, cargo) {
  const a = normHeader(actividad);
  const c = normHeader(cargo);
  if (/SUPERVISOR/.test(c) || /SUPERVISOR/.test(a)) return false;
  return a.includes("COSECHA") || c.includes("COSECHA") || (!a && !c);
}

function pickField(row, aliases) {
  for (const key of Object.keys(row)) {
    const h = normHeader(key);
    if (aliases.some((a) => h === a || h.includes(a))) return row[key];
  }
  return "";
}

function readWorkersFromXlsx(XLSX, filePath) {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: "buffer" });
  const out = new Map();
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
    if (!rows.length) continue;
    for (const row of rows) {
      const dniRaw = pickField(row, [
        "DNI",
        "NRO DOCUMENTO",
        "NUMERO DOCUMENTO",
        "N DOCUMENTO",
        "DOCUMENTO",
        "NRO DOC",
      ]);
      const dni = digits(dniRaw).padStart(8, "0").slice(-8);
      if (dni.length !== 8 || /^0+$/.test(dni)) continue;

      const nombre = cleanName(
        pickField(row, [
          "APELLIDOS Y NOMBRES",
          "NOMBRES Y APELLIDOS",
          "NOMBRE COMPLETO",
          "TRABAJADOR",
          "NOMBRES",
          "NOMBRE",
        ])
      );
      if (!nombre || nombre.length < 3) continue;

      const actividad = pickField(row, ["ACTIVIDAD", "AREA", "AREA LABOR"]);
      const cargo = pickField(row, ["CARGO", "PUESTO", "OCUPACION"]);
      if (!isCosecha(actividad, cargo)) continue;

      out.set(dni, { nombre, cargo: "COSECHA" });
    }
  }
  return out;
}

function main() {
  const files = process.argv.slice(2).filter(Boolean);
  if (!files.length) {
    console.error("Pase una o más rutas .xlsx");
    process.exit(1);
  }
  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.error("No existe:", f);
      process.exit(1);
    }
  }

  const XLSX = loadXlsx();
  const jsonPath = path.join(root, "data", "trabajadores.json");
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const byDni = data.byDni && typeof data.byDni === "object" ? { ...data.byDni } : {};
  const before = Object.keys(byDni).length;

  let fromFiles = 0;
  let added = 0;
  let updated = 0;
  const addedList = [];

  for (const file of files) {
    const map = readWorkersFromXlsx(XLSX, file);
    fromFiles += map.size;
    console.log(`${path.basename(file)} → ${map.size} cosecha (únicos)`);
    for (const [dni, info] of map) {
      const prev = byDni[dni];
      if (!prev) {
        byDni[dni] = info;
        added += 1;
        if (addedList.length < 30) addedList.push(`${dni} ${info.nombre}`);
      } else if (cleanName(prev.nombre) !== info.nombre) {
        byDni[dni] = { ...prev, nombre: info.nombre, cargo: "COSECHA" };
        updated += 1;
      }
    }
  }

  const sorted = Object.fromEntries(
    Object.entries(byDni).sort(([a], [b]) => a.localeCompare(b))
  );

  const next = {
    ...data,
    source: "reporte-horas.xlsx + trabajadores.xlsx + altas manuales",
    count: Object.keys(sorted).length,
    updatedAt: new Date().toISOString(),
    byDni: sorted,
  };

  fs.writeFileSync(jsonPath, JSON.stringify(next, null, 2) + "\n", "utf8");

  const www = path.join(root, "mobile", "www", "data", "trabajadores.json");
  if (fs.existsSync(path.dirname(www))) {
    fs.writeFileSync(www, JSON.stringify(next, null, 2) + "\n", "utf8");
  }

  console.log(
    JSON.stringify(
      {
        before,
        after: next.count,
        scannedUnique: fromFiles,
        added,
        updatedNames: updated,
        sampleAdded: addedList,
      },
      null,
      2
    )
  );
}

main();
