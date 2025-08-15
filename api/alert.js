import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) return res.status(403).send('Forbidden');

  const data = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');

  const subject = `Device Alert: ${data.event || 'unknown'}`;
  const text = [
    `EVENT: ${data.event}`,
    `MSG: ${data.msg}`,
    `TS: ${data.ts}`
  ].join('\n');
  const html = `<pre>${text}</pre>`;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),           // 587
    secure: process.env.SMTP_SECURE === 'true',    // false for 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    requireTLS: true,
    logger: true,
    debug: true
  });

  try {
    await transporter.verify();
  } catch (e) {
    console.error('SMTP verify failed:', e);
    return res.status(500).json({ ok: false, step: 'verify', error: e?.message || String(e) });
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: process.env.MAIL_TO,
      subject,
      text,
      html
    });
    console.log('Email accepted:', info);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Email send error:', e);
    return res.status(500).json({ ok: false, step: 'send', error: e?.message || String(e) });
  }
}