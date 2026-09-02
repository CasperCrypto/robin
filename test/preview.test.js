/* Boots the bundled preview exactly as the artifact viewer would. */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const file = process.argv[2];
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(
  `<!doctype html><html><head><meta charset="utf-8"></head><body>${fs.readFileSync(file,'utf8')}</body></html>`,
  { runScripts: 'dangerously', url: 'https://claude.ai/preview', virtualConsole: vc,
    pretendToBeVisual: true,
    beforeParse(w) {
      w.TextEncoder = TextEncoder;
      w.IntersectionObserver = class {
        constructor(cb){ this.cb = cb; }
        observe(el){ this.cb([{ isIntersecting: true, target: el }], this); }
        unobserve(){} disconnect(){}
      };
    } }
);
const win = dom.window;

setTimeout(() => {
  const d = win.document, t = s => (d.querySelector(s)?.textContent||'').trim();
  let pass=0, fail=0;
  const check=(n,c,x='')=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'}  ${n}${c?'':'  '+x}`);};

  check('price shows demo data', t('#sPrice').startsWith('$0.000'), t('#sPrice'));
  check('24h change shows +12.6%', t('#sChange')==='+12.6%', t('#sChange'));
  check('mcap shows realistic sample', t('#sMcap')==='$70.1K', t('#sMcap'));
  check('liquidity shows', t('#sLiq')==='$24.8K', t('#sLiq'));
  const heroSrc = d.querySelector('.hero-art img')?.getAttribute('src') || '';
  check('hero logo is an inlined raster data URI',
    /^data:image\/(png|webp);base64,/.test(heroSrc), heroSrc.slice(0, 40));
  check('animated doge is inlined',
    /^data:image\/webp;base64,/.test(d.querySelector('#dogeAnim img')?.getAttribute('src')||''));
  // Only loadable references matter; the string may still appear in comments.
  const raw = fs.readFileSync(file,'utf8');
  const loads = raw.match(/(?:src|href)\s*=\s*["'`]assets\/[^"'`]+/g) || [];
  check('no external asset loads remain', loads.length===0, loads.slice(0,3).join(','));
  check('live buy feed populated', d.querySelectorAll('#feedList .buy').length > 0,
    'rows=' + d.querySelectorAll('#feedList .buy').length);
  check('feed detected a pool', /pool 0x/.test(t('#feedMeta')), t('#feedMeta'));
  check('wallet auto-connected in demo', /0x/.test(t('#navConnect')), t('#navConnect'));
  check('swap shows balances', t('#balFrom')!=='—', t('#balFrom'));
  check('swap rate populated', t('#mRate').includes('ROBIN'), t('#mRate'));
  check('supply facts rendered', d.querySelectorAll('#tokList .fact').length===4);
  check('meme forge present', !!d.querySelector('#forgeStage'));
  check('preview is labelled as sample data', !!d.querySelector('#demoBadge'));
  check('no script errors', errors.length===0, errors.join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
}, 1500);
