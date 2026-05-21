'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import DashboardWidget, { WidgetConfig } from './DashboardWidget';
import type { ModelPermissions } from '@/lib/authz';

type Props = {
  src: {
    id?: string;
    name?: string;
    widgets?: WidgetConfig[] | null;
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
      {widgets.map((w) => <DashboardWidget key={w.id} widget={w} />)}
    </Box>
  );
}
