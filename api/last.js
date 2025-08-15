// /api/last.js
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
  res.setHeader('Cache-Control', 'no-store');
  const last = globalThis.__lastEvent || null;
  return res.status(200).json({ ok: true, last });
}
