// /api/alert.js — Vercel serverless function
import { Resend } from 'resend';

export default async function handler(req, res) {
  // only accept POSTs
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  // verify shared secret header
  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) return res.status(403).send('Forbidden');

  // parse JSON data
  let data = req.body;
  if (!data || typeof data !== 'object') {
    try { data = JSON.parse(req.body); } catch { return res.status(400).send('Bad JSON'); }
  }

  // build email content
  const subject = `Device Alert: ${data.event || 'unknown'}`;
  const html = `
    <h2>Device Alert</h2>
    <pre>${JSON.stringify(data, null, 2)}</pre>
    <p>Received at: ${new Date().toISOString()}</p>
  `;

  // send email via resend
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.MAIL_FROM,
      to: process.env.MAIL_TO,
      subject,
      html
    });
  } catch (err) {
    console.error('Email error:', err); // keep returning 200 so the device doesn’t retry forever
  }

  return res.status(200).json({ ok: true });
}