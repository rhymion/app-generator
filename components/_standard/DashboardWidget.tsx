'use client';

import { useEffect, useReducer } from 'react';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import DownloadIcon from '@mui/icons-material/Download';
import DashboardChart, { ChartDatum, ChartType, StackMode } from './DashboardChart';
import { aggregateForWidget, AggregateOutput, FilterCondition, BucketGranularity } from '@/lib/dashboard/aggregate';

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
  stack_mode?: StackMode | null;       // optional; requires series_field when set
  series_field?: string | null;        // required when stack_mode is set
  // Phase 4: timestamp bucketing — group_by_field must be datetime when set.
  // Also enables the 'line' chart type.
  group_by_bucket?: BucketGranularity | null;
};

// Validation: config consistency checks.
function validateConfig(config: WidgetConfig): string | null {
  if (config.stack_mode && !config.series_field) {
    return `stack_mode '${config.stack_mode}' requires series_field to be set`;
  }
  if (config.chart_type === 'line' && !config.group_by_bucket) {
    return `chart_type 'line' requires group_by_bucket to be set`;
  }
  return null;
}

// Read legacy numeric chart_type from JSON config: 0 → pie, 1 → column
function resolveChartType(raw: unknown): ChartType {
  if (raw === 0) return 'pie';
  if (raw === 1) return 'column';
  if (typeof raw === 'string') return raw as ChartType;
  return 'column';
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

type State = { output: AggregateOutput; error: string | null; loading: boolean };
type Action =
  | { type: 'start' }
  | { type: 'success'; output: AggregateOutput }
  | { type: 'error'; message: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'start': return { output: state.output, error: null, loading: true };
    case 'success': return { output: action.output, error: null, loading: false };
    case 'error': return { output: EMPTY_OUTPUT, error: action.message, loading: false };
  }
}

// Stable string key for conditions[] used as useEffect dependency.
function conditionsKey(conditions: FilterCondition[] | null | undefined): string {
  return conditions && conditions.length > 0 ? JSON.stringify(conditions) : '';
}

export default function DashboardWidget({ widget }: { widget: WidgetConfig }) {
  const [{ output, error, loading }, dispatch] = useReducer(reducer, { output: EMPTY_OUTPUT, error: null, loading: true });

  const validationError = validateConfig(widget);
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
      (widget.group_by_bucket || widget.stack_mode) && widget.series_field
        ? widget.series_field
        : undefined;
    const groupByBucket = widget.group_by_bucket ?? undefined;
    aggregateForWidget(
      widget.entity_name,
      widget.group_by_field,
      legacyFilter,
      seriesField,
      activeConditions ?? undefined,
      groupByBucket,
    )
      .then((result) => { if (!cancelled) dispatch({ type: 'success', output: result }); })
      .catch((e: unknown) => {
        if (!cancelled) dispatch({ type: 'error', message: e instanceof Error ? e.message : 'Failed to load' });
      });
    return () => { cancelled = true; };
  }, [widget.entity_name, widget.group_by_field, widget.filter_field, widget.filter_value, widget.stack_mode, widget.series_field, widget.group_by_bucket, validationError, condKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartType = resolveChartType(widget.chart_type);
  const stackMode = (widget.stack_mode ?? undefined) as StackMode | undefined;

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
    !loading && !error && !validationError &&
    (output.kind === 'single' ? output.data.length > 0 : output.categories.length > 0);

  return (
    <Card variant="outlined" sx={{ width: '100%' }}>
      <CardHeader
        title={widget.name}
        subheader={`${widget.entity_name} grouped by ${widget.group_by_field}`}
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
          <Typography color="error" variant="caption">{validationError}</Typography>
        ) : loading ? (
          <Skeleton variant="rectangular" height={240} />
        ) : error ? (
          <Typography color="error" variant="caption">{error}</Typography>
        ) : (
          renderChart()
        )}
      </CardContent>
    </Card>
  );
}
