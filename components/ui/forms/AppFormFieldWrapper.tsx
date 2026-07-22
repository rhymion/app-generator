import { Box } from '@mui/material';
import React from 'react';

interface AppFormFieldWrapperProps {
  children: React.ReactNode;
  /** Field width in 12-column grid units (1-12). Full width below the md breakpoint. */
  cols: number;
}

export default function AppFormFieldWrapper({ children, cols }: AppFormFieldWrapperProps) {
  return (
    <Box sx={{ width: { xs: '100%', md: `${(cols / 12) * 100}%` } }}>
      {children}
    </Box>
  );
}
