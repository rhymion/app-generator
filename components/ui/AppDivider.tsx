import { Divider } from '@mui/material';
import React from 'react';

interface AppDividerProps {
  children?: React.ReactNode;
  my?: number;
  className?: string;
}

export default function AppDivider({ children, my, className }: AppDividerProps) {
  return (
    <Divider className={className} sx={my !== undefined ? { my } : undefined}>
      {children}
    </Divider>
  );
}
