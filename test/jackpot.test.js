/* The jackpot contract, on a real EVM.
   These are the cases that matter when a contract holds other people's money,
   so most of them are about what must NOT be possible. */
const { compile, makeVm, addr } = require('./evm/harness');
const { keccak256, solidityPackedKeccak256, AbiCoder } = require('ethers');
const path = require('path');

let pass = 0, fail = 0;
const ck = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };

const ONE = 10n ** 18n;
const OP = addr('aa'), TREASURY = addr('bb');
const P1 = addr('11'), P2 = addr('22'), P3 = addr('33');

const SEED = '0x' + 'ab'.repeat(32);
const SEED_HASH = solidityPackedKeccak256(['bytes32'], [SEED]);

(async () => {
  const art = compile([
    path.join(__dirname, '..', 'contracts', 'RobinJackpot.sol'),
    path.join(__dirname, '..', 'contracts', 'MockToken.sol'),
  ]);

  /* A fresh world for each scenario, so nothing leaks between them. */
  async function world(feeBps = 0, rakeBps = 300) {
    const vm = await makeVm();
    for (const a of [OP, TREASURY, P1, P2, P3, addr('ff')]) await vm.fund(a);
    const token = await vm.deploy(art.MockToken, [feeBps], OP);
    const jack = await vm.deploy(art.RobinJackpot,
      [token.address.toString(), TREASURY.toString(), rakeBps, 300, 3600], OP);
    for (const p of [P1, P2, P3]) {
      await vm.send(token, p, 'mint', [p.toString(), 1000n * ONE]);
      await vm.send(token, p, 'approve', [jack.address.toString(), 10n ** 30n]);
    }
    const bal = async a => (await vm.call(token, 'balanceOf', [a.toString()]))[0];
    return { vm, token, jack, bal };
  }

  /* ── a whole round, start to finish ─────────────────────────────────── */
  {
    const { vm, token, jack, bal } = await world();
    await vm.send(jack, OP, 'openRound', [SEED_HASH]);
    await vm.send(jack, P1, 'enter', [500n * ONE]);
    await vm.send(jack, P2, 'enter', [300n * ONE]);
    await vm.send(jack, P3, 'enter', [200n * ONE]);

    const info = await vm.call(jack, 'roundInfo', [1]);
    ck('the pot is every stake', info[4] === 1000n * ONE, String(info[4]));
    ck('the contract actually holds it', (await bal(jack.address)) === 1000n * ONE);
    ck('the commitment is on chain', info[2] === SEED_HASH, info[2]);
    ck('the seed is not', info[3] === '0x' + '00'.repeat(32), info[3]);

    ck('you cannot draw while it is open', !(await vm.send(jack, OP, 'draw', [SEED])).ok);
    vm.warp(301);
    ck('entries stop at the close', !(await vm.send(jack, P1, 'enter', [10n * ONE])).ok);
    ck('a wrong seed is refused',
       (await vm.send(jack, OP, 'draw', ['0x' + 'cd'.repeat(32)])).error === 'BadSeed');
    ck('only the operator may draw',
       (await vm.send(jack, P1, 'draw', [SEED])).error === 'NotOperator');

    const before = { p1: await bal(P1), p2: await bal(P2), p3: await bal(P3), t: await bal(TREASURY) };
    const drew = await vm.send(jack, OP, 'draw', [SEED]);
    ck('the draw succeeds', drew.ok, drew.error);

    const after = await vm.call(jack, 'roundInfo', [1]);
    const winner = after[6].toLowerCase();
    const ticket = after[5];

    // Recompute the winner independently, the way any player could.
    const expectTicket = BigInt(keccak256(
      AbiCoder.defaultAbiCoder().encode(['bytes32'], [SEED]).slice(0, 66) +
      AbiCoder.defaultAbiCoder().encode(['uint256'], [1]).slice(2))) % (1000n * ONE);
    ck('the ticket is the committed seed keyed by round', ticket === expectTicket,
       `${ticket} vs ${expectTicket}`);

    const stakes = [[P1, 500n], [P2, 300n], [P3, 200n]];
    let acc = 0n, expectWinner = null;
    for (const [a, s] of stakes) { acc += s * ONE; if (ticket < acc && !expectWinner) expectWinner = a; }
    ck('the winner is whoever the ticket lands on',
       winner === expectWinner.toString().toLowerCase(), `${winner} vs ${expectWinner}`);

    const rake = 1000n * ONE * 300n / 10000n;
    ck('the treasury takes exactly the rake', (await bal(TREASURY)) - before.t === rake);
    const paid = { p1: (await bal(P1)) - before.p1, p2: (await bal(P2)) - before.p2, p3: (await bal(P3)) - before.p3 };
    ck('the winner takes the rest', Object.values(paid).reduce((a, b) => a + b, 0n) === 1000n * ONE - rake);
    ck('the contract keeps nothing', (await bal(jack.address)) === 0n, String(await bal(jack.address)));
    ck('losers get nothing back', Object.values(paid).filter(v => v > 0n).length === 1);
  }

  /* ── the operator goes dark ─────────────────────────────────────────── */
  {
    const { vm, jack, bal } = await world();
    await vm.send(jack, OP, 'openRound', [SEED_HASH]);
    await vm.send(jack, P1, 'enter', [400n * ONE]);
    await vm.send(jack, P2, 'enter', [600n * ONE]);
    vm.warp(301);

    ck('refunds are not open while the operator still has time',
       (await vm.send(jack, P1, 'openRefunds')).error === 'StillOpen');
    vm.warp(3601);
    ck('anyone can open refunds once it has run out', (await vm.send(jack, P3, 'openRefunds')).ok);

    const b1 = await bal(P1), b2 = await bal(P2);
    await vm.send(jack, P1, 'claimRefund', [1]);
    await vm.send(jack, P2, 'claimRefund', [1]);
    ck('each player gets their own stake, exactly',
       (await bal(P1)) - b1 === 400n * ONE && (await bal(P2)) - b2 === 600n * ONE);
    ck('and cannot claim twice',
       (await vm.send(jack, P1, 'claimRefund', [1])).error === 'NothingToRefund');
    ck('the contract is empty afterwards', (await bal(jack.address)) === 0n, String(await bal(jack.address)));
    ck('a stranger with no stake gets nothing',
       (await vm.send(jack, P3, 'claimRefund', [1])).error === 'NothingToRefund');
  }

  /* ── one player is not a game ───────────────────────────────────────── */
  {
    const { vm, jack, bal } = await world();
    await vm.send(jack, OP, 'openRound', [SEED_HASH]);
    await vm.send(jack, P1, 'enter', [100n * ONE]);
    vm.warp(301);
    const r = await vm.send(jack, OP, 'draw', [SEED]);
    ck('drawing a one-player round opens refunds instead', r.ok, r.error);
    const b = await bal(P1);
    await vm.send(jack, P1, 'claimRefund', [1]);
    ck('the lone player gets everything back untouched', (await bal(P1)) - b === 100n * ONE);
    ck('the treasury took no rake from it', (await bal(TREASURY)) === 0n);
  }

  /* ── a token that taxes transfers ───────────────────────────────────── */
  {
    const { vm, jack, bal } = await world(400);          // 4% on every transfer
    await vm.send(jack, OP, 'openRound', [SEED_HASH]);
    await vm.send(jack, P1, 'enter', [100n * ONE]);
    const info = await vm.call(jack, 'roundInfo', [1]);
    ck('only what arrived is credited', info[4] === 96n * ONE, String(info[4]));
    ck('the books match the balance', info[4] === (await bal(jack.address)));
  }

  /* ── what the operator must not be able to do ───────────────────────── */
  {
    const { vm, jack } = await world();
    const fns = jack.art.abi.filter(f => f.type === 'function').map(f => f.name);
    ck('there is no withdraw of any kind',
       !fns.some(n => /withdraw|rescue|sweep|drain|emergency|skim/i.test(n)), fns.join(','));
    ck('the rake cannot be changed after deployment',
       !fns.some(n => /setRake|setFee|setTreasury/i.test(n)), fns.join(','));

    const over = await vm.deploy(art.RobinJackpot,
      [addr('cc').toString(), TREASURY.toString(), 501, 300, 3600], OP).catch(e => e);
    ck('a rake above the cap will not even deploy', over instanceof Error, 'it deployed');

    await vm.send(jack, OP, 'openRound', [SEED_HASH]);
    await vm.send(jack, P1, 'enter', [100n * ONE]);
    await vm.send(jack, P2, 'enter', [100n * ONE]);

    // Opening a new round while one is live would move currentRound past a
    // round still holding stakes, and neither draw() nor openRefunds() would
    // ever reach it again. Every one of those stakes would be stuck.
    ck('a live round cannot be abandoned by opening another',
       (await vm.send(jack, OP, 'openRound', ['0x' + 'ee'.repeat(32)])).error === 'WrongStatus');
    ck('the live round keeps its own commitment',
       (await vm.call(jack, 'roundInfo', [1]))[2] === SEED_HASH);

    // …and once it is resolved, the next one opens normally.
    vm.warp(301);
    await vm.send(jack, OP, 'draw', [SEED]);
    ck('the next round opens once this one is done',
       (await vm.send(jack, OP, 'openRound', ['0x' + 'ee'.repeat(32)])).ok);
    ck('nothing is left behind in the contract', (await vm.call(jack, 'roundInfo', [1]))[4] > 0n);
  }

  /* ── a stranded round is impossible even after refunds open ─────────── */
  {
    const { vm, jack, bal } = await world();
    await vm.send(jack, OP, 'openRound', [SEED_HASH]);
    await vm.send(jack, P1, 'enter', [200n * ONE]);
    await vm.send(jack, P2, 'enter', [200n * ONE]);
    vm.warp(301 + 3601);
    await vm.send(jack, P3, 'openRefunds');
    ck('a refunding round does not block the next one',
       (await vm.send(jack, OP, 'openRound', ['0x' + 'ee'.repeat(32)])).ok);

    // The old round is no longer current, so its refunds must still work.
    const b = await bal(P1);
    ck('and its players can still get out', (await vm.send(jack, P1, 'claimRefund', [1])).ok);
    ck('for exactly what they put in', (await bal(P1)) - b === 200n * ONE);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
