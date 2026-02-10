/**
 * Simple static file server for Wingman dashboard
 * Now with API endpoints for signal database
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const signalLogger = require('./signal-logger');
const config = require('./config-loader');

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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
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

    // API: Get option signal tracking stats
    if (req.method === 'GET' && urlPath === '/api/signals/options') {
        try {
            const signalDb = require('./signal-db');
            const url = new URL(req.url, `http://${req.headers.host}`);
            const days = parseInt(url.searchParams.get('days') || '30');
            const stats = signalDb.getOptionSignalStats(days);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(stats));
        } catch (e) {
            console.error('[Web Server] Error loading option stats:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // API: Get alerts from database (replaces alerts_log.json)
    if (req.method === 'GET' && urlPath === '/api/alerts') {
        try {
            const signalDb = require('./signal-db');
            const url = new URL(req.url, `http://${req.headers.host}`);
            const limit = url.searchParams.get('limit') || 50;
            const type = url.searchParams.get('type') || null;
            const days = url.searchParams.get('days') || 7;

            const alerts = signalDb.getAlertsForDashboard({
                limit: parseInt(limit),
                type: type,
                days: parseInt(days)
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ alerts }));
        } catch (e) {
            console.error('[Web Server] Error loading alerts:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // API: Get latest bloodhound scan (replaces dynamic_scan.json)
    if (req.method === 'GET' && urlPath === '/api/scan/latest') {
        try {
            const signalDb = require('./signal-db');
            const data = signalDb.getLatestBloodhoundScan();

            if (!data) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ results: [], marketContext: {} }));
                return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (e) {
            console.error('[Web Server] Error loading scan/latest:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // API: Get bloodhound scan summary (replaces scanner.json)
    if (req.method === 'GET' && urlPath === '/api/scan/summary') {
        try {
            const signalDb = require('./signal-db');
            const data = signalDb.getBloodhoundScanSummary();

            if (!data) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ vix: {}, spy: {}, qqq: {}, topOpportunities: [] }));
                return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (e) {
            console.error('[Web Server] Error loading scan/summary:', e.message);
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

            // Get session watchlist from database
            const sessionMovers = signalDb.getTodaySessionMovers();
            const today = new Date().toISOString().split('T')[0];

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
                    watch: watch,
                    session_total: sessionMovers.length
                },
                movers: movers,
                session: {
                    date: today,
                    symbols_discovered: sessionMovers.length,
                    watchlist: sessionMovers.map(m => ({
                        symbol: m.symbol,
                        first_seen: m.first_seen,
                        last_seen: m.last_seen,
                        scan_count: m.scan_count,
                        peak_gap_pct: m.peak_gap_pct,
                        current_gap_pct: m.gap_pct,
                        current_tier: m.tier,
                        current_score: m.score,
                        gap_type: m.gap_type,
                        premarket_volume: m.premarket_volume
                    }))
                }
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

    // API: Gap Analytics - fill rates and stats
    if (req.method === 'GET' && urlPath === '/api/gaps/analytics') {
        try {
            const signalDb = require('./signal-db');
            const url = new URL(req.url, `http://${req.headers.host}`);
            const days = url.searchParams.get('days');

            const stats = signalDb.getGapFillRates({
                days: days ? parseInt(days) : null
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(stats));
        } catch (e) {
            console.error('[Web Server] Error loading gap analytics:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // API: Gap ticker history
    if (req.method === 'GET' && urlPath.startsWith('/api/gaps/ticker/')) {
        try {
            const signalDb = require('./signal-db');
            const symbol = urlPath.split('/').pop().toUpperCase();
            const url = new URL(req.url, `http://${req.headers.host}`);
            const days = url.searchParams.get('days');

            const history = signalDb.getTickerGapHistory(symbol, {
                days: days ? parseInt(days) : null
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(history));
        } catch (e) {
            console.error('[Web Server] Error loading ticker gap history:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // API: Repeat offenders (frequent gappers)
    if (req.method === 'GET' && urlPath === '/api/gaps/repeat-offenders') {
        try {
            const signalDb = require('./signal-db');
            const url = new URL(req.url, `http://${req.headers.host}`);
            const days = url.searchParams.get('days') || 30;
            const minGaps = url.searchParams.get('min') || 2;

            const offenders = signalDb.getRepeatOffenders({
                days: parseInt(days),
                minGaps: parseInt(minGaps)
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(offenders));
        } catch (e) {
            console.error('[Web Server] Error loading repeat offenders:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // API: Today's gaps with historical context
    if (req.method === 'GET' && urlPath === '/api/gaps/today-with-history') {
        try {
            const signalDb = require('./signal-db');
            const gaps = signalDb.getTodayGapsWithHistory();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(gaps));
        } catch (e) {
            console.error('[Web Server] Error loading gaps with history:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // API: Session watchlist - persists after premarket.json clears
    // GET /api/gaps/session?date=2026-02-03 (optional date, defaults to today)
    if (req.method === 'GET' && urlPath === '/api/gaps/session') {
        try {
            const signalDb = require('./signal-db');
            const url = new URL(req.url, `http://${req.headers.host}`);
            const date = url.searchParams.get('date') || null;

            const watchlist = signalDb.getSessionWatchlist(date);
            const effectiveDate = date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                date: effectiveDate,
                count: watchlist.length,
                watchlist
            }));
        } catch (e) {
            console.error('[Web Server] Error loading session watchlist:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // API: Available session dates for lookback
    // GET /api/gaps/sessions?limit=30
    if (req.method === 'GET' && urlPath === '/api/gaps/sessions') {
        try {
            const signalDb = require('./signal-db');
            const url = new URL(req.url, `http://${req.headers.host}`);
            const limit = parseInt(url.searchParams.get('limit') || '30');

            const sessions = signalDb.getSessionDates(limit);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ sessions }));
        } catch (e) {
            console.error('[Web Server] Error loading session dates:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // Helper: derive VIX regime from raw value
    function deriveVixRegime(vix) {
        if (!vix) return 'unknown';
        if (vix > 40) return 'capitulation';
        if (vix > 30) return 'fear';
        if (vix > 20) return 'elevated';
        if (vix > 12) return 'normal';
        return 'complacent';
    }

    // Helper: check if currently in pre-market hours (6:00-9:30 AM ET)
    function isPremarketHours() {
        const now = new Date();
        const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const hour = et.getHours();
        const min = et.getMinutes();
        const totalMin = hour * 60 + min;
        return totalMin >= 360 && totalMin < 570; // 6:00 AM - 9:30 AM ET
    }

    // API: Get latest opportunity scan (replaces opportunities.json)
    if (req.method === 'GET' && urlPath === '/api/opportunities/latest') {
        try {
            const opportunityDb = require('./opportunity-db');
            const data = opportunityDb.getLatestOpportunityScan();

            if (!data) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ results: [], summary: {} }));
                return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (e) {
            console.error('[Web Server] Error loading opportunities:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // API: Morning Briefing - aggregates all scanner data
    if (req.method === 'GET' && urlPath === '/api/morning-briefing') {
        try {
            const signalDb = require('./signal-db');
            const opportunityDb = require('./opportunity-db');

            // Get premarket data from database
            const premarketRaw = signalDb.getLatestPremarketData();
            const premarketScan = premarketRaw?.scan || null;
            const premarketMovers = premarketRaw?.movers || [];
            // Get all scanner data from database
            const dynamicScan = signalDb.getLatestBloodhoundScan();
            const opportunities = opportunityDb.getLatestOpportunityScan();
            const earningsScan = signalDb.getLatestEarningsScan();

            // Extract market context (prefer bloodhound, fall back to premarket DB)
            const marketContext = {
                vix: dynamicScan?.marketContext?.vix || premarketScan?.vix || null,
                vixRegime: dynamicScan?.marketContext?.vixRegime || deriveVixRegime(dynamicScan?.marketContext?.vix || premarketScan?.vix),
                spyPrice: dynamicScan?.marketContext?.spyPrice || premarketScan?.es_price || null,
                spyTrend: dynamicScan?.marketContext?.spyTrend || 'unknown',
                qqq: premarketScan ? { price: premarketScan.nq_price, change_pct: premarketScan.nq_change_pct } : null,
                spy: premarketScan ? { price: premarketScan.es_price, change_pct: premarketScan.es_change_pct } : null,
                bias: premarketScan?.market_bias || dynamicScan?.marketContext?.intradayBias || 'unknown',
                riskAppetite: dynamicScan?.marketContext?.riskAppetite || 'unknown',
                inPremarket: isPremarketHours()
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

            // Extract gaps (from premarket database)
            const gaps = [];
            if (premarketMovers.length > 0) {
                // Build earnings lookup from earnings scan
                const earningsLookup = {};
                if (earningsScan?.results) {
                    for (const e of earningsScan.results) {
                        earningsLookup[e.symbol] = {
                            date: e.earnings_date,
                            daysTo: e.days_to_earnings
                        };
                    }
                }

                for (const mover of premarketMovers) {
                    if (mover.tier !== 'FILTERED') {
                        // Derive direction from gap_type (e.g., "HUGE_DOWN" → bearish)
                        const gapType = mover.gap_type || '';
                        const direction = gapType.includes('UP') ? 'bullish' : gapType.includes('DOWN') ? 'bearish' : null;

                        // Cross-reference earnings from earningsScan OR use catalyst from premarket
                        const earningsInfo = earningsLookup[mover.symbol];

                        // Check if catalyst indicates earnings today
                        let earningsDate = earningsInfo?.date || null;
                        let daysToEarnings = earningsInfo?.daysTo || null;

                        if (mover.catalyst && mover.catalyst.includes('earnings')) {
                            // Catalyst set by premarket scanner means earnings TODAY
                            earningsDate = new Date().toISOString().split('T')[0];
                            daysToEarnings = 0;
                        }

                        gaps.push({
                            symbol: mover.symbol,
                            price: mover.premarket_price,
                            gapPct: mover.gap_pct,
                            volume: mover.premarket_volume,
                            tier: mover.tier,
                            direction: direction,
                            earnings: earningsDate,
                            daysToEarnings: daysToEarnings,
                            catalyst: mover.catalyst
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
                    // Earnings DB uses flat structure: earnings_date, days_to_earnings, earnings_time
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

            // Extract earnings flow confluence (earnings + options flow intersection)
            const earningsFlow = [];
            if (earningsScan?.results && opportunities?.results) {
                // Build options flow lookup by symbol
                const flowLookup = {};
                for (const opp of opportunities.results) {
                    flowLookup[opp.symbol] = opp;
                }

                for (const item of earningsScan.results) {
                    const daysTo = item.days_to_earnings ?? 0;

                    // Only process PREM window (5-14 days)
                    if (daysTo < 5 || daysTo > 14) continue;

                    // Check if we have options flow data for this symbol
                    const flow = flowLookup[item.symbol];
                    if (!flow) continue;

                    // Calculate confluence score
                    let score = 0;
                    const signals = [];

                    // Timing score
                    if (daysTo >= 7 && daysTo <= 10) {
                        score += 20;
                        signals.push(`Optimal timing (${daysTo} days)`);
                    } else {
                        score += 10;
                        signals.push(`In PREM window (${daysTo} days)`);
                    }

                    // Call/Put ratio
                    const cpRatio = flow.unusual?.callPutRatio || 0;
                    if (cpRatio > 2.0) {
                        score += 25;
                        signals.push(`Heavy call flow (${cpRatio.toFixed(1)}x C/P)`);
                    } else if (cpRatio > 1.5) {
                        score += 15;
                        signals.push(`Elevated calls (${cpRatio.toFixed(1)}x C/P)`);
                    }

                    // Vol/OI ratio
                    const volOi = flow.unusual?.volOiRatio || 0;
                    if (volOi > 3) {
                        score += 25;
                        signals.push(`Major positioning (${volOi.toFixed(1)}x Vol/OI)`);
                    } else if (volOi > 2) {
                        score += 15;
                        signals.push(`Elevated volume (${volOi.toFixed(1)}x Vol/OI)`);
                    }

                    // Net premium
                    const netPremium = flow.unusual?.netPremium || 0;
                    if (netPremium > 1000000) {
                        score += 15;
                        signals.push(`Net call premium $${(netPremium/1000000).toFixed(1)}M`);
                    }

                    // RSI setup
                    const rsi = item.details?.rsi || 50;
                    if (rsi < 40) {
                        score += 15;
                        signals.push(`RSI ${rsi.toFixed(0)} (oversold bounce)`);
                    } else if (rsi <= 60) {
                        score += 10;
                        signals.push(`RSI ${rsi.toFixed(0)} (room to run)`);
                    }

                    // Determine tier
                    const tier = score >= 70 ? 'HIGH_CONVICTION' :
                                 score >= 50 ? 'TRADEABLE' : 'WATCH';

                    // Determine direction (based on flow)
                    const direction = cpRatio > 1.5 ? 'bullish' :
                                      cpRatio < 0.7 ? 'bearish' : 'neutral';

                    earningsFlow.push({
                        symbol: item.symbol,
                        daysTo: daysTo,
                        earningsDate: item.earnings_date,
                        earningsTime: item.earnings_time,
                        price: flow.price,
                        score: score,
                        tier: tier,
                        direction: direction,
                        rsi: rsi,
                        trend: item.details?.trend,
                        ivRank: item.details?.ivPercentile,
                        cpRatio: cpRatio,
                        volOiRatio: volOi,
                        netPremium: netPremium,
                        signals: signals
                    });
                }

                // Sort by score descending
                earningsFlow.sort((a, b) => b.score - a.score);
            }

            const briefing = {
                timestamp: new Date().toISOString(),
                marketContext,
                highConviction,
                gaps,
                optionsFlow,
                earnings,
                earningsFlow,
                summary: {
                    highConvictionCount: highConviction.length,
                    gapsCount: gaps.length,
                    optionsFlowCount: optionsFlow.length,
                    earningsCount: earnings.length,
                    earningsFlowCount: earningsFlow.filter(e => e.tier !== 'WATCH').length
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

    // API: Get open positions from database (replaces positions.json)
    if (req.method === 'GET' && urlPath === '/api/positions') {
        try {
            const signalDb = require('./signal-db');
            const data = signalDb.getOpenPositions();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (e) {
            console.error('[Web Server] Error loading positions:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // API: Add a new position
    if (req.method === 'POST' && urlPath === '/api/positions') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (!data.symbol || !data.entry_price) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'symbol and entry_price are required' }));
                    return;
                }
                const signalDb = require('./signal-db');
                const id = signalDb.addPosition(data);
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, id }));
                console.log(`[Web Server] Added position: ${data.symbol}`);
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // API: Close a position
    if (req.method === 'PATCH' && urlPath === '/api/positions/close') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (!data.id || !data.exit_price) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'id and exit_price are required' }));
                    return;
                }
                const signalDb = require('./signal-db');
                const result = signalDb.closePosition(data.id, data);
                if (!result) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Position not found' }));
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, ...result }));
                console.log(`[Web Server] Closed position #${data.id}`);
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Proxy: Forward requests to Options Analytics API
    // Usage: /proxy/analytics/api/options/AAPL → OPTIONS_API/api/options/AAPL
    if (urlPath.startsWith('/proxy/analytics/') || urlPath === '/proxy/analytics') {
        const targetPath = req.url.replace(/^\/proxy\/analytics/, '') || '/';
        const optionsUrl = new URL(config.apis.options);
        const proxyReq = http.request({
            hostname: optionsUrl.hostname,
            port: parseInt(optionsUrl.port) || 8000,
            path: targetPath,
            method: req.method,
            headers: {
                'Accept': 'application/json',
                'Content-Type': req.headers['content-type'] || 'application/json'
            },
            timeout: 30000
        }, (proxyRes) => {
            // Merge CORS headers with upstream response headers
            const headers = {
                ...proxyRes.headers,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Cache-Control': 'no-cache'
            };
            res.writeHead(proxyRes.statusCode, headers);
            proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
            console.error('[Web Server] Proxy error (analytics):', err.message);
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Upstream unavailable: ' + err.message }));
        });

        proxyReq.on('timeout', () => {
            proxyReq.destroy();
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Upstream timeout' }));
        });

        // Forward request body for POST/PUT
        if (req.method === 'POST' || req.method === 'PUT') {
            req.pipe(proxyReq);
        } else {
            proxyReq.end();
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

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Web Server] Running on http://0.0.0.0:${PORT} (accessible from network)`);
    console.log(`[Web Server] Serving: ${ROOT}`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[Web Server] Port ${PORT} already in use`);
    } else {
        console.error(`[Web Server] Error:`, err.message);
    }
});
