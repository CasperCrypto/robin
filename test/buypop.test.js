/* The buy notifications: they replay on load, they arrive live, they never
   stack up, and a chain with no buys produces silence rather than theatre. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const shim = fs.readFileSync(path.join(__dirname, 'demo-shim.js'), 'utf8');
const URL = 'file://' + path.join(__dirname, '..', 'index.html');
let pass = 0, fail = 0;
const ck = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  // ── with buys on chain ───────────────────────────────────────────────
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(shim);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'domcontentloaded' });

  await p.waitForSelector('.buypop.in', { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(600);
  const first = await p.evaluate(() => ({
    shown: document.querySelectorAll('.buypop').length,
    text: document.querySelector('.buypop')?.textContent.replace(/\s+/g, ' ').trim(),
    href: document.querySelector('.buypop')?.getAttribute('href') || '',
    animated: document.querySelectorAll('.buypop.in').length,
  }));
  ck('a notification appears on load', first.shown > 0, JSON.stringify(first));
  ck('it animates in', first.animated > 0, 'in=' + first.animated);
  ck('it reads as a buy', /New buy/i.test(first.text || '') && /\$ROBIN/.test(first.text || ''), first.text);
  ck('it links to the transaction', /\/tx\/0x/.test(first.href), first.href);
  await p.screenshot({ path: process.argv[2] + '/buypop.png' });

  // they replay one at a time, and never pile up
  await p.waitForTimeout(4200);
  const later = await p.evaluate(() => document.querySelectorAll('.buypop').length);
  ck('never more than three on screen', later <= 3, 'on screen=' + later);

  const total = await p.evaluate(() => window.__popCount || 0);
  ck('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ── with a silent chain ──────────────────────────────────────────────
  const quiet = await b.newContext({ viewport: { width: 390, height: 844 } });
  await quiet.addInitScript(shim);
  await quiet.addInitScript(() => {
    // no logs at all, so there is nothing genuine to announce
    const real = window.fetch;
    window.fetch = (u, o) => {
      if (String(u).includes('chain.robinhood.com')) {
        let m = ''; try { m = JSON.parse(o.body).method; } catch (e) {}
        if (m === 'eth_getLogs') {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ result: [] }) });
        }
      }
      return real(u, o);
    };
  });
  const q = await quiet.newPage();
  await q.goto(URL, { waitUntil: 'domcontentloaded' });
  await q.waitForTimeout(6000);
  const quietPops = await q.evaluate(() => document.querySelectorAll('.buypop').length);
  ck('a silent chain shows no notifications', quietPops === 0, 'shown=' + quietPops);

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
