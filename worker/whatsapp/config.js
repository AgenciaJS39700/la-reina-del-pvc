// worker/whatsapp/config.js — Configuración del bot leída de las variables del Worker.
// Todo tiene un valor por defecto salvo lo que depende de Meta (número y credenciales).

/**
 * @typedef {{
 *   WHATSAPP_TOKEN?: string, WHATSAPP_APP_SECRET?: string, WHATSAPP_VERIFY_TOKEN?: string,
 *   WHATSAPP_PHONE_NUMBER_ID?: string, WHATSAPP_GRAPH_URL?: string,
 *   ASESORES?: string, RESUMEN_A?: string, HORARIO?: string, BOT_MODO?: string,
 *   ALERTA_PLANTILLA?: string, RESUMEN_PLANTILLA?: string, PLANTILLA_IDIOMA?: string,
 *   PAUSA_HUMANO_HORAS?: string, ADMIN_TOKEN?: string,
 * }} WaVars
 */

/** Asesores por defecto: los números públicos de la web. */
const DEFAULT_ASESORES = { detal: "573218911231", mayor: "573146659658", spc: "573218911231" };

/** @param {string} s */
export const digits = (s) => String(s || "").replace(/\D/g, "");

/** @param {string|undefined} raw @param {any} fallback */
function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

/** @param {WaVars} env */
export function waConfig(env) {
  const asesoresRaw = parseJson(env.ASESORES, DEFAULT_ASESORES);
  /** @type {Record<"detal"|"mayor"|"spc", string>} */
  const asesores = {
    detal: digits(asesoresRaw.detal || DEFAULT_ASESORES.detal),
    mayor: digits(asesoresRaw.mayor || asesoresRaw.detal || DEFAULT_ASESORES.mayor),
    spc: digits(asesoresRaw.spc || asesoresRaw.detal || DEFAULT_ASESORES.spc),
  };
  const resumenA = String(env.RESUMEN_A || asesores.detal).split(",").map(digits).filter(Boolean);
  return {
    ready: Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID),
    token: env.WHATSAPP_TOKEN || "",
    appSecret: env.WHATSAPP_APP_SECRET || "",
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || "",
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || "",
    graph: (env.WHATSAPP_GRAPH_URL || "https://graph.facebook.com/v24.0").replace(/\/$/, ""),
    asesores,
    resumenA,
    /** Números del equipo: sus mensajes al bot se tratan como comandos, no como clientes. */
    staff: new Set([...Object.values(asesores), ...resumenA]),
    horario: parseHorario(env.HORARIO || ""),
    horarioTexto: env.HORARIO || "",
    activo: (env.BOT_MODO || "on").toLowerCase() !== "off",
    alertaPlantilla: env.ALERTA_PLANTILLA || "alerta_asesor",
    resumenPlantilla: env.RESUMEN_PLANTILLA || "resumen_diario",
    idioma: env.PLANTILLA_IDIOMA || "es",
    pausaHumanoMs: Math.max(1, Number(env.PAUSA_HUMANO_HORAS) || 12) * 3600_000,
    adminToken: env.ADMIN_TOKEN || "",
  };
}

// ─────────────────────────────── Horario ───────────────────────────────
// Formato de HORARIO: "L-V 08:00-18:00; S 08:00-13:00"  (D = domingo; días sin tramo = cerrado)
// Zona horaria fija de Colombia (UTC−5, sin horario de verano).

const DAY_LETTERS = ["D", "L", "M", "X", "J", "V", "S"]; // índice = getUTCDay()
const TZ_OFFSET_MS = -5 * 3600_000;

/** @param {string} raw @returns {Array<Array<[number, number]>> | null} minutos desde 00:00 por día */
export function parseHorario(raw) {
  const txt = raw.trim().toUpperCase();
  if (!txt) return null;
  /** @type {Array<Array<[number, number]>>} */
  const week = [[], [], [], [], [], [], []];
  for (const part of txt.split(/[;\n]+/)) {
    const m = part.trim().match(/^([LMXJVSD])(?:\s*-\s*([LMXJVSD]))?\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const order = ["L", "M", "X", "J", "V", "S", "D"];
    const a = order.indexOf(m[1]), b = m[2] ? order.indexOf(m[2]) : a;
    const from = Number(m[3]) * 60 + Number(m[4]), to = Number(m[5]) * 60 + Number(m[6]);
    for (let i = a; i <= b; i++) week[DAY_LETTERS.indexOf(order[i])].push([from, to]);
  }
  return week.some((d) => d.length) ? week : null;
}

/** Fecha y hora actuales en Colombia. @param {number} [now] */
export function bogota(now = Date.now()) {
  const d = new Date(now + TZ_OFFSET_MS);
  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const hh = String(d.getUTCHours()).padStart(2, "0"), mm = String(d.getUTCMinutes()).padStart(2, "0");
  return {
    day: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    fecha: `${dias[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`,
    hora: `${hh}:${mm}`,
    /** Inicio del día en Colombia, en ms UTC. */
    dayStart: now - ((d.getUTCHours() * 60 + d.getUTCMinutes()) * 60_000 + d.getUTCSeconds() * 1000 + d.getUTCMilliseconds()),
  };
}

/** @param {ReturnType<typeof parseHorario>} horario @param {number} [now] @returns {boolean|null} null = horario desconocido */
export function abiertoAhora(horario, now = Date.now()) {
  if (!horario) return null;
  const b = bogota(now);
  return horario[b.day].some(([f, t]) => b.minutes >= f && b.minutes < t);
}
