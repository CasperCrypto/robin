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
    ├── ai.php        ← the meme forge
    ├── rpc.php       ← chain relay, fixes an empty buy feed
    └── config.php    ← your API key
```

`shopping.io/robin` is live. Every path is relative, so the sub-folder needs no
configuration.

> File Manager hides dotfiles. If `.htaccess` seems missing, turn on
> **Settings → Show Hidden Files** before extracting.

**2. PHP version.** cPanel → **Select PHP Version** → **8.0 or newer**, with the
`curl` extension ticked.

**3. Check it.** Open `https://shopping.io/robin/api/ai.php?selftest=1&probe=1`.
It reports whether the key loaded, whether your host can reach the internet at
all, and which endpoint your provider actually uses.

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
`assets/img/*.svg` artwork, for instance — are harmless if they linger, because
nothing references them. Tidy them up if you like; the site does not care.

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

**Meme forge** — the one AI feature. Describe a scene, get a picture of Robin in
it, drawn from your real artwork so the character stays on-model. Download, copy,
or post straight to X.

**Community** — the three posts named in `config.tweets` are embedded
individually, which is far more reliable than a timeline widget: timelines are
blocked by many privacy extensions and render nothing at all for a protected
account. A follow card sits alongside them, and takes over entirely if X never
loads. To change which posts appear, paste the numeric id from the end of a post
URL into `tweets`, newest first.

---

## The meme forge (AI image generation)

One AI feature: a visitor describes a scene, and the site returns a picture of
Robin in it.

**How it stays on-model.** Nothing is trained or fine-tuned. On every single
request the proxy attaches your `assets/img/robin-logo.png` as a reference
image alongside the prompt, and the house style (flat cel shading, brand lime,
square, no lettering) is applied server-side where visitors cannot edit it out.
The model conditions on that reference, so the dog keeps his hat and glasses
instead of drifting into a generic shiba. Each generation is a new image — the
character is consistent, the scene is not.

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
| `KEY MISSING` | Set `ROBIN_AI_KEY`, or fill in `api/config.php` |
| `HTTP 401` / `403` | Run the probe below — it may be the API root, not the key |
| `HTTP 404` on `/models` | Your API root differs — change `API_ROOT` in `api/ai.php` |
| `CONNECT tunnel failed` | Your host blocks outbound HTTPS — ask them to allow it |
| `RESULT NO IMAGE` + text | You pointed at a text model; pick one from the list it printed |

### It configures itself

You should not have to set any of this. On the first request the proxy works
out the provider's **API root, auth header and request shape** for itself, using
cheap `GET`s only — `/models` to find the root and auth, then a `GET` against
each POST-only endpoint (`405` means it is there, `404` means it is not) — so
discovery never spends a generation. The working combination is cached for a
day; a failed search is remembered for five minutes so it is not re-run on every
page view. The whole search is capped at 25 seconds and skips hosts that do not
answer at all.

If a cached combination later stops working, one refusal triggers a fresh
search and a retry before the visitor sees an error.

`test/discovery.test.sh` proves this against a mock provider whose root, auth
header and shape all differ from the defaults.

### If it still cannot find your provider

```
https://shopping.io/robin/api/ai.php?selftest=1&probe=1
```

The probe streams its results as it goes and survives a 30-second execution
limit, so you always see how far it got. It tells three failures apart:

- **No host answered at all** — your server cannot make outbound HTTPS requests.
  Nothing in this project can fix that; ask your host to allow outbound
  connections on port 443 for your account. On InMotion, quote them:
  *"PHP cURL cannot make outbound HTTPS requests to external APIs."*
- **401/403 everywhere** — the key is wrong, inactive, or out of credit.
- **404 everywhere** — the API root is none of the ones tried. Take it from your
  provider's docs and set `API_ROOT`, or set the `ROBIN_AI_ROOTS` environment
  variable (comma separated) to have discovery try yours first — no code change.

### Three ways to ask for a picture

Providers disagree about this, so the site tries all three and keeps whichever
works:

| Shape | Request | Image comes back as |
|---|---|---|
| `responses` | `POST /responses`, `input` + `tools:[{image_generation}]` | `image_generation_call.result` |
| `chat` | `POST /chat/completions`, `messages` + `modalities` | `message.images[]` |
| `images` | `POST /images/generations`, `prompt` | `data[0].b64_json` |

A wrong guess comes back as a **400** just as often as a 404 — *"model does not
support the tools parameter"*, *"unknown parameter"* — so a 400 moves the search
on exactly like a missing route does. Only a 429 or a 5xx stops it, because
those are about load rather than shape.

`responses` and `chat` attach your artwork as a reference image so the dog stays
on-model. `images` cannot take one, so the style prompt describes the character
in full — green feathered Robin Hood hat, black rectangular glasses, cream and
tan fur — and gets close from words alone.

### When it still will not draw

**The page tells you why.** A failed generation shows the provider's own words
right there, with a **Copy details** button next to it that puts the whole
picture on your clipboard — endpoint, auth style, shape, model, HTTP status and
every attempt with its rejection:

```
$ROBIN meme forge — failure report
error:  Image generation was rejected. responses: 400 model does not support
        the tools parameter | images: 400 unknown model
root:   https://api.example.com/v1
shape:  responses
model:  google/gemini-2.5-flash-image
status: 400
```

You do not need to visit a diagnostic URL or read a log to find out what broke.

A server error or a dropped connection is retried once, quietly, before anyone
is told about it — those are usually blips, and a blip should not surface as an
error at all.

Then:

- **"model not found"** → `ai.model` in `assets/js/config.js` names something
  your provider does not serve.
- **"does not support tools"** / **"unknown parameter"** → that model is
  text-only. You need one that outputs images.
- **every shape 404s** → this provider may not offer image generation at all,
  in which case no configuration will help. Point `ROBIN_AI_ROOTS` at one that
  does; no code change needed.

`api/ai.php?selftest=1&image=1` walks all three and prints each response in full.

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
