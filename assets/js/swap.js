/* ============================================================================
   swap.js — the swap panel.

   Two execution modes, chosen in config.js:
     'handoff'  zero-config. Quote, balances and validation happen here, then
                the trade opens in the Uniswap app with everything pre-filled.
     'v4'       fully on-page. Builds Universal Router calldata for a Uniswap
                V4 exact-input swap and sends it from the user's wallet.

   The v4 path refuses to run unless the configured PoolKey actually hashes to
   the pool id in config — a mistyped address should never cost anyone money.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.ROBIN, RB = window.RB, $ = RB.$;
  var W = RB.wallet, K = RB.k;

  var NATIVE = '0x0000000000000000000000000000000000000000';
  var MAX_UINT = (1n << 256n) - 1n;
  var MAX_UINT160 = (1n << 160n) - 1n;

  /* ═══════════════════════════════════════════════════ minimal abi encoder */
  function w(v) {
    var b = typeof v === 'bigint' ? v : BigInt(v);
    if (b < 0n) b = (1n << 256n) + b;                 // two's complement
    return b.toString(16).padStart(64, '0');
  }
  function wAddr(a) { return w(BigInt(a)); }
  function strip(h) { return (h || '').replace(/^0x/, ''); }
  function dynBytes(hexData) {
    var d = strip(hexData);
    var pad = d.length % 64 === 0 ? 0 : 64 - (d.length % 64);
    return w(d.length / 2) + d + '0'.repeat(pad);
  }
  /** abi.encode(bytes, bytes[]) */
  function encodeActions(actionsHex, paramWords) {
    var actions = dynBytes(actionsHex);
    var arrHead = w(paramWords.length);
    var offs = '', body = '', cursor = paramWords.length * 32;
    paramWords.forEach(function (p) {
      offs += w(cursor);
      var enc = dynBytes(p);
      body += enc;
      cursor += enc.length / 2;
    });
    var arr = arrHead + offs + body;
    // two dynamic heads: actions at 0x40, array right after actions
    var head = w(0x40) + w(0x40 + actions.length / 2);
    return '0x' + head + actions + arr;
  }

  /* ═══════════════════════════════════════════════════════════ pool key io */
  // Read lazily so editing config at runtime (or in tests) is picked up.
  function PK() { return C.swap.poolKey || {}; }

  function poolKeyWords() {
    var k = PK();
    return wAddr(k.currency0) + wAddr(k.currency1) +
           w(k.fee) + w(k.tickSpacing) + wAddr(k.hooks);
  }
  /** poolId = keccak256(abi.encode(PoolKey)) — our sanity check on config. */
  function computePoolId() { return K.keccak256('0x' + poolKeyWords()); }

  function poolKeyLooksSet() {
    var k = PK();
    return k.currency1 && k.hooks && /^0x[0-9a-fA-F]{40}$/.test(k.hooks);
  }
  function poolKeyVerified() {
    if (!poolKeyLooksSet()) return false;
    try {
      return computePoolId().toLowerCase() === String(C.market.poolId).toLowerCase();
    } catch (e) { return false; }
  }

  /** Is on-page V4 execution actually safe to attempt right now? */
  function v4Ready() {
    return C.swap.mode === 'v4' &&
           /^0x[0-9a-fA-F]{40}$/.test(C.swap.universalRouter || '') &&
           /^0x[0-9a-fA-F]{40}$/.test(C.swap.permit2 || '') &&
           poolKeyVerified();
  }

  /* ═══════════════════════════════════════════════════════ calldata build */
  var ACT = { SWAP_EXACT_IN_SINGLE: '06', SETTLE_ALL: '0c', TAKE_ALL: '0f' };
  var SEL = {
    execute: K.selector('execute(bytes,bytes[],uint256)'),
    p2approve: K.selector('approve(address,address,uint160,uint48)'),
    approve: K.selector('approve(address,uint256)'),
    allowance: K.selector('allowance(address,address)')
  };

  /**
   * ExactInputSingleParams = (PoolKey, bool zeroForOne, uint128 amountIn,
   *                          uint128 amountOutMinimum, bytes hookData)
   * One dynamic member, so abi.encode prefixes a struct offset.
   */
  function encExactInSingle(zeroForOne, amountIn, minOut) {
    var body = poolKeyWords() + w(zeroForOne ? 1 : 0) + w(amountIn) + w(minOut) +
               w(0x120) + w(0);          // hookData offset (9 words in), length 0
    return '0x' + w(0x20) + body;
  }

  function buildSwapTx(dir, amountIn, minOut, deadline) {
    // currency0 is the lower address; buying ROBIN with ETH means 0 -> 1.
    var k = PK();
    var zeroForOne = dir === 'buy';
    var currIn  = zeroForOne ? k.currency0 : k.currency1;
    var currOut = zeroForOne ? k.currency1 : k.currency0;

    var actions = ACT.SWAP_EXACT_IN_SINGLE + ACT.SETTLE_ALL + ACT.TAKE_ALL;
    var params = [
      encExactInSingle(zeroForOne, amountIn, minOut),
      '0x' + wAddr(currIn) + w(amountIn),      // SETTLE_ALL
      '0x' + wAddr(currOut) + w(minOut)        // TAKE_ALL
    ];

    var input = encodeActions('0x' + actions, params);
    var cmdEnc = dynBytes('0x10');             // commands = V4_SWAP
    var inputsArr = w(1) + w(0x20) + dynBytes(input);   // bytes[] with one element

    // execute(bytes commands, bytes[] inputs, uint256 deadline)
    var data = SEL.execute +
      w(0x60) +                                // -> commands
      w(0x60 + cmdEnc.length / 2) +            // -> inputs
      w(deadline) +
      cmdEnc + inputsArr;

    return {
      to: C.swap.universalRouter,
      data: data,
      value: currIn === NATIVE ? '0x' + amountIn.toString(16) : '0x0'
    };
  }

  /* ═════════════════════════════════════════════════════════════ ui state */
  var el = {
    amtIn: $('#amtIn'), amtOut: $('#amtOut'),
    symFrom: $('#symFrom'), symTo: $('#symTo'),
    icoFrom: $('#icoFrom'), icoTo: $('#icoTo'),
    balFrom: $('#balFrom'), balTo: $('#balTo'),
    fiatIn: $('#fiatIn'), fiatOut: $('#fiatOut'),
    rate: $('#mRate'), min: $('#mMin'),
    btn: $('#swapBtn'), note: $('#swapNote'),
    dot: $('#netDot'), label: $('#netLabel'),
    slip: $('#slip'), presets: $('#presets'), fee: $('#mFee'),
    flip: $('#flipBtn'), max: $('#maxBtn')
  };

  var S = { dir: 'buy', slippage: C.swap.slippageDefault || 5, busy: false, bal: {} };

  var ICON_ETH = '<svg viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="12" fill="#627eea"/><path d="M12 3.5v6.3l5.2 2.3z" fill="#fff" fill-opacity=".6"/><path d="M12 3.5L6.8 12.1 12 9.8z" fill="#fff"/><path d="M12 16.1v4.4l5.2-7.2z" fill="#fff" fill-opacity=".6"/><path d="M12 20.5v-4.4l-5.2-2.8z" fill="#fff"/><path d="M12 15.1l5.2-3-5.2-2.3z" fill="#fff" fill-opacity=".2"/><path d="M6.8 12.1l5.2 3V9.8z" fill="#fff" fill-opacity=".6"/></svg>';
  var ICON_ROBIN = '<img src="assets/img/robin-logo-128.png" width="26" height="26" alt="" ' +
                   'style="border-radius:50%" loading="lazy" decoding="async">';

  function note(text, kind) {
    var icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>';
    el.note.className = 'swap-note' + (kind ? ' ' + kind : '');
    el.note.innerHTML = icon + '<span>' + text + '</span>';
  }

  /* -------------------------------------------------------------- pricing */
  /** ETH per ROBIN and USD per ETH, derived from the live pair. */
  function prices() {
    var m = RB.market.state;
    if (!m.pair || !m.priceNative) return null;
    var base = (m.pair.baseToken && m.pair.baseToken.address || '').toLowerCase();
    var isBase = base === C.token.address.toLowerCase();
    var ethPerRobin = isBase ? m.priceNative : (m.priceNative ? 1 / m.priceNative : null);
    if (!ethPerRobin) return null;
    var usdPerRobin = m.priceUsd;
    var usdPerEth = usdPerRobin && ethPerRobin ? usdPerRobin / ethPerRobin : null;
    return { ethPerRobin: ethPerRobin, usdPerRobin: usdPerRobin, usdPerEth: usdPerEth };
  }

  /** Fee the pool's hook takes, as a multiplier on the output. */
  function feeMult() {
    var f = Number(C.swap.feePct) || 0;
    return 1 - Math.min(Math.max(f, 0), 50) / 100;
  }

  /**
   * Expected output at the current mid-price, after the hook's fee.
   *
   * DexScreener reports the pool mid-price, which knows nothing about the
   * Pons hook, so the raw figure is optimistic by exactly the fee. Subtract it
   * here and every downstream number — the estimate, the fiat line, and the
   * minimum-received that guards the trade — is honest.
   */
  function quote(amountIn) {
    var p = prices();
    if (!p || !amountIn || amountIn <= 0) return null;
    var gross = S.dir === 'buy' ? amountIn / p.ethPerRobin : amountIn * p.ethPerRobin;
    return gross * feeMult();
  }

  /* --------------------------------------------------------------- render */
  function render() {
    var buy = S.dir === 'buy';
    el.symFrom.textContent = buy ? 'ETH' : 'ROBIN';
    el.symTo.textContent   = buy ? 'ROBIN' : 'ETH';
    el.icoFrom.innerHTML   = buy ? ICON_ETH : ICON_ROBIN;
    el.icoTo.innerHTML     = buy ? ICON_ROBIN : ICON_ETH;

    var p = prices();
    var amtIn = parseFloat(el.amtIn.value);
    var out = quote(amtIn);

    el.amtOut.value = out ? RB.num(out, out < 1 ? 8 : 4) : '';

    // fiat hints
    if (p && amtIn > 0) {
      var usdIn = buy ? amtIn * (p.usdPerEth || 0) : amtIn * (p.usdPerRobin || 0);
      el.fiatIn.textContent = usdIn ? '≈ ' + RB.usd(usdIn, { exact: true }) : '';
    } else { el.fiatIn.textContent = ''; }

    if (p && out > 0) {
      var usdOut = buy ? out * (p.usdPerRobin || 0) : out * (p.usdPerEth || 0);
      el.fiatOut.textContent = usdOut ? '≈ ' + RB.usd(usdOut, { exact: true }) : '';
    } else { el.fiatOut.textContent = ''; }

    // rate + minimum received
    if (p) {
      el.rate.textContent = buy
        ? '1 ETH ≈ ' + RB.num(1 / p.ethPerRobin) + ' ROBIN'
        : '1 ROBIN ≈ ' + RB.usd(p.usdPerRobin);
    } else { el.rate.textContent = '—'; }

    el.min.textContent = out
      ? RB.num(out * (1 - S.slippage / 100), 4) + ' ' + (buy ? 'ROBIN' : 'ETH')
      : '—';

    if (el.fee) {
      var f = Number(C.swap.feePct) || 0;
      el.fee.textContent = f ? f + '%' : 'None';
    }

    // balances
    var bE = S.bal.eth != null ? RB.fromUnits(S.bal.eth, 18) : null;
    var bR = S.bal.robin != null ? RB.fromUnits(S.bal.robin, C.token.decimals) : null;
    el.balFrom.textContent = buy ? (bE != null ? RB.num(bE, 5) : '—') : (bR != null ? RB.num(bR) : '—');
    el.balTo.textContent   = buy ? (bR != null ? RB.num(bR) : '—') : (bE != null ? RB.num(bE, 5) : '—');

    paintButton(amtIn, bE, bR);
  }

  function paintButton(amtIn, bE, bR) {
    var b = el.btn;
    b.removeAttribute('aria-disabled');

    if (S.busy) { b.innerHTML = '<span class="spin"></span> Working…'; b.setAttribute('aria-disabled', 'true'); return; }
    if (!W.hasWallet()) { b.textContent = 'Install a wallet'; return; }
    if (!W.state.account) { b.textContent = 'Connect wallet'; return; }
    if (!W.onChain()) { b.textContent = 'Switch to Robinhood Chain'; return; }
    if (!amtIn || amtIn <= 0) { b.textContent = 'Enter an amount'; b.setAttribute('aria-disabled', 'true'); return; }

    var have = S.dir === 'buy' ? bE : bR;
    var sym = S.dir === 'buy' ? 'ETH' : 'ROBIN';
    if (have != null && amtIn > have) { b.textContent = 'Insufficient ' + sym; b.setAttribute('aria-disabled', 'true'); return; }

    b.textContent = S.dir === 'buy' ? 'Buy $ROBIN' : 'Sell $ROBIN';
  }

  function paintNet() {
    var on = W.onChain(), acct = W.state.account;
    el.dot.className = 'dot' + (acct && on ? '' : ' off');
    el.label.textContent = !acct ? 'Not connected' : (on ? 'Robinhood Chain' : 'Wrong network');
  }

  function refreshBalances(force) {
    return W.balances(force).then(function (b) { S.bal = b; render(); });
  }

  /* ----------------------------------------------------------- interaction */
  el.amtIn.addEventListener('input', render);

  el.flip.addEventListener('click', function () {
    S.dir = S.dir === 'buy' ? 'sell' : 'buy';
    el.amtIn.value = '';
    render();
  });

  el.max.addEventListener('click', function () {
    var bE = S.bal.eth != null ? RB.fromUnits(S.bal.eth, 18) : null;
    var bR = S.bal.robin != null ? RB.fromUnits(S.bal.robin, C.token.decimals) : null;
    if (S.dir === 'buy') {
      if (bE == null) return;
      el.amtIn.value = Math.max(0, bE - 0.0005).toFixed(6);   // leave a little for gas
    } else {
      if (bR == null) return;
      el.amtIn.value = String(bR);
    }
    render();
  });

  // slippage picker
  [1, 2, 5, 10].forEach(function (v) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = v + '%';
    b.className = v === S.slippage ? 'on' : '';
    b.addEventListener('click', function () {
      S.slippage = v;
      RB.$$('#slip button').forEach(function (x) { x.classList.toggle('on', x === b); });
      render();
    });
    el.slip.appendChild(b);
  });

  // quick amounts
  (C.swap.presets || []).forEach(function (v) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = v + ' ETH';
    b.addEventListener('click', function () {
      if (S.dir !== 'buy') { S.dir = 'buy'; }
      el.amtIn.value = String(v);
      render();
    });
    el.presets.appendChild(b);
  });

  /* --------------------------------------------------------------- submit */
  function handoffUrl(amount) {
    var base = C.links.uniswap || 'https://app.uniswap.org/swap';
    var q = [
      'chain=' + encodeURIComponent(C.links.uniswapChainSlug || 'robinhood'),
      'inputCurrency=' + (S.dir === 'buy' ? 'ETH' : C.token.address),
      'outputCurrency=' + (S.dir === 'buy' ? C.token.address : 'ETH')
    ];
    if (amount > 0) { q.push('exactAmount=' + amount, 'exactField=input'); }
    return base + (base.indexOf('?') > -1 ? '&' : '?') + q.join('&');
  }

  el.btn.addEventListener('click', function () {
    if (S.busy || el.btn.getAttribute('aria-disabled') === 'true') return;

    if (!W.hasWallet()) {
      window.open('https://metamask.io/download/', '_blank', 'noopener');
      return;
    }
    if (!W.state.account) {
      W.connect(false).then(function () { refreshBalances(true); }).catch(function () {});
      return;
    }
    if (!W.onChain()) {
      W.ensureChain().then(function () { refreshBalances(true); })
                     .catch(function () { RB.toast('Could not switch network', 'err'); });
      return;
    }

    var amtIn = parseFloat(el.amtIn.value);
    if (!amtIn || amtIn <= 0) return;

    if (v4Ready()) { executeV4(amtIn); }
    else {
      var url = handoffUrl(amtIn);
      window.open(url, '_blank', 'noopener');
      note('Opened Uniswap with your amount pre-filled. Check the token address matches ' +
           '<code>' + RB.shortAddr(C.token.address) + '</code> before you confirm.', 'ok');
    }
  });

  /* ------------------------------------------------------ on-page V4 swap */
  function executeV4(amtIn) {
    var buy = S.dir === 'buy';
    var decIn = buy ? 18 : C.token.decimals;
    var decOut = buy ? C.token.decimals : 18;
    var out = quote(amtIn);
    if (!out) { note('No live quote available right now — try again in a moment.', 'err'); return; }

    var amountIn = RB.toUnits(amtIn, decIn);
    var minOut = RB.toUnits(out * (1 - S.slippage / 100), decOut);
    var deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

    S.busy = true; render();

    var pre = buy ? Promise.resolve() : ensureSellAllowances(amountIn);

    pre.then(function () {
      var tx = buildSwapTx(buy ? 'buy' : 'sell', amountIn, minOut, deadline);
      // Dry-run first so a revert surfaces as a readable message, not a failed tx.
      return RB.rpc('eth_estimateGas', [{
        from: W.state.account, to: tx.to, data: tx.data, value: tx.value
      }]).then(function (gas) {
        var pad = (BigInt(gas) * 125n) / 100n;
        return W.send({ to: tx.to, data: tx.data, value: tx.value, gas: '0x' + pad.toString(16) });
      }, function () {
        // Estimation can fail for benign reasons; let the wallet decide.
        return W.send(tx);
      });
    })
    .then(function (hash) {
      note('Transaction sent. Waiting for confirmation…', 'ok');
      RB.toast('Swap submitted', 'ok', { href: RB.scan('tx', hash), text: 'View' });
      return W.waitReceipt(hash).then(function (r) {
        if (r && BigInt(r.status || '0x0') === 1n) {
          note('Swap confirmed. Welcome to the band. 🏹', 'ok');
          RB.toast('Swap confirmed', 'ok', { href: RB.scan('tx', hash), text: 'View' });
          el.amtIn.value = '';
        } else if (r) {
          note('The transaction reverted on-chain. Try a higher slippage.', 'err');
        }
        RB.market.refresh();
        return refreshBalances(true);
      });
    })
    .catch(function (e) {
      var msg = (e && (e.message || e.reason)) || 'Swap failed';
      if (e && e.code === 4001) msg = 'You rejected the transaction';
      note(RB.esc(msg), 'err');
    })
    .finally(function () { S.busy = false; render(); });
  }

  /** ROBIN -> ETH needs ERC20 approval to Permit2, then Permit2 to the router. */
  function ensureSellAllowances(amount) {
    var owner = W.state.account, p2 = C.swap.permit2, ur = C.swap.universalRouter;

    return RB.ethCall(C.token.address, SEL.allowance + strip(w(BigInt(owner))) + strip(w(BigInt(p2))))
      .then(function (hex) {
        var cur = RB.hexToBig(hex);
        if (cur >= amount) return;
        note('Approving Permit2 (one time)…');
        return W.send({
          to: C.token.address,
          data: SEL.approve + w(BigInt(p2)) + w(MAX_UINT)
        }).then(function (h) { return W.waitReceipt(h); });
      })
      .then(function () {
        note('Authorising the router…');
        var exp = BigInt(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30);
        return W.send({
          to: p2,
          data: SEL.p2approve + w(BigInt(C.token.address)) + w(BigInt(ur)) + w(MAX_UINT160) + w(exp)
        }).then(function (h) { return W.waitReceipt(h); });
      });
  }

  /* ------------------------------------------------------------- lifecycle */
  W.onChange(function () {
    paintNet();
    if (W.state.account && W.onChain()) refreshBalances(true);
    else { S.bal = {}; render(); }
  });

  RB.market.onUpdate(render);

  // Tell the operator loudly if they asked for on-page swaps but the config
  // doesn't check out — better a console warning than a mis-routed trade.
  if (C.swap.mode === 'v4' && !v4Ready()) {
    note('On-page swapping is configured but the pool key does not verify — ' +
         'falling back to Uniswap. See the README.', 'err');
    if (window.console) {
      console.warn('[ROBIN] swap.mode="v4" but config is incomplete or the PoolKey does not hash ' +
                   'to market.poolId. Expected ' + C.market.poolId +
                   (poolKeyLooksSet() ? ', got ' + computePoolId() : ', poolKey not set') + '.');
    }
  }

  paintNet();
  render();
  setInterval(function () {
    if (!document.hidden && W.state.account && W.onChain()) refreshBalances(false);
  }, 15000);

  window.RB.swap = { computePoolId: computePoolId, v4Ready: v4Ready, buildSwapTx: buildSwapTx };
})();
