// Virtual-column resolver of vo_page, the identity whose primary column (title) is not stored on
// the identity: it is read from the version the identity's current_version_id points to.
// The gate script copies this file to lib/vo_page/virtual_resolvers.ts of its disposable build
// copy before generate-code, so the write-once stub is not written over it.
import prisma from '@/lib/prisma';

export async function resolveVirtualColumns(
  rows: ReadonlyArray<Record<string, unknown>>
): Promise<Map<string, Record<string, string>>> {
  const versionIds = rows.map((row) => row['current_version_id']).filter((id): id is string => typeof id === 'string');
  const versions = await prisma.vo_page_version.findMany({
    where: { id: { in: versionIds } },
    select: { id: true, title: true },
  });
  const titleById = new Map(versions.map((v) => [v.id, v.title]));
  return new Map(
    rows.map((row): [string, Record<string, string>] => {
      const versionId = row['current_version_id'];
      const title = typeof versionId === 'string' ? titleById.get(versionId) : undefined;
      return [String(row['id'] ?? ''), title === undefined ? {} : { title }];
    })
  );
}
