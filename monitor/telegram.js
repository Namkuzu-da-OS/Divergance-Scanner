/**
 * Shared Telegram Module
 *
 * Single source of truth for sending Telegram messages.
 * Features:
 *   - Config guard (checks botToken/chatId before calling)
 *   - Retry with exponential backoff (3 attempts)
 *   - Honors Telegram 429 rate limit Retry-After header
 *   - Consistent HTML escaping
 *   - Returns { ok, messageId, error }
 *
 * Usage:
 *   const { sendTelegram, escapeHtml } = require('./telegram');
 *   const result = await sendTelegram('Hello <b>world</b>');
 *   // result: { ok: true, messageId: 12345 } or { ok: false, error: 'msg' }
 *
 *   // Override bot/chat for separate channels:
 *   await sendTelegram(msg, { botToken: '...', chatId: '...' });
 */

const config = require('./config-loader');

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Escape HTML special characters for Telegram HTML parse mode.
 */
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send a Telegram message with retry logic.
 *
 * @param {string} message - HTML-formatted message text
 * @param {object} [options] - Override defaults
 * @param {string} [options.botToken] - Override bot token (e.g. for earnings channel)
 * @param {string} [options.chatId] - Override chat ID
 * @param {string} [options.parseMode='HTML'] - Parse mode
 * @param {boolean} [options.disablePreview=true] - Disable web page preview
 * @returns {Promise<{ok: boolean, messageId?: number, error?: string}>}
 */
async function sendTelegram(message, options = {}) {
    const botToken = options.botToken || config.telegram.botToken;
    const chatId = options.chatId || config.telegram.chatId;
    const parseMode = options.parseMode || 'HTML';
    const disablePreview = options.disablePreview !== false;

    if (!botToken || !chatId || botToken.includes('YOUR_')) {
        console.log('[Telegram] Not configured, skipping alert');
        return { ok: false, error: 'not_configured' };
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const body = JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: parseMode,
        disable_web_page_preview: disablePreview
    });

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body
            });

            // Rate limited — honor Retry-After
            if (response.status === 429) {
                const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
                console.warn(`[Telegram] Rate limited, retry after ${retryAfter}s (attempt ${attempt}/${MAX_RETRIES})`);
                if (attempt < MAX_RETRIES) {
                    await sleep(retryAfter * 1000);
                    continue;
                }
                return { ok: false, error: `rate_limited after ${MAX_RETRIES} attempts` };
            }

            const result = await response.json();

            if (result.ok) {
                console.log('[Telegram] Sent alert');
                return { ok: true, messageId: result.result?.message_id };
            }

            // Non-retryable Telegram error (bad request, etc.)
            console.error(`[Telegram] Failed:`, result.description);
            return { ok: false, error: result.description };

        } catch (e) {
            console.error(`[Telegram] Error (attempt ${attempt}/${MAX_RETRIES}):`, e.message);
            if (attempt < MAX_RETRIES) {
                const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
                await sleep(delay);
                continue;
            }
            return { ok: false, error: e.message };
        }
    }

    return { ok: false, error: 'max_retries_exceeded' };
}

module.exports = { sendTelegram, escapeHtml };
