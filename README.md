# $ROBIN — Robin Nakamoto

The official site for **Robin Nakamoto ($ROBIN)** on **Robinhood Chain**, built to be
dropped straight onto `shopping.io/robin`.

Plain HTML, CSS and JavaScript. No build step, no framework, no npm install needed to
deploy — upload the folder and it runs.

---

## Deploy to InMotion (or any cPanel host)

Plain HTML, CSS and JavaScript plus two PHP files. No build step, no npm, no
Node on the server.

**1. Upload.** cPanel → **File Manager** → `public_html`, create a folder called
`robin`, upload `robin-site.zip` into it and hit **Extract**:

```
public_html/robin/
├── .htaccess
├── index.html
├── assets/
└── api/
    ├── scan.php      ← Robin Scanner
    ├── provider.php  ← your AI provider connection
    ├── lib.php       ← shared HTTP + the summary prompt
    ├── rpc.php       ← chain relay, fixes an empty buy feed
    └── config.php    ← your API key
```

`shopping.io/robin` is live. Every path is relative, so the sub-folder needs no
configuration.

> File Manager hides dotfiles. If `.htaccess` seems missing, turn on
> **Settings → Show Hidden Files** before extracting.

**2. PHP version.** cPanel → **Select PHP Version** → **8.0 or newer**, with the
`curl` extension ticked.

**3. Check it.** Open `https://shopping.io/robin/api/provider.php?selftest=1`.
It reports whether the key loaded, whether your host can reach the internet at
all, and which endpoint your provider actually uses. (The site works without a
key — only the scanner's written summary needs one.)

**4. HTTPS.** Once the certificate is active in cPanel, uncomment the redirect
block at the bottom of `.htaccess`.

---

## Updating later

**Do not delete anything first. Extract the new zip straight over the top.**
Every file has a stable name, so new copies replace old ones. Deleting first
only risks losing the one file you may have edited.

Each zip stamps its own build id onto the stylesheet and script URLs
(`style.css?v=202609021845`), so browsers fetch the new files immediately
instead of serving yesterday's from cache. **To confirm an update landed**, view
source and look at that number — if it changed, you are on the new build.

Editing a file by hand on the server instead? Bump the `?v=` numbers in
`index.html` yourself, or the old version keeps being served.

### The one file to be careful with

`api/config.php` ships inside the zip **with your API key in it**, so uploading
replaces it. Harmless while the key is unchanged — but if you rotate the key,
put the new one in **`api/config.local.php`** instead:

```php
<?php return ['ROBIN_AI_KEY' => 'your-new-key'];
```

That file is never shipped, never overwritten, and takes precedence over
`config.php`. The self-test prints which file the key came from, so you can
always see which is in play.

### Leftovers from older builds

Files earlier versions shipped and this one does not — the old
`assets/img/*.svg` artwork, `api/ai.php` and `api/ai.js` from the meme forge —
are harmless if they linger, because nothing references them. Delete
`api/ai.php` and `api/ai.js` if you had them, though: they were built for image
generation, which this provider does not offer, and leaving them around only
invites someone to wonder why they do not work.

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
scanner.endpoint // where the scanner posts (api/scan.php by default)
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

**Motion on phones** — Android Chrome reports `prefers-reduced-motion` whenever
battery saver is on, so the usual blanket "disable every animation" rule leaves
most phones looking at a static page. Instead only the two things that genuinely
cause discomfort are switched off under that setting: page-wide smooth scrolling
and the large continuous drift behind the layout. The small local touches — the
glass sweep, the wordmark sheen, the dog's float, the marquee, entrance fades —
keep running. `test/motion.test.js` asserts both states in a real browser.

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

Finding them is a search, not a single query: the feed walks backwards from the
head in windows — up to 20 of them, within a 20-second budget — until it has
enough buys to fill the section. The last 25 are kept in the visitor's browser
so history survives a reload, and once buys are on screen they stay there.

> **If the feed is empty, it is almost always CORS.** A browser can only call
> the chain RPC directly when that endpoint sends CORS headers, and many do not
> — every call then fails silently, taking the buy feed, the balances and the
> on-chain supply with it. `api/rpc.php` is a same-origin relay for exactly this
> case: the site tries the RPC directly first and falls back to the relay only
> when it has to, so it costs nothing when CORS is already open. The relay
> passes through a fixed list of read-only methods and refuses everything else,
> so publishing it grants nobody anything they could not do by calling the
> public RPC themselves. Set `chain.relay: ''` to turn it off.

**Buy notifications** — each buy also pops up in the corner: the amount, what it
cost, who, linked to the transaction. On load the recent ones replay one at a
time so the page opens with evidence rather than a static number, and after that
only real ones appear. Never more than three on screen, and a chain with no buys
shows nothing at all rather than inventing activity. Tune or disable it under
`market.popups`.

**Connect wallet** — a picker rather than a guess, in up to three groups:
wallets already in the browser (discovered via EIP-6963, listed with their own
name and icon), **wallet apps** — MetaMask, Trust, Coinbase Wallet, Phantom —
which are always offered because on a phone that is the only thing that works
and on a desktop plenty of people keep their wallet on their phone, and browser
extensions to install, shown only on desktop when nothing was found. Each app
link reopens the site inside that wallet's own browser, where connecting is one
tap. iPadOS is detected too, which reports itself as a Mac.

**Swap** — deliberately plain: amount in, amount out, buy. The slippage control
is hidden because the quote already accounts for the pool fee and there is
nothing left worth tuning. Set `swap.showSlippage: true` to bring it back.

**Swap panel** — connects any EVM wallet, adds Robinhood Chain (4663) if the wallet
doesn't have it, reads real balances, quotes from the live pool and shows minimum
received at your slippage. See below for the two execution modes.

**Robin Scanner** — the one AI feature. Paste any Robinhood Chain token address
and get a risk report: contract verification, mint functions, owner powers,
holder concentration, liquidity depth, pair age. Every check is computed from
chain data; the model only writes the summary and cannot overrule a finding.
See below.

**Community** — the three posts named in `config.tweets` are embedded
individually, which is far more reliable than a timeline widget: timelines are
blocked by many privacy extensions and render nothing at all for a protected
account. A follow card sits alongside them, and takes over entirely if X never
loads. To change which posts appear, paste the numeric id from the end of a post
URL into `tweets`, newest first.

---

## Robin Scanner (the AI feature)

Paste any Robinhood Chain token address and the site reports what could go wrong
with it: whether the contract is verified, whether more tokens can be minted,
whether the owner can pause trading or change the tax, how much of the supply
sits in a handful of wallets, and whether the pool is deep enough to sell into.

**The important design decision: the checks are computed, not asked of a model.**
Holder concentration is arithmetic over the explorer's holder list. "Can this be
minted?" is a match against the verified source. Liquidity depth is a ratio.
`api/scan.php` works all of it out and reaches the verdict on its own. Only then
is a language model handed the finished findings and asked to write the
paragraph at the top — and told, in the prompt, that it cannot overturn them.

That ordering is the whole point. A model asked *"is this a rug?"* will produce a
confident answer out of nothing. A model handed *"the top ten wallets hold 87% of
supply"* can only explain it.

**It never guesses when it cannot look.** If the explorer or the market data
source does not answer, the affected findings are marked `unknown`, the verdict
becomes *"Could not check"*, and nothing is cached. Reporting "high risk"
because a fetch failed would be a lie with someone's money attached; reporting
"looks fine" would be worse.

Verdicts, in order of severity: `high` · `caution` · `partial` · `ok` ·
`unknown`. Colour is never the only signal — the wording says the same thing,
and every finding carries a mark as well as a colour.

### It works without an API key

Every check the scanner reports is computed from public chain data. The key buys
one thing: the plain-English paragraph on top. Without it the panel shows the
verdict, the numbers and the findings exactly as it otherwise would.

### Setup

Your API key must never reach the browser. `api/provider.php` holds it
server-side. Set it either as an environment variable `ROBIN_AI_KEY`, or by
renaming `api/config.example.php` to `api/config.php` and pasting it in.
`api/config.php` is git-ignored — never commit it.

If you upload a new zip later, note that `config.php` ships in it and will be
overwritten. Put a rotated key in **`api/config.local.php`** instead: it takes
precedence and no future upload can revert it.

### Check your setup

After uploading, open this in a browser:

```
https://shopping.io/robin/api/provider.php?selftest=1
```

It prints a plain-text report: where the key was found (masked to its first few
characters), which API root and auth header answered, and which request shape
your provider speaks. Add `&live=1` to spend one real request and prove the
whole path end to end.

| What it says | What to do |
|---|---|
| `KEY not found` | Set `ROBIN_AI_KEY`, or fill in `api/config.php` |
| `no root answered` | Key is wrong, or your API root is none of the ones tried |
| `CONNECT tunnel failed` | Your host blocks outbound HTTPS — ask them to allow it |
| `The API key was rejected` | The key is wrong, inactive, or out of credit |

### It configures itself

You should not have to set any of this. On the first request the proxy works out
the provider's **API root, auth header and request shape** for itself, using
cheap `GET`s only — `/models` to find the root and auth, then a `GET` against
each POST-only endpoint (`405` means it is there, `404` means it is not) — so
discovery never spends a paid request. The working combination is cached for a
day.

Providers disagree about the request shape, so both are tried:

| Shape | Request | Text comes back as |
|---|---|---|
| `responses` | `POST /responses` with `input` | `output[].content[].text` |
| `chat` | `POST /chat/completions` with `messages` | `choices[0].message.content` |

A wrong guess comes back as a **400** just as often as a 404 — *"model does not
support the input parameter"*, *"unknown parameter"* — so a 400 moves the search
on exactly like a missing route does. A 5xx gets one quiet retry first, because
that is load rather than shape.

If none of the guessed roots is right, set the `ROBIN_AI_ROOTS` environment
variable (comma separated) to have discovery try yours first — no code change —
or edit `API_ROOT` at the top of `api/provider.php`.

`test/discovery.test.sh` proves all of this against a mock provider whose root,
auth header and shape all differ from the defaults.

### Cost control

`api/scan.php` limits each IP to **20 scans per 10 minutes** and caches each
token's report for five minutes, so a token everyone is checking costs one
request rather than hundreds. Raise or lower `SCAN_RATE_MAX`, `SCAN_RATE_WIN`
and `CACHE_TTL` at the top of the file.

### Why not a chatbot

Because a chatbot on a memecoin site answers questions nobody came to ask. The
scanner does something the chain has no other tool for — Robinhood Chain is new
and Pons launches a token a day — and it is useful to someone who has never
heard of $ROBIN, which is the part that brings them to the page.

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

What each one is for:

| File | What it proves |
|---|---|
| `abi.test.js` | Rebuilds the Universal Router calldata with ethers from the V4 spec and asserts our hand-rolled encoder produces identical bytes; checks the pool-key guard rejects a mismatched config |
| `smoke.test.js` | Boots the whole page in jsdom with the network stubbed; the DOM populated and nothing threw |
| `discovery.test.sh` | Finds a provider whose root, auth header and request shape all differ from the defaults; a 400 advances the search, a 5xx is retried once |
| `scan.test.sh` | The scanner's scoring against known token profiles: a clean token passes, a rug is called, and unreachable sources produce "could not check" rather than an accusation |
| `scanner.test.js` | The same three outcomes end to end in a browser, plus a bad address refused on the page |
| `motion.test.js` | Animations still run under `prefers-reduced-motion` (Android battery saver sets it), and the glass panels are static except when one arrives |
| `buypop.test.js` | Buy notifications replay on load, exactly one is on screen at a time, and a silent chain shows nothing at all |
| `shots.js` | Renders in Chromium at three widths and reports horizontal overflow or undersized tap targets |

```bash
npm run perf <before-dir> <after-dir>   # frame pacing, throttled phone, medians
```

`test/perf/` measures dropped frames on a 6x-throttled 390px viewport with the
page scrolling. It is how the motion work was decided: `variants.js` switches
one effect off at a time to find what is actually costing frames, and
`compare.js` runs two checkouts alternately so a result is not just noise.

---

## Notes

- The site is non-custodial. It never sees a private key and every transaction is
  confirmed in the user's own wallet.
- `preview.html` is a generated single-file bundle with sample data baked in, for showing
  the design without a server. It is not what you deploy.
- Nothing here is financial advice, and the footer says so.
