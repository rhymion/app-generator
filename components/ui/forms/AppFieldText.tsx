import TextField from '@mui/material/TextField';
import type { ComponentProps } from 'react';

interface AppFieldTextProps {
  label: React.ReactNode;
  value?: string | number | null;
  defaultValue?: string | number | readonly string[];
  inputRef?: React.Ref<HTMLInputElement>;
  readOnly?: boolean;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
  slotProps?: ComponentProps<typeof TextField>['slotProps'];
}

export default function AppFieldText({
  label,
  value,
  defaultValue,
  inputRef,
  readOnly,
  required,
  multiline,
  rows,
  slotProps,
}: AppFieldTextProps) {
  if (readOnly) {
    return (
      <TextField
        label={label}
        value={value ?? ''}
        fullWidth
        margin="normal"
        aria-readonly
      />
    );
  }
  return (
    <TextField
      label={label}
      inputRef={inputRef}
      defaultValue={defaultValue}
      fullWidth
      margin="normal"
      required={required}
      multiline={multiline}
      rows={rows}
      slotProps={slotProps}
    />
  );
}
