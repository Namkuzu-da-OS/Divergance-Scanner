/**
 * PM2 Ecosystem Configuration
 *
 * Start all:  pm2 start ecosystem.config.js
 * Stop all:   pm2 stop all
 * Restart:    pm2 restart all
 * Status:     pm2 list
 * Logs:       pm2 logs
 *
 * SCAN_OFFSET_MS staggers scanner start times to keep concurrent
 * Schwab API calls under 300 (the rate limit threshold).
 * Bloodhound fires first (populates cache), others follow.
 */

// Shared config applied to every process
const DEFAULTS = {
  cwd: __dirname,
  watch: false,
  autorestart: true,
  max_restarts: 10,
  restart_delay: 5000,
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
};

module.exports = {
  apps: [
    {
      ...DEFAULTS,
      name: 'gateway',
      script: 'monitor/api-gateway.js',
      restart_delay: 2000,
      max_memory_restart: '128M'
    },
    {
      ...DEFAULTS,
      name: 'bloodhound',
      script: 'monitor/bloodhound-scanner.js',
      max_memory_restart: '512M',
      env: {
        SCAN_OFFSET_MS: '0'       // Fires first — populates cache for others
      }
    },
    {
      ...DEFAULTS,
      name: 'opportunity',
      script: 'monitor/opportunity-scanner.js',
      max_memory_restart: '256M',
      env: {
        SCAN_OFFSET_MS: '90000'   // 90s — Bloodhound done, reads warm cache
      }
    },
    {
      ...DEFAULTS,
      name: 'earnings',
      script: 'monitor/earnings-scanner.js',
      max_memory_restart: '256M',
      env: {
        SCAN_OFFSET_MS: '180000'  // 180s — everything cached, near-zero Schwab load
      }
    },
    {
      ...DEFAULTS,
      name: 'premarket',
      script: 'monitor/premarket-scanner.js',
      max_memory_restart: '256M',
      env: {
        SCAN_OFFSET_MS: '60000'   // 60s — only runs 6-9:30 AM, light overlap with BH
      }
    },
    {
      ...DEFAULTS,
      name: 'webserver',
      script: 'monitor/web-server.js',
      max_memory_restart: '512M'
    },
    {
      ...DEFAULTS,
      name: 'eod-tracker',
      script: 'monitor/eod-gap-tracker.js',
      max_restarts: 5,
      restart_delay: 10000,
      max_memory_restart: '128M'
    },
    {
      ...DEFAULTS,
      name: 'internals',
      script: 'monitor/market-internals.js',
      max_memory_restart: '128M'
    }
  ]
};
