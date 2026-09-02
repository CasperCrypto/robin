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
  // EIP-6963 announces providers on an event; keep whatever shows up so users
  // with several wallets installed still get a working button.
  var discovered = [];
  window.addEventListener('eip6963:announceProvider', function (e) {
    if (e.detail && e.detail.provider && discovered.indexOf(e.detail.provider) === -1) {
      discovered.push(e.detail.provider);
    }
  });
  try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) {}

  function findProvider() {
    var eth = window.ethereum;
    if (eth) {
      // Some wallets expose siblings under .providers — prefer a real one.
      if (Array.isArray(eth.providers) && eth.providers.length) {
        return eth.providers.find(function (p) { return p.isMetaMask; }) || eth.providers[0];
      }
      return eth;
    }
    return discovered[0] || null;
  }

  function hasWallet() { return !!findProvider(); }

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

  /* ------------------------------------------------------------- connect */
  function connect(silent) {
    var p = findProvider();
    if (!p) {
      if (!silent) {
        RB.toast('No EVM wallet found — install MetaMask or Rabby', 'err',
                 { href: 'https://metamask.io/download/', text: 'Get one' });
      }
      return Promise.reject(new Error('No wallet'));
    }
    if (state.connecting) return Promise.reject(new Error('Already connecting'));
    state.connecting = true;
    state.provider = p;
    bind(p);

    var req = silent
      ? p.request({ method: 'eth_accounts' })
      : p.request({ method: 'eth_requestAccounts' });

    return req
      .then(function (accts) {
        if (!accts || !accts.length) throw new Error('No account');
        state.account = accts[0];
        return p.request({ method: 'eth_chainId' });
      })
      .then(function (id) {
        state.chainId = id;
        emit();
        if (!silent && !onChain()) return ensureChain();
      })
      .then(function () {
        state.connecting = false;
        emit();
        return state.account;
      })
      .catch(function (e) {
        state.connecting = false;
        state.account = null;
        emit();
        if (!silent) {
          var code = e && e.code;
          if (code === 4001) RB.toast('Connection rejected', 'err');
          else if (e.message !== 'No account') RB.toast(e.message || 'Could not connect', 'err');
        }
        throw e;
      });
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
      navBtn.textContent = hasWallet() ? 'Connect' : 'Get a wallet';
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
      connect(false).then(function () { RB.toast('Wallet connected', 'ok'); }).catch(function () {});
    } else if (!onChain()) {
      ensureChain().then(function () { RB.toast('Switched to Robinhood Chain', 'ok'); })
                   .catch(function () { RB.toast('Could not switch network', 'err'); });
    } else {
      navigator.clipboard && navigator.clipboard.writeText(state.account);
      RB.toast('Address copied', 'ok');
    }
  });

  listeners.push(paintNav);
  paintNav();

  // Reconnect quietly if the wallet already trusts this site.
  if (hasWallet()) setTimeout(function () { connect(true).catch(function () {}); }, 300);

  /* ------------------------------------------------------------- exports */
  window.RB.wallet = {
    state: state, connect: connect, ensureChain: ensureChain, onChain: onChain,
    hasWallet: hasWallet, balances: balances, send: send, waitReceipt: waitReceipt,
    onChange: function (fn) { listeners.push(fn); fn(state); }
  };
})();
