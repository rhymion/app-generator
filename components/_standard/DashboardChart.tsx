'use client';

import { PieChart } from '@mui/x-charts/PieChart';
import { BarChart } from '@mui/x-charts/BarChart';
import { LineChart } from '@mui/x-charts/LineChart';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

// column = vertical bar; bar = horizontal bar; line = time series (Phase 4)
export type ChartType = 'pie' | 'column' | 'bar' | 'line';
export type ChartDatum = { label: string; count: number };
export type StackMode = 'grouped' | 'stacked' | 'standardized';
export type MultiSeriesData = { categories: string[]; series: { label: string; data: number[] }[] };

type SingleSeriesProps = {
  type: ChartType;
  data: ChartDatum[];
  multiSeries?: undefined;
  stackMode?: undefined;
  height?: number;
};

// bar / column multi-series with stack_mode
type MultiSeriesBarColumnProps = {
  type: 'column' | 'bar';
  data?: undefined;
  multiSeries: MultiSeriesData;
  stackMode: StackMode;
  height?: number;
};

// line chart multi-series (time series from group_by_bucket + series_field)
type MultiSeriesLineProps = {
  type: 'line';
  data?: undefined;
  multiSeries: MultiSeriesData;
  stackMode?: undefined;
  height?: number;
};

type Props = SingleSeriesProps | MultiSeriesBarColumnProps | MultiSeriesLineProps;

// Normalize each category bucket to 100% for standardized stacking.
function toPercent(
  series: { label: string; data: number[] }[],
): { label: string; data: number[] }[] {
  const catCount = series[0]?.data.length ?? 0;
  const totals = Array.from({ length: catCount }, (_, i) =>
    series.reduce((sum, s) => sum + (s.data[i] ?? 0), 0),
  );
  return series.map((s) => ({
    label: s.label,
    data: s.data.map((v, i) => (totals[i] === 0 ? 0 : Math.round((v / totals[i]) * 100))),
  }));
}

export default function DashboardChart({ type, data, multiSeries, stackMode, height = 240 }: Props) {
  // Multi-series path
  if (multiSeries) {
    const isEmpty = multiSeries.series.length === 0 || multiSeries.categories.length === 0;
    if (isEmpty) {
      return (
        <Box sx={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="caption" color="textSecondary">No data</Typography>
        </Box>
      );
    }

    // Line chart: multi-series time series (group_by_bucket + series_field)
    if (type === 'line') {
      return (
        <LineChart
          height={height}
          xAxis={[{ scaleType: 'point', data: multiSeries.categories }]}
          series={multiSeries.series.map((s) => ({ label: s.label, data: s.data }))}
        />
      );
    }

    const normalized = stackMode === 'standardized' ? toPercent(multiSeries.series) : multiSeries.series;
    const isStacked = stackMode === 'stacked' || stackMode === 'standardized';
    const chartSeries = normalized.map((s) => ({
      label: s.label,
      data: s.data,
      ...(isStacked ? { stack: 'total' } : {}),
    }));

    if (type === 'bar') {
      return (
        <BarChart
          height={height}
          layout="horizontal"
          yAxis={[{ scaleType: 'band', data: multiSeries.categories }]}
          series={chartSeries}
        />
      );
    }
    // column (vertical)
    return (
      <BarChart
        height={height}
        xAxis={[{ scaleType: 'band', data: multiSeries.categories }]}
        series={chartSeries}
      />
    );
  }

  // Single-series path (original behaviour)
  const singleData = data ?? [];
  if (singleData.length === 0) {
    return (
      <Box sx={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="caption" color="textSecondary">No data</Typography>
      </Box>
    );
  }

  if (type === 'pie') {
    return (
      <PieChart
        height={height}
        series={[
          {
            data: singleData.map((d, i) => ({ id: i, value: d.count, label: d.label })),
            highlightScope: { fade: 'global', highlight: 'item' },
          },
        ]}
      />
    );
  }

  if (type === 'bar') {
    // Horizontal bar chart
    return (
      <BarChart
        height={height}
        layout="horizontal"
        yAxis={[{ scaleType: 'band', data: singleData.map((d) => d.label) }]}
        series={[{ data: singleData.map((d) => d.count) }]}
      />
    );
  }

  if (type === 'line') {
    // Single-series time series (group_by_bucket without series_field)
    return (
      <LineChart
        height={height}
        xAxis={[{ scaleType: 'point', data: singleData.map((d) => d.label) }]}
        series={[{ label: 'Count', data: singleData.map((d) => d.count) }]}
      />
    );
  }

  // column (vertical bar) — default
  return (
    <BarChart
      height={height}
      xAxis={[{ scaleType: 'band', data: singleData.map((d) => d.label) }]}
      series={[{ data: singleData.map((d) => d.count) }]}
    />
  );
}
