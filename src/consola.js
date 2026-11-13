// Export desde la consola de DevTools de Figma web, para quien no tiene la app de escritorio (Linux) o no puede
// importar plugins de desarrollo. Misma serializacion que plugin/code.js y mismo payload que espera server.js.
// SOLO LEE el documento. Se corre sobre una copia del archivo en Borradores (ver README, "Sin app de escritorio").
// Descarga un <pagina>.json por pagina; luego `node consola/cargar.js <archivos>` los manda al server.js local.
(async () => {
  // --- Opciones ---
  const SOLO_PAGINA_ACTUAL = false; // true: exporta solo la pagina abierta (re-exportar un modulo)
  const PNG_SCALE = null; // null = automatico: 2x (como el plugin) con SOLO_PAGINA_ACTUAL y 1x en el archivo completo, que a 2x pesa demasiado; o un numero fijo
  const MAX_DEPTH = 12; // igual que el plugin; mas profundo deja la marca _truncado
  const EXIGIR_COPIA = true; // false para correrlo en un archivo propio que no se llame "(Copy)"

  const slug = (s, fb = "sin-nombre") =>
    String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || fb;

  /* @incluir compartido/serializar.js */

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
  const escala = PNG_SCALE ?? (SOLO_PAGINA_ACTUAL ? 2 : 1);
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
      try { png = figma.base64Encode(await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: escala } })); } catch (e) {}
      items.push({ name: node.name, data, png });
    }
    descargar(slug(page.name) + ".json", { file: figma.root.name, page: page.name, coleccion: slug(page.name), items });
    resumen.push(`${page.name}: ${items.length} vistas`);
  }
  console.log("[export] listo\n" + resumen.join("\n"));
})();
