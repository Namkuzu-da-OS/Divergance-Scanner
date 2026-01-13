/**
 * Simple static file server for Wingman dashboard
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = path.join(__dirname, '..');

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'no-cache');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Strip query string from URL
    const urlPath = req.url.split('?')[0];
    let filePath = path.join(ROOT, urlPath === '/' ? 'zone-scanner.html' : urlPath);

    // Security: prevent directory traversal
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Not Found');
            } else {
                res.writeHead(500);
                res.end('Server Error');
            }
            return;
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
});

server.listen(PORT, () => {
    console.log(`[Web Server] Running on http://localhost:${PORT}`);
    console.log(`[Web Server] Serving: ${ROOT}`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[Web Server] Port ${PORT} already in use`);
    } else {
        console.error(`[Web Server] Error:`, err.message);
    }
});
