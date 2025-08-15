// /api/alert.js
import nodemailer from 'nodemailer';
import { kv } from '@vercel/kv';

// extract only temp, humidity, steps, heartRate
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

function metricsTableHTML(m) {
  const rows = [];
  const add = (k, v) => v != null && v !== '' && rows.push(
    `<tr><td style="padding:6px 10px;border:1px solid #ddd;"><b>${k}</b></td><td style="padding:6px 10px;border:1px solid #ddd;">${v}</td></tr>`
  );

  const tempText = [
    m.tempC != null ? `${Number(m.tempC).toFixed(2)} °C` : null,
    m.tempF != null ? `${Number(m.tempF).toFixed(2)} °F` : null
  ].filter(Boolean).join(' / ');

  if (tempText) add('Temperature', tempText);
  if (m.humidity != null)  add('Humidity', `${Number(m.humidity).toFixed(2)} %`);
  if (m.steps != null)     add('Steps', `${m.steps}`);
  if (m.heartRate != null) add('Heart Rate', `${Number(m.heartRate).toFixed(1)} bpm`);

  if (!rows.length) return '';
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #ddd;margin:10px 0;">${rows.join('')}</table>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) return res.status(403).send('Forbidden');

  const data = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');

  const event = data.event || 'unknown';
  const receivedAt = Date.now();
  const metrics = parseMetrics(data);

  // keep last 50 for database
  const entry = {
    id: `${receivedAt}-${Math.random().toString(36).slice(2, 8)}`,
    event,
    msg: data.msg || '',
    ts: data.ts ?? null,
    receivedAt,
    metrics
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
    // continue; we still send email
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
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45;">
      <h2 style="margin:0 0 8px;">Device Alert: ${event}</h2>
      ${metricsTableHTML(metrics)}
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
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: process.env.MAIL_TO,
      subject, text, html
    });
  } catch (e) {
    console.error('Email error:', e);
  }

  return res.status(200).json({ ok: true, kvOk });
}