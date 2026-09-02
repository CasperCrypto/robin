/* Cross-verifies the hand-rolled ABI encoder in swap.js against ethers v6,
   and checks the PoolKey -> poolId guard actually catches bad config. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { AbiCoder, keccak256, getBytes, toUtf8Bytes } = require('ethers');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://shopping.io/robin/' });
const win = dom.window;
win.fetch = () => new Promise(() => {});                 // never resolves: no network in tests
win.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
win.TextEncoder = TextEncoder;
win.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){} });

const load = f => win.eval(fs.readFileSync(path.join(root, 'assets/js', f), 'utf8'));
['config.js','keccak.js','app.js','market.js','wallet.js','swap.js'].forEach(load);

const coder = AbiCoder.defaultAbiCoder();
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = String(got).toLowerCase() === String(want).toLowerCase();
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`   got  ${got}\n   want ${want}`);
};

/* ---- 1. PoolKey encoding matches abi.encode(PoolKey) ------------------- */
const PK = {
  currency0: '0x0000000000000000000000000000000000000000',
  currency1: '0x280413fbF06CcC1114094A5967dB2191d49EE75e',
  fee: 3000, tickSpacing: 60,
  hooks: '0x1111111111111111111111111111111111111111'
};
win.ROBIN.swap.poolKey = PK;

const wantKey = coder.encode(
  ['tuple(address,address,uint24,int24,address)'],
  [[PK.currency0, PK.currency1, PK.fee, PK.tickSpacing, PK.hooks]]
);
// poolId = keccak256(abi.encode(PoolKey))
eq('PoolKey -> poolId', win.RB.swap.computePoolId(), keccak256(wantKey));

/* ---- 2. Full execute() calldata matches ethers ------------------------- */
win.ROBIN.swap.universalRouter = '0x2222222222222222222222222222222222222222';
win.ROBIN.swap.permit2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

const amountIn = 10n ** 17n;          // 0.1 ETH
const minOut   = 12345678n * 10n ** 12n;
const deadline = 1893456000n;

const tx = win.RB.swap.buildSwapTx('buy', amountIn, minOut, deadline);

// Rebuild the same thing with ethers, from the spec.
const exactInSingle = coder.encode(
  ['tuple(tuple(address,address,uint24,int24,address),bool,uint128,uint128,bytes)'],
  [[[PK.currency0, PK.currency1, PK.fee, PK.tickSpacing, PK.hooks], true, amountIn, minOut, '0x']]
);
const settleAll = coder.encode(['address','uint256'], [PK.currency0, amountIn]);
const takeAll   = coder.encode(['address','uint256'], [PK.currency1, minOut]);

const actions = '0x060c0f';                                  // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
const input = coder.encode(['bytes','bytes[]'], [actions, [exactInSingle, settleAll, takeAll]]);
const wantData =
  keccak256(toUtf8Bytes('execute(bytes,bytes[],uint256)')).slice(0, 10) +
  coder.encode(['bytes','bytes[]','uint256'], ['0x10', [input], deadline]).slice(2);

eq('execute() calldata', tx.data, wantData);
eq('tx.to',    tx.to,    win.ROBIN.swap.universalRouter);
eq('tx.value (native in)', BigInt(tx.value), amountIn);

/* ---- 3. Selling ROBIN sends no ETH ------------------------------------- */
const sellTx = win.RB.swap.buildSwapTx('sell', 5n * 10n ** 18n, 1n, deadline);
eq('tx.value (token in)', BigInt(sellTx.value), 0n);

/* ---- 4. The safety guard actually refuses bad config -------------------- */
win.ROBIN.swap.mode = 'v4';
win.ROBIN.market.poolId = keccak256(wantKey);
eq('v4Ready with a matching pool key', win.RB.swap.v4Ready(), true);

win.ROBIN.market.poolId = '0x' + 'de'.repeat(32);     // pretend the operator mistyped
eq('v4Ready refuses a mismatched pool key', win.RB.swap.v4Ready(), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
