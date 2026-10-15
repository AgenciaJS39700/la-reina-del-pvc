# La Reina del PVC

Web estática de catálogo y simulador 3D de pared/piso para **La Reina del PVC** (Pereira, Colombia). Desplegada como Cloudflare Worker con static assets.

- `index.html`, `styles.css`, `app.js`: sitio (vanilla JS, mobile-first).
- `data.js`: catálogo (productos, modelos, precios, stock) y enlaces de WhatsApp.
- `img/`: fotos extraídas de los catálogos de Canva (webp).
- `chat.js`, `chat.css`: widget del asistente IA.
- `worker/`: backend del asistente (`/api/chat`), no se publica como asset.
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
