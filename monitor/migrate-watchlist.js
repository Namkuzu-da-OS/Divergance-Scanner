#!/usr/bin/env node
/**
 * Migrate watchlist.json to SQLite database
 * Run once: node monitor/migrate-watchlist.js
 */

const path = require('path');
const signalDb = require('./signal-db');

const WATCHLIST_PATH = path.join(__dirname, '..', 'data', 'watchlist.json');

console.log('='.repeat(50));
console.log('WATCHLIST MIGRATION: JSON → SQLite');
console.log('='.repeat(50));

// Run migration
const migrated = signalDb.migrateWatchlistFromJson(WATCHLIST_PATH);
console.log(`\nMigrated ${migrated} symbols from watchlist.json`);

// Show current state
console.log('\n' + '='.repeat(50));
console.log('CURRENT WATCHLIST STATE');
console.log('='.repeat(50));

const stats = signalDb.getWatchlistStats();
console.log(`\nTotal: ${stats.total} symbols (${stats.enabled} enabled)`);

console.log('\nBy source:');
stats.by_source.forEach(s => {
    console.log(`  ${s.source}: ${s.count}`);
});

console.log('\nAll symbols:');
const full = signalDb.getWatchlistFull();
full.forEach(s => {
    const status = s.enabled ? '✅' : '⏸️';
    const expires = s.expires_at ? ` (expires: ${s.expires_at.split('T')[0]})` : '';
    console.log(`  ${status} ${s.symbol.padEnd(8)} [${s.source}]${expires} ${s.notes || ''}`);
});

console.log('\n' + '='.repeat(50));
console.log('Done. Bloodhound will now read from database + JSON combined.');
