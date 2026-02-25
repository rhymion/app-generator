'use client';
import dayjs from 'dayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function DateTimeWrapper({label, date_time, show_time = true, ...other}: {label: string, date_time: Date | null, show_time?: boolean, [key: string]: any}) {
    return (
    <div>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <DateTimePicker
          enableAccessibleFieldDOMStructure={false}
          views={show_time ? ['year', 'month', 'day', 'hours', 'minutes'] : ['year', 'month', 'day']}
          label={label}
          value={date_time ? dayjs(date_time) : null}
          slotProps={{ field: { clearable: true }, textField: { margin: 'normal' } }}
          {...other}
        />
      </LocalizationProvider>
    </div>
    );
}