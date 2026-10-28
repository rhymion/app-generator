import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(path.join(__dirname, f), 'utf8');

describe('GCP scripts match the attachment storage code', () => {
  it('deploy maps the bucket secret to GCS_BUCKET_NAME, the variable lib/attachment/storage.ts reads', () => {
    const deploy = read('gcp-deploy.sh');
    expect(deploy).toContain('GCS_BUCKET_NAME=app-gcs-bucket-name:latest');
    expect(deploy).not.toMatch(/[,=]GCS_BUCKET=app-gcs-bucket-name/);
  });

  it('setup grants the narrow bucket role, not objectAdmin', () => {
    const setup = read('gcp-setup.sh');
    expect(setup).toContain('--role=roles/storage.objectUser');
    expect(setup).not.toContain('roles/storage.objectAdmin');
  });

  it('setup creates the bucket with Public Access Prevention and checks an existing bucket', () => {
    const setup = read('gcp-setup.sh');
    expect(setup).toMatch(/buckets create[\s\S]*--uniform-bucket-level-access[\s\S]*--public-access-prevention/);
    expect(setup).toContain('public_access_prevention');
    expect(setup).toContain('uniform_bucket_level_access');
  });
});
