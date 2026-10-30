// Vitest config for the mention-gate fixture's generated-file tests
// (search.test.ts, recipients.test.ts). Run with --config pointing at the copy
// staged in the generated fixture output (.generated-mention-gate), see
// scripts/check_mention_gate_fixture.sh. The tests import the generated
// lib/mention/search.ts and lib/mention/recipients.ts, which a checkout that
// has not run generate-code does not have, so they run here, after generation,
// and not in the repository's own Unit Tests job. `@` is the generated output,
// so '@/lib/prisma' and '@/lib/authz' resolve to the fixture shims.
import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  test: {
    environment: 'node',
    include: ['lib/mention/search.test.ts', 'lib/mention/recipients.test.ts'],
  },
  resolve: {
    alias: [{ find: /^@\//, replacement: root + path.sep }],
  },
});
