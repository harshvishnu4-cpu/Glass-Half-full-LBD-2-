// Minimal static server for local testing: node tools/serve.js [port]
// Correct MIME types for the game's formats + cache validators so the
// preloader's fetch and the elements share one download.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = +(process.argv[2] || 8123);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.webp': 'image/webp', '.webm': 'video/webm', '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json'
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': fs.statSync(file).size,
    'Cache-Control': 'max-age=3600'
  });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('serving ' + ROOT + ' on http://localhost:' + PORT));
