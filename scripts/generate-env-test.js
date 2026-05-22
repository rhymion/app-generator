#!/usr/bin/env node
// Generates .env.test from config/ports.yaml.
// Static secrets (AUTH_SECRET, TEST_RESET_TOKEN) are preserved from the existing file.
// Usage:
//   node scripts/generate-env-test.js          # overwrite .env.test
//   node scripts/generate-env-test.js --check  # verify .env.test is up to date

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CHECK_MODE = process.argv.includes('--check');
const PROJ_ROOT = path.resolve(__dirname, '..');
const PORTS_FILE = path.join(PROJ_ROOT, 'config', 'ports.yaml');
const ENV_TEST_FILE = path.join(PROJ_ROOT, '.env.test');

const ports = yaml.load(fs.readFileSync(PORTS_FILE, 'utf8'));
const t = ports.test;
const APP_PORT = t.app;
const PG = t.postgres;
const REDIS = t.redis;

const DATABASE_URL = 'postgresql://' + PG.user + ':' + PG.password + '@' + PG.host + ':' + PG.port + '/' + PG.database;
const REDIS_URL = 'redis://' + REDIS.host + ':' + REDIS.port;
const NEXTAUTH_URL = 'http://localhost:' + APP_PORT;

let AUTH_SECRET_LINE = 'AUTH_SECRET=""';
let AUTH_TRUST_HOST = 'true';
let TEST_RESET_TOKEN_LINE = 'TEST_RESET_TOKEN="cypress-reset-token"';

if (fs.existsSync(ENV_TEST_FILE)) {
  const existing = fs.readFileSync(ENV_TEST_FILE, 'utf8');
  const authMatch = existing.match(/^(AUTH_SECRET=.*)$/m);
  const authTrustHostMatch = existing.match(/^AUTH_TRUST_HOST=(.+)$/m);
  const tokenMatch = existing.match(/^(TEST_RESET_TOKEN=.*)$/m);
  if (authMatch) AUTH_SECRET_LINE = authMatch[1];
  if (authTrustHostMatch) AUTH_TRUST_HOST = authTrustHostMatch[1];
  if (tokenMatch) TEST_RESET_TOKEN_LINE = tokenMatch[1];
}

const lines = [
  '# Test environment configuration',
  '# Port-derived values are generated from config/ports.yaml.',
  '# To change ports: edit config/ports.yaml, then run: npm run ports:generate',
  '#',
  '# DO NOT manually edit PORT, POSTGRES_PORT, POSTGRES_DB, REDIS_PORT,',
  '# DATABASE_URL, NEXTAUTH_URL, REDIS_URL, or NODE_ENV — they are overwritten',
  '# by ports:generate.',
  '',
  'PORT=' + APP_PORT,
  'POSTGRES_PORT=' + PG.port,
  'POSTGRES_DB=' + PG.database,
  'REDIS_PORT=' + REDIS.port,
  'DATABASE_URL="' + DATABASE_URL + '"',
  'NEXTAUTH_URL="' + NEXTAUTH_URL + '"',
  'REDIS_URL="' + REDIS_URL + '"',
  'NODE_ENV="test"',
  '',
  '# NextAuth secret - must match the variable name used in auth.ts (AUTH_SECRET)',
  AUTH_SECRET_LINE,
  'AUTH_TRUST_HOST=' + AUTH_TRUST_HOST,
  '',
  '# Enables /api/_test/reset-caches so cypress can clear in-process LRU caches',
  '# (api-key, permission) after cy.task(\'db:reset\'). Production deployments',
  '# leave this unset; the route then returns 404.',
  TEST_RESET_TOKEN_LINE,
  '',
  '# Disable Prisma Accelerate in test env (use direct local DB connection)',
  'PRISMA_DATABASE_URL=',
  '',
];

const generated = lines.join('\n');

if (/\$\{/.test(generated)) {
  console.error('ports:generate internal error: generated content contains ${. Aborting.');
  process.exit(2);
}

if (CHECK_MODE) {
  const current = fs.existsSync(ENV_TEST_FILE)
    ? fs.readFileSync(ENV_TEST_FILE, 'utf8')
    : '';
  if (current === generated) {
    console.log('ports:check  .env.test is up to date');
  } else {
    console.error('ports:check FAILED: .env.test differs from generated output.');
    console.error('Run: npm run ports:generate');
    process.exit(1);
  }
} else {
  fs.writeFileSync(ENV_TEST_FILE, generated);
  console.log('ports:generate');
  console.log('  source: config/ports.yaml');
  console.log('  wrote:  .env.test');
  console.log('  app:    ' + APP_PORT);
  console.log('  postgres: ' + PG.host + ':' + PG.port + '/' + PG.database);
  console.log('  redis:  ' + REDIS.host + ':' + REDIS.port);
  console.log('  nextauth: ' + NEXTAUTH_URL);
  console.log('  ok: no shell expansion remains');
}
