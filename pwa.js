// /pwa.js — Registro del service worker y aviso de instalación de la app.
(function () {
  "use strict";
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function () { /* la web funciona igual sin SW */ });
  });

  var KEY = "rpvc-install-dismissed", SNOOZE_DAYS = 30, DELAY_MS = 15000;
  var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone) return;

  function snoozed() {
    try { var t = Number(localStorage.getItem(KEY) || 0); return Date.now() - t < SNOOZE_DAYS * 864e5; } catch (e) { return false; }
  }
  function snooze() { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* sin almacenamiento */ } }

  var deferred = null, bar = null;

  function hide() { if (bar) { bar.remove(); bar = null; } }

  function show(isIOS) {
    if (bar || snoozed()) return;
    bar = document.createElement("div");
    bar.className = "pwa-bar"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Instalar la app");
    var img = document.createElement("img"); img.src = "/icons/icon-192.png"; img.alt = ""; img.width = 40; img.height = 40;
    var txt = document.createElement("p");
    var b = document.createElement("b"); b.textContent = "Instala La Reina del PVC";
    var s = document.createElement("span");
    s.textContent = isIOS ? "Toca Compartir y luego «Añadir a pantalla de inicio»." : "Catálogo y simulador a un toque, incluso sin conexión.";
    txt.appendChild(b); txt.appendChild(s);
    bar.appendChild(img); bar.appendChild(txt);
    if (!isIOS) {
      var ok = document.createElement("button"); ok.type = "button"; ok.className = "btn gold sm"; ok.textContent = "Instalar";
      ok.addEventListener("click", function () {
        if (!deferred) return hide();
        deferred.prompt();
        deferred.userChoice.then(function (r) { if (r.outcome !== "accepted") snooze(); deferred = null; hide(); });
      });
      bar.appendChild(ok);
    }
    var x = document.createElement("button"); x.type = "button"; x.className = "pwa-x"; x.textContent = "×"; x.setAttribute("aria-label", "Cerrar aviso");
    x.addEventListener("click", function () { snooze(); hide(); });
    bar.appendChild(x);
    document.body.appendChild(bar);
  }

  // Android / Chrome / Edge: el navegador avisa de que la app es instalable.
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); deferred = e;
    setTimeout(function () { show(false); }, DELAY_MS);
  });
  window.addEventListener("appinstalled", function () { deferred = null; hide(); snooze(); });

  // iPhone / iPad en Safari: no hay aviso automático, se explica cómo hacerlo.
  var ua = navigator.userAgent;
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|GSA/.test(ua);
  if (isIOS && isSafari) setTimeout(function () { show(true); }, DELAY_MS);
})();
