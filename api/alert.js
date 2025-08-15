export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) return res.status(403).send('Forbidden');

  const data = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');

  // IFTTT message
  const text = `EVENT: ${data.event}\nMSG: ${data.msg}\nTS: ${data.ts}`;

  // send to IFTTT Webhooks (value1/2/3 are optional)
  const url = `https://maker.ifttt.com/trigger/${process.env.IFTTT_EVENT}/json/with/key/${process.env.IFTTT_KEY}`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value1: text, value2: data.event, value3: JSON.stringify(data) })
  }).catch(() => { /* swallow errors; we still 200 so device won't storm */ });

  return res.status(200).json({ ok: true });
}