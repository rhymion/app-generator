import { describe, expect, it } from 'vitest';
import { TRIGRAM_ID_LIMIT, escapeLikeTerm, trigramPattern } from './_trigram_match';

describe('escapeLikeTerm', () => {
  it('leaves ordinary text alone', () => {
    expect(escapeLikeTerm('Alpha Panel')).toBe('Alpha Panel');
    expect(escapeLikeTerm('')).toBe('');
  });

  it('escapes the LIKE wildcards and the escape character itself', () => {
    expect(escapeLikeTerm('100%')).toBe('100\\%');
    expect(escapeLikeTerm('a_b')).toBe('a\\_b');
    expect(escapeLikeTerm('c:\\dir')).toBe('c:\\\\dir');
  });
});

describe('trigramPattern', () => {
  it('wraps the escaped text so it matches as a substring', () => {
    expect(trigramPattern('beta')).toBe('%beta%');
    expect(trigramPattern('50%_off')).toBe('%50\\%\\_off%');
  });

  it('keeps non-ASCII text intact', () => {
    expect(trigramPattern('権限')).toBe('%権限%');
  });
});

describe('TRIGRAM_ID_LIMIT', () => {
  it('stays below the database bind-parameter limit', () => {
    expect(TRIGRAM_ID_LIMIT).toBeLessThan(32767);
  });
});
