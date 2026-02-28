'use client';

import { useMemo } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';

function getTimezones(): string[] {
  try {
    // Intl.supportedValuesOf is ES2022 — available in Node 20+ and modern browsers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((Intl as any).supportedValuesOf('timeZone') as string[]).sort();
  } catch {
    // Fallback list for environments that don't support the API
    return [
      'UTC',
      'America/Chicago', 'America/Los_Angeles', 'America/New_York', 'America/Sao_Paulo',
      'Asia/Kolkata', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tokyo',
      'Australia/Sydney', 'Europe/Berlin', 'Europe/London', 'Europe/Moscow', 'Europe/Paris',
      'Pacific/Auckland',
    ];
  }
}

interface Props {
  value: string;
  onChange: (tz: string) => void;
  label?: string;
  size?: 'small' | 'medium';
  disabled?: boolean;
  fullWidth?: boolean;
}

export default function TimeZoneSelect({
  value,
  onChange,
  label = 'Time Zone',
  size = 'small',
  disabled,
  fullWidth,
}: Props) {
  const options = useMemo(getTimezones, []);

  return (
    <Autocomplete
      options={options}
      value={value}
      onChange={(_, newValue) => {
        if (newValue) onChange(newValue);
      }}
      disabled={disabled}
      size={size}
      fullWidth={fullWidth}
      sx={{ minWidth: 220 }}
      renderInput={(params) => <TextField {...params} label={label} />}
      disableClearable
      autoHighlight
    />
  );
}
