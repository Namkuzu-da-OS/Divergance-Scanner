/**
 * One-time cleanup script for duplicate active signals
 * Run once: node monitor/cleanup-duplicate-signals.js
 *
 * Finds symbols with multiple active signals and closes all but the oldest.
 */

const signalDb = require('./signal-db');

function cleanupDuplicates() {
  const db = signalDb.getDb();

  console.log('[Cleanup] Finding duplicate active signals...\n');

  // Find symbols with multiple active signals
  const duplicates = db.prepare(`
    SELECT symbol, COUNT(*) as cnt, GROUP_CONCAT(id, ',') as ids
    FROM signals
    WHERE status = 'active'
    GROUP BY symbol
    HAVING cnt > 1
    ORDER BY cnt DESC
  `).all();

  if (duplicates.length === 0) {
    console.log('[Cleanup] No duplicates found. All clean!');
    return;
  }

  console.log(`[Cleanup] Found ${duplicates.length} symbol(s) with duplicates:\n`);

  let totalClosed = 0;

  for (const row of duplicates) {
    const ids = row.ids.split(',').map(Number).sort((a, b) => a - b);
    const keepId = ids[0];  // Keep oldest (lowest ID)
    const closeIds = ids.slice(1);

    console.log(`${row.symbol}: ${row.cnt} signals`);
    console.log(`  Keeping: #${keepId}`);
    console.log(`  Closing: ${closeIds.map(id => `#${id}`).join(', ')}`);

    // Close duplicates
    for (const id of closeIds) {
      db.prepare(`
        UPDATE signals
        SET status = 'closed',
            final_outcome = 'DUPLICATE_CLEANUP',
            closed_at = datetime('now')
        WHERE id = ?
      `).run(id);
      totalClosed++;
    }

    console.log('');
  }

  console.log(`[Cleanup] Done! Closed ${totalClosed} duplicate signal(s).`);
  console.log('[Cleanup] Each symbol now has at most 1 active signal.');
}

// Run cleanup
cleanupDuplicates();
