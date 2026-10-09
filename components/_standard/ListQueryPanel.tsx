'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  countActiveFilters,
  cycleSort,
  filterChoices,
  setFilterValue,
  sortArrow,
  type ListFieldSpec,
  type ListQuerySpec,
  type ListQueryState,
} from '@/lib/_list_query';

/** How long typing in a text box waits before the list is queried. */
export const LIST_QUERY_DEBOUNCE_MS = 300;

interface ListQueryPanelProps {
  spec: ListQuerySpec;
  value: ListQueryState;
  onChange: (next: ListQueryState) => void;
}

const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

function sameFilters(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key] ?? '') !== (b[key] ?? '')) return false;
  }
  return true;
}

/**
 * The entity list's search box, multi-column sort and multi-field filter. The panel is the same
 * for every entity: what it offers comes from `spec`, and what the user has entered is
 * `ListQueryState` (lib/_list_query.ts), which the Expo list uses too. Typing is held back for
 * LIST_QUERY_DEBOUNCE_MS before it reaches `onChange`; every other change is passed at once.
 */
export default function ListQueryPanel({ spec, value, onChange }: ListQueryPanelProps) {
  const tc = useTranslations('Common');
  const [open, setOpen] = useState<'sort' | 'filter' | null>(null);
  const [search, setSearch] = useState(value.search);
  const [filters, setFilters] = useState(value.filters);

  // The latest props, for the debounce timer below.
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (search === valueRef.current.search && sameFilters(filters, valueRef.current.filters)) return;
    const timer = setTimeout(() => {
      onChangeRef.current({ ...valueRef.current, search, filters });
    }, LIST_QUERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, filters]);

  const fieldOf = (key: string): ListFieldSpec | undefined => spec.fields.find((f) => f.key === key);
  const labelOf = (key: string) => fieldOf(key)?.label ?? key;
  const activeFilters = countActiveFilters(filters);

  const setChoice = (key: string, choice: string) => {
    const next = setFilterValue(filters, key, choice);
    setFilters(next);
    onChange({ ...value, search, filters: next });
  };

  const primarySort = value.sort[0];
  const sortLabel = primarySort
    ? `${tc('sort')}: ${labelOf(primarySort.field)} ${sortArrow(primarySort.dir)}${value.sort.length > 1 ? ` +${value.sort.length - 1}` : ''}`
    : tc('sort');

  return (
    <Box data-testid="list-query-panel" sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {spec.searchKey ? (
          <TextField
            size="small"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tc('search')}
            sx={{ flex: '1 1 200px', minWidth: 160 }}
            slotProps={{ htmlInput: { 'aria-label': tc('search'), 'data-testid': 'list-search' } }}
          />
        ) : null}
        {spec.sortKeys.length > 0 ? (
          <Button
            size="small"
            variant={open === 'sort' ? 'contained' : 'outlined'}
            onClick={() => setOpen(open === 'sort' ? null : 'sort')}
            data-testid="list-sort-toggle"
          >
            {sortLabel}
          </Button>
        ) : null}
        {spec.filterKeys.length > 0 ? (
          <Button
            size="small"
            variant={open === 'filter' ? 'contained' : 'outlined'}
            onClick={() => setOpen(open === 'filter' ? null : 'filter')}
            data-testid="list-filter-toggle"
          >
            {activeFilters > 0 ? `${tc('filter')} (${activeFilters})` : tc('filter')}
          </Button>
        ) : null}
      </Box>

      {open === 'sort' ? (
        <Box data-testid="list-sort-panel" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {spec.sortKeys.map((key) => {
            const index = value.sort.findIndex((item) => item.field === key);
            const current = index >= 0 ? value.sort[index] : undefined;
            const order = current && value.sort.length > 1 ? ` ${index + 1}` : '';
            return (
              <Chip
                key={key}
                size="small"
                color={current ? 'primary' : 'default'}
                variant={current ? 'filled' : 'outlined'}
                label={`${labelOf(key)}${current ? ` ${sortArrow(current.dir)}${order}` : ''}`}
                onClick={() => onChange({ ...value, sort: cycleSort(value.sort, key, true) })}
                data-testid={`list-sort-${key}`}
              />
            );
          })}
          {value.sort.length > 0 ? (
            <Button size="small" onClick={() => onChange({ ...value, sort: [] })} data-testid="list-sort-clear">
              {tc('clear')}
            </Button>
          ) : null}
        </Box>
      ) : null}

      {open === 'filter' ? (
        <Box data-testid="list-filter-panel" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {spec.filterKeys.map((key) => {
            const field = fieldOf(key);
            if (!field) return null;
            const choices = filterChoices(field, yesNo);
            return (
              <Box key={key} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {field.label}
                </Typography>
                {choices ? (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {choices.map((choice) => {
                      const on = filters[key] === choice.value;
                      return (
                        <Chip
                          key={choice.value}
                          size="small"
                          color={on ? 'primary' : 'default'}
                          variant={on ? 'filled' : 'outlined'}
                          label={choice.label}
                          onClick={() => setChoice(key, on ? '' : choice.value)}
                          data-testid={`list-filter-${key}-${choice.value}`}
                        />
                      );
                    })}
                  </Box>
                ) : (
                  <TextField
                    size="small"
                    value={filters[key] ?? ''}
                    onChange={(event) => setFilters((prev) => setFilterValue(prev, key, event.target.value))}
                    slotProps={{
                      htmlInput: {
                        'aria-label': field.label,
                        'data-testid': `list-filter-${key}`,
                        inputMode: field.kind === 'number' ? 'numeric' : field.kind === 'decimal' ? 'decimal' : 'text',
                      },
                    }}
                  />
                )}
              </Box>
            );
          })}
          {activeFilters > 0 ? (
            <Box>
              <Button
                size="small"
                onClick={() => {
                  setFilters({});
                  onChange({ ...value, search, filters: {} });
                }}
                data-testid="list-filter-clear"
              >
                {tc('clear')}
              </Button>
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
