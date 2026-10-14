import { describe, expect, it } from 'vitest';
import { createGcsObjectRetentionStorageFromEnv, gcsStorageOptionsFromEnv } from './storage-gcs';
import { createS3ObjectLockStorageFromEnv } from './storage-s3';

describe('storage adapters read their settings from the environment', () => {
  it('GCS requires a bucket and retention days before loading any SDK', async () => {
    await expect(createGcsObjectRetentionStorageFromEnv({ AUDIT_LOG_GCS_BUCKET: 'b' })).rejects.toThrow(/both required/);
    await expect(createGcsObjectRetentionStorageFromEnv({ AUDIT_LOG_GCS_RETENTION_DAYS: '30' })).rejects.toThrow(/both required/);
  });

  it('GCS rejects a retention mode other than unlocked or locked', async () => {
    await expect(
      createGcsObjectRetentionStorageFromEnv({
        AUDIT_LOG_GCS_BUCKET: 'b',
        AUDIT_LOG_GCS_RETENTION_DAYS: '30',
        AUDIT_LOG_GCS_RETENTION_MODE: 'compliance',
      }),
    ).rejects.toThrow(/"unlocked" or "locked"/);
  });

  it('S3 requires bucket, region and retention days before loading any SDK', async () => {
    await expect(createS3ObjectLockStorageFromEnv({ AUDIT_LOG_S3_BUCKET: 'b' })).rejects.toThrow(/all required/);
  });

  it('GCS authentication is "adc" by default and names every missing variable for vercel-oidc', async () => {
    expect(await gcsStorageOptionsFromEnv({})).toEqual({});
    expect(await gcsStorageOptionsFromEnv({ AUDIT_LOG_GCS_ENDPOINT: 'http://localhost:4443' })).toEqual({ apiEndpoint: 'http://localhost:4443' });
    await expect(gcsStorageOptionsFromEnv({ AUDIT_LOG_GCS_AUTH: 'key' })).rejects.toThrow(/"adc" or "vercel-oidc"/);
    await expect(gcsStorageOptionsFromEnv({ AUDIT_LOG_GCS_AUTH: 'vercel-oidc', GCP_PROJECT_ID: 'p' })).rejects.toThrow(
      /GCP_PROJECT_NUMBER, GCP_SERVICE_ACCOUNT_EMAIL, GCP_WORKLOAD_IDENTITY_POOL_ID, GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID/,
    );
  });

  it('GCS vercel-oidc builds an external account client without contacting Google', async () => {
    const options = await gcsStorageOptionsFromEnv({
      AUDIT_LOG_GCS_AUTH: 'vercel-oidc',
      GCP_PROJECT_ID: 'p',
      GCP_PROJECT_NUMBER: '123',
      GCP_SERVICE_ACCOUNT_EMAIL: 'sa@p.iam.gserviceaccount.com',
      GCP_WORKLOAD_IDENTITY_POOL_ID: 'vercel',
      GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'vercel',
    });
    expect(options.projectId).toBe('p');
    expect(options.authClient).toBeDefined();
  });
});
