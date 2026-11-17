import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ASVS V13.2.3: the production compose file must not carry a default database password.

const compose = readFileSync(path.resolve(__dirname, '..', 'docker-compose.prod.yml'), 'utf-8');

describe('docker-compose.prod.yml database password', () => {
  const line = compose.split('\n').find((l) => l.trim().startsWith('POSTGRES_PASSWORD:'));

  it('declares POSTGRES_PASSWORD', () => {
    expect(line).toBeDefined();
  });

  it('requires the value from the environment instead of defaulting it', () => {
    // `${VAR:?message}` makes docker compose fail when VAR is unset or empty.
    expect(line).toMatch(/\$\{POSTGRES_PASSWORD:\?[^}]+\}/);
    expect(line).not.toMatch(/\$\{POSTGRES_PASSWORD:?-/);
  });

  it('does not hard-code a password literal anywhere', () => {
    expect(compose).not.toMatch(/^\s*POSTGRES_PASSWORD:\s*[^$\s#]/m);
  });
});
