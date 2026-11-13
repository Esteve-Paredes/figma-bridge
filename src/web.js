// Modo web: lo inyecta el agente en Figma web y lo maneja llamando funciones. SOLO LEE el documento (no modifica nada del archivo).
// Inyeccion: (0, eval)(await (await fetch("http://127.0.0.1:3855/web.js")).text())  -> deja window.figmaBridge.
// Funciones: indice(), mapa(pagina), exportar({ pagina, vistas, escala, desde, cuantas }), recursos({ pagina, vista }), exportarRecursos({ pagina, nodos }).
// Cada vista y cada recurso viajan en su propia peticion a server.js.
(() => {
  const VERSION = "1";
  let MAX_DEPTH = 12;
  const config = { servidor: "http://127.0.0.1:3855", prefijoColeccion: "" };

  /* @incluir compartido/serializar.js */

  const sinAcentos = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
  const slug = (s, fb = "sin-nombre") => sinAcentos(s).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || fb;
  // Nombre sin los emojis de estado de Figma ("🟡 Modulo tramites" -> "Modulo tramites"), para buscar y para el nombre de la coleccion.
  const limpio = (s) => String(s).replace(/[^\p{L}\p{N}\s·._-]/gu, " ").replace(/\s+/g, " ").trim();

  function configurar(opciones = {}) {
    if (opciones.servidor) config.servidor = String(opciones.servidor).replace(/\/$/, "");
    // "" = sin prefijo; "auto" = nombre del archivo (para que dos archivos con una pagina del mismo nombre no se pisen en exports/); o un texto propio.
    if (typeof opciones.prefijoColeccion === "string") config.prefijoColeccion = opciones.prefijoColeccion;
    if (Number.isInteger(opciones.maxDepth) && opciones.maxDepth > 0) MAX_DEPTH = opciones.maxDepth;
    return { servidor: config.servidor, prefijoColeccion: config.prefijoColeccion, maxDepth: MAX_DEPTH, version: VERSION };
  }

  // `figma` aparece unos segundos despues de abrir el archivo (no esta al cargar la pagina): se espera en vez de fallar.
  async function esperarFigma(ms = 30000) {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
      if (typeof figma !== "undefined" && figma.root) return { listo: true, archivo: figma.root.name };
      await new Promise((r) => setTimeout(r, 500));
    }
    return {
      listo: false,
      motivo: "figma no esta disponible. Causas probables: (1) no hay permiso de edicion en este archivo (solo vista); (2) el archivo no termino de cargar; (3) falta iniciar sesion. Si todo eso esta bien, correr un plugin de Community una vez.",
    };
  }

  function exigirListo() {
    if (typeof figma === "undefined" || !figma.root) throw new Error("figma no esta disponible todavia: llamar antes a esperarFigma()");
    // Solo archivos de diseno: FigJam, presentaciones y similares tienen otra estructura y no sirven para maquetar pantallas.
    if (figma.editorType !== "figma") throw new Error(`"${figma.root.name}" no es un archivo de diseno (es de tipo "${figma.editorType}"): no se lee.`);
  }

  // Nombre de coleccion: prefijo opcional + pagina sin emojis ("modulo-tramites", o "<archivo>-modulo-tramites" con prefijoColeccion "auto").
  function nombreColeccion(pagina) {
    const prefijo = config.prefijoColeccion === "auto" ? slug(figma.root.name) : slug(config.prefijoColeccion, "");
    const base = slug(limpio(pagina.name));
    return prefijo ? `${prefijo}-${base}` : base;
  }

  const estadoDe = (nombre) => (nombre.includes("🟢") ? "finalizado" : nombre.includes("🟡") ? "en_proceso" : "sin_estado");
  // Separadores del archivo: "---" o titulos como "🟢 Finalizado =================".
  const esSeparador = (nombre) => /^[\s-=]+$/.test(nombre) || /={3,}\s*$/.test(nombre);

  function indice() {
    exigirListo();
    return {
      archivo: figma.root.name,
      paginaActual: figma.currentPage.name,
      paginas: figma.root.children.map((p) => ({
        id: p.id,
        nombre: p.name,
        coleccion: nombreColeccion(p),
        estado: estadoDe(p.name),
        separador: esSeparador(p.name),
      })),
    };
  }

  function buscarPagina(ref) {
    const paginas = figma.root.children;
    const porId = paginas.find((p) => p.id === ref);
    if (porId) return porId;
    const buscado = slug(limpio(ref));
    const exactas = paginas.filter((p) => slug(limpio(p.name)) === buscado);
    if (exactas.length === 1) return exactas[0];
    const parciales = paginas.filter((p) => slug(limpio(p.name)).includes(buscado));
    if (parciales.length === 1) return parciales[0];
    const candidatas = (exactas.length ? exactas : parciales).map((p) => `${p.id} ${p.name}`);
    throw new Error(candidatas.length ? `Pagina ambigua "${ref}": ${candidatas.join(" | ")}` : `No hay ninguna pagina que coincida con "${ref}".`);
  }

  // Vistas = frames de primer nivel de la pagina y frames dentro de secciones de primer nivel (igual que el plugin y la consola).
  function vistasDePagina(page) {
    const out = [];
    for (const n of page.children) {
      if (n.type === "SECTION") for (const c of n.children) { if (c.type === "FRAME" || c.type === "COMPONENT") out.push({ node: c, seccion: n.name, seccionNode: n }); }
      else if (n.type === "FRAME" || n.type === "COMPONENT") out.push({ node: n, seccion: null, seccionNode: null });
    }
    return out;
  }

  // Orden de lectura: secciones de arriba abajo y de izquierda a derecha; dentro de cada una, por filas (tolerancia = media altura) y luego por x.
  function ordenDeLectura(vistas) {
    const porSeccion = new Map();
    for (const v of vistas) {
      const k = v.seccionNode ? v.seccionNode.id : "(sin seccion)";
      if (!porSeccion.has(k)) porSeccion.set(k, []);
      porSeccion.get(k).push(v);
    }
    // Secciones numeradas ("00 · Acceso") primero y por numero; las demas por posicion; las vistas sueltas (sin seccion) al final.
    const numero = (s) => { const m = s.name.match(/^\s*(\d+)/); return m ? Number(m[1]) : null; };
    const grupos = [...porSeccion.values()].sort((a, b) => {
      const sa = a[0].seccionNode, sb = b[0].seccionNode;
      if (!sa || !sb) return sa ? -1 : sb ? 1 : 0;
      const na = numero(sa), nb = numero(sb);
      if (na !== null && nb !== null) return na - nb;
      if (na !== null) return -1;
      if (nb !== null) return 1;
      return sa.y - sb.y || sa.x - sb.x;
    });
    const orden = [];
    for (const g of grupos) {
      const tol = (g.reduce((s, v) => s + v.node.height, 0) / g.length) / 2;
      const filas = [];
      for (const v of [...g].sort((a, b) => a.node.y - b.node.y)) {
        const fila = filas.find((f) => Math.abs(f.y - v.node.y) <= tol);
        if (fila) fila.items.push(v); else filas.push({ y: v.node.y, items: [v] });
      }
      for (const f of filas) orden.push(...f.items.sort((a, b) => a.node.x - b.node.x));
    }
    return orden;
  }

  async function mapa(ref) {
    exigirListo();
    const page = buscarPagina(ref);
    await page.loadAsync();
    const vistas = ordenDeLectura(vistasDePagina(page));
    const secciones = page.children.filter((n) => n.type === "SECTION").sort((a, b) => a.y - b.y || a.x - b.x);
    let conReacciones = 0;
    const filas = vistas.map((v, i) => {
      let reacciones = 0;
      try { reacciones = (v.node.reactions || []).length; } catch (e) {}
      if (reacciones) conReacciones++;
      return { orden: i + 1, id: v.node.id, nombre: v.node.name, seccion: v.seccion, x: Math.round(v.node.x), y: Math.round(v.node.y), ancho: Math.round(v.node.width), alto: Math.round(v.node.height), reacciones };
    });
    // Que hay realmente en el primer nivel de la pagina: si no sale ninguna vista, esto dice por que.
    const tiposPrimerNivel = {};
    for (const n of page.children) tiposPrimerNivel[n.type] = (tiposPrimerNivel[n.type] || 0) + 1;
    const avisos = [];
    if (!filas.length) {
      avisos.push(`La pagina "${page.name}" no tiene frames de primer nivel ni frames dentro de secciones. Primer nivel: ${JSON.stringify(tiposPrimerNivel)}. Si hay grupos, secciones anidadas o conjuntos de componentes, las pantallas no se detectan (ver README).`);
    } else if (filas.length < page.children.length / 2) {
      avisos.push(`Solo ${filas.length} de ${page.children.length} elementos de primer nivel son vistas (${JSON.stringify(tiposPrimerNivel)}): puede que otras pantallas esten dentro de grupos o secciones anidadas.`);
    }
    return {
      archivo: figma.root.name,
      avisos,
      tiposPrimerNivel,
      pagina: { id: page.id, nombre: page.name, coleccion: nombreColeccion(page), estado: estadoDe(page.name) },
      totalVistas: filas.length,
      secciones: secciones.map((s) => ({ id: s.id, nombre: s.name, vistas: s.children.filter((c) => c.type === "FRAME" || c.type === "COMPONENT").length })),
      prototipo: { puntosDeInicio: (page.flowStartingPoints || []).map((p) => ({ id: p.nodeId, nombre: p.name })), vistasConConexiones: conReacciones },
      vistas: filas,
    };
  }

  async function enviar(carga) {
    const res = await fetch(`${config.servidor}/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: carga });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    return res.json();
  }

  // vistas: "todas" o una lista de ids / nombres. desde + cuantas: para exportar en tandas y no pasarse del tiempo de una llamada.
  async function exportar({ pagina, vistas = "todas", escala = 1, coleccion, desde = 0, cuantas = 6 } = {}) {
    exigirListo();
    const page = buscarPagina(pagina);
    await page.loadAsync();
    const todas = ordenDeLectura(vistasDePagina(page));
    const elegidas = vistas === "todas" ? todas : todas.filter((v) => vistas.includes(v.node.id) || vistas.includes(v.node.name));
    if (vistas !== "todas" && !elegidas.length) throw new Error(`Ninguna de las vistas pedidas existe en "${page.name}".`);
    const col = coleccion || nombreColeccion(page);
    const tanda = elegidas.slice(desde, desde + cuantas);
    const inicio = performance.now();
    const enviadas = [];
    const fallidas = [];
    let kb = 0;
    for (const { node } of tanda) {
      try {
        const data = await serialize(node, 0);
        let png = null;
        try { png = figma.base64Encode(await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: escala } })); } catch (e) {}
        // figma.mixed es un Symbol: no se puede serializar y se reemplaza por "mixed".
        const carga = JSON.stringify({ file: figma.root.name, page: page.name, coleccion: col, items: [{ name: node.name, data, png }] }, (k, v) => (typeof v === "symbol" ? "mixed" : v));
        kb += Math.round(carga.length / 1024);
        await enviar(carga);
        enviadas.push(node.name);
      } catch (e) {
        fallidas.push({ nombre: node.name, error: String(e && e.message ? e.message : e) });
      }
    }
    const siguiente = desde + tanda.length;
    return { archivo: figma.root.name, coleccion: col, total: elegidas.length, enviadas, fallidas, desde, siguiente: siguiente < elegidas.length ? siguiente : null, escala, kb, ms: Math.round(performance.now() - inicio) };
  }

  // ---- Recursos sueltos: logos, iconos e ilustraciones de una vista ----
  const TIPOS_VECTOR = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE"]);
  const TIPOS_GRAFICO = new Set([...TIPOS_VECTOR, "RECTANGLE", "ELLIPSE"]);
  const TIPOS_CONTENEDOR = new Set(["FRAME", "GROUP", "INSTANCE", "COMPONENT", "SECTION"]);
  const MAX_CANDIDATOS = 300;

  const conImagen = (n) => Array.isArray(n.fills) && n.fills.some((f) => f.type === "IMAGE" && f.visible !== false);

  // Resume un nodo: sin texto (todo es dibujo), con algun vector o imagen (no es solo un rectangulo de color) y si tiene imagen de relleno.
  function resumenGrafico(n) {
    if (n.visible === false) return { grafico: false };
    if (n.type === "TEXT") return { grafico: false };
    let vector = TIPOS_VECTOR.has(n.type);
    let imagen = conImagen(n);
    if (n.children) {
      if (!TIPOS_CONTENEDOR.has(n.type) && !TIPOS_VECTOR.has(n.type)) return { grafico: false };
      for (const c of n.children) {
        const r = resumenGrafico(c);
        if (c.visible === false) continue;
        if (!r.grafico) return { grafico: false };
        vector = vector || r.vector;
        imagen = imagen || r.imagen;
      }
    } else if (!TIPOS_GRAFICO.has(n.type)) return { grafico: false };
    return { grafico: vector || imagen, vector, imagen };
  }

  // Candidatos a recurso dentro de una vista: el nodo mas alto que es solo dibujo (sin texto) con vectores o imagenes. No baja dentro de un candidato.
  // Devuelve id, nombre sugerido unico, tamano y formato sugerido (png si hay imagen de relleno, svg si es vectorial).
  async function recursos({ pagina, vista } = {}) {
    exigirListo();
    const page = buscarPagina(pagina);
    await page.loadAsync();
    const todas = vistasDePagina(page);
    const v = todas.find((x) => x.node.id === vista || x.node.name === vista);
    if (!v) throw new Error(`No hay ninguna vista "${vista}" en "${page.name}".`);
    const candidatos = [];
    const usados = new Set();
    const nombreUnico = (n) => {
      const base = slug(n.name, "recurso");
      let nombre = base;
      for (let i = 2; usados.has(nombre); i++) nombre = `${base}-${i}`;
      usados.add(nombre);
      return nombre;
    };
    const recorrer = (n, ruta) => {
      if (candidatos.length >= MAX_CANDIDATOS || n.visible === false) return;
      const r = n.type === "TEXT" ? { grafico: false } : resumenGrafico(n);
      if (r.grafico && n.width > 0 && n.height > 0) {
        candidatos.push({ id: n.id, nombre: nombreUnico(n), nombreFigma: n.name, tipo: n.type, ancho: Math.round(n.width), alto: Math.round(n.height), formato: r.imagen ? "png" : "svg", ruta: ruta.join(" / ") });
        return;
      }
      if (n.children) for (const c of n.children) recorrer(c, [...ruta, n.name]);
    };
    for (const c of v.node.children || []) recorrer(c, [v.node.name]);
    return { archivo: figma.root.name, vista: v.node.name, total: candidatos.length, truncado: candidatos.length >= MAX_CANDIDATOS, candidatos };
  }

  async function enviarRecursos(carga) {
    const res = await fetch(`${config.servidor}/recursos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: carga });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    return res.json();
  }

  // nodos: [{ id, nombre, formato: "svg" | "png", escala }]  (los de recursos().candidatos sirven tal cual). Se guardan en exports/<coleccion>/recursos/.
  // svg se exporta como texto; png a `escala` (2 por defecto). desde + cuantas: tandas, como exportar().
  async function exportarRecursos({ pagina, nodos, coleccion, desde = 0, cuantas = 8 } = {}) {
    exigirListo();
    if (!Array.isArray(nodos) || !nodos.length) throw new Error("exportarRecursos necesita nodos: [{ id, nombre, formato }]");
    const page = buscarPagina(pagina);
    await page.loadAsync();
    const col = coleccion || nombreColeccion(page);
    const tanda = nodos.slice(desde, desde + cuantas);
    const inicio = performance.now();
    const guardados = [];
    const fallidos = [];
    let kb = 0;
    for (const item of tanda) {
      try {
        const formato = String(item.formato || "svg").toLowerCase();
        if (formato !== "svg" && formato !== "png") throw new Error(`formato no permitido: ${item.formato}`);
        const node = await figma.getNodeByIdAsync(item.id);
        if (!node) throw new Error("no existe un nodo con ese id");
        const escala = item.escala || 2;
        let archivo;
        if (formato === "svg") {
          archivo = { encoding: "utf8", data: await node.exportAsync({ format: "SVG_STRING", svgIdAttribute: false }) };
        } else {
          archivo = { encoding: "base64", data: figma.base64Encode(await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: escala } })) };
        }
        const carga = JSON.stringify({ coleccion: col, archivos: [{ ...archivo, nombre: item.nombre || node.name, formato, nodeId: node.id, nombreFigma: node.name, escala: formato === "png" ? escala : null, ancho: Math.round(node.width), alto: Math.round(node.height) }] });
        kb += Math.round(carga.length / 1024);
        const r = await enviarRecursos(carga);
        guardados.push(...r.guardados);
      } catch (e) {
        fallidos.push({ id: item.id, nombre: item.nombre, error: String(e && e.message ? e.message : e) });
      }
    }
    const siguiente = desde + tanda.length;
    return { archivo: figma.root.name, coleccion: col, total: nodos.length, guardados, fallidos, desde, siguiente: siguiente < nodos.length ? siguiente : null, kb, ms: Math.round(performance.now() - inicio) };
  }

  window.figmaBridge = { version: VERSION, configurar, esperarFigma, indice, mapa, exportar, recursos, exportarRecursos };
  return window.figmaBridge.version;
})();
