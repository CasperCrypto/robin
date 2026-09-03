/* ============================================================================
   arena.js — Robin Arena.

   Five-minute rounds on the $ROBIN price. While one runs, entry is open for
   the next, so there is always something to watch and something to pick.

   The countdown runs locally off a clock offset measured against the server,
   rather than off this device's clock — phones are routinely a few seconds
   out, and a timer that disagrees with the round it is counting down makes the
   whole thing feel broken.

   Everything that moves here is transform or opacity. The one exception is the
   countdown ring, which steps its dash offset once a second on a single small
   SVG, and that is the whole animation budget for this section.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.ROBIN, RB = window.RB;
  var root = document.getElementById('arena');
  if (!root) return;

  var cfg = C.arena || {};
  var ENDPOINT = cfg.endpoint || 'api/arena.php';
  var POLL_MS  = cfg.pollMs || 9000;

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    ring: $('arRing'), clock: $('arClock'), roundNo: $('arRound'),
    price: $('arPrice'), delta: $('arDelta'), lock: $('arLock'),
    robin: $('arRobin'), robinSide: $('arRobinSide'), robinNote: $('arRobinNote'),
    robinRec: $('arRobinRec'),
    up: $('arUp'), down: $('arDown'), upN: $('arUpN'), downN: $('arDownN'),
    split: $('arSplit'), joins: $('arJoins'),
    you: $('arYou'), youPts: $('arYouPts'), youRec: $('arYouRec'), youStreak: $('arYouStreak'),
    tier: $('arTier'), gate: $('arGate'), board: $('arBoard'), strip: $('arStrip'),
    note: $('arNote'), burst: $('arBurst'),
  };

  var S = {
    offset: 0,          // serverNow - Date.now()/1000
    state: null,
    myPick: null,       // side chosen for the open round, before the server confirms
    celebrated: null,   // round id of the last win we made a fuss about
    busy: false,
  };

  function srvNow() { return Date.now() / 1000 + S.offset; }
  function addr() { return (RB.wallet && RB.wallet.state && RB.wallet.state.account) || null; }

  /* ------------------------------------------------------------------ poll */
  function pull() {
    var a = addr();
    var url = ENDPOINT + '?a=state' + (a ? '&addr=' + encodeURIComponent(a) : '');
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.error) throw new Error(j.error);
        S.offset = j.now - Date.now() / 1000;
        var prevOpen = S.state && S.state.open.id;
        S.state = j;
        if (prevOpen && j.open.id !== prevOpen) S.myPick = null;   // new round, fresh slate
        render();
        celebrate();
      })
      .catch(function (e) { fail(e.message); });
  }

  function fail(msg) {
    els.note.textContent = msg || 'The arena is not reachable right now.';
    els.note.classList.add('bad');
  }

  /* ---------------------------------------------------------------- render */
  var lastPrice = null;

  function render() {
    var s = S.state;
    if (!s) return;
    els.note.classList.remove('bad');

    /* the live round */
    els.roundNo.textContent = '#' + s.live.id;
    if (s.price != null) {
      els.price.textContent = RB.usd(s.price);
      if (lastPrice !== null && s.price !== lastPrice) {
        flash(els.price, s.price > lastPrice ? 'up' : 'down');
      }
      lastPrice = s.price;
    }

    var lock = s.live.lockPrice;
    if (lock && s.price) {
      var pct = (s.price - lock) / lock * 100;
      els.delta.textContent = (pct >= 0 ? '▲ +' : '▼ ') + pct.toFixed(2) + '%';
      els.delta.className = 'ar-delta ' + (pct >= 0 ? 'up' : 'down');
      els.lock.textContent = 'locked at ' + RB.usd(lock);
      els.lock.hidden = false;
    } else {
      els.delta.textContent = 'waiting for the lock price';
      els.delta.className = 'ar-delta';
      els.lock.hidden = true;
    }

    /* Robin */
    var rs = s.open.robinSide;
    if (rs) {
      els.robin.hidden = false;
      els.robinSide.textContent = rs === 'UP' ? '▲ UP' : '▼ DOWN';
      els.robinSide.className = 'ar-robin-side ' + rs.toLowerCase();
      els.robinNote.textContent = s.open.robinNote || '';
    } else {
      els.robin.hidden = true;
    }
    els.robinRec.textContent = s.robin.rounds
      ? s.robin.wins + '/' + s.robin.rounds + ' (' + Math.round(s.robin.wins / s.robin.rounds * 100) + '%)'
      : 'no record yet';

    /* the open round */
    var mine = (s.yourOpen && s.yourOpen.side) || S.myPick;
    els.up.classList.toggle('picked', mine === 'UP');
    els.down.classList.toggle('picked', mine === 'DOWN');
    els.up.classList.toggle('dimmed', !!mine && mine !== 'UP');
    els.down.classList.toggle('dimmed', !!mine && mine !== 'DOWN');
    els.upN.textContent = s.open.up;
    els.downN.textContent = s.open.down;

    var total = s.open.up + s.open.down;
    els.split.style.transform = 'scaleX(' + (total ? s.open.up / total : 0.5) + ')';

    renderJoins(s.open.joins || []);

    /* you */
    if (s.you) {
      els.you.hidden = false;
      els.youPts.textContent = RB.num(s.you.points);
      els.youRec.textContent = s.you.wins + 'W · ' + (s.you.played - s.you.wins) + 'L';
      els.youStreak.textContent = s.you.streak > 1 ? '🔥 ' + s.you.streak : '';
      els.tier.textContent = s.you.tier || '';
      els.tier.hidden = !s.you.tier;
    } else {
      els.you.hidden = true;
      els.tier.hidden = true;
    }

    els.gate.hidden = !!addr();
    renderStrip(s.recent || []);
    renderBoard(s.top || []);
    tickClock();
  }

  function flash(el, dir) {
    el.classList.remove('f-up', 'f-down');
    void el.offsetWidth;                      // restart the animation
    el.classList.add('f-' + dir);
  }

  /* Joins arrive as a set, not a stream, so only draw the ones we have not
     drawn before — otherwise every poll replays the same six arrivals. */
  var seenJoins = {};
  function renderJoins(joins) {
    joins.slice().reverse().forEach(function (j) {
      var key = S.state.open.id + ':' + j.addr;
      if (seenJoins[key]) return;
      seenJoins[key] = true;
      var chip = document.createElement('span');
      chip.className = 'ar-join ' + j.side.toLowerCase();
      chip.textContent = RB.shortAddr(j.addr) + ' ' + (j.side === 'UP' ? '▲' : '▼');
      els.joins.appendChild(chip);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { chip.classList.add('in'); });
      });
      setTimeout(function () {
        chip.classList.remove('in');
        setTimeout(function () { chip.remove(); }, 400);
      }, 4200);
    });
  }

  function renderStrip(recent) {
    els.strip.innerHTML = recent.map(function (r) {
      if (r.status === 'void')    return '<i class="v" title="Round ' + r.id + ': void">—</i>';
      if (r.status !== 'settled') return '<i class="p" title="Round ' + r.id + '">·</i>';
      var up = r.settlePrice > r.lockPrice;
      return '<i class="' + (up ? 'u' : 'd') + '" title="Round ' + r.id + ': ' +
             (up ? 'up' : 'down') + '">' + (up ? '▲' : '▼') + '</i>';
    }).join('');
  }

  function renderBoard(top) {
    if (!top.length) {
      els.board.innerHTML = '<li class="ar-empty">Nobody has played yet. Be first.</li>';
      return;
    }
    var me = (addr() || '').toLowerCase();
    els.board.innerHTML = top.map(function (p, i) {
      return '<li' + (p.addr === me ? ' class="me"' : '') + '>' +
        '<b>' + (i + 1) + '</b>' +
        '<code>' + RB.esc(RB.shortAddr(p.addr)) + '</code>' +
        '<em>' + RB.esc(p.tier || '') + '</em>' +
        '<span>' + (p.best > 1 ? '🔥' + p.best + ' ' : '') + RB.num(p.points) + '</span>' +
      '</li>';
    }).join('');
  }

  /* ----------------------------------------------------------- the clock */
  var RING = 2 * Math.PI * 52;                // matches the SVG radius
  var lastShown = null;

  function tickClock() {
    var s = S.state;
    if (!s) return;
    var left = Math.max(0, s.live.endsAt - srvNow());
    var frac = Math.min(1, Math.max(0, left / s.roundSec));

    var mm = Math.floor(left / 60), ss = Math.floor(left % 60);
    var txt = mm + ':' + (ss < 10 ? '0' : '') + ss;
    if (txt !== lastShown) {
      els.clock.textContent = txt;
      lastShown = txt;
      els.ring.style.strokeDashoffset = String(RING * (1 - frac));
      root.classList.toggle('closing', left <= 10);
    }
    if (left <= 0.2) setTimeout(pull, 900);   // the round just turned over
  }

  /* ------------------------------------------------------------ the payout */
  function celebrate() {
    var last = S.state.you && S.state.you.last;
    if (!last || !last.won) return;
    if (S.celebrated === last.round) return;
    if (S.celebrated === null) { S.celebrated = last.round; return; }  // don't replay history on arrival
    S.celebrated = last.round;
    burst(last.points);
  }

  /* A short particle burst on a canvas. Cheap, self-contained, and it stops
     dead once the last particle is gone — no idle animation loop. */
  function burst(points) {
    root.classList.add('won');
    setTimeout(function () { root.classList.remove('won'); }, 1400);

    var win = document.createElement('div');
    win.className = 'ar-win';
    win.innerHTML = '<b>+' + RB.num(points) + '</b><span>points</span>';
    root.appendChild(win);
    requestAnimationFrame(function () { win.classList.add('in'); });
    setTimeout(function () {
      win.classList.remove('in');
      setTimeout(function () { win.remove(); }, 400);
    }, 2200);

    var cv = els.burst, ctx = cv.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var colors = ['#a8dc2b', '#c9f05e', '#ffd447', '#3ddc84', '#ffffff'];
    var bits = [];
    for (var i = 0; i < 48; i++) {
      var a = Math.random() * Math.PI * 2, sp = 2.5 + Math.random() * 5.5;
      bits.push({
        x: w / 2, y: h * 0.42,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3,
        r: 2 + Math.random() * 3, life: 1,
        c: colors[(Math.random() * colors.length) | 0],
      });
    }

    cv.hidden = false;
    (function frame() {
      ctx.clearRect(0, 0, w, h);
      var alive = 0;
      for (var i = 0; i < bits.length; i++) {
        var b = bits[i];
        if (b.life <= 0) continue;
        alive++;
        b.vy += 0.22;                       // gravity
        b.x += b.vx; b.y += b.vy; b.life -= 0.016;
        ctx.globalAlpha = Math.max(0, b.life);
        ctx.fillStyle = b.c;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, 6.283);
        ctx.fill();
      }
      if (alive) requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, w, h); cv.hidden = true; }
    })();
  }

  /* ---------------------------------------------------------------- picking */
  function pick(side) {
    if (S.busy) return;
    var a = addr();
    if (!a) {
      // No wallet yet: open the picker rather than refusing. Picking a side is
      // the moment someone decided to play, so that is the moment to ask.
      if (RB.wallet && RB.wallet.openPicker) RB.wallet.openPicker();
      return;
    }
    S.busy = true;
    S.myPick = side;                          // show it immediately; confirm below
    render();

    fetch(ENDPOINT + '?a=join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: a, side: side }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        S.busy = false;
        if (!res.ok) { S.myPick = null; render(); return fail(res.j.error); }
        els.note.textContent = "You're in round #" + res.j.round + " as " + res.j.tier +
                               ' (×' + res.j.mult + ' points).';
        return pull();
      })
      .catch(function () { S.busy = false; S.myPick = null; render(); fail(); });
  }

  els.up.addEventListener('click', function () { pick('UP'); });
  els.down.addEventListener('click', function () { pick('DOWN'); });

  /* ----------------------------------------------------------------- start */
  pull();
  setInterval(pull, POLL_MS);
  setInterval(tickClock, 250);

  // The wallet emits on every internal change, including mid-connect. Only a
  // different account is worth re-reading the board for.
  var lastAccount = addr();
  if (RB.wallet && RB.wallet.onChange) {
    RB.wallet.onChange(function (st) {
      if (st.account === lastAccount) return;
      lastAccount = st.account;
      S.celebrated = null;                  // a different player, a different history
      pull();
    });
  }
})();
