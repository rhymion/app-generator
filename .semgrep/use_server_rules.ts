'use server';
// Test cases for .semgrep/use_server_rules.yml, checked with `semgrep --test .semgrep`.
declare const prisma: any;
declare function getSessionUserIdOrThrow(): Promise<string>;
declare function requireEntityPermission(...args: unknown[]): Promise<unknown>;
declare function requireMfaSetupUserId(): Promise<string>;

// ruleid: server-action-writes-without-authorization
export async function unprotectedWrite(id: string) {
  await prisma.ticket.delete({ where: { id } });
}

export async function sessionChecked(id: string) {
  const userId = await getSessionUserIdOrThrow();
  // ok: server-action-writes-without-authorization
  await prisma.ticket.update({ where: { id }, data: { owner_id: userId } });
}

export async function permissionChecked(id: string) {
  await requireEntityPermission('ticket', 'create');
  // ok: server-action-writes-without-authorization
  await prisma.ticket.create({ data: { id } });
}

// The MFA settings page's own session accessor (Issue #1281) authorizes the caller too.
export async function mfaSetupChecked() {
  const userId = await requireMfaSetupUserId();
  // ok: server-action-writes-without-authorization
  await prisma.user.update({ where: { id: userId }, data: { mfa_secret: null } });
}

export async function readOnly(id: string) {
  // ok: server-action-writes-without-authorization
  return prisma.ticket.findUnique({ where: { id } });
}
