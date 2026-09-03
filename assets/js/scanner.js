/* ============================================================================
   scanner.js — Robin Scanner.

   Paste a token address, get a straight answer about whether it looks safe.

   Everything shown here was computed on the server from chain and explorer
   data: who holds what, how deep the pool is, what the verified source
   actually contains. The language model writes the paragraph at the top and
   nothing else — it is handed the verdict and told it cannot change it. That
   ordering is the whole point. A model asked "is this a rug?" will produce a
   confident answer out of nothing; a model handed "the top ten wallets hold
   87%" can only explain it.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.ROBIN, RB = window.RB;
  var form = document.getElementById('scanForm');
  if (!form) return;

  var input   = document.getElementById('scanAddr');
  var btn     = document.getElementById('scanBtn');
  var chips   = document.getElementById('scanChips');
  var load    = document.getElementById('scanLoad');
  var status  = document.getElementById('scanStatus');
  var out     = document.getElementById('scanOut');
  var verdict = document.getElementById('scanVerdict');
  var elLabel = document.getElementById('scanLabel');
  var elName  = document.getElementById('scanName');
  var elSum   = document.getElementById('scanSummary');
  var elStats = document.getElementById('scanStats');
  var elFinds = document.getElementById('scanFindings');
  var elHold  = document.getElementById('scanHolders');
  var elHList = document.getElementById('scanHolderList');
  var note    = document.getElementById('scanNote');
  var noteText = note.textContent;

  var ENDPOINT = (C.scanner && C.scanner.endpoint) || 'api/scan.php';

  /* Something to press for anyone who does not have an address to hand. */
  var SAMPLES = [
    { label: 'Scan $ROBIN', addr: C.token.address }
  ];
  SAMPLES.forEach(function (s) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = s.label;
    b.addEventListener('click', function () { input.value = s.addr; run(s.addr); });
    chips.appendChild(b);
  });

  /* The wait is long enough to need company — a few seconds of explorer and
     market calls — so say what is actually happening while it happens. */
  var STEPS = [
    'Reading the contract…',
    'Counting the holders…',
    'Measuring the pool…',
    'Working out what could go wrong…'
  ];
  var stepTimer = null;
  function startSteps() {
    var i = 0;
    status.textContent = STEPS[0];
    stepTimer = setInterval(function () {
      i = Math.min(i + 1, STEPS.length - 1);
      status.textContent = STEPS[i];
    }, 1800);
  }
  function stopSteps() { clearInterval(stepTimer); stepTimer = null; }

  function busy(on) {
    load.hidden = !on;
    btn.disabled = on;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
    if (on) { out.hidden = true; startSteps(); } else { stopSteps(); }
  }

  function fail(msg) {
    busy(false);
    note.textContent = msg;
    note.classList.add('bad');
  }

  function run(addr) {
    addr = String(addr || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      return fail('That does not look like a token address. It should be 0x followed by 40 characters.');
    }
    note.textContent = noteText;
    note.classList.remove('bad');
    busy(true);

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: addr })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j && res.j.error ? res.j.error : 'The scanner is not reachable right now.');
        render(res.j);
        busy(false);
      })
      .catch(function (e) { fail(e.message || 'The scanner is not reachable right now.'); });
  }

  /* ---------------------------------------------------------------- render */
  var ICON = { good: '✓', warn: '!', bad: '✕', unknown: '?' };

  function render(r) {
    verdict.className = 'scan-verdict v-' + (r.verdict || 'unknown');
    elLabel.textContent = r.label || 'Checked';
    elName.textContent = r.name
      ? r.name + (r.symbol ? ' · ' + r.symbol : '')
      : RB.shortAddr(r.address);

    if (r.summary) { elSum.textContent = r.summary; elSum.hidden = false; }
    else { elSum.hidden = true; }

    /* Stats, but only the ones that came back. A row reading "unknown" four
       times over is worse than no row. */
    var s = r.stats || {};
    var stats = [
      ['Price',      s.price     != null ? RB.usd(s.price) : null],
      ['Market cap', s.mcap      != null ? RB.usd(s.mcap, { money: true }) : null],
      ['Liquidity',  s.liquidity != null ? RB.usd(s.liquidity, { money: true }) : null],
      ['24h volume', s.volume24h != null ? RB.usd(s.volume24h, { money: true }) : null],
      ['Holders',    s.holders   != null ? RB.num(s.holders) : null]
    ].filter(function (p) { return p[1] != null; });

    elStats.innerHTML = stats.map(function (p) {
      return '<div><span>' + RB.esc(p[0]) + '</span><b>' + RB.esc(p[1]) + '</b></div>';
    }).join('');
    elStats.hidden = stats.length === 0;

    elFinds.innerHTML = (r.findings || []).map(function (f) {
      return '<li class="f-' + RB.esc(f.level) + '">' +
        '<span class="f-icon" aria-hidden="true">' + (ICON[f.level] || '·') + '</span>' +
        '<span><b>' + RB.esc(f.what) + '</b><i>' + RB.esc(f.why) + '</i></span>' +
      '</li>';
    }).join('');

    var top = (r.top || []).filter(function (t) { return t.pct != null; });
    if (top.length) {
      elHList.innerHTML = top.map(function (t) {
        return '<li><code>' + RB.esc(RB.shortAddr(t.address)) + '</code>' +
               (t.isContract ? '<em>pool / contract</em>' : '') +
               '<b>' + t.pct + '%</b></li>';
      }).join('');
      elHold.hidden = false;
    } else {
      elHold.hidden = true;
    }

    out.hidden = false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    run(input.value);
  });
})();
