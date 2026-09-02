/* Boots the whole page in jsdom with the network stubbed, then asserts the DOM
   actually got populated and no script threw. */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

// A fake DexScreener pair + RPC so the data paths actually execute.
const PAIR = {
  pairAddress: '0x7d8a56584434d8355b891da0ff62d9168669f87dd9c8ad77f6c8fb0a6b6eb7d7',
  baseToken: { address: '0x280413fbF06CcC1114094A5967dB2191d49EE75e', symbol: 'ROBIN' },
  quoteToken: { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH' },
  priceUsd: '0.00042137', priceNative: '0.000000112',
  priceChange: { h24: 18.4 }, volume: { h24: 128450 },
  liquidity: { usd: 96200 }, marketCap: 421370, fdv: 421370,
  txns: { h24: { buys: 214, sells: 97 } },
};

const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
  runScripts: 'outside-only',
  url: 'https://shopping.io/robin/',
  virtualConsole: vc,
  pretendToBeVisual: true,
});
const win = dom.window;
win.TextEncoder = TextEncoder;
win.IntersectionObserver = class {
  constructor(cb) { this.cb = cb; }
  observe(el) { this.cb([{ isIntersecting: true, target: el }], this); }
  unobserve() {} disconnect() {}
};

let rpcCalls = 0;
win.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes('dexscreener')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ pairs: [PAIR] }) });
  }
  if (u.includes('rpc.mainnet.chain.robinhood.com')) {
    rpcCalls++;
    const body = JSON.parse(opts.body);
    const results = {
      eth_blockNumber: '0x' + (1234567).toString(16),
      eth_getLogs: [],
      eth_call: '0x' + (10n ** 27n).toString(16).padStart(64, '0'), // totalSupply = 1e9 * 1e18
    };
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: body.id, result: results[body.method] ?? '0x' }),
    });
  }
  return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ error: 'stub' }) });
};

['config.js','keccak.js','app.js','market.js','wallet.js','swap.js','feed.js','ai.js','doge.js']
  .forEach((f) => {
    try { win.eval(fs.readFileSync(path.join(root, 'assets/js', f), 'utf8')); }
    catch (e) { errors.push(`${f} threw: ${e.message}`); }
  });

const d = win.document;
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`);
};

setTimeout(() => {
  const t = (sel) => (d.querySelector(sel)?.textContent || '').trim();

  check('full contract address rendered',
    d.querySelector('.ca-full')?.textContent === win.ROBIN.token.address,
    d.querySelector('.ca-full')?.textContent);
  check('truncated address rendered for small screens',
    /^0x280413fb…d49EE75e$/.test(d.querySelector('.ca-short')?.textContent || ''),
    d.querySelector('.ca-short')?.textContent);
  check('price populated from pair', t('#sPrice').startsWith('$'), t('#sPrice'));
  check('24h change populated', t('#sChange').includes('18.4'), t('#sChange'));
  check('market cap populated', t('#sMcap') === '$421.4K', t('#sMcap'));
  check('volume populated', t('#sVol') === '$128.4K', t('#sVol'));
  check('liquidity populated', t('#sLiq') === '$96.2K', t('#sLiq'));
  check('marquee filled', d.querySelectorAll('#marquee span').length === 20);
  check('tokenomics rows rendered', d.querySelectorAll('#tokList .tok-item').length === 3);
  check('tokenomics bars total 100%',
    win.ROBIN.distribution.reduce((a, x) => a + x.pct, 0) === 100);
  check('slippage buttons rendered', d.querySelectorAll('#slip button').length === 4);
  check('preset buttons rendered', d.querySelectorAll('#presets button').length === 4);
  check('swap CTA reflects no wallet', /wallet/i.test(t('#swapBtn')), t('#swapBtn'));
  check('AI greeting rendered', d.querySelectorAll('#aiLog .msg').length >= 1);
  check('AI suggestion chips rendered', d.querySelectorAll('#aiChips button').length === 5);
  check('meme chips rendered', d.querySelectorAll('#memeChips button').length === 4);
  check('FAQ items present', d.querySelectorAll('.faq details').length === 7);
  // The contract that matters: nothing is left parked invisible. An element is
  // either never armed, or armed and revealed — never armed and stuck.
  const stuck = [...d.querySelectorAll('.rv.armed')].filter(e => !e.classList.contains('in'));
  check('no content left invisible', stuck.length === 0, `stuck=${stuck.length}`);
  check('reveal css is opt-in, not default',
    !fs.readFileSync(path.join(root,'assets/css/style.css'),'utf8')
       .includes('.rv{opacity:0'));
  check('RPC was actually called', rpcCalls > 0, `calls=${rpcCalls}`);
  check('footer year set', /^\d{4}$/.test(t('#yr')), t('#yr'));
  check('sticky buy bar present', !!d.querySelector('#buybar'));
  check('buy bar shows live price', /\$0\.000/.test(t('#bbPrice')), t('#bbPrice'));
  check('meme band present', !!d.querySelector('#dogeAnim'));
  check('animation is lazy (poster only at rest)',
    (d.querySelector('#dogeAnim img')?.getAttribute('src')||'').includes('poster'),
    d.querySelector('#dogeAnim img')?.getAttribute('src'));
  check('no generated SVG art referenced',
    !fs.readFileSync(path.join(root,'index.html'),'utf8').includes('robin-logo.svg'));
  check('unconfigured telegram link removed', d.querySelector('#fTg') === null);
  check('no dead "#" hrefs left',
    [...d.querySelectorAll('a[href="#"]')].length === 0,
    [...d.querySelectorAll('a[href="#"]')].map(a => a.id).join(','));

  check('no script errors', errors.length === 0, errors.join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 700);
