# $ROBIN — Robin Nakamoto

The official site for **Robin Nakamoto ($ROBIN)** on **Robinhood Chain**, built to be
dropped straight onto `shopping.io/robin`.

Plain HTML, CSS and JavaScript. No build step, no framework, no npm install needed to
deploy — upload the folder and it runs.

---

## Upload it

Copy the contents of `dist/` (or the repo root, minus `test/` and the build scripts) to
whatever directory serves `shopping.io/robin`:

```
robin/
├── index.html
├── assets/
│   ├── css/style.css
│   ├── js/*.js
│   └── img/*.svg
└── api/
    ├── ai.php          ← PHP hosting
    └── ai.js           ← Node / Vercel hosting (delete if you use PHP)
```

Every path in the site is **relative**, so it works from a sub-path like `/robin` with
nothing to reconfigure.

To rebuild the zip yourself: `./package.sh` → `robin-site.zip`.

---

## Drop in the real artwork

The site currently ships **SVG stand-ins** I drew to match your images. To use your actual
files, save them into `assets/img/` with these exact names:

| File | What it is | Used for |
|---|---|---|
| `assets/img/robin-logo.png` | the square doge avatar | nav, hero, swap icon, footer |
| `assets/img/robin-banner.png` | the wide `$ROBIN` banner | social / link previews |

**No code change needed.** Every `<img>` already points at the `.png` first and falls back
to the SVG only if the PNG is missing. Drop the files in and they take over.

`assets/img/robin-buy.svg` is the "new buy" sticker, there if you want it for a buy bot.

---

## Configure it

Everything you'd want to change is in **`assets/js/config.js`** — one commented file.

The things worth setting before launch:

```js
links.twitter    // your real X URL — the footer link and the timeline embed
links.telegram   // leave '' and the link is removed rather than left dead
twitterHandle    // handle only, no @, for the live timeline
distribution     // the tokenomics rows and their percentages
```

Contract address, chain details and the DexScreener pool are already filled in.

---

## What's live on the page

**Market strip** — price, 24h move, market cap, volume and liquidity, polled from the
DexScreener API every 30s. Pauses in a background tab. Total supply is read from the
contract itself, not hardcoded.

**Live trade feed** — reads ERC-20 `Transfer` logs straight from the Robinhood Chain RPC.
There's no trades API for a V4 pool, so it works out which address is the pool (in any
window of recent transfers it's overwhelmingly the most frequent participant) and calls
transfers out of it buys, transfers in sells. Bigger buys get a bigger animal. If you'd
rather pin it, set `market.poolContract` in the config.

**Swap panel** — connects any EVM wallet, adds Robinhood Chain (4663) if the wallet
doesn't have it, reads real balances, quotes from the live pool and shows minimum
received at your slippage. See below for the two execution modes.

**Robin AI** — three tools sharing one endpoint: a chat assistant, an "alpha report"
that reads the live numbers and writes an honest take, and a meme forge that drafts
three X posts from an angle you give it.

---

## Robin AI setup (OpenRouter)

Your API key **must not** go in the browser. `api/ai.php` (or `api/ai.js`) is a thin
proxy that holds it server-side and adds the system prompt and live market context.

**PHP hosting** — the common case:

1. Keep `api/ai.php`, delete `api/ai.js`.
2. Set the key, either as an environment variable `OPENROUTER_API_KEY`, or by renaming
   `api/config.example.php` to `api/config.php` and pasting the key in.
3. `config.php` is git-ignored. Never commit it.

**Vercel / Netlify:** keep `api/ai.js`, delete `api/ai.php`, set `OPENROUTER_API_KEY` in
the host's environment variables, and change `ai.endpoint` in `config.js` to `'api/ai'`.

Both proxies rate-limit to 25 requests per 5 minutes per IP, cap input length, cache the
market lookup for 30s, and never echo the key or the raw upstream error.

Model is `anthropic/claude-sonnet-4.5` by default — change `ai.model` in `config.js` for
anything else OpenRouter serves.

If the key isn't set the AI section says so plainly; the rest of the site is unaffected.

---

## Enabling on-page swaps

Out of the box `swap.mode` is `'handoff'`: the page does the quoting, balance checks and
validation, then opens Uniswap with the trade pre-filled. Zero config, and it can't send
anyone to the wrong contract.

`swap.mode = 'v4'` executes the swap **from the page** through the Uniswap V4 Universal
Router. The calldata builder is written and tested (`test/abi.test.js` checks it byte-for-byte
against ethers), but it needs four values I could not verify for you:

```js
swap.universalRouter  // Uniswap Universal Router on chain 4663
swap.permit2          // canonical: 0x000000000022D473030F116dDEE9F6B43aC78BA3
swap.stateView        // optional: enables true on-chain quotes
swap.poolKey          // currency0, currency1, fee, tickSpacing, hooks
```

Get `universalRouter` from Uniswap's published deployments for Robinhood Chain, and the
`poolKey` fields from the pool itself (the Pons shared hook address, the fee tier and tick
spacing).

**There is a built-in guard.** A V4 pool id is `keccak256(abi.encode(poolKey))`, so the page
hashes whatever you configure and compares it to `market.poolId`. If they don't match it
refuses to swap on-page, falls back to the handoff, and logs the expected vs. computed id
to the console. A typo in an address gets caught before it can cost anyone money.

Selling `ROBIN → ETH` also needs the Permit2 approval flow; that's handled automatically.

---

## Chain reference

| | |
|---|---|
| Network | Robinhood Chain (mainnet) |
| Chain ID | `4663` (`0x1237`) |
| RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` |
| Gas token | ETH |
| $ROBIN | `0x280413fbF06CcC1114094A5967dB2191d49EE75e` |

---

## Tests

Not needed to deploy — they're here so changes stay safe.

```bash
npm install     # ethers + jsdom, dev only
npm test        # ABI encoding vs. ethers, then a full page boot
npm run preview # bundles preview.html and checks it renders
```

`test/abi.test.js` rebuilds the Universal Router calldata with ethers from the V4 spec and
asserts our hand-rolled encoder produces identical bytes, then checks the pool-key guard
rejects a mismatched config. `test/smoke.test.js` boots the whole page in jsdom with the
network stubbed and asserts the DOM actually populated and nothing threw.

---

## Notes

- The site is non-custodial. It never sees a private key and every transaction is
  confirmed in the user's own wallet.
- `preview.html` is a generated single-file bundle with sample data baked in, for showing
  the design without a server. It is not what you deploy.
- Nothing here is financial advice, and the footer says so.
