(function () {
  var PAGES_CACHE = 'mst-pages-v3';

  // penghitung angka pada beranda
  document.querySelectorAll('[data-count]').forEach(function (el) {
    var target = parseInt(el.dataset.count, 10) || 0, start = null;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / 1200, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    }
    el.textContent = '0'; requestAnimationFrame(step);
  });

  // ---- pasang aplikasi (PWA) ----
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var deferred = null;
  var buttons = document.querySelectorAll('[data-install]');
  var note = document.querySelector('[data-install-note]');
  function showButtons(on) { buttons.forEach(function (b) { b.hidden = !on; }); }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e; showButtons(true);
    if (note) note.textContent = '';
  });
  window.addEventListener('appinstalled', function () { deferred = null; showButtons(false); if (note) note.textContent = 'Aplikasi sudah terpasang.'; });

  if (standalone) { showButtons(false); if (note) note.textContent = 'Anda sedang memakai versi aplikasi.'; }
  else if (isIOS) {
    showButtons(true);
    if (note) note.textContent = 'Di iPhone/iPad, pasang lewat Safari.';
  } else if (note) {
    note.textContent = 'Di Chrome atau Edge, tombol pasang muncul otomatis. Bisa juga lewat ikon pasang di bilah alamat.';
  }
  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      if (deferred) {
        deferred.prompt();
        deferred.userChoice.finally(function () { deferred = null; showButtons(false); });
      } else if (isIOS) {
        var d = document.getElementById('iosHelp'); if (d && d.showModal) d.showModal();
      }
    });
  });

  // ---- status koneksi ----
  var banner = document.getElementById('netBanner');
  function net() {
    if (!banner) return;
    if (!navigator.onLine) { banner.textContent = 'Anda sedang offline. E-tiket yang pernah dibuka tetap tersedia.'; banner.classList.add('show'); }
    else if (banner.classList.contains('show')) { banner.textContent = 'Kembali online'; setTimeout(function () { banner.classList.remove('show'); }, 1800); }
  }
  window.addEventListener('online', net); window.addEventListener('offline', net); net();

  // ---- keluar: hapus salinan halaman pribadi di perangkat ----
  document.querySelectorAll('form[data-logout]').forEach(function (f) {
    f.addEventListener('submit', function () { if (window.caches) caches.delete(PAGES_CACHE); });
  });

  // ---- mode terang / gelap ----
  var root = document.documentElement;
  document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      var next = (root.getAttribute('data-bs-theme') || 'light') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-bs-theme', next);
      try { localStorage.setItem('mst-theme', next); } catch (e) {}
      window.dispatchEvent(new Event('themechange'));
    });
  });

  // ---- slideshow destinasi di beranda ----
  var reel = document.getElementById('reel');
  if (reel) {
    var slides = reel.querySelectorAll('.slide'), dots = reel.querySelectorAll('[data-go]');
    var n = slides.length, idx = 0, timer = null;
    var dur = parseInt(reel.dataset.interval, 10) || 5500;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    reel.style.setProperty('--dur', dur + 'ms');
    var restart = function () {
      clearTimeout(timer);
      var cur = dots[idx]; if (cur) { cur.classList.remove('cur'); void cur.offsetWidth; cur.classList.add('cur'); }
      if (!reduce && n > 1) timer = setTimeout(function () { show(idx + 1); }, dur);
    };
    var show = function (k) {
      idx = (k + n) % n;
      slides.forEach(function (s, j) { var on = j === idx; s.classList.toggle('on', on); s.setAttribute('aria-hidden', on ? 'false' : 'true'); s.tabIndex = on ? 0 : -1; });
      dots.forEach(function (d, j) { d.classList.toggle('done', j < idx); d.classList.toggle('cur', false); d.setAttribute('aria-selected', j === idx ? 'true' : 'false'); });
      restart();
    };
    dots.forEach(function (d) { d.addEventListener('click', function () { show(parseInt(d.dataset.go, 10)); }); });
    var pause = function () { clearTimeout(timer); reel.classList.add('paused'); };
    var resume = function () { reel.classList.remove('paused'); restart(); };
    reel.addEventListener('mouseenter', pause); reel.addEventListener('mouseleave', resume);
    reel.addEventListener('focusin', pause); reel.addEventListener('focusout', resume);
    document.addEventListener('visibilitychange', function () { document.hidden ? pause() : resume(); });
    var x0 = null;
    reel.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    reel.addEventListener('touchend', function (e) {
      if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 45) show(idx + (dx < 0 ? 1 : -1));
    }, { passive: true });
    show(0);
  }

  // ---- service worker ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }
})();
