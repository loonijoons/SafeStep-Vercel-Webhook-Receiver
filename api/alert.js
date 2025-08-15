// /api/alert.js
import nodemailer from 'nodemailer';

// try to extract metrics. prefer structured fields if present; otherwise parse from msg text.
function parseMetrics(data) {
  const metrics = {
    tempC:     data.tempC ?? null,
    tempF:     data.tempF ?? null,
    humidity:  data.humidity ?? null,
    steps:     data.steps ?? null,
    heartRate: data.heartRate ?? data.bpm ?? null,
  };

  const msg = typeof data.msg === 'string' ? data.msg : '';

  // parse from the free-form msg if any metric is still missing
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
  const add = (label, value) => {
    if (value !== '' && value != null) {
      rows.push(
        `<tr>
           <td style="padding:6px 10px;border:1px solid #ddd;"><b>${label}</b></td>
           <td style="padding:6px 10px;border:1px solid #ddd;">${value}</td>
         </tr>`
      );
    }
  };

  const tempText = [
    m.tempC != null ? `${Number(m.tempC).toFixed(2)} °C` : null,
    m.tempF != null ? `${Number(m.tempF).toFixed(2)} °F` : null
  ].filter(Boolean).join(' / ');

  if (tempText) add('Temperature', tempText);
  if (m.humidity != null)  add('Humidity', `${Number(m.humidity).toFixed(2)} %`);
  if (m.steps != null)     add('Steps', `${m.steps}`);
  if (m.heartRate != null) add('Heart Rate', `${Number(m.heartRate).toFixed(1)} bpm`);

  if (!rows.length) return '';
  return `
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #ddd;margin:10px 0;">
      ${rows.join('\n')}
    </table>
  `;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) return res.status(403).send('Forbidden');

  const data = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');

  const event = data.event || 'unknown';
  const subject = `Device Alert: ${event}`;

  // include a text version
  const text = [
    `EVENT: ${event}`,
    `MSG: ${data.msg}`,
    `TS: ${data.ts}`,
    `Received: ${new Date().toISOString()}`
  ].join('\n');

  // build HTML with a vitals table
  const metrics = parseMetrics(data);
  const table = metricsTableHTML(metrics);
  const msgHtml = (data.msg || '').replace(/\n/g, '<br>');

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45;">
      <h2 style="margin:0 0 8px;">Device Alert: ${event}</h2>
      ${table || ''}
      <h3 style="margin:14px 0 6px;">Message</h3>
      <div style="white-space:normal;border:1px solid #eee;background:#fafafa;padding:10px;">${msgHtml}</div>
      <p style="color:#666;margin-top:12px;">TS (device): ${data.ts ?? 'n/a'}<br>Received: ${new Date().toISOString()}</p>
    </div>
  `;

  // gmail transporter
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER, // gmail address
      pass: process.env.SMTP_PASS  // 16-char app password
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