'use client';

import { PieChart } from '@mui/x-charts/PieChart';
import { BarChart } from '@mui/x-charts/BarChart';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

export type ChartType = 'pie' | 'bar';
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

  return (
    <BarChart
      height={height}
      xAxis={[{ scaleType: 'band', data: data.map((d) => d.label) }]}
      series={[{ data: data.map((d) => d.count) }]}
    />
  );
}
