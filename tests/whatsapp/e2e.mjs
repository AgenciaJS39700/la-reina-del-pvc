// Pruebas de punta a punta del bot de WhatsApp contra el Worker local y los simuladores (ver README → «Pruebas del bot»).
import crypto from "node:crypto";
import fs from "node:fs";
import { execSync } from "node:child_process";

const BASE = "http://127.0.0.1:8787";
const LOG = process.argv[2];
const SECRET = "app-secret-test";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
let mark = 0;
const since = () => logs().slice(mark);
const reset = () => { mark = logs().length; };
const sentTo = (to) => since().filter((l) => l.api === "meta" && l.to === to && l.type);
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log((cond ? "✅ " : "❌ ") + name + (extra ? "  → " + extra : "")); };
let seq = 0;

function payload(messages, contacts, field = "messages", extra = {}) {
  return { object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field, value: { messaging_product: "whatsapp", metadata: { phone_number_id: "PHONEID", display_phone_number: "573000000000" }, contacts, messages, ...extra } }] }] };
}
function msg(from, text, name = "Cliente", over = {}) {
  return payload([{ from, id: "wamid.IN" + Date.now() + "_" + ++seq, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text }, ...over }], [{ wa_id: from, profile: { name } }]);
}
async function post(obj, sign = true) {
  const raw = JSON.stringify(obj);
  const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
  const r = await fetch(BASE + "/api/whatsapp/webhook", { method: "POST", headers: { "content-type": "application/json", ...(sign ? { "x-hub-signature-256": sig } : { "x-hub-signature-256": "sha256=deadbeef" }) }, body: raw });
  return r.status;
}
const d1 = (sql) => JSON.parse(execSync(`npx wrangler d1 execute la-reina-del-pvc-bot --local -c wrangler.test.jsonc --json --command "${sql.replace(/"/g, '\\"')}"`, { env: { ...process.env }, stdio: ["ignore", "pipe", "ignore"] }).toString())[0].results;

// 1. Verificación de Meta
let r = await fetch(BASE + "/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=12345");
check("Verificación del webhook con token correcto", r.status === 200 && (await r.text()) === "12345");
r = await fetch(BASE + "/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=malo&hub.challenge=1");
check("Verificación con token incorrecto rechazada", r.status === 403);

// 2. Firma inválida
check("Webhook con firma falsa rechazado (401)", (await post(msg("573110000001", "hola"), false)) === 401);

// 3. Pregunta normal → responde, sin avisar a nadie
reset();
const m1 = msg("573110000001", "Hola, ¿qué precio tiene el WPC?", "Ana");
check("Webhook firmado aceptado (200)", (await post(m1)) === 200);
await sleep(6000);
let out = sentTo("573110000001").filter((l) => l.type === "text");
check("Pregunta simple: el bot responde 1 vez", out.length === 1, out[0]?.text?.body);
check("Muestra «escribiendo…» y marca leído", since().some((l) => l.api === "meta" && l.status === "read" && l.typing_indicator));
check("No avisa a ningún asesor", sentTo("573000000001").length === 0 && sentTo("573000000002").length === 0);
const ctx1 = since().find((l) => l.api === "claude")?.context || "";
check("Contexto: primer mensaje + horario + hora de Colombia", /primer mensaje/.test(ctx1) && /Horario/.test(ctx1) && /Pereira/.test(ctx1));

// 4. Webhook duplicado (reintento de Meta)
reset();
await post(m1);
await sleep(5000);
check("Reintento de Meta del mismo mensaje: no responde dos veces", sentTo("573110000001").length === 0);

// 5. Ráfaga de 3 mensajes → 1 sola respuesta con todo el contexto
reset();
await post(msg("573110000002", "hola", "Beto")); await sleep(600);
await post(msg("573110000002", "tengo una pared de 3 x 2,5", "Beto")); await sleep(600);
await post(msg("573110000002", "cuantas laminas necesito?", "Beto"));
await sleep(7000);
out = sentTo("573110000002").filter((l) => l.type === "text");
const claudeB = since().filter((l) => l.api === "claude");
check("Ráfaga de 3 mensajes: 1 sola respuesta", out.length === 1, `${out.length} respuestas`);
check("Claude recibió los 3 mensajes juntos", claudeB.length === 1 && /hola.*pared.*laminas/s.test(claudeB[0].userText), claudeB[0]?.userText);

// 6. Pedido listo → aviso al asesor con plantilla
reset();
await post(msg("573110000003", "Listo, quiero comprar las 19 láminas, recojo en tienda. Soy Carlos", "Carlos"));
await sleep(7000);
const alert = sentTo("573000000001").find((l) => l.type === "template");
check("Pedido listo: aviso al asesor de detal con plantilla", !!alert, alert && alert.template.components[0].parameters.map((p) => p.text).join(" | "));
check("El aviso incluye enlace al chat del cliente", alert?.template?.components[0]?.parameters?.[3]?.text === "573110000003");
out = sentTo("573110000003").filter((l) => l.type === "text");
check("El cliente recibe confirmación", out.length === 1, out[0]?.text?.body?.slice(0, 80));
let esc = d1("SELECT motivo, asesor, prioridad, notified FROM escalations WHERE wa_id='573110000003'");
check("Aviso guardado en la base de datos y marcado como entregado", esc.length === 1 && esc[0].notified === 1 && esc[0].motivo === "pedido_listo");

// 7. Mismo motivo otra vez → no repite el aviso
reset();
await post(msg("573110000003", "listo entonces, ¿me confirman?", "Carlos"));
await sleep(7000);
check("No repite el aviso por el mismo motivo (enfriamiento 6 h)", sentTo("573000000001").length === 0);
check("La herramienta informa «ya avisado»", since().some((l) => l.api === "claude" && l.toolResults?.some((t) => /ya_avisado/.test(t))));

// 8. Un asesor responde desde la app (eco de coexistencia) → el bot se calla
reset();
await post(payload(undefined, undefined, "smb_message_echoes", { message_echoes: [{ from: "573000000000", to: "573110000001", id: "wamid.ECHO" + Date.now(), timestamp: "1", type: "text", text: { body: "Hola Ana, soy Laura de la tienda" } }] }));
await sleep(1500);
await post(msg("573110000001", "Gracias Laura, ¿entonces lo separan?", "Ana"));
await sleep(6000);
check("Tras responder un humano desde la app, el bot no contesta", sentTo("573110000001").length === 0);
const hu = d1("SELECT human_until FROM contacts WHERE wa_id='573110000001'")[0].human_until;
check("Pausa de 12 h registrada", hu > Date.now() + 11 * 3600_000, new Date(hu).toISOString());

// 9. Comando del equipo: reactivar el bot para ese cliente
reset();
await post(msg("573000000001", "activa 3110000001", "Laura"));
await sleep(2500);
const staffReply = sentTo("573000000001").find((l) => l.type === "text");
check("Comando del asesor «activa»: confirma", /Bot activo/.test(staffReply?.text?.body || ""), staffReply?.text?.body);
await post(msg("573110000001", "¿y el pegante cuánto vale?", "Ana"));
await sleep(6000);
out = sentTo("573110000001").filter((l) => l.type === "text");
const claudeA = since().filter((l) => l.api === "claude").pop();
check("El bot vuelve a responder a ese cliente", out.length === 1);
check("Claude ve lo que dijo el asesor humano", claudeA?.hasAsesor === true);

// 10. Comando «resumen» y comando desconocido
reset();
await post(msg("573000000001", "resumen", "Laura"));
await sleep(2500);
const res = sentTo("573000000001").find((l) => l.type === "text")?.text?.body || "";
check("Comando «resumen» devuelve la actividad de hoy", /Conversaciones: \d+/.test(res), res.replace(/\n/g, " / "));

// 11. Foto del cliente → Claude la ve
reset();
await post(msg("573110000004", "", "Dani", { type: "image", image: { id: "MEDIA_IMG", mime_type: "image/png", caption: "esta es mi pared" }, text: undefined }));
await sleep(7000);
const claudeImg = since().find((l) => l.api === "claude");
check("Foto: Claude recibe la imagen", claudeImg?.hasImage === true);
check("Foto: el bot responde", sentTo("573110000004").filter((l) => l.type === "text").length === 1);

// 12. Nota de voz sin transcripción disponible → pide que escriba (sin romperse)
reset();
await post(msg("573110000005", "", "Eva", { type: "audio", audio: { id: "MEDIA_AUDIO", mime_type: "audio/ogg; codecs=opus" }, text: undefined }));
await sleep(6000);
const claudeAud = since().find((l) => l.api === "claude");
check("Nota de voz: se registra y el bot responde", /Nota de voz/.test(claudeAud?.userText || "") && sentTo("573110000005").length >= 1, claudeAud?.userText);

// 13. Falla de Claude → disculpa al cliente + aviso urgente
reset();
await post(msg("573110000006", "boom", "Fer"));
await sleep(9000);
out = sentTo("573110000006").filter((l) => l.type === "text");
check("Si la IA falla, el cliente recibe disculpa", /problema técnico/.test(out[0]?.text?.body || ""));
check("Y se avisa a un asesor (error_bot)", sentTo("573000000001").some((l) => l.type === "template"));

// 14. Reacciones y estados no generan respuesta
reset();
await post(msg("573110000007", "", "Gabo", { type: "reaction", reaction: { message_id: "x", emoji: "👍" }, text: undefined }));
await post(payload(undefined, undefined, "messages", { statuses: [{ id: "wamid.OUT1", status: "delivered", recipient_id: "573110000001" }] }));
await sleep(5000);
check("Reacciones y confirmaciones de entrega se ignoran", since().filter((l) => l.api === "meta" && l.type).length === 0);

// 15. Panel de estadísticas protegido
r = await fetch(BASE + "/api/whatsapp/stats");
check("Estadísticas sin token: ocultas (404)", r.status === 404);
r = await fetch(BASE + "/api/whatsapp/stats?dias=1", { headers: { authorization: "Bearer adm-test" } });
const st = await r.json();
check("Estadísticas con token", r.status === 200 && st.conversaciones >= 6, `conversaciones=${st.conversaciones}, avisos=${st.avisos_total}`);

// 16. Resumen diario programado (cron)
reset();
r = await fetch(BASE + "/__scheduled?cron=0+1+*+*+*");
await sleep(2500);
const daily = sentTo("573000000009").find((l) => l.type === "template");
check("Cron: resumen diario al dueño con plantilla", !!daily, daily?.template?.components?.[0]?.parameters?.map((p) => p.text).join(" | "));

// 17. El chat de la web sigue funcionando
r = await fetch(BASE + "/api/chat", { method: "POST", headers: { origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "hola web" }] }) });
const web = await r.json();
check("Regresión: el chat de la web responde", r.status === 200 && /hola web/.test(web.reply || ""), web.reply);
const webClaude = logs().filter((l) => l.api === "claude").pop();
check("La web usa sus herramientas (enlace_asesor), no las de WhatsApp", webClaude.tools.join() === "calcular_cantidad,enlace_asesor");
const waClaude = logs().filter((l) => l.api === "claude" && l.tools.includes("escalar_a_asesor"));
check("WhatsApp usa calcular_cantidad + escalar_a_asesor", waClaude.length > 0);

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
