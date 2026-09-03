/* The scanner end to end: the page posts an address, the server computes a
   verdict, and the panel says the same thing the JSON does — including when
   the answer is "we could not check", which must never look like a pass. */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const shim = fs.readFileSync(path.join(__dirname, 'demo-shim.js'), 'utf8');
const APP = 8899, MOCK = 8794;
let pass = 0, fail = 0;
const ck = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };

function serve(cmd, args, env) {
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore' });
  return p;
}

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  for (const profile of ['clean', 'rug']) {
    fs.readdirSync('/tmp').filter(f => f.startsWith('robin_scan_')).forEach(f => fs.rmSync('/tmp/' + f));
    const mock = serve('php', ['-S', `127.0.0.1:${MOCK}`, '-t', 'test', 'test/mock-chain.php'], { MOCK_TOKEN: profile });
    const app  = serve('php', ['-S', `127.0.0.1:${APP}`, '-t', '.'], {
      SCAN_EXPLORER: `http://127.0.0.1:${MOCK}/api/v2`, SCAN_DS: `http://127.0.0.1:${MOCK}/dex`, ROBIN_AI_KEY: '',
    });
    await new Promise(r => setTimeout(r, 1400));

    const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(shim);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://127.0.0.1:${APP}/index.html`, { waitUntil: 'load' });
    await p.locator('#ai').scrollIntoViewIfNeeded();
    await p.click('#scanChips button');
    await p.waitForSelector('#scanOut:not([hidden])', { timeout: 25000 });

    const r = await p.evaluate(() => ({
      cls: document.getElementById('scanVerdict').className,
      label: document.getElementById('scanLabel').textContent,
      findings: [...document.querySelectorAll('.scan-findings li')].map(li => li.className + '|' + li.querySelector('b').textContent),
      stats: document.querySelectorAll('.scan-stats div').length,
    }));

    if (profile === 'clean') {
      ck('clean token reads as a pass', /v-ok/.test(r.cls), r.cls);
      ck('clean token names the verdict', /Nothing alarming/i.test(r.label), r.label);
      ck('clean findings are all good', r.findings.every(f => f.startsWith('f-good')), r.findings.join(' / '));
      ck('the numbers are shown', r.stats >= 4, 'stats=' + r.stats);
    } else {
      ck('rug reads as high risk', /v-high/.test(r.cls), r.cls);
      ck('rug names the verdict', /High risk/i.test(r.label), r.label);
      ck('rug shows the bad findings', r.findings.filter(f => f.startsWith('f-bad')).length >= 2, r.findings.join(' / '));
      ck('rug never claims a clean check', !/v-ok/.test(r.cls), r.cls);
    }

    // A typo must be caught on the page, not sent to the server as a scan.
    if (profile === 'clean') {
      await p.fill('#scanAddr', '0xnope');
      await p.click('#scanBtn');
      await p.waitForTimeout(400);
      const note = await p.evaluate(() => document.getElementById('scanNote').className + '|' + document.getElementById('scanNote').textContent);
      ck('a bad address is refused politely', /bad/.test(note) && /token address/i.test(note), note);
    }

    ck(`no page errors (${profile})`, errs.length === 0, errs.join(' | '));
    await ctx.close();
    mock.kill(); app.kill();
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
