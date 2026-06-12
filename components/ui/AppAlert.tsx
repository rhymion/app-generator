import { Alert } from '@mui/material';
import React from 'react';

type Severity = 'error' | 'warning' | 'info' | 'success';

interface AppAlertProps {
  children: React.ReactNode;
  severity: Severity;
  mb?: number;
  className?: string;
}

export default function AppAlert({ children, severity, mb, className }: AppAlertProps) {
  return (
    <Alert severity={severity} className={className} sx={mb !== undefined ? { mb } : undefined}>
      {children}
    </Alert>
  );
}
