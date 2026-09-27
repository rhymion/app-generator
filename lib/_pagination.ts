export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export type SortItem = { field: string; dir: 'asc' | 'desc' };
export type FilterValue = string | number | boolean | null;
export type FilterMap = Record<string, FilterValue>;

/**
 * Per-column clause-shape kind for buildFilter (app-generator#753). A plain
 * `contains` filter (the pre-existing default) crashes against Prisma's
 * native enum / DateTime / Decimal columns, so callers pass this map to pick
 * the correct clause shape per column.
 */
export type ColumnFilterKind = 'string' | 'enum' | 'boolean' | 'number' | 'decimal' | 'date';

/** relation display name -> the target column its FK label is derived from. */
export type RelationFilterMap = Record<string, { field: string }>;

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
 * field names; entries outside the allow-list (and not a key of `relations`)
 * are silently dropped to avoid accepting arbitrary column names from
 * external input. A field that is a key of `relations` (an FK display column
 * with a simple labelField, app-generator#753) sorts by the related row's
 * labelField column via a nested one-hop orderBy.
 */
export function buildOrderBy(
  sort: SortItem[] | undefined,
  allowed: ReadonlySet<string>,
  relations: RelationFilterMap = {},
): Record<string, unknown>[] {
  if (!sort?.length) return [{ id: 'asc' }];
  const out = sort
    .filter(s => allowed.has(s.field) || s.field in relations)
    .map(s => {
      const dir = s.dir === 'desc' ? ('desc' as const) : ('asc' as const);
      const rel = relations[s.field];
      return rel ? { [s.field]: { [rel.field]: dir } } : { [s.field]: dir };
    });
  return out.length > 0 ? out : [{ id: 'asc' }];
}

/**
 * Build a Prisma `AND` clause list from filter items. Fields outside the
 * allow-list (and not a key of `relations`) are dropped. `kinds` (app-
 * generator#753) picks the Prisma clause shape per column -- a plain
 * `contains` (the pre-existing default, still used for 'string' and for any
 * column absent from `kinds`) crashes against a native enum/DateTime/Decimal
 * column. A field that is a key of `relations` (an FK display column with a
 * simple labelField) filters by the related row's labelField column via a
 * nested one-hop `contains`, independent of `allowed`/`kinds` (relation
 * columns were never eligible for the flat allow-list).
 */
export function buildFilter(
  filter: FilterMap | undefined,
  allowed: ReadonlySet<string>,
  kinds: Record<string, ColumnFilterKind> = {},
  relations: RelationFilterMap = {},
): Record<string, unknown>[] {
  if (!filter) return [];
  const clauses: Record<string, unknown>[] = [];
  for (const [field, value] of Object.entries(filter)) {
    if (value === null || value === undefined || value === '') continue;
    const rel = relations[field];
    if (rel) {
      clauses.push({ [field]: { [rel.field]: { contains: String(value), mode: 'insensitive' } } });
      continue;
    }
    if (!allowed.has(field)) continue;
    switch (kinds[field] ?? 'string') {
      case 'enum':
      case 'boolean':
      case 'decimal':
        // Exact match: Prisma nativeEnum/Decimal filters don't support
        // `contains`, and coercing a Decimal through Number() risks
        // precision loss on money-scale values.
        clauses.push({ [field]: value });
        break;
      case 'number': {
        const n = Number(value);
        if (!Number.isNaN(n)) clauses.push({ [field]: n });
        break;
      }
      case 'date': {
        const d = new Date(value as string | number);
        if (!Number.isNaN(d.getTime())) clauses.push({ [field]: d });
        break;
      }
      case 'string':
      default:
        if (typeof value === 'string') {
          clauses.push({ [field]: { contains: value, mode: 'insensitive' } });
        } else {
          clauses.push({ [field]: value });
        }
        break;
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
