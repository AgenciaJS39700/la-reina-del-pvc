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
    var ph = el("div", "ph"); ph.appendChild(el("div", "fx " + it.tone));
    if (it.img) {
      var img = new Image(); img.alt = ""; img.loading = "lazy"; img.decoding = "async"; img.width = 560; img.height = 420;
      img.onload = function () { ph.insertBefore(img, ph.firstChild); }; img.src = it.img;
    }
    var pt = el("span", "price-tag", it.price == null ? "Consultar precio" : (it.unit === "desde" ? "Desde " : "") + cop(it.price));
    if (it.price != null && it.unit && it.unit !== "desde") pt.appendChild(el("small", null, " / " + it.unit));
    ph.appendChild(pt);
    if (it.variants) ph.appendChild(el("span", "badge", it.variants.length + " modelos"));
    open.appendChild(ph); open.addEventListener("click", function () { openViewer(it, 0); });
    c.appendChild(open);
    var bd = el("div", "bd");
    bd.appendChild(el("h3", null, it.name));
    bd.appendChild(el("p", "spec", it.spec + (it.priceNote ? " · " + it.priceNote : "")));
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
  q.addEventListener("input", function () { cat.q = q.value; renderCatalog(); });
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
    var box = $("#vVarsBox"), vars = $("#vVars"); vars.textContent = "";
    if (it.variants) { box.hidden = false; it.variants.forEach(function (x, i) { vars.appendChild(varBtn(x, i, i === V.vi, function (k) { V.vi = k; V.gi = 0; paintViewer(); }, false)); }); } else box.hidden = true;
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
  var S = { id: SIMS[0].id, vi: 0, mode: "full", W: 3.2, H: 2.5, fw: 2.4, fd: 3.0, yaw: -16, pitch: 2, tyaw: -16, tpitch: 2, idle: !REDUCED, running: false, vis: false };
  var stage = $("#stage"), room = $("#room"), scene = $("#scene"), cover = $("#cover"), seams = $("#seams"), rug = $("#rug"), fBack = $("#fBack"), fFloor = $("#fFloor");
  var inW = $("#inW"), inH = $("#inH"), outW = $("#outW"), outH = $("#outH"), quote = $("#quote");
  var G = { u: 150 };

  function SOFA() { return '<svg viewBox="0 0 300 120" preserveAspectRatio="none"><defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eadfc9"/><stop offset="1" stop-color="#cdbd9f"/></linearGradient></defs><rect x="14" y="22" width="272" height="66" rx="18" fill="url(#g1)"/><rect x="0" y="40" width="42" height="66" rx="15" fill="#d3c3a6"/><rect x="258" y="40" width="42" height="66" rx="15" fill="#d3c3a6"/><rect x="30" y="60" width="240" height="42" rx="13" fill="#e2d5bb"/><rect x="42" y="34" width="106" height="44" rx="13" fill="#efe5d1"/><rect x="152" y="34" width="106" height="44" rx="13" fill="#efe5d1"/><rect x="52" y="48" width="38" height="34" rx="9" fill="#b98b55"/><rect x="208" y="50" width="40" height="32" rx="9" fill="#8d9b84"/><rect x="34" y="104" width="10" height="14" rx="3" fill="#4d3a27"/><rect x="256" y="104" width="10" height="14" rx="3" fill="#4d3a27"/></svg>'; }
  function TABLE() { return '<svg viewBox="0 0 120 52" preserveAspectRatio="none"><rect x="0" y="6" width="120" height="9" rx="4" fill="#3c2f22"/><rect x="12" y="15" width="6" height="36" fill="#2b2118"/><rect x="102" y="15" width="6" height="36" fill="#2b2118"/><ellipse cx="42" cy="4" rx="12" ry="4" fill="#d9a93b"/><rect x="72" y="0" width="22" height="6" rx="2" fill="#e9e1d0"/></svg>'; }
  function PLANT() { return '<svg viewBox="0 0 80 170" preserveAspectRatio="none"><path d="M40 112C20 90 8 60 14 24c18 14 28 44 26 88z" fill="#4f7a49"/><path d="M40 112C60 86 74 56 66 18c-18 16-28 48-26 94z" fill="#5e8d56"/><path d="M40 112C34 80 38 44 40 6c8 34 8 70 0 106z" fill="#6a9b60"/><path d="M26 124h28l-5 44H31z" fill="#b5835a"/><rect x="24" y="118" width="32" height="9" rx="3" fill="#c79566"/></svg>'; }
  function LAMP() { return '<svg viewBox="0 0 60 200" preserveAspectRatio="none"><path d="M12 6h36l8 40H4z" fill="#f3e8cf"/><rect x="28" y="46" width="4" height="140" fill="#2f2a22"/><ellipse cx="30" cy="190" rx="16" ry="6" fill="#2f2a22"/></svg>'; }
  $("#pSofa").innerHTML = SOFA(); $("#pTable").innerHTML = TABLE(); $("#pPlant").innerHTML = PLANT(); $("#pLamp").innerHTML = LAMP();

  function line() { return byId(S.id); }
  function variant() { return line().variants[S.vi]; }

  function placeProp(id, wm, hm, x, z) {
    var e = $("#" + id), u = G.u, w = wm * u, h = hm * u;
    e.style.width = w + "px"; e.style.height = h + "px"; e.style.left = (x * u - w / 2) + "px"; e.style.top = (G.Hm * u / 2 - h) + "px";
    e.style.transform = "translateZ(" + (z * u) + "px) rotateY(calc(var(--yaw) * -1deg))";
  }

  function layout() {
    var ln = line(), sim = ln.sim, floor = !!sim.floor, r = stage.getBoundingClientRect();
    if (!r.width) return;
    var Wm = floor ? Math.max(S.fw + 1.2, 3.6) : S.W, Hm = S.H, Dm = floor ? Math.max(S.fd + 0.8, 3.4) : 3.2;
    var P = Math.max(r.width, r.height) * 1.6, u = 120;
    for (var i = 0; i < 5; i++) { var s = P / (P + Dm * u / 2); u = Math.min(0.9 * r.width / (Wm * s), 0.86 * r.height / (Hm * s)); }
    G.u = u; G.Wm = Wm; G.Hm = Hm; G.Dm = Dm;
    scene.style.setProperty("--p", P + "px");
    room.style.setProperty("--w", Wm * u + "px"); room.style.setProperty("--h", Hm * u + "px"); room.style.setProperty("--d", Dm * u + "px"); room.style.setProperty("--u", u + "px");
    // muebles (billboards)
    var sw = Math.min(2.3, Wm * 0.7);
    placeProp("pSofa", sw, sw * 0.4, 0, -Dm / 2 + 0.55);
    placeProp("pTable", Math.min(1.0, sw * 0.45), 0.42, 0, floor ? -0.1 : -Dm / 2 + 1.5);
    placeProp("pPlant", 0.55, 1.45, -Wm / 2 + 0.45, -Dm / 2 + 0.4);
    placeProp("pLamp", 0.34, 1.75, Wm / 2 - 0.4, -Dm / 2 + 0.45);
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
    cover.style.display = "none"; seams.style.display = "none"; rug.style.display = "none";
    if (floor) {
      var rw = S.fw * u, rd = S.fd * u;
      rug.style.display = "block"; rug.style.width = rw + "px"; rug.style.height = rd + "px"; rug.style.left = (Wm * u - rw) / 2 + "px"; rug.style.top = (G.Dm * u - rd) / 2 + "px";
      var sm = seamCss(ln, b);
      rug.style.backgroundImage = (sm.img ? sm.img + "," : "") + b.url; rug.style.backgroundSize = (sm.size ? sm.size + "," : "") + b.w + "px " + b.h + "px"; rug.style.backgroundRepeat = "repeat"; rug.style.backgroundColor = "#a39a89";
      return;
    }
    var cw, ch, x0, y0;
    if (S.mode === "accent") { cw = Math.max(1.2, Wm * 0.6); ch = Hm; x0 = (Wm - cw) / 2; y0 = 0; }
    else if (S.mode === "half") { cw = Wm; ch = Math.min(1.1, Hm); x0 = 0; y0 = Hm - ch; }
    else { cw = Wm; ch = Hm; x0 = 0; y0 = 0; }
    S.cov = { w: cw, h: ch };
    [cover, seams].forEach(function (e) { e.style.display = "block"; e.style.left = x0 * u + "px"; e.style.top = y0 * u + "px"; e.style.width = cw * u + "px"; e.style.height = ch * u + "px"; });
    var pos = S.mode === "half" ? "0 100%" : "0 0";
    cover.style.backgroundImage = b.url; cover.style.backgroundSize = b.w + "px " + b.h + "px"; cover.style.backgroundPosition = pos;
    var sm2 = seamCss(ln, b); seams.style.backgroundImage = sm2.img || "none"; seams.style.backgroundSize = sm2.size; seams.style.backgroundPosition = pos;
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
    var ln = line(), v = variant(), s = ln.sim, floor = !!s.floor, cw, ch;
    if (floor) { cw = S.fw * 100; ch = S.fd * 100; }
    else { var c = S.cov || { w: S.W, h: S.H }; cw = c.w * 100; ch = c.h * 100; }
    var qty, unit, note = "", price = v.price || ln.price;
    if (s.kind === "tile") {
      var a = Math.ceil(cw / s.w) * Math.ceil(ch / s.h), b2 = Math.ceil(cw / s.h) * Math.ceil(ch / s.w); qty = Math.ceil(Math.min(a, b2) * 1.1); unit = "unidades"; note = "Incluye 10 % extra por cortes.";
    } else if (s.kind === "sheet") {
      var a2 = Math.ceil(cw / s.w) * Math.ceil(ch / s.h), b3 = Math.ceil(cw / s.h) * Math.ceil(ch / s.w); qty = Math.min(a2, b3); unit = "láminas"; note = "Láminas de " + m(s.w / 100) + " × " + m(s.h / 100) + " m.";
    } else if (s.kind === "roll") {
      var len = v.len || s.len, strips = Math.ceil(cw / s.w), per = Math.floor(len / ch);
      qty = per >= 1 ? Math.ceil(strips / per) : strips * Math.ceil(ch / len); unit = "rollos"; note = strips + " tiras de " + m(s.w / 100) + " m de ancho.";
    } else { qty = Math.ceil(cw / s.w) * Math.ceil(ch / s.len); unit = "láminas"; note = "Tablas de " + s.w + " cm × " + m(s.len / 100) + " m."; }
    S.q = { qty: qty, unit: unit, total: qty * price };
    var area = m(cw * ch / 10000) + " m²";
    quote.textContent = "";
    var big = el("div", "big", String(qty) + " "); big.appendChild(el("small", null, unit + " · " + area)); quote.appendChild(big);
    quote.appendChild(el("p", null, note + " Cantidad aproximada; no incluye pegante ni accesorios."));
    var row = el("div", "row"); row.appendChild(el("span", null, "Total aprox.")); row.appendChild(el("span", null, cop(S.q.total))); quote.appendChild(row);
    var wbtn = el("a", "btn gold", "Cotizar esto por WhatsApp"); wbtn.rel = "noopener";
    wbtn.href = wa("Hola, quiero cotizar " + ln.name + " (" + v.name + ") para " + (floor ? "un piso de " + m(S.fw) + " × " + m(S.fd) + " m" : (S.mode === "full" ? "una pared" : S.mode === "accent" ? "una pared de acento" : "media pared") + " de " + m(S.W) + " × " + m(S.H) + " m") + ": aprox. " + qty + " " + unit + " (" + cop(S.q.total) + "). ¿Tienen disponibilidad?");
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
  function configControls() {
    var floor = !!line().sim.floor;
    $("#lbW").textContent = floor ? "Ancho de la alfombra" : "Ancho de la pared"; $("#lbH").textContent = floor ? "Largo de la alfombra" : "Alto de la pared";
    if (floor) { inW.min = 1; inW.max = 5; inW.value = S.fw; inH.min = 1; inH.max = 6; inH.value = S.fd; }
    else { inW.min = 1; inW.max = 8; inW.value = S.W; inH.min = 2; inH.max = 3.6; inH.value = S.H; }
    $("#modes").style.display = floor ? "none" : "flex"; outW.textContent = m(+inW.value) + " m"; outH.textContent = m(+inH.value) + " m";
  }
  function selectSim(id, vi, scroll) {
    S.id = id; S.vi = vi || 0; buildLines(); buildVars(); configControls();
    var fl = !!line().sim.floor; S.tpitch = fl ? 14 : 2; if (S.idle) S.pitch = S.tpitch;
    layout();
    if (scroll) $("#simulador").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
  }
  function layoutSoft() { paintSurface(); labels(); }

  inW.addEventListener("input", function () { var f = !!line().sim.floor; if (f) S.fw = +inW.value; else S.W = +inW.value; outW.textContent = m(+inW.value) + " m"; layout(); });
  inH.addEventListener("input", function () { var f = !!line().sim.floor; if (f) S.fd = +inH.value; else S.H = +inH.value; outH.textContent = m(+inH.value) + " m"; layout(); });
  Array.prototype.forEach.call(document.querySelectorAll("#modes .chip"), function (b) {
    b.addEventListener("click", function () { S.mode = b.getAttribute("data-m"); Array.prototype.forEach.call(document.querySelectorAll("#modes .chip"), function (x) { var on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", on ? "true" : "false"); }); layoutSoft(); });
  });
  $("#vFront").addEventListener("click", function () { S.idle = false; S.tyaw = 0; S.tpitch = line().sim.floor ? 10 : 0; $("#vFront").classList.add("on"); $("#v3d").classList.remove("on"); kick(); });
  $("#v3d").addEventListener("click", function () { S.idle = !REDUCED; S.tyaw = -16; S.tpitch = line().sim.floor ? 14 : 2; $("#v3d").classList.add("on"); $("#vFront").classList.remove("on"); kick(); });

  // giro con el puntero
  var drag = null;
  stage.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY, yaw: S.tyaw, pitch: S.tpitch }; S.idle = false; try { stage.setPointerCapture(e.pointerId); } catch (x) {} });
  stage.addEventListener("pointermove", function (e) {
    if (!drag) return; S.tyaw = Math.max(-34, Math.min(34, drag.yaw + (e.clientX - drag.x) * 0.2)); S.tpitch = Math.max(-4, Math.min(16, drag.pitch - (e.clientY - drag.y) * 0.08)); kick();
  });
  function end() { drag = null; } stage.addEventListener("pointerup", end); stage.addEventListener("pointercancel", end);
  stage.addEventListener("keydown", function (e) { if (e.key === "ArrowLeft") S.tyaw = Math.max(-34, S.tyaw - 6); else if (e.key === "ArrowRight") S.tyaw = Math.min(34, S.tyaw + 6); else return; S.idle = false; kick(); });
  stage.tabIndex = 0;

  function frame(t) {
    S.running = false; if (!S.vis) return;
    if (S.idle) S.tyaw = -12 + 8 * Math.sin(t / 2600);
    S.yaw += (S.tyaw - S.yaw) * 0.12; S.pitch += (S.tpitch - S.pitch) * 0.12;
    room.style.setProperty("--yaw", S.yaw.toFixed(2)); room.style.setProperty("--pitch", S.pitch.toFixed(2));
    if (S.idle || Math.abs(S.tyaw - S.yaw) > 0.05 || Math.abs(S.tpitch - S.pitch) > 0.05) kick();
  }
  function kick() { if (!S.running) { S.running = true; requestAnimationFrame(frame); } }
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { S.vis = es[0].isIntersecting; if (S.vis) kick(); }).observe(stage); else { S.vis = true; kick(); }
  var rt; window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(layout, 120); });
  if (window.ResizeObserver) new ResizeObserver(function () { clearTimeout(rt); rt = setTimeout(layout, 60); }).observe(stage);

  room.style.setProperty("--yaw", S.yaw); room.style.setProperty("--pitch", S.pitch);
  selectSim(S.id, 0, false);
  window.__pvc = { S: S, selectSim: selectSim };
})();
