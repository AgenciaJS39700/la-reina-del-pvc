-- Bot de WhatsApp · La Reina del PVC
-- Tiempos en milisegundos Unix (Date.now()).

-- Una fila por cliente que escribe.
CREATE TABLE IF NOT EXISTS contacts (
  wa_id        TEXT PRIMARY KEY,          -- número del cliente (formato internacional sin +)
  name         TEXT,                      -- nombre de perfil de WhatsApp
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  last_user_at INTEGER,                   -- último mensaje del cliente (ventana de 24 h)
  human_until  INTEGER NOT NULL DEFAULT 0 -- si > ahora, el bot no responde (atiende una persona)
);

-- Historial de la conversación (solo texto; fotos y audios como descripción).
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id      TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'human')),
  content    TEXT NOT NULL,
  wamid      TEXT,                        -- id de mensaje de Meta
  media      TEXT,                        -- JSON {type,id,mime} de una foto pendiente de ver
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_wa ON messages (wa_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_time ON messages (created_at);

-- Deduplicación: Meta puede reenviar el mismo webhook.
CREATE TABLE IF NOT EXISTS processed (
  wamid      TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- Avisos a asesores.
CREATE TABLE IF NOT EXISTS escalations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id      TEXT NOT NULL,
  motivo     TEXT NOT NULL,
  prioridad  TEXT NOT NULL,
  asesor     TEXT NOT NULL,               -- detal | mayor | spc
  resumen    TEXT NOT NULL,
  datos      TEXT,                        -- JSON con productos, total, entrega…
  notified   INTEGER NOT NULL DEFAULT 0,  -- 1 si el aviso llegó al asesor
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_escalations_wa ON escalations (wa_id, created_at);
CREATE INDEX IF NOT EXISTS idx_escalations_time ON escalations (created_at);
