// Vitest config for the attachment bridge ownership check. Run with the
// staged copy (see code_generator/tests/test_attachment_actions.py): the
// rendered lib/attachment/bridge_actions.ts sits next to this file and the
// modules it imports are swapped for in-memory fakes.
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default {
  root,
  test: { environment: 'node', include: ['bridge_actions.test.ts'] },
  resolve: {
    alias: [
      { find: '@/lib/prisma', replacement: path.join(root, 'fake/prisma.ts') },
      { find: '@/lib/authz', replacement: path.join(root, 'fake/authz.ts') },
      { find: '@/lib/_errors', replacement: path.join(root, '../lib/_errors.ts') },
      { find: '@/lib/compliance/attachment_name_crypto', replacement: path.join(root, 'fake/crypto.ts') },
      { find: 'next/cache', replacement: path.join(root, 'fake/cache.ts') },
      { find: '@/lib/attachment/bridge_actions', replacement: path.join(root, 'bridge_actions.ts') },
    ],
  },
};
