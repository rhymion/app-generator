// Test cases for .semgrep/rules.yml, checked with `semgrep --test .semgrep`.
declare const db: any;
declare const id: string;

// ruleid: prisma-unsafe-raw-query
db.$queryRawUnsafe(`SELECT * FROM t WHERE id = '${id}'`);
// ruleid: prisma-unsafe-raw-query
db.$executeRawUnsafe(`DELETE FROM t WHERE id = '${id}'`);
// ok: prisma-unsafe-raw-query
db.$queryRaw`SELECT * FROM t WHERE id = ${id}`;

// ruleid: dynamic-code-evaluation
eval(id);
// ruleid: dynamic-code-evaluation
new Function(id);
// ok: dynamic-code-evaluation
JSON.parse(id);

declare function requireEntityPermission(...args: unknown[]): Promise<unknown>;
declare function requireRecordPermission(...args: unknown[]): Promise<unknown>;
declare function canAccessEntity(...args: unknown[]): Promise<boolean>;
declare function canAccessRecord(...args: unknown[]): Promise<boolean>;
declare function resolveRecordPermissions(...args: unknown[]): Promise<{ delete: boolean }>;
declare const record: unknown;
declare const logger: any;
declare const req: any;
declare const apiKey: string;
declare const cronSecret: string;
declare const header: string;
declare function secretsEqual(a: string, b: string): boolean;

async function entityOnlyUpdate() {
  // ruleid: entity-only-permission-check-for-record-operation
  await requireEntityPermission('ticket', 'update', 'u1');
}
async function entityOnlyDelete() {
  // ruleid: entity-only-permission-check-for-record-operation
  return canAccessEntity('ticket', 'delete', 'u1');
}
async function recordAwareUpdate() {
  // ok: entity-only-permission-check-for-record-operation
  await requireEntityPermission('ticket', 'update', 'u1');
  await requireRecordPermission('ticket', 'update', record, 'u1');
}
async function recordAwareDelete() {
  // ok: entity-only-permission-check-for-record-operation
  if (!(await canAccessEntity('ticket', 'delete', 'u1'))) return;
  await canAccessRecord('ticket', 'delete', record, 'u1');
}
async function resolvedRecordDelete() {
  // ok: entity-only-permission-check-for-record-operation
  const base = await requireEntityPermission('ticket', 'delete', 'u1') as never;
  const resolved = await resolveRecordPermissions(base, record, 'u1');
  return resolved.delete;
}
async function entityOnlyRead() {
  // ok: entity-only-permission-check-for-record-operation
  await requireEntityPermission('ticket', 'read', 'u1');
}

// ruleid: public-object-storage-access
const publicBlob = { access: 'public', pathname: 'a.png' };
// ruleid: public-object-storage-access
const publicAcl = { Bucket: 'b', ACL: 'public-read' };
// ruleid: public-object-storage-access
const everyone = { entity: 'allUsers', role: 'READER' };
// ok: public-object-storage-access
const privateBlob = { access: 'private', pathname: 'a.png' };

// ruleid: secret-compared-with-equality-operator
const bad1 = apiKey === header;
// ruleid: secret-compared-with-equality-operator
const bad2 = cronSecret !== header;
// ok: secret-compared-with-equality-operator
const ok1 = secretsEqual(cronSecret, header);
// ok: secret-compared-with-equality-operator
const ok2 = apiKey === undefined;
// ok: secret-compared-with-equality-operator
const ok3 = header === 'x';

// ruleid: request-body-or-headers-logged
logger.info('request', req.headers);
// ruleid: request-body-or-headers-logged
logger.error('bad request', await req.json());
// ok: request-body-or-headers-logged
logger.info('request', req.method, req.url);
