#!/usr/bin/env node
/**
 * Watchlist Manager
 *
 * Usage:
 *   node watchlist.js list              - Show all symbols
 *   node watchlist.js add SYMBOL        - Add symbol to watchlist
 *   node watchlist.js remove SYMBOL     - Remove symbol from watchlist
 *   node watchlist.js enable SYMBOL     - Enable symbol
 *   node watchlist.js disable SYMBOL    - Disable symbol (keeps in list)
 *   node watchlist.js note SYMBOL "note" - Add note to symbol
 */

const fs = require('fs');
const path = require('path');

const WATCHLIST_PATH = path.join(__dirname, '..', 'data', 'watchlist.json');

function loadWatchlist() {
    try {
        return JSON.parse(fs.readFileSync(WATCHLIST_PATH, 'utf8'));
    } catch (e) {
        return {
            description: "Symbols to scan for buy/sell zones",
            updated: new Date().toISOString().split('T')[0],
            symbols: [],
            settings: {
                buyZoneThresholdPct: 0.5,
                sellZoneThresholdPct: 0.5,
                rsiOverbought: 75,
                rsiOversold: 30,
                alertCooldownMinutes: 60
            }
        };
    }
}

function saveWatchlist(watchlist) {
    watchlist.updated = new Date().toISOString().split('T')[0];
    fs.writeFileSync(WATCHLIST_PATH, JSON.stringify(watchlist, null, 2));
}

function listSymbols(watchlist) {
    console.log('\n📋 WATCHLIST');
    console.log('='.repeat(50));

    if (watchlist.symbols.length === 0) {
        console.log('  (empty)');
        return;
    }

    const enabled = watchlist.symbols.filter(s => s.enabled);
    const disabled = watchlist.symbols.filter(s => !s.enabled);

    if (enabled.length > 0) {
        console.log('\n✅ Enabled:');
        enabled.forEach(s => {
            console.log(`   ${s.symbol.padEnd(8)} ${s.notes || ''}`);
        });
    }

    if (disabled.length > 0) {
        console.log('\n⏸️  Disabled:');
        disabled.forEach(s => {
            console.log(`   ${s.symbol.padEnd(8)} ${s.notes || ''}`);
        });
    }

    console.log('\n' + '='.repeat(50));
    console.log(`Total: ${watchlist.symbols.length} (${enabled.length} enabled)`);
}

function addSymbol(watchlist, symbol, notes = '') {
    symbol = symbol.toUpperCase();

    const existing = watchlist.symbols.find(s => s.symbol === symbol);
    if (existing) {
        console.log(`⚠️  ${symbol} already in watchlist`);
        if (!existing.enabled) {
            existing.enabled = true;
            saveWatchlist(watchlist);
            console.log(`✅ Re-enabled ${symbol}`);
        }
        return;
    }

    watchlist.symbols.push({
        symbol,
        enabled: true,
        notes: notes || `Added ${new Date().toLocaleDateString()}`
    });

    saveWatchlist(watchlist);
    console.log(`✅ Added ${symbol} to watchlist`);
}

function removeSymbol(watchlist, symbol) {
    symbol = symbol.toUpperCase();

    const index = watchlist.symbols.findIndex(s => s.symbol === symbol);
    if (index === -1) {
        console.log(`⚠️  ${symbol} not in watchlist`);
        return;
    }

    watchlist.symbols.splice(index, 1);
    saveWatchlist(watchlist);
    console.log(`🗑️  Removed ${symbol} from watchlist`);
}

function enableSymbol(watchlist, symbol) {
    symbol = symbol.toUpperCase();

    const entry = watchlist.symbols.find(s => s.symbol === symbol);
    if (!entry) {
        console.log(`⚠️  ${symbol} not in watchlist. Use 'add' first.`);
        return;
    }

    entry.enabled = true;
    saveWatchlist(watchlist);
    console.log(`✅ Enabled ${symbol}`);
}

function disableSymbol(watchlist, symbol) {
    symbol = symbol.toUpperCase();

    const entry = watchlist.symbols.find(s => s.symbol === symbol);
    if (!entry) {
        console.log(`⚠️  ${symbol} not in watchlist`);
        return;
    }

    entry.enabled = false;
    saveWatchlist(watchlist);
    console.log(`⏸️  Disabled ${symbol} (still in list)`);
}

function setNote(watchlist, symbol, note) {
    symbol = symbol.toUpperCase();

    const entry = watchlist.symbols.find(s => s.symbol === symbol);
    if (!entry) {
        console.log(`⚠️  ${symbol} not in watchlist`);
        return;
    }

    entry.notes = note;
    saveWatchlist(watchlist);
    console.log(`📝 Updated note for ${symbol}`);
}

// Main
const args = process.argv.slice(2);
const command = args[0]?.toLowerCase();
const symbol = args[1];
const extra = args.slice(2).join(' ');

const watchlist = loadWatchlist();

switch (command) {
    case 'list':
    case 'ls':
    case undefined:
        listSymbols(watchlist);
        break;

    case 'add':
    case 'a':
        if (!symbol) {
            console.log('Usage: node watchlist.js add SYMBOL [notes]');
            process.exit(1);
        }
        addSymbol(watchlist, symbol, extra);
        break;

    case 'remove':
    case 'rm':
    case 'delete':
    case 'del':
        if (!symbol) {
            console.log('Usage: node watchlist.js remove SYMBOL');
            process.exit(1);
        }
        removeSymbol(watchlist, symbol);
        break;

    case 'enable':
    case 'on':
        if (!symbol) {
            console.log('Usage: node watchlist.js enable SYMBOL');
            process.exit(1);
        }
        enableSymbol(watchlist, symbol);
        break;

    case 'disable':
    case 'off':
        if (!symbol) {
            console.log('Usage: node watchlist.js disable SYMBOL');
            process.exit(1);
        }
        disableSymbol(watchlist, symbol);
        break;

    case 'note':
        if (!symbol || !extra) {
            console.log('Usage: node watchlist.js note SYMBOL "your note"');
            process.exit(1);
        }
        setNote(watchlist, symbol, extra);
        break;

    case 'help':
    case '-h':
    case '--help':
        console.log(`
Watchlist Manager

Usage:
  node watchlist.js list              Show all symbols
  node watchlist.js add SYMBOL        Add symbol to watchlist
  node watchlist.js remove SYMBOL     Remove symbol from watchlist
  node watchlist.js enable SYMBOL     Enable symbol
  node watchlist.js disable SYMBOL    Disable symbol (keeps in list)
  node watchlist.js note SYMBOL "x"   Add note to symbol

Shortcuts:
  list = ls
  add = a
  remove = rm, del
  enable = on
  disable = off
`);
        break;

    default:
        console.log(`Unknown command: ${command}`);
        console.log('Use "node watchlist.js help" for usage');
        process.exit(1);
}
