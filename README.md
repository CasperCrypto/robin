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
the loop is fetched only when the meme band scrolls into view, then plays on its
own. The one exception is a browser explicitly asking to save data (or a 2G
connection), which gets a Play button rather than an unrequested megabyte.

To swap in different artwork later, replace the files in `assets/img/` keeping
the same names. `assets/img/` also holds `robin-doge-poster.webp`, which should
match the first frame of whatever animation you use.

## Configure it

Everything you'd want to change is in **`assets/js/config.js`** — one commented file.

The things worth setting before launch:

```js
links.*          // X, Telegram, DexScreener, Pons. Leave '' and the link is
                 // removed rather than left dead (github is empty by default)
twitterHandle    // handle only, no @, for the live timeline
supplyFacts      // the tokenomics tiles
swap.feePct      // total fee the Pons hook takes per swap (see below)
ai.model         // the image model the meme forge calls
```

### `swap.feePct` — read this if you changed your creator fee

Set to **4** (3% creator + 1% protocol). It is not cosmetic.

Quotes come from the pool's mid-price via DexScreener, and the mid-price knows
nothing about the Pons hook. Without subtracting the fee the panel would promise
about 4% more output than the pool actually pays, and `minimum received` would be
computed from that inflated number — so any swap with a tolerance under 4% would
revert every single time.

With `feePct` set, the quote is honest, the fee gets its own row in the panel, and
the slippage setting only has to cover real price movement. If you change your
creator fee on Pons, change this number to match.

Creator fees themselves do not depend on this site at all — they are enforced by
the hook attached to the V4 pool, so every swap that touches the pool pays them
no matter which front-end sent it.

Contract address, chain details and the DexScreener pool are already filled in.

---

## What's live on the page

**Mobile** — the swap panel moves above the how-to-buy steps on a phone (it's the
point of the section), a sticky bar with the live price and a Buy button follows
you once you're past the hero, and the layout is checked for horizontal overflow
at 360px, 390px and 1280px in a real browser via `npm run shots`.

**Market strip** — price, 24h move, volume and liquidity come from the
DexScreener API for your exact pool, polled every 30s and paused in a background
tab.

**Market cap is computed, not reported.** The supply is read from your token
contract (`totalSupply`) and multiplied by the live pool price, rather than
trusting DexScreener's own `marketCap` field, which can be stale or absent. If
the contract read fails, it falls back to the reported figure.

> The bundled `preview.html` tries the real APIs first and only substitutes
> sample figures when the request is actually refused — which is what happens
> inside a sandboxed preview. When it falls back it shows a "PREVIEW SANDBOX"
> badge. Open that file from your own disk or server and it shows genuinely
> live numbers. The uploaded site never uses samples at all.

**Live buys** — reads ERC-20 `Transfer` logs straight from the Robinhood Chain
RPC. There is no trades API for a V4 pool, so it identifies the pool as the
dominant participant in a window of recent transfers, then treats tokens
*leaving* the pool as a buy. **Sells are recognised so they can be excluded, not
shown** — set `market.showSells: true` if you ever want them. Bigger buys get a
bigger animal. Pin the pool with `market.poolContract` to skip the detection.

The last 25 buys are kept in the visitor's own browser, so the feed still has
history after a reload or a quiet hour — the chain only serves a limited log
window, and without this the section would look empty on a slow day.
`market.feedRows` sets how many are displayed.

**Connect wallet** — a picker rather than a guess. Wallets that announce
themselves (EIP-6963) are listed by name and icon; one detected wallet connects
straight away, several let the visitor choose. On a phone, where wallets are
apps and nothing is injected, it offers MetaMask, Trust, Coinbase Wallet and
Phantom — each link reopens the site inside that app's browser, where
connecting is one tap. iPadOS is detected too, which reports itself as a Mac.

**Swap** — deliberately plain: amount in, amount out, buy. The slippage control
is hidden because the quote already accounts for the pool fee and there is
nothing left worth tuning. Set `swap.showSlippage: true` to bring it back.

**Swap panel** — connects any EVM wallet, adds Robinhood Chain (4663) if the wallet
doesn't have it, reads real balances, quotes from the live pool and shows minimum
received at your slippage. See below for the two execution modes.

**Meme forge** — the one AI feature. Describe a scene, get a picture of Robin in
it, drawn from your real artwork so the character stays on-model. Download, copy,
or post straight to X.

**Community** — the X timeline is attempted, but that widget is blocked by many
privacy extensions and renders nothing for a protected account, so the card
starts as a proper Follow card and is only replaced once a real timeline
actually appears. It never sits on "Loading…".

---

## The meme forge (AI image generation)

One AI feature: a visitor describes a scene, and the site returns a picture of
Robin in it. The prompt is wrapped server-side with a house style, and **your
`robin-logo.png` is attached as a reference image on every call**, so the
generated dog is always your dog — same hat, same glasses, same art style.

Visitors can download the result, copy it to the clipboard, or open X with the
caption pre-filled.

### Setup

Your API key must never reach the browser. `api/ai.php` holds it server-side.

**PHP hosting** — the common case:

1. Keep `api/ai.php`, delete `api/ai.js`.
2. Set the key either as an environment variable `ROBIN_AI_KEY`, or by renaming
   `api/config.example.php` to `api/config.php` and pasting it in.
3. `api/config.php` is git-ignored. Never commit it.

**Vercel / Netlify:** keep `api/ai.js`, delete `api/ai.php`, set `ROBIN_AI_KEY`
in the host's environment variables, and change `ai.endpoint` in `config.js`
to `'api/ai'`.

### Check your setup before anything else

After uploading, open this in a browser:

```
https://shopping.io/robin/api/ai.php?selftest=1
```

It prints a plain-text report: whether the key was found (masked), whether your
API root answers, and **which of your models can output images** — with the
right value to paste into `ai.model`. Add `&image=1` to also run one real
generation and confirm a picture actually comes back.

It never prints your key, only its first few characters so you can tell which
one is loaded.

Read the report top to bottom; it names the fix for each failure:

| What it says | What to do |
|---|---|
| `KEY MISSING` | Set `ROBIN_AI_KEY`, or create `api/config.php` |
| `HTTP 401` / `403` | The key was rejected — check it is active |
| `HTTP 404` on `/models` | Your API root differs — change `API_ROOT` at the top of `api/ai.php` |
| `CONNECT tunnel failed` | Your host blocks outbound HTTPS — ask them to allow it |
| `RESULT NO IMAGE` + text | You pointed at a text model; pick one from the list it printed |

### Picking a model

`ai.model` in `config.js` must name a model that **accepts an input image and
returns an image**. The default is `google/gemini-2.5-flash-image`. The self-test
above lists what your key can actually reach — use that rather than guessing.

`API_ROOT` at the top of `api/ai.php` (and `api/ai.js`) is the provider's API
root with no endpoint path. Change it there if your docs show a different one.

### Cost control

Image calls are the expensive kind, so the proxy limits each IP to **8 images
per 10 minutes**, caps the prompt at 400 characters, and only counts an attempt
once it is actually about to call out. Raise or lower `RATE_MAX` and
`RATE_WINDOW` in the proxy to taste.

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
