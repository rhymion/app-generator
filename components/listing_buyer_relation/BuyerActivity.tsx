'use client';

import { useMemo } from 'react';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { FormViewProps } from '@/lib/listing_buyer_relation/types';

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
};

const getRandomInt = (max: number) => Math.floor(Math.random() * max);

const getLastSeenLabel = () => {
  const type = getRandomInt(3);
  if (type === 0) {
    return `${1 + getRandomInt(59)} mins ago`;
  }
  if (type === 1) {
    return `${1 + getRandomInt(23)} hours ago`;
  }
  return `${1 + getRandomInt(13)} days ago`;
};

export default function BuyerActivity({ src }: FormViewProps) {
  const values = useMemo(() => ({
    status: ['Hot', 'Warm', 'Cool'][getRandomInt(3)],
    opens: 1 + getRandomInt(200),
    time: formatTime(20 + getRandomInt(340)),
    threeD: 1 + getRandomInt(20),
    lastSeen: getLastSeenLabel(),
    intent: getRandomInt(100),
  }), [src.id]);

  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 4 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        Buyer Activity
      </Typography>
      <Grid container spacing={2}>
        <TextField
        label="Status"
        value={values.status}
        fullWidth
        margin="normal"
        InputProps={{ readOnly: true }}
        aria-readonly
        />
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
        label="3D"
        value={values.threeD}
        fullWidth
        margin="normal"
        InputProps={{ readOnly: true }}
        aria-readonly
        />
        <TextField
        label="Last Seen"
        value={values.lastSeen}
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
