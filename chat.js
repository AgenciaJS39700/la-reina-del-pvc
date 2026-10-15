// /chat.js — Asistente IA de La Reina del PVC (widget). Vanilla JS, sin dependencias.
// Solo se muestra si el backend tiene la API configurada (/api/chat/health).
(function () {
  "use strict";
  var KEY = "rpvc-chat-v1", MAX_KEEP = 24, TIMEOUT = 30000;
  var WELCOME = "¡Hola! Soy el asistente de La Reina del PVC. Te ayudo a elegir producto, calcular cuántas láminas o rollos necesitas y te paso con un asesor. ¿Qué espacio quieres renovar?";
  var CHIPS = ["¿Cuántas láminas WPC necesito?", "Precios de paneles 3D", "Quiero comprar al por mayor"];
  var WA = { url: "https://wa.me/573218911231?text=" + encodeURIComponent("Hola, quiero cotizar productos de La Reina del PVC"), label: "Escribir por WhatsApp" };

  var state = { msgs: [], busy: false, open: false };
  var els = {};

  function load() {
    try { var s = JSON.parse(sessionStorage.getItem(KEY) || "[]"); if (Array.isArray(s)) state.msgs = s; } catch (e) { state.msgs = []; }
  }
  function save() {
    try { sessionStorage.setItem(KEY, JSON.stringify(state.msgs.slice(-MAX_KEEP))); } catch (e) { /* almacenamiento no disponible */ }
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n;
  }
  function safeActions(list) {
    return (Array.isArray(list) ? list : []).filter(function (a) {
      return a && typeof a.url === "string" && /^https:\/\/wa\.me\//.test(a.url) && typeof a.label === "string";
    }).slice(0, 3);
  }

  function renderMsg(m) {
    var row = el("div", "cb-msg " + (m.role === "user" ? "me" : "bot"));
    row.appendChild(el("p", null, m.content));
    var acts = safeActions(m.actions);
    if (acts.length) {
      var box = el("div", "cb-acts");
      acts.forEach(function (a) {
        var b = el("a", "btn gold sm", a.label); b.href = a.url; b.target = "_blank"; b.rel = "noopener"; box.appendChild(b);
      });
      row.appendChild(box);
    }
    return row;
  }

  function render() {
    var log = els.log; log.textContent = "";
    log.appendChild(renderMsg({ role: "assistant", content: WELCOME }));
    state.msgs.forEach(function (m) { log.appendChild(renderMsg(m)); });
    if (state.busy) {
      var t = el("div", "cb-msg bot cb-typing"); t.setAttribute("aria-label", "Escribiendo");
      t.appendChild(el("span")); t.appendChild(el("span")); t.appendChild(el("span")); log.appendChild(t);
    }
    els.chips.hidden = state.msgs.length > 0;
    els.input.disabled = state.busy; els.send.disabled = state.busy;
    log.scrollTop = log.scrollHeight;
  }

  function send(text) {
    text = (text || "").trim();
    if (!text || state.busy) return;
    state.msgs.push({ role: "user", content: text.slice(0, 1200) });
    state.busy = true; save(); render();
    var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
    var payload = state.msgs.slice(-12).map(function (m) { return { role: m.role, content: m.content }; });
    fetch("/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: payload }), signal: ctrl.signal, credentials: "same-origin"
    }).then(function (r) {
      return r.json().catch(function () { return {}; });
    }).then(function (d) {
      var reply = typeof d.reply === "string" && d.reply ? d.reply : "Ahora mismo no puedo responder. Escríbenos por WhatsApp y un asesor te atiende.";
      var acts = safeActions(d.actions); if (!d.reply && !acts.length) acts = [WA];
      state.msgs.push({ role: "assistant", content: reply, actions: acts });
    }).catch(function () {
      state.msgs.push({ role: "assistant", content: "Se cortó la conexión. Inténtalo de nuevo o escríbenos por WhatsApp.", actions: [WA] });
    }).then(function () {
      clearTimeout(timer); state.busy = false; save(); render(); els.input.focus();
    });
  }

  function setOpen(open) {
    state.open = open;
    els.panel.hidden = !open;
    els.btn.setAttribute("aria-expanded", String(open));
    document.documentElement.classList.toggle("cb-open", open);
    if (open) { render(); setTimeout(function () { els.input.focus(); }, 30); } else { els.btn.focus(); }
  }

  function build() {
    var btn = el("button", "cb-btn"); btn.type = "button";
    btn.setAttribute("aria-controls", "cbPanel"); btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "Abrir asistente virtual");
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3c-5 0-9 3.4-9 7.6 0 2.3 1.2 4.4 3.2 5.8L5.5 21l4.4-2.5c.7.1 1.4.2 2.1.2 5 0 9-3.4 9-7.6S17 3 12 3zm-4 9.2a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6z"/></svg><span>Pregúntanos</span>';

    var panel = el("section", "cb-panel"); panel.id = "cbPanel"; panel.hidden = true;
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Asistente virtual de La Reina del PVC");
    var head = el("header", "cb-head");
    var ttl = el("div", "cb-ttl"); ttl.appendChild(el("b", null, "Asistente virtual")); ttl.appendChild(el("small", null, "La Reina del PVC · responde al instante"));
    var x = el("button", "cb-x", "×"); x.type = "button"; x.setAttribute("aria-label", "Cerrar asistente");
    head.appendChild(ttl); head.appendChild(x);

    var log = el("div", "cb-log"); log.setAttribute("role", "log"); log.setAttribute("aria-live", "polite");
    var chips = el("div", "cb-chips");
    CHIPS.forEach(function (c) { var b = el("button", "cb-chip", c); b.type = "button"; b.addEventListener("click", function () { send(c); }); chips.appendChild(b); });

    var form = el("form", "cb-form");
    var input = el("input"); input.type = "text"; input.maxLength = 1200; input.autocomplete = "off";
    input.placeholder = "Escribe tu pregunta…"; input.setAttribute("aria-label", "Tu mensaje");
    var sendBtn = el("button", "btn gold sm", "Enviar"); sendBtn.type = "submit";
    form.appendChild(input); form.appendChild(sendBtn);
    var fine = el("p", "cb-fine", "Asistente con IA: puede equivocarse. Precios y disponibilidad los confirma un asesor. No compartas datos sensibles.");

    panel.appendChild(head); panel.appendChild(log); panel.appendChild(chips); panel.appendChild(form); panel.appendChild(fine);
    document.body.appendChild(btn); document.body.appendChild(panel);

    els = { btn: btn, panel: panel, log: log, chips: chips, input: input, send: sendBtn };
    btn.addEventListener("click", function () { setOpen(!state.open); });
    x.addEventListener("click", function () { setOpen(false); });
    panel.addEventListener("keydown", function (e) { if (e.key === "Escape") setOpen(false); });
    form.addEventListener("submit", function (e) { e.preventDefault(); var v = input.value; input.value = ""; send(v); });
  }

  function init() {
    fetch("/api/chat/health", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : { enabled: false }; })
      .then(function (d) { if (d && d.enabled) { load(); build(); } })
      .catch(function () { /* sin asistente: la web sigue funcionando igual */ });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
