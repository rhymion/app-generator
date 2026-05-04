export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export type SortItem = { field: string; dir: 'asc' | 'desc' };
export type FilterValue = string | number | boolean | null;
export type FilterMap = Record<string, FilterValue>;

export type PageOpts = {
  page?: number;
  pageSize?: number;
  sort?: SortItem[];
  filter?: FilterMap;
};

export type PageResult<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

export function clampPage(opts: PageOpts | undefined): {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
} {
  const page = Math.max(0, Math.floor(opts?.page ?? 0));
  const raw = opts?.pageSize ?? DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(raw)));
  return { page, pageSize, skip: page * pageSize, take: pageSize };
}

/**
 * Build a Prisma orderBy[] from sort items. Caller passes the allow-list of
 * field names; entries outside the allow-list are silently dropped to avoid
 * accepting arbitrary column names from external input.
 */
export function buildOrderBy(
  sort: SortItem[] | undefined,
  allowed: ReadonlySet<string>,
): Record<string, 'asc' | 'desc'>[] {
  if (!sort?.length) return [{ id: 'asc' }];
  const out = sort
    .filter(s => allowed.has(s.field))
    .map(s => ({ [s.field]: s.dir === 'desc' ? ('desc' as const) : ('asc' as const) }));
  return out.length > 0 ? out : [{ id: 'asc' }];
}

/**
 * Build a Prisma `AND` clause list from filter items. Strings use
 * case-insensitive `contains`; primitives use equality. Fields outside the
 * allow-list are dropped.
 */
export function buildFilter(
  filter: FilterMap | undefined,
  allowed: ReadonlySet<string>,
): Record<string, unknown>[] {
  if (!filter) return [];
  const clauses: Record<string, unknown>[] = [];
  for (const [field, value] of Object.entries(filter)) {
    if (!allowed.has(field)) continue;
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'string') {
      clauses.push({ [field]: { contains: value, mode: 'insensitive' } });
    } else {
      clauses.push({ [field]: value });
    }
  }
  return clauses;
}

/** Parse PageOpts from URL searchParams (used by route handlers). */
export function parsePageOpts(searchParams: URLSearchParams): PageOpts {
  const pageRaw = Number(searchParams.get('page') ?? 0);
  const pageSizeRaw = Number(searchParams.get('pageSize') ?? DEFAULT_PAGE_SIZE);
  const page = Number.isFinite(pageRaw) ? pageRaw : 0;
  const pageSize = Number.isFinite(pageSizeRaw) ? pageSizeRaw : DEFAULT_PAGE_SIZE;

  const sortRaw = searchParams.get('sort');
  const sort: SortItem[] = sortRaw
    ? sortRaw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => {
          const [field, dir] = s.split(':');
          return { field, dir: dir === 'desc' ? 'desc' : 'asc' } as SortItem;
        })
    : [];

  const filter: FilterMap = {};
  for (const [k, v] of searchParams.entries()) {
    if (k.startsWith('f.')) filter[k.slice(2)] = v;
  }

  return { page, pageSize, sort, filter };
}
