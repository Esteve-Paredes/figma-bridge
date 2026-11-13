// Manda al server.js local los <pagina>.json que descarga consola/export-consola.js. Sin dependencias (Node 18+).
// Uso (con `node server.js` corriendo en otra terminal): node consola/cargar.js ~/Downloads/*.json
const fs = require("fs");
const path = require("path");

const URL_EXPORT = "http://127.0.0.1:3855/export";

async function main() {
  const archivos = process.argv.slice(2);
  if (!archivos.length) {
    console.error("Uso: node consola/cargar.js <pagina>.json [mas archivos...]");
    process.exit(1);
  }
  let fallos = 0;
  for (const archivo of archivos) {
    const nombre = path.basename(archivo);
    try {
      const res = await fetch(URL_EXPORT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: fs.readFileSync(archivo),
      });
      if (!res.ok) throw new Error("HTTP " + res.status + ": " + (await res.text()));
      const { coleccion, saved } = await res.json();
      console.log(`${nombre} -> exports/${coleccion}/ (${saved.length} vista(s))`);
    } catch (e) {
      fallos++;
      const causa = e.cause && e.cause.code === "ECONNREFUSED" ? "el servidor no esta corriendo (node server.js)" : e.message;
      console.error(`${nombre}: no se pudo cargar: ${causa}`);
    }
  }
  if (fallos) process.exit(1);
}

main();
