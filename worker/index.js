// worker/index.js — Worker de La Reina del PVC.
// Sirve la web estática y expone el asistente IA en /api/chat.
// Secreto requerido:  ANTHROPIC_API_KEY  (Cloudflare → Worker → Settings → Variables and Secrets)
// Opcionales:         ANTHROPIC_MODEL (por defecto claude-haiku-5-5), ANTHROPIC_BASE_URL (p. ej. AI Gateway)

import { loadCatalog } from "./catalog.js";
import { runAgent } from "./agent.js";

const MAX_BODY_BYTES = 20_000;
const MAX_MESSAGES = 12;
const MAX_CHARS = 1_200;
const WA_FALLBACK = { url: "https://wa.me/573218911231?text=" + encodeURIComponent("Hola, quiero cotizar productos de La Reina del PVC"), label: "Escribir por WhatsApp" };

/**
 * @typedef {{ ASSETS: Fetcher, ANTHROPIC_API_KEY?: string, ANTHROPIC_MODEL?: string, ANTHROPIC_BASE_URL?: string,
 *             CHAT_RL?: { limit(o: { key: string }): Promise<{ success: boolean }> } }} Env
 */

/** @param {unknown} data @param {number} [status] */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * Valida y normaliza el historial que manda el navegador. Solo texto plano:
 * el cliente nunca puede inyectar bloques tool_use / tool_result.
 * @param {unknown} raw
 */
function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return null;
  /** @type {{ role: "user"|"assistant", content: string }[]} */
  const out = [];
  for (const m of raw.slice(-MAX_MESSAGES * 2)) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return null;
    const content = m.content.replace(/\u0000/g, "").trim().slice(0, MAX_CHARS);
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n" + content;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  const trimmed = out.slice(-MAX_MESSAGES);
  while (trimmed.length && trimmed[0].role !== "user") trimmed.shift();
  if (!trimmed.length || trimmed[trimmed.length - 1].role !== "user") return null;
  return trimmed;
}

/** @param {Request} request @param {Env} env @param {URL} url */
async function handleChat(request, env, url) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== url.host) return json({ error: "forbidden" }, 403);
  if (!(request.headers.get("content-type") || "").includes("application/json")) return json({ error: "bad_content_type" }, 415);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "not_configured", actions: [WA_FALLBACK] }, 503);

  const ip = request.headers.get("cf-connecting-ip") || "anon";
  if (env.CHAT_RL) {
    const { success } = await env.CHAT_RL.limit({ key: "chat:" + ip });
    if (!success) return json({ error: "rate_limited", reply: "Vas muy rápido 🙂 Espera un minuto o escríbenos por WhatsApp.", actions: [WA_FALLBACK] }, 429);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400); }
  const history = sanitizeHistory(body && body.messages);
  if (!history) return json({ error: "bad_messages" }, 400);

  const t0 = Date.now();
  try {
    const catalog = await loadCatalog(env, url.origin);
    const out = await runAgent(/** @type {any} */ (env), catalog, history);
    // Log sin contenido de la conversación (privacidad): solo métricas.
    console.log(JSON.stringify({ evt: "chat_ok", ms: Date.now() - t0, turns: history.length, actions: out.actions.length, ...out.usage }));
    return json({ reply: out.reply, actions: out.actions });
  } catch (e) {
    console.error(JSON.stringify({ evt: "chat_error", ms: Date.now() - t0, err: String(e && e.message || e).slice(0, 300) }));
    return json({ error: "upstream_error", reply: "Ahora mismo no puedo responder. Escríbenos por WhatsApp y un asesor te atiende.", actions: [WA_FALLBACK] }, 502);
  }
}

export default {
  /** @param {Request} request @param {Env} env */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/chat/health") return json({ enabled: Boolean(env.ANTHROPIC_API_KEY) });
    if (url.pathname === "/api/chat") return handleChat(request, env, url);
    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
    return env.ASSETS.fetch(request);
  },
};
