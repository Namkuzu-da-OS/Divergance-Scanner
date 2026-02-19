#!/usr/bin/env node
/**
 * API GATEWAY — Central HTTP Proxy for All Upstream API Calls
 *
 * All 6 scanners route through this gateway instead of hitting upstream
 * APIs directly. Provides:
 *   - Per-upstream concurrency limiting (prevents rate limit walls)
 *   - Circuit breakers (stop hammering dead services)
 *   - Request queuing (smooth out burst traffic)
 *   - Single point of monitoring
 *
 * Route mapping:
 *   /schwab/*      → http://192.168.10.60:8000/*   (Options API, max 250 concurrent)
 *   /divergence/*  → http://192.168.10.61:32212/*   (Divergence Scanner, max 5)
 *   /intel/*       → http://192.168.10.60:3000/*    (Intel API, max 20)
 *
 * Port: 8086
 *
 * Usage:
 *   node api-gateway.js
 *   pm2 start ecosystem.config.js   (starts as 'gateway')
 *   curl localhost:8086/status       (monitoring)
 */

const http = require('http');

const CONFIG = require('./config-loader');

const PORT = 8086;

// ============================================
// UPSTREAM DEFINITIONS
// ============================================

const UPSTREAMS = {
    schwab: {
        name: 'schwab',
        target: CONFIG.apis.options || 'http://192.168.10.60:8000',
        maxConcurrent: 250,     // 300 hard wall, leave 50 headroom
        maxQueue: 100,
        queueTimeoutMs: 30000,  // 30s max wait in queue
        // Circuit breaker
        failureThreshold: 5,    // failures in window to trip
        failureWindowMs: 60000, // 60s window
        cooldownMs: 30000,      // 30s before HALF_OPEN
    },
    divergence: {
        name: 'divergence',
        target: CONFIG.apis.divergence || 'http://192.168.10.61:32212',
        maxConcurrent: 5,       // Small box, keep it gentle
        maxQueue: 20,
        queueTimeoutMs: 15000,
        // Circuit breaker — more aggressive for flaky service
        failureThreshold: 3,
        failureWindowMs: 60000,
        cooldownMs: 60000,      // 60s cooldown (it needs time to recover)
    },
    intel: {
        name: 'intel',
        target: CONFIG.apis.intel || 'http://192.168.10.60:3000',
        maxConcurrent: 20,
        maxQueue: 50,
        queueTimeoutMs: 30000,
        failureThreshold: 5,
        failureWindowMs: 60000,
        cooldownMs: 30000,
    }
};

// ============================================
// PER-UPSTREAM RUNTIME STATE
// ============================================

function createUpstreamState(config) {
    return {
        config,
        inFlight: 0,
        queue: [],              // Array of { resolve, reject, timer }
        // Circuit breaker
        circuit: 'CLOSED',      // CLOSED | OPEN | HALF_OPEN
        failures: [],           // Timestamps of recent failures
        circuitOpenedAt: 0,
        // Stats
        totalRequests: 0,
        totalFailures: 0,
        totalCircuitBreaks: 0,
        totalQueued: 0,
        totalQueueTimeouts: 0,
        startedAt: Date.now(),
    };
}

const state = {};
for (const [key, config] of Object.entries(UPSTREAMS)) {
    state[key] = createUpstreamState(config);
}

// ============================================
// CIRCUIT BREAKER
// ============================================

function recordFailure(upstream) {
    const s = state[upstream];
    const now = Date.now();
    s.failures.push(now);
    s.totalFailures++;

    // Prune old failures outside window
    const windowStart = now - s.config.failureWindowMs;
    s.failures = s.failures.filter(t => t > windowStart);

    if (s.circuit === 'CLOSED' && s.failures.length >= s.config.failureThreshold) {
        s.circuit = 'OPEN';
        s.circuitOpenedAt = now;
        s.totalCircuitBreaks++;
        console.log(`[Gateway] ⚡ Circuit OPEN for ${upstream} — ${s.failures.length} failures in ${s.config.failureWindowMs / 1000}s`);
    } else if (s.circuit === 'HALF_OPEN') {
        // Probe failed, re-open
        s.circuit = 'OPEN';
        s.circuitOpenedAt = now;
        console.log(`[Gateway] ⚡ Circuit re-OPEN for ${upstream} — probe failed`);
    }
}

function recordSuccess(upstream) {
    const s = state[upstream];
    if (s.circuit === 'HALF_OPEN') {
        s.circuit = 'CLOSED';
        s.failures = [];
        console.log(`[Gateway] ✅ Circuit CLOSED for ${upstream} — probe succeeded`);
    }
}

function checkCircuit(upstream) {
    const s = state[upstream];
    if (s.circuit === 'CLOSED') return 'CLOSED';

    if (s.circuit === 'OPEN') {
        const elapsed = Date.now() - s.circuitOpenedAt;
        if (elapsed >= s.config.cooldownMs) {
            s.circuit = 'HALF_OPEN';
            console.log(`[Gateway] 🔄 Circuit HALF_OPEN for ${upstream} — testing probe`);
            return 'HALF_OPEN';
        }
        return 'OPEN';
    }

    return s.circuit; // HALF_OPEN
}

// ============================================
// CONCURRENCY + QUEUE
// ============================================

/**
 * Acquire a slot to make a request to an upstream.
 * Resolves immediately if under limit, queues otherwise.
 * Rejects if queue is full or queue wait times out.
 */
function acquireSlot(upstream) {
    const s = state[upstream];

    if (s.inFlight < s.config.maxConcurrent) {
        s.inFlight++;
        return Promise.resolve();
    }

    // At capacity — queue the request
    if (s.queue.length >= s.config.maxQueue) {
        return Promise.reject(new Error('queue_full'));
    }

    s.totalQueued++;

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            // Remove from queue on timeout
            const idx = s.queue.findIndex(item => item.timer === timer);
            if (idx !== -1) s.queue.splice(idx, 1);
            s.totalQueueTimeouts++;
            reject(new Error('queue_timeout'));
        }, s.config.queueTimeoutMs);

        s.queue.push({ resolve, reject, timer });
    });
}

function releaseSlot(upstream) {
    const s = state[upstream];
    s.inFlight--;

    // Dequeue next waiting request
    if (s.queue.length > 0) {
        const next = s.queue.shift();
        clearTimeout(next.timer);
        s.inFlight++;
        next.resolve();
    }
}

// ============================================
// PROXY REQUEST
// ============================================

/**
 * Forward a request to the upstream, return the response.
 * Pure Node.js http — no dependencies.
 */
function proxyRequest(upstreamName, targetUrl, method, headers, body) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(targetUrl);

        const opts = {
            hostname: parsed.hostname,
            port: parsed.port || 80,
            path: parsed.pathname + parsed.search,
            method: method,
            headers: { ...headers },
            timeout: 30000,
        };

        // Don't forward hop-by-hop headers
        delete opts.headers['host'];
        delete opts.headers['connection'];
        delete opts.headers['transfer-encoding'];

        const req = http.request(opts, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks),
                });
            });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('upstream_timeout'));
        });

        if (body && body.length > 0) {
            req.write(body);
        }
        req.end();
    });
}

// ============================================
// ROUTE RESOLUTION
// ============================================

/**
 * Given a request path like /schwab/api/technicals/SPY,
 * return { upstream: 'schwab', targetUrl: 'http://192.168.10.60:8000/api/technicals/SPY' }
 * or null if no route matches.
 */
function resolveRoute(reqPath) {
    for (const [key, s] of Object.entries(state)) {
        const prefix = `/${key}/`;
        if (reqPath.startsWith(prefix)) {
            const remainder = reqPath.slice(prefix.length - 1); // Keep the leading /
            return {
                upstream: key,
                targetUrl: s.config.target + remainder,
            };
        }
    }
    return null;
}

// ============================================
// STATUS ENDPOINT
// ============================================

function getStatus() {
    const upstreamStatus = {};
    for (const [key, s] of Object.entries(state)) {
        const circuitState = checkCircuit(key);
        upstreamStatus[key] = {
            target: s.config.target,
            circuit: circuitState,
            inFlight: s.inFlight,
            maxConcurrent: s.config.maxConcurrent,
            queueDepth: s.queue.length,
            maxQueue: s.config.maxQueue,
            recentFailures: s.failures.length,
            totalRequests: s.totalRequests,
            totalFailures: s.totalFailures,
            totalCircuitBreaks: s.totalCircuitBreaks,
            totalQueued: s.totalQueued,
            totalQueueTimeouts: s.totalQueueTimeouts,
        };
        if (circuitState === 'OPEN') {
            const remaining = s.config.cooldownMs - (Date.now() - s.circuitOpenedAt);
            upstreamStatus[key].retryAfterMs = Math.max(0, remaining);
        }
    }

    return {
        gateway: 'api-gateway',
        port: PORT,
        uptime: Math.floor((Date.now() - state.schwab.startedAt) / 1000),
        upstreams: upstreamStatus,
    };
}

// ============================================
// HTTP SERVER
// ============================================

const server = http.createServer(async (req, res) => {
    // Status endpoint
    if (req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getStatus(), null, 2));
        return;
    }

    // Health check
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
    }

    // Route resolution
    const route = resolveRoute(req.url);
    if (!route) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no_route', path: req.url }));
        return;
    }

    const { upstream, targetUrl } = route;
    const s = state[upstream];
    s.totalRequests++;

    // Circuit breaker check
    const circuitState = checkCircuit(upstream);
    if (circuitState === 'OPEN') {
        const remaining = s.config.cooldownMs - (Date.now() - s.circuitOpenedAt);
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: 'circuit_open',
            upstream: upstream,
            retry_after_ms: Math.max(0, remaining),
        }));
        return;
    }

    // HALF_OPEN: only let 1 request through (the probe)
    if (circuitState === 'HALF_OPEN' && s.inFlight > 0) {
        // Already have a probe in flight, reject others
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: 'circuit_half_open',
            upstream: upstream,
            message: 'probe in progress',
        }));
        return;
    }

    // Read request body (for POST/PUT/PATCH)
    const bodyChunks = [];
    req.on('data', chunk => bodyChunks.push(chunk));
    req.on('end', async () => {
        const body = Buffer.concat(bodyChunks);

        // Acquire concurrency slot (may queue)
        try {
            await acquireSlot(upstream);
        } catch (err) {
            if (err.message === 'queue_full') {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'queue_full',
                    upstream: upstream,
                    queueDepth: s.queue.length,
                    maxQueue: s.config.maxQueue,
                }));
            } else if (err.message === 'queue_timeout') {
                res.writeHead(504, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'queue_timeout',
                    upstream: upstream,
                    waited_ms: s.config.queueTimeoutMs,
                }));
            } else {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'internal', message: err.message }));
            }
            return;
        }

        // Proxy the request
        try {
            const result = await proxyRequest(upstream, targetUrl, req.method, req.headers, body);

            // Forward upstream response transparently
            const fwdHeaders = { ...result.headers };
            delete fwdHeaders['transfer-encoding']; // We send content-length
            fwdHeaders['content-length'] = result.body.length;

            res.writeHead(result.statusCode, fwdHeaders);
            res.end(result.body);

            // Track success/failure for circuit breaker
            if (result.statusCode >= 500) {
                recordFailure(upstream);
            } else {
                recordSuccess(upstream);
            }
        } catch (err) {
            recordFailure(upstream);

            // Determine error type
            if (err.message === 'upstream_timeout') {
                res.writeHead(504, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'upstream_timeout',
                    upstream: upstream,
                    target: targetUrl,
                }));
            } else {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'upstream_error',
                    upstream: upstream,
                    message: err.message,
                }));
            }
        } finally {
            releaseSlot(upstream);
        }
    });
});

// ============================================
// STARTUP
// ============================================

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Gateway] API Gateway listening on port ${PORT}`);
    console.log('[Gateway] Route table:');
    for (const [key, s] of Object.entries(state)) {
        console.log(`  /${key}/* → ${s.config.target}/* (max ${s.config.maxConcurrent} concurrent, circuit: ${s.config.failureThreshold} failures/${s.config.failureWindowMs / 1000}s)`);
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('[Gateway] Shutting down...');
    server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
    console.log('[Gateway] Shutting down...');
    server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
    console.error('[Gateway] Uncaught exception:', err.message);
    process.exit(1);
});
