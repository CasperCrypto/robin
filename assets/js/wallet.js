/* ============================================================================
   wallet.js — EIP-1193 connection, Robinhood Chain add/switch, live balances.
   Non-custodial: every transaction is signed in the user's own wallet.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.ROBIN, RB = window.RB, $ = RB.$;

  var state = { provider: null, account: null, chainId: null, connecting: false };
  var listeners = [];
  function emit() { listeners.forEach(function (fn) { try { fn(state); } catch (e) {} }); }

  /* ------------------------------------------------------ provider lookup */
  /*
     EIP-6963 is how modern wallets announce themselves: each one fires an
     event carrying its name, icon and a provider object. That is what lets us
     show a real picker instead of guessing at window.ethereum, which only ever
     holds whichever extension won the race to inject.
  */
  var detected = [];          // [{ info:{name,icon,rdns}, provider }]

  function addDetail(d) {
    if (!d || !d.provider || !d.info) return;
    for (var i = 0; i < detected.length; i++) {
      if (detected[i].info.rdns === d.info.rdns) return;
    }
    detected.push(d);
  }

  window.addEventListener('eip6963:announceProvider', function (e) { addDetail(e.detail); });
  try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) {}

  /** Anything injected the old way, for wallets that predate EIP-6963. */
  function legacyProviders() {
    var eth = window.ethereum;
    if (!eth) return [];
    var list = (Array.isArray(eth.providers) && eth.providers.length) ? eth.providers : [eth];
    return list.map(function (p) {
      var name = p.isMetaMask ? 'MetaMask'
               : p.isCoinbaseWallet ? 'Coinbase Wallet'
               : p.isTrust || p.isTrustWallet ? 'Trust Wallet'
               : p.isPhantom ? 'Phantom'
               : p.isRabby ? 'Rabby'
               : p.isBraveWallet ? 'Brave Wallet'
               : 'Browser wallet';
      return { info: { name: name, rdns: 'legacy.' + name, icon: '' }, provider: p };
    });
  }

  /** Everything we could connect to right now, de-duplicated by name. */
  function available() {
    var all = detected.slice();
    legacyProviders().forEach(function (l) {
      var dup = all.some(function (d) { return d.info.name === l.info.name; });
      if (!dup) all.push(l);
    });
    return all;
  }

  function hasWallet() { return available().length > 0; }

  function isMobile() {
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')) return true;
    // iPadOS reports itself as a Mac, so the user agent alone misses it. A
    // coarse pointer with no hover and real touch points is the giveaway.
    var coarse = window.matchMedia &&
                 window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    return !!coarse && (navigator.maxTouchPoints || 0) > 0;
  }

  /*
     On a phone, a wallet is an app, not an extension — so there is nothing to
     inject and nothing to pick. What works is handing the app a link that
     reopens this page inside its own browser, where its provider IS injected.
  */
  function deepLinks() {
    var full  = window.location.href;
    var bare  = window.location.host + window.location.pathname + window.location.search;
    var enc   = encodeURIComponent(full);
    return [
      { name: 'MetaMask',        url: 'https://metamask.app.link/dapp/' + bare },
      { name: 'Trust Wallet',    url: 'https://link.trustwallet.com/open_url?coin_id=60&url=' + enc },
      { name: 'Coinbase Wallet', url: 'https://go.cb-w.com/dapp?cb_url=' + enc },
      { name: 'Phantom',         url: 'https://phantom.app/ul/browse/' + enc +
                                      '?ref=' + encodeURIComponent(window.location.origin) }
    ];
  }

  var INSTALL = [
    { name: 'MetaMask',        url: 'https://metamask.io/download/' },
    { name: 'Rabby',           url: 'https://rabby.io/' },
    { name: 'Coinbase Wallet', url: 'https://www.coinbase.com/wallet/downloads' },
    { name: 'Phantom',         url: 'https://phantom.app/download' }
  ];

  /* ------------------------------------------------------------- chain io */
  var CHAIN_PARAMS = {
    chainId: C.chain.idHex,
    chainName: C.chain.name,
    nativeCurrency: C.chain.currency,
    rpcUrls: [C.chain.rpc].concat(C.chain.rpcBackup || []).filter(Boolean),
    blockExplorerUrls: [C.chain.explorer]
  };

  function ensureChain() {
    var p = state.provider;
    if (!p) return Promise.reject(new Error('No wallet'));
    return p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: C.chain.idHex }] })
      .catch(function (err) {
        // 4902 = chain unknown to the wallet. Add it, then we're on it already.
        var code = err && (err.code || (err.data && err.data.originalError && err.data.originalError.code));
        if (code === 4902 || /unrecognized|not been added|Unrecognized chain/i.test(err && err.message || '')) {
          return p.request({ method: 'wallet_addEthereumChain', params: [CHAIN_PARAMS] });
        }
        throw err;
      })
      .then(function () {
        return p.request({ method: 'eth_chainId' }).then(function (id) { state.chainId = id; emit(); });
      });
  }

  function onChain() {
    return state.chainId && parseInt(state.chainId, 16) === C.chain.id;
  }

  /* --------------------------------------------------------- picker sheet */
  var sheet, listEl, noteEl, sheetOpen = false, lastFocus = null;

  function buildSheet() {
    if (sheet) return;
    sheet = document.createElement('div');
    sheet.className = 'wsheet';
    sheet.id = 'walletSheet';
    sheet.hidden = true;
    sheet.innerHTML =
      '<div class="wsheet-bg" data-close></div>' +
      '<div class="wsheet-panel lg lg-d" role="dialog" aria-modal="true" aria-label="Connect a wallet">' +
        '<div class="wsheet-head">' +
          '<h3>Connect wallet</h3>' +
          '<button class="wsheet-x" type="button" data-close aria-label="Close">' +
            '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
            'stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="wlist"></div>' +
        '<p class="wsheet-note"></p>' +
      '</div>';
    document.body.appendChild(sheet);
    listEl = sheet.querySelector('.wlist');
    noteEl = sheet.querySelector('.wsheet-note');

    sheet.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeSheet();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheetOpen) closeSheet();
    });
  }

  function row(label, iconHtml, sub) {
    return '<span class="wrow-ico">' + iconHtml + '</span>' +
           '<span class="wrow-txt"><b>' + RB.esc(label) + '</b>' +
           (sub ? '<i>' + RB.esc(sub) + '</i>' : '') + '</span>' +
           '<svg class="wrow-go" viewBox="0 0 24 24" width="16" height="16" fill="none" ' +
           'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
           '<path d="M9 6l6 6-6 6"/></svg>';
  }

  var GENERIC = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
    'stroke-width="1.9" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2"/>' +
    '<rect x="3" y="7" width="18" height="12" rx="2"/><circle cx="16.5" cy="13" r="1.4"/></svg>';

  function group(title) {
    var h = document.createElement('div');
    h.className = 'wgroup';
    h.textContent = title;
    listEl.appendChild(h);
  }

  function openSheet() {
    buildSheet();
    var found = available();
    listEl.innerHTML = '';

    // 1. Anything already injected in this browser.
    if (found.length) {
      group(found.length > 1 ? 'Wallets in this browser' : 'Detected');
      found.forEach(function (d) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'wrow';
        b.innerHTML = row(d.info.name,
          d.info.icon ? '<img src="' + RB.esc(d.info.icon) + '" alt="" width="22" height="22">' : GENERIC,
          'Connect');
        b.addEventListener('click', function () {
          closeSheet();
          connectWith(d.provider);
        });
        listEl.appendChild(b);
      });
    }

    // 2. Wallet apps. Always offered — on a phone this is the only thing that
    //    works, and on a desktop plenty of people keep their wallet on their
    //    phone and scan or continue there.
    group(found.length ? 'Or open in a wallet app' : 'Open in your wallet app');
    deepLinks().forEach(function (w) {
      var a = document.createElement('a');
      a.className = 'wrow';
      a.href = w.url;
      a.rel = 'noopener';
      if (!isMobile()) a.target = '_blank';
      a.innerHTML = row(w.name, GENERIC, isMobile() ? 'Opens the app' : 'Continue on phone');
      listEl.appendChild(a);
    });

    // 3. Extensions, only where one could actually be installed.
    if (!found.length && !isMobile()) {
      group('Or install a browser wallet');
      INSTALL.forEach(function (w) {
        var a = document.createElement('a');
        a.className = 'wrow wrow-sm';
        a.href = w.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.innerHTML = row(w.name, GENERIC, 'Install');
        listEl.appendChild(a);
      });
    }

    noteEl.textContent = found.length
      ? 'Approve the connection in your wallet. This site never sees your keys.'
      : 'Pick your wallet — it reopens this page inside the app, where connecting takes one tap.';

    lastFocus = document.activeElement;
    sheet.hidden = false;
    requestAnimationFrame(function () { sheet.classList.add('open'); });
    document.body.style.overflow = 'hidden';
    sheetOpen = true;
    var first = listEl.querySelector('.wrow');
    if (first && first.focus) first.focus();
  }

  function closeSheet() {
    if (!sheet) return;
    sheet.classList.remove('open');
    sheetOpen = false;
    document.body.style.overflow = '';
    setTimeout(function () { if (!sheetOpen) sheet.hidden = true; }, 220);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ------------------------------------------------------------- connect */
  function connectWith(p) {
    if (!p) return Promise.reject(new Error('No wallet'));
    if (state.connecting) return Promise.reject(new Error('Already connecting'));
    state.connecting = true;
    state.provider = p;
    bind(p);

    return p.request({ method: 'eth_requestAccounts' })
      .then(function (accts) {
        if (!accts || !accts.length) throw new Error('No account');
        state.account = accts[0];
        return p.request({ method: 'eth_chainId' });
      })
      .then(function (id) {
        state.chainId = id;
        emit();
        if (!onChain()) return ensureChain();
      })
      .then(function () {
        state.connecting = false;
        emit();
        RB.toast('Wallet connected', 'ok');
        return state.account;
      })
      .catch(function (e) {
        state.connecting = false;
        state.account = null;
        emit();
        if (e && e.code === 4001) RB.toast('Connection rejected', 'err');
        else if (e && e.message !== 'No account') RB.toast(e.message || 'Could not connect', 'err');
        throw e;
      });
  }

  /**
   * The entry point behind every Connect button. One wallet connects straight
   * away; several, or none, opens the picker.
   */
  function connect(silent) {
    if (silent) return reconnect();
    var found = available();
    if (found.length === 1) return connectWith(found[0].provider);
    openSheet();
    return Promise.reject(new Error('Choosing'));
  }

  /** Quietly restore a session the wallet already trusts. No prompts. */
  function reconnect() {
    var found = available();
    if (!found.length) return Promise.reject(new Error('No wallet'));
    var tryOne = function (i) {
      if (i >= found.length) return Promise.reject(new Error('No account'));
      var p = found[i].provider;
      return p.request({ method: 'eth_accounts' }).then(function (a) {
        if (!a || !a.length) return tryOne(i + 1);
        state.provider = p;
        bind(p);
        state.account = a[0];
        return p.request({ method: 'eth_chainId' }).then(function (id) {
          state.chainId = id;
          emit();
          return state.account;
        });
      }, function () { return tryOne(i + 1); });
    };
    return tryOne(0);
  }

  var bound = false;
  function bind(p) {
    if (bound || !p || !p.on) return;
    bound = true;
    p.on('accountsChanged', function (a) {
      state.account = (a && a[0]) || null;
      emit();
      if (!state.account) RB.toast('Wallet disconnected');
    });
    p.on('chainChanged', function (id) {
      state.chainId = id;
      emit();
    });
  }

  /* ------------------------------------------------------------ balances */
  var cache = { eth: null, robin: null, at: 0 };

  function balances(force) {
    if (!state.account) return Promise.resolve({ eth: null, robin: null });
    if (!force && Date.now() - cache.at < 8000 && cache.eth !== null) {
      return Promise.resolve({ eth: cache.eth, robin: cache.robin });
    }
    return Promise.all([
      RB.ethBalance(state.account).catch(function () { return null; }),
      RB.tokenBalance(state.account).catch(function () { return null; })
    ]).then(function (r) {
      cache = { eth: r[0], robin: r[1], at: Date.now() };
      return { eth: r[0], robin: r[1] };
    });
  }

  /* ----------------------------------------------------- send transaction */
  function send(tx) {
    if (!state.provider) return Promise.reject(new Error('No wallet'));
    return state.provider.request({
      method: 'eth_sendTransaction',
      params: [Object.assign({ from: state.account }, tx)]
    });
  }

  /** Poll for a receipt; resolves with it, or null if it takes too long. */
  function waitReceipt(hash, tries) {
    tries = tries == null ? 60 : tries;
    return RB.rpc('eth_getTransactionReceipt', [hash]).then(function (r) {
      if (r) return r;
      if (tries <= 0) return null;
      return new Promise(function (res) { setTimeout(res, 2500); })
        .then(function () { return waitReceipt(hash, tries - 1); });
    }).catch(function () { return null; });
  }

  /* --------------------------------------------------------- nav button */
  var navBtn = $('#navConnect');

  function paintNav() {
    if (!state.account) {
      navBtn.textContent = 'Connect';
      navBtn.classList.remove('btn-lime');
      navBtn.classList.add('btn-dark');
      return;
    }
    navBtn.textContent = onChain() ? RB.shortAddr(state.account) : 'Wrong network';
    navBtn.classList.toggle('btn-lime', !onChain());
    navBtn.classList.toggle('btn-dark', onChain());
  }

  navBtn.addEventListener('click', function () {
    if (!state.account) {
      connect(false).catch(function () {});
    } else if (!onChain()) {
      ensureChain().then(function () { RB.toast('Switched to Robinhood Chain', 'ok'); })
                   .catch(function () { RB.toast('Could not switch network', 'err'); });
    } else {
      if (navigator.clipboard) navigator.clipboard.writeText(state.account);
      RB.toast('Address copied', 'ok');
    }
  });

  listeners.push(paintNav);
  paintNav();

  // Reconnect quietly if a wallet already trusts this site. Delayed so
  // EIP-6963 announcements have landed first.
  setTimeout(function () { reconnect().catch(function () {}); }, 350);

  /* ------------------------------------------------------------- exports */
  window.RB.wallet = {
    state: state, connect: connect, connectWith: connectWith, ensureChain: ensureChain,
    onChain: onChain, hasWallet: hasWallet, available: available, isMobile: isMobile,
    openPicker: openSheet, balances: balances, send: send, waitReceipt: waitReceipt,
    onChange: function (fn) { listeners.push(fn); fn(state); }
  };
})();
