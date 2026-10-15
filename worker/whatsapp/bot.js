// worker/whatsapp/bot.js — Bot de WhatsApp de La Reina del PVC.
//
//  Cliente ──► Meta ──webhook──► handleWebhook()  (responde 200 al instante)
//                                   └─ waitUntil: processPayload()
//                                        ├─ mensajes del cliente → guardar → agrupar ráfagas → Claude → responder
//                                        │      └─ escalar_a_asesor → aviso al asesor (plantilla de WhatsApp)
//                                        ├─ mensajes del equipo → comandos (pausa / activa / resumen)
//                                        └─ ecos de la app WhatsApp Business → pausa el bot en ese chat

import { loadCatalog, calcularCantidad } from "../catalog.js";
import { runAgent, TOOL_CALCULAR } from "../agent.js";
import { waConfig, digits, bogota, abiertoAhora } from "./config.js";
import { sendText, sendTemplate, markReadTyping, downloadMedia, verifySignature } from "./graph.js";
import * as db from "./store.js";

/** @typedef {ReturnType<typeof waConfig>} WaConfig */
/** @typedef {import("./config.js").WaVars & import("../agent.js").AgentEnv & { DB: any, AI?: any, ASSETS: Fetcher }} WaEnv */

const DEBOUNCE_MS = 3500;          // espera para agrupar mensajes seguidos del cliente
const HISTORY_LIMIT = 30;
const HISTORY_DAYS = 14;
const SPAM_PER_HOUR = 40;          // por encima, el bot deja de responder a ese número durante la hora
const ESCALATION_COOLDOWN_MS = 6 * 3600_000;
const MAX_IMAGE_BYTES = 3_500_000;
const MAX_AUDIO_BYTES = 5_000_000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const MOTIVOS = {
  pedido_listo: "🔥 Pedido listo para cerrar",
  mayorista: "📦 Cliente mayorista",
  queja_garantia: "⚠️ Queja o garantía",
  descuento: "💬 Pide descuento",
  visita_instalacion: "🛠️ Visita o pedido especial",
  pide_persona: "🙋 Quiere hablar con una persona",
  otro: "📌 Requiere atención",
  error_bot: "🤖 El asistente no pudo responder",
};
const ASESOR_LABEL = { detal: "ventas", mayor: "ventas al por mayor", spc: "piso SPC" };

const WA_RULES = `Canal: WhatsApp oficial de la tienda. Atiendes tú solo; los asesores humanos solo entran cuando de verdad hace falta.

Formato: mensajes cortos de WhatsApp. Puedes resaltar precios o totales con *asteriscos* (negrita de WhatsApp). Sin títulos, sin tablas, sin enlaces inventados. Usa guiones si listas opciones.

Lo resuelves TÚ, sin avisar a nadie: precios, modelos, catálogo, cálculo de cantidades, cotizaciones con total, cómo se instala, qué pegante usar, dirección, saludos y preguntas sueltas. Una cotización NO es motivo para avisar a un asesor.

Usa escalar_a_asesor SOLO en estos casos:
1. pedido_listo: el cliente confirma que quiere comprar y ya sabes producto, modelo y cantidad aproximada, y si recoge en tienda o quiere envío (con ciudad o barrio). Antes de escalar pide lo que falte, de una sola vez, y también su nombre si no lo sabes.
2. mayorista: instaladores, decoradores, constructoras, tiendas que revenden, o compras grandes (más de 30 láminas o más de $2.000.000 COP).
3. queja_garantia: producto defectuoso, reclamo, cambio o devolución. Muestra empatía, pide fotos o detalles y escala.
4. descuento: pide rebaja o negociar el precio. No prometas nada.
5. visita_instalacion: visita técnica, medición, instalación a domicilio o pedidos especiales que no están en el catálogo.
6. pide_persona: insiste en hablar con una persona después de que intentaste ayudar, o está molesto.
Asesor: "mayor" para mayoristas; "spc" para piso SPC; "detal" para todo lo demás.

Disponibilidad exacta, costo y tiempos de envío y formas de pago no los conoces: dilo con naturalidad y aclara que el asesor lo confirma al cerrar el pedido. No escales solo por una de esas preguntas.

Después de escalar, dile al cliente que un asesor de la tienda le va a escribir en breve (si la tienda está cerrada, que le escribe en cuanto abra) y sigue ayudándole si pregunta algo más. Si el contexto dice que ya se avisó a un asesor por ese motivo, no vuelvas a escalar por lo mismo.

Mensajes entre corchetes como [Foto] o [Nota de voz] describen lo que envió el cliente. Si una foto muestra su pared o espacio, úsala para recomendar. Si no pudiste escuchar un audio, pide amablemente que lo escriba.
Los mensajes que empiezan por [Asesor] los escribió una persona del equipo: respeta lo que acordó y no lo contradigas.`;

const TOOL_ESCALAR = {
  name: "escalar_a_asesor",
  description: "Avisa a un asesor humano por WhatsApp con un resumen del caso. Úsala SOLO en los casos importantes que indican las reglas (pedido listo, mayorista, queja, descuento, visita o pide persona). Nunca para simples preguntas o cotizaciones.",
  input_schema: {
    type: "object",
    properties: {
      motivo: { type: "string", enum: ["pedido_listo", "mayorista", "queja_garantia", "descuento", "visita_instalacion", "pide_persona", "otro"] },
      asesor: { type: "string", enum: ["detal", "mayor", "spc"] },
      prioridad: { type: "string", enum: ["alta", "media"], description: "alta: pedido listo, queja o cliente molesto." },
      resumen: { type: "string", description: "Resumen para el asesor en tercera persona, 1-3 frases: qué quiere el cliente y qué falta para cerrar." },
      nombre_cliente: { type: "string" },
      productos: { type: "string", description: "Productos, modelos y cantidades, p. ej. '19 láminas WPC REF 02 + 2 pegantes 300 ml'" },
      total_aprox: { type: "string", description: "Total aproximado en COP si lo calculaste" },
      entrega: { type: "string", description: "Recoge en tienda, o envío con ciudad o barrio" },
    },
    required: ["motivo", "asesor", "prioridad", "resumen"],
  },
};

// ───────────────────────────── Webhook HTTP ─────────────────────────────

/**
 * @param {Request} request @param {WaEnv} env @param {ExecutionContext} ctx
 */
export async function handleWebhook(request, env, ctx) {
  const cfg = waConfig(env);
  const url = new URL(request.url);

  // Verificación inicial de Meta al configurar el webhook.
  if (request.method === "GET") {
    const ok = cfg.verifyToken && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === cfg.verifyToken;
    return ok ? new Response(url.searchParams.get("hub.challenge") || "", { status: 200 }) : new Response("Forbidden", { status: 403 });
  }
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!cfg.ready || !env.DB) return new Response("Not configured", { status: 503 });

  const raw = await request.text();
  if (raw.length > 1_000_000) return new Response("Too large", { status: 413 });
  if (!(await verifySignature(cfg.appSecret, raw, request.headers.get("x-hub-signature-256")))) {
    console.warn(JSON.stringify({ evt: "wa_bad_signature" }));
    return new Response("Invalid signature", { status: 401 });
  }
  let payload;
  try { payload = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

  // Meta exige respuesta rápida: el trabajo sigue en segundo plano.
  ctx.waitUntil(processPayload(env, cfg, payload, url.origin).catch((e) =>
    console.error(JSON.stringify({ evt: "wa_process_error", err: String(e && e.stack || e).slice(0, 500) }))));
  return new Response("EVENT_RECEIVED", { status: 200 });
}

/** @param {WaEnv} env @param {WaConfig} cfg @param {any} payload @param {string} origin */
async function processPayload(env, cfg, payload, origin) {
  if (payload?.object !== "whatsapp_business_account") return;
  const tasks = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      if (v.metadata?.phone_number_id && v.metadata.phone_number_id !== cfg.phoneNumberId) continue;
      if (change.field === "messages") {
        const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
        for (const m of v.messages || []) tasks.push(handleIncoming(env, cfg, m, names[m.from], origin));
        for (const s of v.statuses || []) {
          if (s.status === "failed") console.warn(JSON.stringify({ evt: "wa_send_failed", to: mask(s.recipient_id), errors: s.errors }));
        }
      } else if (change.field === "smb_message_echoes") {
        for (const e of v.message_echoes || []) tasks.push(handleEcho(env, cfg, e));
      }
    }
  }
  const results = await Promise.allSettled(tasks);
  for (const r of results) if (r.status === "rejected") console.error(JSON.stringify({ evt: "wa_task_error", err: String(r.reason && r.reason.stack || r.reason).slice(0, 500) }));
}

// ───────────────────────────── Mensajes entrantes ─────────────────────────────

/** @param {WaEnv} env @param {WaConfig} cfg @param {any} m @param {string|undefined} name @param {string} origin */
async function handleIncoming(env, cfg, m, name, origin) {
  if (!m?.id || !m.from) return;
  if (!(await db.claim(env.DB, m.id))) return; // reintento de Meta: ya procesado
  if (m.type === "reaction" || m.type === "system") return;

  const from = digits(m.from);
  if (cfg.staff.has(from)) return handleStaff(env, cfg, from, textOf(m));

  const { text, media } = await describe(env, cfg, m);
  await db.touchContact(env.DB, from, name);
  const msgId = await db.addMessage(env.DB, from, "user", text, { wamid: m.id, media });

  if (!cfg.activo) return;
  const contact = await db.getContact(env.DB, from);
  if (contact && contact.human_until > Date.now()) return; // atiende una persona
  if ((await db.userMessagesLastHour(env.DB, from)) > SPAM_PER_HOUR) {
    console.warn(JSON.stringify({ evt: "wa_spam_guard", from: mask(from) }));
    return;
  }

  // Agrupa ráfagas: solo responde la ejecución del último mensaje recibido.
  await sleep(DEBOUNCE_MS);
  if ((await db.lastUserMessageId(env.DB, from)) !== msgId) return;

  markReadTyping(cfg, m.id).catch(() => {});
  await respond(env, cfg, from, msgId, origin);
}

/** Texto plano de un mensaje (para comandos). @param {any} m */
function textOf(m) {
  return String(m.text?.body || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || m.button?.text || "").trim();
}

/**
 * Convierte cualquier tipo de mensaje en texto para el historial.
 * @param {WaEnv} env @param {WaConfig} cfg @param {any} m
 * @returns {Promise<{ text: string, media?: { type: string, id: string, mime: string } }>}
 */
async function describe(env, cfg, m) {
  const caption = (o) => (o?.caption ? " " + String(o.caption).slice(0, 500) : "");
  switch (m.type) {
    case "text": return { text: String(m.text?.body || "").slice(0, 2000) || "[Mensaje vacío]" };
    case "interactive":
    case "button": return { text: textOf(m) || "[Respuesta de botón]" };
    case "image": return { text: "[Foto]" + caption(m.image), media: { type: "image", id: m.image?.id, mime: m.image?.mime_type || "" } };
    case "audio": return { text: await transcribe(env, cfg, m.audio?.id) };
    case "location": {
      const l = m.location || {};
      return { text: `[Ubicación compartida: ${[l.name, l.address].filter(Boolean).join(", ") || "sin nombre"} (${l.latitude}, ${l.longitude})]` };
    }
    case "document": return { text: `[Documento: ${m.document?.filename || "sin nombre"}]` + caption(m.document) };
    case "video": return { text: "[Video que no puedes ver]" + caption(m.video) };
    case "sticker": return { text: "[Sticker]" };
    case "contacts": return { text: "[Contacto compartido]" };
    default: return { text: "[Mensaje de un tipo que no puedes ver]" };
  }
}

/** Nota de voz → texto con Whisper en Workers AI. @param {WaEnv} env @param {WaConfig} cfg @param {string|undefined} mediaId */
async function transcribe(env, cfg, mediaId) {
  if (!mediaId || !env.AI) return "[Nota de voz que no se pudo escuchar]";
  try {
    const file = await downloadMedia(cfg, mediaId, MAX_AUDIO_BYTES);
    if (!file) return "[Nota de voz demasiado larga o no disponible]";
    let out;
    try {
      out = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: toBase64(file.bytes), language: "es" });
    } catch {
      out = await env.AI.run("@cf/openai/whisper", { audio: [...file.bytes] });
    }
    const text = String(out?.text || "").trim();
    return text ? "[Nota de voz] " + text.slice(0, 2000) : "[Nota de voz sin palabras reconocibles]";
  } catch (e) {
    console.warn(JSON.stringify({ evt: "wa_transcribe_error", err: String(e && e.message || e).slice(0, 200) }));
    return "[Nota de voz que no se pudo escuchar]";
  }
}

// ───────────────────────────── Respuesta con Claude ─────────────────────────────

/** @param {WaEnv} env @param {WaConfig} cfg @param {string} from @param {number} msgId @param {string} origin */
async function respond(env, cfg, from, msgId, origin) {
  const t0 = Date.now();
  const contact = await db.getContact(env.DB, from);
  const rows = await db.history(env.DB, from, HISTORY_LIMIT, Date.now() - HISTORY_DAYS * 864e5);
  const recent = await db.recentEscalations(env.DB, from, Date.now() - 24 * 3600_000);
  const abierto = abiertoAhora(cfg.horario);
  let escalatedThisTurn = false;

  try {
    const catalog = await loadCatalog(env, origin);
    const messages = await buildMessages(env, cfg, rows);
    if (!messages.length) return;

    const out = await runAgent(env, {
      rules: WA_RULES,
      catalogText: catalog.text,
      context: contextBlock(cfg, contact, rows, recent, abierto),
      tools: [TOOL_CALCULAR, TOOL_ESCALAR],
      maxTokens: 600,
      messages,
      handlers: {
        calcular_cantidad: (i) => calcularCantidad(catalog.pvc, i),
        escalar_a_asesor: async (i) => {
          const r = await escalate(env, cfg, from, contact?.name, i, abierto);
          if (r.ok) escalatedThisTurn = true;
          return r;
        },
      },
    });

    let reply = out.reply;
    if (!reply) {
      reply = "Déjame revisarlo con un asesor de la tienda y te escribimos en breve 🙌";
      if (!escalatedThisTurn) await escalate(env, cfg, from, contact?.name, { motivo: "error_bot", asesor: "detal", prioridad: "media", resumen: "El asistente no supo resolver la última consulta del cliente. Revisar el chat." }, abierto);
    }
    await deliver(env, cfg, from, msgId, reply);
    console.log(JSON.stringify({ evt: "wa_reply", from: mask(from), ms: Date.now() - t0, escalated: escalatedThisTurn, ...out.usage }));
  } catch (e) {
    console.error(JSON.stringify({ evt: "wa_agent_error", from: mask(from), err: String(e && e.message || e).slice(0, 300) }));
    await deliver(env, cfg, from, msgId, "Disculpa, estoy teniendo un problema técnico. Ya avisé a un asesor de la tienda para que te responda 🙏");
    if (!escalatedThisTurn) {
      await escalate(env, cfg, from, contact?.name, { motivo: "error_bot", asesor: "detal", prioridad: "alta", resumen: "Falla técnica del asistente. El cliente está esperando respuesta: revisar el chat." }, abierto).catch(() => {});
    }
  }
}

/** Envía la respuesta salvo que haya llegado otro mensaje o haya entrado una persona mientras se generaba. */
async function deliver(env, cfg, from, msgId, reply) {
  if ((await db.lastUserMessageId(env.DB, from)) !== msgId) return; // la ejecución más nueva responderá
  const c = await db.getContact(env.DB, from);
  if (c && c.human_until > Date.now()) return;
  const sent = await sendText(cfg, from, reply);
  if (sent.ok) await db.addMessage(env.DB, from, "assistant", reply, { wamid: sent.id });
  else console.error(JSON.stringify({ evt: "wa_send_error", from: mask(from), code: sent.code, err: sent.error }));
}

/**
 * Historial de D1 → mensajes para Claude (alternando user/assistant). Las fotos
 * recientes del cliente se adjuntan como imagen para que Claude las vea.
 * @param {WaEnv} env @param {WaConfig} cfg @param {import("./store.js").Row[]} rows
 */
async function buildMessages(env, cfg, rows) {
  const lastBot = rows.reduce((acc, r, i) => (r.role !== "user" ? i : acc), -1);
  /** @type {{ role: "user"|"assistant", content: any[] }[]} */
  const out = [];
  let images = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const role = r.role === "user" ? "user" : "assistant";
    const text = r.role === "human" ? "[Asesor] " + r.content : r.content;
    /** @type {any[]} */
    const blocks = [];
    if (r.role === "user" && r.media && i > lastBot && images < 3) {
      const img = await fetchImage(cfg, r.media);
      if (img) { blocks.push(img); images++; }
    }
    blocks.push({ type: "text", text });
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content.push(...blocks);
    else out.push({ role, content: blocks });
  }
  while (out.length && out[0].role !== "user") out.shift();
  if (!out.length || out[out.length - 1].role !== "user") return [];
  return out;
}

/** @param {WaConfig} cfg @param {string} mediaJson */
async function fetchImage(cfg, mediaJson) {
  try {
    const media = JSON.parse(mediaJson);
    if (media?.type !== "image" || !media.id) return null;
    const file = await downloadMedia(cfg, media.id, MAX_IMAGE_BYTES);
    if (!file || !IMAGE_TYPES.has(file.mime)) return null;
    return { type: "image", source: { type: "base64", media_type: file.mime, data: toBase64(file.bytes) } };
  } catch {
    return null;
  }
}

/** Contexto variable por conversación (va fuera de la caché del prompt). */
function contextBlock(cfg, contact, rows, recent, abierto) {
  const b = bogota();
  const lines = [`CONTEXTO DE ESTA CONVERSACIÓN`, `- Ahora en Pereira: ${b.fecha}, ${b.hora}.`];
  if (abierto === null) lines.push("- Horario de atención: no lo conoces. Si preguntan, di que lo confirma un asesor.");
  else lines.push(`- Horario: ${cfg.horarioTexto} (L=lunes … D=domingo). La tienda está ${abierto ? "ABIERTA" : "CERRADA"} ahora.`);
  if (contact?.name) lines.push(`- Nombre de perfil de WhatsApp del cliente: ${contact.name} (puede no ser su nombre real).`);
  if (!rows.some((r) => r.role !== "user")) lines.push("- Es su primer mensaje: saluda, preséntate en una frase como el asistente virtual de La Reina del PVC y ayúdale.");
  for (const e of recent) {
    const hace = Math.round((Date.now() - e.created_at) / 60000);
    lines.push(`- Ya se avisó a un asesor (${e.asesor}) por «${e.motivo}» hace ${hace} min${e.notified ? "" : " (el aviso está pendiente de entrega)"}. No repitas ese aviso.`);
  }
  return lines.join("\n");
}

// ───────────────────────────── Escalado a asesores ─────────────────────────────

/**
 * @param {WaEnv} env @param {WaConfig} cfg @param {string} waId @param {string|undefined} profileName
 * @param {any} input @param {boolean|null} abierto
 */
async function escalate(env, cfg, waId, profileName, input, abierto) {
  const motivo = Object.hasOwn(MOTIVOS, input.motivo) ? input.motivo : "otro";
  const asesor = ["detal", "mayor", "spc"].includes(input.asesor) ? input.asesor : motivo === "mayorista" ? "mayor" : "detal";
  const prioridad = input.prioridad === "alta" ? "alta" : "media";
  const resumen = String(input.resumen || "").trim().slice(0, 600) || "Revisar el chat del cliente.";

  const recent = await db.recentEscalations(env.DB, waId, Date.now() - ESCALATION_COOLDOWN_MS);
  if (recent.some((e) => e.motivo === motivo)) {
    return { ok: true, ya_avisado: true, nota: "Ya se había avisado a un asesor por este motivo. No hace falta repetirlo; tranquiliza al cliente." };
  }

  const datos = { nombre: input.nombre_cliente, productos: input.productos, total_aprox: input.total_aprox, entrega: input.entrega };
  const id = await db.addEscalation(env.DB, { waId, motivo, prioridad, asesor, resumen, datos });

  const nombre = String(input.nombre_cliente || profileName || "Cliente").slice(0, 60);
  const cliente = `${nombre} (+${waId})`;
  const detalle = [resumen, input.productos && "Productos: " + input.productos, input.total_aprox && "Total aprox.: " + input.total_aprox, input.entrega && "Entrega: " + input.entrega]
    .filter(Boolean).join(" · ");
  const titulo = (prioridad === "alta" ? "URGENTE · " : "") + MOTIVOS[motivo];
  const to = cfg.asesores[asesor];

  let sent = await sendTemplate(cfg, to, cfg.alertaPlantilla, [titulo, cliente, detalle, waId]);
  if (!sent.ok) {
    // Sin plantilla aprobada solo se puede escribir si el asesor habló con el bot en las últimas 24 h.
    sent = await sendText(cfg, to, `${titulo}\nCliente: ${cliente}\n${detalle.replaceAll(" · ", "\n")}\nEscríbele: https://wa.me/${waId}`);
  }
  if (sent.ok) await db.markNotified(env.DB, id);
  else console.error(JSON.stringify({ evt: "wa_alert_failed", id, asesor, code: sent.code, err: sent.error }));
  console.log(JSON.stringify({ evt: "wa_escalation", id, motivo, asesor, prioridad, notified: sent.ok }));

  return {
    ok: true,
    avisado: sent.ok,
    asesor: ASESOR_LABEL[asesor],
    nota: abierto === false
      ? "Aviso enviado. La tienda está cerrada ahora: dile al cliente que un asesor le escribe en cuanto abra."
      : "Aviso enviado. Dile al cliente que un asesor de la tienda le va a escribir en breve.",
  };
}

// ───────────────────────────── App del negocio y equipo ─────────────────────────────

/**
 * Un mensaje enviado desde la app WhatsApp Business (coexistencia) significa que una
 * persona está atendiendo ese chat: el bot se aparta durante unas horas.
 * @param {WaEnv} env @param {WaConfig} cfg @param {any} e
 */
async function handleEcho(env, cfg, e) {
  if (!e?.id || !e.to || !(await db.claim(env.DB, e.id))) return;
  const to = digits(e.to);
  await db.setHumanUntil(env.DB, to, Date.now() + cfg.pausaHumanoMs);
  const text = e.type === "text" ? String(e.text?.body || "") : `[${e.type || "mensaje"}]`;
  await db.addMessage(env.DB, to, "human", text || "[mensaje]", { wamid: e.id });
  console.log(JSON.stringify({ evt: "wa_human_took_over", to: mask(to) }));
}

/** Normaliza un número colombiano escrito a mano. @param {string} s */
function phoneArg(s) {
  const d = digits(s);
  if (d.length === 10 && d.startsWith("3")) return "57" + d;
  return d.length >= 11 ? d : "";
}

/** Comandos que el equipo envía al número del bot. */
async function handleStaff(env, cfg, from, text) {
  const t = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const [cmd, ...rest] = t.split(/\s+/);
  const num = phoneArg(rest.join(" "));
  let reply;
  if ((cmd === "pausa" || cmd === "pausar") && num) {
    await db.setHumanUntil(env.DB, num, Date.now() + cfg.pausaHumanoMs);
    reply = `✅ Bot en pausa con +${num} durante ${Math.round(cfg.pausaHumanoMs / 3600_000)} h. Atiéndelo tú.`;
  } else if ((cmd === "activa" || cmd === "activar") && num) {
    await db.setHumanUntil(env.DB, num, 0);
    reply = `✅ Bot activo otra vez con +${num}.`;
  } else if (cmd === "resumen") {
    reply = summaryText(await db.stats(env.DB, bogota().dayStart), "hoy");
  } else {
    reply = "🤖 Comandos del asistente:\n- *pausa 3101234567*: el bot deja de responder a ese cliente (lo atiendes tú)\n- *activa 3101234567*: el bot vuelve a responderle\n- *resumen*: actividad de hoy";
  }
  await sendText(cfg, from, reply);
}

/** @param {Awaited<ReturnType<typeof db.stats>>} s @param {string} cuando */
function summaryText(s, cuando) {
  const motivos = Object.entries(s.avisos).map(([k, n]) => `${n} ${MOTIVOS[k]?.replace(/^\S+\s/, "").toLowerCase() || k}`).join(", ");
  return `📊 Resumen de ${cuando}\n- Conversaciones: ${s.conversaciones}\n- Mensajes respondidos por el bot: ${s.respuestas_bot}\n- Avisos a asesores: ${s.avisos_total}${motivos ? " (" + motivos + ")" : ""}`;
}

// ───────────────────────────── Tareas programadas y panel ─────────────────────────────

/** Resumen diario al dueño + limpieza. Se ejecuta con el cron del Worker. @param {WaEnv} env */
export async function dailyJob(env) {
  const cfg = waConfig(env);
  if (!env.DB) return;
  await db.cleanup(env.DB);
  if (!cfg.ready) return;
  const b = bogota();
  const s = await db.stats(env.DB, b.dayStart);
  if (s.conversaciones === 0) return;
  const motivos = Object.entries(s.avisos).map(([k, n]) => `${n} ${MOTIVOS[k]?.replace(/^\S+\s/, "").toLowerCase() || k}`).join(", ");
  for (const to of cfg.resumenA) {
    let r = await sendTemplate(cfg, to, cfg.resumenPlantilla, [
      b.fecha,
      `${s.conversaciones} conversaciones y ${s.respuestas_bot} respuestas del asistente`,
      s.avisos_total ? `${s.avisos_total} (${motivos})` : "ninguno",
    ]);
    if (!r.ok) r = await sendText(cfg, to, summaryText(s, b.fecha));
    console.log(JSON.stringify({ evt: "wa_daily_summary", to: mask(to), ok: r.ok }));
  }
}

/** Estado y estadísticas (protegido con ADMIN_TOKEN). @param {Request} request @param {WaEnv} env */
export async function handleAdmin(request, env) {
  const cfg = waConfig(env);
  const url = new URL(request.url);
  if (url.pathname.endsWith("/health")) {
    return Response.json({ configurado: cfg.ready, base_de_datos: Boolean(env.DB), transcripcion: Boolean(env.AI), activo: cfg.activo, horario: Boolean(cfg.horario) }, { headers: { "cache-control": "no-store" } });
  }
  if (!cfg.adminToken || request.headers.get("authorization") !== "Bearer " + cfg.adminToken) return new Response("Not found", { status: 404 });
  const dias = Math.min(90, Math.max(1, Number(url.searchParams.get("dias")) || 7));
  const s = await db.stats(env.DB, Date.now() - dias * 864e5);
  return Response.json({ dias, ...s }, { headers: { "cache-control": "no-store" } });
}

// ───────────────────────────── Utilidades ─────────────────────────────

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Oculta parte del número en los logs. @param {string} n */
const mask = (n) => (n ? String(n).slice(0, 4) + "•••" + String(n).slice(-3) : "");

/** @param {Uint8Array} bytes */
function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + 0x8000)));
  return btoa(s);
}

// Exportado para pruebas.
export const _test = { phoneArg, summaryText };
