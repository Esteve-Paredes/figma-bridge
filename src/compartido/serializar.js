// Lectura del diseno compartida por el plugin (plugin/code.js) y el script de consola (consola/export-consola.js).
// Se incluye tal cual en los dos por build.js. Espera que el archivo que lo incluye ya defina MAX_DEPTH.
// Solo LEE el documento: no modifica nada del archivo de Figma.
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
  if ("children" in node) {
    if (depth < MAX_DEPTH) {
      o.children = [];
      for (const c of node.children) o.children.push(await serialize(c, depth + 1));
    } else if (node.children.length) {
      // Un arbol mas profundo que MAX_DEPTH se corta, pero con aviso (compact.js lo conserva en design.compact.json).
      o._truncado = `${node.children.length} hijo(s) no exportados (MAX_DEPTH=${MAX_DEPTH})`;
    }
  }
  return o;
}
