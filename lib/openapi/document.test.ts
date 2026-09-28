import { describe, it, expect, vi, beforeEach } from 'vitest';

const { readFileSync } = vi.hoisted(() => ({ readFileSync: vi.fn() }));
vi.mock('node:fs', () => ({ default: { readFileSync } }));

import { readGeneratedOpenApiDocument } from './document';

describe('readGeneratedOpenApiDocument', () => {
  beforeEach(() => {
    readFileSync.mockReset();
  });

  it('returns the parsed document when docs/generated/openapi.json exists', () => {
    const fixture = { openapi: '3.1.0', info: { title: 'Generated API' } };
    readFileSync.mockReturnValue(JSON.stringify(fixture));

    expect(readGeneratedOpenApiDocument()).toEqual(fixture);
  });

  it('returns null when the file is missing (generate-code has not run)', () => {
    readFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    expect(readGeneratedOpenApiDocument()).toBeNull();
  });
});
