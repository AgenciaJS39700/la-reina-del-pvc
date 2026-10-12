// /app.js — catálogo, visor de producto y simulador 3D de pared/piso
(function () {
  "use strict";
  var D = window.PVC, REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function cop(n) { return "$" + Math.round(n).toLocaleString("es-CO"); }
  function m(n) { return String(Math.round(n * 10) / 10).replace(".", ","); }
  function norm(s) { return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function wa(text) { return D.wa.detal + "?text=" + encodeURIComponent(text); }
  function byId(id) { for (var i = 0; i < D.items.length; i++) if (D.items[i].id === id) return D.items[i]; }
  function stockTxt(v) { return v.stock === "agotado" ? "Agotado" : (v.stock ? v.stock + " uds" : ""); }

  /* ------------------------------------------------------------ catálogo */
  var grid = $("#grid"), tabs = $("#tabs"), q = $("#q"), count = $("#count"), empty = $("#empty");
  var cat = { cat: "all", q: "" };

  function card(it) {
    var c = el("article", "card");
    var open = el("button", "open"); open.type = "button"; open.setAttribute("aria-label", "Ver fotos y modelos de " + it.name);
    var ph = el("div", "ph" + (it.cat === "accesorios" ? " contain" : "")); ph.appendChild(el("div", "fx " + it.tone));
    if (it.img) {
      var img = new Image(); img.alt = ""; img.loading = "lazy"; img.decoding = "async"; img.width = 560; img.height = 420;
      var fx = ph.firstChild; img.onload = function () { fx.remove(); }; img.onerror = function () { img.remove(); }; img.src = it.img; ph.insertBefore(img, fx);
    }
    var pt = el("span", "price-tag", it.price == null ? "Consultar precio" : (it.unit === "desde" ? "Desde " : "") + cop(it.price));
    if (it.price != null && it.unit && it.unit !== "desde") pt.appendChild(el("small", null, " / " + it.unit));
    ph.appendChild(pt);
    if (it.variants) ph.appendChild(el("span", "badge", it.variants.length + " modelos"));
    open.appendChild(ph); open.addEventListener("click", function () { openViewer(it, 0); });
    c.appendChild(open); c.classList.add("click"); c.addEventListener("click", function (e) { if (!e.target.closest("a,button")) openViewer(it, 0); });
    var bd = el("div", "bd");
    bd.appendChild(el("h3", null, it.name));
    bd.appendChild(el("p", "spec", it.spec));
    bd.appendChild(el("p", null, it.desc));
    if (it.tags && it.tags.length) { var ul = el("ul", "tg"); it.tags.forEach(function (t) { ul.appendChild(el("li", null, t)); }); bd.appendChild(ul); }
    if (it.variants_prices) {
      var vr = el("ul", "vr"); it.variants_prices.forEach(function (v) { var li = el("li"); li.appendChild(el("span", null, v[0])); li.appendChild(el("b", null, cop(v[1]))); vr.appendChild(li); }); bd.appendChild(vr);
    }
    var acts = el("div", "acts");
    var b1 = el("button", "btn gold", it.variants ? "Ver modelos" : "Ver fotos"); b1.type = "button"; b1.addEventListener("click", function () { openViewer(it, 0); });
    var b2 = el("a", "btn cat", "Cotizar"); b2.href = wa("Hola, quiero información sobre: " + it.name + " (" + it.spec + ")."); b2.rel = "noopener"; b2.setAttribute("aria-label", "Cotizar " + it.name + " por WhatsApp");
    acts.appendChild(b1); acts.appendChild(b2); bd.appendChild(acts); c.appendChild(bd);
    return c;
  }
  function renderCatalog() {
    var nq = norm(cat.q.trim());
    var list = D.items.filter(function (it) {
      if (cat.cat !== "all" && it.cat !== cat.cat) return false;
      if (!nq) return true;
      var hay = norm([it.name, it.spec, it.desc, (it.tags || []).join(" "), (it.variants || []).map(function (v) { return v.name; }).join(" ")].join(" "));
      return nq.split(/\s+/).every(function (w) { return hay.indexOf(w) > -1; });
    });
    grid.textContent = ""; list.forEach(function (it) { grid.appendChild(card(it)); });
    count.textContent = list.length + (list.length === 1 ? " producto" : " productos"); empty.hidden = list.length > 0;
  }
  [{ id: "all", name: "Todo" }].concat(D.cats).forEach(function (c) {
    var b = el("button", "tab", c.name); b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", c.id === cat.cat ? "true" : "false");
    b.addEventListener("click", function () { cat.cat = c.id; Array.prototype.forEach.call(tabs.children, function (t) { t.setAttribute("aria-selected", t === b ? "true" : "false"); }); renderCatalog(); });
    tabs.appendChild(b);
  });
  var STY = [["Mármol", "mármol"], ["Madera", "madera"], ["Piedra", "piedra"], ["Textura", "textura"], ["3D", "3d"], ["Para piso", "piso"]], sbox = $("#styles");
  function syncStyles() { Array.prototype.forEach.call(sbox.children, function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-q") === norm(cat.q.trim()) ? "true" : "false"); }); }
  STY.forEach(function (x) { var b = el("button", null, x[0]); b.type = "button"; b.setAttribute("data-q", norm(x[1])); b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", function () { var on = b.getAttribute("aria-pressed") === "true"; cat.q = on ? "" : x[1]; q.value = cat.q; syncStyles(); renderCatalog(); }); sbox.appendChild(b); });
  q.addEventListener("input", function () { cat.q = q.value; syncStyles(); renderCatalog(); });
  renderCatalog();

  /* ------------------------------------------------------------ visor */
  var V = { it: null, vi: 0, gi: 0 }, dlg = $("#viewer"), vMain = $("#vMain"), vImg = $("#vImg");
  function gallery() {
    var it = V.it, v = it.variants && it.variants[V.vi], g = [];
    if (v) { (v.rooms && v.rooms.length ? v.rooms : [v.img]).forEach(function (s) { if (s) g.push(s); }); }
    else (it.rooms && it.rooms.length ? it.rooms : [it.img]).forEach(function (s) { if (s) g.push(s); });
    return g;
  }
  function varBtn(v, i, sel, onPick, useTex) {
    var b = el("button", "vb" + (v.stock === "agotado" ? " out" : "")); b.type = "button"; b.setAttribute("role", "option"); b.setAttribute("aria-selected", sel ? "true" : "false"); b.title = v.name;
    var im = new Image(); im.alt = ""; im.loading = "lazy"; im.decoding = "async"; im.src = (useTex && v.tex) || v.img; b.appendChild(im);
    b.appendChild(el("span", "tg2", v.name + (typeof v.stock === "number" ? " · " + v.stock + " uds" : "")));
    b.setAttribute("aria-label", v.name + (v.stock ? ", " + stockTxt(v) : "")); b.addEventListener("click", function () { onPick(i); }); return b;
  }
  function paintViewer() {
    var it = V.it, v = it.variants && it.variants[V.vi], g = gallery();
    if (V.gi >= g.length) V.gi = 0;
    vImg.src = g[V.gi] || it.img || ""; vImg.alt = it.name + (v ? " — " + v.name : "");
    vMain.classList.remove("zoom");
    var th = $("#vThumbs"); th.textContent = "";
    g.forEach(function (s, i) {
      var b = el("button"); b.type = "button"; b.setAttribute("aria-label", "Foto " + (i + 1)); if (i === V.gi) b.setAttribute("aria-current", "true");
      var im = new Image(); im.alt = ""; im.src = s; b.appendChild(im); b.addEventListener("click", function () { V.gi = i; paintViewer(); }); th.appendChild(b);
    });
    th.hidden = g.length < 2;
    var price = v && v.price ? v.price : it.price, pe = $("#vPrice"); pe.textContent = "";
    if (price == null) pe.textContent = "Consultar precio"; else { pe.appendChild(document.createTextNode((it.unit === "desde" && !v ? "Desde " : "") + cop(price))); if (it.unit && it.unit !== "desde") { var s = el("small", null, " / " + it.unit); pe.appendChild(s); } }
    var cname = (D.cats.filter(function (c) { return c.id === it.cat; })[0] || {}).name || "";
    $("#vCat").textContent = cname; $("#vTitle").textContent = it.name + (v ? " · " + v.name : "");
    $("#vSpec").textContent = it.spec + (v && v.stock ? " · " + (v.stock === "agotado" ? "Agotado según catálogo" : v.stock + " unidades según catálogo") : "");
    $("#vDesc").textContent = it.desc;
    var vr = $("#vVr"); vr.textContent = ""; (it.variants_prices || []).forEach(function (p) { var li = el("li"); li.appendChild(el("span", null, p[0])); li.appendChild(el("b", null, cop(p[1]))); vr.appendChild(li); });
    var vt = $("#vTg"); vt.textContent = ""; (it.tags || []).forEach(function (t) { vt.appendChild(el("li", null, t)); });
    var box = $("#vVarsBox"), vars = $("#vVars"); vars.textContent = "";
    if (it.variants) { box.hidden = false; it.variants.forEach(function (x, i) { vars.appendChild(varBtn(x, i, i === V.vi, function (k) { V.vi = k; V.gi = 0; paintViewer(); }, true)); }); } else box.hidden = true;
    $("#vWa").href = wa("Hola, quiero cotizar: " + it.name + (v ? " (" + v.name + ")" : "") + " · " + it.spec + ".");
    var sb = $("#vSim"); sb.hidden = !(it.sim); $("#vCatalog").href = it.catalog;
  }
  function openViewer(it, vi) {
    V.it = it; V.vi = vi || 0; V.gi = 0; paintViewer();
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    document.body.classList.add("lock");
  }
  function closeViewer() { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); }
  dlg.addEventListener("close", function () { document.body.classList.remove("lock"); });
  $("#vClose").addEventListener("click", closeViewer);
  dlg.addEventListener("click", function (e) { if (e.target === dlg) closeViewer(); });
  vMain.addEventListener("click", function () { vMain.classList.toggle("zoom"); });
  vMain.addEventListener("pointermove", function (e) {
    if (!vMain.classList.contains("zoom")) return; var r = vMain.getBoundingClientRect();
    vMain.style.setProperty("--ox", ((e.clientX - r.left) / r.width * 100) + "%"); vMain.style.setProperty("--oy", ((e.clientY - r.top) / r.height * 100) + "%");
  });
  $("#vSim").addEventListener("click", function () { var it = V.it, vi = V.vi; closeViewer(); selectSim(it.id, vi, true); });

  /* ------------------------------------------------------------ simulador */
  var SIMS = D.items.filter(function (i) { return i.sim; });
  var S = { id: SIMS[0].id, env: "sala", vi: 0, mode: "full", W: 3.2, H: 2.5, fw: 2.4, fd: 3.0, yaw: -16, pitch: 2, tyaw: -16, tpitch: 2, idle: !REDUCED, running: false, vis: false };
  var stage = $("#stage"), room = $("#room"), scene = $("#scene"), cover = $("#cover"), seams = $("#seams"), rug = $("#rug"), fBack = $("#fBack"), fFloor = $("#fFloor");
  var inW = $("#inW"), inH = $("#inH"), outW = $("#outW"), outH = $("#outH"), quote = $("#quote");
  var G = { u: 150 }, sides = ["cvL", "smL", "cvR", "smR"].map(function (i) { return $("#" + i); });

  function SOFA() { return '<svg viewBox="0 0 300 120" preserveAspectRatio="none"><defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eadfc9"/><stop offset="1" stop-color="#cdbd9f"/></linearGradient></defs><rect x="14" y="22" width="272" height="66" rx="18" fill="url(#g1)"/><rect x="0" y="40" width="42" height="66" rx="15" fill="#d3c3a6"/><rect x="258" y="40" width="42" height="66" rx="15" fill="#d3c3a6"/><rect x="30" y="60" width="240" height="42" rx="13" fill="#e2d5bb"/><rect x="42" y="34" width="106" height="44" rx="13" fill="#efe5d1"/><rect x="152" y="34" width="106" height="44" rx="13" fill="#efe5d1"/><rect x="52" y="48" width="38" height="34" rx="9" fill="#b98b55"/><rect x="208" y="50" width="40" height="32" rx="9" fill="#8d9b84"/><rect x="34" y="104" width="10" height="14" rx="3" fill="#4d3a27"/><rect x="256" y="104" width="10" height="14" rx="3" fill="#4d3a27"/></svg>'; }
  function TABLE() { return '<svg viewBox="0 0 120 52" preserveAspectRatio="none"><rect x="0" y="6" width="120" height="9" rx="4" fill="#3c2f22"/><rect x="12" y="15" width="6" height="36" fill="#2b2118"/><rect x="102" y="15" width="6" height="36" fill="#2b2118"/><ellipse cx="42" cy="4" rx="12" ry="4" fill="#d9a93b"/><rect x="72" y="0" width="22" height="6" rx="2" fill="#e9e1d0"/></svg>'; }
  function PLANT() { return '<svg viewBox="0 0 80 170" preserveAspectRatio="none"><path d="M40 112C20 90 8 60 14 24c18 14 28 44 26 88z" fill="#4f7a49"/><path d="M40 112C60 86 74 56 66 18c-18 16-28 48-26 94z" fill="#5e8d56"/><path d="M40 112C34 80 38 44 40 6c8 34 8 70 0 106z" fill="#6a9b60"/><path d="M26 124h28l-5 44H31z" fill="#b5835a"/><rect x="24" y="118" width="32" height="9" rx="3" fill="#c79566"/></svg>'; }
  function LAMP() { return '<svg viewBox="0 0 60 200" preserveAspectRatio="none"><path d="M12 6h36l8 40H4z" fill="#f3e8cf"/><rect x="28" y="46" width="4" height="140" fill="#2f2a22"/><ellipse cx="30" cy="190" rx="16" ry="6" fill="#2f2a22"/></svg>'; }
  /* ---- ambientes: muebles dibujados en SVG (unidades en cm; el elemento se escala a metros) ---- */
  var ENVS = {
    sala: { name: "Sala", W: 3.2, H: 2.5, mode0: "full", modes: [["full", "Pared completa"], ["accent", "Pared de acento"], ["half", "Media pared"]] },
    tv: { name: "Sala con TV", W: 3.8, H: 2.6, mode0: "accent", cls: "env-tv", accent: 0.8, modes: [["accent", "Pared de la TV"], ["full", "Pared completa"], ["half", "Media pared"]] },
    bano: { name: "Baño", W: 2.4, H: 2.4, mode0: "full", cls: "env-bano", hint: "En zonas con agua directa (ducha), confirma con tu asesor qué producto es el indicado.", modes: [["full", "Pared completa"], ["all", "Todas las paredes"], ["half", "Media pared"]] },
    cocina: { name: "Cocina", W: 3.2, H: 2.5, mode0: "all", cls: "env-cocina", hint: "Cerca del fuego o de zonas muy calientes, confirma con tu asesor qué producto es el indicado.", modes: [["all", "Todas las paredes"], ["full", "Pared del fondo"], ["splash", "Salpicadero"]] }
  };
  function rn(n) { return Math.round(n); }
  function TV() { return '<svg viewBox="0 0 125 72" preserveAspectRatio="none"><defs><linearGradient id="tvsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9c4d2"/><stop offset="1" stop-color="#6b7889"/></linearGradient></defs><rect width="125" height="72" rx="1.5" fill="#09090b"/><rect x="1.4" y="1.4" width="122.2" height="69.2" fill="url(#tvsky)"/><path d="M1.4 56L26 34l14 10 24-24 20 20 14-9 24.6 22v23.6H1.4z" fill="#3c4756"/><path d="M1.4 62c20-6 40-2 60-6s44-3 62.2 2v12.6H1.4z" fill="#e8edf3" opacity=".35"/><path d="M1.4 70.6L1.4 62l8-4 6 12.6z" fill="#1f2630"/><path d="M1.4 1.4h56L26 70.6H1.4z" fill="#fff" opacity=".08"/></svg>'; }
  function DECOR(wm) {
    var w = rn(wm * 100), p = function (f) { return rn(w * f); };
    return '<svg viewBox="0 0 ' + w + ' 30" preserveAspectRatio="none"><rect x="' + p(0.3) + '" y="24" width="' + rn(Math.min(80, w * 0.34)) + '" height="6" rx="1.5" fill="#17171a"/><rect x="' + p(0.1) + '" y="14" width="11" height="16" rx="2" fill="#c9a25a" fill-opacity=".85"/><path d="M' + (p(0.1) + 5.5) + ' 14c-2-3 0-5 0-7 2 2 2 4 0 7z" fill="#ffd27a"/><path d="M' + (p(0.84) + 6) + ' 30c-9-2-10-12-5-18l-1-9h12l-1 9c5 6 4 16-5 18z" fill="#a8742f"/><path d="M' + (p(0.84) + 6) + ' 3c-4-3-10-1-12 3M' + (p(0.84) + 6) + ' 3c3-5 9-4 13-1" stroke="#7a4f22" stroke-width="1.2" fill="none"/><circle cx="' + p(0.72) + '" cy="25" r="4" fill="none" stroke="#d9b36a" stroke-width="1.6"/><rect x="' + p(0.63) + '" y="28" width="9" height="2" rx="1" fill="#2a2a2e"/></svg>';
  }
  function CONSOLE(wm) {
    var w = rn(wm * 100), n = Math.max(2, rn(w / 60)), dw = w / n, s = '<svg viewBox="0 0 ' + w + ' 36" preserveAspectRatio="none"><rect width="' + w + '" height="36" fill="#3b2a22"/>';
    for (var i = 0; i < n; i++) s += '<rect x="' + (i * dw + 1) + '" y="3" width="' + (dw - 2) + '" height="31" fill="#4a362b"/><path d="M' + (i * dw + 6) + ' 12h' + (dw - 12) + 'M' + (i * dw + 4) + ' 20h' + (dw - 8) + 'M' + (i * dw + 8) + ' 27h' + (dw - 16) + '" stroke="#2f211a" stroke-width=".8" opacity=".7"/><rect x="' + (i * dw + dw / 2 - 8) + '" y="5" width="16" height="1.4" rx=".7" fill="#1f1510"/>';
    return s + '</svg>';
  }
  function LED(wm) { return '<svg viewBox="0 0 100 20" preserveAspectRatio="none"><defs><linearGradient id="ledg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd9a0" stop-opacity=".85"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/></linearGradient></defs><rect width="100" height="20" fill="url(#ledg)"/></svg>'; }
  function TOILET() { return '<svg viewBox="0 0 40 78" preserveAspectRatio="none"><rect x="7" y="0" width="26" height="32" rx="4" fill="#f5f2ec"/><rect x="7" y="0" width="26" height="4" rx="2" fill="#e2ddd1"/><circle cx="20" cy="10" r="2.4" fill="#cfc8ba"/><path d="M4 34h32c0 14-3 24-9 28v10H13V62C7 58 4 48 4 34z" fill="#f8f6f1"/><path d="M4 34h32v4H4z" fill="#e4dfd3"/><rect x="13" y="72" width="14" height="6" fill="#e4dfd3"/></svg>'; }
  function VANITY(wm) {
    var w = rn(wm * 100);
    return '<svg viewBox="0 0 ' + w + ' 84" preserveAspectRatio="none"><rect width="' + w + '" height="78" fill="#8d6a4a"/><rect x="3" y="4" width="' + (w / 2 - 4) + '" height="70" fill="#7b5a3d"/><rect x="' + (w / 2 + 1) + '" y="4" width="' + (w / 2 - 4) + '" height="70" fill="#7b5a3d"/><rect x="' + (w / 2 - 8) + '" y="8" width="6" height="2" fill="#d9b36a"/><rect x="' + (w / 2 + 2) + '" y="8" width="6" height="2" fill="#d9b36a"/><rect x="4" y="78" width="' + (w - 8) + '" height="6" fill="#33291f"/></svg>';
  }
  function BASIN() { return '<svg viewBox="0 0 50 34" preserveAspectRatio="none"><rect x="23.5" y="2" width="3" height="14" fill="#cfd2d6"/><rect x="23.5" y="2" width="12" height="3" rx="1.5" fill="#cfd2d6"/><path d="M5 16h40c0 10-8 17-20 17S5 26 5 16z" fill="#f7f5f0"/><rect x="4" y="14" width="42" height="3" rx="1.5" fill="#fff"/></svg>'; }
  function MIRROR() { return '<svg viewBox="0 0 62 62" preserveAspectRatio="none"><defs><linearGradient id="mrg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e4f2f8"/><stop offset="1" stop-color="#9fc3d3"/></linearGradient></defs><circle cx="31" cy="31" r="29.5" fill="url(#mrg)" stroke="#d9b36a" stroke-width="2.5"/><path d="M14 22a20 20 0 0 1 14-10" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".7"/></svg>'; }
  function SHELF() { return '<svg viewBox="0 0 50 30" preserveAspectRatio="none"><rect y="25" width="50" height="3" rx="1" fill="#9a6c43"/><rect x="4" y="8" width="22" height="17" rx="2" fill="#c98f6b"/><rect x="4" y="14" width="22" height="1.5" fill="#e0b494"/><rect x="4" y="19" width="22" height="1.5" fill="#e0b494"/><rect x="35" y="16" width="9" height="9" rx="2" fill="#e9e1d0"/><path d="M39.5 16c-5-3-6-9-4-13 5 2 7 7 4 13zM39.5 16c5-3 6-9 4-13-5 2-7 7-4 13z" fill="#5e8d56"/></svg>'; }
  function SHOWER() { return '<svg viewBox="0 0 85 200" preserveAspectRatio="none"><rect x="1" y="1" width="83" height="190" fill="#bfe1f0" fill-opacity=".16" stroke="#26262b" stroke-width="2.5"/><path d="M60 1v190" stroke="#26262b" stroke-width="1.5"/><rect x="53" y="95" width="2.6" height="30" rx="1.3" fill="#cfd2d6"/><path d="M10 1v22h16" stroke="#cfd2d6" stroke-width="3" fill="none"/><ellipse cx="32" cy="25" rx="10" ry="3" fill="#cfd2d6"/><path d="M26 30l-3 24M32 30v26M38 30l3 24" stroke="#9fd0e8" stroke-width="1.4" opacity=".5"/><rect y="190" width="85" height="10" fill="#e8e3d8"/></svg>'; }
  function COUNTER(wm) {
    var w = rn(wm * 100), n = Math.max(1, rn(w / 50)), dw = (w - 2) / n, s = '<svg viewBox="0 0 ' + w + ' 90" preserveAspectRatio="none"><rect width="' + w + '" height="4" fill="#35353a"/><rect y="4" width="' + w + '" height="82" fill="#a9784b"/>';
    for (var i = 0; i < n; i++) s += '<rect x="' + (1 + i * dw + 1.5) + '" y="8" width="' + (dw - 3) + '" height="72" rx="1" fill="#b88858"/><rect x="' + (1 + i * dw + dw / 2 - 6) + '" y="10" width="12" height="2" rx="1" fill="#e2c27a"/>';
    return s + '<rect x="2" y="86" width="' + (w - 4) + '" height="4" fill="#2a221b"/></svg>';
  }
  function FAUCET() { return '<svg viewBox="0 0 30 26" preserveAspectRatio="none"><path d="M4 26V9q0-6 7-6h12" stroke="#cfd2d6" stroke-width="3" fill="none" stroke-linecap="round"/><rect x="22" y="3" width="3" height="4" fill="#cfd2d6"/></svg>'; }
  function STOVE() { return '<svg viewBox="0 0 60 90" preserveAspectRatio="none"><rect width="60" height="90" rx="2" fill="#d6d9de"/><rect width="60" height="14" fill="#b8bcc2"/><circle cx="9" cy="8" r="3" fill="#2a2a2e"/><circle cx="23" cy="8" r="3" fill="#2a2a2e"/><circle cx="37" cy="8" r="3" fill="#2a2a2e"/><circle cx="51" cy="8" r="3" fill="#2a2a2e"/><rect x="4" y="18" width="52" height="58" rx="2" fill="#b5b9bf"/><rect x="9" y="26" width="42" height="36" rx="2" fill="#17171a"/><path d="M9 26h20L16 62H9z" fill="#fff" opacity=".08"/><rect x="8" y="20" width="44" height="3" rx="1.5" fill="#e8eaee"/><rect x="4" y="78" width="52" height="10" fill="#a8acb2"/></svg>'; }
  function POT() { return '<svg viewBox="0 0 40 30" preserveAspectRatio="none"><rect x="5" y="9" width="30" height="19" rx="2" fill="#b9bdc3"/><rect x="3" y="6" width="34" height="4" rx="2" fill="#9ea3aa"/><rect x="18" y="3" width="4" height="3" rx="1" fill="#2a2a2e"/><path d="M14 0c-3 3 3 5 0 8M26 0c-3 3 3 5 0 8" stroke="#fff" stroke-width="1.2" fill="none" opacity=".4"/></svg>'; }
  function HOOD(hm) { var h = rn(hm * 100); return '<svg viewBox="0 0 60 ' + h + '" preserveAspectRatio="none"><rect x="20" y="0" width="20" height="' + (h - 34) + '" fill="#c9ccd1"/><path d="M2 ' + h + 'L18 ' + (h - 34) + 'H42L58 ' + h + 'Z" fill="#b6bac0"/><rect x="6" y="' + (h - 4) + '" width="48" height="2" fill="#fff" opacity=".6"/></svg>'; }
  function UPPERS(wm, hm) {
    var w = rn(wm * 100), h = rn(hm * 100), n = Math.max(1, rn(w / 45)), dw = w / n, s = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><rect width="' + w + '" height="' + h + '" fill="#a9784b"/>';
    for (var i = 0; i < n; i++) s += '<rect x="' + (i * dw + 2) + '" y="2" width="' + (dw - 4) + '" height="' + (h - 4) + '" rx="1" fill="#b88858"/><rect x="' + (i * dw + dw / 2 - 5) + '" y="' + (h - 9) + '" width="10" height="2" rx="1" fill="#e2c27a"/>';
    return s + '</svg>';
  }
  function FRIDGE() { return '<svg viewBox="0 0 72 175" preserveAspectRatio="none"><defs><linearGradient id="frg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#bfc3c9"/><stop offset=".5" stop-color="#e4e7eb"/><stop offset="1" stop-color="#b3b7bd"/></linearGradient></defs><rect width="72" height="175" rx="3" fill="url(#frg)"/><rect y="55" width="72" height="2" fill="#8f949b"/><rect x="60" y="12" width="3" height="30" rx="1.5" fill="#4a4d53"/><rect x="60" y="68" width="3" height="50" rx="1.5" fill="#4a4d53"/><rect x="6" y="168" width="60" height="7" fill="#7e8389"/></svg>'; }

  function line() { return byId(S.id); }
  function variant() { return line().variants[S.vi]; }

  var PR = {}, used = {};
  function mk(key, cls) {
    var p = PR[key];
    if (!p) { var d = document.createElement("div"); d.className = "prop " + cls; if (cls === "bx") d.innerHTML = '<div class="f"></div><div class="t"></div><div class="b"></div><div class="l"></div><div class="r"></div>'; room.appendChild(d); p = PR[key] = { el: d, svg: "" }; }
    used[key] = 1; p.el.style.display = "block"; return p;
  }
  function setSvg(p, node, svg) { if (p.svg !== svg) { node.innerHTML = svg; p.svg = svg; } }
  // billboard: siempre de cara a la cámara (muebles pequeños y volúmenes sueltos: plantas, lámparas, sofá…)
  function put(key, wm, hm, x, z, y, svg) {
    var p = mk(key, "bb"), e = p.el, u = G.u, w = wm * u, h = hm * u;
    setSvg(p, e, svg);
    e.style.width = w + "px"; e.style.height = h + "px"; e.style.left = (x * u - w / 2) + "px"; e.style.top = (G.Hm * u / 2 - h - (y || 0) * u) + "px";
    e.style.transform = "translateZ(" + (z * u) + "px) rotateY(calc(var(--yaw) * -1deg)) rotateX(calc(var(--pitch) * -1deg))";
  }
  // plano rígido: gira con la habitación, paralelo a la pared (TV, espejo, campana, repisas…)
  function plane(key, wm, hm, x, z, y, svg) {
    var p = mk(key, "pl"), e = p.el, u = G.u, w = wm * u, h = hm * u;
    setSvg(p, e, svg);
    e.style.width = w + "px"; e.style.height = h + "px"; e.style.left = (x * u - w / 2) + "px"; e.style.top = (G.Hm * u / 2 - h - (y || 0) * u) + "px";
    e.style.transform = "translateZ(" + (z * u) + "px)";
  }
  // caja 3D real: frente, tapa, base y laterales; apoyada contra la pared (zFront = z del frente)
  function box(key, wm, hm, dm, x, zf, y, svg, top, side) {
    var p = mk(key, "bx"), e = p.el, u = G.u, w = wm * u, h = hm * u, d = dm * u, k = e.children;
    setSvg(p, k[0], svg);
    e.style.width = w + "px"; e.style.height = h + "px"; e.style.left = (x * u - w / 2) + "px"; e.style.top = (G.Hm * u / 2 - h - (y || 0) * u) + "px";
    e.style.transform = "translateZ(" + (zf * u) + "px)";
    k[1].style.cssText = "width:" + w + "px;height:" + d + "px;background:" + top;
    k[2].style.cssText = "width:" + w + "px;height:" + d + "px;top:" + h + "px;background:" + side;
    k[3].style.cssText = "width:" + d + "px;height:" + h + "px;background:" + side;
    k[4].style.cssText = "width:" + d + "px;height:" + h + "px;left:" + w + "px;background:" + side;
  }
  var MARBLE = "linear-gradient(115deg,#f6f4f0 0 38%,#dcd8d0 39% 40%,#f6f4f0 41% 66%,#cfcac1 67% 68%,#f6f4f0 69%)", GRANITE = "linear-gradient(115deg,#3a3a40,#2c2c31 50%,#3d3d44)", STEEL = "linear-gradient(90deg,#aeb2b8,#d8dbe0 50%,#aeb2b8)", WOOD = "#8f6440", SINK = "linear-gradient(90deg,transparent 28%,#c8ccd2 28% 72%,transparent 72%) center/100% 62% no-repeat," + "#35353a";
  function placeProps(floor, Wm, Dm) {
    used = {}; var zb = -Dm / 2, env = floor ? "sala" : S.env, Hm = G.Hm;
    if (env === "tv") {
      var rw = Math.min(2.4, Wm * 0.68), tw = Math.min(1.55, rw * 0.66), th = tw * 0.576;
      plane("tv", tw, th, 0, zb + 0.03, 0.98, TV());
      box("console", rw, 0.36, 0.4, 0, zb + 0.4, 0.34, CONSOLE(rw), MARBLE, "#3b2a22");
      plane("led", rw, 0.2, 0, zb + 0.02, 0.18, LED());
      plane("decor", rw, 0.3, 0, zb + 0.2, 0.7, DECOR(rw));
      put("plant", 0.55, 1.45, Wm / 2 - 0.45, zb + 0.4, 0, PLANT());
      put("lamp", 0.34, 1.75, -Wm / 2 + 0.4, zb + 0.45, 0, LAMP());
    } else if (env === "bano") {
      var tx = -Wm / 2 + 0.5, sx = Wm / 2 - 0.55, vL = tx + 0.25, vR = sx - 0.45, vw = Math.max(0.55, Math.min(0.9, (vR - vL) - 0.1)), vx = (vL + vR) / 2, sh = Math.min(2.0, Hm - 0.1);
      put("toilet", 0.4, 0.78, tx, zb + 0.38, 0, TOILET());
      plane("shelf", 0.5, 0.3, tx, zb + 0.04, 1.3, SHELF());
      box("vanity", vw, 0.84, 0.45, vx, zb + 0.45, 0, VANITY(vw), MARBLE, "#6f5036");
      put("basin", 0.5, 0.34, vx, zb + 0.3, 0.84, BASIN());
      plane("mirror", 0.62, 0.62, vx, zb + 0.03, 1.22, MIRROR());
      plane("shower", 0.85, sh, sx, zb + 0.6, 0, SHOWER());
    } else if (env === "cocina") {
      var fx = Wm / 2 - 0.5, free = Wm / 2 - 0.88, sxk = (-Wm / 2 + free) / 2, L = (sxk - 0.3) + Wm / 2, Rr = free - (sxk + 0.3), lx = -Wm / 2 + 0.012 + (L - 0.012) / 2, rx = free - Rr / 2, uh = Math.min(0.7, Hm - 1.55);
      box("fridge", 0.72, 1.75, 0.66, fx, zb + 0.66, 0, FRIDGE(), "#c9cdd2", STEEL);
      box("stove", 0.6, 0.9, 0.6, sxk, zb + 0.6, 0, STOVE(), STEEL, "#a9adb3");
      put("pot", 0.4, 0.3, sxk, zb + 0.32, 0.9, POT());
      if (L >= 0.3) { var L2 = L - 0.012; box("counterL", L2, 0.9, 0.6, lx, zb + 0.6, 0, COUNTER(L2), GRANITE, "#8a6038"); box("uppers", L2, uh, 0.33, lx, zb + 0.33, 1.5, UPPERS(L2, uh), "#a9784b", "#8a6038"); }
      if (Rr >= 0.3) { box("counterR", Rr, 0.9, 0.6, rx, zb + 0.6, 0, COUNTER(Rr), SINK, "#8a6038"); put("faucet", 0.3, 0.26, rx + Rr * 0.22, zb + 0.18, 0.9, FAUCET()); box("uppers2", Rr, uh, 0.33, rx, zb + 0.33, 1.5, UPPERS(Rr, uh), "#a9784b", "#8a6038"); }
      plane("hood", 0.6, Hm - 1.55, sxk, zb + 0.18, 1.55, HOOD(Hm - 1.55));
    } else {
      var sw = Math.min(2.3, Wm * 0.7);
      put("sofa", sw, sw * 0.4, 0, zb + 0.55, 0, SOFA());
      put("table", Math.min(1.0, sw * 0.45), 0.42, 0, floor ? 0.25 : zb + 1.5, 0, TABLE());
      put("plant", floor ? 0.42 : 0.55, floor ? 1.15 : 1.45, -Wm / 2 + 0.45, zb + 0.4, 0, PLANT());
      put("lamp", floor ? 0.26 : 0.34, floor ? 1.3 : 1.75, Wm / 2 - 0.4, zb + 0.45, 0, LAMP());
    }
    Object.keys(PR).forEach(function (k) { if (!used[k]) PR[k].el.style.display = "none"; });
  }

  function layout() {
    var ln = line(), sim = ln.sim, floor = !!sim.floor, r = stage.getBoundingClientRect();
    if (!r.width) return;
    var Wm = floor ? Math.max(S.fw + 1.2, 3.6) : S.W, Hm = S.H, Dm = floor ? Math.max(S.fd + 0.8, 3.4) : 3.2;
    var P = Math.max(r.width, r.height) * 1.6, u = 120, eW = Wm, eH = Hm;
    if (floor) { var ya = 22 * Math.PI / 180, pa = Math.abs(S.tpitch) * Math.PI / 180; Hm = 1.5; eW = Wm * Math.cos(ya) + Dm * Math.sin(ya); eH = Hm * Math.cos(pa) + Dm * Math.sin(pa); }
    for (var i = 0; i < 6; i++) { var s = P / (P + Dm * u / 2); u = Math.min((floor ? 0.86 : 0.9) * r.width / (eW * s), (floor ? 0.74 : 0.86) * r.height / (eH * s)); }
    G.u = u; G.Wm = Wm; G.Hm = Hm; G.Dm = Dm;
    scene.style.setProperty("--p", P + "px");
    room.style.setProperty("--w", Wm * u + "px"); room.style.setProperty("--h", Hm * u + "px"); room.style.setProperty("--d", Dm * u + "px"); room.style.setProperty("--u", u + "px");
    placeProps(floor, Wm, Dm);
    paintSurface(); labels();
  }

  function bgFor(tile, v, ln) {
    var sim = ln.sim, tex = v.tex, w, h;
    if (sim.kind === "plank") { w = sim.texW; h = sim.texW / (v.ar || 0.5); }
    else if (sim.kind === "roll") { w = sim.w; h = sim.w / (v.ar || 0.6); }
    else { w = sim.w; h = sim.h; }
    return { url: 'url("' + tex + '")', w: w / 100 * G.u, h: h / 100 * G.u, tw: w / 100 * G.u, th: h / 100 * G.u };
  }
  function seamCss(ln, b, extra) {
    var s = ln.sim, c = "rgba(20,14,6,.28)", a = [], z = [];
    if (s.kind === "tile" || s.kind === "sheet") { a.push("linear-gradient(to right," + c + " 1.5px,transparent 1.5px)", "linear-gradient(to bottom," + c + " 1.5px,transparent 1.5px)"); z.push(b.tw + "px " + b.th + "px", b.tw + "px " + b.th + "px"); }
    else if (s.kind === "roll") { a.push("linear-gradient(to right," + c + " 1.5px,transparent 1.5px)"); z.push(b.tw + "px 100%"); }
    return { img: a.join(","), size: z.join(",") };
  }

  function paintSurface() {
    var ln = line(), v = variant(), sim = ln.sim, u = G.u, b = bgFor(null, v, ln), floor = !!sim.floor, Wm = G.Wm, Hm = G.Hm;
    var painted = floor ? rug : cover;
    // reset
    cover.style.display = "none"; seams.style.display = "none"; rug.style.display = "none"; sides.forEach(function (e) { e.style.display = "none"; });
    S.rects = null;
    if (floor) {
      var rw = S.fw * u, rd = S.fd * u;
      rug.style.display = "block"; rug.style.width = rw + "px"; rug.style.height = rd + "px"; rug.style.left = (Wm * u - rw) / 2 + "px"; rug.style.top = (G.Dm * u - rd) / 2 + "px";
      var sm = seamCss(ln, b);
      rug.style.backgroundImage = (sm.img ? sm.img + "," : "") + b.url; rug.style.backgroundSize = (sm.size ? sm.size + "," : "") + b.w + "px " + b.h + "px"; rug.style.backgroundRepeat = "repeat"; rug.style.backgroundColor = "#a39a89";
      return;
    }
    var cw, ch, x0, y0;
    if (S.mode === "accent") { cw = Math.max(1.2, Wm * (ENVS[S.env].accent || 0.6)); ch = Hm; x0 = (Wm - cw) / 2; y0 = 0; }
    else if (S.mode === "half") { cw = Wm; ch = Math.min(1.1, Hm); x0 = 0; y0 = Hm - ch; }
    else if (S.mode === "splash") { cw = Wm; ch = Math.min(0.6, Hm); x0 = 0; y0 = Math.max(0, Hm - 1.5); }
    else { cw = Wm; ch = Hm; x0 = 0; y0 = 0; }
    S.rects = [{ w: cw, h: ch }];
    [cover, seams].forEach(function (e) { e.style.display = "block"; e.style.left = x0 * u + "px"; e.style.top = y0 * u + "px"; e.style.width = cw * u + "px"; e.style.height = ch * u + "px"; });
    var pos = S.mode === "half" ? "0 100%" : "0 0";
    cover.style.backgroundImage = b.url; cover.style.backgroundSize = b.w + "px " + b.h + "px"; cover.style.backgroundPosition = pos;
    var sm2 = seamCss(ln, b); seams.style.backgroundImage = sm2.img || "none"; seams.style.backgroundSize = sm2.size; seams.style.backgroundPosition = pos;
    if (S.mode === "all") {
      var dw = G.Dm * u, dh = Hm * u;
      sides.forEach(function (e, i) {
        e.style.display = "block"; e.style.left = "0"; e.style.top = "0"; e.style.width = dw + "px"; e.style.height = dh + "px";
        if (i % 2 === 0) { e.style.backgroundImage = b.url; e.style.backgroundSize = b.w + "px " + b.h + "px"; e.style.backgroundPosition = "0 0"; }
        else { e.style.backgroundImage = sm2.img || "none"; e.style.backgroundSize = sm2.size; e.style.backgroundPosition = "0 0"; }
      });
      S.rects = [{ w: cw, h: ch }, { w: G.Dm, h: Hm }, { w: G.Dm, h: Hm }];
    }
    if (S.mode === "accent") cover.style.boxShadow = "0 0 " + (u * 0.12) + "px rgba(0,0,0,.45)"; else cover.style.boxShadow = "none";
  }

  function labels() {
    var ln = line(), floor = !!ln.sim.floor;
    $("#dimW").textContent = floor ? "Alfombra " + m(S.fw) + " × " + m(S.fd) + " m" : "Ancho " + m(S.W) + " m";
    $("#dimH").textContent = floor ? "" : "Alto " + m(S.H) + " m"; $("#dimH").style.display = floor ? "none" : "";
    $("#stageName").textContent = ln.name + " · " + variant().name;
    calc();
  }

  function calc() {
    var ln = line(), v = variant(), s = ln.sim, floor = !!s.floor, price = v.price || ln.price, unit = "", note = "", qty = 0, area = 0;
    var rects = floor ? [{ w: S.fw, h: S.fd }] : (S.rects || [{ w: S.W, h: S.H }]);
    rects.forEach(function (c) {
      var cw = c.w * 100, ch = c.h * 100; area += cw * ch / 10000;
      if (s.kind === "tile") {
        var a = Math.ceil(cw / s.w) * Math.ceil(ch / s.h), b2 = Math.ceil(cw / s.h) * Math.ceil(ch / s.w); qty += Math.ceil(Math.min(a, b2) * 1.1); unit = "unidades"; note = "Incluye 10 % extra por cortes.";
      } else if (s.kind === "sheet") {
        var a2 = Math.ceil(cw / s.w) * Math.ceil(ch / s.h), b3 = Math.ceil(cw / s.h) * Math.ceil(ch / s.w); qty += Math.min(a2, b3); unit = "láminas"; note = "Láminas de " + m(s.w / 100) + " × " + m(s.h / 100) + " m.";
      } else if (s.kind === "roll") {
        var len = v.len || s.len, strips = Math.ceil(cw / s.w), per = Math.floor(len / ch);
        qty += per >= 1 ? Math.ceil(strips / per) : strips * Math.ceil(ch / len); unit = "rollos"; note = "Tiras de " + m(s.w / 100) + " m de ancho.";
      } else { qty += Math.ceil(cw / s.w) * Math.ceil(ch / s.len); unit = "láminas"; note = "Tablas de " + s.w + " cm × " + m(s.len / 100) + " m."; }
    });
    if (rects.length > 1) note += " Suma de " + rects.length + " paredes.";
    S.q = { qty: qty, unit: unit, total: qty * price };
    quote.textContent = "";
    var big = el("div", "big", String(qty) + " "); big.appendChild(el("small", null, unit + " · " + m(area) + " m²")); quote.appendChild(big);
    quote.appendChild(el("p", null, note + " Cantidad aproximada; no incluye pegante ni accesorios."));
    var row = el("div", "row"); row.appendChild(el("span", null, "Total aprox.")); row.appendChild(el("span", null, cop(S.q.total))); quote.appendChild(row);
    var what = floor ? "un piso de " + m(S.fw) + " × " + m(S.fd) + " m" : (S.mode === "full" ? "una pared" : S.mode === "accent" ? "una pared de acento" : S.mode === "splash" ? "un salpicadero" : S.mode === "all" ? "todas las paredes" : "media pared") + " de " + m(S.W) + " × " + m(S.H) + " m en " + ENVS[S.env].name.toLowerCase();
    var wbtn = el("a", "btn gold", "Cotizar esto por WhatsApp"); wbtn.rel = "noopener";
    wbtn.href = wa("Hola, quiero cotizar " + ln.name + " (" + v.name + ") para " + what + ": aprox. " + qty + " " + unit + " (" + cop(S.q.total) + "). ¿Tienen disponibilidad?");
    quote.appendChild(wbtn);
  }

  function buildLines() {
    var box = $("#simLines"); box.textContent = "";
    SIMS.forEach(function (it) {
      var b = el("button", "chip" + (it.id === S.id ? " on" : ""), it.name.replace("Lámina ", "").replace(" estilo piedra", "").replace(" adhesivo", "")); b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", it.id === S.id ? "true" : "false");
      b.addEventListener("click", function () { selectSim(it.id, 0, false); }); box.appendChild(b);
    });
  }
  function buildVars() {
    var box = $("#simVars"), ln = line(); box.textContent = "";
    ln.variants.forEach(function (v, i) { box.appendChild(varBtn(v, i, i === S.vi, function (k) { S.vi = k; buildVars(); layoutSoft(); }, true)); });
  }
  function buildEnvs() {
    var box = $("#envs"); box.textContent = "";
    Object.keys(ENVS).forEach(function (k) {
      var on = k === S.env, b = el("button", "chip" + (on ? " on" : ""), ENVS[k].name); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", on ? "true" : "false");
      b.addEventListener("click", function () { setEnv(k, true); }); box.appendChild(b);
    });
  }
  function buildModes() {
    var box = $("#modes"), E = ENVS[S.env]; box.textContent = "";
    if (E.modes.every(function (x) { return x[0] !== S.mode; })) S.mode = E.mode0;
    E.modes.forEach(function (x) {
      var on = x[0] === S.mode, b = el("button", "chip" + (on ? " on" : ""), x[1]); b.type = "button"; b.setAttribute("data-m", x[0]); b.setAttribute("role", "radio"); b.setAttribute("aria-checked", on ? "true" : "false");
      b.addEventListener("click", function () { S.mode = x[0]; buildModes(); layoutSoft(); }); box.appendChild(b);
    });
  }
  function configControls() {
    var floor = !!line().sim.floor, E = ENVS[S.env];
    $("#lbW").textContent = floor ? "Ancho de la alfombra" : "Ancho de la pared"; $("#lbH").textContent = floor ? "Largo de la alfombra" : "Alto de la pared";
    if (floor) { inW.min = 1; inW.max = 5; inW.value = S.fw; inH.min = 1; inH.max = 6; inH.value = S.fd; }
    else { inW.min = 1; inW.max = 8; inW.value = S.W; inH.min = 2; inH.max = 3.6; inH.value = S.H; }
    $("#envBox").hidden = floor; $("#hProd").textContent = (floor ? "1" : "2") + " · Elige el producto"; $("#hVar").textContent = (floor ? "2" : "3") + " · Elige el modelo"; $("#hMed").textContent = (floor ? "3" : "4") + " · Tus medidas";
    room.classList.remove("env-bano", "env-cocina"); if (!floor && E.cls) room.classList.add(E.cls);
    stage.setAttribute("aria-label", (floor ? "Alfombra en la sala" : E.name) + " en 3D. Arrastra para girar");
    var hint = $("#envNote"); hint.hidden = floor || !E.hint; hint.textContent = E.hint || "";
    buildEnvs(); buildModes();
    $("#modes").style.display = floor ? "none" : "flex"; outW.textContent = m(+inW.value) + " m"; outH.textContent = m(+inH.value) + " m";
  }
  function setEnv(k, reset) {
    S.env = k; var E = ENVS[k]; if (reset) { S.W = E.W; S.H = E.H; S.mode = E.mode0; }
    configControls(); layout();
  }
  function selectSim(id, vi, scroll) {
    S.id = id; S.vi = vi || 0; buildLines(); buildVars(); configControls();
    var fl = !!line().sim.floor; S.tyaw = fl ? -14 : -16; S.tpitch = fl ? -34 : 2; S.top = false; setViewBtns(fl); if (S.idle) S.pitch = S.tpitch;
    layout();
    if (scroll) $("#simulador").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
  }
  function layoutSoft() { paintSurface(); labels(); }

  inW.addEventListener("input", function () { var f = !!line().sim.floor; if (f) S.fw = +inW.value; else S.W = +inW.value; outW.textContent = m(+inW.value) + " m"; layout(); });
  inH.addEventListener("input", function () { var f = !!line().sim.floor; if (f) S.fd = +inH.value; else S.H = +inH.value; outH.textContent = m(+inH.value) + " m"; layout(); });
  function setViewBtns(fl) { $("#vFront").textContent = fl ? "Desde arriba" : "Vista frontal"; $("#v3d").textContent = "Vista 3D"; $("#v3d").classList.add("on"); $("#vFront").classList.remove("on"); }
$("#vFront").addEventListener("click", function () { var fl = !!line().sim.floor; S.idle = false; S.tyaw = 0; S.tpitch = fl ? -62 : 0; $("#vFront").classList.add("on"); $("#v3d").classList.remove("on"); layout(); kick(); });
$("#v3d").addEventListener("click", function () { var fl = !!line().sim.floor; S.idle = !REDUCED; S.tyaw = fl ? -14 : -16; S.tpitch = fl ? -34 : 2; $("#v3d").classList.add("on"); $("#vFront").classList.remove("on"); layout(); kick(); });

// giro con el puntero
  var drag = null;
  stage.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY, yaw: S.tyaw, pitch: S.tpitch }; S.idle = false; try { stage.setPointerCapture(e.pointerId); } catch (x) {} });
  stage.addEventListener("pointermove", function (e) {
    if (!drag) return; S.tyaw = Math.max(-34, Math.min(34, drag.yaw + (e.clientX - drag.x) * 0.2)); var fl = !!line().sim.floor; S.tpitch = fl ? Math.max(-70, Math.min(-20, drag.pitch - (e.clientY - drag.y) * 0.2)) : Math.max(-4, Math.min(16, drag.pitch - (e.clientY - drag.y) * 0.08)); kick();
  });
  function end() { drag = null; } stage.addEventListener("pointerup", end); stage.addEventListener("pointercancel", end);
  stage.addEventListener("keydown", function (e) { if (e.key === "ArrowLeft") S.tyaw = Math.max(-34, S.tyaw - 6); else if (e.key === "ArrowRight") S.tyaw = Math.min(34, S.tyaw + 6); else return; S.idle = false; kick(); });
  stage.tabIndex = 0;

  var lastT = 0;
  function frame(t) {
    S.running = false; if (!S.vis || document.hidden) return;
    if (S.idle && t - lastT < 32) { kick(); return; } lastT = t; // ~30 fps en giro automático: menos CPU/batería
    if (S.idle) S.tyaw = -12 + 8 * Math.sin(t / 2600);
    S.yaw += (S.tyaw - S.yaw) * 0.12; S.pitch += (S.tpitch - S.pitch) * 0.12;
    room.style.setProperty("--yaw", S.yaw.toFixed(2)); room.style.setProperty("--pitch", S.pitch.toFixed(2));
    if (S.idle || Math.abs(S.tyaw - S.yaw) > 0.05 || Math.abs(S.tpitch - S.pitch) > 0.05) kick();
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) kick(); });
  function kick() { if (!S.running) { S.running = true; requestAnimationFrame(frame); } }
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { S.vis = es[0].isIntersecting; if (S.vis) kick(); }).observe(stage); else { S.vis = true; kick(); }
  var rt; window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(layout, 120); });
  if (window.ResizeObserver) new ResizeObserver(function () { clearTimeout(rt); rt = setTimeout(layout, 60); }).observe(stage);

  room.style.setProperty("--yaw", S.yaw); room.style.setProperty("--pitch", S.pitch);
  selectSim(S.id, 0, false);

  /* ------------------------------------------------------------ reel (vídeo en el teléfono del hero) */
  (function () {
    var v = $("#reelV"), pb = $("#reelPause"), cap = $("#reelCap"), ph = $("#reel");
    var userPaused = REDUCED, vis = false;
    function sync() {
      var go = vis && !userPaused && !document.hidden;
      if (go) { var p = v.play(); if (p && p.catch) p.catch(function () { userPaused = true; sync(); }); } else v.pause();
      pb.textContent = userPaused ? "▶" : "❚❚"; pb.setAttribute("aria-label", userPaused ? "Reproducir vídeo" : "Pausar vídeo");
    }
    pb.addEventListener("click", function () { userPaused = !userPaused; if (!userPaused) v.preload = "auto"; sync(); });
    function openCur() { var it = byId("panel-3d"); if (it) openViewer(it, 0); }
    cap.addEventListener("click", openCur); cap.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCur(); } });
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { vis = es[0].isIntersecting; if (vis && !userPaused) v.preload = "auto"; sync(); }, { threshold: .25 }).observe(ph);
    document.addEventListener("visibilitychange", sync);
  })();

  /* ------------------------------------------------------------ compartir simulación */
  var toast = $("#toast"), tt = 0;
  function say(msg) { toast.textContent = msg; toast.hidden = false; clearTimeout(tt); tt = setTimeout(function () { toast.hidden = true; }, 2600); }
  $("#simShare").addEventListener("click", function () {
    var ln = line(), v = variant(), h = "#sim=" + [S.id, S.vi, S.mode, S.W, S.H, S.fw, S.fd, S.env].join(",");
    var url = location.origin + location.pathname + h, text = "Mira cómo quedaría " + ln.name + " (" + v.name + ") en mi espacio";
    history.replaceState(null, "", h);
    if (navigator.share) { navigator.share({ title: "La Reina del PVC", text: text, url: url }).catch(function () {}); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { say("Enlace copiado"); }, function () { say("Copia el enlace de la barra del navegador"); });
    else say("Copia el enlace de la barra del navegador");
  });
  (function restore() {
    var m = /^#sim=(.+)$/.exec(location.hash); if (!m) return; var p = m[1].split(","), it = byId(p[0]); if (!it || !it.sim) return;
    var vi = +p[1] || 0; if (vi >= it.variants.length) vi = 0;
    if (ENVS[p[7]]) S.env = p[7]; if (["full", "accent", "half", "splash", "all"].indexOf(p[2]) > -1) S.mode = p[2];
    var n = function (x, lo, hi, d) { x = parseFloat(x); return isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
    S.W = n(p[3], 1, 8, S.W); S.H = n(p[4], 2, 3.6, S.H); S.fw = n(p[5], 1, 5, S.fw); S.fd = n(p[6], 1, 6, S.fd);
    selectSim(it.id, vi, false); setTimeout(function () { $("#simulador").scrollIntoView(); }, 300);
  })();

  window.__pvc = { S: S, selectSim: selectSim };
})();
