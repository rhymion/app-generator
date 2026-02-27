'use client';

import { useMemo } from 'react';
import { useRouter } from '@/i18n/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { ShiftForChart } from '@/lib/shift/chart-getters';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];
const MINUTES_IN_DAY = 24 * 60;
const USER_LABEL_WIDTH = 130;

// Colors for user bars — cycles through palette
const BAR_BG = ['#e3f2fd', '#e8f5e9', '#fce4ec', '#f3e5f5', '#fff3e0', '#e0f7fa', '#fbe9e7', '#eceff1'];
const BAR_BORDER = ['#1565c0', '#2e7d32', '#c62828', '#6a1b9a', '#e65100', '#00695c', '#4e342e', '#37474f'];

const STATUS_LABELS: Record<number, string> = { 0: 'Scheduled', 1: 'Confirmed', 2: 'Cancelled' };

function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseLocalDate(dateStr: string): Date {
  // Parse "YYYY-MM-DD" as local midnight to avoid UTC-offset surprises
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d);
}

function fmt(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function fmtDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type Props = {
  shifts: ShiftForChart[];
  /** "YYYY-MM-DD" string for the first day displayed */
  weekStart: string;
};

export default function ShiftGanttChart({ shifts, weekStart }: Props) {
  const router = useRouter();

  const weekStartDate = useMemo(() => parseLocalDate(weekStart), [weekStart]);

  // Build the 7 days (local dates)
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStartDate);
        d.setDate(weekStartDate.getDate() + i);
        return d;
      }),
    [weekStartDate],
  );

  // Group shifts by local date key
  const shiftsByDay = useMemo(() => {
    const map = new Map<string, ShiftForChart[]>();
    for (const day of days) map.set(dateKey(day), []);
    for (const shift of shifts) {
      const key = dateKey(new Date(shift.start_time));
      map.get(key)?.push(shift);
    }
    return map;
  }, [shifts, days]);

  // Stable color index per user
  const userColorIndex = useMemo(() => {
    const seen = new Map<string, number>();
    for (const s of shifts) {
      if (!seen.has(s.user_account_id)) seen.set(s.user_account_id, seen.size % BAR_BG.length);
    }
    return seen;
  }, [shifts]);

  function navigate(offsetDays: number) {
    const d = new Date(weekStartDate);
    d.setDate(weekStartDate.getDate() + offsetDays);
    router.push(`/shift/chart?start=${dateKey(d)}`);
  }

  function handleDateChange(value: Dayjs | null) {
    if (!value?.isValid()) return;
    router.push(`/shift/chart?start=${value.format('YYYY-MM-DD')}`);
  }

  return (
    <Box sx={{ p: 2 }}>
      {/* ── Navigation header ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, flexWrap: 'wrap' }}>
        <Button variant="outlined" size="small" startIcon={<ChevronLeftIcon />} onClick={() => navigate(-7)}>
          Back
        </Button>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <DatePicker
            label="Week start"
            value={dayjs(weekStartDate)}
            onChange={handleDateChange}
            enableAccessibleFieldDOMStructure={false}
            slotProps={{ textField: { size: 'small' } }}
          />
        </LocalizationProvider>
        <Button variant="outlined" size="small" endIcon={<ChevronRightIcon />} onClick={() => navigate(7)}>
          Forward
        </Button>
      </Box>

      {/* ── One section per day ── */}
      {days.map((day) => {
        const key = dateKey(day);
        const dayShifts = shiftsByDay.get(key) ?? [];

        // Unique users who have a shift this day, preserving order of first appearance
        const userIds: string[] = [];
        for (const s of dayShifts) {
          if (!userIds.includes(s.user_account_id)) userIds.push(s.user_account_id);
        }

        return (
          <Box key={key} sx={{ mb: 3 }}>
            {/* Day label */}
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
              {DAY_NAMES[day.getDay()]}, {fmtDate(day)}
            </Typography>

            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
              {/* Time ruler */}
              <Box
                sx={{
                  display: 'flex',
                  position: 'relative',
                  height: 22,
                  bgcolor: 'grey.100',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  ml: `${USER_LABEL_WIDTH}px`,
                }}
              >
                {HOUR_TICKS.map((h) => (
                  <Box
                    key={h}
                    sx={{
                      position: 'absolute',
                      left: `${(h / 24) * 100}%`,
                      transform: h === 24 ? 'translateX(-100%)' : 'translateX(-50%)',
                      fontSize: '0.6rem',
                      color: 'text.secondary',
                      userSelect: 'none',
                      lineHeight: '22px',
                    }}
                  >
                    {String(h).padStart(2, '0')}:00
                  </Box>
                ))}
              </Box>

              {/* Rows */}
              {userIds.length === 0 ? (
                <Box sx={{ px: 2, py: 1, color: 'text.disabled', fontSize: '0.8rem' }}>No shifts</Box>
              ) : (
                userIds.map((uid) => {
                  const userShifts = dayShifts.filter((s) => s.user_account_id === uid);
                  const name = userShifts[0]?.user_account_name ?? uid;
                  const ci = userColorIndex.get(uid) ?? 0;

                  return (
                    <Box
                      key={uid}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        minHeight: 44,
                        borderTop: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      {/* User label */}
                      <Box
                        sx={{
                          width: USER_LABEL_WIDTH,
                          minWidth: USER_LABEL_WIDTH,
                          px: 1,
                          fontSize: '0.78rem',
                          fontWeight: 500,
                          color: 'text.secondary',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {name}
                      </Box>

                      {/* Timeline */}
                      <Box sx={{ flex: 1, position: 'relative', height: 44 }}>
                        {/* Vertical grid lines at every 3-hour tick */}
                        {HOUR_TICKS.slice(1, -1).map((h) => (
                          <Box
                            key={h}
                            sx={{
                              position: 'absolute',
                              left: `${(h / 24) * 100}%`,
                              top: 0,
                              bottom: 0,
                              width: '1px',
                              bgcolor: 'grey.200',
                            }}
                          />
                        ))}

                        {/* Shift bars */}
                        {userShifts.map((shift) => {
                          const start = new Date(shift.start_time);
                          const end = new Date(shift.end_time);

                          // Offset in minutes from local midnight of this day
                          const midnight = new Date(day);
                          midnight.setHours(0, 0, 0, 0);
                          const startMin = (start.getTime() - midnight.getTime()) / 60000;
                          const endMin = Math.min(
                            (end.getTime() - midnight.getTime()) / 60000,
                            MINUTES_IN_DAY,
                          );

                          const leftPct = Math.max(0, (startMin / MINUTES_IN_DAY) * 100);
                          const widthPct = Math.max(0.3, ((endMin - startMin) / MINUTES_IN_DAY) * 100);
                          const statusLabel = STATUS_LABELS[shift.status] ?? `Status ${shift.status}`;

                          return (
                            <Tooltip
                              key={shift.id}
                              title={`${name}: ${fmt(start)}–${fmt(end)} (${statusLabel})`}
                              arrow
                            >
                              <Box
                                sx={{
                                  position: 'absolute',
                                  left: `${leftPct}%`,
                                  width: `${widthPct}%`,
                                  top: '15%',
                                  height: '70%',
                                  bgcolor: BAR_BG[ci],
                                  border: `2px solid ${BAR_BORDER[ci]}`,
                                  borderRadius: '3px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  overflow: 'hidden',
                                  cursor: 'default',
                                  transition: 'opacity 0.15s',
                                  '&:hover': { opacity: 0.75 },
                                }}
                              >
                                <Typography
                                  sx={{
                                    fontSize: '0.6rem',
                                    fontWeight: 700,
                                    color: BAR_BORDER[ci],
                                    px: 0.5,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                >
                                  {fmt(start)}–{fmt(end)}
                                </Typography>
                              </Box>
                            </Tooltip>
                          );
                        })}
                      </Box>
                    </Box>
                  );
                })
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
