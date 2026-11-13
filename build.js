#!/usr/bin/env node
// Genera plugin/code.js y consola/export-consola.js a partir de src/: la lectura del diseno vive UNA sola vez
// (src/compartido/serializar.js) y se incluye en las dos plantillas. Sin dependencias (solo Node).
//
//   node build.js          regenera los dos archivos
//   node build.js --check  no escribe nada: sale con codigo 1 si alguno no coincide con lo que generaria src/
//
// Los archivos generados se suben al repo (el plugin y la consola no pueden leer otros archivos, y asi nadie tiene
// que compilar para usarlos). Editar siempre src/ y volver a correr este script.
const fs = require("fs");
const path = require("path");

const RAIZ = __dirname;
const MARCADOR = /^([ \t]*)\/\* @incluir (.+?) \*\/[ \t]*$/;

const SALIDAS = [
  { plantilla: "src/plugin.js", destino: "plugin/code.js" },
  { plantilla: "src/consola.js", destino: "consola/export-consola.js" },
];

const normalizar = (texto) => texto.replace(/\r\n/g, "\n");

function generar({ plantilla, destino }) {
  const lineas = normalizar(fs.readFileSync(path.join(RAIZ, plantilla), "utf8")).split("\n");
  const salida = [];
  for (const linea of lineas) {
    const m = linea.match(MARCADOR);
    if (!m) {
      salida.push(linea);
      continue;
    }
    const [, sangria, ruta] = m;
    const incluido = normalizar(fs.readFileSync(path.join(RAIZ, "src", ruta), "utf8")).replace(/\n+$/, "");
    for (const l of incluido.split("\n")) salida.push(l ? sangria + l : l);
  }
  const aviso = `// GENERADO por build.js desde ${plantilla} y src/compartido/. No editar a mano: editar src/ y correr \`node build.js\`.`;
  // El aviso va despues de la primera linea de comentario de cabecera para no tapar el titulo del archivo.
  const [primera, ...resto] = salida;
  return { destino, contenido: [primera, aviso, ...resto].join("\n") };
}

const revisar = process.argv.includes("--check");
let desalineados = 0;

for (const salida of SALIDAS) {
  const { destino, contenido } = generar(salida);
  const ruta = path.join(RAIZ, destino);
  const actual = fs.existsSync(ruta) ? normalizar(fs.readFileSync(ruta, "utf8")) : null;
  if (revisar) {
    if (actual !== contenido) {
      desalineados++;
      console.error(`DESALINEADO: ${destino} no coincide con lo que genera src/. Corre \`node build.js\` y sube el resultado.`);
    } else {
      console.log(`ok: ${destino}`);
    }
    continue;
  }
  if (actual === contenido) {
    console.log(`sin cambios: ${destino}`);
    continue;
  }
  fs.writeFileSync(ruta, contenido, "utf8");
  console.log(`generado: ${destino}`);
}

if (revisar && desalineados) process.exit(1);
