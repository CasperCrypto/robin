/* The room, with two real browsers open at once — because the only claim this
   feature makes is that what one person does reaches the other one, and a
   single browser can never show that. */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const shim = fs.readFileSync(path.join(__dirname, 'demo-shim.js'), 'utf8');
const APP = 8893;
let pass = 0, fail = 0;
const ck = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };

let app = null, dir = null;
function teardown() {
  if (app) { app.kill(); app = null; }
  if (dir) { fs.rmSync(dir, { recursive: true, force: true }); dir = null; }
}
process.on('exit', teardown);

function portFree(port) {
  return new Promise(res => {
    const s = require('net').createServer();
    s.once('error', () => res(false));
    s.once('listening', () => s.close(() => res(true)));
    s.listen(port, '127.0.0.1');
  });
}

(async () => {
  if (!(await portFree(APP))) { console.error(`ERR port ${APP} is in use`); process.exit(1); }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-'));
  app = spawn('php', ['-S', `127.0.0.1:${APP}`, '-t', '.'],
              { cwd: ROOT, stdio: 'ignore',
                env: { ...process.env, ROOM_DIR: dir, ROBIN_RATE_DIR: dir, ARENA_DIR: dir } });
  await new Promise(r => setTimeout(r, 1400));

  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  async function visitor() {
    // Separate contexts, so each gets its own localStorage and so its own
    // client id — two contexts sharing one would count as one person.
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(shim);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://127.0.0.1:${APP}/index.html`, { waitUntil: 'load' });
    return { ctx, p, errs };
  }

  const a = await visitor();
  await a.p.waitForTimeout(1200);

  ck('the rail is on the page', await a.p.isVisible('.room-rail'));
  ck('there are six things to press', (await a.p.locator('.room-btn').count()) === 6);

  await a.p.waitForFunction(() => document.querySelector('#roomHere b').textContent === '1',
                            null, { timeout: 8000 }).catch(() => {});
  ck('one visitor counts as one', (await a.p.textContent('#roomHere b')) === '1',
     await a.p.textContent('#roomHere b'));
  ck('and is told they are on their own',
     await a.p.evaluate(() => document.querySelector('.room-rail').classList.contains('alone')));

  // A second person arrives.
  const c = await visitor();
  await c.p.waitForFunction(() => document.querySelector('#roomHere b').textContent === '2',
                            null, { timeout: 12000 }).catch(() => {});
  ck('the second arrival is counted', (await c.p.textContent('#roomHere b')) === '2',
     await c.p.textContent('#roomHere b'));
  await a.p.waitForFunction(() => document.querySelector('#roomHere b').textContent === '2',
                            null, { timeout: 12000 }).catch(() => {});
  ck('and the first person sees them arrive', (await a.p.textContent('#roomHere b')) === '2',
     await a.p.textContent('#roomHere b'));
  ck('nobody is alone any more',
     !(await a.p.evaluate(() => document.querySelector('.room-rail').classList.contains('alone'))));

  // The whole point: A reacts, B sees it.
  await a.p.click('.room-btn[data-e="🚀"]');
  ck('your own reaction shows instantly',
     (await a.p.locator('.room-fly.mine').count()) > 0);

  await c.p.waitForFunction(() => document.querySelectorAll('.room-sky .room-fly').length > 0,
                            null, { timeout: 12000 }).catch(() => {});
  const landed = await c.p.evaluate(() =>
    [...document.querySelectorAll('.room-sky .room-fly')].map(e => e.textContent));
  ck('it reaches the other browser', landed.includes('🚀'), JSON.stringify(landed));
  ck('and arrives as someone else’s, not yours',
     landed.length > 0 && (await c.p.locator('.room-fly.mine').count()) === 0,
     'flies=' + landed.length);

  // Anything not on the list must be refused outright.
  const bad = await a.p.evaluate(async () => {
    const r = await fetch('api/room.php', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'abcdefgh1234', since: 0, react: '<img src=x onerror=alert(1)>' }) });
    return { status: r.status, body: await r.json() };
  });
  ck('arbitrary content is refused', bad.status === 400 && /Not one of the six/.test(bad.body.error),
     JSON.stringify(bad));

  // A background tab should stop polling entirely.
  const before = await c.p.evaluate(() => performance.getEntriesByType('resource')
    .filter(e => e.name.includes('room.php')).length);
  await c.p.evaluate(() => Object.defineProperty(document, 'hidden', { value: true, configurable: true }));
  await c.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await c.p.waitForTimeout(7000);
  const after = await c.p.evaluate(() => performance.getEntriesByType('resource')
    .filter(e => e.name.includes('room.php')).length);
  ck('a hidden tab stops polling', after === before, `${before} -> ${after}`);

  // The open mobile menu shares this strip of screen; the rail has to yield.
  await a.p.click('#burger');
  await a.p.waitForTimeout(350);
  ck('the rail yields to the open menu',
     await a.p.evaluate(() => {
       const r = document.querySelector('.room-rail');
       const st = getComputedStyle(r);
       return +st.opacity === 0 && st.pointerEvents === 'none';
     }));
  await a.p.click('#burger');
  await a.p.waitForTimeout(350);
  ck('and comes back when it closes',
     await a.p.evaluate(() => +getComputedStyle(document.querySelector('.room-rail')).opacity === 1));

  ck('no page errors', a.errs.length === 0 && c.errs.length === 0,
     a.errs.concat(c.errs).join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
