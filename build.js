#!/usr/bin/env node
// Genera plugin/code.js, consola/export-consola.js y web/figma-bridge-web.js a partir de src/: la lectura del diseno vive UNA sola vez
// (src/compartido/serializar.js) y se incluye en las tres plantillas. Sin dependencias (solo Node).
//
//   node build.js          regenera los archivos generados
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
  { plantilla: "src/web.js", destino: "web/figma-bridge-web.js" },
];

const normalizar = (texto) => texto.replace(/\r\n/g, "\n");

// figma-bridge SOLO LEE el diseno. Ninguna operacion de la API de Figma que modifique el archivo puede aparecer en los
// scripts generados: si alguien la agrega, el build y --check fallan. (figma.clientStorage guarda datos locales del
// plugin, no del archivo, y no esta en la lista.)
const ESCRITURA_PROHIBIDA = [
  [/\bfigma\.(create\w+|group|ungroup|flatten|union|subtract|intersect|exclude|import\w+|setCurrentPageAsync|saveVersionHistoryAsync|loadFontAsync)\s*\(/, "figma.<metodo que crea o cambia el documento>()"],
  [/\.(remove|clone|appendChild|insertChild|resize|resizeWithoutConstraints|rescale|setPluginData|setSharedPluginData|setRelaunchData|swapComponent|detachInstance|createInstance|insertCharacters|deleteCharacters|setRange\w+|set\w+StyleIdAsync)\s*\(/, "metodo de nodo que modifica el documento"],
  [/\bfigma\.currentPage\s*=[^=]/, "cambio de la pagina actual"],
];

// Devuelve las lineas (sin comentarios) que contienen una operacion de escritura.
function revisarSoloLectura(contenido) {
  const hallazgos = [];
  contenido.split("\n").forEach((linea, i) => {
    // Sin comentarios y sin el enlace de descarga de la consola, que es DOM del navegador (document.body), no del documento de Figma.
    const codigo = linea.replace(/\/\/.*$/, "").replace(/document\.body\.(appendChild|removeChild)\([^)]*\)/g, "");
    for (const [patron, descripcion] of ESCRITURA_PROHIBIDA) {
      if (patron.test(codigo)) hallazgos.push({ linea: i + 1, texto: linea.trim().slice(0, 100), descripcion });
    }
  });
  return hallazgos;
}

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
let escrituras = 0;

for (const salida of SALIDAS) {
  const { destino, contenido } = generar(salida);
  const hallazgos = revisarSoloLectura(contenido);
  if (hallazgos.length) {
    escrituras += hallazgos.length;
    for (const h of hallazgos) console.error(`ESCRITURA PROHIBIDA en ${destino}:${h.linea} (${h.descripcion}): ${h.texto}`);
    continue; // no se genera ni se da por bueno un script que modifica el archivo de Figma
  }
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
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, contenido, "utf8");
  console.log(`generado: ${destino}`);
}

if (escrituras) {
  console.error("figma-bridge es de solo lectura: quitar esas operaciones de src/.");
  process.exit(1);
}
if (revisar && desalineados) process.exit(1);
