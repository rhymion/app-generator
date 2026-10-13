'use client';

// x-version-of: version list and two-version diff. Mounted by the generated
// components/<identity>/VersionHistory.tsx, which supplies the entity-specific
// reads and the per-field renderer (the detail screen's own markup).
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import {
  diffChildRows, fieldChanged, wordDiff,
  type ChildSpec, type Row,
} from '@/lib/_version_diff';

const LONG_TEXT = 80;

export type { ChildSpec };

export type VersionHistoryPanelProps = {
  identityId: string;
  numberField: string;
  fields: string[];
  childSpecs: ChildSpec[];
  getHistory: (identityId: string) => Promise<{ rows: Row[]; currentVersionId: string | null }>;
  getDiff: (identityId: string, leftId: string, rightId: string) => Promise<{ left: Row; right: Row }>;
  renderField: (row: Row, field: string) => ReactNode;
};

function show(value: unknown): string {
  if (value == null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export default function VersionHistoryPanel({
  identityId, numberField, fields, childSpecs, getHistory, getDiff, renderField,
}: VersionHistoryPanelProps) {
  const t = useTranslations('VersionHistory');
  const tf = useTranslations('Fields');
  const compareParam = useSearchParams().get('compare');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [diff, setDiff] = useState<{ left: Row; right: Row } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHistory(identityId)
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
        setCurrentId(res.currentVersionId);
        const draft = res.rows.find((r) => r[numberField] == null);
        const target = res.rows.find((r) => r.id === compareParam) ?? draft ?? res.rows[0];
        const base = res.rows.find((r) => r.id === res.currentVersionId && r.id !== target?.id)
          ?? res.rows.find((r) => r.id !== target?.id);
        if (target && base) {
          setLeftId(String(base.id));
          setRightId(String(target.id));
        }
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [identityId, numberField, compareParam, getHistory]);

  useEffect(() => {
    if (!leftId || !rightId || leftId === rightId) return;
    let cancelled = false;
    getDiff(identityId, leftId, rightId)
      .then((res) => { if (!cancelled) { setDiff(res); setFailed(false); } })
      .catch(() => { if (!cancelled) { setFailed(true); } });
    return () => { cancelled = true; };
  }, [identityId, leftId, rightId, getDiff]);

  const error = failed ? t('loadError') : null;
  const activeDiff = leftId && rightId && leftId !== rightId ? diff : null;
  const label = (r: Row) => (r[numberField] == null ? t('draft') : t('versionLabel', { number: String(r[numberField]) }));
  const statusOf = (r: Row) => (r[numberField] == null ? t('draft') : r.id === currentId ? t('current') : t('superseded'));

  const childDiffs = useMemo(() => {
    if (!activeDiff) return [];
    return childSpecs.map((spec) => ({
      spec,
      rows: diffChildRows(
        (activeDiff.left[spec.property_name] as Row[] | undefined) ?? [],
        (activeDiff.right[spec.property_name] as Row[] | undefined) ?? [],
        spec,
      ),
    }));
  }, [activeDiff, childSpecs]);

  if (rows == null && !error) return null;
  if (rows == null) {
    return <Typography color="error" role="alert" data-testid="version-history-error">{error}</Typography>;
  }
  if (rows.length === 0) return null;

  return (
    <Box sx={{ mt: 3 }} data-testid="version-history">
      <Typography variant="h6">{t('title')}</Typography>
      {error && <Typography color="error" role="alert">{error}</Typography>}
      <Table size="small" data-testid="version-history-list">
        <TableHead>
          <TableRow>
            <TableCell>{t('number')}</TableCell>
            <TableCell>{t('status')}</TableCell>
            <TableCell>{t('created')}</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={String(r.id)} data-testid={`version-row-${String(r.id)}`}>
              <TableCell>{label(r)}</TableCell>
              <TableCell>{statusOf(r)}</TableCell>
              <TableCell>{show(r.created_at).slice(0, 10)}</TableCell>
              <TableCell>
                <Button size="small" onClick={() => { setRightId(String(r.id)); if (leftId === String(r.id)) setLeftId(''); }}>
                  {t('compare')}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
        {([['left', leftId, setLeftId], ['right', rightId, setRightId]] as const).map(([side, value, set]) => (
          <FormControl key={side} size="small" sx={{ minWidth: 200 }}>
            <InputLabel>{t(side === 'left' ? 'compareFrom' : 'compareTo')}</InputLabel>
            <Select
              label={t(side === 'left' ? 'compareFrom' : 'compareTo')}
              value={value}
              onChange={(e) => set(String(e.target.value))}
              inputProps={{ 'data-testid': `version-select-${side}` }}
            >
              {rows.map((r) => <MenuItem key={String(r.id)} value={String(r.id)}>{label(r)}</MenuItem>)}
            </Select>
          </FormControl>
        ))}
      </Box>

      {activeDiff && (
        <Box sx={{ mt: 2 }} data-testid="version-diff">
          <Typography variant="subtitle1">{t('diffTitle')}</Typography>
          {fields.map((f) => {
            const changed = fieldChanged(activeDiff.left, activeDiff.right, f);
            const l = activeDiff.left[f];
            const r = activeDiff.right[f];
            const longText = changed && typeof l === 'string' && typeof r === 'string' && (l.length > LONG_TEXT || r.length > LONG_TEXT);
            return (
              <Box key={f} data-testid={`diff-field-${f}`} data-changed={changed ? 'true' : 'false'}
                sx={{ borderLeft: 3, borderColor: changed ? 'warning.main' : 'transparent', pl: 1, mb: 1 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <Box>{renderField(activeDiff.left, f)}</Box>
                  <Box>{renderField(activeDiff.right, f)}</Box>
                </Box>
                {longText && (
                  <Typography component="div" variant="body2" data-testid={`diff-words-${f}`}>
                    {wordDiff(l as string, r as string).map((p, i) => (
                      <span key={i} data-kind={p.kind}
                        style={p.kind === 'added' ? { background: 'rgba(46,160,67,.3)' } : p.kind === 'removed' ? { background: 'rgba(248,81,73,.3)', textDecoration: 'line-through' } : undefined}>
                        {p.text}
                      </span>
                    ))}
                  </Typography>
                )}
              </Box>
            );
          })}
          {childDiffs.map(({ spec, rows: cRows }) => (
            <Box key={spec.property_name} sx={{ mt: 2 }} data-testid={`diff-children-${spec.property_name}`}>
              <Typography variant="subtitle2">{tf(spec.title_key)}</Typography>
              {spec.match === 'none' && (cRows.length > 0) && (
                <Typography variant="caption" data-testid="diff-rows-unmatched">{t('rowsUnmatchedNotice')}</Typography>
              )}
              {cRows.map((c, i) => (
                <Box key={i} data-status={c.status} sx={{ display: 'grid', gridTemplateColumns: '6rem 1fr 1fr', gap: 2 }}>
                  <Typography variant="caption">{t(c.status)}</Typography>
                  <Typography variant="body2">{c.left ? spec.fields.map((f) => show(c.left?.[f])).join(' / ') : ''}</Typography>
                  <Typography variant="body2">{c.right ? spec.fields.map((f) => show(c.right?.[f])).join(' / ') : ''}</Typography>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
