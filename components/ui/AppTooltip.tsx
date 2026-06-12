import Tooltip from '@mui/material/Tooltip';
import React from 'react';

interface AppTooltipProps {
  title: string;
  children: React.ReactElement;
}

export default function AppTooltip({ title, children }: AppTooltipProps) {
  return <Tooltip title={title}>{children}</Tooltip>;
}
