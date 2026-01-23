/**
 * Simple static file server for Wingman dashboard
 * Now with API endpoints for signal database
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const signalLogger = require('./signal-logger');

const PORT = 8080;
const ROOT = path.join(__dirname, '..');

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-cache');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Strip query string from URL
    const urlPath = req.url.split('?')[0];

    // API: Save paper trades
    if (req.method === 'POST' && urlPath === '/api/save-paper-trades') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const filePath = path.join(ROOT, 'data', 'paper_trades.json');
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
                console.log('[Web Server] Saved paper_trades.json');
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // API: Get signals from database
    if (req.method === 'GET' && urlPath === '/api/signals') {
        try {
            const data = signalLogger.loadSignals();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (e) {
            console.error('[Web Server] Error loading signals:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // API: Get signal stats from database
    if (req.method === 'GET' && urlPath === '/api/signals/stats') {
        try {
            const stats = signalLogger.calculateStats();
            const detailed = signalLogger.getDetailedStats();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ stats, detailed }));
        } catch (e) {
            console.error('[Web Server] Error loading stats:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // API: Get pre-market data from database
    if (req.method === 'GET' && urlPath === '/api/premarket') {
        try {
            const signalDb = require('./signal-db');
            const rawData = signalDb.getLatestPremarketData();

            // Transform database format to dashboard format
            if (!rawData || !rawData.scan) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ movers: [], in_premarket: false }));
                return;
            }

            const scan = rawData.scan;
            const movers = rawData.movers || [];

            // Count tiers
            const highConviction = movers.filter(m => m.tier === 'HIGH_CONVICTION').length;
            const tradeable = movers.filter(m => m.tier === 'TRADEABLE').length;
            const watch = movers.filter(m => m.tier === 'WATCH').length;

            const data = {
                timestamp: scan.timestamp,
                scan_id: scan.id,
                in_premarket: !scan.market_open,
                market: {
                    spy: { price: scan.es_price, change_pct: scan.es_change_pct },
                    qqq: { price: scan.nq_price, change_pct: scan.nq_change_pct },
                    vix: scan.vix,
                    bias: scan.market_bias
                },
                summary: {
                    total_gaps: movers.length,
                    high_conviction: highConviction,
                    tradeable: tradeable,
                    watch: watch
                },
                movers: movers
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (e) {
            console.error('[Web Server] Error loading premarket:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // API: Get pre-market stats for today
    if (req.method === 'GET' && urlPath === '/api/premarket/today') {
        try {
            const signalDb = require('./signal-db');
            const stats = signalDb.getTodayPremarketStats();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(stats));
        } catch (e) {
            console.error('[Web Server] Error loading premarket stats:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // API: Morning Briefing - aggregates all scanner data
    if (req.method === 'GET' && urlPath === '/api/morning-briefing') {
        try {
            const dataDir = path.join(ROOT, 'data');

            // Load all data sources
            const loadJson = (file) => {
                try {
                    const content = fs.readFileSync(path.join(dataDir, file), 'utf8');
                    return JSON.parse(content);
                } catch (e) {
                    return null;
                }
            };

            const premarket = loadJson('premarket.json');
            const dynamicScan = loadJson('dynamic_scan.json');
            const opportunities = loadJson('opportunities.json');
            const earningsScan = loadJson('earnings-scan.json');

            // Extract market context
            const marketContext = {
                vix: dynamicScan?.marketContext?.vix || premarket?.market?.vix || null,
                vixRegime: dynamicScan?.marketContext?.vixRegime || 'unknown',
                spyPrice: dynamicScan?.marketContext?.spyPrice || premarket?.market?.spy?.price || null,
                spyTrend: dynamicScan?.marketContext?.spyTrend || 'unknown',
                qqq: premarket?.market?.qqq || null,
                spy: premarket?.market?.spy || null,
                bias: premarket?.market?.bias || dynamicScan?.marketContext?.intradayBias || 'unknown',
                riskAppetite: dynamicScan?.marketContext?.riskAppetite || 'unknown',
                inPremarket: premarket?.in_premarket || false
            };

            // Extract high conviction setups (score >= 56 AND tradeable)
            const highConviction = [];
            if (dynamicScan?.results) {
                for (const ticker of dynamicScan.results) {
                    const score = ticker.sourceInfo?.score || 0;
                    if (score >= 56 && (ticker.tradeable || ticker.sourceInfo?.tier === 'HIGH_CONVICTION')) {
                        highConviction.push({
                            symbol: ticker.symbol,
                            zone: ticker.zone,
                            price: ticker.price,
                            toWall: ticker.distances?.toPutWall || ticker.distances?.toCallWall || null,
                            rsi: ticker.technicals?.rsi || null,
                            trend: ticker.technicals?.trend || null,
                            score: score,
                            action: ticker.action,
                            signals: ticker.sourceInfo?.signals || [],
                            historyStatus: ticker.history_status?.label || 'NEW'
                        });
                    }
                }
                highConviction.sort((a, b) => b.score - a.score);
            }

            // Extract gaps (from premarket)
            const gaps = [];
            if (premarket?.movers) {
                for (const mover of premarket.movers) {
                    if (mover.tier !== 'FILTERED') {
                        gaps.push({
                            symbol: mover.symbol,
                            gapPct: mover.gap_pct,
                            volume: mover.premarket_volume || mover.pre_market_volume,
                            tier: mover.tier,
                            direction: mover.direction,
                            earnings: mover.earnings_date || null,
                            daysToEarnings: mover.days_to_earnings || null
                        });
                    }
                }
            }

            // Extract options flow (score >= 50)
            const optionsFlow = [];
            if (opportunities?.results) {
                for (const opp of opportunities.results) {
                    if (opp.score >= 50) {
                        optionsFlow.push({
                            symbol: opp.symbol,
                            score: opp.score,
                            tier: opp.tier,
                            ivRank: opp.technicals?.ivRank || null,
                            callPutRatio: opp.unusual?.callPutRatio || null,
                            netPremium: opp.unusual?.netPremium || null,
                            signals: opp.signals || [],
                            direction: opp.direction
                        });
                    }
                }
                optionsFlow.sort((a, b) => b.score - a.score);
            }

            // Extract upcoming earnings (next 10 days)
            const earnings = [];
            if (earningsScan?.results) {
                for (const item of earningsScan.results) {
                    // earnings-scan.json uses flat structure: earnings_date, days_to_earnings, earnings_time
                    if (item.earnings_date) {
                        const daysTo = item.days_to_earnings ?? Math.ceil((new Date(item.earnings_date) - new Date()) / (1000 * 60 * 60 * 24));
                        if (daysTo >= 0 && daysTo <= 10) {
                            earnings.push({
                                symbol: item.symbol,
                                date: item.earnings_date,
                                daysTo: daysTo,
                                time: item.earnings_time || 'unknown',
                                ivRank: item.details?.ivPercentile || null,
                                score: item.score || 0,
                                direction: item.direction,
                                signals: item.signals || [],
                                rsi: item.details?.rsi || null,
                                trend: item.details?.trend || null
                            });
                        }
                    }
                }
                earnings.sort((a, b) => a.daysTo - b.daysTo);
            }

            const briefing = {
                timestamp: new Date().toISOString(),
                marketContext,
                highConviction,
                gaps,
                optionsFlow,
                earnings,
                summary: {
                    highConvictionCount: highConviction.length,
                    gapsCount: gaps.length,
                    optionsFlowCount: optionsFlow.length,
                    earningsCount: earnings.length
                }
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(briefing));
        } catch (e) {
            console.error('[Web Server] Error building morning briefing:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    let filePath = path.join(ROOT, urlPath === '/' ? 'morning.html' : urlPath);

    // Security: prevent directory traversal
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Not Found');
            } else {
                res.writeHead(500);
                res.end('Server Error');
            }
            return;
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
});

server.listen(PORT, () => {
    console.log(`[Web Server] Running on http://localhost:${PORT}`);
    console.log(`[Web Server] Serving: ${ROOT}`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[Web Server] Port ${PORT} already in use`);
    } else {
        console.error(`[Web Server] Error:`, err.message);
    }
});
