'use client';

import { useEffect, useReducer } from 'react';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import { useTranslations } from 'next-intl';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import DownloadIcon from '@mui/icons-material/Download';
import DashboardChart, { ChartDatum, ChartType, StackMode } from './DashboardChart';
import { aggregateForWidget, AggregateOutput, FilterCondition, BucketGranularity } from '@/lib/dashboard/aggregate';
import { findChartProblems, type WidgetProblem } from '@/lib/dashboard/widget-problem';
import { useProblemMessage } from '@/components/dashboard/widget-problem-message';

export type { FilterCondition };

export type WidgetConfig = {
  id: string;
  name: string;
  order: number;
  entity_name: string;
  chart_type: ChartType;
  group_by_field: string;
  // Legacy single-field filter (back-compat: treated as 'equals' condition).
  filter_field?: string | null;
  filter_value?: string | null;
  // New typed multi-condition filter (takes precedence over filter_field/filter_value).
  conditions?: FilterCondition[] | null;
  stack_mode?: StackMode | null;
  series_field?: string | null;        // required when stack_mode is set
  group_by_bucket?: BucketGranularity | null;
  // Timezone enum member (e.g. 'asia_tokyo'); only meaningful for a date-time group_by_field.
  timezone?: string | null;
};

// chart_type/stack_mode/group_by_bucket are Prisma nativeEnum columns (cmd_446 Class A) —
// the DB value already IS the label ('pie', 'grouped', 'week', ...), so these are just
// null-coalescing passthroughs, not index-to-label lookups.
function normalizeChartType(raw: ChartType): ChartType {
  return raw;
}

function normalizeStackMode(raw: StackMode | null | undefined): StackMode | undefined {
  return raw ?? undefined;
}

function normalizeBucketGranularity(raw: BucketGranularity | null | undefined): BucketGranularity | undefined {
  return raw ?? undefined;
}

// Download filtered+grouped data as a UTF-8 BOM CSV (Excel-compatible).
function exportToCSV(output: AggregateOutput, widgetName: string): void {
  let csvContent: string;
  if (output.kind === 'single') {
    const header = 'label,count';
    const rows = output.data.map(
      (d) => `"${d.label.replace(/"/g, '""')}",${d.count}`,
    );
    csvContent = [header, ...rows].join('\n');
  } else {
    const seriesCols = output.series
      .map((s) => `"${s.label.replace(/"/g, '""')}"`)
      .join(',');
    const header = `category,${seriesCols}`;
    const rows = output.categories.map((cat, i) => {
      const values = output.series.map((s) => s.data[i] ?? 0).join(',');
      return `"${cat.replace(/"/g, '""')}",${values}`;
    });
    csvContent = [header, ...rows].join('\n');
  }
  const bom = '﻿'; // UTF-8 BOM for Excel auto-detect
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${widgetName.replace(/[^a-z0-9]/gi, '_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const EMPTY_OUTPUT: AggregateOutput = { kind: 'single', data: [] };

// `problem` is why the chart cannot be drawn (a setting to fix); `failed` is an unexpected load failure.
type State = { output: AggregateOutput; problem: WidgetProblem | null; failed: boolean; loading: boolean };
type Action =
  | { type: 'start' }
  | { type: 'success'; output: AggregateOutput }
  | { type: 'problem'; problem: WidgetProblem }
  | { type: 'failed' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'start': return { output: state.output, problem: null, failed: false, loading: true };
    case 'success': return { output: action.output, problem: null, failed: false, loading: false };
    case 'problem': return { output: EMPTY_OUTPUT, problem: action.problem, failed: false, loading: false };
    case 'failed': return { output: EMPTY_OUTPUT, problem: null, failed: true, loading: false };
  }
}

// Stable string key for conditions[] used as useEffect dependency.
function conditionsKey(conditions: FilterCondition[] | null | undefined): string {
  return conditions && conditions.length > 0 ? JSON.stringify(conditions) : '';
}

export default function DashboardWidget({ widget }: { widget: WidgetConfig }) {
  const tz = useTranslations('Timezone');
  const tp = useTranslations('DashboardWidgetProblem');
  const problemMessage = useProblemMessage();
  const [{ output, problem, failed, loading }, dispatch] = useReducer(reducer, { output: EMPTY_OUTPUT, problem: null, failed: false, loading: true });

  // Settings that contradict each other are known without asking the server.
  const [configProblem] = findChartProblems(widget);
  const validationError = configProblem ?? null;
  const activeConditions = widget.conditions && widget.conditions.length > 0 ? widget.conditions : null;
  const condKey = conditionsKey(activeConditions);

  useEffect(() => {
    if (validationError) return;
    let cancelled = false;
    dispatch({ type: 'start' });
    // conditions[] takes precedence; fall back to legacy filter_field/filter_value.
    const legacyFilter = !activeConditions && widget.filter_field && widget.filter_value
      ? { field: widget.filter_field, value: widget.filter_value }
      : null;
    // series_field applies for stack_mode (bar/column) or group_by_bucket (line)
    const seriesField =
      (widget.group_by_bucket != null || widget.stack_mode != null) && widget.series_field
        ? widget.series_field
        : undefined;
    const groupByBucket = normalizeBucketGranularity(widget.group_by_bucket);
    aggregateForWidget(
      widget.entity_name,
      widget.group_by_field,
      legacyFilter,
      seriesField,
      activeConditions ?? undefined,
      groupByBucket,
      widget.timezone ?? undefined,
    )
      .then((result) => {
        if (cancelled) return;
        dispatch(result.ok ? { type: 'success', output: result.output } : { type: 'problem', problem: result.problem });
      })
      .catch(() => { if (!cancelled) dispatch({ type: 'failed' }); });
    return () => { cancelled = true; };
  }, [widget.entity_name, widget.group_by_field, widget.filter_field, widget.filter_value, widget.stack_mode, widget.series_field, widget.group_by_bucket, widget.timezone, validationError, condKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartType = normalizeChartType(widget.chart_type);
  const stackMode = normalizeStackMode(widget.stack_mode);

  function renderChart() {
    if (output.kind === 'multi') {
      if (chartType === 'line') {
        // Time series multi-series line chart (group_by_bucket + series_field)
        return <DashboardChart type="line" multiSeries={output} />;
      }
      if (stackMode && (chartType === 'column' || chartType === 'bar')) {
        return (
          <DashboardChart
            type={chartType}
            multiSeries={output}
            stackMode={stackMode}
          />
        );
      }
    }
    // Single-series fallback (also covers line without series_field)
    const singleData: ChartDatum[] = output.kind === 'single' ? output.data : [];
    return <DashboardChart type={chartType} data={singleData} />;
  }

  const hasData =
    !loading && !problem && !failed && !validationError &&
    (output.kind === 'single' ? output.data.length > 0 : output.categories.length > 0);

  return (
    <Card variant="outlined" sx={{ width: '100%' }}>
      <CardHeader
        title={widget.name}
        // A non-UTC zone is named in the subheader so the buckets are never ambiguous.
        subheader={`${widget.entity_name} grouped by ${widget.group_by_field}${!loading && !problem && !failed && output.timezone ? ` (${tz(output.timezone)})` : ''}`}
        titleTypographyProps={{ variant: 'subtitle1' }}
        subheaderTypographyProps={{ variant: 'caption' }}
        action={
          hasData ? (
            <Tooltip title="Export CSV">
              <IconButton size="small" onClick={() => exportToCSV(output, widget.name)} aria-label="export CSV">
                <DownloadIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : undefined
        }
      />
      <CardContent>
        {validationError ? (
          <Typography color="error" variant="caption">{problemMessage(validationError)}</Typography>
        ) : loading ? (
          <Skeleton variant="rectangular" height={240} />
        ) : problem ? (
          <Typography color="error" variant="caption">{problemMessage(problem)}</Typography>
        ) : failed ? (
          <Typography color="error" variant="caption">{tp('loadFailed')}</Typography>
        ) : !hasData ? (
          // Nothing matches: an answer, not an error.
          <Typography color="text.secondary" variant="caption">{tp('noMatchingData')}</Typography>
        ) : (
          renderChart()
        )}
      </CardContent>
    </Card>
  );
}
