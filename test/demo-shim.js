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
    priceUsd: '0.00042137', priceNative: '0.000000112',
    priceChange: { h24: 18.4 }, volume: { h24: 128450 },
    liquidity: { usd: 96200 }, marketCap: 421370, fdv: 421370,
    txns: { h24: { buys: 214, sells: 97 } }
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

  var AI = {
    chat: "**Short version:** bridge a little ETH to Robinhood Chain, connect your wallet, and swap on this page.\\n\\n- Gas on chain 4663 is paid in **ETH**, so keep a few dollars of it spare\\n- Always check the contract reads `0x2804...E75e` before confirming\\n- Liquidity sits in a locked Uniswap V4 pool, so the pair won't vanish under you\\n\\nIt's still a memecoin — only put in what you'd shrug off losing.",
    alpha: "$ROBIN is trading around $0.00042 with a market cap near $421K, up roughly 18% on the day.\\n\\nThe more interesting number is liquidity: about $96K against that market cap, which is a ratio of roughly 1:4.4. That's unusually deep for a token this size and it means moderate size can move in and out without wrecking the chart.\\n\\nFlow is skewed to the bid — 214 buys against 97 sells over 24 hours, on $128K of volume. Volume running at ~30% of market cap says this is being actively traded rather than sitting still.\\n\\nWhat it doesn't tell you is whether any of that persists. Two-to-one buy pressure on a day-old memecoin is a mood, not a trend.\\n\\nNone of this is financial advice.",
    meme: "They gave 30% of the supply to the man who created Dogecoin.\\n\\nNot a partnership. Not an ad deal. Just sent it.\\n\\n$ROBIN\\n---\\nrobin hood stole from the rich and gave to the poor\\n\\n$ROBIN sent 30% of supply to Billy Markus and locked the rest of the liquidity forever\\n\\nsame energy, better chain 🏹\\n---\\nfixed supply. locked LP. no team unlocks. 30% with Dogecoin's co-creator.\\n\\nthe boring stuff is done properly so the fun stuff can be fun.\\n\\n$ROBIN on Robinhood Chain #ROBIN"
  };

  var real = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, opts) {
    var u = String(url && url.url ? url.url : url);
    var J = function (obj, ms) {
      return new Promise(function (res) {
        setTimeout(function () { res({ ok: true, status: 200, json: function () { return Promise.resolve(obj); } }); }, ms || 260);
      });
    };
    if (u.indexOf('dexscreener') > -1) return J({ pairs: [PAIR] });
    if (u.indexOf('chain.robinhood.com') > -1) {
      var b = {}; try { b = JSON.parse(opts.body); } catch (e) {}
      if (b.method === 'eth_blockNumber') return J({ result: '0x' + (block).toString(16) }, 90);
      if (b.method === 'eth_getLogs')     return J({ result: makeLogs(served++ ? 1 : 9, !served) }, 200);
      if (b.method === 'eth_getBalance')  return J({ result: '0x' + (842000000000000000n).toString(16) }, 80);
      if (b.method === 'eth_call') {
        var sel = (b.params && b.params[0] && b.params[0].data || '').slice(0, 10);
        // balanceOf -> a plausible bag; totalSupply -> the real fixed supply
        var v = sel === '0x70a08231' ? 1240000n * 10n ** 18n : 10n ** 27n;
        return J({ result: '0x' + v.toString(16).padStart(64, '0') }, 90);
      }
      return J({ result: '0x0' }, 60);
    }
    if (u.indexOf('api/ai') > -1) {
      var mode = 'chat'; try { mode = JSON.parse(opts.body).mode || 'chat'; } catch (e) {}
      return J({ text: AI[mode] || AI.chat }, 1100);
    }
    return real ? real(url, opts) : Promise.reject(new Error('blocked'));
  };

  // No injected wallet in the sandbox: make the swap panel demonstrable.
  var acct = '0x017332784f7a5c577996168E683611949570E907';
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