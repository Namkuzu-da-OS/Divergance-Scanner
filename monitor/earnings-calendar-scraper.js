/**
 * Earnings Calendar Fetcher
 *
 * Fetches earnings dates from our existing Options API (/api/calendar/{symbol})
 * and builds earnings-calendar.json for the scanner.
 *
 * Usage:
 *   node earnings-calendar-scraper.js              # Fetch for all watchlist + major stocks
 *   node earnings-calendar-scraper.js --symbol AAPL  # Single symbol lookup
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Config
const config = require('./config.json');
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'earnings-calendar.json');
const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist.json');

const OPTIONS_API = config.apis.options || 'http://192.168.10.239:8000';

// Major stocks to always check (beyond watchlist)
const MAJOR_STOCKS = [
    // Mega caps
    'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B',
    // Financials
    'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C',
    // Tech
    'AMD', 'INTC', 'CRM', 'ORCL', 'ADBE', 'NFLX', 'PYPL', 'SQ',
    // Healthcare
    'JNJ', 'UNH', 'PFE', 'MRK', 'ABBV', 'LLY',
    // Consumer
    'WMT', 'HD', 'MCD', 'NKE', 'SBUX', 'KO', 'PEP', 'DIS',
    // Industrial
    'BA', 'CAT', 'GE', 'UPS', 'FDX',
    // Energy
    'XOM', 'CVX', 'COP',
    // ETFs
    'SPY', 'QQQ', 'IWM'
];

/**
 * Fetch earnings data for a single symbol
 */
async function fetchEarningsForSymbol(symbol) {
    try {
        const response = await axios.get(`${OPTIONS_API}/api/calendar/${symbol}`, {
            timeout: 10000
        });

        if (response.data && response.data.has_earnings) {
            return {
                symbol: response.data.symbol,
                earnings_date: response.data.next_earnings,
                days_to_earnings: response.data.days_to_earnings,
                earnings_time: response.data.earnings_time || 'unknown',
                warning_level: response.data.warning_level || 'none',
            };
        }
        return null;
    } catch (error) {
        // Don't spam errors for missing data
        if (error.response?.status !== 404) {
            console.error(`  Error fetching ${symbol}:`, error.message);
        }
        return null;
    }
}

/**
 * Load watchlist symbols
 */
function loadWatchlist() {
    try {
        const data = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'));
        return data.symbols
            .filter(s => s.enabled !== false)
            .map(s => s.symbol);
    } catch (error) {
        console.error('Error reading watchlist:', error.message);
        return [];
    }
}

/**
 * Helper sleep function
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Enrich earnings data with trading context
 */
function enrichEarningsData(earnings) {
    return earnings.map(item => {
        const days = item.days_to_earnings;

        return {
            ...item,
            // Trading windows
            prem_window: days >= 5 && days <= 10,           // Pre-earnings momentum window
            pead_window: days >= -5 && days <= -1,          // Post-earnings drift window (negative = already reported)
            blackout_warning: days <= 14 && days > 0,       // Buyback blackout likely
            imminent: days <= 2 && days >= 0,               // Don't open new positions

            // Status classification
            status: days < -5 ? 'old' :
                    days < 0 ? 'pead_window' :
                    days === 0 ? 'today' :
                    days <= 2 ? 'imminent' :
                    days <= 5 ? 'this_week' :
                    days <= 10 ? 'prem_window' :
                    days <= 14 ? 'upcoming' : 'far_out'
        };
    });
}

/**
 * Main execution
 */
async function main() {
    const args = process.argv.slice(2);
    const symbolArg = args.indexOf('--symbol');

    let earnings = [];

    if (symbolArg !== -1 && args[symbolArg + 1]) {
        // Single symbol lookup
        const symbol = args[symbolArg + 1].toUpperCase();
        console.log(`Looking up earnings for ${symbol}...`);
        const data = await fetchEarningsForSymbol(symbol);
        if (data) {
            console.log(JSON.stringify(data, null, 2));
            earnings = [data];
        } else {
            console.log('No earnings data found');
        }
    } else {
        // Fetch for all symbols
        const watchlist = loadWatchlist();
        const allSymbols = [...new Set([...watchlist, ...MAJOR_STOCKS])];

        console.log(`\nFetching earnings for ${allSymbols.length} symbols...\n`);

        let count = 0;
        for (const symbol of allSymbols) {
            const data = await fetchEarningsForSymbol(symbol);
            if (data) {
                earnings.push(data);
                count++;
                // Show progress every 10 symbols
                if (count % 10 === 0) {
                    process.stdout.write(`  Fetched ${count} symbols with earnings...\r`);
                }
            }
            await sleep(1000); // 1 second delay - be gentle to Yahoo Finance backend
        }
        console.log(`\n  Found ${earnings.length} symbols with earnings data`);
    }

    // Enrich with trading context
    const enriched = enrichEarningsData(earnings);

    // Sort by days to earnings (closest first)
    enriched.sort((a, b) => a.days_to_earnings - b.days_to_earnings);

    // Build output
    const output = {
        last_updated: new Date().toISOString(),
        total_count: enriched.length,
        summary: {
            prem_candidates: enriched.filter(e => e.prem_window).length,
            pead_candidates: enriched.filter(e => e.pead_window).length,
            reporting_today: enriched.filter(e => e.status === 'today').length,
            imminent: enriched.filter(e => e.imminent).length,
            this_week: enriched.filter(e => e.status === 'this_week').length,
        },
        earnings: enriched
    };

    // Load existing data and MERGE (don't lose data from timeouts)
    let existingData = { earnings: [] };
    try {
        if (fs.existsSync(OUTPUT_FILE)) {
            existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
        }
    } catch (e) {
        console.log('  No existing calendar data to merge');
    }

    // Merge: keep existing symbols that we didn't fetch successfully this time
    const newSymbols = new Set(enriched.map(e => e.symbol));
    const keptFromExisting = (existingData.earnings || []).filter(e => !newSymbols.has(e.symbol));

    // Combine and re-enrich (to update days_to_earnings)
    const merged = [...enriched, ...keptFromExisting];
    const mergedEnriched = enrichEarningsData(merged);
    mergedEnriched.sort((a, b) => a.days_to_earnings - b.days_to_earnings);

    // Update output with merged data
    output.total_count = mergedEnriched.length;
    output.summary = {
        prem_candidates: mergedEnriched.filter(e => e.prem_window).length,
        pead_candidates: mergedEnriched.filter(e => e.pead_window).length,
        reporting_today: mergedEnriched.filter(e => e.status === 'today').length,
        imminent: mergedEnriched.filter(e => e.imminent).length,
        this_week: mergedEnriched.filter(e => e.status === 'this_week').length,
    };
    output.earnings = mergedEnriched;

    // Save merged data
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    if (keptFromExisting.length > 0) {
        console.log(`\n✅ Saved ${mergedEnriched.length} earnings (${enriched.length} fresh + ${keptFromExisting.length} kept from cache)`);
    } else {
        console.log(`\n✅ Saved ${mergedEnriched.length} earnings to ${OUTPUT_FILE}`);
    }

    // Summary output
    console.log('\n' + '='.repeat(60));
    console.log('EARNINGS CALENDAR SUMMARY');
    console.log('='.repeat(60));

    const premCandidates = enriched.filter(e => e.prem_window);
    if (premCandidates.length > 0) {
        console.log(`\n📈 PREM WINDOW (5-10 days out) - ${premCandidates.length} candidates:`);
        for (const e of premCandidates.slice(0, 15)) {
            console.log(`   ${e.symbol.padEnd(6)} ${e.earnings_date} (${e.days_to_earnings} days) ${e.earnings_time}`);
        }
        if (premCandidates.length > 15) {
            console.log(`   ... and ${premCandidates.length - 15} more`);
        }
    }

    const thisWeek = enriched.filter(e => e.status === 'this_week');
    if (thisWeek.length > 0) {
        console.log(`\n📅 THIS WEEK (1-5 days out) - ${thisWeek.length} stocks:`);
        for (const e of thisWeek.slice(0, 10)) {
            console.log(`   ${e.symbol.padEnd(6)} ${e.earnings_date} (${e.days_to_earnings} days) ${e.earnings_time}`);
        }
    }

    const imminent = enriched.filter(e => e.imminent);
    if (imminent.length > 0) {
        console.log(`\n⚠️  IMMINENT (0-2 days) - Avoid new positions:`);
        for (const e of imminent) {
            console.log(`   ${e.symbol.padEnd(6)} ${e.earnings_date} (${e.days_to_earnings} days) ${e.earnings_time}`);
        }
    }

    const today = enriched.filter(e => e.status === 'today');
    if (today.length > 0) {
        console.log(`\n🔴 REPORTING TODAY:`);
        for (const e of today) {
            console.log(`   ${e.symbol.padEnd(6)} ${e.earnings_time}`);
        }
    }

    console.log('\n' + '='.repeat(60));

    return output;
}

// Export for use as module
module.exports = {
    fetchEarningsForSymbol,
    loadWatchlist,
    enrichEarningsData,
    main,
    MAJOR_STOCKS
};

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}
