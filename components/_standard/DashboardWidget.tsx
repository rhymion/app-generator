'use client';

import { useEffect, useReducer } from 'react';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import DashboardChart, { ChartDatum, ChartType } from './DashboardChart';
import { aggregateForWidget } from '@/lib/dashboard/aggregate';

export type WidgetConfig = {
  id: string;
  name: string;
  order: number;
  entity_name: string;
  chart_type: ChartType;
  group_by_field: string;
  filter_field?: string | null;
  filter_value?: string | null;
};

// Read legacy numeric chart_type from JSON config: 0 → pie, 1 → column
function resolveChartType(raw: unknown): ChartType {
  if (raw === 0) return 'pie';
  if (raw === 1) return 'column';
  if (typeof raw === 'string') return raw as ChartType;
  return 'column';
}

type State = { data: ChartDatum[]; error: string | null; loading: boolean };
type Action =
  | { type: 'start' }
  | { type: 'success'; data: ChartDatum[] }
  | { type: 'error'; message: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'start': return { data: state.data, error: null, loading: true };
    case 'success': return { data: action.data, error: null, loading: false };
    case 'error': return { data: [], error: action.message, loading: false };
  }
}

export default function DashboardWidget({ widget }: { widget: WidgetConfig }) {
  const [{ data, error, loading }, dispatch] = useReducer(reducer, { data: [], error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: 'start' });
    const filter = widget.filter_field && widget.filter_value
      ? { field: widget.filter_field, value: widget.filter_value }
      : null;
    aggregateForWidget(widget.entity_name, widget.group_by_field, filter)
      .then((rows) => { if (!cancelled) dispatch({ type: 'success', data: rows }); })
      .catch((e: unknown) => {
        if (!cancelled) dispatch({ type: 'error', message: e instanceof Error ? e.message : 'Failed to load' });
      });
    return () => { cancelled = true; };
  }, [widget.entity_name, widget.group_by_field, widget.filter_field, widget.filter_value]);

  const chartType = resolveChartType(widget.chart_type);

  return (
    <Card variant="outlined" sx={{ width: '100%' }}>
      <CardHeader
        title={widget.name}
        subheader={`${widget.entity_name} grouped by ${widget.group_by_field}`}
        titleTypographyProps={{ variant: 'subtitle1' }}
        subheaderTypographyProps={{ variant: 'caption' }}
      />
      <CardContent>
        {loading ? (
          <Skeleton variant="rectangular" height={240} />
        ) : error ? (
          <Typography color="error" variant="caption">{error}</Typography>
        ) : (
          <DashboardChart type={chartType} data={data} />
        )}
      </CardContent>
    </Card>
  );
}
