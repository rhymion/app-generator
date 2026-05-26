'use client';

import { useEffect, useState } from 'react';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import DashboardChart, { ChartDatum } from './DashboardChart';
import { aggregateForWidget } from '@/lib/dashboard/aggregate';

export type WidgetConfig = {
  id: string;
  name: string;
  order: number;
  entity_name: string;
  chart_type: number;
  group_by_field: string;
  filter_field?: string | null;
  filter_value?: string | null;
};

export default function DashboardWidget({ widget }: { widget: WidgetConfig }) {
  const [data, setData] = useState<ChartDatum[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    const filter = widget.filter_field && widget.filter_value
      ? { field: widget.filter_field, value: widget.filter_value }
      : null;
    aggregateForWidget(widget.entity_name, widget.group_by_field, filter)
      .then((rows) => { if (!cancelled) setData(rows); })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [widget.entity_name, widget.group_by_field, widget.filter_field, widget.filter_value]);

  const chartType = widget.chart_type === 0 ? 'pie' : 'bar';

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
