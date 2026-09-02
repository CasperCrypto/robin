/* ============================================================================
   app.js — shared helpers, navigation, reveal-on-scroll, link wiring.
   Loads first; everything else hangs off window.RB.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.ROBIN;

  /* ------------------------------------------------------------- helpers */
  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /**
   * Compact USD: $1.23K / $4.56M.
   *
   * A token price and a dollar total want different precision — $0.00007012 is
   * meaningful, $3.1257 is not — so `money: true` rounds to cents the way a
   * total should, while the default keeps significant digits for sub-cent
   * prices.
   */
  function usd(n, opts) {
    if (n == null || !isFinite(n)) return '—';
    opts = opts || {};
    var a = Math.abs(n);
    if (opts.money && a >= 0.01 && a < 1000) {
      return '$' + n.toFixed(2);
    }
    if (!opts.exact) {
      if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
      if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
      if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    }
    if (a === 0) return '$0';
    if (a < 0.000001) return '$' + n.toExponential(2);
    if (a < 1) {
      // keep 4 significant figures for micro-cap prices
      var d = Math.min(18, Math.max(2, 4 - Math.floor(Math.log10(a)) - 1));
      return '$' + n.toFixed(d).replace(/0+$/, '').replace(/\.$/, '');
    }
    return '$' + n.toLocaleString('en-US', { maximumFractionDigits: a < 100 ? 4 : 2 });
  }

  /** Compact token amount: 1.23M, 4.5K, 0.0042 */
  function num(n, dp) {
    if (n == null || !isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    if (a === 0) return '0';
    if (a < 0.0001) return n.toExponential(2);
    return n.toLocaleString('en-US', { maximumFractionDigits: dp == null ? 4 : dp });
  }

  function shortAddr(a) {
    return !a ? '—' : a.slice(0, 6) + '…' + a.slice(-4);
  }

  function ago(ts) {
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* --------------------------------------------------------------- toast */
  function toast(msg, kind, link) {
    var wrap = $('#toasts');
    if (!wrap) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.innerHTML = '<span>' + esc(msg) + '</span>' +
      (link ? '<a href="' + esc(link.href) + '" target="_blank" rel="noopener">' + esc(link.text) + '</a>' : '');
    wrap.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 320);
    }, link ? 8000 : 3800);
  }

  /* ------------------------------------------------------------ explorer */
  function scan(kind, id) {
    return C.chain.explorer.replace(/\/+$/, '') + '/' + kind + '/' + id;
  }

  // Merge, never replace — keccak.js may have already registered RB.k.
  var RB = window.RB = window.RB || {};
  Object.assign(RB, {
    $: $, $$: $$, usd: usd, num: num, shortAddr: shortAddr,
    ago: ago, esc: esc, toast: toast, scan: scan
  });

  /* Ancient/odd webviews may lack IntersectionObserver. Degrade to "everything
     is visible" rather than taking the whole page down with a ReferenceError. */
  var IO = window.IntersectionObserver || function (cb) {
    return {
      observe: function (el) { cb([{ isIntersecting: true, target: el }], this); },
      unobserve: function () {}, disconnect: function () {}
    };
  };

  /* ------------------------------------------------------------------ nav */
  var nav = $('#nav'), burger = $('#burger');

  function onScroll() { nav.classList.toggle('stuck', window.scrollY > 24); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  burger.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    burger.setAttribute('aria-expanded', String(open));
  });
  $$('#navLinks a').forEach(function (a) {
    a.addEventListener('click', function () {
      nav.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    });
  });
  document.addEventListener('click', function (e) {
    if (nav.classList.contains('open') && !nav.contains(e.target)) {
      nav.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('open')) {
      nav.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    }
  });

  /* scroll-spy */
  var secs = $$('section[id]');
  var spy = new IO(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      $$('#navLinks a').forEach(function (a) {
        a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id);
      });
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  secs.forEach(function (s) { spy.observe(s); });

  /* --------------------------------------------------------- reveal on scroll */
  var rv = new IO(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('in'); rv.unobserve(en.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
  // Only arm what starts below the fold, so the first painted frame is complete.
  $$('.rv').forEach(function (el, i) {
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    el.classList.add('armed');
    el.style.transitionDelay = (Math.min(i % 4, 3) * 70) + 'ms';
    rv.observe(el);
  });

  /* -------------------------------------------------------- contract pill */
  var addr = C.token.address;
  $('.ca-full', $('#caVal')).textContent = addr;
  $('.ca-short', $('#caVal')).textContent = addr.slice(0, 10) + '…' + addr.slice(-8);
  $('#fCa').textContent = shortAddr(addr);

  $('#caCopy').addEventListener('click', function () {
    var btn = this;
    var done = function () {
      btn.classList.add('done');
      toast('Contract address copied', 'ok');
      setTimeout(function () { btn.classList.remove('done'); }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(addr).then(done, fallback);
    } else { fallback(); }

    function fallback() {
      var t = document.createElement('textarea');
      t.value = addr;
      t.setAttribute('readonly', '');
      t.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(t);
      t.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { toast('Copy failed — select the address manually', 'err'); }
      t.remove();
    }
  });

  /* ------------------------------------------------------------ link wiring */
  var L = C.links;
  var map = {
    '#chartLink': L.dexscreener, '#stepDex': L.dexscreener, '#fDex': L.dexscreener,
    '#stepPons': L.pons, '#faqPons': L.pons, '#fPons': L.pons,
    '#fTw': L.twitter,
    '#fTg': L.telegram, '#fGh': L.github,
    '#fScan': scan('token', addr),
    '#billyScan': scan('token', addr) + '?tab=holders',
    '#faqScan': scan('token', addr) + '?tab=holders'
  };
  Object.keys(map).forEach(function (sel) {
    var el = $(sel);
    if (!el) return;
    if (map[sel]) { el.href = map[sel]; }
    else {
      // no link configured — drop it rather than shipping a dead anchor
      var li = el.closest('li');
      (li || el).remove();
    }
  });

  /* --------------------------------------------------------------- marquee */
  var bits = ['$ROBIN', 'ROBIN NAKAMOTO', 'ROBINHOOD CHAIN', '30M TO BILLY MARKUS',
              'LIQUIDITY LOCKED', 'FIXED SUPPLY', 'STEAL FROM THE CHARTS',
              'GIVE TO THE HOLDERS', 'UNISWAP V4', 'CHAIN 4663'];
  var row = bits.map(function (b) { return '<span>' + esc(b) + '</span>'; }).join('');
  $('#marquee').innerHTML = row + row;   // duplicated for a seamless -50% loop

  /* ------------------------------------------------------------ tokenomics */
  // Verifiable facts rather than an invented pie chart: each tile is something
  // a holder can confirm on the explorer or by reading the contract.
  var tok = $('#tokList');
  tok.innerHTML = (C.supplyFacts || []).map(function (f) {
    return '<div class="fact lg lg-d' + (f.accent ? ' accent' : '') + '">' +
             '<div class="fact-k">' + esc(f.label) + '</div>' +
             '<div class="fact-v">' + esc(f.value) + '</div>' +
             '<p>' + esc(f.note) + '</p>' +
           '</div>';
  }).join('');

  /* ------------------------------------------------------------ buy bar */
  // Small screens only; the CSS keeps it hidden elsewhere.
  var bar = $('#buybar');
  var swapSec = $('#swap');
  if (bar && swapSec) {
    document.body.classList.add('has-buybar');
    var updateBar = function () {
      var past = window.scrollY > window.innerHeight * 0.72;
      var box = swapSec.getBoundingClientRect();
      var onSwap = box.top < window.innerHeight && box.bottom > 120;
      bar.classList.toggle('up', past && !onSwap);
    };
    window.addEventListener('scroll', updateBar, { passive: true });
    window.addEventListener('resize', updateBar);
    updateBar();
  }

  /* --------------------------------------------------------------- footer */
  $('#yr').textContent = new Date().getFullYear();

  /* -------------------------------------------------- X timeline embed */
  /*
     X's widget is loaded from platform.twitter.com and is blocked outright by
     many privacy extensions, some networks, and any tracking-protection
     setting. It also renders nothing for a protected or empty account. So the
     card starts as a proper Follow card and is only replaced once a real
     timeline iframe actually appears — rather than sitting on "Loading…"
     forever when it never will.
  */
  var handle = (C.twitterHandle || '').replace(/^@/, '');
  var twBox = $('#twEmbed');

  function followCard() {
    if (!twBox) return;
    var url = handle ? 'https://x.com/' + handle : (C.links.twitter || '#');
    twBox.innerHTML =
      '<div class="tw-fallback">' +
        '<div class="tw-x" aria-hidden="true">𝕏</div>' +
        (handle ? '<div class="tw-handle">@' + esc(handle) + '</div>' : '') +
        '<p>Charts, memes and every announcement first. ' +
        'Robin posts more than he should.</p>' +
        '<a class="btn btn-lime" href="' + esc(url) + '" target="_blank" rel="noopener">' +
          'Follow on X</a>' +
      '</div>';
  }

  if (!handle) {
    followCard();
  } else {
    followCard();   // shown immediately; replaced only if the widget really loads

    var mount = document.createElement('div');
    mount.className = 'tw-mount';
    mount.style.display = 'none';
    var a = document.createElement('a');
    a.className = 'twitter-timeline';
    a.setAttribute('data-theme', 'dark');
    a.setAttribute('data-height', '420');
    a.setAttribute('data-chrome', 'noheader nofooter transparent');
    a.href = 'https://twitter.com/' + handle;
    a.textContent = 'Posts by @' + handle;
    mount.appendChild(a);
    twBox.appendChild(mount);

    var settled = false;
    var giveUpAt = Date.now() + 12000;

    // Poll rather than trusting one timer: the widget can take a while on a
    // cold cache, and script.onload fires well before it has rendered.
    var check = setInterval(function () {
      if (settled) { clearInterval(check); return; }
      var frame = mount.querySelector('iframe');
      if (frame && frame.offsetHeight > 80) {
        settled = true;
        clearInterval(check);
        var fb = twBox.querySelector('.tw-fallback');
        if (fb) fb.remove();
        mount.style.display = '';
      } else if (Date.now() > giveUpAt) {
        settled = true;
        clearInterval(check);
        mount.remove();          // keep the Follow card, drop the dead mount
      }
    }, 400);

    var sc = document.createElement('script');
    sc.src = 'https://platform.twitter.com/widgets.js';
    sc.async = true;
    sc.charset = 'utf-8';
    sc.onerror = function () {
      settled = true;
      clearInterval(check);
      mount.remove();
    };
    document.body.appendChild(sc);
  }
})();
