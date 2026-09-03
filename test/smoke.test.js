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
  liquidity: { usd: 96200 }, marketCap: 999999999, fdv: 888888888,   // deliberately wrong: we should ignore these
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
    // Four buys (tokens leaving the pool) and two sells (tokens going in), so
    // the buys-only filter has something real to exclude.
    const POOL = '0x1111111111111111111111111111111111111111';
    const TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const pad = (a) => '0x' + a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
    const wallet = (n) => '0xbb' + String(n).repeat(38).slice(0, 38);  // never collides with POOL
    const LOGS = [
      [true, 1], [true, 2], [false, 3], [true, 4], [false, 5], [true, 6],
    ].map(([isBuy, n], i) => ({
      topics: [TOPIC, pad(isBuy ? POOL : wallet(n)), pad(isBuy ? wallet(n) : POOL)],
      data: '0x' + (BigInt(1000 * (i + 1)) * 10n ** 18n).toString(16).padStart(64, '0'),
      transactionHash: '0x' + String(i + 1).repeat(64).slice(0, 64),
      logIndex: '0x' + i.toString(16),
      blockNumber: '0x' + (1234560 + i).toString(16),
    }));

    // The chain is quiet near the head: these buys sit ~20k blocks back, so the
    // feed only finds them if it keeps walking backwards. A single window
    // returns nothing — that was the "times out and shows nothing" bug.
    const HEAD = 1234567;
    const OLD_FROM = HEAD - 22000, OLD_TO = HEAD - 20000;
    LOGS.forEach((l, i) => { l.blockNumber = '0x' + (OLD_FROM + i).toString(16); });

    let logsServed = 0;
    const logsFor = (params) => {
      if (!params || !params[0] || !params[0].fromBlock) return [];
      const from = parseInt(params[0].fromBlock, 16);
      const to = parseInt(params[0].toBlock, 16);
      const hit = from <= OLD_TO && to >= OLD_FROM;
      if (hit) logsServed++;
      return hit ? LOGS : [];
    };
    global.__logsServed = () => logsServed;

    const results = {
      eth_blockNumber: '0x' + HEAD.toString(16),
      eth_getLogs: logsFor(body.params),
      eth_call: '0x' + (10n ** 27n).toString(16).padStart(64, '0'), // totalSupply = 1e9 * 1e18
    };
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: body.id, result: results[body.method] ?? '0x' }),
    });
  }
  return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ error: 'stub' }) });
};

['config.js','keccak.js','app.js','market.js','wallet.js','swap.js','feed.js','arena.js','doge.js']
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
  // supply (1e9, from the stubbed totalSupply) x price (0.00042137) = $421,370.
  // The pair reports $999,999,999; if that leaked through, this fails.
  check('market cap is computed from on-chain supply, not the reported field',
    t('#sMcap') === '$421.4K', t('#sMcap') + ' (pair claimed $1.00B)');
  check('volume populated', t('#sVol') === '$128.4K', t('#sVol'));
  check('liquidity populated', t('#sLiq') === '$96.2K', t('#sLiq'));
  check('marquee filled', d.querySelectorAll('#marquee span').length === 20);
  check('supply facts rendered', d.querySelectorAll('#tokList .fact').length === 4);
  check('Billy figure is 30M, not 30%',
    /30,000,000/.test(d.querySelector('#tokList').textContent) &&
    !/30%/.test(d.querySelector('#tokList').textContent));
  check('slippage buttons rendered', d.querySelectorAll('#slip button').length === 4);
  check('preset buttons rendered', d.querySelectorAll('#presets button').length === 4);
  check('swap CTA says connect, never install', t('#swapBtn') === 'Connect wallet', t('#swapBtn'));
  check('nav button says Connect', t('#navConnect') === 'Connect', t('#navConnect'));
  check('arena present', !!d.querySelector('#arena'));
  check('arena has both sides to pick', !!d.querySelector('#arUp') && !!d.querySelector('#arDown'));
  check('arena shows a round history strip', !!d.querySelector('#arStrip'));
  check('arena confetti starts hidden', d.querySelector('#arBurst')?.hasAttribute('hidden'));
  check('only one AI feature ships',
    !d.querySelector('#aiLog') && !d.querySelector('#alphaOut') && !d.querySelector('#memeOut'));
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
  check('feed is buys only by default', win.ROBIN.market.showSells === false);
  // The stub served 4 buys and 2 sells; only the buys may reach the DOM.
  check('finds buys that are far behind the head',
    d.querySelectorAll('#feedList .buy').length === 4,
    'got ' + d.querySelectorAll('#feedList .buy').length + ' (needs to scan back ~20k blocks)');
  check('drops the 2 sells', d.querySelectorAll('#feedList .buy.sell').length === 0);
  check('no minus signs in a buys-only feed',
    !/[\u2212-]\s*[\d]/.test(d.querySelector('#feedList')?.textContent || ''));
  check('feed heading says buys', /Live buys/.test(d.querySelector('.feed-head h3')?.textContent || ''));
  check('slippage row hidden by default',
    d.querySelector('#slip')?.closest('.row')?.style.display === 'none');
  check('three posts embedded', d.querySelectorAll('#twPosts blockquote').length === 3,
    'got ' + d.querySelectorAll('#twPosts blockquote').length);
  check('each post links to the real status',
    [...d.querySelectorAll('#twPosts blockquote a')].every(a =>
      /^https:\/\/twitter\.com\/shopping_io\/status\/\d{10,}$/.test(a.href)),
    d.querySelector('#twPosts blockquote a')?.href);
  check('follow card stands alongside them',
    !!d.querySelector('#twEmbed .tw-follow') &&
    /shopping_io/.test(d.querySelector('#twEmbed')?.textContent || ''));
  check('buy history is remembered', win.ROBIN.market.feedRows === 12);
  check('buy bar shows live price', /\$0\.000/.test(t('#bbPrice')), t('#bbPrice'));
  check('meme band present', !!d.querySelector('#dogeAnim'));
  check('animation is lazy (poster only at rest)',
    (d.querySelector('#dogeAnim img')?.getAttribute('src')||'').includes('poster'),
    d.querySelector('#dogeAnim img')?.getAttribute('src'));
  check('no generated SVG art referenced',
    !fs.readFileSync(path.join(root,'index.html'),'utf8').includes('robin-logo.svg'));
  check('telegram link wired', d.querySelector('#fTg')?.href === 'https://t.me/robinnakamotoofficial',
    d.querySelector('#fTg')?.href);
  check('x link points at shopping_io', d.querySelector('#fTw')?.href === 'https://x.com/shopping_io',
    d.querySelector('#fTw')?.href);
  check('unconfigured github link removed', d.querySelector('#fGh') === null);
  check('no "30%" claim anywhere in the page',
    !/30%/.test(fs.readFileSync(path.join(root,'index.html'),'utf8')));
  check('contract address unchanged',
    win.ROBIN.token.address === '0x280413fbF06CcC1114094A5967dB2191d49EE75e');
  check('no dead "#" hrefs left',
    [...d.querySelectorAll('a[href="#"]')].length === 0,
    [...d.querySelectorAll('a[href="#"]')].map(a => a.id).join(','));

  // ── fee-aware quoting ────────────────────────────────────────────────
  // The demo pair prices ROBIN at 0.000000112 ETH, so 1 ETH buys
  // 8,928,571.4 ROBIN at mid. The Pons hook takes 4%, leaving 8,571,428.6.
  const amtIn = d.querySelector('#amtIn'), amtOut = d.querySelector('#amtOut');
  amtIn.value = '1';
  amtIn.dispatchEvent(new win.Event('input', { bubbles: true }));

  const gross = 1 / 0.000000112;
  const net = gross * (1 - win.ROBIN.swap.feePct / 100);
  check('quote subtracts the pool fee', amtOut.value === '8.57M',
    `${amtOut.value} (gross would be 8.93M, net ${(net/1e6).toFixed(2)}M)`);
  check('fee row shows the total', t('#mFee') === '4%', t('#mFee'));

  // minimum received must sit below the fee-adjusted quote, not the mid-price
  const minTxt = t('#mMin').replace(/[^0-9.]/g, '');
  const minVal = parseFloat(minTxt) * 1e6;
  check('minimum received is below the net quote', minVal < net && minVal > net * 0.9,
    `${t('#mMin')} vs net ${(net/1e6).toFixed(2)}M`);
  check('minimum received is below the gross quote too', minVal < gross,
    `${minVal} vs gross ${gross}`);

  // the low slippage steps are only usable because the fee is handled separately
  const slips = [...d.querySelectorAll('#slip button')].map(b => b.textContent);
  check('slippage steps no longer have to absorb the fee',
    slips.join(',') === '1%,2%,5%,10%', slips.join(','));

  check('no script errors', errors.length === 0, errors.join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 700);
