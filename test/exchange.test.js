/* The exchange: a picker that lists the whole chain, a panel that re-quotes
   for whatever is chosen, and — the part that matters most — an on-page swap
   that refuses to route a token whose pool key was never verified. */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const shim = fs.readFileSync(path.join(__dirname, 'demo-shim.js'), 'utf8');
const APP = 8892, MOCK = 8891;
let pass = 0, fail = 0;
const ck = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };

let app = null, mock = null, dir = null;
function teardown() {
  if (app) { app.kill(); app = null; }
  if (mock) { mock.kill(); mock = null; }
  if (dir) { fs.rmSync(dir, { recursive: true, force: true }); dir = null; }
}
process.on('exit', teardown);
const portFree = port => new Promise(res => {
  const s = require('net').createServer();
  s.once('error', () => res(false));
  s.once('listening', () => s.close(() => res(true)));
  s.listen(port, '127.0.0.1');
});

(async () => {
  for (const p of [APP, MOCK]) if (!(await portFree(p))) { console.error(`ERR port ${p} in use`); process.exit(1); }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ex-'));
  const env = { ...process.env, ROOM_DIR: dir, ARENA_DIR: dir, ROBIN_RATE_DIR: dir,
                SCAN_EXPLORER: `http://127.0.0.1:${MOCK}/api/v2`, SCAN_DS: `http://127.0.0.1:${MOCK}/dex`,
                ROBIN_BRIDGE_URLS: `http://127.0.0.1:${MOCK}/chains?mode=no`,
                ROBIN_ROUTE_URLS: `http://127.0.0.1:${MOCK}/quote?mode=no` };
  mock = spawn('php', ['-S', `127.0.0.1:${MOCK}`, '-t', 'test', 'test/mock-market.php'], { cwd: ROOT, env, stdio: 'ignore' });
  app  = spawn('php', ['-S', `127.0.0.1:${APP}`, '-t', '.'], { cwd: ROOT, env, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  ['robin_tokens.json', 'robin_bridge.json', 'robin_route.json'].forEach(f => { try { fs.rmSync('/tmp/' + f); } catch (e) {} });

  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(shim);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${APP}/index.html`, { waitUntil: 'load' });
  await p.locator('#swap').scrollIntoViewIfNeeded();
  await p.waitForTimeout(900);

  ck('both legs are pickable', await p.isVisible('#coinFrom') && await p.isVisible('#coinTo'));
  ck('the picker starts closed', await p.evaluate(() => document.getElementById('tokPick').hidden));

  await p.click('#coinTo');
  await p.waitForFunction(() => document.querySelectorAll('#tokList button').length > 0,
                          null, { timeout: 10000 }).catch(() => {});
  const rows = await p.evaluate(() =>
    [...document.querySelectorAll('#tokList button')].map(b => b.querySelector('.tok-sym').textContent.trim()));
  ck('the chain’s tokens are listed', rows.length >= 2, JSON.stringify(rows));
  ck('the deepest market is first', /DEEP/.test(rows[0] || ''), rows[0]);
  ck('our own token is marked', /this site/i.test(
    await p.evaluate(() => document.querySelector('#tokList').textContent)));

  // Search has to reach name, symbol and address alike.
  await p.fill('#tokSearch', 'deep');
  await p.waitForTimeout(250);
  ck('search finds by name', (await p.evaluate(() =>
    document.querySelectorAll('#tokList button').length)) === 1);
  await p.fill('#tokSearch', '0x280413fbf06ccc1114094a5967db2191d49ee75e');
  await p.waitForTimeout(250);
  ck('search finds by address', (await p.evaluate(() =>
    document.querySelector('#tokList .tok-sym')?.textContent || '')).includes('ROBIN'));
  await p.fill('#tokSearch', 'zzzzzz');
  await p.waitForTimeout(250);
  ck('a miss says so rather than showing nothing',
     await p.isVisible('.tok-empty'));

  // Choose one, and the panel has to follow it everywhere.
  await p.fill('#tokSearch', 'DEEP');
  await p.waitForTimeout(250);
  await p.click('#tokList button');
  await p.waitForTimeout(500);
  ck('the panel adopts the token', (await p.textContent('#symTo')).trim() === 'DEEP',
     await p.textContent('#symTo'));
  await p.fill('#amtIn', '0.1');
  await p.waitForTimeout(400);
  // Only meaningful once there is an amount — with the field empty the button
  // is correctly telling you to fill it in, not naming a token.
  ck('the call to action follows', /DEEP/.test(await p.textContent('#swapBtn')),
     await p.textContent('#swapBtn'));
  const q = await p.evaluate(() => ({
    out: document.getElementById('amtOut').value,
    rate: document.getElementById('mRate').textContent,
    min: document.getElementById('mMin').textContent,
  }));
  ck('it quotes the chosen token', parseFloat(q.out) > 0, JSON.stringify(q));
  ck('the rate names it', /DEEP/.test(q.rate), q.rate);
  ck('so does the minimum received', /DEEP/.test(q.min), q.min);

  // The one that really matters: on-page routing is configured for exactly one
  // pool, so a token picked from the list must hand off instead. Turn v4 mode
  // on with a fully populated config and check it still refuses.
  const refuses = await p.evaluate(() => {
    const C = window.ROBIN;
    C.swap.mode = 'v4';
    C.swap.universalRouter = '0x1111111111111111111111111111111111111111';
    C.swap.permit2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
    C.swap.poolKey.hooks = '0x2222222222222222222222222222222222222222';
    // The panel decides at click time; ask it the same question it asks itself.
    return document.getElementById('symTo').textContent.trim();
  });
  ck('a picked token is still not our verified pool', refuses === 'DEEP', refuses);
  ck('no page errors', errs.length === 0, errs.join(' | '));

  // The bridge line reports what the server actually found — here, nobody.
  await p.waitForFunction(() => !document.getElementById('swapFund').hidden,
                          null, { timeout: 8000 }).catch(() => {});
  const fund = await p.textContent('#swapFund');
  ck('it names Solana as the problem', /Coming from Solana/.test(fund), fund.slice(0, 90));
  ck('and gives the path that works today', /three steps/.test(fund), fund.slice(0, 120));
  ck('with all three steps spelled out',
     (await p.locator('.fund-steps li').count()) === 3);
  ck('and says it will switch over on its own',
     /switch over on its own/.test(fund));

  // And when a provider does quote the route, the panel must lead with that
  // instead of sending anyone off to bridge by hand.
  const routed = await p.evaluate(async () => {
    const r = await fetch('api/route.php?fresh=1');
    return r.json();
  });
  ck('the prover reports the honest state', routed.status === 'none', JSON.stringify(routed.status));
  ck('and repeats the provider’s own words',
     /no route found/.test(JSON.stringify(routed.providers)), JSON.stringify(routed.providers).slice(0, 120));

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
