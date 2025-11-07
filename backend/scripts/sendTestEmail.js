import dotenv from 'dotenv';
dotenv.config();

import { sendMail } from '../src/lib/mailer.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.split('=');
      const key = k.replace(/^--/, '');
      if (v !== undefined) args[key] = v;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[key] = argv[++i];
      else args[key] = 'true';
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const to = args.to || args.recipient;
  if (!to) {
    console.error('Usage: node backend/scripts/sendTestEmail.js --to you@example.com [--subject "..."] [--text "..."]');
    process.exit(2);
  }

  const subject = args.subject || 'PENDAX SMTP test';
  const text = args.text || 'This is a test email from the PENDAX backend SMTP configuration.';
  const html = args.html || `<p>This is a <strong>test email</strong> from the PENDAX backend SMTP configuration.</p>`;

  try {
    await sendMail({ to, subject, text, html });
    console.log(`Test email sent to ${to}`);
  } catch (err) {
    console.error('Failed to send test email:', err?.message || err);
    process.exit(1);
  }
}

main();

