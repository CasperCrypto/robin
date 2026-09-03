/* Which effect is actually costing the frames? Same page, same throttle, with
   one thing switched off at a time. */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const shim = fs.readFileSync(path.join(__dirname, '..', 'demo-shim.js'), 'utf8');
const ROOT = process.argv[2];

const VARIANTS = {
  'baseline':            '',
  'no backdrop-filter':  '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',
  'no bg drift':         'body::before{animation:none!important}',
  'no button shine':     '.btn-lime::after,.btn-dark::after{animation:none!important}',
  'no marquee':          '.marquee-track{animation:none!important}',
  'no grain':            'body::after{display:none!important}',
};

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox','--disable-dev-shm-usage'],
  });
  for (const [name, css] of Object.entries(VARIANTS)) {
    const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
    await ctx.addInitScript(shim);
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await p.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil:'load' });
    if (css) await p.addStyleTag({ content: css });
    await p.waitForTimeout(2200);
    const out = await p.evaluate(() => new Promise(res => {
      const f=[]; let last=performance.now(), n=0;
      (function tick(t){ f.push(t-last); last=t; if(++n<260) requestAnimationFrame(tick); else res(f.slice(5)); })(performance.now());
      let y=0; const s=setInterval(()=>{ y=(y+40)%1800; window.scrollTo(0,y); },50);
      setTimeout(()=>clearInterval(s), 6000);
    }));
    const sorted = out.slice().sort((a,b)=>a-b);
    console.log(name.padEnd(22),
      'p95', String(sorted[Math.floor(sorted.length*.95)].toFixed(1)).padStart(6),
      ' janky', String(out.filter(d=>d>32).length).padStart(4));
    await ctx.close();
  }
  await b.close();
})().catch(e=>{console.error(e.message);process.exit(1)});
