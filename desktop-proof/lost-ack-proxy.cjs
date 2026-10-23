/* Local Phase 3 lost-ack proxy. Never package or deploy this file. */
const http = require('node:http');
const target = process.env.PHASE3_PROXY_TARGET || 'http://127.0.0.1:3030';
let dropFirst = process.env.PHASE3_PROXY_DROP_FIRST === '1';
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  try {
    const upstream = await fetch(new URL(req.url, target), {
      method: req.method,
      headers: Object.fromEntries(Object.entries(req.headers).filter(([key]) => !['host', 'content-length', 'connection'].includes(key))),
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
      cache: 'no-store',
    });
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    const shouldDrop = dropFirst && req.method === 'POST' && req.url === '/api/desktop/sync' && upstream.ok;
    if (shouldDrop) {
      dropFirst = false;
      console.log('LOST_ACK_DROPPED_AFTER_UPSTREAM_RESPONSE');
      res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': req.headers.origin || 'tauri://localhost', 'Access-Control-Allow-Headers': 'authorization,content-type' });
      res.end(JSON.stringify({ code: 'SERVER_UNAVAILABLE' }));
      return;
    }
    const headers = {};
    for (const name of ['content-type', 'cache-control', 'access-control-allow-origin', 'access-control-allow-headers', 'access-control-allow-methods', 'vary']) {
      const value = upstream.headers.get(name); if (value) headers[name] = value;
    }
    res.writeHead(upstream.status, headers); res.end(responseBody);
  } catch {
    res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ code: 'SERVER_UNAVAILABLE' }));
  }
});
server.listen(3031, '127.0.0.1', () => console.log(`LOCAL LOST-ACK PROXY 127.0.0.1:3031 -> ${target}`));
