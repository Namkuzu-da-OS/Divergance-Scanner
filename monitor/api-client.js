/**
 * API CLIENT — Shared HTTP Module for All Scanners
 *
 * Drop-in replacement for the 3 different fetch patterns across scanners.
 * Routes all upstream API calls through the API Gateway (port 8086) for
 * concurrency limiting and circuit breaking.
 *
 * Falls back to direct API calls if the gateway is unreachable.
 *
 * Usage:
 *   const { fetchJSON } = require('./api-client');
 *   const data = await fetchJSON('http://192.168.10.60:8000/api/technicals/SPY');
 *   // → Routes through localhost:8086/schwab/api/technicals/SPY
 *   // → Returns parsed JSON or null on error
 */

const http = require('http');
const https = require('https');
const CONFIG = require('./config-loader');

const GATEWAY_HOST = 'localhost';
const GATEWAY_PORT = 8086;

// Build the URL rewrite map from config
// Maps upstream host:port → gateway path prefix
const REWRITE_MAP = buildRewriteMap();

function buildRewriteMap() {
    const map = [];

    const options = CONFIG.apis.options;
    if (options) {
        map.push({ match: normalizeOrigin(options), prefix: '/schwab' });
    }

    const divergence = CONFIG.apis.divergence;
    if (divergence) {
        map.push({ match: normalizeOrigin(divergence), prefix: '/divergence' });
    }

    const intel = CONFIG.apis.intel;
    if (intel) {
        map.push({ match: normalizeOrigin(intel), prefix: '/intel' });
    }

    return map;
}

/**
 * Normalize a URL to its origin (protocol + host + port).
 * e.g. 'http://192.168.10.60:8000' → 'http://192.168.10.60:8000'
 */
function normalizeOrigin(urlStr) {
    try {
        const u = new URL(urlStr);
        return u.origin;
    } catch {
        return urlStr;
    }
}

/**
 * Rewrite an upstream URL to a gateway URL.
 * Returns null if the URL doesn't match any known upstream.
 *
 * Example:
 *   'http://192.168.10.60:8000/api/technicals/SPY'
 *   → 'http://localhost:8086/schwab/api/technicals/SPY'
 */
function rewriteUrl(url) {
    let origin;
    let pathAndQuery;
    try {
        const u = new URL(url);
        origin = u.origin;
        pathAndQuery = u.pathname + u.search;
    } catch {
        return null;
    }

    for (const rule of REWRITE_MAP) {
        if (origin === rule.match) {
            return `http://${GATEWAY_HOST}:${GATEWAY_PORT}${rule.prefix}${pathAndQuery}`;
        }
    }

    return null; // Unknown upstream — don't rewrite
}

/**
 * Make an HTTP GET request and parse JSON response.
 * Pure Node.js http/https — no dependencies.
 *
 * @param {string} url - The URL to fetch
 * @param {number} timeout - Request timeout in ms (default 15000)
 * @returns {Promise<any>} Parsed JSON or null on error
 */
function httpGetJSON(url, timeout) {
    return new Promise((resolve, reject) => {
        const isHttps = url.startsWith('https');
        const mod = isHttps ? https : http;

        const req = mod.get(url, { timeout }, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                // Consume response body to free socket
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }

            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                try {
                    const body = Buffer.concat(chunks).toString();
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error(`JSON parse error: ${e.message}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

/**
 * Fetch JSON from a URL, routing through the API Gateway.
 * Falls back to direct call if gateway is unreachable.
 *
 * Returns parsed JSON or null on any error — same contract as
 * the existing per-scanner fetchJSON/httpGet functions.
 *
 * @param {string} url - The original upstream URL
 * @param {number} [timeout=15000] - Request timeout in ms
 * @returns {Promise<any>} Parsed JSON or null
 */
async function fetchJSON(url, timeout = 15000) {
    const gatewayUrl = rewriteUrl(url);

    // Try gateway first (if URL maps to a known upstream)
    if (gatewayUrl) {
        try {
            return await httpGetJSON(gatewayUrl, timeout);
        } catch (err) {
            // Gateway unreachable — fall back to direct
            if (err.code === 'ECONNREFUSED') {
                // Silent fallback — gateway might be down/restarting
                try {
                    return await httpGetJSON(url, timeout);
                } catch {
                    return null;
                }
            }
            // Gateway returned an error (circuit open, queue full, upstream error)
            // Fall back to direct call as a last resort
            if (err.message && err.message.startsWith('HTTP 5')) {
                try {
                    return await httpGetJSON(url, timeout);
                } catch {
                    return null;
                }
            }
            return null;
        }
    }

    // URL doesn't match any known upstream — call directly
    try {
        return await httpGetJSON(url, timeout);
    } catch {
        return null;
    }
}

module.exports = { fetchJSON, rewriteUrl };
