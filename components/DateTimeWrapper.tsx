'use client';
import dayjs from 'dayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';

export default function DateTimeWrapper({label, date_time}: {label: string, date_time: Date | null}) {
    return (
    <div>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <DateTimePicker
          label={label}
          value={date_time ? dayjs(date_time) : null}
          slotProps={{ textField: { margin: 'normal' } }}
          disabled
        />
      </LocalizationProvider>
    </div>
    );
}