const { chromium } = require('playwright');
const fs=require('fs'), path=require('path');
const shim=fs.readFileSync(path.join(__dirname,'demo-shim.js'),'utf8');
let pass=0,fail=0; const ck=(n,c,x='')=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'}  ${n}${c?'':'  '+x}`);};
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox','--disable-dev-shm-usage']});

  for (const motion of ['no-preference','reduce']) {
    const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
      reducedMotion: motion==='reduce'?'reduce':'no-preference',
      userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36'});
    await ctx.addInitScript(shim);
    const p=await ctx.newPage();
    await p.goto('file://' + path.join(__dirname,'..','index.html'),{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(2200);

    /* The glass sweep is a one-shot fired as a panel scrolls into view, so it
       has to be caught in the act. Watch a below-the-fold panel, scroll to it,
       and record whether the light ever crossed it. */
    const sweptPanel = await p.evaluate(() => new Promise(res => {
      const panels = [...document.querySelectorAll('.lg')];
      const target = panels.find(el => el.getBoundingClientRect().top > innerHeight * 1.2);
      if (!target) return res('no-offscreen-panel');
      let seen = null;
      const t = setInterval(() => {
        const n = getComputedStyle(target, '::before').animationName;
        if (n && n !== 'none') { seen = n; clearInterval(t); res(seen); }
      }, 40);
      target.scrollIntoView();
      setTimeout(() => { clearInterval(t); res(seen || 'never-fired'); }, 3000);
    }));
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(400);

    const m=await p.evaluate(()=>{
      const running = (el,ps)=>{
        const a=(el.getAnimations?el.getAnimations({subtree:false}):[]) || [];
        return a.some(x=>x.playState==='running');
      };
      const anim = (sel,ps)=>{ const el=document.querySelector(sel); if(!el) return null;
        return getComputedStyle(el, ps||null).animationName; };
      return {
        heroArt:  anim('.hero-art .ring'),
        sweep:    anim('.lg','::before'),
        wordmark: anim('.wordmark .wm-spec'),
        marquee:  anim('.marquee-track'),
        drift:    anim('body','::before'),
        enter:    anim('.hero-art'),
        swept:    window.__swept,
        liveAnims: document.getAnimations().filter(a=>a.playState==='running').length,
      };
    });
    m.swept = sweptPanel;
    console.log(`\n  [prefers-reduced-motion: ${motion}]`, JSON.stringify(m));
    if (motion==='no-preference') {
      ck('doge floats', m.heroArt==='float', m.heroArt);
      ck('glass catches the light on arrival', m.swept==='sweep-once', m.swept);
      // ...and is completely static the rest of the time, because it is a
      // backdrop-filter surface and anything moving inside one is expensive.
      ck('glass is otherwise still', m.sweep==='none', m.sweep);
      ck('wordmark sheen', m.wordmark==='sweep-bg', m.wordmark);
      ck('background drifts', m.drift==='drift', m.drift);
    } else {
      ck('doge still floats under reduce', m.heroArt==='float', m.heroArt);
      ck('glass still catches the light under reduce', m.swept==='sweep-once', m.swept);
      ck('marquee still scrolls under reduce', m.marquee==='slide', m.marquee);
      ck('background drift stops under reduce', m.drift==='none', m.drift);
      ck('entrance fades without travel', m.enter==='fade', m.enter);
      ck('animations are actually running', m.liveAnims > 3, 'running='+m.liveAnims);
    }
    await ctx.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail?1:0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
