// The caller may update the owner `resource_a1` only; every other owner is denied.
export type RichPermissions = { update: boolean };
export const ALLOWED_OWNER_ID = 'resource_a1';
export async function getSessionUserIdOrThrow(): Promise<string> {
  return 'user_a';
}
export async function getModelPermissions(_model: string, _userId: string) {
  return { permissions: { update: true } as RichPermissions };
}
export async function resolveRecordPermissions(
  _base: RichPermissions,
  owner: { id: string },
  _userId: string,
) {
  return { update: owner.id === ALLOWED_OWNER_ID };
}
