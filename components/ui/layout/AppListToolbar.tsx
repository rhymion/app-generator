import Link from '@mui/material/Link';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import BarChartIcon from '@mui/icons-material/BarChart';

interface AppListToolbarProps {
  title: React.ReactNode;
  chartHref?: string;
  chartLabel?: string;
  children?: React.ReactNode;
}

export default function AppListToolbar({ title, chartHref, chartLabel, children }: AppListToolbarProps) {
  const hasActions = chartHref || children;
  return (
    <>
      <h1>{title}</h1>
      {hasActions && (
        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
          {chartHref && (
            <Button component={Link} href={chartHref} variant="outlined" startIcon={<BarChartIcon />}>
              {chartLabel}
            </Button>
          )}
          {children}
        </Box>
      )}
    </>
  );
}
