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
    ├── arena.php     ← the Arena round engine
    ├── data/         ← the arena's database (created on first use)
    ├── scan.php      ← token scanner (no UI; still answers)
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
arena.pollMs     // how often the arena refreshes (round length is server-side)
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

**Robin Arena** — a provably fair jackpot. Claim points daily for holding
$ROBIN, throw them into the pot, and watch the wheel. Your slice is your share;
one entry takes the lot. No tokens are ever deposited. See below.

**Community** — the three posts named in `config.tweets` are embedded
individually, which is far more reliable than a timeline widget: timelines are
blocked by many privacy extensions and render nothing at all for a protected
account. A follow card sits alongside them, and takes over entirely if X never
loads. To change which posts appear, paste the numeric id from the end of a post
URL into `tweets`, newest first.

---

## Robin Arena (the game)

Everyone throws points into one pot. Your slice of the wheel is your share of
the pot. When the round closes the wheel spins and one entry takes everything.

Rounds are 90 seconds: 65 taking entries, then the spin and the result.

### Nobody deposits a token

The currency is **points**, and points come from a daily allowance you claim
for *holding* $ROBIN — checked server-side with `balanceOf`. So the stakes are
real and the losses are real, and there is still no custody, no pot of anyone's
money, and no private key anywhere near the server. A bigger bag buys a bigger
allowance, which is what the token does here.

| Rank | Holds | Points per day |
|---|---|---|
| Scout | 50,000 | 500 |
| Archer | 250,000 | 1,500 |
| Outlaw | 1,000,000 | 4,000 |
| Sheriff | 5,000,000 | 10,000 |

Minimum stake is 50 points, you can top up during a round, and season prizes in
real $ROBIN are yours to pay from a treasury wallet against the leaderboard.
Edit `TIERS`, `MIN_STAKE`, `ROUND_SEC` and `ENTRY_SEC` at the top of
`api/arena.php`.

### It is provably fair, and you can check it on the page

Each round's seed is generated and its **SHA-256 hash published before a single
entry is taken**. The winning ticket is `HMAC(seed, roundId)` modulo the pot.
Once the round is over the seed itself is published, so anyone can recompute
the result and confirm it was fixed before they played. The panel shows the
hash, the seed and the ticket for the last round.

The wheel lands on the published ticket, not on the middle of the winner's
slice — what you watch is the actual result being revealed.

A game that asks people to risk something and cannot show its working is just
asking them to trust us. `test/arena.test.sh` reimplements the check in Python
and asserts the server's answer matches.

### Three more decisions in the engine

**Rounds are clock slots, not records.** A round's id is `floor(time / 90)`, so
every visitor agrees on which round is live without anything having to create
it. No cron is needed: the first request after a round closes is what resolves
it, and because nothing here is time-sensitive to capture, a quiet hour costs
nothing — the round resolves correctly whenever someone next turns up.

**A round with one player is returned, not won.** Taking someone's stake and
handing it back as a "win" would be theatre.

**The schema is versioned.** `CREATE TABLE IF NOT EXISTS` keeps whatever is
already there, which is exactly wrong across a build that changed the columns:
the old tables survive, half the queries still work against them, and the game
misbehaves in ways nobody can explain. The database carries a version stamp and
is rebuilt when it does not match.

### What it needs from the server

PHP 7.4+ with **cURL** and **PDO SQLite**. In cPanel: **Select PHP Version** →
tick `pdo_sqlite`. The database is created on first use at
`api/data/arena.sqlite`; that folder ships with its own deny rule and the root
`.htaccess` blocks `*.sqlite` too. If `pdo_sqlite` is missing the arena says so
plainly rather than failing strangely.

### Where the AI is

One call per finished round, and only when someone asks for it: the page
requests Robin's reaction *after* the result is on screen, so the board never
waits on a model. He gets the player count, the pot and the winner's odds, and
writes one line about it. Everything else in the game is arithmetic.

Without an API key the arena runs exactly as it does with one; Robin just
stays quiet.

### The AI key

`api/provider.php` holds it server-side. Set `ROBIN_AI_KEY` in the environment,
or rename `api/config.example.php` to `api/config.php` and paste it in.
`api/config.php` is git-ignored — never commit it.

If you upload a new zip later, note that `config.php` ships in it and will be
overwritten. Put a rotated key in **`api/config.local.php`** instead: it takes
precedence and no future upload can revert it.

Check the setup at `https://shopping.io/robin/api/provider.php?selftest=1` — it
reports where the key was found (masked), which API root and auth header
answered, and which request shape your provider speaks. Add `&live=1` to spend
one real request and prove it end to end.

| What it says | What to do |
|---|---|
| `KEY not found` | Set `ROBIN_AI_KEY`, or fill in `api/config.php` |
| `no root answered` | Key is wrong, or your API root is none of the ones tried |
| `CONNECT tunnel failed` | Your host blocks outbound HTTPS — ask them to allow it |
| `The API key was rejected` | The key is wrong, inactive, or out of credit |

**It configures itself.** On the first request the proxy works out the API
root, auth header and request shape using cheap `GET`s only — `/models` to find
the root and auth, then a `GET` against each POST-only endpoint (`405` means it
is there, `404` means it is not) — so discovery never spends a paid request.
Both shapes are tried: `POST /responses` with `input`, and
`POST /chat/completions` with `messages`. A wrong guess comes back as a **400**
just as often as a 404, so a 400 moves the search on exactly like a missing
route does; a 5xx gets one quiet retry first. Set `ROBIN_AI_ROOTS` (comma
separated) to have discovery try your own root first, with no code change.

### There is also a scanner

`api/scan.php` still answers, and produces a risk report for any Robinhood
Chain token: verification, mint functions, owner powers, holder concentration,
liquidity depth, pair age. Every check is computed from chain data and the
model only writes the summary. Nothing on the page links to it — it is there if
you want to point something at it. `POST {"address":"0x…"}`.

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
| `arena.test.sh` | The jackpot engine on a controlled clock: allowances by tier, the daily limit, staking rules, resolution, points conservation, a one-player round returned — and an independent reimplementation of the fairness check |
| `arena-ui.test.js` | The arena in a browser against the real PHP — claiming, staking, the wheel matching the recorded entries, and over-staking refused by the server |
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
