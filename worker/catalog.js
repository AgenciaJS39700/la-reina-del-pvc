// worker/catalog.js — Lee el catálogo real de la web (data.js) y lo convierte en
// conocimiento para el agente. Una sola fuente de verdad: si cambia un precio en
// data.js, el asistente lo sabe en el siguiente despliegue (caché de 5 min).

/**
 * @typedef {{ id: string, name: string, price?: number, len?: number, stock?: string|number }} Variant
 * @typedef {{ kind: "tile"|"sheet"|"roll"|"plank", w: number, h?: number, len?: number, floor?: boolean }} Sim
 * @typedef {{ id: string, cat: string, name: string, spec: string, price: number|null, unit?: string,
 *             desc: string, tags?: string[], sim?: Sim, variants?: Variant[], variants_prices?: [string, number][] }} Item
 * @typedef {{ wa: { detal: string, mayor: string, spc: string }, cats: {id: string, name: string}[], items: Item[] }} Catalog
 * @typedef {{ at: number, pvc: Catalog, text: string }} CatalogCache
 */

const TTL_MS = 5 * 60 * 1000;
/** @type {CatalogCache | null} */
let cache = null;

/** @param {number} n */
const m = (n) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 });

/** @param {number} n */
export const cop = (n) => "$" + Math.round(n).toLocaleString("es-CO") + " COP";

/**
 * @param {{ ASSETS: Fetcher }} env
 * @param {string} origin
 * @returns {Promise<CatalogCache>}
 */
export async function loadCatalog(env, origin) {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const res = await env.ASSETS.fetch(new Request(origin + "/data.js"));
  if (!res.ok) throw new Error("catalog_unavailable_" + res.status);
  const src = await res.text();
  const start = src.indexOf("{", src.indexOf("window.PVC"));
  const end = src.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("catalog_parse_error");
  /** @type {Catalog} */
  const pvc = JSON.parse(src.slice(start, end + 1));
  cache = { at: Date.now(), pvc, text: toPromptText(pvc) };
  return cache;
}

/** @param {Variant} v */
function variantLabel(v) {
  const extra = [];
  if (v.stock === "agotado") extra.push("AGOTADO");
  else if (typeof v.stock === "number") extra.push("quedan " + v.stock);
  if (v.price) extra.push(cop(v.price));
  return v.name + (extra.length ? " (" + extra.join(", ") + ")" : "");
}

/** @param {Catalog} pvc */
function toPromptText(pvc) {
  const catName = Object.fromEntries(pvc.cats.map((c) => [c.id, c.name]));
  const lines = pvc.items.map((it) => {
    const price = it.price == null
      ? "precio: consultar con asesor"
      : "precio: " + (it.unit === "desde" ? "desde " : "") + cop(it.price) + (it.unit && it.unit !== "desde" ? " por " + it.unit : "");
    const parts = [
      `- [${it.id}] ${it.name} · ${catName[it.cat] || it.cat} · ${it.spec} · ${price}`,
      `  ${it.desc}`,
    ];
    if (it.variants_prices?.length) parts.push("  Presentaciones: " + it.variants_prices.map(([n, p]) => `${n} ${cop(p)}`).join("; "));
    if (it.tags?.length) parts.push("  Etiquetas: " + it.tags.join(", "));
    if (it.variants?.length) parts.push(`  Modelos (${it.variants.length}): ` + it.variants.map(variantLabel).join(" | "));
    parts.push("  Calculable por medidas: " + (it.sim ? (it.sim.floor ? "sí (piso: largo × ancho)" : "sí (pared: ancho × alto)") : "no"));
    return parts.join("\n");
  });
  return lines.join("\n");
}

/**
 * Misma lógica que el simulador de la web (app.js → calc), para una superficie rectangular.
 * @param {Catalog} pvc
 * @param {{ producto_id: string, ancho_m: number, alto_m: number, modelo?: string }} input
 */
export function calcularCantidad(pvc, input) {
  const it = pvc.items.find((i) => i.id === input.producto_id);
  if (!it) return { error: "Producto no encontrado. Usa uno de los ids del catálogo." };
  if (!it.sim) return { error: `«${it.name}» no se calcula por medidas; el asesor indica la cantidad.` };
  const W = Number(input.ancho_m), H = Number(input.alto_m);
  if (!Number.isFinite(W) || !Number.isFinite(H) || W < 0.1 || H < 0.1 || W > 50 || H > 50) {
    return { error: "Medidas no válidas. Deben estar en metros, entre 0,1 y 50." };
  }
  const q = (input.modelo || "").toLowerCase().trim();
  const v = q ? (it.variants || []).find((x) => x.id.toLowerCase() === q || x.name.toLowerCase().includes(q)) : undefined;
  const s = it.sim, cw = W * 100, ch = H * 100;
  let qty = 0, unit = "", nota = "";
  if (s.kind === "tile") {
    const a = Math.ceil(cw / s.w) * Math.ceil(ch / (s.h ?? s.w)), b = Math.ceil(cw / (s.h ?? s.w)) * Math.ceil(ch / s.w);
    qty = Math.ceil(Math.min(a, b) * 1.1); unit = "unidades"; nota = "Incluye 10 % extra por cortes.";
  } else if (s.kind === "sheet") {
    const a = Math.ceil(cw / s.w) * Math.ceil(ch / (s.h ?? s.w)), b = Math.ceil(cw / (s.h ?? s.w)) * Math.ceil(ch / s.w);
    qty = Math.min(a, b); unit = "láminas"; nota = `Láminas de ${m(s.w / 100)} × ${m((s.h ?? 0) / 100)} m.`;
  } else if (s.kind === "roll") {
    const len = v?.len || s.len || 300, strips = Math.ceil(cw / s.w), per = Math.floor(len / ch);
    qty = per >= 1 ? Math.ceil(strips / per) : strips * Math.ceil(ch / len); unit = "rollos"; nota = `Tiras de ${m(s.w / 100)} m de ancho.`;
  } else {
    qty = Math.ceil(cw / s.w) * Math.ceil(ch / (s.len || 290)); unit = "láminas"; nota = `Tablas de ${s.w} cm × ${m((s.len || 290) / 100)} m.`;
  }
  const precio = v?.price || it.price || 0;
  return {
    producto: it.name,
    modelo: v ? v.name : null,
    modelo_agotado: v?.stock === "agotado" || undefined,
    cantidad: qty,
    unidad: unit,
    area_m2: Math.round(W * H * 100) / 100,
    precio_unitario: precio ? cop(precio) : "consultar",
    total_aprox: precio ? cop(qty * precio) : "consultar",
    nota: nota + " Cantidad aproximada; no incluye pegante ni accesorios. El asesor la confirma.",
  };
}

/**
 * @param {Catalog} pvc
 * @param {{ tipo: "detal"|"mayor"|"spc", resumen: string }} input
 */
export function enlaceAsesor(pvc, input) {
  const tipo = ["detal", "mayor", "spc"].includes(input.tipo) ? input.tipo : "detal";
  const base = pvc.wa[tipo];
  const resumen = String(input.resumen || "").slice(0, 600);
  // Los enlaces wa.me/message/ (asesor SPC) no aceptan texto prellenado.
  const url = base.includes("/message/") || !resumen ? base : base + "?text=" + encodeURIComponent(resumen);
  const label = { detal: "Hablar con un asesor", mayor: "Asesor mayorista", spc: "Asesor de piso SPC" }[tipo];
  return { url, label };
}
