'use client';

import { useMemo, useState, useEffect } from 'react';
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
import utcPlugin from 'dayjs/plugin/utc';
import timezonePlugin from 'dayjs/plugin/timezone';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { ShiftForChart } from '@/lib/shift/chart-getters';
import Link from 'next/link';

dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);

// ── Constants ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];
const MINUTES_IN_DAY = 24 * 60;
const USER_LABEL_WIDTH = 130;

const BAR_BG     = ['#e3f2fd', '#e8f5e9', '#fce4ec', '#f3e5f5', '#fff3e0', '#e0f7fa', '#fbe9e7', '#eceff1'];
const BAR_BORDER = ['#1565c0', '#2e7d32', '#c62828', '#6a1b9a', '#e65100', '#00695c', '#4e342e', '#37474f'];

const STATUS_LABELS: Record<number, string> = { 0: 'Scheduled', 1: 'Confirmed', 2: 'Cancelled' };

// ── Timezone-aware helpers ───────────────────────────────────────────────────

/** "HH:MM" for a UTC Date displayed in the given timezone. */
function fmtInTz(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h === '24' ? '00' : h}:${m}`;
}

/** "Jan 7" for a UTC Date displayed in the given timezone. */
function fmtDateInTz(date: Date, tz: string): string {
  return date.toLocaleDateString(undefined, { timeZone: tz, month: 'short', day: 'numeric' });
}

// ── Types ────────────────────────────────────────────────────────────────────

type DayInfo = {
  key: string;        // "YYYY-MM-DD"
  midnight: Date;     // UTC instant = 00:00 of this day in the timezone
  nextMidnight: Date; // UTC instant = 00:00 of the next day in the timezone
  dayOfWeek: number;  // 0 = Sunday
};

type Props = {
  shifts: ShiftForChart[];
  /** "YYYY-MM-DD" — the first day of the displayed week. */
  weekStart: string;
  /** IANA timezone string from URL. Empty string = detect browser local on mount. */
  timeZone?: string;
};

// ── Component ────────────────────────────────────────────────────────────────

export default function ShiftGanttChart({ shifts, weekStart }: Props) {
  const router = useRouter();

  // Detect browser local timezone on mount; always use local time, no selector shown.
  const [resolvedTz, setResolvedTz] = useState('UTC');
  useEffect(() => {
    setResolvedTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  // Build 7 DayInfo objects: midnight/nextMidnight are UTC instants for the day
  // boundaries in resolvedTz — this drives both shift grouping and bar positioning.
  const days = useMemo<DayInfo[]>(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = dayjs.tz(weekStart, resolvedTz).add(i, 'day');
        return {
          key: d.format('YYYY-MM-DD'),
          midnight: d.toDate(),
          nextMidnight: d.add(1, 'day').toDate(),
          dayOfWeek: d.day(),
        };
      }),
    [weekStart, resolvedTz],
  );

  // Assign each shift to every day it overlaps (handles cross-midnight shifts)
  const shiftsByDay = useMemo(() => {
    const map = new Map<string, ShiftForChart[]>();
    for (const { key } of days) map.set(key, []);
    for (const shift of shifts) {
      const start = new Date(shift.start_time);
      const end = new Date(shift.end_time);
      for (const { key, midnight, nextMidnight } of days) {
        if (start < nextMidnight && end > midnight) {
          map.get(key)?.push(shift);
        }
      }
    }
    return map;
  }, [shifts, days]);

  // Stable color index per user across the whole week
  const userColorIndex = useMemo(() => {
    const seen = new Map<string, number>();
    for (const s of shifts) {
      if (!seen.has(s.user_account_id)) seen.set(s.user_account_id, seen.size % BAR_BG.length);
    }
    return seen;
  }, [shifts]);

  // ── Navigation ──────────────────────────────────────────────────────────────

  function navigate(offsetDays: number) {
    const newStart = dayjs.tz(weekStart, resolvedTz).add(offsetDays, 'day').format('YYYY-MM-DD');
    router.push(`/shift/chart?start=${newStart}`);
  }

  function handleDateChange(value: Dayjs | null) {
    if (!value?.isValid()) return;
    router.push(`/shift/chart?start=${value.format('YYYY-MM-DD')}`);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ p: 2 }}>
      {/* Navigation header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, flexWrap: 'wrap' }}>
        <Button variant="outlined" size="small" startIcon={<ChevronLeftIcon />} onClick={() => navigate(-7)}>
          Back
        </Button>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <DatePicker
            label="Week start"
            value={dayjs(weekStart)}
            onChange={handleDateChange}
            enableAccessibleFieldDOMStructure={false}
            slotProps={{ textField: { size: 'small' } }}
          />
        </LocalizationProvider>
        <Button variant="outlined" size="small" endIcon={<ChevronRightIcon />} onClick={() => navigate(7)}>
          Forward
        </Button>
      </Box>

      {/* One section per day */}
      {days.map((dayInfo) => {
        const dayShifts = shiftsByDay.get(dayInfo.key) ?? [];

        const userIds: string[] = [];
        for (const s of dayShifts) {
          if (!userIds.includes(s.user_account_id)) userIds.push(s.user_account_id);
        }

        return (
          <Box key={dayInfo.key} sx={{ mb: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
              {DAY_NAMES[dayInfo.dayOfWeek]}, {fmtDateInTz(dayInfo.midnight, resolvedTz)}
            </Typography>

            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
              {/* Time ruler */}
              <Box
                sx={{
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

              {/* User rows */}
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
                        {/* Grid lines */}
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

                          const { midnight, nextMidnight } = dayInfo;
                          const fromPrevDay = start < midnight;
                          const toNextDay = end > nextMidnight;
                          const effectiveStart = fromPrevDay ? midnight : start;
                          const effectiveEnd = toNextDay ? nextMidnight : end;

                          const startMin = (effectiveStart.getTime() - midnight.getTime()) / 60000;
                          const endMin = (effectiveEnd.getTime() - midnight.getTime()) / 60000;
                          const leftPct = (startMin / MINUTES_IN_DAY) * 100;
                          const widthPct = Math.max(0.3, ((endMin - startMin) / MINUTES_IN_DAY) * 100);

                          const borderRadius = `${fromPrevDay ? 0 : 3}px ${toNextDay ? 0 : 3}px ${toNextDay ? 0 : 3}px ${fromPrevDay ? 0 : 3}px`;
                          const statusLabel = STATUS_LABELS[shift.status] ?? `Status ${shift.status}`;

                          return (
                            <Tooltip
                              key={shift.id}
                              title={`${name}: ${fmtInTz(start, resolvedTz)}–${fmtInTz(end, resolvedTz)} (${statusLabel})`}
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
                                  borderRadius,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  overflow: 'hidden',
                                  cursor: 'default',
                                  transition: 'opacity 0.15s',
                                  '&:hover': { opacity: 0.75 },
                                }}
                              >
                                <Link
                                  href={`/shift/edit/${shift.id}`}
                                  style={{ color: 'inherit', textDecoration: 'none', display: 'block', width: '100%', textAlign: 'center' }}
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
                                    {fmtInTz(start, resolvedTz)}–{fmtInTz(end, resolvedTz)}
                                  </Typography>
                                </Link>
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
