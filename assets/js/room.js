/* ============================================================================
   room.js — live presence and reactions.

   A head count that moves, and emoji that fly up the screen for everyone at
   once. The point is not the emoji; it is that a visitor can see other people
   are here. On a memecoin site that is the first question anyone silently
   asks, and a number that changes answers it better than any wording could.

   Everything that moves is transform and opacity, and the rail goes quiet —
   no polling at all — when the tab is in the background.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.ROBIN, RB = window.RB;
  var cfg = (C && C.room) || {};
  if (cfg.enabled === false) return;

  var ENDPOINT = cfg.endpoint || 'api/room.php';
  var CALM_MS  = cfg.pollMs || 5000;    // resting cadence
  var LIVE_MS  = 2000;                  // …and while the room is busy
  var LIVE_FOR = 20000;                 // how long busy lasts after a reaction
  var MAX_ON_SCREEN = 40;

  var EMOJI = ['🚀', '🏹', '🐕', '💎', '🔥', '😂'];

  /* A random name for this browser, kept so a refresh is not a new person.
     It identifies nothing — it exists only so the server can count. */
  var id;
  try {
    id = localStorage.getItem('robin.room');
    if (!/^[a-z0-9]{8,32}$/.test(id || '')) throw 0;
  } catch (e) { id = null; }
  if (!id) {
    id = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
    try { localStorage.setItem('robin.room', id); } catch (e) {}
  }

  // cursor null means "not yet synced": the first poll asks for nothing to be
  // replayed, every poll after it asks for everything since what it last saw.
  var S = { cursor: null, here: 0, busyUntil: 0, timer: null, pending: [], inflight: false };

  /* ------------------------------------------------------------------- ui */
  var rail = document.createElement('div');
  rail.className = 'room-rail';
  rail.innerHTML =
    '<span class="room-here" id="roomHere" aria-live="polite" title="People on the site right now">' +
      '<i></i><b>–</b></span>' +
    EMOJI.map(function (e) {
      return '<button type="button" class="room-btn" data-e="' + e + '" aria-label="React ' + e + '">' + e + '</button>';
    }).join('');
  document.body.appendChild(rail);

  var sky = document.createElement('div');
  sky.className = 'room-sky';
  sky.setAttribute('aria-hidden', 'true');
  document.body.appendChild(sky);

  var hereEl = document.getElementById('roomHere').querySelector('b');

  /* --------------------------------------------------------------- flying */
  function fly(emoji, mine) {
    if (sky.children.length >= MAX_ON_SCREEN) sky.removeChild(sky.firstChild);
    var el = document.createElement('span');
    el.className = 'room-fly' + (mine ? ' mine' : '');
    el.textContent = emoji;
    // Spread them across the right-hand side, near the rail they came from,
    // with enough scatter that two at once never overlap exactly.
    el.style.right = (14 + Math.random() * 70) + 'px';
    el.style.setProperty('--drift', (Math.random() * 80 - 40).toFixed(1) + 'px');
    el.style.setProperty('--spin', (Math.random() * 40 - 20).toFixed(1) + 'deg');
    el.style.setProperty('--dur', (2.6 + Math.random() * 1.4).toFixed(2) + 's');
    el.style.fontSize = (mine ? 30 : 20 + Math.random() * 10).toFixed(0) + 'px';
    sky.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.remove(); }, 4200);
  }

  /* Arrivals are staggered rather than dumped, so a busy moment reads as a
     stream of people reacting instead of one clump appearing at once. */
  function rain(list) {
    list.slice(0, MAX_ON_SCREEN).forEach(function (e, i) {
      setTimeout(function () { fly(e, false); }, i * 110);
    });
  }

  /* ----------------------------------------------------------------- poll */
  function tick() {
    if (S.inflight) return schedule();
    S.inflight = true;
    var react = S.pending.shift() || '';

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, since: S.cursor === null ? -1 : S.cursor, react: react }),
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        S.inflight = false;
        if (j.error) return schedule();
        S.here = j.here;
        hereEl.textContent = j.here;
        rail.classList.toggle('alone', j.here <= 1);
        if (j.reactions && j.reactions.length) {
          rain(j.reactions);
          S.busyUntil = Date.now() + LIVE_FOR;
        }
        S.cursor = j.cursor;
        schedule();
      })
      .catch(function () { S.inflight = false; schedule(); });
  }

  function schedule() {
    clearTimeout(S.timer);
    if (document.hidden) return;                 // a background tab is not in the room
    var wait = Date.now() < S.busyUntil ? LIVE_MS : CALM_MS;
    S.timer = setTimeout(tick, wait);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) clearTimeout(S.timer);
    else tick();
  });

  /* -------------------------------------------------------------- sending */
  var lastSent = 0;
  function send(emoji) {
    var now = Date.now();
    if (now - lastSent < 250) return;            // one tap is one reaction
    lastSent = now;
    fly(emoji, true);                            // yours appears instantly
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
    S.pending.push(emoji);
    S.busyUntil = now + LIVE_FOR;
    clearTimeout(S.timer);
    S.timer = setTimeout(tick, 60);              // …and goes out almost at once
  }

  rail.addEventListener('click', function (e) {
    var b = e.target.closest('.room-btn');
    if (!b) return;
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
    send(b.dataset.e);
  });

  /* The room reacts to the chain on its own: a big buy throws rockets without
     anyone pressing anything, because that is the moment worth marking. */
  if (RB && RB.feed && RB.feed.onBuy) {
    RB.feed.onBuy(function (row) {
      var price = RB.market && RB.market.state && RB.market.state.priceUsd;
      var usd = price ? row.amount * price : 0;
      if (usd < 250) return;
      var n = usd >= 2500 ? 6 : 3;
      for (var i = 0; i < n; i++) setTimeout(function () { fly('🚀', false); }, i * 130);
    });
  }

  // A jackpot win is worth a shower of diamonds, and arena.js says when.
  document.addEventListener('robin:win', function () {
    for (var i = 0; i < 8; i++) setTimeout(function () { fly('💎', false); }, i * 90);
  });

  tick();
})();
