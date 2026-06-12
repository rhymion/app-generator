import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import type { Dayjs } from 'dayjs';

interface AppDatePickerProps {
  label?: string;
  value: Dayjs | null;
  onChange: (value: Dayjs | null) => void;
  disabled?: boolean;
  minDate?: Dayjs;
  maxDate?: Dayjs;
  fullWidth?: boolean;
  margin?: 'none' | 'normal' | 'dense';
}

export function AppDatePicker({ label, value, onChange, disabled, minDate, maxDate, fullWidth, margin }: AppDatePickerProps) {
  const textFieldSlotProps =
    fullWidth !== undefined || margin !== undefined
      ? { textField: { fullWidth, margin } }
      : undefined;

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <DatePicker
        label={label}
        value={value}
        onChange={onChange}
        disabled={disabled}
        minDate={minDate}
        maxDate={maxDate}
        slotProps={textFieldSlotProps}
      />
    </LocalizationProvider>
  );
}
