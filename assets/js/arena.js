/* ============================================================================
   arena.js — Robin Arena: the jackpot wheel.

   Everyone throws points into one pot. Your slice of the wheel is your share
   of the pot. When the round closes the wheel spins and one entry takes
   everything.

   Two things worth knowing about how this is drawn.

   The wheel lands on the *published ticket*, not on the middle of the winner's
   slice. The server picks a number in [0, pot) from a seed it committed to
   before anyone entered; that number is a position on the wheel, and that is
   the position the pointer stops at. So what you watch is the actual result
   being revealed, not an animation of a result decided elsewhere.

   The spin is a transform on one group, and nothing else moves while it runs.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.ROBIN, RB = window.RB;
  var root = document.getElementById('arena');
  if (!root) return;

  var cfg = C.arena || {};
  var ENDPOINT = cfg.endpoint || 'api/arena.php';
  var POLL_IDLE = cfg.pollMs || 6000;
  var POLL_SPIN = 1500;                       // while a result is due
  var SPIN_MS = 4600;

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    round: $('arRound'), clock: $('arClock'), phase: $('arPhase'),
    wheel: $('arWheel'), arcs: $('arArcs'), pot: $('arPot'), potLabel: $('arPotLabel'),
    players: $('arPlayers'), stakes: $('arStakes'), throwIn: $('arThrow'),
    you: $('arYou'), youPts: $('arYouPts'), claim: $('arClaim'),
    last: $('arLast'), lastText: $('arLastText'), robin: $('arRobin'),
    fair: $('arFair'), fairHash: $('arFairHash'), fairSeed: $('arFairSeed'), fairTicket: $('arFairTicket'),
    board: $('arBoard'), note: $('arNote'), burst: $('arBurst'),
  };

  /* Slice colours come from position in the round, not from a hash of the
     address: hashing put two near-identical oranges next to each other, and on
     a wheel the one thing a colour has to do is differ from its neighbour.
     Entry order is fixed by the server, so a slice still keeps its colour for
     the whole round. */
  var PALETTE = ['#a8dc2b', '#5ec8f0', '#ffd447', '#ff6b9d', '#3ddc84',
                 '#b78cf0', '#ff8f6b', '#c9f05e', '#f0a35e', '#8bc016'];
  var slot = {};
  function colorFor(a) { return PALETTE[(slot[a] || 0) % PALETTE.length]; }
  function assignColors(entries) {
    slot = {};
    entries.forEach(function (e, i) { slot[e.addr] = i; });
  }

  var S = { offset: 0, state: null, stake: 500, spun: {}, timer: null, spinning: false };

  function srvNow() { return Date.now() / 1000 + S.offset; }
  function addr() { return (RB.wallet && RB.wallet.state && RB.wallet.state.account) || null; }
  function esc(x) { return RB.esc(String(x)); }

  /* ------------------------------------------------------------------ poll */
  function pull() {
    var a = addr();
    return fetch(ENDPOINT + '?a=state' + (a ? '&addr=' + encodeURIComponent(a) : ''),
                 { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.error) throw new Error(j.error);
        S.offset = j.now - Date.now() / 1000;
        S.state = j;
        render();
        schedule();
      })
      .catch(function (e) { fail(e.message); schedule(); });
  }

  /* Poll hard only while a result is actually due — the rest of the time a
     round is just a countdown this page can run on its own. */
  function schedule() {
    clearTimeout(S.timer);
    var s = S.state, wait = POLL_IDLE;
    if (s) {
      var t = srvNow();
      if (t >= s.live.closesAt) wait = POLL_SPIN;
      else wait = Math.min(POLL_IDLE, Math.max(900, (s.live.closesAt - t) * 1000));
    }
    S.timer = setTimeout(pull, wait);
  }

  function fail(msg) {
    els.note.textContent = msg || 'The arena is not reachable right now.';
    els.note.classList.add('bad');
  }
  function say(msg) {
    els.note.textContent = msg;
    els.note.classList.remove('bad');
  }

  /* ---------------------------------------------------------------- render */
  function render() {
    var s = S.state;
    if (!s) return;

    els.round.textContent = '#' + s.live.id;
    // A poll lands every second and a half while a result is due, and swapping
    // the slices out from under a spin in progress would be the one moment
    // this thing must not flicker.
    if (!S.spinning) drawWheel(s.live);
    renderPlayers(s.live);
    renderStakes();
    renderYou();
    renderLast(s.last);
    renderBoard(s.top || []);
    tick();
  }

  /* -------------------------------------------------------------- the wheel */
  /* A donut drawn as one circle per slice, each with a dash gap sized to its
     share. Cheap to redraw, and the whole thing spins as a single transform. */
  var R = 52, CIRC = 2 * Math.PI * R;

  function drawWheel(round, keepRotation) {
    if (!keepRotation) {
      els.wheel.style.transition = 'none';
      els.wheel.style.transform = 'rotate(0deg)';
    }
    var entries = round.entries || [];
    var pot = round.pot || 0;
    els.pot.textContent = pot ? RB.num(pot) : '—';
    els.potLabel.textContent = pot ? 'in the pot' : 'nothing staked yet';

    if (!entries.length) {
      els.arcs.innerHTML = '<circle class="ar-arc-empty" cx="60" cy="60" r="52"></circle>';
      return;
    }
    assignColors(entries);
    var acc = 0;
    els.arcs.innerHTML = entries.map(function (e) {
      var frac = e.stake / pot, len = CIRC * frac;
      var c = '<circle cx="60" cy="60" r="' + R + '" stroke="' + colorFor(e.addr) + '"' +
              ' stroke-dasharray="' + len.toFixed(3) + ' ' + (CIRC - len).toFixed(3) + '"' +
              ' stroke-dashoffset="' + (-CIRC * acc).toFixed(3) + '"></circle>';
      acc += frac;
      return c;
    }).join('');
  }

  /* Spin so the pointer lands on the ticket the server published. */
  function spinTo(round) {
    if (!round || round.ticket == null || !round.pot) return;
    var frac = round.ticket / round.pot;
    var turns = 6;
    var deg = turns * 360 + (360 - frac * 360);

    els.wheel.style.transition = 'none';
    els.wheel.style.transform = 'rotate(0deg)';
    void els.wheel.offsetWidth;
    els.wheel.style.transition = 'transform ' + SPIN_MS + 'ms cubic-bezier(.14,.72,.14,1)';
    els.wheel.style.transform = 'rotate(' + deg + 'deg)';
    root.classList.add('spinning');
    S.spinning = true;

    // Hold the result on the wheel for a moment after it stops, then hand the
    // wheel back to the round now taking entries.
    setTimeout(function () { root.classList.remove('spinning'); }, SPIN_MS + 60);
    setTimeout(function () {
      S.spinning = false;
      if (S.state) drawWheel(S.state.live);
    }, SPIN_MS + 2600);
  }

  /* Runs after drawWheel, so the dots match the slices it just assigned. */
  function renderPlayers(round) {
    var entries = round.entries || [];
    var me = (addr() || '').toLowerCase();
    if (!entries.length) {
      els.players.innerHTML = '<li class="ar-empty">Nobody has thrown in yet. Go on.</li>';
      return;
    }
    els.players.innerHTML = entries.map(function (e) {
      var pct = Math.round(e.stake / round.pot * 100);
      return '<li' + (e.addr === me ? ' class="me"' : '') + '>' +
        '<i style="background:' + colorFor(e.addr) + '"></i>' +
        '<code>' + esc(e.addr === me ? 'you' : RB.shortAddr(e.addr)) + '</code>' +
        '<b>' + esc(RB.num(e.stake)) + '</b><em>' + pct + '%</em></li>';
    }).join('');
  }

  var PRESETS = [100, 500, 1000];
  function renderStakes() {
    var pts = (S.state.you && S.state.you.points) || 0;
    var opts = PRESETS.filter(function (p) { return p >= S.state.minStake; });
    els.stakes.innerHTML = opts.map(function (p) {
      return '<button type="button" data-stake="' + p + '"' +
             (S.stake === p ? ' class="on"' : '') + (p > pts ? ' disabled' : '') + '>' +
             RB.num(p) + '</button>';
    }).join('') +
      '<button type="button" data-stake="all"' + (S.stake === pts && pts ? ' class="on"' : '') +
      (pts < S.state.minStake ? ' disabled' : '') + '>All in</button>';
    if (S.stake > pts && pts >= S.state.minStake) S.stake = pts;   // keep the choice affordable

    /* The button is only ever dead when the round is genuinely shut. Disabling
       it for someone with no wallet — which is everyone on their first visit —
       kills the one control that would have got them started. */
    var open = srvNow() < S.state.live.closesAt;
    els.throwIn.disabled = !open;
    els.throwIn.textContent =
      !open                        ? 'Round closed' :
      !addr()                      ? 'Connect a wallet' :
      pts < S.state.minStake       ? 'Claim your points first' :
                                     'Throw in ' + RB.num(Math.min(S.stake, pts));
  }

  function renderYou() {
    var y = S.state.you;
    if (!y) { els.you.hidden = true; els.claim.textContent = 'Claim daily points'; return; }
    els.you.hidden = false;
    els.youPts.textContent = RB.num(y.points);
    els.claim.disabled = y.claimIn > 0;

    // Name the number when we know it — "Claim 4,000" tells you what the tier
    // is worth, and fits on one line where the generic label did not.
    var tier = (S.state.tiers || []).filter(function (t) { return t.name === y.tier; })[0];
    els.claim.textContent = y.claimIn > 0
      ? 'Next in ' + Math.ceil(y.claimIn / 3600) + 'h'
      : 'Claim ' + (tier ? RB.num(tier.daily) : 'daily points');
  }

  function renderLast(last) {
    if (!last || last.phase === 'entry' || last.phase === 'pending') { els.last.hidden = true; return; }
    els.last.hidden = false;

    if (last.phase === 'void') {
      els.lastText.textContent = 'Round #' + last.id + ' had only one player, so the stake went back.';
      els.fair.hidden = true;
      els.robin.hidden = true;
      return;
    }
    var me = (addr() || '').toLowerCase();
    var mine = last.winner === me;
    els.lastText.innerHTML = 'Round #' + last.id + ' — <b>' +
      esc(mine ? 'you' : RB.shortAddr(last.winner)) + '</b> took ' +
      '<b>' + esc(RB.num(last.pot)) + '</b> points.';

    els.fair.hidden = false;
    els.fairHash.textContent = (last.seedHash || '').slice(0, 16) + '…';
    els.fairSeed.textContent = (last.seed || '').slice(0, 16) + '…';
    els.fairTicket.textContent = RB.num(last.ticket) + ' of ' + RB.num(last.pot);

    if (last.reaction) { els.robin.hidden = false; els.robin.textContent = '“' + last.reaction + '”'; }
    else { els.robin.hidden = true; askRobin(last.id); }

    // Spin once per round, when we first learn how it went.
    if (!S.spun[last.id]) {
      S.spun[last.id] = true;
      drawWheel(last);            // the finished round is what the wheel shows
      spinTo(last);
      if (mine) setTimeout(function () { win(last.pot); }, SPIN_MS - 250);
    }
  }

  var asked = {};
  function askRobin(id) {
    if (asked[id]) return;
    asked[id] = true;
    fetch(ENDPOINT + '?a=react&round=' + id)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.reaction) return;
        if (S.state && S.state.last && S.state.last.id === id) {
          els.robin.hidden = false;
          els.robin.textContent = '“' + j.reaction + '”';
        }
      })
      .catch(function () {});
  }

  function renderBoard(top) {
    if (!top.length) {
      els.board.innerHTML = '<li class="ar-empty">Nobody has played yet. Be first.</li>';
      return;
    }
    var me = (addr() || '').toLowerCase();
    els.board.innerHTML = top.map(function (p, i) {
      return '<li' + (p.addr === me ? ' class="me"' : '') + '>' +
        '<b>' + (i + 1) + '</b><code>' + esc(RB.shortAddr(p.addr)) + '</code>' +
        '<em>' + esc(p.tier || '') + '</em>' +
        '<span>' + esc(RB.num(p.points)) + '</span></li>';
    }).join('');
  }

  /* ---------------------------------------------------------------- the clock */
  var lastShown = null;
  function tick() {
    var s = S.state;
    if (!s) return;
    var t = srvNow();
    var closing = t < s.live.closesAt;
    var left = Math.max(0, (closing ? s.live.closesAt : s.live.endsAt) - t);
    var mm = Math.floor(left / 60), ss = Math.floor(left % 60);
    var txt = mm + ':' + (ss < 10 ? '0' : '') + ss;
    if (txt === lastShown) return;
    lastShown = txt;
    els.clock.textContent = txt;
    els.phase.textContent = closing ? 'until the wheel spins' : 'spinning';
    root.classList.toggle('closing', closing && left <= 10);
    if (!closing) renderStakes();
  }

  /* ------------------------------------------------------------- the payout */
  function win(pot) {
    root.classList.add('won');
    setTimeout(function () { root.classList.remove('won'); }, 1400);

    var card = document.createElement('div');
    card.className = 'ar-win';
    card.innerHTML = '<b>+' + RB.num(pot) + '</b><span>points</span>';
    root.appendChild(card);
    requestAnimationFrame(function () { card.classList.add('in'); });
    setTimeout(function () {
      card.classList.remove('in');
      setTimeout(function () { card.remove(); }, 400);
    }, 2400);

    var cv = els.burst, ctx = cv.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var bits = [];
    for (var i = 0; i < 56; i++) {
      var a = Math.random() * Math.PI * 2, sp = 2.5 + Math.random() * 6;
      bits.push({ x: w / 2, y: h * 0.38, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3,
                  r: 2 + Math.random() * 3, life: 1, c: PALETTE[(Math.random() * PALETTE.length) | 0] });
    }
    cv.hidden = false;
    (function frame() {
      ctx.clearRect(0, 0, w, h);
      var alive = 0;
      for (var i = 0; i < bits.length; i++) {
        var b = bits[i];
        if (b.life <= 0) continue;
        alive++;
        b.vy += 0.22; b.x += b.vx; b.y += b.vy; b.life -= 0.016;
        ctx.globalAlpha = Math.max(0, b.life);
        ctx.fillStyle = b.c;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.283); ctx.fill();
      }
      if (alive) requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, w, h); cv.hidden = true; }
    })();
  }

  /* ----------------------------------------------------------------- actions */
  function needWallet() {
    if (addr()) return false;
    if (RB.wallet && RB.wallet.openPicker) RB.wallet.openPicker();
    return true;
  }

  els.stakes.addEventListener('click', function (e) {
    var b = e.target.closest('[data-stake]');
    if (!b) return;
    var pts = (S.state.you && S.state.you.points) || 0;
    S.stake = b.dataset.stake === 'all' ? pts : parseInt(b.dataset.stake, 10);
    renderStakes();
  });

  els.claim.addEventListener('click', function () {
    if (needWallet()) return;
    els.claim.disabled = true;
    fetch(ENDPOINT + '?a=claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: addr() }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { els.claim.disabled = false; return fail(res.j.error); }
        say('Claimed ' + RB.num(res.j.claimed) + ' points as ' + res.j.tier + '.');
        return pull();
      })
      .catch(function () { els.claim.disabled = false; fail(); });
  });

  els.throwIn.addEventListener('click', function () {
    if (needWallet()) return;
    var pts = (S.state.you && S.state.you.points) || 0;
    // Nothing to stake yet: send them where they actually need to go.
    if (pts < S.state.minStake) { els.claim.click(); return; }
    var stake = Math.min(S.stake, pts);
    els.throwIn.disabled = true;
    fetch(ENDPOINT + '?a=join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: addr(), stake: stake }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { els.throwIn.disabled = false; return fail(res.j.error); }
        say("You're in round #" + res.j.round + ' for ' + RB.num(res.j.stake) + ' points.');
        return pull();
      })
      .catch(function () { els.throwIn.disabled = false; fail(); });
  });

  /* ------------------------------------------------------------------ start */
  pull();
  setInterval(tick, 250);

  var lastAccount = addr();
  if (RB.wallet && RB.wallet.onChange) {
    RB.wallet.onChange(function (st) {
      if (st.account === lastAccount) return;
      lastAccount = st.account;
      S.spun = {};
      pull();
    });
  }
})();
