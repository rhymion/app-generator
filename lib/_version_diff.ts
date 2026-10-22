// Pure helpers for the x-version-of two-version diff (components/_standard/VersionHistoryPanel.tsx).

export type ChildSpec = {
  property_name: string;
  fields: string[];
  /** How rows are paired across versions: by natural key, by position under `order`, or not at all. */
  match: 'key' | 'order' | 'none';
  key_fields: string[];
  /** Fields-namespace key of the child's section heading. */
  title_key: string;
};

export type Row = Record<string, unknown>;

export type ChildRowDiff = {
  status: 'unchanged' | 'changed' | 'added' | 'removed';
  left?: Row;
  right?: Row;
  changedFields: string[];
};

export type WordPart = { text: string; kind: 'same' | 'added' | 'removed' };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** True when a field's value differs between the two rows (null and undefined count as equal). */
export function fieldChanged(left: Row, right: Row, field: string): boolean {
  return !same(left[field], right[field]);
}

/** Word-level diff (LCS over whitespace-separated tokens). */
export function wordDiff(before: string, after: string): WordPart[] {
  const a = before.split(/(\s+)/).filter((t) => t !== '');
  const b = after.split(/(\s+)/).filter((t) => t !== '');
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const parts: WordPart[] = [];
  const push = (text: string, kind: WordPart['kind']) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(a[i], 'same');
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push(a[i++], 'removed');
    } else {
      push(b[j++], 'added');
    }
  }
  while (i < a.length) push(a[i++], 'removed');
  while (j < b.length) push(b[j++], 'added');
  return parts;
}

function keyOf(row: Row, keyFields: string[]): string {
  return JSON.stringify(keyFields.map((f) => row[f] ?? null));
}

function byOrder(rows: Row[]): Row[] {
  return [...rows].sort((x, y) => Number(x.order ?? 0) - Number(y.order ?? 0));
}

function changedBetween(left: Row, right: Row, fields: string[]): string[] {
  return fields.filter((f) => fieldChanged(left, right, f));
}

/**
 * Pair the owned child rows of two versions. Without a natural key or an
 * `order` column no pairing is invented: every left row is removed and every
 * right row added.
 */
export function diffChildRows(leftRows: Row[], rightRows: Row[], spec: ChildSpec): ChildRowDiff[] {
  const out: ChildRowDiff[] = [];
  const pair = (left: Row, right: Row) => {
    const changedFields = changedBetween(left, right, spec.fields);
    out.push({ status: changedFields.length ? 'changed' : 'unchanged', left, right, changedFields });
  };
  if (spec.match === 'key' && spec.key_fields.length) {
    const rightByKey = new Map(rightRows.map((r) => [keyOf(r, spec.key_fields), r]));
    const used = new Set<string>();
    for (const left of leftRows) {
      const k = keyOf(left, spec.key_fields);
      const right = rightByKey.get(k);
      if (right) {
        used.add(k);
        pair(left, right);
      } else {
        out.push({ status: 'removed', left, changedFields: [] });
      }
    }
    for (const right of rightRows) {
      if (!used.has(keyOf(right, spec.key_fields))) out.push({ status: 'added', right, changedFields: [] });
    }
    return out;
  }
  if (spec.match === 'order') {
    const l = byOrder(leftRows);
    const r = byOrder(rightRows);
    for (let i = 0; i < Math.max(l.length, r.length); i++) {
      if (l[i] && r[i]) pair(l[i], r[i]);
      else if (l[i]) out.push({ status: 'removed', left: l[i], changedFields: [] });
      else out.push({ status: 'added', right: r[i], changedFields: [] });
    }
    return out;
  }
  for (const left of leftRows) out.push({ status: 'removed', left, changedFields: [] });
  for (const right of rightRows) out.push({ status: 'added', right, changedFields: [] });
  return out;
}
