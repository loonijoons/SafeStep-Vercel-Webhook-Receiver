// /api/alert.js
import nodemailer from 'nodemailer';
import { kv } from '@vercel/kv';

// ---------- helpers ----------
function parseMetrics(data) {
  // Prefer structured fields if provided
  const metrics = {
    tempC:     data.tempC ?? null,
    tempF:     data.tempF ?? null,
    humidity:  data.humidity ?? null,
    steps:     data.steps ?? null,
    heartRate: data.heartRate ?? data.bpm ?? null
  };

  const msg = typeof data.msg === 'string' ? data.msg : '';

  // Temp: accept "Temp:" OR "Temperature:"
  if ((metrics.tempC == null || metrics.tempF == null) && msg) {
    const m = msg.match(/Temp(?:erature)?:\s*([\d.]+)\s*C\s*\/\s*([\d.]+)\s*F/i);
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

// Send compact phone-friendly line to Discord (free push)
async function sendDiscord(text) {
  const urlsRaw = process.env.DISCORD_WEBHOOK_URLS || process.env.DISCORD_WEBHOOK_URL || '';
  const urls = urlsRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (!urls.length) return;

  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text })
      });
      console.log('[Discord]', resp.status);
    } catch (e) {
      console.error('[Discord error]', e?.message || e);
    }
  }
}

// ---------- handler ----------
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) return res.status(403).send('Forbidden');

  const data = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');

  const event = data.event || 'unknown';
  const receivedAt = Date.now();
  const metrics = parseMetrics(data);

  // Build entry for homepage
  const entry = {
    id: `${receivedAt}-${Math.random().toString(36).slice(2, 8)}`,
    event,
    msg: data.msg || '',
    ts: data.ts ?? null,      // device ms (if provided)
    receivedAt,               // server ms
    metrics                   // temp/humidity/steps/heartRate only
  };

  // Persist to KV (keep last 50)
  let kvOk = false;
  try {
    await kv.lpush('events', JSON.stringify(entry));
    await kv.ltrim('events', 0, 49);
    kvOk = true;
    console.log('[KV] Stored entry', entry.id);
  } catch (e) {
    console.error('[KV] store error:', e);
  }

  // Email via Gmail (App Password)
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

    // 1) Full email to normal recipients
    const toEmail = (process.env.MAIL_TO || '').trim();
    if (toEmail) {
      const infoEmail = await transporter.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: toEmail,
        subject, text, html
      });
      console.log('[EMAIL] accepted:', infoEmail.accepted, 'rejected:', infoEmail.rejected);
    }

    // 2) Optional: short messages to any email→SMS addresses (some carriers may drop)
    const smsList = (process.env.SMS_TO || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (smsList.length) {
      // very compact, single line (gateways often truncate around 160 chars)
      const smsTextParts = [
        `ALERT: ${event}`,
        (metrics.tempC!=null||metrics.tempF!=null)
          ? `T:${Math.round(metrics.tempC ?? (metrics.tempF-32)*5/9)}C/${Math.round(metrics.tempF ?? (metrics.tempC*9/5+32))}F`
          : null,
        metrics.humidity!=null ? `H:${Math.round(metrics.humidity)}%` : null,
        metrics.steps!=null ? `S:${metrics.steps}` : null,
        metrics.heartRate!=null ? `HR:${Math.round(metrics.heartRate)}` : null
      ].filter(Boolean);
      const smsText = smsTextParts.join(' | ');

      for (const r of smsList) {
        try {
          const infoSms = await transporter.sendMail({
            from: process.env.MAIL_FROM || process.env.SMTP_USER,
            to: r,
            subject: `ALERT: ${event}`, // many gateways ignore subject
            text: smsText
          });
          console.log('[SMS] to', r, 'accepted:', infoSms.accepted, 'rejected:', infoSms.rejected);
        } catch (e) {
          console.error('[SMS] send error to', r, e?.message || e);
        }
      }
    }

    // 3) Free push to Discord
    const discordTextParts = [
      `ALERT: ${event}`,
      (metrics.tempC!=null||metrics.tempF!=null)
        ? `T:${Math.round(metrics.tempC ?? (metrics.tempF-32)*5/9)}C/${Math.round(metrics.tempF ?? (metrics.tempC*9/5+32))}F`
        : null,
      metrics.humidity!=null ? `H:${Math.round(metrics.humidity)}%` : null,
      metrics.steps!=null ? `S:${metrics.steps}` : null,
      metrics.heartRate!=null ? `HR:${Math.round(metrics.heartRate)}` : null
    ].filter(Boolean);
    const discordText = discordTextParts.join(' | ');
    await sendDiscord(discordText);

  } catch (e) {
    console.error('Email/Discord error:', e);
    // continue; we still return 200 so the device won't keep retrying aggressively
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, kvOk });
}
//