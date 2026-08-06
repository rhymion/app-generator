import { Stack } from '@mui/material';
import React from 'react';

interface AppStackProps {
  children?: React.ReactNode;
  direction?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  spacing?: number | string;
  alignItems?: string;
  flexWrap?: 'wrap' | 'nowrap' | 'wrap-reverse';
  mt?: number;
  mb?: number;
  maxWidth?: number | string;
  className?: string;
}

export default function AppStack({
  children,
  direction,
  spacing,
  alignItems,
  flexWrap,
  mt,
  mb,
  maxWidth,
  className,
}: AppStackProps) {
  return (
    <Stack
      direction={direction}
      spacing={spacing}
      className={className}
      sx={{
        alignItems: alignItems,
        flexWrap: flexWrap,
        mt: mt,
        mb: mb,
        maxWidth: maxWidth
      }}>
      {children}
    </Stack>
  );
}
