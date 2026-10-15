// worker/whatsapp/store.js — Acceso a D1 (contactos, historial, deduplicación, avisos).

/** @typedef {{ prepare(q: string): any, batch(s: any[]): Promise<any> }} D1 */
/** @typedef {{ id: number, role: "user"|"assistant"|"human", content: string, media: string|null, created_at: number }} Row */

/** Registra el mensaje de Meta; devuelve false si ya se procesó (reintento de webhook). @param {D1} db @param {string} wamid */
export async function claim(db, wamid) {
  const r = await db.prepare("INSERT OR IGNORE INTO processed (wamid, created_at) VALUES (?, ?)").bind(wamid, Date.now()).run();
  return (r.meta?.changes ?? 0) > 0;
}

/** @param {D1} db @param {string} waId @param {string|undefined} name */
export async function touchContact(db, waId, name) {
  const now = Date.now();
  await db.prepare(
    `INSERT INTO contacts (wa_id, name, first_seen, last_seen, last_user_at) VALUES (?1, ?2, ?3, ?3, ?3)
     ON CONFLICT(wa_id) DO UPDATE SET name = COALESCE(?2, name), last_seen = ?3, last_user_at = ?3`
  ).bind(waId, name || null, now).run();
}

/** @param {D1} db @param {string} waId */
export function getContact(db, waId) {
  return db.prepare("SELECT * FROM contacts WHERE wa_id = ?").bind(waId).first();
}

/** @param {D1} db @param {string} waId @param {number} until */
export async function setHumanUntil(db, waId, until) {
  const now = Date.now();
  await db.prepare(
    `INSERT INTO contacts (wa_id, first_seen, last_seen, human_until) VALUES (?1, ?2, ?2, ?3)
     ON CONFLICT(wa_id) DO UPDATE SET human_until = ?3`
  ).bind(waId, now, until).run();
}

/**
 * @param {D1} db @param {string} waId @param {"user"|"assistant"|"human"} role @param {string} content
 * @param {{ wamid?: string, media?: object }} [extra]
 * @returns {Promise<number>} id del mensaje guardado
 */
export async function addMessage(db, waId, role, content, extra = {}) {
  const r = await db.prepare("INSERT INTO messages (wa_id, role, content, wamid, media, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(waId, role, content.slice(0, 4000), extra.wamid || null, extra.media ? JSON.stringify(extra.media) : null, Date.now()).run();
  return Number(r.meta?.last_row_id || 0);
}

/** Id del último mensaje del cliente. @param {D1} db @param {string} waId */
export async function lastUserMessageId(db, waId) {
  const r = await db.prepare("SELECT MAX(id) AS id FROM messages WHERE wa_id = ? AND role = 'user'").bind(waId).first();
  return Number(r?.id || 0);
}

/** @param {D1} db @param {string} waId @param {number} limit @param {number} sinceMs @returns {Promise<Row[]>} */
export async function history(db, waId, limit, sinceMs) {
  const r = await db.prepare(
    "SELECT id, role, content, media, created_at FROM messages WHERE wa_id = ? AND created_at >= ? ORDER BY id DESC LIMIT ?"
  ).bind(waId, sinceMs, limit).all();
  return (r.results || []).reverse();
}

/** Mensajes del cliente en la última hora (freno anti-spam). @param {D1} db @param {string} waId */
export async function userMessagesLastHour(db, waId) {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM messages WHERE wa_id = ? AND role = 'user' AND created_at > ?")
    .bind(waId, Date.now() - 3600_000).first();
  return Number(r?.n || 0);
}

/** @param {D1} db @param {string} waId @param {number} sinceMs */
export async function recentEscalations(db, waId, sinceMs) {
  const r = await db.prepare("SELECT motivo, asesor, created_at, notified FROM escalations WHERE wa_id = ? AND created_at > ? ORDER BY id DESC")
    .bind(waId, sinceMs).all();
  return r.results || [];
}

/**
 * @param {D1} db
 * @param {{ waId: string, motivo: string, prioridad: string, asesor: string, resumen: string, datos?: object }} e
 */
export async function addEscalation(db, e) {
  const r = await db.prepare("INSERT INTO escalations (wa_id, motivo, prioridad, asesor, resumen, datos, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(e.waId, e.motivo, e.prioridad, e.asesor, e.resumen.slice(0, 1500), e.datos ? JSON.stringify(e.datos).slice(0, 2000) : null, Date.now()).run();
  return Number(r.meta?.last_row_id || 0);
}

/** @param {D1} db @param {number} id */
export async function markNotified(db, id) {
  await db.prepare("UPDATE escalations SET notified = 1 WHERE id = ?").bind(id).run();
}

/** Estadísticas desde un instante. @param {D1} db @param {number} sinceMs */
export async function stats(db, sinceMs) {
  const [conv, msgs, esc, list] = await db.batch([
    db.prepare("SELECT COUNT(DISTINCT wa_id) AS n FROM messages WHERE role = 'user' AND created_at >= ?").bind(sinceMs),
    db.prepare("SELECT role, COUNT(*) AS n FROM messages WHERE created_at >= ? GROUP BY role").bind(sinceMs),
    db.prepare("SELECT motivo, COUNT(*) AS n FROM escalations WHERE created_at >= ? GROUP BY motivo").bind(sinceMs),
    db.prepare(
      `SELECT e.wa_id, c.name, e.motivo, e.asesor, e.resumen, e.notified, e.created_at
       FROM escalations e LEFT JOIN contacts c ON c.wa_id = e.wa_id WHERE e.created_at >= ? ORDER BY e.id DESC LIMIT 50`
    ).bind(sinceMs),
  ]);
  /** @type {Record<string, number>} */
  const porRol = {};
  for (const r of msgs.results || []) porRol[r.role] = r.n;
  /** @type {Record<string, number>} */
  const porMotivo = {};
  for (const r of esc.results || []) porMotivo[r.motivo] = r.n;
  return {
    conversaciones: Number(conv.results?.[0]?.n || 0),
    mensajes_cliente: porRol.user || 0,
    respuestas_bot: porRol.assistant || 0,
    mensajes_asesor: porRol.human || 0,
    avisos: porMotivo,
    avisos_total: Object.values(porMotivo).reduce((a, b) => a + b, 0),
    ultimos_avisos: list.results || [],
  };
}

/** Limpieza periódica: deduplicación > 7 días; conversaciones > 90 días. @param {D1} db */
export async function cleanup(db) {
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM processed WHERE created_at < ?").bind(now - 7 * 864e5),
    db.prepare("DELETE FROM messages WHERE created_at < ?").bind(now - 90 * 864e5),
  ]);
}
