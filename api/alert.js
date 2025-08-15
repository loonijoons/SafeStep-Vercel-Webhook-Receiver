// /api/alert.js
import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  // verify the shared secret from the ESP32
  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) return res.status(403).send('Forbidden');

  // parse JSON
  const data = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');

  // build email
  const subject = `Device Alert: ${data.event || 'unknown'}`;
  const text = [
    `EVENT: ${data.event}`,
    `MSG: ${data.msg}`,
    `TS: ${data.ts}`
  ].join('\n');

  // render html table
  const html = `<pre>${text}</pre>`;

  // create SMTP transport
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: process.env.MAIL_TO,
      subject,
      text,
      html
    });
  } catch (err) {
    console.error('Email send error:', err);
  }

  return res.status(200).json({ ok: true });
}