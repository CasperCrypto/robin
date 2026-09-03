/* ── PREVIEW ONLY ────────────────────────────────────────────────────────
   The published preview is sandboxed and cannot reach DexScreener or the
   Robinhood Chain RPC, so this shim answers those calls with representative
   sample data. It exists only in the preview build — the files you upload
   talk to the real endpoints. */
(function () {
  var PAIR = {
    pairAddress: '0x7d8a56584434d8355b891da0ff62d9168669f87dd9c8ad77f6c8fb0a6b6eb7d7',
    baseToken:  { address: '0x280413fbF06CcC1114094A5967dB2191d49EE75e', symbol: 'ROBIN' },
    quoteToken: { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH' },
    // Roughly where $ROBIN actually sits, so the preview is not misleading.
    // The live site ignores all of this and reads DexScreener directly.
    priceUsd: '0.00007012', priceNative: '0.0000000234',
    priceChange: { h24: 12.6 }, volume: { h24: 38400 },
    liquidity: { usd: 24800 }, marketCap: 70120, fdv: 70120,
    txns: { h24: { buys: 143, sells: 88 } }
  };
  var POOL = '0x7d8a56584434d8355b891da0ff62d9168669f87dd9c8ad77f6c8fb0a6b6eb7d7'.slice(0,42);
  var TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  var pad = function (a) { return '0x' + a.replace(/^0x/,'').toLowerCase().padStart(64,'0'); };
  var rnd = function () { return '0x' + Array.from({length:40},function(){return '0123456789abcdef'[Math.floor(Math.random()*16)]}).join(''); };
  var block = 1284410, served = 0;

  function makeLogs(n, first) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var buy = Math.random() > 0.32;
      var amt = BigInt(Math.floor((Math.random() * (first ? 900000 : 260000)) + 800)) * (10n ** 18n);
      var w = rnd();
      out.push({
        topics: [TOPIC, pad(buy ? POOL : w), pad(buy ? w : POOL)],
        data: '0x' + amt.toString(16).padStart(64, '0'),
        transactionHash: '0x' + Array.from({length:64},function(){return '0123456789abcdef'[Math.floor(Math.random()*16)]}).join(''),
        logIndex: '0x' + i.toString(16),
        blockNumber: '0x' + (block++).toString(16)
      });
    }
    return out;
  }

  /* A sample scan, for a preview that cannot reach PHP. Deliberately the real
     token with its real shape — the point of the preview is to show what the
     panel looks like, and inventing a scary verdict for $ROBIN would be a lie
     told about our own token. */
  var SAMPLE_SCAN = {
    address: '0x280413fbf06ccc1114094a5967db2191d49ee75e',
    name: 'Robin Nakamoto', symbol: 'ROBIN',
    verdict: 'ok', label: 'Nothing alarming',
    stats: { price: 0.00007012, mcap: 70120, liquidity: 41800,
             volume24h: 18400, holders: 412, supply: 1e9, ageHours: 320, verified: true },
    findings: [
      { level: 'good', what: 'Contract source is verified',
        why: 'Anyone can read exactly what this contract does on the explorer.' },
      { level: 'good', what: 'No mint function found', why: 'The supply cannot be increased.' },
      { level: 'good', what: 'Liquidity is locked',
        why: 'The Pons launch pool is permanently locked; nobody can pull it.' },
      { level: 'warn', what: 'Fees can be changed after launch',
        why: 'The owner can alter the buy or sell tax. Check what it is set to now.' }
    ],
    top: [
      { address: '0x7d8a56584434d8355b891da0ff62d9168669f87d', pct: 61.4, isContract: true },
      { address: '0x2f9c8b1a4e5d7c3b6a8f0e1d2c4b5a6978f3e2d1', pct: 3.0, isContract: false }
    ],
    summary: 'Supply is fixed and the pool is locked, which rules out the two things '
           + 'that usually go wrong. The one thing to keep an eye on is that the tax '
           + 'is still adjustable by the owner. This is a preview sample, not a live scan.',
    unreachable: [], scannedAt: Math.floor(Date.now() / 1000)
  };

  /* A sample arena, for a preview that cannot reach PHP. Built around the real
     clock so the countdown genuinely counts down and the round really does turn
     over while you watch it. */
  function sampleArena() {
    var now = Math.floor(Date.now() / 1000), live = Math.floor(now / 300);
    var px = PAIR.priceUsd ? parseFloat(PAIR.priceUsd) : 0.00007012;
    var wallets = ['0x8f2a1b4c5d6e7f8091a2b3c4d5e6f70819a2b3c4',
                   '0x41d9c0aabbccddeeff00112233445566778899aa',
                   '0xbb70e2001122334455667788990011223344556f',
                   '0x0d34af99887766554433221100ffeeddccbbaa99',
                   '0x9c1e58123456789abcdef0123456789abcdef012'];
    var recent = [];
    for (var i = 1; i <= 12; i++) {
      var up = [1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0][i - 1] === 1;
      recent.push({
        id: live - i, status: i === 5 ? 'void' : 'settled',
        lockPrice: px, settlePrice: up ? px * 1.01 : px * 0.99,
        robinSide: up ? 'UP' : 'DOWN', robinWon: i % 3 !== 0, up: 6 + i, down: 4 + (i % 5),
        joins: []
      });
    }
    return {
      now: now, roundSec: 300, price: px,
      live: { id: live, startsAt: live * 300, endsAt: (live + 1) * 300, status: 'live',
              lockPrice: px * 0.9976, settlePrice: null, robinSide: 'UP',
              up: 14, down: 9, joins: [] },
      open: { id: live + 1, startsAt: (live + 1) * 300, endsAt: (live + 2) * 300, status: 'open',
              lockPrice: null, settlePrice: null,
              robinSide: 'DOWN',
              robinNote: 'Three buys in a row and no follow-through. I fade that every time.',
              up: 5, down: 8,
              joins: wallets.map(function (w, i) {
                return { addr: w, side: i % 3 === 0 ? 'UP' : 'DOWN', tier: 'Archer' };
              }) },
      yourLive: { side: 'UP', tier: 'Outlaw', mult: 2, won: null, points: 0 },
      yourOpen: null,
      you: { points: 1450, wins: 9, played: 14, streak: 2, best: 5, tier: 'Outlaw', last: null },
      robin: { wins: 14, rounds: 23 },
      top: [
        { addr: '0x8f2a1b4c5d6e7f8091a2b3c4d5e6f70819a2b3c4', points: 3200, wins: 21, played: 30, streak: 4, best: 7, tier: 'Sheriff' },
        { addr: '0x41d9c0aabbccddeeff00112233445566778899aa', points: 2150, wins: 15, played: 24, streak: 0, best: 5, tier: 'Outlaw' },
        { addr: '0xbb70e2001122334455667788990011223344556f', points: 1450, wins: 9,  played: 14, streak: 2, best: 5, tier: 'Outlaw' },
        { addr: '0x0d34af99887766554433221100ffeeddccbbaa99', points: 900,  wins: 6,  played: 13, streak: 1, best: 3, tier: 'Archer' },
        { addr: '0x9c1e58123456789abcdef0123456789abcdef012', points: 400,  wins: 3,  played: 9,  streak: 0, best: 2, tier: 'Scout' }
      ],
      recent: recent,
      tiers: [
        { name: 'Sheriff', min: 5000000, mult: 3 }, { name: 'Outlaw', min: 1000000, mult: 2 },
        { name: 'Archer', min: 250000, mult: 1.5 }, { name: 'Scout', min: 50000, mult: 1 }
      ]
    };
  }

  var real = window.fetch ? window.fetch.bind(window) : null;

  /* Mark the page as running on samples — only ever called if a real request
     actually failed, so a preview that CAN reach the network stays honest. */
  var fellBack = false;
  function markSample() {
    if (fellBack) return;
    fellBack = true;
    document.documentElement.setAttribute('data-preview-sample', '1');
  }

  function J(obj, ms) {
    return new Promise(function (res) {
      setTimeout(function () {
        res({ ok: true, status: 200, json: function () { return Promise.resolve(obj); } });
      }, ms || 200);
    });
  }

  /* Try the real endpoint first. The published preview is sandboxed and the
     request will be refused, which is when — and only when — we substitute a
     sample. Open this file from disk and you get genuinely live numbers. */
  function passthroughOr(url, opts, fallback) {
    // No fetch at all is still a fallback, and must be flagged as one.
    if (!real) { markSample(); return fallback(); }
    return real(url, opts).then(function (r) {
      // A 4xx is the server answering — "you are already in this round", "that
      // is not an address". Substituting a sample for one of those turns a
      // refusal into a fake success, which is worse than showing nothing.
      // Only a transport failure or a server error means we could not ask.
      if (r.status >= 500) throw new Error('HTTP ' + r.status);
      return r;
    }).catch(function () {
      markSample();
      return fallback();
    });
  }

  window.fetch = function (url, opts) {
    var u = String(url && url.url ? url.url : url);

    if (u.indexOf('dexscreener') > -1) {
      return passthroughOr(url, opts, function () { return J({ pairs: [PAIR] }); });
    }

    if (u.indexOf('chain.robinhood.com') > -1) {
      return passthroughOr(url, opts, function () {
        var b = {}; try { b = JSON.parse(opts.body); } catch (e) {}
        if (b.method === 'eth_blockNumber') return J({ result: '0x' + (block).toString(16) }, 90);
        if (b.method === 'eth_getLogs')     return J({ result: makeLogs(served++ ? 1 : 9, !served) }, 200);
        if (b.method === 'eth_getBalance')  return J({ result: '0x' + (842000000000000000n).toString(16) }, 80);
        if (b.method === 'eth_call') {
          var sel = (b.params && b.params[0] && b.params[0].data || '').slice(0, 10);
          var v = sel === '0x70a08231' ? 1240000n * 10n ** 18n : 10n ** 27n;
          return J({ result: '0x' + v.toString(16).padStart(64, '0') }, 90);
        }
        return J({ result: '0x0' }, 60);
      });
    }

    if (u.indexOf('api/scan') > -1) {
      return passthroughOr(url, opts, function () { return J(SAMPLE_SCAN, 1800); });
    }

    if (u.indexOf('api/arena') > -1) {
      // Joining a round is never faked: a sample "you're in" for an entry that
      // was never recorded would be a straight lie to the player.
      if (u.indexOf('a=join') > -1) return real ? real(url, opts) : Promise.reject(new Error('blocked'));
      return passthroughOr(url, opts, function () { return J(sampleArena(), 300); });
    }

    return real ? real(url, opts) : Promise.reject(new Error('blocked'));
  };

  // No injected wallet in the sandbox: make the swap panel demonstrable.
  var acct = '0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045';   // a well-known public address, preview only
  window.ethereum = {
    isMetaMask: true,
    request: function (r) {
      if (r.method === 'eth_requestAccounts' || r.method === 'eth_accounts') return Promise.resolve([acct]);
      if (r.method === 'eth_chainId') return Promise.resolve('0x1237');
      if (r.method === 'wallet_switchEthereumChain') return Promise.resolve(null);
      if (r.method === 'eth_sendTransaction') return Promise.reject({ code: 4001, message: 'Preview mode — no real transaction was sent' });
      return Promise.resolve(null);
    },
    on: function () {}
  };
})();