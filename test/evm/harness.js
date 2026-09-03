/* A local EVM, so the jackpot contract can be tested for real rather than
   reasoned about. Deploys with runCall, which avoids nonce and signature
   bookkeeping entirely — we only care about what the code does. */
const { VM } = require('@ethereumjs/vm');
const { Common, Chain, Hardfork } = require('@ethereumjs/common');
const { Address, Account, hexToBytes, bytesToHex } = require('@ethereumjs/util');
const { Interface } = require('ethers');
const solc = require('solc');
const fs = require('fs'), path = require('path');

function compile(files) {
  const sources = {};
  for (const f of files) sources[path.basename(f)] = { content: fs.readFileSync(f, 'utf8') };
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 },
                outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  })));
  const fatal = (out.errors || []).filter(e => e.severity === 'error');
  if (fatal.length) throw new Error(fatal.map(e => e.formattedMessage).join('\n'));
  const byName = {};
  for (const file of Object.keys(out.contracts))
    for (const name of Object.keys(out.contracts[file]))
      byName[name] = out.contracts[file][name];
  return byName;
}

function addr(hexByte) { return new Address(hexToBytes('0x' + hexByte.repeat(20))); }

async function makeVm() {
  const vm = await VM.create({ common: new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Shanghai }) });
  let now = 1_900_000_000n;

  async function fund(a) {
    await vm.stateManager.putAccount(a, new Account(0n, 10n ** 22n));
  }
  async function deploy(art, args = [], from = addr('aa')) {
    const iface = new Interface(art.abi);
    const encoded = args.length
      ? iface.encodeDeploy(args).slice(2)
      : '';
    const res = await vm.evm.runCall({
      caller: from, to: undefined, gasLimit: 30_000_000n,
      data: hexToBytes('0x' + art.evm.bytecode.object + encoded),
      block: { header: { timestamp: now, number: 1n, gasLimit: 30_000_000n, difficulty: 0n,
                         coinbase: addr('00'), baseFeePerGas: 0n, prevRandao: new Uint8Array(32) } },
    });
    if (res.execResult.exceptionError) throw new Error('deploy reverted: ' + res.execResult.exceptionError.error);
    return { address: res.createdAddress, iface, art };
  }
  async function send(c, from, fn, args = []) {
    const res = await vm.evm.runCall({
      caller: from, to: c.address, gasLimit: 30_000_000n,
      data: hexToBytes(c.iface.encodeFunctionData(fn, args)),
      block: { header: { timestamp: now, number: 1n, gasLimit: 30_000_000n, difficulty: 0n,
                         coinbase: addr('00'), baseFeePerGas: 0n, prevRandao: new Uint8Array(32) } },
    });
    const err = res.execResult.exceptionError;
    const ret = bytesToHex(res.execResult.returnValue);
    if (err) {
      let reason = err.error;
      // Custom errors come back as a 4-byte selector; name it if we can.
      try {
        const e = c.iface.parseError(ret);
        if (e) reason = e.name;
      } catch (_) {}
      return { ok: false, error: reason, raw: ret };
    }
    let decoded = null;
    try { decoded = c.iface.decodeFunctionResult(fn, ret); } catch (_) {}
    return { ok: true, result: decoded, logs: res.execResult.logs || [] };
  }
  async function call(c, fn, args = []) {
    const r = await send(c, addr('ff'), fn, args);
    if (!r.ok) throw new Error(fn + ' reverted: ' + r.error);
    return r.result;
  }
  function warp(seconds) { now += BigInt(seconds); }

  return { vm, fund, deploy, send, call, warp, now: () => now };
}

module.exports = { compile, makeVm, addr };
