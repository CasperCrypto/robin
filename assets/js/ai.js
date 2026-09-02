/* ============================================================================
   ai.js — the meme forge.

   One job: take a scene from the visitor, ask the server for a picture of
   Robin in it, and hand back something worth posting. The API key lives on the
   server; this file only ever talks to our own endpoint.
   ========================================================================== */
(function () {
  'use strict';
  var C = window.ROBIN, RB = window.RB, $ = RB.$;

  var sec = $('#ai');
  if (!sec) return;
  if (!C.ai || !C.ai.enabled) { sec.style.display = 'none'; return; }

  var stage   = $('#forgeStage'),
      img     = $('#forgeImg'),
      idle    = $('#forgeIdle'),
      load    = $('#forgeLoad'),
      status  = $('#forgeStatus'),
      form    = $('#forgeForm'),
      input   = $('#forgePrompt'),
      btn     = $('#forgeBtn'),
      actions = $('#forgeActions'),
      note    = $('#forgeNote');

  var busy = false, lastPrompt = '';

  /* Something to read while the model works — image calls take a while. */
  var LINES = [
    'Sharpening the crayons…',
    'Adjusting the feathered hat…',
    'Cleaning the glasses…',
    'Mixing more lime green…',
    'Teaching the dog to pose…',
    'Almost there…'
  ];
  var lineTimer = null;

  function startLines() {
    var i = 0;
    status.textContent = LINES[0];
    lineTimer = setInterval(function () {
      i = Math.min(i + 1, LINES.length - 1);
      status.textContent = LINES[i];
    }, 4200);
  }
  function stopLines() { clearInterval(lineTimer); lineTimer = null; }

  function setState(s) { stage.dataset.state = s; }

  var PRESETS = [
    'riding a rocket over Wall Street',
    'as a medieval archer in Sherwood Forest',
    'sitting on a giant pile of gold coins',
    'trading on six monitors at 3am',
    'shaking hands with a Shiba in a suit',
    'surfing a giant green candle'
  ];

  var chips = $('#forgeChips');
  PRESETS.forEach(function (p) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = p;
    b.addEventListener('click', function () {
      input.value = p;
      input.focus();
    });
    chips.appendChild(b);
  });

  function showError(msg) {
    setState('idle');
    idle.hidden = false;
    load.hidden = true;
    note.textContent = msg;
    note.classList.add('err');
  }

  function resetNote() {
    note.classList.remove('err');
    note.textContent = 'Free to use, a few seconds each. Images are made by an AI and belong ' +
                       'to whoever posts them — go wild, keep it legal.';
  }

  function generate(prompt) {
    if (busy) return;
    busy = true;
    lastPrompt = prompt;

    resetNote();
    setState('loading');
    idle.hidden = true;
    img.hidden = true;
    load.hidden = false;
    actions.hidden = true;
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Drawing…';
    startLines();

    fetch(C.ai.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt, model: C.ai.model })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error(j.error || ('Request failed (' + r.status + ')'));
          if (!j.image) throw new Error('No image came back. Try a different scene.');
          // The value ends up in img.src and an <a href>, so accept image
          // schemes only — never javascript: or data:text/html.
          if (!/^(data:image\/[a-z.+-]+;base64,|https:\/\/)/i.test(j.image)) {
            throw new Error('The image came back in an unexpected format.');
          }
          return j.image;
        });
      })
      .then(function (src) {
        return new Promise(function (res, rej) {
          // Wait for the bytes to decode so the reveal isn't a flash of nothing.
          var pre = new Image();
          pre.onload = function () { res(src); };
          pre.onerror = function () { rej(new Error('The image came back damaged. Try again.')); };
          pre.src = src;
        });
      })
      .then(function (src) {
        img.src = src;
        img.alt = 'Robin Nakamoto ' + prompt;
        img.hidden = false;
        load.hidden = true;
        setState('done');
        wireActions(src, prompt);
      })
      .catch(function (e) { showError(e.message || 'Something went wrong.'); })
      .finally(function () {
        busy = false;
        stopLines();
        btn.disabled = false;
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" ' +
          'stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v4M3 5h4M6 17v4M4 19h4' +
          'M13 3l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5z"/></svg> Generate again';
      });
  }

  function wireActions(src, prompt) {
    actions.hidden = false;

    var dl = $('#forgeDownload');
    dl.href = src;
    dl.download = 'robin-' + prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '.png';

    var share = $('#forgeShare');
    share.href = 'https://twitter.com/intent/tweet?text=' +
      encodeURIComponent('$ROBIN ' + prompt + '\n\nMade on ' + location.origin + location.pathname);

    var copy = $('#forgeCopy');
    copy.textContent = 'Copy image';
    copy.onclick = function () {
      // Clipboard image writes need a real blob and a secure context.
      if (!navigator.clipboard || !window.ClipboardItem) {
        RB.toast('Your browser can’t copy images — use Download', 'err');
        return;
      }
      fetch(src)
        .then(function (r) { return r.blob(); })
        .then(function (b) {
          return navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
        })
        .then(function () {
          copy.textContent = 'Copied';
          RB.toast('Image copied — paste it straight into X', 'ok');
          setTimeout(function () { copy.textContent = 'Copy image'; }, 1800);
        })
        .catch(function () {
          RB.toast('Copy failed — use Download instead', 'err');
        });
    };
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var p = input.value.trim();
    if (!p) { input.focus(); return; }
    generate(p);
  });

  // Enter submits, Shift+Enter makes a new line.
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
})();
