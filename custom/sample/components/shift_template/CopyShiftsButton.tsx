'use client';

import { useState, useEffect } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Typography from '@mui/material/Typography';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import type { Dayjs } from 'dayjs';
import type { ModelPermissions } from '@/lib/authz';
import { copyShiftTemplatesToShifts, type CopyShiftsResult } from '@/lib/shift_template/copy-shifts';
import { useTranslations } from 'next-intl';

interface CopyShiftsButtonProps {
  permissions: ModelPermissions;
}

export default function CopyShiftsButton({ permissions }: CopyShiftsButtonProps) {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState<Dayjs | null>(null);
  const [endDate, setEndDate] = useState<Dayjs | null>(null);
  const [timezone, setTimezone] = useState('UTC');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CopyShiftsResult | null>(null);
  const t = useTranslations('ShiftTemplate');
  const tf = useTranslations('Fields');
  const tc = useTranslations('Common');

  // Set browser local timezone once on mount
  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  if (!permissions.create) return null;

  const handleAdd = async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const r = await copyShiftTemplatesToShifts(
        startDate.format('YYYY-MM-DD'),
        endDate.format('YYYY-MM-DD'),
        timezone,
      );
      setResult(r);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setStartDate(null);
    setEndDate(null);
    setResult(null);
  };

  return (
    <>
      <Button variant="outlined" onClick={() => setOpen(true)}>
        {t('copyToShifts')}
      </Button>
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>{t('copyToShiftsExplanation')}</DialogTitle>
        <DialogContent>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DatePicker
              label={tf('startDate')}
              value={startDate}
              onChange={setStartDate}
              disabled={!!result}
              slotProps={{ textField: { fullWidth: true, margin: 'normal' } }}
            />
            <DatePicker
              label={tf('endDate')}
              value={endDate}
              onChange={setEndDate}
              minDate={startDate ?? undefined}
              disabled={!!result}
              slotProps={{ textField: { fullWidth: true, margin: 'normal' } }}
            />
          </LocalizationProvider>
          {result && (
            <div style={{ marginTop: 16 }}>
              <Typography>{result.success} shift(s) created successfully.</Typography>
              {result.failures.length > 0 && (
                <>
                  <Typography color="error" sx={{ mt: 1 }}>
                    {result.failures.length} failure(s):
                  </Typography>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {result.failures.map((f, i) => (
                      <li key={i}>
                        <Typography color="error" variant="body2">
                          {f.label}: {f.reason}
                        </Typography>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </DialogContent>
        <DialogActions>
          {!result && (
            <Button
              onClick={handleAdd}
              disabled={!startDate || !endDate || loading}
              variant="contained"
            >
              {loading ? tc('adding') : tc('add')}
            </Button>
          )}
          <Button onClick={handleClose}>{tc('close')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}