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
    /* Same-origin relay, used only if the direct RPC above cannot be reached
     * from the browser — which is what happens when the endpoint sends no CORS
     * headers, and is the usual reason the live buy feed comes up empty.
     * Set to '' to disable it. */
    relay: 'api/rpc.php',
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
    // the live-buy feed auto-detects it from recent Transfer logs.
    poolContract: '',
    // The feed shows buys only. Set true to show sells alongside them.
    showSells: false,
    // How many buys to display. The last 25 are remembered in the visitor's
    // browser so the feed keeps history through reloads and quiet spells.
    feedRows: 12,

    /* Buy notifications along the bottom of the screen — one at a time, never
     * a stack. On load the recent ones replay in sequence, then live ones
     * appear as they land. Nothing is shown if there are no real buys.
     * holdMs is how long one stays put; gapMs is the empty beat after it
     * leaves, before the next rises. */
    popups: {
      enabled: true,
      replay: 6,        // how many to replay when the page opens
      gapMs: 620,       // empty beat between them
      holdMs: 3400      // how long each stays up
    }
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

    /* What this site takes on each swap, as a percentage, on top of the pool's
     * own fee. It is subtracted from the quote rather than added afterwards,
     * so the number the panel promises is the number that arrives.
     *
     * Nothing is charged until feeRecipient is set — an uncollectable fee is
     * just a worse price. Capped at 3% in the code as well as here. */
    robinFeePct: 0.5,
    feeRecipient: '',

    /* Slippage tolerance, on top of feePct. Hidden from the panel by default —
     * the quote already accounts for the pool fee, so there is nothing here a
     * visitor needs to think about. Set showSlippage true to expose the picker. */
    slippageDefault: 2,           // percent
    showSlippage: false,
    presets:        [0.01, 0.05, 0.1, 0.5]   // quick-buy amounts in ETH
  },

  /* ------------------------------------------------------------- exchange */
  /* The token picker and the cross-chain check. Whether anything bridges into
   * Robinhood Chain is asked of the aggregators at runtime rather than assumed
   * here, so the day one of them lists the chain this starts working with no
   * code change. */
  exchange: {
    tokensEndpoint: 'api/tokens.php',
    bridgeEndpoint: 'api/bridge.php',
    routeEndpoint:  'api/route.php',
    enabled: true
  },

  /* ----------------------------------------------------------------- room */
  /* Live presence and reactions. One request per client per tick carries the
   * heartbeat, any reaction, and the cursor — so the cost of this feature is
   * one poll per visitor, and none at all from a background tab. */
  room: {
    endpoint: 'api/room.php',
    pollMs: 5000,
    enabled: true
  },

  /* ---------------------------------------------------------------- arena */
  /* Robin Arena: five-minute rounds on the $ROBIN price. Nobody deposits
   * anything — entry is gated by the balance a wallet already holds, checked
   * server-side. Round length and the balance tiers live in api/arena.php. */
  arena: {
    endpoint: 'api/arena.php',
    pollMs: 9000,
    enabled: true
  },

  /* -------------------------------------------------------------- scanner */
  /* Robin Scanner reads any Robinhood Chain token and reports what could go
   * wrong with it. Every check is computed on the server from explorer and
   * market data; the API key is only used to write the plain-English summary
   * at the top, and the scanner works without one. */
  scanner: {
    // Kept for api/scan.php, which still answers if you want to link to it.
    endpoint: 'api/scan.php',
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
    /* The official Robinhood Chain bridge. Until an aggregator quotes Solana
     * straight into the chain, this is step two of the only path that works,
     * so the swap panel links to it — paste the real URL here. */
    bridge:    '',
    github:    ''
  },

  // X/Twitter handle (no @) for the follow card and post links.
  twitterHandle: 'shopping_io',

  /* Specific posts to embed, newest first. Single-post embeds are far more
   * reliable than a timeline widget, which many privacy extensions block and
   * which renders nothing for a protected account.
   * Paste the numeric id from the end of a post URL:
   *   https://x.com/shopping_io/status/2094873068577398821  ->  '2094873068577398821'
   * Leave the array empty to show only the follow card. */
  tweets: [
    '2095112279188541614',
    '2094873068577398821',
    '2094865776071114838'
  ],

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
