/* ============================================================================
   feed.js — live trade ticker, read straight off Robinhood Chain.

   There is no trades API for this pool, so we watch ERC-20 Transfer logs and
   work out which side each one is. The pool address is auto-detected: in a
   window of recent transfers the liquidity contract is, by a wide margin, the
   address that appears most often. Tokens leaving the pool means somebody
   bought; tokens going in means somebody sold.

   Only buys are shown. Sells are still recognised so they can be excluded
   rather than mistaken for buys — flip market.showSells in config to display
   them too.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.ROBIN, RB = window.RB, $ = RB.$;

  var listEl = $('#feedList'), metaEl = $('#feedMeta'), dotEl = $('#feedDot');
  if (!listEl) return;

  var TOPIC = RB.ERC20.TRANSFER_TOPIC;
  var ZERO = '0x0000000000000000000000000000000000000000';

  var STORE_KEY = 'robin.buys.v1';
  var KEEP = 25;                      // remembered
  var SHOW = Number(C.market.feedRows) || 12;   // rendered

  var S = {
    pool: (C.market.poolContract || '').toLowerCase() || null,
    lastBlock: null,
    seen: {},            // txHash+logIndex -> true
    rows: [],
    range: 6000,         // adaptive: halves per query if the RPC refuses it
    painted: false,      // true once real buys have been rendered
    stopped: false
  };

  /* The chain only keeps a usable log window, and a quiet hour would leave the
     feed empty even though buys did happen. Remember the recent ones locally so
     the section always has history to show. */
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!Array.isArray(saved)) return;
      saved.forEach(function (r) {
        if (!r || !r.id || !r.amount) return;
        S.seen[r.id] = true;
        S.rows.push(r);
      });
      S.rows.sort(function (a, b) { return (b.block || 0) - (a.block || 0); });
      S.rows = S.rows.slice(0, KEEP);
    } catch (e) { /* private mode, quota, corrupt value — carry on empty */ }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(S.rows.slice(0, KEEP)));
    } catch (e) { /* storage unavailable; the feed still works in memory */ }
  }

  function topicAddr(t) { return '0x' + String(t).slice(-40).toLowerCase(); }

  function getLogs(from, to) {
    return RB.rpc('eth_getLogs', [{
      address: C.token.address,
      topics: [TOPIC],
      fromBlock: '0x' + from.toString(16),
      toBlock: '0x' + to.toString(16)
    }]);
  }

  /**
   * Widest window this RPC will actually serve, found by halving on failure.
   * The working width is remembered so later queries start there, but it is
   * never allowed to collapse permanently — a single refused query used to
   * shrink every subsequent one for the life of the page.
   */
  function getLogsAdaptive(from, to, width) {
    width = width || S.range;
    return getLogs(Math.max(0, to - width), to).then(function (logs) {
      S.range = Math.max(S.range, width);
      return logs;
    }, function (e) {
      if (width > 200) return getLogsAdaptive(from, to, Math.floor(width / 2));
      throw e;
    });
  }

  /** The address involved in the most transfers is the pool. */
  function detectPool(logs) {
    var tally = {};
    logs.forEach(function (l) {
      [topicAddr(l.topics[1]), topicAddr(l.topics[2])].forEach(function (a) {
        if (a === ZERO) return;
        tally[a] = (tally[a] || 0) + 1;
      });
    });
    var best = null, bestN = 0;
    Object.keys(tally).forEach(function (a) {
      if (tally[a] > bestN) { bestN = tally[a]; best = a; }
    });
    // Needs to be clearly dominant, or we're just guessing.
    return bestN >= 3 ? best : null;
  }

  function toRow(l) {
    var from = topicAddr(l.topics[1]), to = topicAddr(l.topics[2]);
    if (from === ZERO || to === ZERO) return null;          // mint / burn
    if (!S.pool) return null;
    var isBuy = from === S.pool, isSell = to === S.pool;
    if (!isBuy && !isSell) return null;                     // wallet-to-wallet
    if (isSell && !C.market.showSells) return null;         // buys only, by default

    var amount = RB.fromUnits(RB.hexToBig(l.data), C.token.decimals);
    if (!amount) return null;

    return {
      id: l.transactionHash + ':' + l.logIndex,
      buy: isBuy,
      amount: amount,
      who: isBuy ? to : from,
      tx: l.transactionHash,
      block: parseInt(l.blockNumber, 16),
      at: Date.now()
    };
  }

  /** Bigger bags, bigger dog. */
  function emoji(usd, buy) {
    if (!buy) return '📉';
    if (usd == null) return '🐕';
    if (usd >= 10000) return '🐋';
    if (usd >= 2500)  return '🦈';
    if (usd >= 500)   return '🏹';
    if (usd >= 100)   return '🐕';
    return '🐾';
  }

  function render() {
    if (!S.rows.length) {
      // Only ever show the empty state before anything has arrived. Once buys
      // are on screen they stay on screen.
      if (!S.painted) {
        listEl.innerHTML = '<div class="feed-empty">Watching the chain for the next buy…</div>';
      }
      return;
    }
    S.painted = true;
    var price = RB.market.state.priceUsd;
    listEl.innerHTML = S.rows.slice(0, SHOW).map(function (r) {
      var usd = price ? r.amount * price : null;
      return '<div class="buy' + (r.buy ? '' : ' sell') + '">' +
        '<div class="emo">' + emoji(usd, r.buy) + '</div>' +
        '<div class="info">' +
          '<div class="amt">' + (r.buy ? '+' : '\u2212') + RB.num(r.amount) + ' ROBIN' +
            (usd ? ' <span style="opacity:.6;font-weight:600">' + RB.usd(usd, { money: true }) + '</span>' : '') + '</div>' +
          '<div class="sub"><span>' + RB.shortAddr(r.who) + '</span>' +
            '<a href="' + RB.esc(RB.scan('tx', r.tx)) + '" target="_blank" rel="noopener">tx ↗</a></div>' +
        '</div>' +
        '<div class="when">' + RB.ago(r.at) + '</div>' +
      '</div>';
    }).join('');
  }

  var buyListeners = [];
  function announceBuy(row) {
    buyListeners.forEach(function (fn) { try { fn(row); } catch (e) {} });
  }

  function ingest(logs, announce) {
    var added = 0;
    logs.forEach(function (l) {
      var key = l.transactionHash + ':' + l.logIndex;
      if (S.seen[key]) return;
      var row = toRow(l);
      if (!row) {
        // Only remember it as handled once we could actually judge it. While
        // the pool is still unknown every log looks unclassifiable, and
        // marking those seen would discard them for good — the feed would then
        // stay empty even after the pool was identified.
        if (S.pool) S.seen[key] = true;
        return;
      }
      S.seen[key] = true;
      S.rows.unshift(row);
      added++;
      if (announce && row.buy) announceBuy(row);
    });
    if (added) {
      S.rows.sort(function (a, b) { return (b.block || 0) - (a.block || 0); });
      S.rows = S.rows.slice(0, KEEP);
      save();
      render();
    }
    return added;
  }

  function meta(text, live) {
    metaEl.textContent = text;
    dotEl.className = 'dot' + (live ? '' : ' off');
  }

  /* ------------------------------------------------------------ lifecycle */
  /**
   * Walk backwards from the head in windows until we have enough buys to fill
   * the feed, or run out of patience.
   *
   * A single window was the bug behind "it times out and shows nothing": if
   * the RPC refused a wide query the window shrank to a couple of hundred
   * blocks, and a couple of hundred quiet blocks meant no logs, no pool
   * detection and an empty feed for good.
   */
  var MAX_CHUNKS = 20;        // windows to walk before giving up
  var SCAN_BUDGET_MS = 20000; // …and a wall-clock ceiling, so a slow RPC
                              //    cannot leave the section spinning

  function countBuys() {
    return S.rows.filter(function (r) { return r.buy; }).length;
  }

  function scanBack(head) {
    var pending = [];
    var until = Date.now() + SCAN_BUDGET_MS;

    var step = function (i) {
      var to = head - i * S.range;
      if (i >= MAX_CHUNKS || to <= 0 || Date.now() > until) return Promise.resolve();

      return getLogsAdaptive(0, to).then(function (logs) {
        pending = pending.concat(logs);

        // More log history makes the pool easier to identify with confidence.
        if (!S.pool) {
          S.pool = detectPool(pending);
          // Say so the moment we know, rather than after the whole walk.
          if (S.pool) meta('live · pool ' + RB.shortAddr(S.pool), true);
        }

        if (S.pool) {
          ingest(pending, false);
          pending = [];
          // Full section, or enough to be useful without making the visitor
          // wait on another dozen round trips.
          if (countBuys() >= SHOW) return;
          if (i >= 5 && countBuys() > 0) return;
        }
        return step(i + 1);
      }, function () {
        // RPC gave up on this window; keep whatever we already have.
        if (S.pool && pending.length) { ingest(pending, false); pending = []; }
      });
    };

    return step(0);
  }

  function backfill() {
    return RB.rpc('eth_blockNumber').then(function (bn) {
      var head = parseInt(bn, 16);
      S.lastBlock = head;
      return scanBack(head).then(function () {
        if (!S.pool) {
          meta(S.rows.length ? 'showing saved buys' : 'waiting for pool activity', false);
          return;
        }
        meta('live · pool ' + RB.shortAddr(S.pool), true);
        render();
      });
    });
  }

  function poll() {
    if (S.stopped || document.hidden) return;
    RB.rpc('eth_blockNumber').then(function (bn) {
      var head = parseInt(bn, 16);
      if (S.lastBlock == null) { S.lastBlock = head; return; }
      if (head <= S.lastBlock) return;
      var from = Math.max(S.lastBlock + 1, head - S.range);
      return getLogsAdaptive(from, head).then(function (logs) {
        S.lastBlock = head;
        if (!S.pool) {
          S.pool = detectPool(logs);
          if (S.pool) meta('live · pool ' + RB.shortAddr(S.pool), true);
        }
        ingest(logs, true);
      });
    }).catch(function () { /* transient RPC hiccup; next tick retries */ });
  }

  load();
  if (S.rows.length) { render(); meta('showing recent buys', false); }
  else { meta('connecting…', false); }

  var readyResolve;
  var readyPromise = new Promise(function (res) { readyResolve = res; });

  backfill().then(function () { readyResolve(); }, function () { readyResolve(); })
  .catch(function () {
    meta(S.rows.length ? 'showing saved buys' : 'chain unreachable', false);
    if (!S.rows.length) {
      listEl.innerHTML = '<div class="feed-empty">Could not reach the Robinhood Chain RPC from this browser.<br>' +
        'The chart and swap still work — <a href="' + RB.esc(C.links.dexscreener) +
        '" target="_blank" rel="noopener" style="color:var(--lime-400)">open DexScreener</a>.</div>';
    }
  });

  window.RB.feed = {
    /** Called with each newly seen buy, as it lands. */
    onBuy: function (fn) { buyListeners.push(fn); },
    /** The most recent buys we know about, newest first. */
    recent: function (n) { return S.rows.filter(function (r) { return r.buy; }).slice(0, n || 8); },
    /** Resolves once the first scan has finished, so a replay has data. */
    ready: function () { return readyPromise; }
  };

  setInterval(poll, 12000);
  setInterval(function () { if (S.rows.length) render(); }, 30000);   // refresh "ago" labels
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
})();
