// Starts the Expo web dev server and the same-origin proxy (same-origin-proxy.js) as
// one process, so a runner that supervises a single server command can stop both.
// scripts/run_mobile_entity_playwright.sh uses it.
//
// Environment: WEB_PORT (Expo web), PROXY_PORT and API_PORT (see same-origin-proxy.js),
// EXPO_PUBLIC_API_BASE_URL (the proxy's URL, read by the app).
const { spawn } = require('child_process');
const path = require('path');

const webPort = process.env.WEB_PORT || '8095';
// Run the Expo CLI directly (not through npx) so stopping this process stops the dev server too.
const expoCli = require.resolve('expo/bin/cli', { paths: [path.resolve(__dirname, '..')] });
const expo = spawn(process.execPath, [expoCli, 'start', '--web', '--port', webPort], {
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, CI: '1', NODE_ENV: 'development' },
  stdio: 'inherit',
});

require('./same-origin-proxy.js');

const stop = () => {
  expo.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
expo.on('exit', (code) => process.exit(code ?? 1));
