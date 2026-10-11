/**
 * Applies prisma/sql/audit_log_append_only.sql (idempotent) and, when
 * `appRole` is given, prisma/sql/audit_log_app_role.sql for that role.
 *
 * `prisma db push` builds test and development databases without running any
 * migration SQL, so this runs right after it (npm run db:apply-audit-log-sql).
 * Consumers put the same SQL in their own migrations instead. Connect as the
 * table owner.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const SQL_DIR = path.resolve(process.cwd(), 'prisma/sql');

export async function applyAuditLogSql(connectionString: string, options: { appRole?: string } = {}): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(await readFile(path.join(SQL_DIR, 'audit_log_append_only.sql'), 'utf8'));
    if (options.appRole) {
      const template = await readFile(path.join(SQL_DIR, 'audit_log_app_role.sql'), 'utf8');
      // The template is written for psql's :"app_role"; substitute the quoted identifier.
      await client.query(template.replace(/:"app_role"/g, client.escapeIdentifier(options.appRole)));
    }
  } finally {
    await client.end();
  }
}
