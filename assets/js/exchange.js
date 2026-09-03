/* ============================================================================
   exchange.js — turns the swap panel into an exchange.

   The panel could only ever trade one token. This gives it every token on
   Robinhood Chain with a live market: a picker, prices for whatever is chosen,
   and an honest line about how to fund the trade when the buyer's money is on
   another chain.

   Two things it is careful about.

   The token list is the explorer's universe filtered by whether a market
   actually exists, so nothing in the picker is a trade that cannot happen.

   Whether you can bridge into this chain is not hard-coded. The server asks
   the aggregators and reports what it found, and this shows the cross-chain
   route only when one really exists — and says plainly that it does not when
   nobody lists the chain yet, rather than sending someone off to a bridge that
   will not take them here.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.ROBIN, RB = window.RB;
  var cfg = (C && C.exchange) || {};
  if (cfg.enabled === false) return;

  var TOKENS = cfg.tokensEndpoint || 'api/tokens.php';
  var BRIDGE = cfg.bridgeEndpoint || 'api/bridge.php';

  var $ = function (id) { return document.getElementById(id); };
  var pick = $('tokPick');
  if (!pick) return;

  var els = {
    bg: $('tokPickBg'), close: $('tokPickX'), search: $('tokSearch'),
    list: $('tokList'), note: $('tokNote'),
    coinFrom: $('coinFrom'), coinTo: $('coinTo'),
    fund: $('swapFund'),
  };

  var S = { tokens: [], loaded: false, open: false, side: null, q: '' };

  /* The configured token is always in the list, even before the list loads and
     even if it somehow drops out of it — it is this site's own token, and a
     picker that cannot offer it would be absurd. */
  function home() {
    var m = RB.market && RB.market.state;
    return {
      address: C.token.address.toLowerCase(),
      symbol: C.token.symbol, name: C.token.name,
      decimals: C.token.decimals,
      priceUsd: m && m.priceUsd, priceNative: null,
      liquidity: m && m.liquidity, home: true,
    };
  }

  /* ------------------------------------------------------------- the list */
  function load() {
    return fetch(TOKENS, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        S.loaded = true;
        var rows = (j.tokens || []).slice();
        var addr = C.token.address.toLowerCase();
        // Mark our own token wherever it appears. It used to be flagged only on
        // the synthesised fallback row, so on a working list — the normal case —
        // the badge never showed at all.
        var found = false;
        rows.forEach(function (t) { if (t.address === addr) { t.home = true; found = true; } });
        if (!found) rows.unshift(home());
        S.tokens = rows;
        if (!rows.length) {
          els.note.textContent = j.reached && j.reached.explorer
            ? 'No token on this chain has a live market yet.'
            : 'Could not reach the chain’s token list. Try again in a moment.';
        }
        render();
      })
      .catch(function () {
        S.loaded = true;
        S.tokens = [home()];
        els.note.textContent = 'Could not reach the chain’s token list — showing $ROBIN only.';
        render();
      });
  }

  function match(t) {
    var q = S.q.trim().toLowerCase();
    if (!q) return true;
    return (t.symbol || '').toLowerCase().indexOf(q) > -1 ||
           (t.name || '').toLowerCase().indexOf(q) > -1 ||
           (t.address || '').toLowerCase().indexOf(q) > -1;
  }

  function render() {
    if (!S.loaded) {
      els.list.innerHTML = '<li class="tok-skel"></li><li class="tok-skel"></li><li class="tok-skel"></li>';
      return;
    }
    var rows = S.tokens.filter(match);

    // A full address that matches nothing is still a real answer: it is
    // probably a token that has not started trading, so say that rather than
    // showing an empty list that looks broken.
    if (!rows.length) {
      els.list.innerHTML = '<li class="tok-empty">' +
        (/^0x[0-9a-fA-F]{40}$/.test(S.q.trim())
          ? 'Nothing is trading that address on this chain.'
          : 'No token matches that.') + '</li>';
      return;
    }

    els.list.innerHTML = rows.map(function (t) {
      var ch = t.change24h;
      return '<li><button type="button" data-a="' + RB.esc(t.address) + '">' +
        '<span class="tok-sym">' + RB.esc(t.symbol || '???') +
          (t.home ? '<i class="tok-home">this site</i>' : '') + '</span>' +
        '<span class="tok-name">' + RB.esc(t.name || RB.shortAddr(t.address)) + '</span>' +
        '<span class="tok-num">' +
          '<b>' + (t.priceUsd ? RB.esc(RB.usd(t.priceUsd)) : '—') + '</b>' +
          (ch != null ? '<em class="' + (ch >= 0 ? 'up' : 'down') + '">' +
             (ch >= 0 ? '+' : '') + ch.toFixed(1) + '%</em>' : '') +
        '</span>' +
        '<span class="tok-liq">' + (t.liquidity ? RB.usd(t.liquidity, { money: true }) : '—') + '</span>' +
      '</button></li>';
    }).join('');
  }

  /* -------------------------------------------------------------- opening */
  function open(side) {
    S.side = side;
    S.open = true;
    S.q = '';
    els.search.value = '';
    pick.hidden = false;
    requestAnimationFrame(function () { pick.classList.add('in'); });
    render();
    if (!S.loaded) load();
    setTimeout(function () { els.search.focus(); }, 120);
  }
  function close() {
    S.open = false;
    pick.classList.remove('in');
    setTimeout(function () { if (!S.open) pick.hidden = true; }, 220);
  }

  els.coinFrom && els.coinFrom.addEventListener('click', function () { open('from'); });
  els.coinTo && els.coinTo.addEventListener('click', function () { open('to'); });
  els.close.addEventListener('click', close);
  els.bg.addEventListener('click', close);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.open) close(); });
  els.search.addEventListener('input', function () { S.q = this.value; render(); });

  els.list.addEventListener('click', function (e) {
    var b = e.target.closest('[data-a]');
    if (!b) return;
    var t = S.tokens.filter(function (x) { return x.address === b.dataset.a; })[0];
    if (!t) return;
    close();
    // swap.js owns the panel; it listens for this and re-quotes.
    document.dispatchEvent(new CustomEvent('robin:token', { detail: { token: t, side: S.side } }));
  });

  /* ------------------------------------------------- how to fund the trade */
  /*
     Everything on this chain is paid for in its own ETH, which a new buyer
     will not have. What we are allowed to tell them depends entirely on
     whether a bridge lists the chain, so ask the server and repeat only what
     it actually found.
  */
  fetch(BRIDGE, { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!els.fund) return;
      var names = (j.via || []).map(function (k) {
        return (j.providers[k] && j.providers[k].name) || k;
      });
      if (j.status === 'available' && names.length) {
        els.fund.hidden = false;
        els.fund.className = 'swap-fund ok';
        els.fund.innerHTML = 'Coming from another chain? ' + RB.esc(names[0]) +
          ' bridges straight into Robinhood Chain — no manual transfer needed.';
        document.dispatchEvent(new CustomEvent('robin:bridge', { detail: j }));
      } else if (j.status === 'none') {
        els.fund.hidden = false;
        els.fund.className = 'swap-fund';
        els.fund.innerHTML = 'Need ETH on this chain? No aggregator bridges into Robinhood Chain yet, ' +
          'so move it across with the official bridge first, then come back.';
      }
      // 'unknown' means nobody answered. Saying nothing beats guessing.
    })
    .catch(function () {});

  RB.exchange = { open: open, load: load, tokens: function () { return S.tokens; } };
})();
