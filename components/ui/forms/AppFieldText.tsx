import TextField from '@mui/material/TextField';

interface AppFieldTextProps {
  label: React.ReactNode;
  value?: string | number | null;
  defaultValue?: string | number | readonly string[];
  inputRef?: React.Ref<HTMLInputElement>;
  readOnly?: boolean;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
  minLength?: number;
  maxLength?: number;
  slotProps?: { htmlInput?: React.InputHTMLAttributes<HTMLInputElement> };
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
  minLength,
  maxLength,
  slotProps: externalSlotProps,
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

  const hasHtmlInput = minLength !== undefined || maxLength !== undefined || externalSlotProps?.htmlInput;
  const htmlInput = hasHtmlInput
    ? {
        ...(externalSlotProps?.htmlInput ?? {}),
        ...(minLength !== undefined ? { minLength } : {}),
        ...(maxLength !== undefined ? { maxLength } : {}),
      }
    : undefined;

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      slotProps={hasHtmlInput ? { htmlInput: htmlInput as any } : undefined}
    />
  );
}
