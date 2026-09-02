/* ============================================================================
   market.js — live price / market cap / volume / liquidity, plus a small
   JSON-RPC client for Robinhood Chain that the swap and feed reuse.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.ROBIN, RB = window.RB, $ = RB.$;

  /* ------------------------------------------------------------ JSON-RPC */
  var rpcUrls = [C.chain.rpc].concat(C.chain.rpcBackup || []).filter(Boolean);
  var rpcId = 0;

  /**
   * Single JSON-RPC call. Walks the configured endpoints until one answers,
   * so a flaky primary RPC doesn't take the page down with it.
   */
  function rpc(method, params) {
    var attempt = function (i) {
      if (i >= rpcUrls.length) return Promise.reject(new Error('All RPC endpoints failed'));
      var ctl = new AbortController();
      var timer = setTimeout(function () { ctl.abort(); }, 12000);

      return fetch(rpcUrls[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: method, params: params || [] }),
        signal: ctl.signal
      })
        .then(function (r) {
          clearTimeout(timer);
          if (!r.ok) throw new Error('RPC HTTP ' + r.status);
          return r.json();
        })
        .then(function (j) {
          if (j.error) throw new Error(j.error.message || 'RPC error');
          return j.result;
        })
        .catch(function (e) {
          clearTimeout(timer);
          if (i + 1 < rpcUrls.length) return attempt(i + 1);
          throw e;
        });
    };
    return attempt(0);
  }

  /* ---------------------------------------------------------- abi helpers */
  var ZERO64 = '0000000000000000000000000000000000000000000000000000000000000000';

  function padAddr(a) { return ZERO64.slice(0, 24) + a.replace(/^0x/, '').toLowerCase(); }
  function hexToBig(h) { return BigInt(h && h !== '0x' ? h : '0x0'); }

  /** BigInt -> Number scaled by decimals, safe for 18-decimal values. */
  function fromUnits(v, dec) {
    dec = dec == null ? 18 : dec;
    var s = v.toString().padStart(dec + 1, '0');
    return parseFloat(s.slice(0, s.length - dec) + '.' + s.slice(s.length - dec));
  }

  /** Number -> BigInt units, without float rounding artefacts. */
  function toUnits(v, dec) {
    dec = dec == null ? 18 : dec;
    var s = String(v).trim();
    if (!s || isNaN(Number(s))) return 0n;
    if (s.indexOf('e') > -1 || s.indexOf('E') > -1) s = Number(s).toFixed(dec);
    var p = s.split('.');
    var whole = p[0] || '0';
    var frac = (p[1] || '').slice(0, dec).padEnd(dec, '0');
    return BigInt(whole + frac);
  }

  function ethCall(to, data) {
    return rpc('eth_call', [{ to: to, data: data }, 'latest']);
  }

  var ERC20 = {
    totalSupply: '0x18160ddd',
    balanceOf:   '0x70a08231',
    decimals:    '0x313ce567',
    allowance:   '0xdd62ed3e',
    approve:     '0x095ea7b3',
    TRANSFER_TOPIC: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  };

  function tokenBalance(holder) {
    return ethCall(C.token.address, ERC20.balanceOf + padAddr(holder)).then(hexToBig);
  }
  function ethBalance(holder) {
    return rpc('eth_getBalance', [holder, 'latest']).then(hexToBig);
  }
  function totalSupply() {
    return ethCall(C.token.address, ERC20.totalSupply).then(hexToBig);
  }

  /* ------------------------------------------------------- dexscreener io */
  var DS = 'https://api.dexscreener.com/latest/dex/';

  function pickPair(pairs) {
    if (!pairs || !pairs.length) return null;
    // Prefer the exact pool from config; otherwise the deepest liquidity.
    var want = (C.market.poolId || '').toLowerCase();
    for (var i = 0; i < pairs.length; i++) {
      if ((pairs[i].pairAddress || '').toLowerCase() === want) return pairs[i];
    }
    return pairs.slice().sort(function (a, b) {
      return ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0);
    })[0];
  }

  function getJson(url) {
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  /** Try the exact pool endpoint, then fall back to the token-wide lookup. */
  function fetchPair() {
    var byPool = DS + 'pairs/' + C.market.dsChain + '/' + C.market.poolId;
    return getJson(byPool)
      .then(function (j) {
        var p = pickPair(j.pairs || (j.pair ? [j.pair] : []));
        if (p) return p;
        throw new Error('pool empty');
      })
      .catch(function () {
        return getJson(DS + 'tokens/' + C.token.address).then(function (j) {
          return pickPair(j.pairs);
        });
      });
  }

  /* ------------------------------------------------------------ rendering */
  var els = {
    price:  $('#sPrice'), change: $('#sChange'), mcap: $('#sMcap'),
    vol:    $('#sVol'),   liq:    $('#sLiq')
  };
  var last = {};

  function paint(id, el, text, cls) {
    if (!el) return;
    if (last[id] === text) return;
    last[id] = text;
    el.textContent = text;
    el.className = 'v' + (cls ? ' ' + cls : '');
    var stat = el.closest('.stat');
    if (stat) {
      stat.classList.remove('pulse');
      void stat.offsetWidth;              // restart the animation
      stat.classList.add('pulse');
    }
  }

  var state = {
    pair: null, priceUsd: null, priceNative: null,
    mcap: null, vol24: null, liq: null, change24: null, supply: null
  };
  var listeners = [];

  function emit() { listeners.forEach(function (fn) { try { fn(state); } catch (e) {} }); }

  function apply(p) {
    if (!p) throw new Error('no pair');
    state.pair        = p;
    state.priceUsd    = parseFloat(p.priceUsd) || null;
    state.priceNative = parseFloat(p.priceNative) || null;
    state.mcap        = p.marketCap || p.fdv || null;
    state.vol24       = (p.volume && p.volume.h24) || 0;
    state.liq         = (p.liquidity && p.liquidity.usd) || 0;
    state.change24    = (p.priceChange && p.priceChange.h24);

    paint('price', els.price, RB.usd(state.priceUsd));

    var ch = state.change24;
    if (ch == null || isNaN(ch)) paint('change', els.change, '—');
    else paint('change', els.change, (ch >= 0 ? '+' : '') + Number(ch).toFixed(1) + '%',
               ch >= 0 ? 'up' : 'down');

    // mirror price into the sticky mobile buy bar
    var bb = document.getElementById('bbPrice');
    if (bb) {
      var d = (ch == null || isNaN(ch)) ? ''
        : ' <span class="d ' + (ch >= 0 ? 'up' : 'down') + '">' +
          (ch >= 0 ? '+' : '') + Number(ch).toFixed(1) + '%</span>';
      bb.innerHTML = RB.esc(RB.usd(state.priceUsd)) + d;
    }

    paint('mcap', els.mcap, RB.usd(state.mcap));
    paint('vol',  els.vol,  RB.usd(state.vol24));
    paint('liq',  els.liq,  RB.usd(state.liq));
    emit();
  }

  function fail() {
    ['price', 'change', 'mcap', 'vol', 'liq'].forEach(function (k) {
      if (last[k] == null) paint(k, els[k], '—');
    });
    emit();
  }

  var timer = null;
  function refresh() {
    return fetchPair().then(apply).catch(function (e) {
      // Keep whatever we last rendered; a blip shouldn't blank the page.
      if (!state.pair) fail();
    });
  }

  function start() {
    refresh();
    clearInterval(timer);
    timer = setInterval(function () {
      if (document.hidden) return;      // don't burn the API in a background tab
      refresh();
    }, Math.max(10000, C.market.refreshMs || 30000));
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });

  // Real supply, straight from the contract.
  totalSupply().then(function (s) {
    state.supply = fromUnits(s, C.token.decimals);
    emit();
  }).catch(function () { state.supply = C.token.supply; });

  start();

  /* ------------------------------------------------------------- exports */
  window.RB = window.RB || {};
  window.RB.rpc         = rpc;
  window.RB.ethCall     = ethCall;
  window.RB.ERC20       = ERC20;
  window.RB.padAddr     = padAddr;
  window.RB.hexToBig    = hexToBig;
  window.RB.fromUnits   = fromUnits;
  window.RB.toUnits     = toUnits;
  window.RB.tokenBalance= tokenBalance;
  window.RB.ethBalance  = ethBalance;
  window.RB.market      = {
    state: state,
    refresh: refresh,
    onUpdate: function (fn) { listeners.push(fn); if (state.pair) fn(state); }
  };
})();
