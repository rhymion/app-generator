// Same-origin reverse proxy for running the mobile web bundle against the
// Next.js API in a real browser (see docs/knowledge/mobile-app.md).
//
// Entity REST routes send no CORS headers, so a browser that loads the Expo
// web app from one port and calls the API on another has its fetches blocked.
// Routing both through one proxy port makes every request same-origin without
// changing any generated API route. Native iOS/Android builds are not subject
// to CORS and do not need this.
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
  // A browser that navigates away drops its hot-reload socket; without a handler the reset is an
  // unhandled 'error' event that ends the whole proxy process.
  clientSocket.on('error', () => proxySocket.destroy());
});

server.listen(httpProxyPort, () => {
  console.log(`same-origin proxy listening on :${httpProxyPort} -> api:${apiTarget.port} web:${webTarget.port}`);
});

