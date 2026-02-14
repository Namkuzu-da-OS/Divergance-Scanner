/**
 * PM2 Ecosystem Configuration
 *
 * Start all:  pm2 start ecosystem.config.js
 * Stop all:   pm2 stop all
 * Restart:    pm2 restart all
 * Status:     pm2 list
 * Logs:       pm2 logs
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
      max_memory_restart: '512M'
    },
    {
      name: 'opportunity',
      script: 'monitor/opportunity-scanner.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '256M'
    },
    {
      name: 'earnings',
      script: 'monitor/earnings-scanner.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '256M'
    },
    {
      name: 'premarket',
      script: 'monitor/premarket-scanner.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '256M'
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
