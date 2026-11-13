// Corre dentro de Figma. Lee la seleccion, la serializa y manda JSON + PNG a la UI (que los envia al servidor local).
const MAX_DEPTH = 12;

/* @incluir compartido/serializar.js */

function toBase64(bytes) {
  return figma.base64Encode(bytes);
}

// Colecciones: cada exportacion se guarda en exports/<coleccion>/<vista>/. Por defecto la coleccion es la pagina de Figma
// (ej. "🟡 Módulo checkout" -> "modulo-checkout"); la ventana la muestra rellena y se puede cambiar. Lo cambiado se recuerda por pagina.
let pending = null;
let uiReady = false;

function flush() {
  if (pending && uiReady) {
    // figma.mixed es un Symbol y no se puede enviar por postMessage: se reemplaza por el texto "mixed".
    const payload = JSON.parse(JSON.stringify(pending, (k, v) => (typeof v === "symbol" ? "mixed" : v)));
    figma.ui.postMessage({ type: "init", payload });
    pending = null;
  }
}

async function main() {
  const sel = figma.currentPage.selection;
  if (!sel.length) {
    figma.notify("Selecciona al menos un frame o elemento.", { error: true, timeout: 20000 });
    figma.closePlugin();
    return;
  }
  console.log("[bridge] seleccion:", sel.length);
  const items = [];
  for (const node of sel) {
    console.log("[bridge] serializando", node.name);
    const data = await serialize(node, 0);
    let png = null;
    try {
      const bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } });
      png = toBase64(bytes);
    } catch (e) {}
    items.push({ name: node.name, data, png });
  }
  let remembered = null;
  try {
    remembered = await figma.clientStorage.getAsync("coleccion:" + figma.currentPage.id);
  } catch (e) {}
  console.log("[bridge] listo, items:", items.length);
  figma.showUI(__html__, { width: 340, height: 190 });
  pending = {
    file: figma.root.name,
    page: figma.currentPage.name,
    coleccionSugerida: remembered || figma.currentPage.name,
    items,
  };
  flush();
}

figma.ui.onmessage = async (msg) => {
  console.log("[bridge] mensaje de UI:", msg.type, msg.message || "");
  if (msg.type === "ready") {
    uiReady = true;
    flush();
    return;
  }
  if (msg.type === "remember") {
    try {
      await figma.clientStorage.setAsync("coleccion:" + figma.currentPage.id, msg.value);
    } catch (e) {}
    return;
  }
  if (msg.type === "cancel") return figma.closePlugin();
  if (msg.type === "done") figma.notify("Diseño enviado a " + msg.coleccion + ": " + msg.saved.join(", "), { timeout: 8000 });
  if (msg.type === "error") figma.notify("No se pudo enviar: " + msg.message, { error: true, timeout: 20000 });
  figma.closePlugin();
};

main().catch((e) => {
  figma.notify("Error leyendo el diseño: " + (e && e.message ? e.message : e), { error: true, timeout: 20000 });
  figma.closePlugin();
});
