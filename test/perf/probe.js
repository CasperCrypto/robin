/* Frame-pacing probe: loads the page on a throttled mobile CPU, scrolls it,
   and reports how many frames blew the 16.7ms budget. */
const { chromium } = require('playwright');
const path = require('path');
const shim = require('fs').readFileSync(path.join(__dirname, '..', 'demo-shim.js'), 'utf8');

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox','--disable-dev-shm-usage'],
  });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
  await ctx.addInitScript(shim);
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });   // a mid phone
  await p.goto('file://' + path.join(process.argv[2], 'index.html'), { waitUntil:'load' });
  await p.waitForTimeout(2500);

  const out = await p.evaluate(() => new Promise(res => {
    const f = []; let last = performance.now(); let n = 0;
    (function tick(t){ f.push(t-last); last=t; if(++n<300) requestAnimationFrame(tick); else res(f.slice(5)); })(performance.now());
    // keep the page working while we measure
    let y=0; const s=setInterval(()=>{ y=(y+40)%1800; window.scrollTo(0,y); },50);
    setTimeout(()=>clearInterval(s), 6000);
  }));

  const sorted = out.slice().sort((a,b)=>a-b);
  const pct = q => sorted[Math.floor(sorted.length*q)].toFixed(1);
  console.log(JSON.stringify({
    frames: out.length,
    median: +pct(.5), p95: +pct(.95), worst: +sorted[sorted.length-1].toFixed(1),
    janky: out.filter(d=>d>32).length,
  }));
  await b.close();
})().catch(e=>{console.error(e.message);process.exit(1)});
