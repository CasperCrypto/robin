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
    range: 6000,         // adaptive: shrinks if the RPC rejects wide queries
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

  /** Widest window this RPC will actually serve, found by halving on failure. */
  function getLogsAdaptive(from, to) {
    return getLogs(from, to).catch(function (e) {
      if (S.range > 200) {
        S.range = Math.floor(S.range / 2);
        return getLogsAdaptive(Math.max(from, to - S.range), to);
      }
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
      listEl.innerHTML = '<div class="feed-empty">Watching the chain for the next buy…</div>';
      return;
    }
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

  function ingest(logs, announce) {
    var added = 0;
    logs.forEach(function (l) {
      var key = l.transactionHash + ':' + l.logIndex;
      if (S.seen[key]) return;
      var row = toRow(l);
      if (!row) { S.seen[key] = true; return; }
      S.seen[key] = true;
      S.rows.unshift(row);
      added++;
      if (announce && row.buy) {
        var price = RB.market.state.priceUsd;
        var usd = price ? row.amount * price : null;
        RB.toast('New buy: ' + RB.num(row.amount) + ' ROBIN' + (usd ? ' (' + RB.usd(usd, { money: true }) + ')' : ''),
                 'ok', { href: RB.scan('tx', row.tx), text: 'View' });
      }
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
  function backfill() {
    return RB.rpc('eth_blockNumber').then(function (bn) {
      var head = parseInt(bn, 16);
      var from = Math.max(0, head - S.range);
      return getLogsAdaptive(from, head).then(function (logs) {
        S.lastBlock = head;
        if (!S.pool) S.pool = detectPool(logs);
        if (!S.pool) {
          meta('waiting for pool activity', false);
          return;
        }
        ingest(logs, false);
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

  backfill().catch(function () {
    meta(S.rows.length ? 'showing saved buys' : 'chain unreachable', false);
    if (!S.rows.length) {
      listEl.innerHTML = '<div class="feed-empty">Could not reach the Robinhood Chain RPC from this browser.<br>' +
        'The chart and swap still work — <a href="' + RB.esc(C.links.dexscreener) +
        '" target="_blank" rel="noopener" style="color:var(--lime-400)">open DexScreener</a>.</div>';
    }
  });

  setInterval(poll, 12000);
  setInterval(function () { if (S.rows.length) render(); }, 30000);   // refresh "ago" labels
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
})();
