// /api/alert.js
import nodemailer from 'nodemailer';
import { kv } from '@vercel/kv';

// keep only temp/humidity/steps/heartRate
function parseMetrics(data) {
  const metrics = {
    tempC:     data.tempC ?? null,
    tempF:     data.tempF ?? null,
    humidity:  data.humidity ?? null,
    steps:     data.steps ?? null,
    heartRate: data.heartRate ?? data.bpm ?? null
  };
  const msg = typeof data.msg === 'string' ? data.msg : '';

  if ((metrics.tempC == null || metrics.tempF == null) && msg) {
    const m = msg.match(/Temp:\s*([\d.]+)\s*C\s*\/\s*([\d.]+)\s*F/i);
    if (m) { metrics.tempC = parseFloat(m[1]); metrics.tempF = parseFloat(m[2]); }
  }
  if (metrics.humidity == null && msg) {
    const m = msg.match(/Humidity:\s*([\d.]+)/i);
    if (m) metrics.humidity = parseFloat(m[1]);
  }
  if (metrics.steps == null && msg) {
    const m = msg.match(/Steps:\s*(\d+)/i);
    if (m) metrics.steps = parseInt(m[1], 10);
  }
  if (metrics.heartRate == null && msg) {
    const m = msg.match(/Heart\s*Rate:\s*([\d.]+)/i);
    if (m) metrics.heartRate = parseFloat(m[1]);
  }
  return metrics;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) return res.status(403).send('Forbidden');

  const data = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');

  const event = data.event || 'unknown';
  const receivedAt = Date.now();
  const metrics = parseMetrics(data);

  const entry = {
    id: `${receivedAt}-${Math.random().toString(36).slice(2,8)}`,
    event,
    msg: data.msg || '',
    ts: data.ts ?? null,    // device millis
    receivedAt,             // server millis
    metrics                 // temp/humidity/steps/heartRate
  };

  // keep last 50 entries
  let kvOk = false;
  try {
    await kv.lpush('events', JSON.stringify(entry));
    await kv.ltrim('events', 0, 49);
    kvOk = true;
    console.log('[KV] Stored entry', entry.id);
  } catch (e) {
    console.error('[KV] store error:', e);
  }

  // email
  const subject = `Device Alert: ${event}`;
  const text = [
    `EVENT: ${event}`,
    `MSG: ${data.msg}`,
    `TS: ${data.ts}`,
    `Received: ${new Date(receivedAt).toISOString()}`
  ].join('\n');

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45;color:#111;">
      <h2 style="margin:0 0 8px;">Device Alert: ${event}</h2>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #ddd;margin:10px 0;">
        ${metrics.tempC!=null||metrics.tempF!=null ? `<tr><td style="padding:6px 10px;border:1px solid #ddd;"><b>Temperature</b></td><td style="padding:6px 10px;border:1px solid #ddd;">${[metrics.tempC!=null?metrics.tempC.toFixed(2)+' °C':null, metrics.tempF!=null?metrics.tempF.toFixed(2)+' °F':null].filter(Boolean).join(' / ')}</td></tr>`:''}
        ${metrics.humidity!=null ? `<tr><td style="padding:6px 10px;border:1px solid #ddd;"><b>Humidity</b></td><td style="padding:6px 10px;border:1px solid #ddd;">${metrics.humidity.toFixed(2)} %</td></tr>`:''}
        ${metrics.steps!=null ? `<tr><td style="padding:6px 10px;border:1px solid #ddd;"><b>Steps</b></td><td style="padding:6px 10px;border:1px solid #ddd;">${metrics.steps}</td></tr>`:''}
        ${metrics.heartRate!=null ? `<tr><td style="padding:6px 10px;border:1px solid #ddd;"><b>Heart Rate</b></td><td style="padding:6px 10px;border:1px solid #ddd;">${metrics.heartRate.toFixed(1)} bpm</td></tr>`:''}
      </table>
      <h3 style="margin:14px 0 6px;">Message</h3>
      <div style="white-space:normal;border:1px solid #eee;background:#fafafa;padding:10px;">${(data.msg || '').replace(/\n/g, '<br>')}</div>
      <p style="color:#666;margin-top:12px;">TS (device): ${data.ts ?? 'n/a'}<br>Received: ${new Date(receivedAt).toISOString()}</p>
    </div>
  `;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  try {
    await transporter.verify();
    const toEmail = (process.env.MAIL_TO || '').trim();   // e.g. family_member@gmail.com
    const toSms   = (process.env.SMS_TO  || '').trim();   // e.g. 1234567890@txt.att.net
    const toCombined = [toEmail, toSms].filter(Boolean).join(',');

    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: toCombined,
      subject,
      text,
      html
  });
  } catch (e) {
    console.error('Email error:', e);
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, kvOk });
}