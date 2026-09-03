/* The jackpot in a real browser against the real PHP engine and a mock chain.
   Claiming has to move points, throwing in has to reach the pot, and the wheel
   has to draw the entries the server actually recorded. */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const shim = fs.readFileSync(path.join(__dirname, 'demo-shim.js'), 'utf8');
const APP = 8897, MOCK = 8796;
const ME = '0x2222222222222222222222222222222222222222';
const OTHER = '0x3333333333333333333333333333333333333333';
let pass = 0, fail = 0;
const ck = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };

/* A crashed run used to leave its PHP servers alive, and the next run's
   servers then failed to bind while curl happily kept talking to the old ones —
   which looks exactly like state leaking between runs. Tear down on every exit
   path, and refuse to start if the ports are not actually ours. */
let mock = null, app = null, dir = null;
function teardown() {
  if (mock) { mock.kill(); mock = null; }
  if (app)  { app.kill();  app = null; }
  if (dir)  { fs.rmSync(dir, { recursive: true, force: true }); dir = null; }
}
process.on('exit', teardown);
process.on('SIGINT', () => { teardown(); process.exit(130); });

function portFree(port) {
  return new Promise(res => {
    const s = require('net').createServer();
    s.once('error', () => res(false));
    s.once('listening', () => s.close(() => res(true)));
    s.listen(port, '127.0.0.1');
  });
}

(async () => {
  for (const port of [APP, MOCK]) {
    if (!(await portFree(port))) {
      console.error(`ERR port ${port} is already in use — a previous run is still alive`);
      process.exit(1);
    }
  }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-'));
  fs.writeFileSync(path.join(dir, 'price.txt'), '0.00007012');
  fs.writeFileSync(path.join(dir, 'balance.txt'), '13da329b6336471800000');   // 1.5M ROBIN = Outlaw

  const env = { ...process.env, ARENA_DIR: dir, ROBIN_AI_KEY: '',
                ROBIN_RATE_DIR: dir,          // its own rate-limit buckets, not the machine's
                ARENA_RPC: `http://127.0.0.1:${MOCK}/rpc` };
  mock = spawn('php', ['-S', `127.0.0.1:${MOCK}`, '-t', 'test', 'test/mock-arena.php'],
               { cwd: ROOT, env, stdio: 'ignore' });
  app  = spawn('php', ['-S', `127.0.0.1:${APP}`, '-t', '.'], { cwd: ROOT, env, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));

  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(shim);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${APP}/index.html`, { waitUntil: 'load' });
  await p.locator('#arena').scrollIntoViewIfNeeded();
  await p.waitForTimeout(1200);

  ck('the countdown is running', /^[01]:[0-5]\d$/.test((await p.textContent('#arClock')).trim()),
     await p.textContent('#arClock'));

  const agrees = await p.evaluate(async () => {
    const j = await (await fetch('api/arena.php?a=state')).json();
    const target = j.now < j.live.closesAt ? j.live.closesAt : j.live.endsAt;
    const [m, s] = document.getElementById('arClock').textContent.split(':').map(Number);
    return Math.abs((m * 60 + s) - (target - j.now)) <= 3;
  });
  ck('the countdown agrees with the server', agrees);

  // No wallet: both buttons must ask for one rather than failing quietly.
  await p.evaluate(() => {
    window.RB.wallet.state.account = null;
    window.__picker = 0;
    window.RB.wallet.openPicker = function () { window.__picker++; };
  });
  await p.click('#arClaim');
  await p.click('#arThrow');
  ck('no wallet opens the picker', await p.evaluate(() => window.__picker === 2),
     'picker=' + await p.evaluate(() => window.__picker));

  await p.evaluate(a => { window.RB.wallet.state.account = a; }, ME);

  // Claim
  await p.click('#arClaim');
  await p.waitForFunction(() => /Claimed/.test(document.getElementById('arNote').textContent),
                          null, { timeout: 8000 }).catch(() => {});
  ck('claiming pays the tier allowance', /Claimed 4\.00K points as Outlaw/.test(await p.textContent('#arNote')),
     await p.textContent('#arNote'));
  ck('the points show on the page', /4\.00K/.test(await p.textContent('#arYouPts')),
     await p.textContent('#arYouPts'));
  ck('a second claim is refused', await p.evaluate(() => document.getElementById('arClaim').disabled));

  // Someone else is already in, so the round is a real game.
  await p.evaluate(async o => {
    await fetch('api/arena.php?a=claim', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                           body: JSON.stringify({ address: o }) });
    await fetch('api/arena.php?a=join', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ address: o, stake: 1000 }) });
  }, OTHER);

  // Throw in
  await p.click('.ar-stakes button[data-stake="500"]');
  await p.click('#arThrow');
  await p.waitForFunction(() => /You're in round/.test(document.getElementById('arNote').textContent),
                          null, { timeout: 8000 }).catch(() => {});
  ck('throwing in is confirmed', /You're in round #\d+ for 500 points/.test(await p.textContent('#arNote')),
     await p.textContent('#arNote'));
  ck('the stake left your balance', /3\.50K/.test(await p.textContent('#arYouPts')),
     await p.textContent('#arYouPts'));

  const wheel = await p.evaluate(() => ({
    pot: document.getElementById('arPot').textContent,
    slices: document.querySelectorAll('#arArcs circle').length,
    colours: new Set([...document.querySelectorAll('#arArcs circle')].map(c => c.getAttribute('stroke'))).size,
    rows: document.querySelectorAll('.ar-players li').length,
  }));
  ck('the pot is both stakes', wheel.pot === '1.50K', wheel.pot);
  ck('the wheel has a slice each', wheel.slices === 2, 'slices=' + wheel.slices);
  ck('neighbouring slices differ', wheel.colours === 2, 'colours=' + wheel.colours);
  ck('both players are listed', wheel.rows === 2, 'rows=' + wheel.rows);

  // Over-staking is the server's call, not the page's.
  const over = await p.evaluate(async a => {
    const r = await fetch('api/arena.php?a=join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: a, stake: 999999 }) });
    return { status: r.status, body: await r.json() };
  }, ME);
  ck('you cannot stake what you lack', over.status === 400 && /only have/.test(over.body.error),
     JSON.stringify(over));

  ck('no page errors', errs.length === 0, errs.join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
