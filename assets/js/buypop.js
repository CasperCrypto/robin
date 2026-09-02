/* ============================================================================
   buypop.js — buy notifications.

   Every buy that lands pops up in the corner: how much, what it cost, who.
   On arrival the recent ones replay one at a time, so the page opens with
   proof that people are buying rather than a static number.

   Deliberately restrained about it: a handful on load, then only real ones,
   never more than a few on screen, and nothing at all if there is nothing to
   show. An empty feed is silent, not a fake one.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.ROBIN, RB = window.RB;
  var cfg = (C.market && C.market.popups) || {};

  if (cfg.enabled === false) return;

  var REPLAY_COUNT = cfg.replay == null ? 5 : cfg.replay;   // shown on load
  var REPLAY_GAP   = cfg.gapMs  == null ? 1900 : cfg.gapMs; // between them
  var HOLD_MS      = cfg.holdMs == null ? 6500 : cfg.holdMs;
  var MAX_ON_SCREEN = 3;

  var wrap = document.createElement('div');
  wrap.className = 'buypop-wrap';
  wrap.setAttribute('aria-live', 'polite');
  wrap.setAttribute('aria-label', 'Recent buys');
  document.body.appendChild(wrap);

  /** Bigger bags, bigger animal — same scale the feed uses. */
  function creature(usd) {
    if (usd == null) return '🐕';
    if (usd >= 10000) return '🐋';
    if (usd >= 2500)  return '🦈';
    if (usd >= 500)   return '🏹';
    if (usd >= 100)   return '🐕';
    return '🐾';
  }

  /** A big buy deserves a louder card. */
  function tier(usd) {
    if (usd == null) return '';
    if (usd >= 2500) return ' whale';
    if (usd >= 250)  return ' big';
    return '';
  }

  function show(row) {
    // Never let them pile up; drop the oldest instead.
    while (wrap.children.length >= MAX_ON_SCREEN) {
      wrap.removeChild(wrap.firstChild);
    }

    var price = RB.market.state.priceUsd;
    var usd = price ? row.amount * price : null;

    var el = document.createElement('a');
    el.className = 'buypop' + tier(usd);
    el.href = RB.scan('tx', row.tx);
    el.target = '_blank';
    el.rel = 'noopener';
    el.innerHTML =
      '<span class="bp-emo">' + creature(usd) + '</span>' +
      '<span class="bp-body">' +
        '<span class="bp-top">New buy' +
          (usd ? ' <b>' + RB.esc(RB.usd(usd, { money: true })) + '</b>' : '') +
        '</span>' +
        '<span class="bp-amt">+' + RB.esc(RB.num(row.amount)) + ' $ROBIN</span>' +
        '<span class="bp-sub">' + RB.esc(RB.shortAddr(row.who)) +
          ' · ' + RB.esc(RB.ago(row.at)) + ' ago</span>' +
      '</span>';

    wrap.appendChild(el);

    // Let the element land before animating, so the transition actually runs.
    requestAnimationFrame(function () { el.classList.add('in'); });

    var gone = false;
    var dismiss = function () {
      if (gone) return;
      gone = true;
      el.classList.remove('in');
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.remove(); }, 420);
    };
    var timer = setTimeout(dismiss, HOLD_MS);

    // Hovering holds it open; it is a link, and links get read.
    el.addEventListener('mouseenter', function () { clearTimeout(timer); });
    el.addEventListener('mouseleave', function () { timer = setTimeout(dismiss, 1800); });
  }

  /* ------------------------------------------------------------- lifecycle */
  var replayed = false;

  function replay() {
    if (replayed) return;
    replayed = true;
    var rows = RB.feed.recent(REPLAY_COUNT);
    if (!rows.length) return;                 // nothing real to show, so nothing

    // Oldest first, so the sequence reads forwards.
    rows.slice().reverse().forEach(function (row, i) {
      setTimeout(function () { show(row); }, 900 + i * REPLAY_GAP);
    });
  }

  if (RB.feed) {
    RB.feed.onBuy(show);                       // live ones, as they land
    RB.feed.ready().then(replay);              // and the recent ones on arrival
  }
})();
