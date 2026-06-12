import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';

const HEADER_LOCALE_SX = {
  minWidth: 140,
  '& .MuiOutlinedInput-root': {
    color: 'white',
    backgroundColor: 'rgba(255,255,255,0.1)',
    '& fieldset': { borderColor: 'rgba(255,255,255,0.3)' },
    '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.5)' },
    '&.Mui-focused fieldset': { borderColor: 'rgba(255,255,255,0.7)' },
  },
  '& .MuiSvgIcon-root': { color: 'white' },
} as const;

interface AppAutocompleteProps {
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  getOptionLabel?: (option: string) => string;
  isOptionEqualToValue?: (option: string, value: string) => boolean;
  label?: string;
  inputAriaLabel?: string;
  disableClearable?: boolean;
  size?: 'small' | 'medium';
  minWidth?: number | string;
  variant?: 'default' | 'headerLocale';
}

export function AppAutocomplete({
  options,
  value,
  onChange,
  getOptionLabel,
  isOptionEqualToValue,
  label,
  inputAriaLabel,
  disableClearable,
  size,
  minWidth,
  variant,
}: AppAutocompleteProps) {
  const sx =
    variant === 'headerLocale'
      ? HEADER_LOCALE_SX
      : minWidth !== undefined
        ? { minWidth }
        : undefined;

  return (
    <Autocomplete
      options={options}
      value={value}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onChange={(_: unknown, v: any) => { if (v != null) onChange(v as string); }}
      getOptionLabel={getOptionLabel}
      isOptionEqualToValue={isOptionEqualToValue}
      disableClearable={disableClearable}
      size={size}
      sx={sx}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          variant="outlined"
          inputProps={{
            ...params.inputProps,
            ...(inputAriaLabel ? { 'aria-label': inputAriaLabel } : {}),
          }}
        />
      )}
    />
  );
}
