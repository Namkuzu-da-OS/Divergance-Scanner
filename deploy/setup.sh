#!/bin/bash
set -e

# Divergence Scanner - Ubuntu Setup Script
# Run as: sudo bash deploy/setup.sh

APP_DIR="/opt/divergence-scanner"
WEB_DIR="/var/www/divergence-scanner"

echo "=========================================="
echo "Divergence Scanner - Ubuntu Setup"
echo "=========================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root: sudo bash deploy/setup.sh"
    exit 1
fi

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo ""
echo "[1/7] Installing system dependencies..."
apt-get update
apt-get install -y python3 python3-pip python3-venv nginx curl

# Install Node.js 20.x (LTS)
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

echo "Node version: $(node --version)"
echo "npm version: $(npm --version)"
echo "Python version: $(python3 --version)"

echo ""
echo "[2/7] Setting up application directory..."
mkdir -p "$APP_DIR"
mkdir -p "$WEB_DIR"

# Copy project files (excluding node_modules, venv, etc.)
rsync -av --exclude='node_modules' --exclude='venv' --exclude='.venv' \
    --exclude='__pycache__' --exclude='*.pyc' --exclude='.git' \
    --exclude='frontend/dist' --exclude='data/*.db' \
    "$PROJECT_DIR/" "$APP_DIR/"

echo ""
echo "[3/7] Setting up Python virtual environment..."
cd "$APP_DIR"
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo ""
echo "[4/7] Building frontend..."
cd "$APP_DIR/frontend"
npm install
npm run build

# Copy built files to web directory
cp -r dist/* "$WEB_DIR/"

echo ""
echo "[5/7] Setting up environment file..."
cd "$APP_DIR"
if [ ! -f .env ]; then
    cp .env.example .env
    echo ""
    echo "*** IMPORTANT: Edit /opt/divergence-scanner/.env ***"
    echo "*** Set DATA_SERVER_URL to your data server IP ***"
    echo ""
fi

echo ""
echo "[6/7] Installing nginx config..."
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/divergence-scanner
ln -sf /etc/nginx/sites-available/divergence-scanner /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test nginx config
nginx -t

echo ""
echo "[7/7] Installing systemd service..."
cp "$APP_DIR/deploy/divergence-scanner.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable divergence-scanner

# Set permissions
chown -R www-data:www-data "$APP_DIR"
chown -R www-data:www-data "$WEB_DIR"

echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Edit the config:  nano /opt/divergence-scanner/.env"
echo "     - Set DATA_SERVER_URL to your data server (e.g., http://192.168.10.60:8000)"
echo ""
echo "  2. Start the services:"
echo "     sudo systemctl start divergence-scanner"
echo "     sudo systemctl restart nginx"
echo ""
echo "  3. Check status:"
echo "     sudo systemctl status divergence-scanner"
echo "     curl http://localhost/api/health"
echo ""
echo "  4. Access the dashboard at: http://$(hostname -I | awk '{print $1}')/"
echo ""
