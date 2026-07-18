// Reusable same-origin reverse proxy for mobile PoC real-browser
// verification (see docs/knowledge/mobile-poc-test-runbook.md).
//
// Background: entity REST routes (e.g. /api/role) send no CORS headers by
// design — only /api/mobile/auth/* has CORS headers (withMobileCors() in
// lib/mobile-auth.ts). A real browser hitting the Expo web app on one port
// and the Next.js API on another port gets its entity fetches blocked by
// the browser's CORS check (confirmed via OPTIONS preflight: 204 with no
// Access-Control-Allow-Origin header). Routing both origins through one
// proxy port makes every request same-origin, sidestepping CORS entirely
// without touching generated API route code.
//
// This is a STOPGAP, not a fix — see cmd_369 for the generator-level CORS
// fix in progress. Check queue/reports/subtask_369a_gunshi.yaml (if it
// exists) before relying on this: once cmd_369 ships, entity REST routes
// should send CORS headers directly and this proxy step becomes
// unnecessary for verification (the app/API can be exercised at their
// real, separate origins instead).
//
// Originally written for subtask_368a (cmd_368); generalized here for
// reuse by future mobile PoC tasks instead of being copy-pasted and
// re-diverged each time.
//
// Usage: PROXY_PORT=8096 API_PORT=3012 WEB_PORT=8095 node mobile/scripts/same-origin-proxy.js
const http = require('http');
const httpProxyPort = Number(process.env.PROXY_PORT || 8096);
const apiTarget = { host: '127.0.0.1', port: Number(process.env.API_PORT || 3012) };
const webTarget = { host: '127.0.0.1', port: Number(process.env.WEB_PORT || 8095) };

function proxy(req, res, target) {
  const opts = {
    host: target.host,
    port: target.port,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };
  const proxyReq = http.request(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Proxy error: ' + err.message);
  });
  req.pipe(proxyReq, { end: true });
}

const server = http.createServer((req, res) => {
  const target = req.url.startsWith('/api') ? apiTarget : webTarget;
  proxy(req, res, target);
});

// Metro/Expo web dev server uses WebSocket for HMR.
server.on('upgrade', (req, clientSocket, head) => {
  const target = req.url.startsWith('/api') ? apiTarget : webTarget;
  const proxySocket = require('net').connect(target.port, target.host, () => {
    proxySocket.write(
      `${req.method} ${req.url} HTTP/1.1\r\n` +
        Object.entries(req.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n') +
        '\r\n\r\n',
    );
    proxySocket.write(head);
    proxySocket.pipe(clientSocket);
    clientSocket.pipe(proxySocket);
  });
  proxySocket.on('error', () => clientSocket.destroy());
});

server.listen(httpProxyPort, () => {
  console.log(`same-origin proxy listening on :${httpProxyPort} -> api:${apiTarget.port} web:${webTarget.port}`);
});
