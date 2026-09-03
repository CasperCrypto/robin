/* ============================================================================
   buypop.js — buy notifications.

   One at a time, along the bottom of the screen: it rises, says what happened,
   and leaves before the next one arrives. A queue rather than a stack, because
   three cards fighting for the same corner reads as clutter, and a single card
   arriving on a beat reads as momentum.

   Deliberately restrained: a handful replayed on load, then only real buys,
   and nothing at all if there is nothing to show. An empty feed is silent,
   not a fake one.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.ROBIN, RB = window.RB;
  var cfg = (C.market && C.market.popups) || {};

  if (cfg.enabled === false) return;

  var REPLAY_COUNT = cfg.replay == null ? 6 : cfg.replay;    // shown on load
  var HOLD_MS      = cfg.holdMs == null ? 3400 : cfg.holdMs; // time on screen
  var GAP_MS       = cfg.gapMs  == null ? 620  : cfg.gapMs;  // empty beat between
  var IN_MS = 460, OUT_MS = 380;                             // matches the CSS
  var QUEUE_MAX = 12;                                        // don't hoard a backlog

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

  /* ------------------------------------------------------------ the queue */
  var queue = [], showing = false;

  function push(row) {
    if (queue.length >= QUEUE_MAX) queue.shift();   // keep the newest
    queue.push(row);
    pump();
  }

  function pump() {
    if (showing || !queue.length) return;
    showing = true;
    render(queue.shift(), function () {
      showing = false;
      setTimeout(pump, GAP_MS);
    });
  }

  function render(row, done) {
    var price = RB.market.state.priceUsd;
    var usd = price ? row.amount * price : null;

    var el = document.createElement('div');
    el.className = 'buypop' + tier(usd);
    el.innerHTML =
      '<span class="bp-emo">' + creature(usd) + '</span>' +
      '<span class="bp-body">' +
        '<span class="bp-top">New buy</span>' +
        '<span class="bp-amt">+' + RB.esc(RB.num(row.amount)) + ' $ROBIN</span>' +
      '</span>' +
      (usd ? '<span class="bp-usd">' + RB.esc(RB.usd(usd, { money: true })) + '</span>' : '');

    wrap.appendChild(el);

    // Two frames: one for the element to land in the layout, one so the
    // starting transform is the browser's last committed value. Without the
    // second, the transition sometimes has nothing to animate from.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add('in'); });
    });

    setTimeout(function () {
      el.classList.remove('in');
      el.classList.add('out');
      setTimeout(function () {
        if (el.parentNode) el.remove();
        done();
      }, OUT_MS);
    }, IN_MS + HOLD_MS);
  }

  /* ------------------------------------------------------------- lifecycle */
  var replayed = false;

  function replay() {
    if (replayed) return;
    replayed = true;
    var rows = RB.feed.recent(REPLAY_COUNT);
    if (!rows.length) return;                 // nothing real to show, so nothing
    // Oldest first, so the sequence reads forwards.
    rows.slice().reverse().forEach(push);
  }

  if (RB.feed) {
    RB.feed.onBuy(push);                       // live ones, as they land
    RB.feed.ready().then(replay);              // and the recent ones on arrival
  }
})();
