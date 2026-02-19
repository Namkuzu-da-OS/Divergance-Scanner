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

module.exports = {
  apps: [
    {
      name: 'bloodhound',
      script: 'monitor/bloodhound-scanner.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '512M',
      env: {
        SCAN_OFFSET_MS: '0'       // Fires first — populates cache for others
      }
    },
    {
      name: 'opportunity',
      script: 'monitor/opportunity-scanner.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '256M',
      env: {
        SCAN_OFFSET_MS: '90000'   // 90s — Bloodhound done, reads warm cache
      }
    },
    {
      name: 'earnings',
      script: 'monitor/earnings-scanner.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '256M',
      env: {
        SCAN_OFFSET_MS: '180000'  // 180s — everything cached, near-zero Schwab load
      }
    },
    {
      name: 'premarket',
      script: 'monitor/premarket-scanner.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '256M',
      env: {
        SCAN_OFFSET_MS: '60000'   // 60s — only runs 6-9:30 AM, light overlap with BH
      }
    },
    {
      name: 'webserver',
      script: 'monitor/web-server.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '512M'
    },
    {
      name: 'eod-tracker',
      script: 'monitor/eod-gap-tracker.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 10000,
      max_memory_restart: '128M'
    },
    {
      name: 'internals',
      script: 'monitor/market-internals.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '128M'
    }
  ]
};
