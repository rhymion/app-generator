// lib/user/virtual_resolvers.ts (手動 custom — generate-code で上書きされない)
export async function resolveVirtualColumns(
  rows: ReadonlyArray<Record<string, unknown>>
): Promise<Map<string, Record<string, string>>> {
  return new Map(
    rows.map(row => {
      const id = String(row['id'] ?? '');
      return [id, { additional_info: `INFO-${id}` }];
    })
  );
}
