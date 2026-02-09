#!/usr/bin/env node
/**
 * Watchlist Manager (SQLite-backed)
 *
 * Usage:
 *   node watchlist.js list              - Show all symbols
 *   node watchlist.js add SYMBOL        - Add symbol to watchlist
 *   node watchlist.js remove SYMBOL     - Remove symbol from watchlist
 *   node watchlist.js enable SYMBOL     - Enable symbol
 *   node watchlist.js disable SYMBOL    - Disable symbol (keeps in list)
 *   node watchlist.js note SYMBOL "note" - Add note to symbol
 */

const signalDb = require('./signal-db');

function listSymbols() {
    const entries = signalDb.getWatchlistFull();

    console.log('\n📋 WATCHLIST (SQLite)');
    console.log('='.repeat(60));

    if (entries.length === 0) {
        console.log('  (empty)');
        return;
    }

    const enabled = entries.filter(s => s.enabled);
    const disabled = entries.filter(s => !s.enabled);

    if (enabled.length > 0) {
        console.log('\n✅ Enabled:');
        for (const s of enabled) {
            const source = s.source ? ` [${s.source}]` : '';
            const expires = s.expires_at ? ` (expires ${s.expires_at.split('T')[0]})` : '';
            console.log(`   ${s.symbol.padEnd(8)} ${s.notes || ''}${source}${expires}`);
        }
    }

    if (disabled.length > 0) {
        console.log('\n⏸️  Disabled:');
        for (const s of disabled) {
            const source = s.source ? ` [${s.source}]` : '';
            console.log(`   ${s.symbol.padEnd(8)} ${s.notes || ''}${source}`);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Total: ${entries.length} (${enabled.length} enabled)`);
}

function addSymbol(symbol, notes = '') {
    symbol = symbol.toUpperCase();
    const result = signalDb.addToWatchlist(symbol, {
        source: 'manual',
        notes: notes || null
    });

    if (result.action === 'skipped_manual') {
        console.log(`⚠️  ${symbol} already in watchlist (manual entry)`);
    } else if (result.action === 'updated') {
        console.log(`✅ Updated ${symbol} in watchlist`);
    } else {
        console.log(`✅ Added ${symbol} to watchlist`);
    }
}

function removeSymbol(symbol) {
    symbol = symbol.toUpperCase();
    const removed = signalDb.removeFromWatchlist(symbol);
    if (removed) {
        console.log(`🗑️  Removed ${symbol} from watchlist`);
    } else {
        console.log(`⚠️  ${symbol} not in watchlist`);
    }
}

function enableSymbol(symbol) {
    symbol = symbol.toUpperCase();
    const updated = signalDb.setWatchlistEnabled(symbol, true);
    if (updated) {
        console.log(`✅ Enabled ${symbol}`);
    } else {
        console.log(`⚠️  ${symbol} not in watchlist. Use 'add' first.`);
    }
}

function disableSymbol(symbol) {
    symbol = symbol.toUpperCase();
    const updated = signalDb.setWatchlistEnabled(symbol, false);
    if (updated) {
        console.log(`⏸️  Disabled ${symbol} (still in list)`);
    } else {
        console.log(`⚠️  ${symbol} not in watchlist`);
    }
}

function setNote(symbol, note) {
    symbol = symbol.toUpperCase();
    const updated = signalDb.setWatchlistNotes(symbol, note);
    if (updated) {
        console.log(`📝 Updated note for ${symbol}`);
    } else {
        console.log(`⚠️  ${symbol} not in watchlist`);
    }
}

// Main
const args = process.argv.slice(2);
const command = args[0]?.toLowerCase();
const symbol = args[1];
const extra = args.slice(2).join(' ');

switch (command) {
    case 'list':
    case 'ls':
    case undefined:
        listSymbols();
        break;

    case 'add':
    case 'a':
        if (!symbol) {
            console.log('Usage: node watchlist.js add SYMBOL [notes]');
            process.exit(1);
        }
        addSymbol(symbol, extra);
        break;

    case 'remove':
    case 'rm':
    case 'delete':
    case 'del':
        if (!symbol) {
            console.log('Usage: node watchlist.js remove SYMBOL');
            process.exit(1);
        }
        removeSymbol(symbol);
        break;

    case 'enable':
    case 'on':
        if (!symbol) {
            console.log('Usage: node watchlist.js enable SYMBOL');
            process.exit(1);
        }
        enableSymbol(symbol);
        break;

    case 'disable':
    case 'off':
        if (!symbol) {
            console.log('Usage: node watchlist.js disable SYMBOL');
            process.exit(1);
        }
        disableSymbol(symbol);
        break;

    case 'note':
        if (!symbol || !extra) {
            console.log('Usage: node watchlist.js note SYMBOL "your note"');
            process.exit(1);
        }
        setNote(symbol, extra);
        break;

    case 'help':
    case '-h':
    case '--help':
        console.log(`
Watchlist Manager (SQLite-backed)

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
