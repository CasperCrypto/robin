/* The arena in a real browser, against the real PHP engine and a mock chain.
   Picking a side has to reach the server, the entry has to come back on the
   next poll, and the countdown has to agree with the round it is counting. */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const shim = fs.readFileSync(path.join(__dirname, 'demo-shim.js'), 'utf8');
const APP = 8897, MOCK = 8796;
const WALLET = '0x2222222222222222222222222222222222222222';
let pass = 0, fail = 0;
const ck = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-'));
  fs.writeFileSync(path.join(dir, 'price.txt'), '0.00007012');
  fs.writeFileSync(path.join(dir, 'balance.txt'), '13da329b6336471800000');   // 1.5M ROBIN

  const env = { ...process.env, ARENA_DIR: dir, ROBIN_AI_KEY: '',
                ARENA_RPC: `http://127.0.0.1:${MOCK}/rpc`,
                ARENA_DS: `http://127.0.0.1:${MOCK}/dex/tokens/` };
  const mock = spawn('php', ['-S', `127.0.0.1:${MOCK}`, '-t', 'test', 'test/mock-arena.php'],
                     { cwd: ROOT, env, stdio: 'ignore' });
  const app  = spawn('php', ['-S', `127.0.0.1:${APP}`, '-t', '.'], { cwd: ROOT, env, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));

  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(shim);
  // The shim's demo wallet is a famous public address; the arena needs the one
  // the mock chain reports a balance for.
  await ctx.addInitScript(w => {
    Object.defineProperty(window, '__ARENA_WALLET', { value: w });
  }, WALLET);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${APP}/index.html`, { waitUntil: 'load' });
  await p.locator('#arena').scrollIntoViewIfNeeded();
  await p.waitForTimeout(1200);

  const clock = await p.textContent('#arClock');
  ck('the countdown is running', /^[0-4]:[0-5]\d$/.test(clock.trim()), clock);

  const agrees = await p.evaluate(async () => {
    const j = await (await fetch('api/arena.php?a=state')).json();
    const left = j.live.endsAt - j.now;
    const [m, s] = document.getElementById('arClock').textContent.split(':').map(Number);
    return Math.abs((m * 60 + s) - left) <= 3;
  });
  ck('the countdown agrees with the server', agrees);

  ck('the price came from the chain', /^\$0\.00007/.test((await p.textContent('#arPrice')).trim()),
     await p.textContent('#arPrice'));

  // Picking without a wallet must ask for one rather than failing silently.
  await p.evaluate(() => { window.RB.wallet.state.account = null; });
  let opened = false;
  await p.evaluate(() => { window.__picker = 0; const o = window.RB.wallet.openPicker;
                           window.RB.wallet.openPicker = function () { window.__picker++; }; });
  await p.click('#arUp');
  opened = await p.evaluate(() => window.__picker > 0);
  ck('picking with no wallet opens the picker', opened);

  // Now with a wallet the mock chain will vouch for.
  await p.evaluate(w => { window.RB.wallet.state.account = w; }, WALLET);
  await p.click('#arUp');
  await p.waitForFunction(() => document.getElementById('arUp').classList.contains('picked'), null, { timeout: 8000 })
        .catch(() => {});
  ck('the pick shows immediately', await p.evaluate(() => document.getElementById('arUp').classList.contains('picked')));
  ck('the other side dims', await p.evaluate(() => document.getElementById('arDown').classList.contains('dimmed')));

  await p.waitForFunction(() => /round #\d/.test(document.getElementById('arNote').textContent), null, { timeout: 10000 })
        .catch(() => {});
  const note = await p.textContent('#arNote');
  ck('the server confirmed the entry', /You're in round #\d+ as Outlaw/.test(note), note);

  const counted = await p.evaluate(async () => {
    const j = await (await fetch('api/arena.php?a=state')).json();
    return j.open.up;
  });
  ck('the entry is really in the open round', counted === 1, 'up=' + counted);

  // A second pick on the same round must be refused, not silently accepted.
  await p.click('#arDown');
  await p.waitForTimeout(1200);
  const dup = await p.textContent('#arNote');
  ck('a second pick is refused', /already in this round/i.test(dup), dup);

  ck('no page errors', errs.length === 0, errs.join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  mock.kill(); app.kill();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
