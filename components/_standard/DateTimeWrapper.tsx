'use client';
import dayjs from 'dayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function DateTimeWrapper({label, date_time, show_date = true, show_time = true, readOnly = false, required = false, ...other}: {label: string, date_time: Date | null, show_date?: boolean, show_time?: boolean, readOnly?: boolean, required?: boolean, [key: string]: any}) {
    return (
    <div style={{ position: 'relative' }}>
      {required && !readOnly && (
        <input
          tabIndex={-1}
          required
          aria-hidden="true"
          value={date_time ? 'set' : ''}
          onChange={() => {}}
          style={{ opacity: 0, width: '100%', height: 0, position: 'absolute', pointerEvents: 'none', padding: 0, border: 'none' }}
        />
      )}
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        { show_date && !show_time && (
        <DatePicker
          label={label}
          value={date_time ? dayjs(date_time) : null}
          {...(readOnly ? { readOnly: true } : {})}
          slotProps={{ field: { clearable: true }, textField: { margin: 'normal', required } }}
          {...other}
        /> )
        }
        { show_date && show_time && (
        <DateTimePicker
          views={['year', 'month', 'day', 'hours', 'minutes']}
          label={label}
          value={date_time ? dayjs(date_time) : null}
          {...(readOnly ? { readOnly: true } : {})}
          slotProps={{ field: { clearable: true }, textField: { margin: 'normal', required } }}
          {...other}
        /> )
        }
        { !show_date && show_time && (
        <TimePicker
          views={['hours', 'minutes']}
          label={label}
          value={date_time ? dayjs(date_time) : null}
          {...(readOnly ? { readOnly: true } : {})}
          slotProps={{ field: { clearable: true }, textField: { margin: 'normal', required } }}
          {...other}
        />
         )
        }
      </LocalizationProvider>
    </div>
    );
}