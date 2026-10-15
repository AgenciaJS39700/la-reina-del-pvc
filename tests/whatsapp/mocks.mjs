// Simuladores locales: Meta Graph API (9998) y Anthropic Messages API (9999).
import http from "node:http";
import fs from "node:fs";
const LOG = process.argv[2];
const log = (o) => fs.appendFileSync(LOG, JSON.stringify(o) + "\n");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let n = 0;

function body(req) { return new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); }); }

// ── Meta ──
http.createServer(async (req, res) => {
  const raw = await body(req);
  const send = (code, obj, type = "application/json") => { res.writeHead(code, { "content-type": type }); res.end(type === "application/json" ? JSON.stringify(obj) : obj); };
  if (req.method === "POST" && req.url.endsWith("/messages")) {
    const p = JSON.parse(raw);
    log({ api: "meta", auth: req.headers.authorization, ...p });
    return send(200, { messaging_product: "whatsapp", messages: [{ id: "wamid.OUT" + ++n }] });
  }
  if (req.method === "GET" && req.url.startsWith("/MEDIA_IMG")) return send(200, { url: "http://127.0.0.1:9998/file/img.png", mime_type: "image/png", file_size: PNG.length });
  if (req.method === "GET" && req.url.startsWith("/MEDIA_AUDIO")) return send(200, { url: "http://127.0.0.1:9998/file/a.ogg", mime_type: "audio/ogg", file_size: 10 });
  if (req.method === "GET" && req.url === "/file/img.png") return send(200, PNG, "image/png");
  if (req.method === "GET" && req.url === "/file/a.ogg") return send(200, Buffer.from("OggS fake"), "audio/ogg");
  send(404, { error: { message: "not found" } });
}).listen(9998, "127.0.0.1");

// ── Anthropic ──
http.createServer(async (req, res) => {
  const b = JSON.parse(await body(req));
  const last = b.messages[b.messages.length - 1];
  const blocks = Array.isArray(last.content) ? last.content : [{ type: "text", text: last.content }];
  const lastText = blocks.filter((x) => x.type === "text").map((x) => x.text).join(" | ");
  const hasImage = blocks.some((x) => x.type === "image");
  const toolResults = blocks.filter((x) => x.type === "tool_result");
  const userTurn = b.messages.filter((m) => m.role === "user" && (typeof m.content === "string" || m.content.some((x) => x.type === "text"))).pop();
  const userText = (Array.isArray(userTurn.content) ? userTurn.content.filter((x) => x.type === "text").map((x) => x.text).join(" | ") : userTurn.content);
  log({ api: "claude", hasAsesor: JSON.stringify(b.messages).includes("[Asesor] Hola Ana, soy Laura"), tools: b.tools.map((t) => t.name), system_parts: b.system.length, context: b.system[2]?.text, nmsgs: b.messages.length, userText, hasImage, toolResults: toolResults.map((t) => t.content) });

  const reply = (content, stop = "end_turn", status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: b.model, stop_reason: stop, content, usage: { input_tokens: 10, output_tokens: 5 } }));
  };
  if (/boom/i.test(userText)) { res.writeHead(500); return res.end("{}"); }
  if (/listo|comprar/i.test(userText) && !toolResults.length) {
    return reply([{ type: "tool_use", id: "e1", name: "escalar_a_asesor", input: { motivo: "pedido_listo", asesor: "detal", prioridad: "alta", resumen: "Quiere 19 láminas WPC REF 02, recoge en tienda.", nombre_cliente: "Carlos", productos: "19 láminas WPC REF 02", total_aprox: "$475.000 COP", entrega: "Recoge en tienda" } }], "tool_use");
  }
  if (toolResults.length) return reply([{ type: "text", text: "Listo Carlos, ya le pasé tu pedido a un asesor. Te escribe en breve 🙌 (tool: " + toolResults[0].content.slice(0, 60) + ")" }]);
  if (hasImage) return reply([{ type: "text", text: "¡Vi tu foto! Esa pared quedaría genial con WPC." }]);
  return reply([{ type: "text", text: "RESP a: " + userText.slice(0, 120) }]);
}).listen(9999, "127.0.0.1");
