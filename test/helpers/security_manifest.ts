// Node-only: reads the security manifest `generate-code` writes. Kept apart from security_core.ts,
// which the Cypress spec bundle imports and which therefore cannot use Node modules.
import fs from 'node:fs';
import path from 'node:path';
import type { SecurityManifest } from './security_core';

export function loadManifest(root: string = process.cwd()): SecurityManifest {
  const file = path.join(root, '.security-manifest.json');
  if (!fs.existsSync(file)) {
    throw new Error(`${file} not found: run "npm run generate-code" first (it writes the security manifest).`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as SecurityManifest;
}
