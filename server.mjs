import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.jpg':'image/jpeg', '.png':'image/png', '.mp4':'video/mp4', '.webm':'video/webm', '.wav':'audio/wav', '.md':'text/plain' };
const port = Number(process.env.PORT || 8080);
http.createServer((req, res) => {
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405, {'Allow':'GET, HEAD'}).end(); return; }
  let file;
  try { file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); }
  catch { res.writeHead(400).end(); return; }
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (file === root || file.endsWith(path.sep)) file = path.join(file, 'index.html');
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404).end('Not found'); return; }
    const headers = { 'Content-Type':mime[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff', 'Accept-Ranges':'bytes', 'Cache-Control':'no-cache' };
    let start = 0, end = stat.size - 1, status = 200;
    if (req.headers.range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!m || (!m[1] && !m[2])) { res.writeHead(416, {'Content-Range':`bytes */${stat.size}`}).end(); return; }
      if (!m[1]) start = Math.max(0, stat.size - Number(m[2]));
      else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), end) : end; }
      if (start > end || start >= stat.size) { res.writeHead(416, {'Content-Range':`bytes */${stat.size}`}).end(); return; }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || stat.size === 0) res.end();
    else { const stream = fs.createReadStream(file, {start, end}); stream.on('error', () => res.destroy()); stream.pipe(res); }
  });
}).listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Frameforge → http://localhost:${port}`));
