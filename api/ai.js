/**
 * ai.js — the same image proxy as ai.php, for Node hosts (Vercel, Netlify).
 *
 * Set ROBIN_AI_KEY in the host's environment variables — never in code.
 * On plain PHP hosting use api/ai.php instead and delete this file. Point
 * ROBIN.ai.endpoint in assets/js/config.js at whichever one you keep.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Your provider's API root, no trailing slash, no endpoint path. If your docs
// show a different root, this is the only line you need to change.
const API_ROOT = 'https://api.concentrate.ai/api/v1';
const PATH_CHAT = '/chat/completions';
const MODEL = 'google/gemini-2.5-flash-image';
const MAX_PROMPT = 400;
const RATE_MAX = 8;
const RATE_WINDOW = 600_000;

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

let refCache;
async function referenceImage() {
  if (refCache !== undefined) return refCache;
  try {
    const p = path.join(process.cwd(), 'assets', 'img', 'robin-logo.png');
    refCache = 'data:image/png;base64,' + (await readFile(p)).toString('base64');
  } catch {
    refCache = null;
  }
  return refCache;
}

const styleFor = (prompt) =>
`You are illustrating official artwork for the $ROBIN (Robin Nakamoto) memecoin.

The attached image is the canonical character: a Shiba Inu wearing a bright green
Robin Hood hat with a white feather and thick black rectangular glasses.

Draw a NEW square image of this exact character in the scene the user describes.
Rules:
- Keep the character on-model: same shiba, same green feathered hat, same black glasses.
- Match the source style: bold clean outlines, flat cel shading, saturated colours,
  cartoon/vector look. No photorealism, no 3D render.
- Use the brand lime green (#A8DC2B) somewhere prominent, usually the background.
- Keep it readable as a small square thumbnail on social media.
- No text or lettering in the image unless the user explicitly asks for words.
- Nothing hateful, sexual, or depicting real people.

SCENE: ${prompt}`;

/** Providers differ slightly; accept the common response shapes. */
function extractImage(j) {
  const msg = j?.choices?.[0]?.message ?? {};
  if (msg.images?.[0]?.image_url?.url) return msg.images[0].image_url.url;
  if (msg.images?.[0]?.url) return msg.images[0].url;
  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part?.image_url?.url) return part.image_url.url;
      if (part?.type === 'output_image' && part.data) return 'data:image/png;base64,' + part.data;
    }
  }
  if (j?.data?.[0]?.b64_json) return 'data:image/png;base64,' + j.data[0].b64_json;
  if (j?.data?.[0]?.url) return j.data[0].url;
  return null;
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
  if (rateLimited(ip)) return json(429, { error: 'That is a lot of memes. Give it a couple of minutes.' });

  const key = process.env.ROBIN_AI_KEY || process.env.OPENROUTER_API_KEY;
  if (!key) return json(503, { error: 'The meme forge is not configured yet — set ROBIN_AI_KEY.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { return json(400, { error: 'Bad request body' }); }
  }

  const prompt = String(body.prompt ?? '').trim().slice(0, MAX_PROMPT);
  if (!prompt) return json(400, { error: 'Tell it what to draw first.' });

  const content = [{ type: 'text', text: styleFor(prompt) }];
  const ref = await referenceImage();
  if (ref) content.push({ type: 'image_url', image_url: { url: ref } });

  try {
    const r = await fetch(API_ROOT + PATH_CHAT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': `https://${req.headers.host || 'shopping.io'}`,
        'X-Title': 'ROBIN Meme Forge',
      },
      body: JSON.stringify({
        model: String(body.model || '') || MODEL,
        modalities: ['image', 'text'],
        messages: [{ role: 'user', content }],
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const j = await r.json();
    if (!r.ok) {
      console.error('[robin-forge]', r.status, j?.error?.message);
      if (r.status === 401 || r.status === 403) {
        return json(502, { error: 'The API key was rejected — check ROBIN_AI_KEY.' });
      }
      if (r.status === 429) {
        return json(429, { error: 'The image service is rate-limiting us. Try again shortly.' });
      }
      return json(502, { error: 'The image service is busy. Try again in a moment.' });
    }

    const image = extractImage(j);
    if (!image) {
      const said = typeof j?.choices?.[0]?.message?.content === 'string'
        ? j.choices[0].message.content.trim() : '';
      console.error('[robin-forge] no image; text was:', said.slice(0, 300));
      return json(502, {
        error: said
          ? 'That model replied with text instead of an image. Point ai.model at an image model.'
          : 'No image came back. Try a different scene.',
      });
    }

    return json(200, { image, model: j.model || MODEL });
  } catch (e) {
    console.error('[robin-forge]', e?.message);
    return json(502, { error: 'The image service could not be reached. Try again in a moment.' });
  }
}
