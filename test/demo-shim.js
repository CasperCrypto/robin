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

  // The forge returns a picture now. The preview can't call the image service,
  // so it answers with a pre-rendered sample of the same shape.
  var SAMPLE = 'assets/img/forge-sample.webp';

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
      if (!r.ok) throw new Error('HTTP ' + r.status);
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

    if (u.indexOf('api/ai') > -1) {
      markSample();
      return J({ image: SAMPLE, model: 'preview-sample' }, 2600);
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