/* Renders the real site in Chromium at phone and desktop widths and checks for
   horizontal overflow — the thing jsdom cannot tell you. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const OUT = process.argv[2];
const shim = fs.readFileSync(path.join(__dirname, 'demo-shim.js'), 'utf8');

const VIEWS = [
  { name: 'phone-390',   width: 390,  height: 844,  dsf: 2, mobile: true },
  { name: 'phone-360',   width: 360,  height: 780,  dsf: 2, mobile: true },
  { name: 'desktop-1280',width: 1280, height: 900,  dsf: 1, mobile: false },
];

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  for (const v of VIEWS) {
    const ctx = await browser.newContext({
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: v.dsf,
      isMobile: v.mobile,
      hasTouch: v.mobile,
    });
    await ctx.addInitScript(shim);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    // This sandbox has no outbound network, so third-party embeds (the X
    // timeline, fonts) would hang the load event. Fail them fast instead —
    // which also proves the page renders fine without them.
    await page.route('**', (route) => {
      const u = route.request().url();
      if (u.startsWith('http://127.0.0.1:8899')) return route.continue();
      return route.abort();
    });
    await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);

    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const over = [...document.querySelectorAll('body *')]
        .filter(el => el.getBoundingClientRect().right > de.clientWidth + 1)
        .slice(0, 6)
        .map(el => el.tagName.toLowerCase() + (el.id ? '#'+el.id : '') +
                   (el.className && typeof el.className === 'string' ? '.'+el.className.trim().split(/\s+/)[0] : '') +
                   ' →' + Math.round(el.getBoundingClientRect().right));
      // any interactive target smaller than 40px in either axis?
      const small = [...document.querySelectorAll('a,button,input,summary')]
        .filter(el => { const r = el.getBoundingClientRect();
                        return r.width>0 && r.height>0 && (r.height<38) && el.offsetParent !== null; })
        .slice(0,6)
        .map(el => (el.id||el.className||el.tagName)+' '+Math.round(el.getBoundingClientRect().height)+'px');
      return {
        scrollW: de.scrollWidth, clientW: de.clientWidth, over, small,
        price: document.querySelector('#sPrice')?.textContent,
        feed: document.querySelectorAll('#feedList .buy').length,
        barUp: document.querySelector('#buybar')?.classList.contains('up'),
      };
    });

    console.log(`\n── ${v.name} (${v.width}px) ──`);
    console.log(`   scrollWidth ${m.scrollW} vs clientWidth ${m.clientW}  ${m.scrollW>m.clientW?'❌ OVERFLOW':'✓ no h-scroll'}`);
    if (m.over.length) console.log('   overflowing:', m.over.join(' | '));
    if (m.small.length) console.log('   small targets:', m.small.join(' | '));
    console.log(`   price=${m.price}  feedRows=${m.feed}`);
    if (errs.length) console.log('   ❌ page errors:', errs.join(' | '));

    await page.screenshot({ path: path.join(OUT, v.name + '-top.png') });
    await page.evaluate(() => document.querySelector('#swap').scrollIntoView());
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, v.name + '-swap.png') });
    await page.evaluate(() => document.querySelector('#meme').scrollIntoView());
    await page.waitForTimeout(1400);
    await page.screenshot({ path: path.join(OUT, v.name + '-meme.png') });

    // exercise the meme forge end to end
    await page.evaluate(() => document.querySelector('#ai').scrollIntoView());
    await page.fill('#forgePrompt', 'surfing a giant green candle');
    await page.click('#forgeBtn');
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, v.name + '-forge-loading.png') });
    await page.waitForSelector('#forgeImg:not([hidden])', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, v.name + '-forge.png') });
    const forge = await page.evaluate(() => ({
      state: document.querySelector('#forgeStage')?.dataset.state,
      shown: !document.querySelector('#forgeImg')?.hidden,
      acts:  !document.querySelector('#forgeActions')?.hasAttribute('hidden'),
      dl:    document.querySelector('#forgeDownload')?.getAttribute('download'),
    }));
    console.log(`   forge: state=${forge.state} image=${forge.shown} actions=${forge.acts} file=${forge.dl}`);
    await ctx.close();
  }
  await browser.close();
})();
