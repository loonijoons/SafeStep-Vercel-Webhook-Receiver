import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) return res.status(403).send('Forbidden');

  const data = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  const subject = `Device Alert: ${data.event || 'unknown'}`;
  const text = [`EVENT: ${data.event}`, `MSG: ${data.msg}`, `TS: ${data.ts}`].join('\n');
  const html = `<pre>${text}</pre>`;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER, // your Gmail address
      pass: process.env.SMTP_PASS  // the 16-char app password
    }
  });

  try {
    await transporter.verify();
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: process.env.MAIL_TO,
      subject,
      text,
      html
    });
    console.log('Email accepted:', info);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Email error:', e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
