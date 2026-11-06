// Export desde la consola de DevTools de Figma web, para quien no tiene la app de escritorio (Linux) o no puede
// importar plugins de desarrollo. Misma serializacion que plugin/code.js y mismo payload que espera server.js.
// SOLO LEE el documento. Se corre sobre una copia del archivo en Borradores (ver README, "Sin app de escritorio").
// Descarga un <pagina>.json por pagina; luego `node consola/cargar.js <archivos>` los manda al server.js local.
(async () => {
  // --- Opciones ---
  const SOLO_PAGINA_ACTUAL = false; // true: exporta solo la pagina abierta (re-exportar un modulo)
  const PNG_SCALE = 1; // 1x: el archivo completo a 2x pesa demasiado. El plugin exporta a 2x
  const MAX_DEPTH = 12; // igual que el plugin; mas profundo deja la marca _truncado
  const EXIGIR_COPIA = true; // false para correrlo en un archivo propio que no se llame "(Copy)"

  const slug = (s, fb = "sin-nombre") =>
    String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || fb;

  const hex = (c) => "#" + [c.r, c.g, c.b].map((n) => Math.round(n * 255).toString(16).padStart(2, "0")).join("");

  function paints(list) {
    if (list === figma.mixed || !Array.isArray(list)) return undefined;
    const out = list.filter((p) => p.visible !== false).map((p) => {
      if (p.type === "SOLID") return { type: "SOLID", color: hex(p.color), opacity: p.opacity ?? 1 };
      if (p.type.startsWith("GRADIENT"))
        return { type: p.type, opacity: p.opacity ?? 1, stops: p.gradientStops.map((s) => ({ position: s.position, color: hex(s.color), alpha: s.color.a })) };
      return { type: p.type, opacity: p.opacity ?? 1 };
    });
    return out.length ? out : undefined;
  }

  function effects(list) {
    if (!Array.isArray(list) || !list.length) return undefined;
    return list.filter((e) => e.visible !== false).map((e) => ({
      type: e.type, radius: e.radius, offset: e.offset, spread: e.spread,
      color: e.color ? hex(e.color) : undefined, alpha: e.color ? e.color.a : undefined,
    }));
  }

  function textInfo(n) {
    const base = {
      characters: n.characters, fontSize: n.fontSize, fontName: n.fontName, fontWeight: n.fontWeight,
      lineHeight: n.lineHeight, letterSpacing: n.letterSpacing, textAlignHorizontal: n.textAlignHorizontal,
      textCase: n.textCase, textDecoration: n.textDecoration,
    };
    if (n.fontSize === figma.mixed || n.fontName === figma.mixed || n.fontWeight === figma.mixed) {
      base.segments = n.getStyledTextSegments(["fontSize", "fontName", "fontWeight", "fills", "textDecoration"]).map((s) => ({
        text: s.characters, fontSize: s.fontSize, fontName: s.fontName, fontWeight: s.fontWeight, fills: paints(s.fills), textDecoration: s.textDecoration,
      }));
      delete base.fontSize; delete base.fontName; delete base.fontWeight; delete base.textDecoration;
    }
    return base;
  }

  async function serialize(node, depth) {
    const o = { id: node.id, name: node.name, type: node.type };
    if (node.visible === false) o.visible = false;
    if ("x" in node) { o.x = Math.round(node.x * 100) / 100; o.y = Math.round(node.y * 100) / 100; }
    if ("width" in node) { o.width = Math.round(node.width * 100) / 100; o.height = Math.round(node.height * 100) / 100; }
    if ("opacity" in node && node.opacity !== 1) o.opacity = node.opacity;
    if ("fills" in node) o.fills = paints(node.fills);
    if ("strokes" in node && node.strokes.length) {
      o.strokes = paints(node.strokes);
      o.strokeWeight = node.strokeWeight;
      o.strokeAlign = node.strokeAlign;
      if (node.strokeWeight === figma.mixed && "strokeTopWeight" in node)
        o.strokeWeights = [node.strokeTopWeight, node.strokeRightWeight, node.strokeBottomWeight, node.strokeLeftWeight];
    }
    if ("cornerRadius" in node)
      o.cornerRadius = node.cornerRadius === figma.mixed
        ? [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius]
        : node.cornerRadius || undefined;
    if ("effects" in node) o.effects = effects(node.effects);
    if ("layoutMode" in node && node.layoutMode !== "NONE")
      o.autoLayout = {
        direction: node.layoutMode, gap: node.itemSpacing,
        padding: [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft],
        mainAxisAlign: node.primaryAxisAlignItems, crossAxisAlign: node.counterAxisAlignItems, wrap: node.layoutWrap,
      };
    if ("layoutSizingHorizontal" in node) o.sizing = { h: node.layoutSizingHorizontal, v: node.layoutSizingVertical };
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
        o._truncado = `${node.children.length} hijo(s) no exportados (MAX_DEPTH=${MAX_DEPTH})`;
      }
    }
    return o;
  }

  // Vistas = frames de primer nivel de la pagina, y frames dentro de secciones de primer nivel.
  function vistasDePagina(page) {
    const out = [];
    for (const n of page.children) {
      if (n.type === "SECTION") out.push(...n.children.filter((c) => c.type === "FRAME" || c.type === "COMPONENT"));
      else if (n.type === "FRAME" || n.type === "COMPONENT") out.push(n);
    }
    return out;
  }

  function descargar(nombre, obj) {
    const json = JSON.stringify(obj, (k, v) => (typeof v === "symbol" ? "mixed" : v));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (EXIGIR_COPIA && !/\(copy\)|copia/i.test(figma.root.name)) {
    console.warn(
      `[export] "${figma.root.name}" no parece una copia en Borradores, asi que no se exporto nada. ` +
        `Duplica el archivo (menu del nombre -> Duplicate to your drafts) y corre el script ahi, ` +
        `o pon EXIGIR_COPIA = false si el archivo es tuyo.`,
    );
    return;
  }
  console.log(`[export] exportando ${SOLO_PAGINA_ACTUAL ? "la pagina actual" : "todas las paginas"} de "${figma.root.name}"...`);

  const resumen = [];
  const paginas = SOLO_PAGINA_ACTUAL ? [figma.currentPage] : figma.root.children;
  for (const page of paginas) {
    await page.loadAsync();
    const vistas = vistasDePagina(page);
    if (!vistas.length) { resumen.push(`${page.name}: 0 vistas (omitida)`); continue; }
    const items = [];
    for (const node of vistas) {
      const data = await serialize(node, 0);
      let png = null;
      try { png = figma.base64Encode(await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: PNG_SCALE } })); } catch (e) {}
      items.push({ name: node.name, data, png });
    }
    descargar(slug(page.name) + ".json", { file: figma.root.name, page: page.name, coleccion: slug(page.name), items });
    resumen.push(`${page.name}: ${items.length} vistas`);
  }
  console.log("[export] listo\n" + resumen.join("\n"));
})();
