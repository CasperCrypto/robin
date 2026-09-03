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

  /* A sample jackpot, for a preview that cannot reach PHP. Built around the
     real clock so the countdown genuinely counts down. */
  function sampleArena() {
    var now = Math.floor(Date.now() / 1000), live = Math.floor(now / 90);
    var W = ['0x8f2a1b4c5d6e7f8091a2b3c4d5e6f70819a2b3c4',
             '0x41d9c0aabbccddeeff00112233445566778899aa',
             '0xbb70e2001122334455667788990011223344556f',
             '0x0d34af99887766554433221100ffeeddccbbaa99'];
    var entries = [{ addr: W[0], stake: 2000 }, { addr: W[1], stake: 1200 },
                   { addr: W[2], stake: 700 },  { addr: W[3], stake: 400 }];
    var pot = 4300;
    var prev = {
      id: live - 1, startsAt: (live - 1) * 90, closesAt: (live - 1) * 90 + 65, endsAt: live * 90,
      phase: 'settled', pot: 3100, winner: W[1], ticket: 2210,
      seedHash: 'd41d8cd98f00b204e9800998ecf8427e11223344556677889900aabbccddeeff',
      seed: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      entries: [{ addr: W[0], stake: 1500 }, { addr: W[1], stake: 1000 }, { addr: W[2], stake: 600 }],
      reaction: 'The one who staked least walks off with the lot. Typical.'
    };
    var recent = [prev];
    for (var i = 2; i <= 8; i++) {
      recent.push({ id: live - i, phase: i === 4 ? 'void' : 'settled', pot: 1200 + i * 300,
                    winner: W[i % 4], ticket: 100 * i, entries: [], seed: null, seedHash: null });
    }
    return {
      now: now, roundSec: 90, entrySec: 65, minStake: 50,
      live: { id: live, startsAt: live * 90, closesAt: live * 90 + 65, endsAt: (live + 1) * 90,
              phase: 'entry', pot: pot, entries: entries, winner: null, ticket: null,
              seedHash: 'a3bf4f1b2b0b822cd15d6c15b0f00a08d41d8cd98f00b204e9800998ecf8427e',
              seed: null, reaction: null },
      last: prev,
      you: { points: 2600, staked: 400, won: 3100, wins: 3, rounds: 11, biggest: 3100,
             tier: 'Outlaw', claimIn: 0 },
      top: [
        { addr: W[0], points: 9400, won: 12800, wins: 6, rounds: 21, biggest: 5200, tier: 'Sheriff' },
        { addr: W[1], points: 5200, won: 7100,  wins: 4, rounds: 18, biggest: 3100, tier: 'Outlaw' },
        { addr: W[3], points: 2600, won: 3100,  wins: 3, rounds: 11, biggest: 3100, tier: 'Outlaw' },
        { addr: W[2], points: 900,  won: 1400,  wins: 1, rounds: 9,  biggest: 1400, tier: 'Archer' }
      ],
      recent: recent,
      tiers: [
        { name: 'Sheriff', min: 5000000, daily: 10000 }, { name: 'Outlaw', min: 1000000, daily: 4000 },
        { name: 'Archer', min: 250000, daily: 1500 }, { name: 'Scout', min: 50000, daily: 500 }
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

    if (u.indexOf('api/route') > -1) {
      // The honest state today: providers answer, and none of them quote
      // Solana into this chain.
      return passthroughOr(url, opts, function () {
        return J({ from: 'solana', toChain: 4663, status: 'none', via: [],
                   providers: { lifi: { name: 'LI.FI', reachable: true, route: false,
                                        status: 404, said: 'no route found for this pair' } },
                   checkedAt: Math.floor(Date.now() / 1000) }, 220);
      });
    }

    if (u.indexOf('api/tokens') > -1 || u.indexOf('api/bridge') > -1) {
      // The preview cannot reach PHP, so it shows a plausible chain rather than
      // an empty picker — and reports the bridge as genuinely unavailable,
      // which is the honest state today.
      return passthroughOr(url, opts, function () {
        if (u.indexOf('api/bridge') > -1) {
          return J({ chainId: 4663, status: 'none', via: [],
                     providers: { lifi: { name: 'LI.FI', reachable: true, supports: false } },
                     checkedAt: Math.floor(Date.now() / 1000) }, 200);
        }
        return J({ count: 4, reached: { explorer: true, dexscreener: true }, tokens: [
          { address: '0x280413fbf06ccc1114094a5967db2191d49ee75e', name: 'Robin Nakamoto',
            symbol: 'ROBIN', decimals: 18, priceUsd: 0.00007012, priceNative: 0.00000002,
            liquidity: 41800, volume24h: 18400, change24h: 12.6, holders: 412 },
          { address: '0xaaaa13fbf06ccc1114094a5967db2191d49ee75e', name: 'Hood Cat',
            symbol: 'HCAT', decimals: 18, priceUsd: 1.25, priceNative: 0.0003,
            liquidity: 260000, volume24h: 91000, change24h: -3.1, holders: 900 },
          { address: '0xcccc13fbf06ccc1114094a5967db2191d49ee75e', name: 'Feather',
            symbol: 'FTHR', decimals: 18, priceUsd: 0.0042, priceNative: 0.0000011,
            liquidity: 88000, volume24h: 12400, change24h: 41.2, holders: 260 },
          { address: '0xdddd13fbf06ccc1114094a5967db2191d49ee75e', name: 'Sherwood',
            symbol: 'SHWD', decimals: 18, priceUsd: 0.19, priceNative: 0.00005,
            liquidity: 15600, volume24h: 3100, change24h: 2.4, holders: 74 }
        ], updatedAt: Math.floor(Date.now() / 1000) }, 260);
      });
    }

    if (u.indexOf('api/room') > -1) {
      // A preview with no PHP still shows a room, so the rail is not a dead
      // control — but it invents a plausible crowd rather than claiming a real
      // one, and says so through the sandbox badge like everything else here.
      return passthroughOr(url, opts, function () {
        var body = {}; try { body = JSON.parse(opts.body); } catch (e) {}
        var pool = ['🚀', '🏹', '🐕', '💎', '🔥', '😂'];
        var out = [];
        if (body.since >= 0 && Math.random() < 0.55) {
          for (var i = 0; i < 1 + ((Math.random() * 2) | 0); i++) {
            out.push(pool[(Math.random() * pool.length) | 0]);
          }
        }
        return J({ here: 9 + ((Math.random() * 5) | 0), reactions: out,
                   cursor: (body.since || 0) + out.length, sent: !!body.react, emoji: pool }, 120);
      });
    }

    if (u.indexOf('api/arena') > -1) {
      // Joining a round is never faked: a sample "you're in" for an entry that
      // was never recorded would be a straight lie to the player.
      if (/a=(join|claim)/.test(u)) return real ? real(url, opts) : Promise.reject(new Error('blocked'));
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