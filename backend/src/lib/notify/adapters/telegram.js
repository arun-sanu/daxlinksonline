/**
 * Telegram adapter
 * Minimal wrapper around Telegram sendMessage API using MarkdownV2 escaping.
 * No secrets are logged. Requires `TELEGRAM_BOT_TOKEN` env.
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

function escapeMd(s = "") {
  return String(s).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

/**
 * Sends a Telegram message using MarkdownV2 formatting.
 * @param {string} chatId
 * @param {string} title
 * @param {string} message
 * @returns {Promise<{ok: boolean, id?: string, error?: string, skipped?: boolean, reason?: string}>}
 */
export async function sendTelegram(chatId, title, message = "") {
  if (!TOKEN || !chatId) return { ok: false, skipped: true, reason: "missing-token-or-chat" };
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: `*${escapeMd(title)}*\n\n${message}`,
    parse_mode: "MarkdownV2",
    disable_web_page_preview: true,
    reply_markup: { remove_keyboard: true }
  };
  const res = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { ok: false, error: `Telegram ${res.status}: ${txt.slice(0, 200)}` };
  }
  const json = await res.json();
  return { ok: true, id: json?.result?.message_id };
}

export { escapeMd };

