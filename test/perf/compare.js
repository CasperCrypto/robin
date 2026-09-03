/* Same probe, both trees, alternating runs, medians reported — this container
   is noisy enough that a single run of each proves nothing. */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const shim = fs.readFileSync(path.join(__dirname, '..', 'demo-shim.js'), 'utf8');
const trees = process.argv.slice(2);
const REPEATS = 4;

async function run(b, root) {
  const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
  await ctx.addInitScript(shim);
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await p.goto('file://' + path.join(root, 'index.html'), { waitUntil:'load' });
  await p.waitForTimeout(2000);
  const out = await p.evaluate(() => new Promise(res => {
    const f=[]; let last=performance.now(), n=0;
    (function tick(t){ f.push(t-last); last=t; if(++n<240) requestAnimationFrame(tick); else res(f.slice(5)); })(performance.now());
    let y=0; const s=setInterval(()=>{ y=(y+40)%1800; window.scrollTo(0,y); },50);
    setTimeout(()=>clearInterval(s), 6000);
  }));
  await ctx.close();
  const sorted = out.slice().sort((a,b)=>a-b);
  return { p95:+sorted[Math.floor(sorted.length*.95)].toFixed(1), janky:out.filter(d=>d>32).length };
}

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox','--disable-dev-shm-usage'],
  });
  const acc = Object.fromEntries(trees.map(t=>[t,[]]));
  for (let i=0;i<REPEATS;i++) for (const t of trees) acc[t].push(await run(b,t));
  const med = a => a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)];
  for (const t of trees) {
    console.log(path.basename(t).padEnd(10),
      'p95', String(med(acc[t].map(r=>r.p95))).padStart(6),
      ' janky', String(med(acc[t].map(r=>r.janky))).padStart(4),
      ' (', acc[t].map(r=>r.janky).join(','), ')');
  }
  await b.close();
})().catch(e=>{console.error(e.message);process.exit(1)});
