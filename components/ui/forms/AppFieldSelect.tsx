'use client';

import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';

export interface AppFieldSelectOption<T extends string | number = string | number> {
  value: T;
  label: string;
  // True for a value that can never be chosen through this field (e.g. an
  // approval-mechanism-only status value). The option still renders — so an
  // already-persisted disabled value stays visible instead of the field
  // going blank — but cannot be selected.
  disabled?: boolean;
}

interface AppFieldSelectProps<T extends string | number> {
  label: React.ReactNode;
  options: AppFieldSelectOption<T>[];
  value: AppFieldSelectOption<T> | null;
  onChange: (newValue: T | null) => void;
  required?: boolean;
}

export default function AppFieldSelect<T extends string | number>({
  label,
  options,
  value,
  onChange,
  required,
}: AppFieldSelectProps<T>) {
  return (
    <Autocomplete
      options={options}
      value={value}
      getOptionDisabled={(option) => !!option.disabled}
      onChange={(_, newValue) => onChange(newValue?.value ?? null)}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          margin="normal"
          required={required}
        />
      )}
    />
  );
}
