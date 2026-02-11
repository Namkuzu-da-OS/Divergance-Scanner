/**
 * Centralized Config Loader
 *
 * Single source of truth for API URLs and credentials.
 * Reads from config.json, with env var overrides for sensitive values.
 *
 * Usage:
 *   const config = require('./config-loader');
 *   config.apis.options   // => 'http://192.168.10.60:8000'
 *   config.telegram       // => { botToken, chatId }
 */

const fs = require('fs');
const path = require('path');

// Load .env file if it exists (no dotenv dependency needed)
const envPath = path.join(__dirname, '..', '.env');
try {
    const envFile = fs.readFileSync(envPath, 'utf8');
    for (const line of envFile.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val; // Don't override existing env vars
    }
} catch (e) {
    // No .env file, that's fine
}

let rawConfig;
try {
    rawConfig = require('./config.json');
} catch (e) {
    console.warn('[Config] config.json not found, using defaults/env vars');
    rawConfig = {};
}

module.exports = {
    apis: {
        intel: process.env.INTEL_API || rawConfig.apis?.intel || 'http://192.168.10.60:3000',
        options: process.env.OPTIONS_API || rawConfig.apis?.options || 'http://192.168.10.60:8000',
        divergence: process.env.DIVERGENCE_API || rawConfig.apis?.divergence || null
    },
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN || rawConfig.telegram?.botToken,
        chatId: process.env.TELEGRAM_CHAT_ID || rawConfig.telegram?.chatId
    },
    earnings_telegram: {
        botToken: process.env.EARNINGS_BOT_TOKEN || rawConfig.earnings_telegram?.botToken,
        chatId: process.env.EARNINGS_CHAT_ID || rawConfig.earnings_telegram?.chatId
    },
    ports: rawConfig.ports || {}
};
