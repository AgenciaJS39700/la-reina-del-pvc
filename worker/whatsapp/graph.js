// worker/whatsapp/graph.js — Cliente mínimo de la WhatsApp Cloud API (Meta Graph).

/** @typedef {ReturnType<typeof import("./config.js").waConfig>} WaConfig */

const TIMEOUT_MS = 12_000;

/**
 * @param {WaConfig} cfg
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function graphFetch(cfg, path, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const url = path.startsWith("http") ? path : cfg.graph + path;
    return await fetch(url, {
      ...init,
      headers: { authorization: "Bearer " + cfg.token, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {WaConfig} cfg
 * @param {object} payload
 * @returns {Promise<{ ok: boolean, id?: string, error?: string, code?: number }>}
 */
async function postMessage(cfg, payload) {
  const body = JSON.stringify({ messaging_product: "whatsapp", ...payload });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await graphFetch(cfg, `/${cfg.phoneNumberId}/messages`, { method: "POST", body });
      const data = /** @type {any} */ (await res.json().catch(() => ({})));
      if (res.ok) return { ok: true, id: data?.messages?.[0]?.id };
      const code = data?.error?.code;
      // 429/5xx y el código 131016 (servicio no disponible) se reintentan una vez.
      if ((res.status === 429 || res.status >= 500 || code === 131016) && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      return { ok: false, code, error: String(data?.error?.message || res.status).slice(0, 300) };
    } catch (e) {
      if (attempt === 1) return { ok: false, error: String(e && e.message || e) };
    }
  }
  return { ok: false, error: "unreachable" };
}

/** Divide textos largos respetando párrafos (límite de WhatsApp: 4096). @param {string} text */
export function splitText(text, max = 3800) {
  const parts = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** @param {WaConfig} cfg @param {string} to @param {string} text */
export async function sendText(cfg, to, text) {
  let last = { ok: false, error: "empty" };
  for (const body of splitText(text)) {
    last = await postMessage(cfg, { recipient_type: "individual", to, type: "text", text: { body, preview_url: false } });
    if (!last.ok) break;
  }
  return last;
}

/**
 * Mensaje de plantilla aprobada (necesario para escribir fuera de la ventana de 24 h).
 * @param {WaConfig} cfg @param {string} to @param {string} name @param {string[]} params
 */
export function sendTemplate(cfg, to, name, params) {
  // Meta rechaza parámetros con saltos de línea, tabulaciones o más de 4 espacios seguidos.
  const clean = params.map((p) => String(p || "-").replace(/[\r\n\t]+/g, " · ").replace(/ {4,}/g, "   ").slice(0, 900) || "-");
  return postMessage(cfg, {
    recipient_type: "individual", to, type: "template",
    template: { name, language: { code: cfg.idioma }, components: [{ type: "body", parameters: clean.map((text) => ({ type: "text", text })) }] },
  });
}

/** Marca como leído y muestra «escribiendo…» (dura hasta enviar respuesta o ~25 s). @param {WaConfig} cfg @param {string} wamid */
export function markReadTyping(cfg, wamid) {
  return postMessage(cfg, { status: "read", message_id: wamid, typing_indicator: { type: "text" } });
}

/**
 * Descarga un archivo multimedia recibido.
 * @param {WaConfig} cfg @param {string} mediaId @param {number} maxBytes
 * @returns {Promise<{ bytes: Uint8Array, mime: string } | null>}
 */
export async function downloadMedia(cfg, mediaId, maxBytes) {
  const meta = await graphFetch(cfg, `/${mediaId}`);
  if (!meta.ok) return null;
  const info = /** @type {any} */ (await meta.json());
  if (!info?.url || (info.file_size && info.file_size > maxBytes)) return null;
  const file = await graphFetch(cfg, info.url);
  if (!file.ok) return null;
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf.byteLength > maxBytes) return null;
  return { bytes: buf, mime: String(info.mime_type || file.headers.get("content-type") || "").split(";")[0] };
}

/**
 * Verifica la firma X-Hub-Signature-256 del webhook (HMAC-SHA256 con el App Secret).
 * @param {string} appSecret @param {string} rawBody @param {string|null} header
 */
export async function verifySignature(appSecret, rawBody, header) {
  if (!header || !header.startsWith("sha256=") || !appSecret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7).toLowerCase();
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
