/**
 * ai.js — the same OpenRouter proxy as ai.php, for Node hosts.
 *
 * Works as-is on Vercel (`/api/ai`) and Netlify (with a redirect to functions).
 * Set OPENROUTER_API_KEY in the host's environment variables — never in code.
 *
 * If you are deploying to plain PHP hosting, use api/ai.php instead and you can
 * delete this file. Point ROBIN.ai.endpoint in assets/js/config.js at whichever
 * one you keep ('api/ai.php' or 'api/ai').
 */

const MODEL_DEFAULT = 'anthropic/claude-sonnet-4.5';
const MAX_INPUT = 1200;
const MAX_TURNS = 12;
const RATE_MAX = 25;
const RATE_WINDOW = 300_000;

const TOKEN_NAME = 'Robin Nakamoto ($ROBIN)';
const TOKEN_ADDR = '0x280413fbF06CcC1114094A5967dB2191d49EE75e';
const CHAIN_ID = 4663;
const CHAIN_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const DS_CHAIN = 'robinhood';
const DS_POOL = '0x7d8a56584434d8355b891da0ff62d9168669f87dd9c8ad77f6c8fb0a6b6eb7d7';

// Best-effort in-memory limiter. Serverless instances are recycled, so treat
// this as friction against casual abuse, not a hard guarantee.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => t > now - RATE_WINDOW);
  if (list.length >= RATE_MAX) return true;
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

const clean = (s) => String(s ?? '').trim().slice(0, MAX_INPUT);

let mktCache = { at: 0, data: null };
async function marketContext() {
  if (Date.now() - mktCache.at < 30_000 && mktCache.data) return mktCache.data;
  let out = 'Live market data is unavailable right now.';
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${DS_CHAIN}/${DS_POOL}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    const p = j.pairs?.[0] || j.pair;
    if (p) {
      out = [
        'LIVE MARKET DATA (updated seconds ago):',
        `- Price: $${p.priceUsd ?? 'unknown'}`,
        `- 24h change: ${p.priceChange?.h24 ?? 'unknown'}%`,
        `- Market cap: $${p.marketCap ?? p.fdv ?? 'unknown'}`,
        `- 24h volume: $${p.volume?.h24 ?? 'unknown'}`,
        `- Liquidity: $${p.liquidity?.usd ?? 'unknown'}`,
        `- 24h buys/sells: ${p.txns?.h24?.buys ?? '?'} / ${p.txns?.h24?.sells ?? '?'}`,
      ].join('\n');
    }
  } catch { /* keep the fallback line */ }
  mktCache = { at: Date.now(), data: out };
  return out;
}

async function systemPrompt(mode) {
  const facts =
`You are Robin — the assistant on the official ${TOKEN_NAME} website.

FACTS YOU KNOW:
- ${TOKEN_NAME} is a memecoin native to Robinhood Chain (EVM chain ID ${CHAIN_ID}, gas paid in ETH).
- Contract address: ${TOKEN_ADDR}. This is the only correct address.
- RPC: ${CHAIN_RPC}
- It launched on the Pons launchpad, graduated off the bonding curve, and now trades in a
  permanently locked Uniswap V4 pool governed by the Pons shared hook.
- Fixed supply of 1,000,000,000. No mint function, no team unlocks.
- 30% of supply was gifted to Billy Markus (Shibetoshi Nakamoto), co-creator of Dogecoin.
- The site is built by the Shopping.io team.
- To buy: bridge ETH to Robinhood Chain, connect a wallet, swap on this page or any
  Uniswap front-end on chain ${CHAIN_ID}.

${await marketContext()}

RULES:
- Never give financial advice, price predictions or targets. If asked whether to buy or where
  price is going, say plainly that you won't predict prices, and explain what the data shows.
- Be honest when the numbers look weak. Never hype past what the data supports.
- Remind people this is a memecoin that can go to zero when the topic is risk or buying.
- Never ask for seed phrases, private keys or wallet approvals. You cannot transact.
- If you don't know something, say so.
`;

  if (mode === 'alpha') {
    return facts + `
TASK: Write a short market report on $ROBIN from the live data above.
Cover: what the price action and volume actually show, how liquidity looks relative to market
cap, and the buy/sell balance. 130-180 words. Confident and readable, not hype. Say clearly if
the data shows a quiet or weak market. End with one line reminding the reader this is not
financial advice. Use short paragraphs, no headings.`;
  }
  if (mode === 'meme') {
    return facts + `
TASK: Write exactly 3 posts for X promoting $ROBIN, based on the angle the user gives. Each
under 240 characters, each a different flavour (funny, punchy, community). Use $ROBIN and at
most 2 hashtags. No price predictions, no "guaranteed" or "to the moon" financial claims.
Separate the three posts with a line containing only ---
Output nothing but the posts and the separators.`;
  }
  return facts + `
TASK: Answer the user's question about $ROBIN, Robinhood Chain, or how to trade it. Be brief and
concrete — usually under 110 words. Plain language. You may use **bold** and simple bullet lists.`;
}

export default async function handler(req, res) {
  const json = (code, obj) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(JSON.stringify(obj));
  };

  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
             req.socket?.remoteAddress || '0.0.0.0';
  if (rateLimited(ip)) return json(429, { error: 'Slow down a moment — too many requests.' });

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return json(503, { error: 'Robin AI is not configured yet — set OPENROUTER_API_KEY.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') {
    // Some runtimes don't pre-parse; read the stream ourselves.
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { return json(400, { error: 'Bad request body' }); }
  }

  const mode = String(body.mode || 'chat');
  if (!['chat', 'alpha', 'meme'].includes(mode)) return json(400, { error: 'Unknown mode' });

  let messages = [];
  if (mode === 'chat') {
    messages = (Array.isArray(body.messages) ? body.messages : [])
      .slice(-MAX_TURNS)
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: clean(m.content),
      }))
      .filter((m) => m.content);
    if (!messages.length) return json(400, { error: 'Nothing to answer' });
  } else {
    messages = [{ role: 'user', content: clean(body.prompt) || 'Go.' }];
  }

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': `https://${req.headers.host || 'shopping.io'}`,
        'X-Title': 'ROBIN Nakamoto',
      },
      body: JSON.stringify({
        model: String(body.model || '') || MODEL_DEFAULT,
        messages: [{ role: 'system', content: await systemPrompt(mode) }, ...messages],
        max_tokens: mode === 'chat' ? 500 : 700,
        temperature: mode === 'meme' ? 0.95 : 0.6,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    const j = await r.json();
    if (!r.ok) {
      console.error('[robin-ai] OpenRouter', r.status, j?.error?.message);
      return json(502, {
        error: r.status === 401
          ? 'Robin AI key was rejected — check OPENROUTER_API_KEY.'
          : 'Robin AI is busy right now. Try again in a moment.',
      });
    }

    const text = j.choices?.[0]?.message?.content || '';
    if (!text) return json(502, { error: 'Empty response from the model' });
    return json(200, { text, model: j.model || MODEL_DEFAULT });
  } catch (e) {
    console.error('[robin-ai]', e?.message);
    return json(502, { error: 'Robin AI could not be reached. Try again in a moment.' });
  }
}
