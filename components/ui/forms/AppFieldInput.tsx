import TextField from '@mui/material/TextField';
import type { ReactNode } from 'react';

interface AppFieldInputProps {
  label: ReactNode;
  id?: string;
  name?: string;
  type?: 'text' | 'password' | 'email' | 'number' | 'tel' | 'url';
  value?: string;
  onChange?: (value: string) => void;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'tel' | 'url' | 'search' | 'none';
  required?: boolean;
  fullWidth?: boolean;
  size?: 'small' | 'medium';
  helperText?: ReactNode;
  autoFocus?: boolean;
  margin?: 'none' | 'normal' | 'dense';
  mb?: number;
  className?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  width?: number | string;
  flex?: number | string;
  testId?: string;
  readOnly?: boolean;
  endAction?: ReactNode;
}

export default function AppFieldInput({
  label,
  id,
  name,
  type,
  value,
  onChange,
  autoComplete,
  inputMode,
  required,
  fullWidth,
  size,
  helperText,
  autoFocus,
  margin,
  mb,
  className,
  minLength,
  maxLength,
  min,
  width,
  flex,
  testId,
  readOnly,
  endAction,
}: AppFieldInputProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const htmlInput: Record<string, any> = {};
  if (inputMode) htmlInput.inputMode = inputMode;
  if (minLength !== undefined) htmlInput.minLength = minLength;
  if (maxLength !== undefined) htmlInput.maxLength = maxLength;
  if (min !== undefined) htmlInput.min = min;
  if (testId) htmlInput['data-testid'] = testId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input: Record<string, any> = {};
  if (readOnly) input.readOnly = readOnly;
  if (endAction !== undefined) input.endAdornment = endAction;

  const hasHtmlInput = Object.keys(htmlInput).length > 0;
  const hasInput = Object.keys(input).length > 0;

  return (
    <TextField
      label={label}
      id={id}
      name={name}
      type={type}
      value={value}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      autoComplete={autoComplete}
      required={required}
      fullWidth={fullWidth}
      size={size}
      helperText={helperText}
      autoFocus={autoFocus}
      margin={margin}
      className={className}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      slotProps={(hasHtmlInput || hasInput) ? { ...(hasHtmlInput ? { htmlInput } : {}), ...(hasInput ? { input } : {}) } as any : undefined}
      sx={(mb !== undefined || width !== undefined || flex !== undefined) ? { mb, width, flex } : undefined}
    />
  );
}
