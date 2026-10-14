/**
 * AuditLogStorage on a Google Cloud Storage bucket with Object Retention
 * enabled. Every object is created with its own retain-until time, so the
 * bucket refuses overwrite and delete until it passes. The bucket, its
 * Object Retention setting and the credentials are created by ops; nothing
 * here creates them.
 *
 * - `unlocked` retention can still be shortened or removed by a user with the
 *   right permission; use it for trials. `locked` retention can only be
 *   extended, never shortened or removed.
 * - A new object is written only when no live object with that name exists
 *   (`ifGenerationMatch: 0`). If another writer wins the race, the stored body
 *   is read back and compared, exactly as for an ordinary re-put.
 * - A missing object (404) is the only error read as "not found". A
 *   permission error (403) is re-thrown, so a missing read grant surfaces as
 *   itself and never as an endless failing create.
 *
 * `@google-cloud/storage` is loaded by a dynamic import with a literal module
 * name, and only when `createGcsObjectRetentionStorageFromEnv` runs. The module
 * is therefore part of the build trace, and never loaded by an app that does
 * not select this storage. Tests inject a client instead.
 */
import type { AuditLogStorage } from './storage';

export type GcsRetentionMode = 'unlocked' | 'locked';

export class GcsPreconditionFailedError extends Error {
  constructor(key: string) {
    super(`Object ${key} already exists`);
    this.name = 'GcsPreconditionFailedError';
  }
}

export type GcsObjectRetentionClient = {
  /**
   * Create the object only if no live object with this name exists, with the
   * given retention. Throws `GcsPreconditionFailedError` when one exists.
   */
  createIfAbsent(params: {
    bucket: string;
    key: string;
    body: string;
    contentType: string;
    retentionMode: GcsRetentionMode;
    retainUntil: Date;
  }): Promise<void>;
  /** Returns the object body, or null when the key does not exist. Any other failure throws. */
  getObject(params: { bucket: string; key: string }): Promise<string | null>;
};

export class GcsObjectRetentionStorage implements AuditLogStorage {
  constructor(
    private readonly client: GcsObjectRetentionClient,
    private readonly bucket: string,
    private readonly retentionDays: number,
    private readonly retentionMode: GcsRetentionMode,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!Number.isInteger(retentionDays) || retentionDays < 1) {
      throw new Error(`Retention must be a whole number of days, got: ${retentionDays}`);
    }
    if (retentionMode !== 'unlocked' && retentionMode !== 'locked') {
      throw new Error(`Retention mode must be "unlocked" or "locked", got: ${retentionMode}`);
    }
  }

  async put(key: string, body: string): Promise<void> {
    const existing = await this.get(key);
    if (existing !== null) return this.compare(key, existing, body);
    const retainUntil = new Date(this.now().getTime() + this.retentionDays * 24 * 60 * 60 * 1000);
    try {
      await this.client.createIfAbsent({
        bucket: this.bucket,
        key,
        body,
        contentType: 'application/json',
        retentionMode: this.retentionMode,
        retainUntil,
      });
    } catch (err) {
      if (!(err instanceof GcsPreconditionFailedError)) throw err;
      // Another writer created the object between our read and our write.
      const raced = await this.get(key);
      if (raced === null) throw err;
      this.compare(key, raced, body);
    }
  }

  get(key: string): Promise<string | null> {
    return this.client.getObject({ bucket: this.bucket, key });
  }

  private compare(key: string, existing: string, body: string): void {
    if (existing !== body) {
      throw new Error(`Refusing to overwrite ${key}: stored content differs (write-once storage)`);
    }
  }
}

function errorCode(err: unknown): number | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : undefined;
}

/** Wraps an `@google-cloud/storage` Storage instance as a `GcsObjectRetentionClient`. */
export function gcsClientFromStorage(storage: {
  bucket(name: string): {
    file(key: string): {
      save(data: string, options: Record<string, unknown>): Promise<void>;
      download(): Promise<[Buffer]>;
    };
  };
}): GcsObjectRetentionClient {
  return {
    async createIfAbsent({ bucket, key, body, contentType, retentionMode, retainUntil }) {
      try {
        await storage.bucket(bucket).file(key).save(body, {
          contentType,
          resumable: false,
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: {
            retention: {
              mode: retentionMode === 'locked' ? 'Locked' : 'Unlocked',
              retainUntilTime: retainUntil.toISOString(),
            },
          },
        });
      } catch (err) {
        if (errorCode(err) === 412) throw new GcsPreconditionFailedError(key);
        throw err;
      }
    },
    async getObject({ bucket, key }) {
      try {
        const [contents] = await storage.bucket(bucket).file(key).download();
        return contents.toString('utf-8');
      } catch (err) {
        if (errorCode(err) === 404) return null;
        throw err;
      }
    },
  };
}

const VERCEL_OIDC_VARIABLES = [
  'GCP_PROJECT_ID',
  'GCP_PROJECT_NUMBER',
  'GCP_SERVICE_ACCOUNT_EMAIL',
  'GCP_WORKLOAD_IDENTITY_POOL_ID',
  'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID',
] as const;

/**
 * Options for `new Storage(...)`. `adc` (default) uses Application Default Credentials: the service
 * account attached to Cloud Run, or a local `gcloud` login. `vercel-oidc` exchanges Vercel's OIDC
 * token for short-lived Google credentials through Workload Identity Federation, so no key is stored
 * (https://vercel.com/docs/oidc/gcp). Both SDKs it needs are loaded only in that mode.
 */
export async function gcsStorageOptionsFromEnv(env: Record<string, string | undefined>): Promise<Record<string, unknown>> {
  const auth = env.AUDIT_LOG_GCS_AUTH ?? 'adc';
  if (auth !== 'adc' && auth !== 'vercel-oidc') {
    throw new Error(`AUDIT_LOG_GCS_AUTH must be "adc" or "vercel-oidc", got: ${auth}`);
  }
  const options: Record<string, unknown> = env.AUDIT_LOG_GCS_ENDPOINT ? { apiEndpoint: env.AUDIT_LOG_GCS_ENDPOINT } : {};
  if (auth === 'adc') return options;

  const missing = VERCEL_OIDC_VARIABLES.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`AUDIT_LOG_GCS_AUTH=vercel-oidc requires ${missing.join(', ')}.`);
  }
  const { getVercelOidcToken } = await import('@vercel/oidc');
  const { ExternalAccountClient } = await import('google-auth-library');
  const audience = `https://iam.googleapis.com/projects/${env.GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${env.GCP_WORKLOAD_IDENTITY_POOL_ID}/providers/${env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`;
  const authClient = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${env.GCP_SERVICE_ACCOUNT_EMAIL}:generateAccessToken`,
    subject_token_supplier: { getSubjectToken: () => getVercelOidcToken({ audience }) },
  });
  return { ...options, projectId: env.GCP_PROJECT_ID, authClient };
}

export async function createGcsObjectRetentionStorageFromEnv(env: Record<string, string | undefined> = process.env): Promise<AuditLogStorage> {
  const bucket = env.AUDIT_LOG_GCS_BUCKET;
  const rawDays = env.AUDIT_LOG_GCS_RETENTION_DAYS;
  if (!bucket || !rawDays) {
    throw new Error('AUDIT_LOG_GCS_BUCKET and AUDIT_LOG_GCS_RETENTION_DAYS are both required.');
  }
  const mode = env.AUDIT_LOG_GCS_RETENTION_MODE ?? 'unlocked';
  if (mode !== 'unlocked' && mode !== 'locked') {
    throw new Error(`AUDIT_LOG_GCS_RETENTION_MODE must be "unlocked" or "locked", got: ${mode}`);
  }
  const options = await gcsStorageOptionsFromEnv(env);
  const sdk = await import('@google-cloud/storage');
  const storage = new sdk.Storage(options);
  return new GcsObjectRetentionStorage(gcsClientFromStorage(storage as never), bucket, Number(rawDays), mode);
}
