// Genera una version compacta (para que la lea un modelo de IA) a partir de design.json. NUNCA modifica el original.
// Uso manual: node compact.js exports/<nombre>/design.json   -> escribe design.compact.json al lado.
// Cada recorte deja marca (_omitido / _nota) para que se vea que se quito.
const fs = require("fs");
const path = require("path");

const r1 = (n) => (typeof n === "number" ? Math.round(n * 10) / 10 : n);
const VECTORISH = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "POLYGON"]);

const color = (paints) => {
  if (!paints || !paints.length) return undefined;
  const out = paints.map((p) => {
    if (p.type === "SOLID") return p.opacity < 1 ? `${p.color}@${r1(p.opacity)}` : p.color;
    if (p.type.startsWith("GRADIENT")) return `${p.type.toLowerCase()}(${p.stops.map((s) => `${s.color}@${r1(s.position)}`).join(",")})`;
    return p.type.toLowerCase();
  });
  return out.length === 1 ? out[0] : out;
};

function iconName(n) {
  const c = n.component || "";
  const m = /^Icon=(.+)$/.exec(c) || /^Icon=(.+)$/.exec(n.name || "");
  return m ? m[1] : null;
}

function firstColor(n) {
  let found;
  (function w(x) {
    if (found) return;
    found = color(x.strokes) || color(x.fills);
    (x.children || []).forEach(w);
  })(n);
  return found;
}

function layoutStr(a) {
  const parts = [a.direction === "HORIZONTAL" ? "row" : "col"];
  if (a.gap) parts.push(`gap=${r1(a.gap)}`);
  const p = a.padding || [0, 0, 0, 0];
  if (p.some((v) => v)) parts.push(`pad=${p.map(r1).join(",")}`);
  if (a.mainAxisAlign && a.mainAxisAlign !== "MIN") parts.push(`main=${a.mainAxisAlign}`);
  if (a.crossAxisAlign && a.crossAxisAlign !== "MIN") parts.push(`cross=${a.crossAxisAlign}`);
  if (a.wrap && a.wrap !== "NO_WRAP") parts.push("wrap");
  return parts.join(" ");
}

function textStr(t) {
  const lh = t.lineHeight && t.lineHeight.unit === "PIXELS" ? `/${r1(t.lineHeight.value)}` : t.lineHeight && t.lineHeight.unit === "PERCENT" ? `/${r1(t.lineHeight.value)}%` : "";
  const f = t.fontName || {};
  const out = { chars: t.characters, font: `${f.family || "?"} ${t.fontWeight || f.style || ""} ${t.fontSize}${lh}`.trim() };
  if (t.letterSpacing && t.letterSpacing.value) out.ls = r1(t.letterSpacing.value) + (t.letterSpacing.unit === "PERCENT" ? "%" : "px");
  if (t.textAlignHorizontal && t.textAlignHorizontal !== "LEFT") out.align = t.textAlignHorizontal;
  if (t.textCase && t.textCase !== "ORIGINAL") out.case = t.textCase;
  if (t.textDecoration && t.textDecoration !== "NONE") out.deco = t.textDecoration;
  if (t.segments) out.segments = t.segments.map((s) => ({ text: s.text, font: `${(s.fontName || {}).family || ""} ${s.fontWeight || ""} ${s.fontSize || ""}`.trim(), color: color(s.fills), deco: s.textDecoration !== "NONE" ? s.textDecoration : undefined }));
  return out;
}

function compactNode(n, parent, stats) {
  const o = {};
  const named = n.name && !(n.text && n.text.characters === n.name) && !/^(Frame|Group|Rectangle|Ellipse|Vector)( \d+)?$/.test(n.name);
  if (named) o.name = n.name;
  o.type = n.type;

  const ic = iconName(n);
  if (ic) {
    stats.icons++;
    return { icon: ic, size: [r1(n.width), r1(n.height)], color: firstColor(n), ...(n.name ? { name: n.name } : {}) };
  }
  if (n.component) {
    o.component = n.component;
    if (n.variant) o.variant = n.variant;
  }

  o.size = [r1(n.width), r1(n.height)];
  // posicion solo si el padre no ordena a sus hijos con auto-layout (ahi x/y no aporta)
  if (parent && !parent.autoLayout && n.x !== undefined) o.pos = [r1(n.x), r1(n.y)];

  const sz = [];
  if (n.sizing) {
    if (n.sizing.h && n.sizing.h !== "FIXED") sz.push(`w=${n.sizing.h.toLowerCase()}`);
    if (n.sizing.v && n.sizing.v !== "FIXED") sz.push(`h=${n.sizing.v.toLowerCase()}`);
  }
  if (n.layoutGrow) sz.push("grow");
  if (sz.length) o.sizing = sz.join(" ");

  if (n.autoLayout) o.layout = layoutStr(n.autoLayout);
  if (n.opacity !== undefined && n.opacity !== 1) o.opacity = r1(n.opacity);
  const fill = color(n.fills);
  if (fill) o.fill = fill;
  const stroke = color(n.strokes);
  if (stroke) {
    const w = n.strokeWeights
      ? `top/right/bottom/left=${n.strokeWeights.map(r1).join("/")}px`
      : n.strokeWeight === "mixed"
        ? "grosor distinto por lado (ver design.json, re-exportar)"
        : `${r1(n.strokeWeight)}px`;
    o.stroke = `${stroke} ${w} ${String(n.strokeAlign || "").toLowerCase()}`.trim();
  }
  if (n.cornerRadius) o.radius = Array.isArray(n.cornerRadius) ? n.cornerRadius.map(r1) : r1(n.cornerRadius);
  if (n.effects && n.effects.length)
    o.effects = n.effects.map((e) => `${e.type} ${e.color || ""}@${r1(e.alpha ?? 1)} x=${r1((e.offset || {}).x || 0)} y=${r1((e.offset || {}).y || 0)} blur=${r1(e.radius)}${e.spread ? ` spread=${r1(e.spread)}` : ""}`);
  if (n.clipsContent) o.clip = true;
  if (n.text) o.text = textStr(n.text);

  if (n.children && n.children.length) {
    const kids = [];
    let omitted = 0;
    for (const c of n.children) {
      if (c.visible === false) {
        omitted++;
        stats.hidden++;
        continue;
      }
      kids.push(compactNode(c, n, stats));
    }
    if (kids.length) o.children = kids;
    if (omitted) o._omitido = `${omitted} elemento(s) ocultos`;
  }
  // Marca puesta al exportar cuando el arbol paso MAX_DEPTH: sin esto el modelo no sabria que hay hijos sin exportar.
  if (n._truncado) o._truncado = n._truncado;
  if (VECTORISH.has(n.type)) stats.vectors++;
  return o;
}

function compact(design) {
  const stats = { icons: 0, hidden: 0, vectors: 0 };
  const tree = compactNode(design.node, null, stats);
  return {
    _nota:
      "Version compacta de design.json (el original esta al lado, completo). x/y solo en hijos de contenedores SIN auto-layout; sizing: fill=ocupa el ancho/alto disponible, hug=se ajusta al contenido. Colores en hex (@N = opacidad). Iconos reducidos a su nombre (lucide).",
    file: design.file,
    page: design.page,
    stats,
    node: tree,
  };
}

function writeCompact(designPath) {
  const design = JSON.parse(fs.readFileSync(designPath, "utf8"));
  const out = compact(design);
  const outPath = path.join(path.dirname(designPath), "design.compact.json");
  fs.writeFileSync(outPath, JSON.stringify(out));
  return { outPath, before: fs.statSync(designPath).size, after: fs.statSync(outPath).size, stats: out.stats };
}

module.exports = { compact, writeCompact };

if (require.main === module) {
  const res = writeCompact(path.resolve(process.argv[2]));
  console.log(res);
}
