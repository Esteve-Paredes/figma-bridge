// Servidor local sin dependencias: recibe el diseno del plugin y lo guarda en ./exports/<nombre>/ (design.json + preview.png).
// Solo escucha en 127.0.0.1, nada sale de esta maquina. Uso: node server.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const { writeCompact } = require("./compact");

// PORT permite levantar una segunda instancia (p. ej. para pruebas); el plugin de escritorio sigue apuntando a 3855.
const PORT = Number(process.env.PORT) || 3855;
const OUT = path.join(__dirname, "exports");
const WEB_JS = path.join(__dirname, "web", "figma-bridge-web.js");

const slug = (s, fallback = "diseno") =>
  String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || fallback;

// Carpeta de la vista dentro de la coleccion. Misma vista (mismo id de Figma) = se reemplaza; otra vista con el mismo nombre = sufijo -2, -3...
function carpetaDeVista(colDir, nombre, nodeId) {
  const base = slug(nombre);
  for (let i = 1; ; i++) {
    const carpeta = i === 1 ? base : base + "-" + i;
    const designPath = path.join(colDir, carpeta, "design.json");
    if (!fs.existsSync(designPath)) return carpeta;
    try {
      if (JSON.parse(fs.readFileSync(designPath, "utf8")).node.id === nodeId) return carpeta;
    } catch (e) {}
  }
}

// index.json: lista de las vistas de la coleccion, para que el agente conozca el alcance completo del modulo sin mirar otras carpetas.
function actualizarIndice(colDir, coleccion, vista) {
  const indexPath = path.join(colDir, "index.json");
  let index = { coleccion, vistas: [] };
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch (e) {}
  index.coleccion = coleccion;
  index.actualizado = new Date().toISOString();
  index.vistas = index.vistas.filter((v) => v.carpeta !== vista.carpeta).concat(vista).sort((a, b) => a.carpeta.localeCompare(b.carpeta));
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

const EXTENSIONES_RECURSO = new Set(["svg", "png"]);

// Recursos sueltos (logos, iconos, ilustraciones) de una coleccion: exports/<coleccion>/recursos/<nombre>.<ext> + recursos/index.json con sus metadatos.
// El nombre del archivo se sanea (sin rutas) y solo se aceptan svg y png.
function guardarRecursos({ coleccion: colCruda, archivos }) {
  if (!Array.isArray(archivos) || !archivos.length) throw new Error("Faltan archivos");
  const coleccion = slug(colCruda || "sin-coleccion", "sin-coleccion");
  const dir = path.join(OUT, coleccion, "recursos");
  fs.mkdirSync(dir, { recursive: true });
  const indexPath = path.join(dir, "index.json");
  let index = { coleccion, recursos: [] };
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch (e) {}
  const guardados = [];
  for (const a of archivos) {
    const ext = String(a.formato || "").toLowerCase();
    if (!EXTENSIONES_RECURSO.has(ext)) throw new Error(`Formato no permitido: ${a.formato}`);
    const archivo = `${slug(a.nombre, "recurso")}.${ext}`;
    const contenido = a.encoding === "base64" ? Buffer.from(a.data, "base64") : Buffer.from(String(a.data), "utf8");
    fs.writeFileSync(path.join(dir, archivo), contenido);
    const meta = { archivo, nodeId: a.nodeId, nombreFigma: a.nombreFigma, formato: ext, escala: a.escala, ancho: a.ancho, alto: a.alto, bytes: contenido.length, exportadoEn: new Date().toISOString() };
    index.recursos = index.recursos.filter((r) => r.archivo !== archivo).concat(meta);
    guardados.push(archivo);
    console.log("Recurso:", path.join(dir, archivo));
  }
  index.actualizado = new Date().toISOString();
  index.recursos.sort((x, y) => x.archivo.localeCompare(y.archivo));
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  return { coleccion, guardados };
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Private-Network": "true",
};

http
  .createServer((req, res) => {
    console.log(req.method, req.url);
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }
    // Modo web: el agente inyecta este script en Figma web y confirma que el servidor esta vivo (solo lectura).
    if (req.method === "GET" && req.url === "/estado") {
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, exports: OUT, webJs: fs.existsSync(WEB_JS) }));
    }
    if (req.method === "GET" && req.url === "/web.js") {
      if (!fs.existsSync(WEB_JS)) {
        res.writeHead(404, cors);
        return res.end("Falta web/figma-bridge-web.js: corre node build.js");
      }
      res.writeHead(200, { ...cors, "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(fs.readFileSync(WEB_JS));
    }
    if (req.method !== "POST" || (req.url !== "/export" && req.url !== "/recursos")) {
      res.writeHead(404, cors);
      return res.end();
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        if (req.url === "/recursos") {
          const r = guardarRecursos(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          res.writeHead(200, { ...cors, "Content-Type": "application/json" });
          return res.end(JSON.stringify(r));
        }
        const { file, page, coleccion: colCruda, items } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const coleccion = slug(colCruda || page || "sin-coleccion", "sin-coleccion");
        const colDir = path.join(OUT, coleccion);
        const saved = [];
        for (const item of items) {
          const carpeta = carpetaDeVista(colDir, item.name, item.data.id);
          const dir = path.join(colDir, carpeta);
          fs.mkdirSync(dir, { recursive: true });
          const exportedAt = new Date().toISOString();
          fs.writeFileSync(
            path.join(dir, "design.json"),
            JSON.stringify({ file, page, coleccion, exportedAt, node: item.data }, null, 2),
          );
          if (item.png) fs.writeFileSync(path.join(dir, "preview.png"), Buffer.from(item.png, "base64"));
          // La version compacta es un extra: si falla, el export completo ya quedo guardado.
          try {
            const r = writeCompact(path.join(dir, "design.json"));
            console.log(`Compacto: ${Math.round(r.before / 1024)} KB -> ${Math.round(r.after / 1024)} KB`);
          } catch (e) {
            console.error("No se pudo generar design.compact.json (el completo esta guardado):", e.message);
          }
          actualizarIndice(colDir, coleccion, {
            carpeta,
            nombre: item.name,
            nodeId: item.data.id,
            tamano: [item.data.width, item.data.height],
            paginaFigma: page,
            exportadoEn: exportedAt,
          });
          saved.push(carpeta);
          console.log("Guardado:", dir);
        }
        res.writeHead(200, { ...cors, "Content-Type": "application/json" });
        res.end(JSON.stringify({ coleccion, saved }));
      } catch (e) {
        console.error(e);
        res.writeHead(500, cors);
        res.end(String(e.message));
      }
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log("Escuchando en http://localhost:" + PORT + " -> " + OUT));
