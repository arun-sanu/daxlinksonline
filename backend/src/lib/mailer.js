import nodemailer from 'nodemailer';

let transporter = null;

function resolveBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 0);
  const user = process.env.SMTP_USERNAME;
  const pass = process.env.SMTP_PASSWORD;

  if (!host || !port || !user || !pass) {
    throw new Error('SMTP credentials are not fully configured');
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: resolveBoolean(process.env.SMTP_SECURE, port === 465),
    auth: {
      user,
      pass
    }
  });

  return transporter;
}

export async function sendMail({ to, subject, html, text }) {
  const sender = process.env.EMAIL_FROM || 'no-reply@localhost';
  if (!to) {
    throw new Error('Missing recipient email address');
  }
  const mailTransporter = getTransporter();
  await mailTransporter.sendMail({
    from: sender,
    to,
    subject,
    html,
    text
  });
}
