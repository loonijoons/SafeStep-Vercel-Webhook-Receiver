// /api/recent.js
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

  try {
    const raw = await kv.lrange('events', 0, 49);
    const items = raw.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
    return res.status(200).json({ ok: true, count: items.length, items });
  } catch (e) {
    console.error('KV read error:', e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}