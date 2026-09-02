/* ============================================================================
   $ROBIN — Robin Nakamoto  ::  site configuration
   ----------------------------------------------------------------------------
   Everything you might want to change lives in this one file.
   Edit, save, re-upload. No build step, no npm, no framework.
   ========================================================================== */

window.ROBIN = {

  /* ---------------------------------------------------------------- token */
  token: {
    name:     'Robin Nakamoto',
    symbol:   'ROBIN',
    address:  '0x280413fbF06CcC1114094A5967dB2191d49EE75e',
    decimals: 18,
    // Fixed supply minted by the Pons launch factory. Verified live on-chain
    // at runtime via totalSupply() — this is only the pre-fetch placeholder.
    supply:   1_000_000_000
  },

  /* ---------------------------------------------------------------- chain */
  // Robinhood Chain mainnet. Gas is paid in ETH.
  chain: {
    id:        4663,
    idHex:     '0x1237',
    name:      'Robinhood Chain',
    rpc:       'https://rpc.mainnet.chain.robinhood.com',
    // Optional extra RPCs — used as automatic failover if the first is slow.
    rpcBackup: [],
    explorer:  'https://robinhoodchain.blockscout.com',
    currency:  { name: 'Ether', symbol: 'ETH', decimals: 18 }
  },

  /* --------------------------------------------------------------- market */
  market: {
    // DexScreener chain slug + the Uniswap V4 pool id from your chart link.
    dsChain:  'robinhood',
    poolId:   '0x7d8a56584434d8355b891da0ff62d9168669f87dd9c8ad77f6c8fb0a6b6eb7d7',
    // Poll interval for price / mcap / volume, in milliseconds.
    refreshMs: 30000,
    // Optional: the pool/PoolManager contract holding liquidity. Leave blank and
    // the live-trade feed auto-detects it from recent Transfer logs.
    poolContract: ''
  },

  /* ----------------------------------------------------------------- swap */
  swap: {
    /*  mode: 'handoff'  (default, zero config, always correct)
     *        Quote + balances are shown natively on the page, then the trade
     *        is handed to the Uniswap app with chain, tokens and amount
     *        pre-filled. Nothing to configure, nothing that can go wrong.
     *
     *  mode: 'v4'       (fully on-page execution)
     *        Signs and sends the swap from this page through the Uniswap V4
     *        Universal Router. Requires the four values below. DO NOT guess
     *        them — read them off-chain first (see README "Enabling on-page
     *        swaps"). A wrong address here can cost users money.
     */
    mode: 'handoff',

    universalRouter: '',   // Uniswap Universal Router on chain 4663
    permit2:         '',   // Permit2 (canonical: 0x000000000022D473030F116dDEE9F6B43aC78BA3)
    stateView:       '',   // Uniswap V4 StateView — enables true on-chain quotes

    // The V4 PoolKey for the ROBIN pool. currency0 < currency1 (address order);
    // native ETH is the zero address. hooks is the Pons shared hook.
    poolKey: {
      currency0:   '0x0000000000000000000000000000000000000000',
      currency1:   '0x280413fbF06CcC1114094A5967dB2191d49EE75e',
      fee:         0,
      tickSpacing: 0,
      hooks:       ''
    },

    /* Total fee taken out of every swap by the Pons hook on the V4 pool,
     * as a percentage. This is the creator fee plus the protocol share — the
     * figure a trader actually loses, not the LP fee tier.
     *
     * It matters here because the quote comes from the pool's mid-price, which
     * does not know about the hook. Without subtracting it the panel would
     * promise ~4% more than the pool pays out, and every swap under a 4%
     * slippage tolerance would revert. Set it to 0 for an untaxed token. */
    feePct: 4,

    slippageDefault: 2,           // percent, on top of feePct
    presets:        [0.01, 0.05, 0.1, 0.5]   // quick-buy amounts in ETH
  },

  /* ------------------------------------------------------------------- ai */
  ai: {
    // Server-side proxy holding your API key. Relative so it works from the
    // /robin sub-path. PHP hosting -> 'api/ai.php' | Vercel -> 'api/ai'
    endpoint: 'api/ai.php',

    // An image-output model on your provider. Must accept an input image and
    // return one, so the generated doge stays your doge. See the README for a
    // one-line curl that lists what your key can reach.
    model: 'google/gemini-2.5-flash-image',

    enabled: true
  },

  /* -------------------------------------------------------------- socials */
  links: {
    twitter:   'https://x.com/shopping_io',
    telegram:  'https://t.me/robinnakamotoofficial',
    dexscreener: 'https://dexscreener.com/robinhood/0x7d8a56584434d8355b891da0ff62d9168669f87dd9c8ad77f6c8fb0a6b6eb7d7',
    pons:      'https://www.ponsfamily.com/launchpad/0x280413fbF06CcC1114094A5967dB2191d49EE75e',
    uniswap:   'https://app.uniswap.org/swap',
    // Chain slug the Uniswap app uses in its ?chain= parameter.
    uniswapChainSlug: 'robinhood',
    github:    ''
  },

  // X/Twitter handle for the live timeline embed (no @). Leave '' to hide it.
  twitterHandle: 'shopping_io',

  /* --------------------------------------------------------------- supply */
  // Verifiable facts, not a made-up percentage split. Each is something a
  // holder can check on the explorer or in the contract.
  supplyFacts: [
    { label: 'Fixed supply',   value: '1,000,000,000',
      note: 'Minted once by the Pons factory. No mint function, ever.' },
    { label: 'Sent to Billy Markus', value: '30,000,000',
      note: '3% of supply, gifted to the co-creator of Dogecoin.', accent: true },
    { label: 'Liquidity',      value: 'Locked forever',
      note: 'A permanently locked Uniswap V4 position. Nobody can pull it.' },
    { label: 'Swap fee',       value: '4%',
      note: '3% to the creator, 1% to the Pons protocol. Taken by the pool hook.' }
  ]
};
