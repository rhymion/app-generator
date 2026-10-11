// Applies prisma/sql/audit_log_append_only.sql to the database in DIRECT_URL / DATABASE_URL.
// Runs right after `prisma db push` in the test and setup scripts (db push does not
// run migration SQL). Set AUDIT_LOG_APP_ROLE to also apply the application-role
// grants for that role. Connect as the table owner. See docs/knowledge/audit-log-append-only.md.
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(path.resolve(process.cwd()), process.env.NODE_ENV !== 'production');
import { applyAuditLogSql } from '../lib/audit-log-integrity/apply-sql';
import { pinSslModeVerifyFull } from '../lib/db-url';

const rawConnectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!rawConnectionString) {
  throw new Error('DATABASE_URL is required. Set NODE_ENV=test for test defaults.');
}

applyAuditLogSql(pinSslModeVerifyFull(rawConnectionString), { appRole: process.env.AUDIT_LOG_APP_ROLE || undefined })
  .then(() => console.log('audit_log append-only SQL applied'))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
