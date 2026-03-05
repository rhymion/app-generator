'use client';

import { useState } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { verifyAndHashPassword } from '@/lib/setting/password-actions';

export default function Password({ onChange }: { value?: string; onChange?: (val: string) => void; isEdit?: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const handleChange = async () => {
    if (next !== confirm) {
      setError('New passwords do not match');
      return;
    }
    setError(null);
    setSuccess(false);
    setIsPending(true);
    try {
      const hash = await verifyAndHashPassword(current, next);
      onChange?.(hash);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify password');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Accordion sx={{ mt: 2 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography>Change Password</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <TextField
          label="Current Password"
          type="password"
          value={current}
          onChange={e => setCurrent(e.target.value)}
          fullWidth
          margin="normal"
        />
        <TextField
          label="New Password"
          type="password"
          value={next}
          onChange={e => setNext(e.target.value)}
          fullWidth
          margin="normal"
        />
        <TextField
          label="Confirm New Password"
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          fullWidth
          margin="normal"
        />
        {error && <Typography color="error" variant="body2">{error}</Typography>}
        {success && <Typography color="success.main" variant="body2">Password verified — click Save to apply</Typography>}
        <Button
          variant="contained"
          onClick={handleChange}
          disabled={isPending || !current || !next || !confirm}
          sx={{ mt: 1 }}
        >
          Verify Password
        </Button>
      </AccordionDetails>
    </Accordion>
  );
}
