import { Paper } from '@mui/material';
import React from 'react';

type Variant = 'elevation' | 'outlined';

interface AppSurfaceProps {
  children?: React.ReactNode;
  elevation?: number;
  variant?: Variant;
  p?: number;
  width?: string | number;
  maxWidth?: number | string;
  mb?: number;
  className?: string;
}

export default function AppSurface({
  children,
  elevation,
  variant,
  p,
  width,
  maxWidth,
  mb,
  className,
}: AppSurfaceProps) {
  const sx: Record<string, unknown> = {};
  if (p !== undefined) sx.p = p;
  if (width !== undefined) sx.width = width;
  if (maxWidth !== undefined) sx.maxWidth = maxWidth;
  if (mb !== undefined) sx.mb = mb;

  return (
    <Paper
      elevation={elevation}
      variant={variant}
      className={className}
      sx={Object.keys(sx).length > 0 ? sx : undefined}
    >
      {children}
    </Paper>
  );
}
