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

## Artwork

Your real artwork ships with the site — no placeholders. Everything was derived
from the two files you sent and optimised for the web:

| File | Size | Used for |
|---|---|---|
| `robin-logo.png` / `.webp` | 106 KB / 25 KB | hero (512px) |
| `robin-logo-128.png` / `.webp` | 9 KB / 4 KB | nav, footer, swap token icon |
| `robin-doge.webp` | 965 KB | the animated loop, 400px, 60 frames |
| `robin-doge.gif` | 1.2 MB | animation fallback for older browsers |
| `robin-doge-poster.webp` | 17 KB | first frame, shown while the loop loads |
| `robin-banner.png` / `.webp` | 350 KB / 48 KB | link previews on X, Telegram, Discord |
| `favicon-*.png`, `favicon.ico`, `apple-touch-icon.png` | — | browser tab and home screen |

Your 1 MB source PNG became a 25 KB WebP, and the 9.5 MB GIF became a 965 KB
animated WebP — same 60 frames, same 6-second loop.

**The animation never blocks the page.** The 17 KB poster paints immediately and
the loop is fetched only when the meme band scrolls into view. Anyone on a
data-saver connection, a 2G connection, or with "reduce motion" turned on gets a
Play button instead and downloads nothing until they tap it.

To swap in different artwork later, replace the files in `assets/img/` keeping
the same names. `assets/img/` also holds `robin-doge-poster.webp`, which should
match the first frame of whatever animation you use.

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

**Mobile** — the swap panel moves above the how-to-buy steps on a phone (it's the
point of the section), a sticky bar with the live price and a Buy button follows
you once you're past the hero, and the layout is checked for horizontal overflow
at 360px, 390px and 1280px in a real browser via `npm run shots`.

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
npm run shots   # renders in Chromium at 360/390/1280 and flags layout problems
```

`test/abi.test.js` rebuilds the Universal Router calldata with ethers from the V4 spec and
asserts our hand-rolled encoder produces identical bytes, then checks the pool-key guard
rejects a mismatched config. `test/smoke.test.js` boots the whole page in jsdom with the
network stubbed and asserts the DOM actually populated and nothing threw.
`test/shots.js` renders the real site in Chromium at three widths, screenshots
each, and reports any horizontal overflow or undersized tap targets.

---

## Notes

- The site is non-custodial. It never sees a private key and every transaction is
  confirmed in the user's own wallet.
- `preview.html` is a generated single-file bundle with sample data baked in, for showing
  the design without a server. It is not what you deploy.
- Nothing here is financial advice, and the footer says so.
