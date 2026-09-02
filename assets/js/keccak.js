/* ============================================================================
   keccak.js — Keccak-256 (Ethereum flavour, 0x01 padding).
   Small and dependency-free. Used to derive function selectors and to verify
   that the configured V4 PoolKey really hashes to the expected pool id.
   ========================================================================== */
(function () {
  'use strict';

  var RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
  ];
  var ROT = [
     0, 1, 62, 28, 27,
    36, 44,  6, 55, 20,
     3, 10, 43, 25, 39,
    41, 45, 15, 21,  8,
    18,  2, 61, 56, 14
  ];
  var M = 0xffffffffffffffffn;

  function rotl(x, n) {
    n = BigInt(n);
    if (n === 0n) return x;
    return ((x << n) | (x >> (64n - n))) & M;
  }

  function keccakF(A) {
    for (var r = 0; r < 24; r++) {
      // theta
      var Cc = new Array(5), D = new Array(5), x, y;
      for (x = 0; x < 5; x++) Cc[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
      for (x = 0; x < 5; x++) D[x] = Cc[(x + 4) % 5] ^ rotl(Cc[(x + 1) % 5], 1);
      for (x = 0; x < 5; x++) for (y = 0; y < 5; y++) A[x + 5 * y] ^= D[x];

      // rho + pi
      var B = new Array(25);
      for (x = 0; x < 5; x++) {
        for (y = 0; y < 5; y++) {
          B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROT[x + 5 * y]);
        }
      }
      // chi
      for (x = 0; x < 5; x++) {
        for (y = 0; y < 5; y++) {
          A[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y] & M) & B[(x + 2) % 5 + 5 * y]);
        }
      }
      // iota
      A[0] ^= RC[r];
    }
    return A;
  }

  /** bytes (Uint8Array) -> 32-byte Uint8Array digest */
  function keccak256Bytes(msg) {
    var rate = 136;                       // 1088 bits
    var len = msg.length;
    var padLen = rate - (len % rate);
    var buf = new Uint8Array(len + padLen);
    buf.set(msg);
    buf[len] = 0x01;                      // Ethereum keccak padding
    buf[buf.length - 1] |= 0x80;

    var A = new Array(25).fill(0n);
    for (var off = 0; off < buf.length; off += rate) {
      for (var i = 0; i < rate / 8; i++) {
        var lane = 0n;
        for (var b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(buf[off + i * 8 + b]);
        A[i] ^= lane;
      }
      keccakF(A);
    }

    var out = new Uint8Array(32);
    for (var j = 0; j < 4; j++) {
      var v = A[j];
      for (var k = 0; k < 8; k++) { out[j * 8 + k] = Number(v & 0xffn); v >>= 8n; }
    }
    return out;
  }

  function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (typeof input === 'string' && /^0x[0-9a-fA-F]*$/.test(input)) {
      var h = input.slice(2);
      if (h.length % 2) h = '0' + h;
      var a = new Uint8Array(h.length / 2);
      for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
      return a;
    }
    return new TextEncoder().encode(String(input));
  }

  function hex(b) {
    var s = '';
    for (var i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
    return '0x' + s;
  }

  /** keccak256 of a utf-8 string or 0x-hex string -> 0x-prefixed hex digest */
  function keccak256(input) { return hex(keccak256Bytes(toBytes(input))); }

  /** 4-byte function selector for a signature like "transfer(address,uint256)" */
  function selector(sig) { return keccak256(sig).slice(0, 10); }

  var api = { keccak256: keccak256, selector: selector, bytes: keccak256Bytes, hex: hex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.RB = window.RB || {}; window.RB.k = api; }
})();
