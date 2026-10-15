# La Reina del PVC

Web estática de catálogo y simulador 3D de pared/piso para **La Reina del PVC** (Pereira, Colombia). Desplegada como Cloudflare Worker con static assets.

- `index.html`, `styles.css`, `app.js`: sitio (vanilla JS, mobile-first).
- `data.js`: catálogo (productos, modelos, precios, stock) y enlaces de WhatsApp.
- `img/`: fotos extraídas de los catálogos de Canva (webp).
- `chat.js`, `chat.css`: widget del asistente IA.
- `worker/`: backend del asistente (`/api/chat`) y del bot de WhatsApp (`/api/whatsapp/*`); no se publica como asset.
- `migrations/`: esquema de la base de datos D1 del bot.
- `tests/whatsapp/`: pruebas de punta a punta del bot.
- `wrangler.jsonc`: configuración de Cloudflare.

Despliegue: Cloudflare → Workers & Pages → Import repository.

## Asistente IA (chat de la web)

Responde dudas con el catálogo real de `data.js`, calcula cantidades con la misma lógica del simulador y deriva al asesor de WhatsApp correcto (detal, mayor o piso SPC) con el pedido ya resumido.

```
Navegador (chat.js) ──POST /api/chat──► Worker (worker/index.js)
                                         ├─ valida origen, tamaño y rate limit (12/min por IP)
                                         ├─ lee data.js (caché 5 min) → catálogo en el prompt
                                         └─ Claude API (tool use)
                                              ├─ calcular_cantidad  → misma fórmula que el simulador
                                              └─ enlace_asesor      → botón de WhatsApp prellenado
```

### Activarlo

1. En la Console de Anthropic crea una API key solo para este cliente y ponle un límite de gasto mensual.
2. Cloudflare → Workers → `la-reina-del-pvc` → Settings → Variables and Secrets → añade el **secreto** `ANTHROPIC_API_KEY`.
3. Listo. Sin la clave, el widget no aparece y la web funciona igual que antes.

Variables opcionales:

| Variable | Por defecto | Uso |
|---|---|---|
| `ANTHROPIC_MODEL` | `claude-haiku-5-5` | Cambiar de modelo sin tocar código. |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Pasar por Cloudflare AI Gateway (logs y analítica). |

### Desarrollo local

```bash
printf 'ANTHROPIC_API_KEY=sk-ant-...\n' > .dev.vars   # ignorado por git
npx wrangler dev
```

Nunca subas la clave al repositorio: es público.

### Privacidad

Los logs del Worker solo guardan métricas (tiempo, tokens, nº de turnos), nunca el texto de la conversación. El historial vive en `sessionStorage` del navegador del cliente y se borra al cerrar la pestaña.

## Bot de WhatsApp

El bot atiende solo el WhatsApp del negocio, con el mismo catálogo y cálculo que el chat de la web, y **solo avisa a un asesor cuando el caso lo merece**.

| Lo resuelve el bot | Avisa a un asesor |
|---|---|
| Precios, modelos, catálogo | 🔥 Pedido listo para cerrar (producto, cantidad y entrega definidos) |
| Cálculo de cantidades y cotización con total | 📦 Mayoristas o compras grandes |
| Instalación, pegantes, dirección | ⚠️ Quejas, garantías, cambios |
| Saludos y preguntas sueltas | 💬 Piden descuento · 🛠️ Visitas o pedidos especiales · 🙋 Insisten en hablar con una persona |

```
Cliente ──► Meta ──POST /api/whatsapp/webhook──► Worker
                                                 ├─ verifica la firma de Meta y descarta duplicados
                                                 ├─ guarda en D1 y agrupa ráfagas (3,5 s)
                                                 ├─ notas de voz → texto (Whisper, Workers AI); fotos → Claude las ve
                                                 ├─ Claude: responde · calcular_cantidad · escalar_a_asesor
                                                 └─ escalar_a_asesor → plantilla de WhatsApp al asesor (con enlace al chat)
App WhatsApp Business (coexistencia) ──eco──► el bot se aparta 12 h de ese chat
Cron 20:00 (Colombia) ──► resumen del día al dueño + limpieza (90 días)
```

Otras protecciones: no avisa dos veces por el mismo motivo en 6 h; si la IA falla, el cliente recibe una disculpa y se avisa a un asesor; máximo 40 mensajes por hora y cliente; los logs ocultan los números.

### Ya está hecho

- Código del bot, rutas y cron en este repositorio.
- Base de datos D1 `la-reina-del-pvc-bot` creada en Cloudflare con su esquema (`migrations/0001_whatsapp.sql`).
- Vinculaciones en `wrangler.jsonc`: `DB` (D1), `AI` (Workers AI) y el cron.

### Falta para activarlo (Meta)

1. **Meta Business** del negocio con acceso de administrador.
2. **App de Meta** (tipo Business) en developers.facebook.com con el producto WhatsApp.
3. **Número**: registrar el número del negocio. Si se usa el mismo de la app WhatsApp Business (coexistencia), hay que suscribir también el campo `smb_message_echoes`.
4. **Token permanente** de un usuario del sistema con `whatsapp_business_messaging` y `whatsapp_business_management`.
5. **Webhook**: URL `https://la-reina-del-pvc.agencia39700.workers.dev/api/whatsapp/webhook`, el token de verificación que elijas y los campos `messages` (y `smb_message_echoes` con coexistencia).
6. **Plantillas** (categoría *Utility*, idioma *Spanish* `es`), necesarias para avisar a los asesores aunque no hayan escrito en 24 h:

   `alerta_asesor`
   ```
   Aviso del asistente de La Reina del PVC: {{1}}.
   Cliente: {{2}}
   Detalle: {{3}}
   Abre el chat: https://wa.me/{{4}} y atiéndelo cuanto antes.
   ```
   `resumen_diario`
   ```
   Resumen del asistente de La Reina del PVC del {{1}}: {{2}}. Avisos a asesores: {{3}}. Puedes escribir «resumen» a este número cuando quieras.
   ```
   Mientras no estén aprobadas, el aviso se envía como texto normal, que solo llega si ese asesor escribió al bot en las últimas 24 h.

### Variables en Cloudflare

Workers → `la-reina-del-pvc` → Settings → Variables and Secrets. Se conservan entre despliegues (`keep_vars`).

| Variable | Tipo | Ejemplo / por defecto | Uso |
|---|---|---|---|
| `WHATSAPP_TOKEN` | secreto | — | Token permanente de Meta |
| `WHATSAPP_APP_SECRET` | secreto | — | Verifica la firma de cada webhook |
| `WHATSAPP_VERIFY_TOKEN` | secreto | cualquier texto largo | El mismo que pongas en Meta al configurar el webhook |
| `WHATSAPP_PHONE_NUMBER_ID` | secreto | — | ID del número en Meta (no es el teléfono) |
| `ANTHROPIC_API_KEY` | secreto | — | Compartida con el chat de la web |
| `ASESORES` | texto | `{"detal":"573218911231","mayor":"573146659658","spc":"573218911231"}` | A quién llega cada tipo de aviso |
| `RESUMEN_A` | texto | número de detal | Números (separados por comas) que reciben el resumen diario |
| `HORARIO` | texto | `L-V 08:00-18:00; S 08:00-13:00` | Si se define, el bot sabe si la tienda está abierta |
| `BOT_MODO` | texto | `on` | `off` para que el bot solo guarde mensajes sin responder |
| `PAUSA_HUMANO_HORAS` | texto | `12` | Horas que el bot se aparta cuando responde una persona |
| `ADMIN_TOKEN` | secreto | — | Activa `/api/whatsapp/stats` |
| `ALERTA_PLANTILLA`, `RESUMEN_PLANTILLA`, `PLANTILLA_IDIOMA` | texto | `alerta_asesor`, `resumen_diario`, `es` | Solo si cambian los nombres de las plantillas |

> Si el bot usa el mismo número que un asesor (coexistencia en el 321…), los avisos de ese asesor deben ir a **otro** móvil: un número no puede escribirse a sí mismo.

### Comandos del equipo

Los números de `ASESORES` y `RESUMEN_A` pueden escribir al número del bot:

- `pausa 3101234567`: el bot deja de responder a ese cliente durante 12 h.
- `activa 3101234567`: el bot vuelve a responderle.
- `resumen`: actividad del día.

### Comprobar que funciona

- `GET /api/whatsapp/health` → qué está configurado (sin datos sensibles).
- `GET /api/whatsapp/stats?dias=7` con `Authorization: Bearer <ADMIN_TOKEN>` → conversaciones, respuestas y avisos.

### Pruebas del bot

Simulan Meta y Claude en local y recorren 35 casos (firma, duplicados, ráfagas, escalado, pausa por humano, comandos, fotos, audios, fallos, cron y regresión del chat web):

```bash
grep -v '"ai": { "binding": "AI" }' wrangler.jsonc > wrangler.test.jsonc   # Workers AI no corre en local
npx wrangler d1 migrations apply la-reina-del-pvc-bot --local -c wrangler.test.jsonc
node tests/whatsapp/mocks.mjs /tmp/mocks.log &
# .dev.vars: ANTHROPIC_BASE_URL=http://127.0.0.1:9999, WHATSAPP_GRAPH_URL=http://127.0.0.1:9998,
#            WHATSAPP_APP_SECRET=app-secret-test, WHATSAPP_VERIFY_TOKEN=verify-test, WHATSAPP_PHONE_NUMBER_ID=PHONEID,
#            WHATSAPP_TOKEN=x, ANTHROPIC_API_KEY=x, ADMIN_TOKEN=adm-test, HORARIO=L-V 08:00-18:00,
#            ASESORES={"detal":"573000000001","mayor":"573000000002","spc":"573000000001"}, RESUMEN_A=573000000009
npx wrangler dev -c wrangler.test.jsonc --test-scheduled &
node tests/whatsapp/e2e.mjs /tmp/mocks.log
```

### Privacidad del bot

Las conversaciones se guardan en D1 para dar contexto al bot y se borran a los 90 días. Hay que mencionarlo en la política de privacidad de la web (Ley 1581 de 2012 de Colombia).
