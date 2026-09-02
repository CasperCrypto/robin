/* ============================================================================
   doge.js — loads the animated doge only when it's actually wanted.

   The loop is ~1 MB, so it is never in the critical path: a 17 KB poster paints
   immediately and the animation is fetched only when the band scrolls into
   view. It then plays on its own — the loop is the point of the section.

   The one case that still gets a Play button instead of an automatic download
   is a visitor whose browser is explicitly asking us to save data, where
   spending a megabyte without being asked would be rude.
   ========================================================================== */
(function () {
  'use strict';
  var box = document.getElementById('dogeAnim');
  if (!box) return;

  var img = box.querySelector('img');
  var play = box.querySelector('.doge-play');
  var loaded = false;

  /* A 2-frame animated WebP. Browsers that decode still WebP but not animation
     report height 1 for this; real support reports 1 and decodes both frames,
     so we test decodability rather than trusting the format alone. */
  var ANIM_WEBP =
    'data:image/webp;base64,UklGRsoAAABXRUJQVlA4WAoAAAACAAAAAAAAAAAAQU5JTQYAAAAAAAAAAABBTk1GSgAAAAAA' +
    'AAAAAAAAAAAAAAEAAAJWUDggMgAAADABAJ0BKgEAAQABQCYloAADcAD+8ut///mwP/bz/wR6Af//0uD//pcH//S4P/SkAAA' +
    'AQU5NRkwAAAAAAAAAAAAAAAAAAAABAAAAVlA4IDQAAAA0AQCdASoBAAEAAAAmJaAAA3AA/ukiH//3nz//ufP/+58/6M///yn' +
    '7//I4//8jj/5QIAAA';

  function supportsAnimatedWebp() {
    return new Promise(function (res) {
      var t = new Image();
      t.onload = function () { res(t.width === 1 && t.height === 1); };
      t.onerror = function () { res(false); };
      t.src = ANIM_WEBP;
    });
  }

  function saveData() {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (c && c.saveData) return true;
    // 2g/slow-2g: a megabyte is not a reasonable thing to send.
    if (c && /(^|-)2g$/.test(c.effectiveType || '')) return true;
    return false;
  }

  function load() {
    if (loaded) return;
    loaded = true;
    box.classList.add('loading');

    supportsAnimatedWebp().then(function (ok) {
      var src = ok ? box.dataset.webp : box.dataset.gif;
      var next = new Image();
      next.onload = function () {
        img.src = src;
        img.removeAttribute('srcset');
        box.classList.remove('loading');
        box.classList.add('playing');
        if (play) play.hidden = true;
      };
      next.onerror = function () {
        // Fall back once, then give up quietly and keep the poster.
        if (ok) { box.dataset.webp = box.dataset.gif; loaded = false; load(); }
        else { box.classList.remove('loading'); }
      };
      next.src = src;
    });
  }

  function offerPlay() {
    if (play) {
      play.hidden = false;
      play.addEventListener('click', load, { once: true });
    }
  }

  if (saveData()) {
    offerPlay();
    return;
  }

  if (!('IntersectionObserver' in window)) { load(); return; }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      io.disconnect();
      load();
    });
  }, { rootMargin: '200px 0px' });
  io.observe(box);
})();
