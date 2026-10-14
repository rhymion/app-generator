// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

// The mobile Playwright run reaches the API through mobile/scripts/same-origin-proxy.js. A socket reset on
// either side of the proxy must end only that one request, never the proxy process (a dead proxy fails every
// later spec with ERR_CONNECTION_REFUSED). Hand-written module; needs no generated code.

const PROXY = path.resolve(__dirname, '../mobile/scripts/same-origin-proxy.js');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function startProxy(webPort: number) {
  const proxyPort = await freePort();
  const apiPort = await freePort();
  const child = spawn(process.execPath, [PROXY], {
    env: { ...process.env, PROXY_PORT: String(proxyPort), WEB_PORT: String(webPort), API_PORT: String(apiPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.stdout!.on('data', (chunk) => String(chunk).includes('listening') && resolve());
    child.once('exit', () => reject(new Error('proxy exited before listening')));
  });
  return { child, proxyPort };
}

describe('same-origin proxy', () => {
  it('survives an upstream socket that resets mid-response, and a browser that resets mid-response', async () => {
    const web = http.createServer((req, res) => {
      res.writeHead(200, { 'content-length': 100000 });
      res.write('x'.repeat(1000));
      if (req.url === '/upstream-reset') setTimeout(() => req.socket.resetAndDestroy(), 100);
    });
    await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve));
    const { child, proxyPort } = await startProxy((web.address() as net.AddressInfo).port);
    try {
      for (const url of ['/upstream-reset', '/browser-reset']) {
        const socket = net.connect(proxyPort, '127.0.0.1');
        socket.on('error', () => {});
        socket.on('data', () => {});
        socket.write(`GET ${url} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
        await sleep(url === '/browser-reset' ? 100 : 400);
        if (url === '/browser-reset') socket.resetAndDestroy();
        await sleep(400);
        socket.destroy();
        expect(child.exitCode, `proxy exited after ${url}`).toBeNull();
      }
    } finally {
      child.kill();
      web.closeAllConnections();
      web.close();
    }
  }, 15000);
});
