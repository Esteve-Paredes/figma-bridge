// Corre dentro de Figma. Lee la seleccion, la serializa y manda JSON + PNG a la UI (que los envia al servidor local).
const MAX_DEPTH = 12;

function hex(c) {
  const h = (n) => Math.round(n * 255).toString(16).padStart(2, "0");
  return "#" + h(c.r) + h(c.g) + h(c.b);
}

function paints(list) {
  if (list === figma.mixed || !Array.isArray(list)) return undefined;
  const out = list
    .filter((p) => p.visible !== false)
    .map((p) => {
      if (p.type === "SOLID") return { type: "SOLID", color: hex(p.color), opacity: p.opacity ?? 1 };
      if (p.type.startsWith("GRADIENT"))
        return {
          type: p.type,
          opacity: p.opacity ?? 1,
          stops: p.gradientStops.map((s) => ({ position: s.position, color: hex(s.color), alpha: s.color.a })),
        };
      return { type: p.type, opacity: p.opacity ?? 1 };
    });
  return out.length ? out : undefined;
}

function effects(list) {
  if (!Array.isArray(list) || !list.length) return undefined;
  return list
    .filter((e) => e.visible !== false)
    .map((e) => ({
      type: e.type,
      radius: e.radius,
      offset: e.offset,
      spread: e.spread,
      color: e.color ? hex(e.color) : undefined,
      alpha: e.color ? e.color.a : undefined,
    }));
}

function textInfo(n) {
  const base = {
    characters: n.characters,
    fontSize: n.fontSize,
    fontName: n.fontName,
    fontWeight: n.fontWeight,
    lineHeight: n.lineHeight,
    letterSpacing: n.letterSpacing,
    textAlignHorizontal: n.textAlignHorizontal,
    textCase: n.textCase,
    textDecoration: n.textDecoration,
  };
  if (n.fontSize === figma.mixed || n.fontName === figma.mixed || n.fontWeight === figma.mixed) {
    base.segments = n.getStyledTextSegments(["fontSize", "fontName", "fontWeight", "fills", "textDecoration"]).map((s) => ({
      text: s.characters,
      fontSize: s.fontSize,
      fontName: s.fontName,
      fontWeight: s.fontWeight,
      fills: paints(s.fills),
      textDecoration: s.textDecoration,
    }));
    delete base.fontSize;
    delete base.fontName;
    delete base.fontWeight;
    delete base.textDecoration;
  }
  return base;
}

async function serialize(node, depth) {
  const o = { id: node.id, name: node.name, type: node.type };
  if (node.visible === false) o.visible = false;
  if ("x" in node) {
    o.x = Math.round(node.x * 100) / 100;
    o.y = Math.round(node.y * 100) / 100;
  }
  if ("width" in node) {
    o.width = Math.round(node.width * 100) / 100;
    o.height = Math.round(node.height * 100) / 100;
  }
  if ("opacity" in node && node.opacity !== 1) o.opacity = node.opacity;
  if ("fills" in node) o.fills = paints(node.fills);
  if ("strokes" in node && node.strokes.length) {
    o.strokes = paints(node.strokes);
    o.strokeWeight = node.strokeWeight;
    o.strokeAlign = node.strokeAlign;
    // Grosor distinto por lado (ej. solo borde inferior): figma.mixed no dice cuanto, se piden los 4 lados.
    if (node.strokeWeight === figma.mixed && "strokeTopWeight" in node) {
      o.strokeWeights = [node.strokeTopWeight, node.strokeRightWeight, node.strokeBottomWeight, node.strokeLeftWeight];
    }
  }
  if ("cornerRadius" in node) {
    o.cornerRadius =
      node.cornerRadius === figma.mixed
        ? [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius]
        : node.cornerRadius || undefined;
  }
  if ("effects" in node) o.effects = effects(node.effects);
  if ("layoutMode" in node && node.layoutMode !== "NONE") {
    o.autoLayout = {
      direction: node.layoutMode,
      gap: node.itemSpacing,
      padding: [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft],
      mainAxisAlign: node.primaryAxisAlignItems,
      crossAxisAlign: node.counterAxisAlignItems,
      wrap: node.layoutWrap,
    };
  }
  if ("layoutSizingHorizontal" in node) {
    o.sizing = { h: node.layoutSizingHorizontal, v: node.layoutSizingVertical };
  }
  if ("layoutGrow" in node && node.layoutGrow) o.layoutGrow = node.layoutGrow;
  if ("clipsContent" in node && node.clipsContent) o.clipsContent = true;
  if (node.type === "TEXT") o.text = textInfo(node);
  if (node.type === "INSTANCE") {
    try {
      const main = await node.getMainComponentAsync();
      o.component = main ? main.name : undefined;
      o.variant = node.variantProperties || undefined;
    } catch (e) {}
  }
  if ("children" in node && depth < MAX_DEPTH) {
    o.children = [];
    for (const c of node.children) o.children.push(await serialize(c, depth + 1));
  }
  return o;
}

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
