module.exports = {
  apps: [{
    name: 'divergence-scanner',
    script: 'venv/bin/python',
    args: '-m uvicorn backend.main:app --host 127.0.0.1 --port 8042',
    cwd: __dirname,
    interpreter: 'none',
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000
  }]
};
