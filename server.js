// Servidor local sin dependencias: recibe el diseno del plugin y lo guarda en ./exports/<nombre>/ (design.json + preview.png).
// Solo escucha en 127.0.0.1, nada sale de esta maquina. Uso: node server.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const { writeCompact } = require("./compact");

const PORT = 3855;
const OUT = path.join(__dirname, "exports");

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

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
    if (req.method !== "POST" || req.url !== "/export") {
      res.writeHead(404, cors);
      return res.end();
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
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
