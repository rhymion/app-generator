export type NormalizedSnapshot = Record<string, unknown>;

export function normalizeValue(value: unknown, kind: 'date' | 'number' | 'boolean' | 'string' | 'other') {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (kind === 'date') {
    const date = value instanceof Date ? value : new Date(value as string);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (kind === 'number') {
    const numberValue = Number(value);
    return Number.isNaN(numberValue) ? null : numberValue;
  }

  if (kind === 'boolean') {
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
    return Boolean(value);
  }

  if (kind === 'string') {
    return String(value);
  }

  return value;
}

export function normalizeChildRefs(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => (item && typeof item === 'object' ? (item as { id?: string }).id : undefined))
    .filter((id): id is string => Boolean(id))
    .sort();
}

export async function assertNotStale(
  srcSnapshotRaw: string,
  normalizeSnapshot: (snapshot: Record<string, unknown> | null | undefined) => NormalizedSnapshot,
  fetchCurrentSnapshot: () => Promise<NormalizedSnapshot | null>,
) {
  let expectedSnapshot: NormalizedSnapshot;
  try {
    expectedSnapshot = normalizeSnapshot(JSON.parse(srcSnapshotRaw) as Record<string, unknown>);
  } catch {
    throw new Error('Invalid snapshot data. Please reload and try again.');
  }

  const currentSnapshot = await fetchCurrentSnapshot();
  if (!currentSnapshot) {
    throw new Error('This record no longer exists.');
  }

  if (JSON.stringify(currentSnapshot) !== JSON.stringify(expectedSnapshot)) {
    throw new Error('This record has been updated since you opened it. Please reload to compare with the latest changes.');
  }
}
