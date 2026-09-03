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
  var ROUTE  = cfg.routeEndpoint || 'api/route.php';

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
     Everything on this chain is paid for in its own ETH, which somebody
     arriving from Solana will not have. Uniswap pools on this chain solve the
     swap; they do nothing about getting the money here, and that is the half
     that is actually missing.

     So two questions get asked of the server, and only what it found is
     repeated. bridge.php asks whether any aggregator lists the chain at all.
     route.php asks the stronger question — whether one will actually quote
     Solana to here — because a chain can be listed for EVM traffic and have no
     Solana path whatsoever.
  */
  function fundCard(html, kind) {
    if (!els.fund) return;
    els.fund.hidden = false;
    els.fund.className = 'swap-fund' + (kind ? ' ' + kind : '');
    els.fund.innerHTML = html;
  }

  function manualPath() {
    var bridge = (C.links && C.links.bridge) || '';
    var step2 = bridge
      ? '<a href="' + RB.esc(bridge) + '" target="_blank" rel="noopener">the Robinhood Chain bridge</a>'
      : 'the official Robinhood Chain bridge';
    return '<b>Coming from Solana?</b>' +
      '<span>Nothing bridges straight into this chain yet, so it is three steps ' +
      'rather than one:</span>' +
      '<ol class="fund-steps">' +
        '<li>Swap SOL for ETH on Ethereum or Base — ' +
          '<a href="https://jumper.exchange" target="_blank" rel="noopener">Jumper</a> ' +
          'and <a href="https://app.mayan.finance" target="_blank" rel="noopener">Mayan</a> both do this.</li>' +
        '<li>Move that ETH across with ' + step2 + '.</li>' +
        '<li>Come back here and swap it for any token on the list.</li>' +
      '</ol>' +
      '<span class="fund-foot">This turns into one click the moment an aggregator lists the chain — ' +
      'the site checks for itself and will switch over on its own.</span>';
  }

  Promise.all([
    fetch(BRIDGE, { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); })
      .catch(function () { return { status: 'unknown' }; }),
    fetch(ROUTE, { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); })
      .catch(function () { return { status: 'unknown' }; }),
  ]).then(function (res) {
    var bridge = res[0], route = res[1];

    // The strongest claim first: somebody actually quoted Solana to here.
    if (route.status === 'available' && (route.via || []).length) {
      var who = (route.providers[route.via[0]] || {}).name || route.via[0];
      fundCard('<b>Pay straight from Solana</b>' +
        '<span>' + RB.esc(who) + ' quotes SOL into Robinhood Chain directly, so it is one ' +
        'transaction and no manual bridging.</span>', 'ok');
      document.dispatchEvent(new CustomEvent('robin:route', { detail: route }));
      return;
    }

    // Next: the chain is listed somewhere, even if Solana is not wired to it.
    if (bridge.status === 'available' && (bridge.via || []).length) {
      var name = (bridge.providers[bridge.via[0]] || {}).name || bridge.via[0];
      fundCard('<b>Bridging in works</b>' +
        '<span>' + RB.esc(name) + ' bridges into Robinhood Chain. Solana is not quoted ' +
        'directly yet, so come through Ethereum or Base.</span>', 'ok');
      return;
    }

    // Both asked and both said no: give the path that genuinely works today.
    if (bridge.status === 'none' || route.status === 'none') {
      fundCard(manualPath());
      return;
    }
    // Nobody answered either question. Saying nothing beats guessing.
  });

  RB.exchange = { open: open, load: load, tokens: function () { return S.tokens; } };
})();
