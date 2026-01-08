#!/usr/bin/env node
/**
 * Scanner Validator
 *
 * This script validates that ALL tickers from dynamic_scan.json are accounted for.
 * Run after any scanner review to verify nothing was missed.
 *
 * Usage: node scanner-validator.js [list of tickers I claimed to see]
 * Example: node scanner-validator.js SPY QQQ NVDA TSLA GOOGL
 *
 * Or run with no args to just show what's in the scan:
 * node scanner-validator.js
 */

const fs = require('fs');
const path = require('path');

const DYNAMIC_SCAN_PATH = path.join(__dirname, '..', 'data', 'dynamic_scan.json');

function loadScan() {
    try {
        const data = fs.readFileSync(DYNAMIC_SCAN_PATH, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('ERROR: Could not read dynamic_scan.json:', err.message);
        process.exit(1);
    }
}

function validateTickers(claimedTickers) {
    const scan = loadScan();
    const actualTickers = scan.results.map(r => r.symbol);
    const actualCount = actualTickers.length;

    console.log('\n========================================');
    console.log('SCANNER VALIDATION REPORT');
    console.log('========================================');
    console.log(`Scan timestamp: ${scan.timestamp}`);
    console.log(`Total tickers in scan: ${actualCount}`);
    console.log('----------------------------------------');

    // Show all tickers in scan
    console.log('\nALL TICKERS IN SCAN:');
    actualTickers.forEach((ticker, i) => {
        const result = scan.results[i];
        console.log(`  ${(i+1).toString().padStart(2)}. ${ticker.padEnd(6)} | ${result.zone.padEnd(12)} | Score: ${result.sourceInfo?.score ?? 'N/A'}`);
    });

    if (claimedTickers.length === 0) {
        console.log('\n----------------------------------------');
        console.log('No claimed tickers provided. Run with ticker list to validate.');
        console.log('Example: node scanner-validator.js SPY QQQ NVDA TSLA');
        return;
    }

    // Normalize claimed tickers
    const claimed = claimedTickers.map(t => t.toUpperCase().trim());
    const actual = new Set(actualTickers);

    // Find missed tickers
    const missed = actualTickers.filter(t => !claimed.includes(t));

    // Find extra tickers (claimed but not in scan)
    const extra = claimed.filter(t => !actual.has(t));

    console.log('\n----------------------------------------');
    console.log('VALIDATION RESULTS:');
    console.log('----------------------------------------');
    console.log(`Tickers in scan:     ${actualCount}`);
    console.log(`Tickers claimed:     ${claimed.length}`);

    if (missed.length === 0 && extra.length === 0 && claimed.length === actualCount) {
        console.log('\n✅ PASS: All tickers accounted for correctly!');
    } else {
        console.log('\n❌ FAIL: Discrepancies found!');

        if (missed.length > 0) {
            console.log(`\n🚨 MISSED TICKERS (${missed.length}):`);
            missed.forEach(t => console.log(`   - ${t}`));
        }

        if (extra.length > 0) {
            console.log(`\n⚠️  EXTRA TICKERS (${extra.length}) - claimed but not in scan:`);
            extra.forEach(t => console.log(`   - ${t}`));
        }

        if (claimed.length !== actualCount) {
            console.log(`\n⚠️  COUNT MISMATCH: Claimed ${claimed.length}, actual ${actualCount}`);
        }
    }

    console.log('\n========================================\n');
}

// Quick summary mode - just show what's in the scan
function showSummary() {
    const scan = loadScan();
    const results = scan.results;

    console.log('\n┌────────────────────────────────────────────────────────────────┐');
    console.log('│                    SCANNER CONTENTS                            │');
    console.log('├────────────────────────────────────────────────────────────────┤');
    console.log(`│  Timestamp: ${scan.timestamp.padEnd(49)}│`);
    console.log(`│  Total Tickers: ${results.length.toString().padEnd(46)}│`);
    console.log('├────────────────────────────────────────────────────────────────┤');
    console.log('│  #   Symbol   Zone           Score   RSI    Trend             │');
    console.log('├────────────────────────────────────────────────────────────────┤');

    results.forEach((r, i) => {
        const num = (i+1).toString().padStart(2);
        const sym = r.symbol.padEnd(8);
        const zone = r.zone.padEnd(14);
        const score = (r.sourceInfo?.score?.toString() ?? '-').padStart(3);
        const rsi = (r.technicals?.rsi?.toFixed(1) ?? '-').padStart(5);
        const trend = (r.technicals?.trend ?? '-').padEnd(18);
        console.log(`│  ${num}  ${sym} ${zone} ${score}   ${rsi}  ${trend}│`);
    });

    console.log('└────────────────────────────────────────────────────────────────┘');

    // Group by zone
    const zones = {};
    results.forEach(r => {
        if (!zones[r.zone]) zones[r.zone] = [];
        zones[r.zone].push(r.symbol);
    });

    console.log('\nBY ZONE:');
    Object.keys(zones).sort().forEach(zone => {
        console.log(`  ${zone}: ${zones[zone].join(', ')}`);
    });

    // Show tradeable
    const tradeable = results.filter(r => r.tradeable);
    if (tradeable.length > 0) {
        console.log(`\n🎯 TRADEABLE (${tradeable.length}): ${tradeable.map(r => `${r.symbol} (${r.action})`).join(', ')}`);
    }

    console.log('');
}

// Main
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--summary' || args[0] === '-s') {
    showSummary();
} else if (args[0] === '--help' || args[0] === '-h') {
    console.log(`
Scanner Validator - Ensures all tickers are accounted for

Usage:
  node scanner-validator.js                    Show scan summary
  node scanner-validator.js -s                 Show scan summary
  node scanner-validator.js SPY QQQ NVDA ...   Validate these tickers against scan
  node scanner-validator.js -h                 Show this help

This tool exists because I (the AI) missed tickers during a review.
Run this AFTER any scanner briefing to verify I didn't skip anything.
`);
} else {
    validateTickers(args);
}
