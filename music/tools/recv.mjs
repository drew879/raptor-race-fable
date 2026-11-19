// Takes sound files posted from the browser and writes them to ./out.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method !== 'POST') return res.end('ok');
  const name = path.basename(req.url ?? 'clip.wav').replace(/[^a-z0-9.-]/gi, '');
  const parts = [];
  req.on('data', (d) => parts.push(d));
  req.on('end', () => {
    fs.writeFileSync(path.join(dir, name), Buffer.concat(parts));
    res.end('saved');
  });
}).listen(8787, '127.0.0.1');
