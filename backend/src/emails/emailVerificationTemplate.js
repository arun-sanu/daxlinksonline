const FALLBACK_TIME_REMAINING = '15 minutes';

function escapeHtml(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderEmailVerificationTemplate({
  userName,
  userEmail,
  accountCreatedAt,
  timeRemaining = FALLBACK_TIME_REMAINING,
  verificationLink,
  isExpired = false
}) {
  const safeName = escapeHtml(userName || 'Operator');
  const safeEmail = escapeHtml(userEmail || '');
  const safeCreatedAt = escapeHtml(accountCreatedAt || '');
  const safeTimeRemaining = escapeHtml(timeRemaining || FALLBACK_TIME_REMAINING);
  const safeLink = escapeHtml(verificationLink || '#');
  const isExpiredClass = isExpired ? 'text-[#EF4444]' : 'text-[#6B6BF7]';
  const statusText = isExpired ? 'Link expired - Request new verification' : safeLink;
  const previewText = `Hi ${safeName}, verify your email for daxlinks.online`;

  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
    <title>Email Verification</title>
  </head>
  <body class="bg-[#0D0E13] py-[40px]" style="margin:0;padding:40px 0;background-color:#0D0E13;font-family:Inter,Helvetica,Arial,sans-serif;">
    <span style="display:none !important;font-size:1px;color:#0D0E13;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${previewText}</span>
    <div class="mx-auto px-[20px] max-w-[1000px]" style="margin:0 auto;max-width:1000px;padding:0 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;">
        <tr>
          <td>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#1A1B23;border:1px solid #2A2B35;border-radius:12px;padding:48px;position:relative;overflow:hidden;width:100%;">
              <tr>
                <td style="position:absolute;top:0;right:0;width:400px;height:400px;background:radial-gradient(circle at top right, rgba(107,107,247,0.12), transparent);opacity:0.3;border-radius:50%;"></td>
                <td style="position:absolute;bottom:0;left:0;width:300px;height:300px;background:radial-gradient(circle at bottom left, rgba(167,139,250,0.12), transparent);opacity:0.3;border-radius:50%;"></td>
              </tr>
              <tr>
                <td style="position:relative;z-index:10;padding-right:48px;width:360px;vertical-align:top;">
                  <div style="text-align:center;">
                    <div style="display:inline-block;margin-bottom:32px;">
                      <div style="width:100px;height:100px;background:linear-gradient(135deg,#6B6BF7,#A78BFA);border-radius:20px;display:flex;align-items:center;justify-content:center;margin:0 auto;">
                        <span style="color:#ffffff;font-size:32px;font-weight:300;letter-spacing:1px;font-family:Inter,Helvetica,Arial,sans-serif;">DX</span>
                      </div>
                    </div>
                    <p style="color:#6B6BF7;font-size:16px;font-weight:500;margin:0 0 40px 0;letter-spacing:1.5px;font-family:Inter,Helvetica,Arial,sans-serif;">daxlinks.online</p>
                  </div>
                </td>
                <td style="position:relative;z-index:10;vertical-align:top;">
                  <div style="text-align:right;margin-bottom:24px;">
                    <p style="color:#9CA3AF;font-size:13px;margin:0 0 4px 0;font-weight:300;font-family:Inter,Helvetica,Arial,sans-serif;">⏱️ Time Remaining</p>
                    <p style="color:#6B6BF7;font-size:18px;font-weight:600;margin:0;font-family:'JetBrains Mono',Consolas,monospace;">
                      ${isExpired ? '<span style="color:#EF4444;">EXPIRED</span>' : safeTimeRemaining}
                    </p>
                    <p style="color:#9CA3AF;font-size:11px;margin:0;font-weight:300;font-family:Inter,Helvetica,Arial,sans-serif;">
                      ${isExpired ? 'Request a new verification link' : 'to verify your account'}
                    </p>
                  </div>
                  <div style="margin-bottom:32px;">
                    <h1 style="color:#E6E6E6;font-size:36px;font-weight:300;margin:0 0 12px 0;line-height:42px;letter-spacing:-0.5px;font-family:Inter,Helvetica,Arial,sans-serif;">
                      Hi ${safeName}, Verify Your Email
                    </h1>
                    <p style="color:#6B6BF7;font-size:16px;margin:0 0 16px 0;font-weight:400;font-family:Inter,Helvetica,Arial,sans-serif;">
                      Almost there! Just one more step.
                    </p>
                    <div style="background-color:#252631;border:1px solid #2A2B35;border-radius:8px;padding:16px;">
                      <p style="color:#9CA3AF;font-size:13px;margin:0 0 4px 0;font-weight:300;font-family:Inter,Helvetica,Arial,sans-serif;">
                        Confirming email address:
                      </p>
                      <p style="color:#E6E6E6;font-size:14px;margin:0;font-weight:500;font-family:'JetBrains Mono',Consolas,monospace;">
                        ${safeEmail}
                      </p>
                    </div>
                  </div>
                  <div style="margin-bottom:24px;">
                    <div style="background-color:#1F2937;border:1px solid #374151;border-radius:8px;padding:16px;">
                      <p style="color:#9CA3AF;font-size:13px;margin:0 0 4px 0;font-weight:300;font-family:Inter,Helvetica,Arial,sans-serif;">
                        Account created on:
                      </p>
                      <p style="color:#E6E6E6;font-size:14px;margin:0;font-weight:500;font-family:Inter,Helvetica,Arial,sans-serif;">
                        ${safeCreatedAt}
                      </p>
                    </div>
                  </div>
                  <div style="margin-bottom:36px;">
                    <p style="color:#B4B4B4;font-size:16px;line-height:26px;margin:0 0 20px 0;font-weight:300;font-family:Inter,Helvetica,Arial,sans-serif;">
                      Complete your account setup by verifying your email address and unlock all premium features including advanced analytics, custom domains, and priority support.
                    </p>
                  </div>
                  <div style="margin-bottom:32px;text-align:left;">
                    ${
                      isExpired
                        ? `<a href="#" style="display:inline-block;text-decoration:none;color:#9CA3AF;font-size:16px;font-weight:500;padding:16px 40px;border-radius:10px;background-color:#374151;opacity:0.6;letter-spacing:0.5px;font-family:Inter,Helvetica,Arial,sans-serif;pointer-events:none;">🔒 Verification Expired</a>`
                        : `<a href="${safeLink}" style="display:inline-block;text-decoration:none;color:#ffffff;font-size:16px;font-weight:500;padding:16px 40px;border-radius:10px;background:linear-gradient(-45deg,#6B6BF7,#A78BFA,#8B5CF6,#7C3AED);box-shadow:0 6px 24px rgba(107,107,247,0.4),0 0 40px rgba(167,139,250,0.2);letter-spacing:0.5px;font-family:Inter,Helvetica,Arial,sans-serif;">Verify Email Address →</a>`
                    }
                  </div>
                  <div style="margin-bottom:32px;text-align:right;">
                    <p style="color:#9CA3AF;font-size:14px;margin:0;font-weight:300;cursor:pointer;display:inline-block;font-family:Inter,Helvetica,Arial,sans-serif;">
                      Having trouble? <span style="color:#6B6BF7;font-size:18px;margin-left:8px;">↓</span>
                    </p>
                  </div>
                  <div style="margin-bottom:32px;">
                    <div style="background-color:#252631;border:1px solid #2A2B35;border-radius:12px;padding:20px;">
                      <p style="color:#9CA3AF;font-size:14px;margin:0 0 12px 0;font-weight:300;font-family:Inter,Helvetica,Arial,sans-serif;">
                        If having trouble with the button, copy and paste this link:
                      </p>
                      <p style="font-size:12px;margin:0;word-break:break-all;line-height:20px;font-weight:400;font-family:'JetBrains Mono',Consolas,monospace;color:${isExpired ? '#EF4444' : '#6B6BF7'};">
                        ${statusText}
                      </p>
                    </div>
                  </div>
                  <div style="margin-top:32px;">
                    <div style="background-color:#1F2937;border:1px solid #374151;border-radius:12px;padding:20px;">
                      <p style="color:#E6E6E6;font-size:14px;font-weight:500;margin:0 0 16px 0;font-family:Inter,Helvetica,Arial,sans-serif;">
                        🛡️ Security & Trust
                      </p>
                      <div style="margin-bottom:16px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;">
                          <tr>
                            <td style="width:50%;padding-right:8px;">
                              <div style="background:linear-gradient(90deg,#10B981,#059669);border:1px solid #10B981;border-radius:8px;padding:12px;">
                                <p style="color:#ffffff;font-size:12px;font-weight:500;margin:0;text-align:center;font-family:Inter,Helvetica,Arial,sans-serif;">
                                  🔒 SSL Secured
                                </p>
                              </div>
                            </td>
                            <td style="width:50%;padding-left:8px;">
                              <div style="background:linear-gradient(90deg,#3B82F6,#1D4ED8);border:1px solid #3B82F6;border-radius:8px;padding:12px;">
                                <p style="color:#ffffff;font-size:12px;font-weight:500;margin:0;text-align:center;font-family:Inter,Helvetica,Arial,sans-serif;">
                                  ✓ Trusted Platform
                                </p>
                              </div>
                            </td>
                          </tr>
                        </table>
                      </div>
                      <p style="color:#9CA3AF;font-size:13px;margin:0;font-weight:300;line-height:20px;font-family:Inter,Helvetica,Arial,sans-serif;">
                        • End-to-end encrypted verification process<br />
                        • GDPR compliant data handling<br />
                        • No spam, unsubscribe anytime<br />
                        • Trusted by 10,000+ users worldwide
                      </p>
                    </div>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="text-align:center;padding-top:40px;">
            <p style="color:#9CA3AF;font-size:13px;margin:0 0 10px 0;font-weight:300;font-family:Inter,Helvetica,Arial,sans-serif;">
              © 2024 daxlinks.online • Created by AO Web Labs &amp; Shakti Analytics
            </p>
            <p style="color:#9CA3AF;font-size:12px;margin:0 0 10px 0;font-weight:300;font-family:Inter,Helvetica,Arial,sans-serif;">
              ⚡ Powered by Pendax • Better-Auth • Cloudflare
            </p>
            <p style="color:#6B6BF7;font-size:13px;margin:0;font-weight:400;font-family:Inter,Helvetica,Arial,sans-serif;">
              <a href="https://daxlinks.online/unsubscribe" style="color:#6B6BF7;text-decoration:none;">Unsubscribe</a> |
              <a href="https://daxlinks.online/privacy" style="color:#6B6BF7;text-decoration:none;margin-left:6px;">Privacy Policy</a>
            </p>
          </td>
        </tr>
      </table>
    </div>
  </body>
</html>`;
}
