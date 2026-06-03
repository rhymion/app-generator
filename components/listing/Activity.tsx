'use client';

import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { FormViewProps } from '@/lib/listing/types';

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
};

const getRandomInt = (max: number) => Math.floor(Math.random() * max);

export default function Activity({ src }: FormViewProps) {
  const values = useMemo(() => ({
    opens: 1 + getRandomInt(200),
    time: formatTime(20 + getRandomInt(340)),
    intent: getRandomInt(100),
  }), [src.id]);

  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 4 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        Activity
      </Typography>
      <Grid container spacing={2}>
        <TextField
        label="Opens"
        value={values.opens}
        fullWidth
        margin="normal"
        InputProps={{ readOnly: true }}
        aria-readonly
        />
        <TextField
        label="Time"
        value={values.time}
        fullWidth
        margin="normal"
        InputProps={{ readOnly: true }}
        aria-readonly
        />
        <TextField
        label="Intent"
        value={values.intent}
        fullWidth
        margin="normal"
        InputProps={{ readOnly: true }}
        aria-readonly
        />
      </Grid>
    </Paper>
  );
}
