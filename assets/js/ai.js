/* ============================================================================
   ai.js — Robin AI: chat, alpha report, meme forge.
   Talks only to our own server-side proxy; the OpenRouter key never ships
   to the browser.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.ROBIN, RB = window.RB, $ = RB.$, $$ = RB.$$;

  var EP = C.ai.endpoint;
  var offline = false;          // set once the endpoint tells us it isn't configured

  /* ------------------------------------------------------------- transport */
  function ask(payload) {
    return fetch(EP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ model: C.ai.model }, payload))
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          if (r.status === 503 || r.status === 404) offline = true;
          throw new Error(j.error || ('Request failed (' + r.status + ')'));
        }
        return j.text || '';
      });
    });
  }

  /* --------------------------------------------------- tiny markdown -> html */
  function md(src) {
    var out = RB.esc(src)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

    return out.split(/\n{2,}/).map(function (block) {
      var lines = block.split('\n');
      if (lines.every(function (l) { return /^\s*[-*•]\s+/.test(l) || !l.trim(); })) {
        var items = lines.filter(function (l) { return l.trim(); })
          .map(function (l) { return '<li>' + l.replace(/^\s*[-*•]\s+/, '') + '</li>'; });
        return '<ul>' + items.join('') + '</ul>';
      }
      return '<p>' + lines.join('<br>') + '</p>';
    }).join('');
  }

  /* ----------------------------------------------------------------- tabs */
  $$('.ai-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      var name = tab.dataset.pane;
      $$('.ai-tab').forEach(function (t) {
        var on = t === tab;
        t.classList.toggle('on', on);
        t.setAttribute('aria-selected', String(on));
      });
      $$('.ai-pane').forEach(function (p) { p.classList.toggle('on', p.dataset.pane === name); });
    });
  });

  /* ----------------------------------------------------------------- chat */
  var log = $('#aiLog'), form = $('#aiForm'), input = $('#aiInput');
  var history = [];
  var thinking = null;

  function bubble(role, html) {
    var el = document.createElement('div');
    el.className = 'msg' + (role === 'user' ? ' me' : '');
    el.innerHTML = '<div class="av">' + (role === 'user' ? '🧑' : '🏹') + '</div>' +
                   '<div class="bub">' + html + '</div>';
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function showThinking() {
    thinking = bubble('bot', '<div class="typing"><i></i><i></i><i></i></div>');
  }
  function clearThinking() {
    if (thinking) { thinking.remove(); thinking = null; }
  }

  bubble('bot', md(
    "I'm **Robin** — I read the live chart before I answer.\n\n" +
    "Ask me how to get onto Robinhood Chain, what the pool looks like right now, " +
    "or why 30% of the supply sits with Billy Markus."
  ));

  var CHIPS = [
    'How do I buy $ROBIN?',
    'Is the liquidity locked?',
    "What's the market doing right now?",
    'What is Robinhood Chain?',
    'Why does Billy Markus have 30%?'
  ];
  var chips = $('#aiChips');
  CHIPS.forEach(function (q) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = q;
    b.addEventListener('click', function () { input.value = q; send(); });
    chips.appendChild(b);
  });

  function send() {
    var q = input.value.trim();
    if (!q || thinking) return;
    input.value = '';
    bubble('user', RB.esc(q));
    history.push({ role: 'user', content: q });
    showThinking();

    ask({ mode: 'chat', messages: history })
      .then(function (text) {
        clearThinking();
        bubble('bot', md(text));
        history.push({ role: 'assistant', content: text });
        if (history.length > 12) history = history.slice(-12);
      })
      .catch(function (e) {
        clearThinking();
        bubble('bot', md(e.message || 'Something went wrong.'));
      });
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); send(); });

  /* ---------------------------------------------------------------- alpha */
  var alphaBtn = $('#alphaBtn'), alphaOut = $('#alphaOut');

  alphaBtn.addEventListener('click', function () {
    if (alphaBtn.disabled) return;
    alphaBtn.disabled = true;
    alphaBtn.innerHTML = '<span class="spin"></span> Reading the chart…';
    alphaOut.innerHTML = '<div class="ph"><div class="typing" style="justify-content:center"><i></i><i></i><i></i></div></div>';

    ask({ mode: 'alpha', prompt: 'Give me the current read on $ROBIN.' })
      .then(function (text) {
        alphaOut.innerHTML = md(text) +
          '<p style="opacity:.5;font-size:12px;margin-top:14px">Generated ' +
          new Date().toLocaleTimeString() + ' from live pool data.</p>';
      })
      .catch(function (e) { alphaOut.innerHTML = '<div class="ph">' + RB.esc(e.message) + '</div>'; })
      .finally(function () {
        alphaBtn.disabled = false;
        alphaBtn.textContent = 'Generate alpha report';
      });
  });

  /* ----------------------------------------------------------------- meme */
  var memeForm = $('#memeForm'), memeInput = $('#memeInput'), memeOut = $('#memeOut');

  ['Billy Markus holds 30%', 'Liquidity is locked forever', 'First memecoin on Robinhood Chain',
   'Steal from the charts, give to the holders'].forEach(function (a) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = a;
    b.addEventListener('click', function () { memeInput.value = a; memeForm.requestSubmit(); });
    $('#memeChips').appendChild(b);
  });

  memeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var angle = memeInput.value.trim() || 'Robin Nakamoto, the memecoin of Robinhood Chain';
    memeOut.innerHTML = '<div class="ph"><div class="typing" style="justify-content:center"><i></i><i></i><i></i></div></div>';

    ask({ mode: 'meme', prompt: angle })
      .then(function (text) {
        var posts = text.split(/^\s*---\s*$/m)
          .map(function (s) { return s.trim(); })
          .filter(Boolean);
        if (!posts.length) { memeOut.innerHTML = md(text); return; }

        memeOut.innerHTML = posts.map(function (p) {
          return '<div class="meme"><p>' + RB.esc(p) + '</p><div class="acts">' +
            '<button type="button" data-copy="' + RB.esc(p) + '">Copy</button>' +
            '<a class="btn" style="padding:6px 13px;border-radius:8px;font-size:12px;background:rgba(255,255,255,.08);border:1px solid var(--ink-line)" ' +
            'href="https://twitter.com/intent/tweet?text=' + encodeURIComponent(p) +
            '" target="_blank" rel="noopener">Post on X</a></div></div>';
        }).join('');

        $$('#memeOut [data-copy]').forEach(function (b) {
          b.addEventListener('click', function () {
            var t = b.getAttribute('data-copy');
            if (navigator.clipboard) navigator.clipboard.writeText(t);
            b.textContent = 'Copied';
            setTimeout(function () { b.textContent = 'Copy'; }, 1500);
          });
        });
      })
      .catch(function (e) { memeOut.innerHTML = '<div class="ph">' + RB.esc(e.message) + '</div>'; });
  });

  /* ------------------------------------------------- not configured notice */
  if (!C.ai.enabled) {
    $('#ai').style.display = 'none';
  }
})();
