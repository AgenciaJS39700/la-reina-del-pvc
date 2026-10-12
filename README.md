# La Reina del PVC

Web estática de catálogo y simulador 3D de pared/piso para **La Reina del PVC** (Pereira, Colombia). Desplegada como Cloudflare Worker con static assets.

- `index.html`, `styles.css`, `app.js`: sitio (vanilla JS, mobile-first).
- `data.js`: catálogo (productos, modelos, precios, stock) y enlaces de WhatsApp.
- `img/`: fotos extraídas de los catálogos de Canva (webp).
- `wrangler.jsonc`: configuración de Cloudflare.

Despliegue: Cloudflare → Workers & Pages → Import repository.
