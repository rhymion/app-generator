'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import DashboardWidget, { WidgetConfig } from './DashboardWidget';
import type { ModelPermissions } from '@/lib/authz';

type WidgetConfigInput = {
  id: string;
  name: string;
  order?: number;
  entity_name: string;
  chart_type: number;
  group_by_field: string;
  filter_field?: string | null;
  filter_value?: string | null;
  conditions?: unknown[] | null;
  stack_mode?: number | null;
  series_field?: string | null;
  group_by_bucket?: number | null;
  [key: string]: unknown;
};

type Props = {
  src: {
    id?: string;
    name?: string;
    widgets?: WidgetConfigInput[] | null;
  };
  permissions?: ModelPermissions;
  currentUserRoleIds?: string[];
  currentUserId?: string | null;
};

export default function DashboardView({ src }: Props) {
  const widgets = (src.widgets ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (widgets.length === 0) {
    return (
      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" color="textSecondary">
          No widgets yet. Edit this dashboard to add charts.
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        mt: 2,
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
        gap: 2,
      }}
    >
      {widgets.map((w) => <DashboardWidget key={w.id} widget={w as WidgetConfig} />)}
    </Box>
  );
}
