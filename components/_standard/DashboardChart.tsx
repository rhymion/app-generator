'use client';

import { PieChart } from '@mui/x-charts/PieChart';
import { BarChart } from '@mui/x-charts/BarChart';
import { LineChart } from '@mui/x-charts/LineChart';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

// column = vertical bar; bar = horizontal bar; line = placeholder for Phase 4 time series
export type ChartType = 'pie' | 'column' | 'bar' | 'line';
export type ChartDatum = { label: string; count: number };

type Props = {
  type: ChartType;
  data: ChartDatum[];
  height?: number;
};

export default function DashboardChart({ type, data, height = 240 }: Props) {
  if (data.length === 0) {
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
            data: data.map((d, i) => ({ id: i, value: d.count, label: d.label })),
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
        yAxis={[{ scaleType: 'band', data: data.map((d) => d.label) }]}
        series={[{ data: data.map((d) => d.count) }]}
      />
    );
  }

  if (type === 'line') {
    // Placeholder: activated in Phase 4 for time series
    return (
      <LineChart
        height={height}
        xAxis={[{ scaleType: 'band', data: data.map((d) => d.label) }]}
        series={[{ data: data.map((d) => d.count) }]}
      />
    );
  }

  // column (vertical bar) — default
  return (
    <BarChart
      height={height}
      xAxis={[{ scaleType: 'band', data: data.map((d) => d.label) }]}
      series={[{ data: data.map((d) => d.count) }]}
    />
  );
}
