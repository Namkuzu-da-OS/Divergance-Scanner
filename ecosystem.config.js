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
      restart_delay: 5000
    },
    {
      name: 'opportunity',
      script: 'monitor/opportunity-scanner.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000
    },
    {
      name: 'earnings',
      script: 'monitor/earnings-scanner.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000
    },
    {
      name: 'premarket',
      script: 'monitor/premarket-scanner.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000
    },
    {
      name: 'webserver',
      script: 'monitor/web-server.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000
    },
    {
      name: 'eod-tracker',
      script: 'monitor/eod-gap-tracker.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 10000
    },
    {
      name: 'internals',
      script: 'monitor/market-internals.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000
    }
  ]
};
