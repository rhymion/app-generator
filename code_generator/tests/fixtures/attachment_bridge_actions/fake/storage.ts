// Records which stored objects the action asked to remove.
export const deletedKeys: string[] = [];
export function isStorageKey(key: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key);
}
export async function deleteStoredObject(key: string): Promise<void> {
  deletedKeys.push(key);
}
