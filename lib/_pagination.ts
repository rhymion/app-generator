export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export type SortItem = { field: string; dir: 'asc' | 'desc' };
export type FilterValue = string | number | boolean | null;
/**
 * A filter entry is either a bare scalar (REST callers via parsePageOpts --
 * URL query params have no notion of a MUI filter operator, so "no operator
 * given, use this kind's default clause" is implied) or an
 * `{ operator, value }` pair (DataGridClient.tsx's reload(), which forwards
 * the MUI filter panel's actual operator -- `is`/`isAnyOf`/`after`/etc,
 * app-generator#756). `value` is an array only for `isAnyOf`.
 */
export type FilterEntry =
  | FilterValue
  | { operator: string; value: FilterValue | FilterValue[] };
export type FilterMap = Record<string, FilterEntry>;

/**
 * Per-column clause-shape kind for buildFilter (app-generator#753). A plain
 * `contains` filter (the pre-existing default) crashes against Prisma's
 * native enum / DateTime / Decimal columns, so callers pass this map to pick
 * the correct clause shape per column.
 */
export type ColumnFilterKind = 'string' | 'enum' | 'boolean' | 'number' | 'decimal' | 'date';

/** relation display name -> the target column its FK label is derived from. */
export type RelationFilterMap = Record<string, { field: string }>;

/**
 * Valid raw enum literal list per 'enum'-kind column (app-generator#756
 * Finding 3). buildFilter validates an incoming is/isAnyOf value against
 * this before building the Prisma clause -- a value that isn't a real
 * member of the enum type (e.g. the column's own translated display label,
 * which is what a real user actually sees and types) crashes Prisma rather
 * than returning zero rows.
 */
export type EnumMembersMap = Record<string, string[]>;

/**
 * Decimal scale per 'decimal'-kind column (app-generator#756). A
 * GridColDef.type: 'number' filter's native `<input type="number">`
 * round-trips a typed value through the browser's own IEEE-754 double
 * before it ever reaches buildFilter (e.g. '99.99' -> a value that prints
 * as 99.99 but is actually 99.98999999999999488...) -- confirmed
 * empirically via real Cypress UI interaction (subtask_1193a) to silently
 * break exact-match filtering against a column whose stored value is
 * exact. buildFilter re-quantizes a JS-number-typed decimal filter value
 * with this scale (toFixed) before building the Prisma clause, recovering
 * the precision the browser's number input lost. A string value (a REST
 * caller via parsePageOpts, or any caller that never went through that
 * native number input) is untouched -- this only ever corrects a value
 * that arrived as a JS number.
 */
export type DecimalScalesMap = Record<string, number>;

function normalizeFilterEntry(raw: FilterEntry): { operator?: string; value: FilterValue | FilterValue[] } {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return { operator: raw.operator, value: raw.value };
  }
  return { value: raw };
}

function isEmptyFilterValue(value: FilterValue | FilterValue[]): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return value === null || value === undefined || value === '';
}

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
 * Build the Prisma clause value for one column, given its kind and the
 * (already-normalized) operator/value pair. Returns `undefined` when the
 * value can't be interpreted for this kind (unparseable date, non-numeric
 * number, enum value that isn't a real member, etc) -- the caller drops the
 * whole clause for that field rather than crashing (app-generator#753/#756).
 */
function buildClauseForKind(
  kind: ColumnFilterKind,
  operator: string | undefined,
  value: FilterValue | FilterValue[],
  members: string[] | undefined,
  decimalScale: number | undefined,
): unknown {
  switch (kind) {
    case 'enum': {
      if (operator === 'isAnyOf') {
        const arr = (Array.isArray(value) ? value : [value]).map(String);
        const validated = members ? arr.filter(v => members.includes(v)) : arr;
        return validated.length > 0 ? { in: validated } : undefined;
      }
      const v = String(Array.isArray(value) ? value[0] : value);
      if (members && !members.includes(v)) return undefined;
      return operator === 'not' ? { not: { equals: v } } : v;
    }
    case 'boolean': {
      const v = Array.isArray(value) ? value[0] : value;
      // Coerce defensively: a real user's only input surface for this
      // column (absent a wired GridColDef.type: 'boolean') is a plain text
      // filter box, so the raw string 'true'/'false' is what actually
      // arrives (app-generator#756 Finding 2).
      return v === true || v === 'true';
    }
    case 'decimal': {
      let v = Array.isArray(value) ? value[0] : value;
      if (v === null || v === undefined || v === '') return undefined;
      // A value that arrived as a JS number (the GridColDef.type: 'number'
      // filter's native number input) has already round-tripped through an
      // imprecise IEEE-754 double by the time it gets here -- re-quantize
      // to the column's real scale before it reaches Prisma. A string
      // value (REST caller, or any path that never went through that
      // input) is untouched -- Prisma's Decimal filter accepts a numeric
      // string directly for every comparison operator, and round-tripping
      // an already-precise string through Number() would only reintroduce
      // the exact loss this branch exists to avoid.
      if (typeof v === 'number' && decimalScale !== undefined) {
        v = v.toFixed(decimalScale);
      }
      switch (operator) {
        case '!=': return { not: { equals: v } };
        case '>': return { gt: v };
        case '>=': return { gte: v };
        case '<': return { lt: v };
        case '<=': return { lte: v };
        default: return v;
      }
    }
    case 'number': {
      const v = Array.isArray(value) ? value[0] : value;
      const n = Number(v);
      if (Number.isNaN(n)) return undefined;
      switch (operator) {
        case '!=': return { not: { equals: n } };
        case '>': return { gt: n };
        case '>=': return { gte: n };
        case '<': return { lt: n };
        case '<=': return { lte: n };
        default: return n;
      }
    }
    case 'date': {
      const v = Array.isArray(value) ? value[0] : value;
      const d = new Date(v as string | number);
      if (Number.isNaN(d.getTime())) return undefined;
      switch (operator) {
        case 'not': return { not: { equals: d } };
        case 'after': return { gt: d };
        case 'onOrAfter': return { gte: d };
        case 'before': return { lt: d };
        case 'onOrBefore': return { lte: d };
        default: return d;
      }
    }
    case 'string':
    default: {
      if (operator === 'isAnyOf') {
        const arr = (Array.isArray(value) ? value : [value]).map(String);
        return arr.length > 0 ? { in: arr } : undefined;
      }
      const v = Array.isArray(value) ? value[0] : value;
      if (typeof v !== 'string') return v;
      switch (operator) {
        case 'equals': return { equals: v, mode: 'insensitive' };
        case 'startsWith': return { startsWith: v, mode: 'insensitive' };
        case 'endsWith': return { endsWith: v, mode: 'insensitive' };
        default: return { contains: v, mode: 'insensitive' };
      }
    }
  }
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
 * columns were never eligible for the flat allow-list) -- the MUI filter
 * operator is ignored for this case, as before.
 *
 * `enumMembers` (app-generator#756) validates an 'enum'-kind field's
 * incoming value(s) against the column's real raw-literal members before
 * building the clause. `decimalScales` (app-generator#756) re-quantizes a
 * 'decimal'-kind field's incoming value when it arrived as an imprecise
 * JS number (see DecimalScalesMap's own doc comment). Every param beyond
 * `allowed` defaults to `{}`, so a caller that still uses the old 2-arg
 * form (audit_log/getters.ts -- the one built-in-entity getters.ts that is
 * genuinely hand-maintained, not generator-produced; verified directly,
 * subtask_1193a -- #755's design doc's "8 hand-maintained" count for this
 * built-in-entity set was inaccurate, the other 7 (dashboard/permission/
 * user/role/setting/organization/approval_flow) are template-generated
 * and already receive FIELD_KINDS/RELATION_FILTER_FIELDS/ENUM_MEMBERS/
 * DECIMAL_SCALES like any other entity) is unaffected: with no `kinds`
 * entry for any field, every column falls through to the 'string' default
 * clause exactly as before this change.
 */
export function buildFilter(
  filter: FilterMap | undefined,
  allowed: ReadonlySet<string>,
  kinds: Record<string, ColumnFilterKind> = {},
  relations: RelationFilterMap = {},
  enumMembers: EnumMembersMap = {},
  decimalScales: DecimalScalesMap = {},
): Record<string, unknown>[] {
  if (!filter) return [];
  const clauses: Record<string, unknown>[] = [];
  for (const [field, raw] of Object.entries(filter)) {
    const { operator, value } = normalizeFilterEntry(raw);
    if (isEmptyFilterValue(value)) continue;
    const rel = relations[field];
    if (rel) {
      const relValue = Array.isArray(value) ? value[0] : value;
      clauses.push({ [field]: { [rel.field]: { contains: String(relValue), mode: 'insensitive' } } });
      continue;
    }
    if (!allowed.has(field)) continue;
    const kind = kinds[field] ?? 'string';
    const clauseValue = buildClauseForKind(kind, operator, value, enumMembers[field], decimalScales[field]);
    if (clauseValue !== undefined) clauses.push({ [field]: clauseValue });
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
