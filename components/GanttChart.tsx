'use client';

import { useMemo, useState } from 'react';
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
import Link from 'next/link';
import { useTranslations } from 'next-intl';

dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);

// ── Constants ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];
const MINUTES_IN_DAY = 24 * 60;
const ROW_LABEL_WIDTH = 130;

const BAR_BG     = ['#e3f2fd', '#e8f5e9', '#fce4ec', '#f3e5f5', '#fff3e0', '#e0f7fa', '#fbe9e7', '#eceff1'];
const BAR_BORDER = ['#1565c0', '#2e7d32', '#c62828', '#6a1b9a', '#e65100', '#00695c', '#4e342e', '#37474f'];

// ── Public types ──────────────────────────────────────────────────────────────

export type GanttItem = {
  id: string;
  start_time: string;  // ISO string
  end_time: string;    // ISO string
  row_id: string;      // grouping key (e.g. user_account_id, resource_id)
  row_label: string;   // display label for the row
  tooltip?: string;    // extra info shown in the tooltip (e.g. status label)
};

// ── Internal types ────────────────────────────────────────────────────────────

type DayInfo = {
  key: string;        // "YYYY-MM-DD"
  midnight: Date;     // UTC instant = 00:00 of this day in the timezone
  nextMidnight: Date;
  dayOfWeek: number;
};

type XTick = { label: string; pct: number };

type Props = {
  items: GanttItem[];
  /** "YYYY-MM-DD" — start of the displayed period (week start / month / year). */
  periodStart: string;
  span: 'week' | 'month' | 'year';
  /** Base path for edit links, e.g. "/shift" → links to /shift/edit/{id}. */
  basePath: string;
  timeZone?: string;
};

// ── Timezone helpers ──────────────────────────────────────────────────────────

function fmtTimeInTz(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h === '24' ? '00' : h}:${m}`;
}

function fmtDateShort(date: Date, tz: string): string {
  // Use 'sv-SE' locale to get consistent YYYY-MM-DD format regardless of user locale
  return date.toLocaleDateString('sv-SE', { timeZone: tz });
}

// ── Main component ────────────────────────────────────────────────────────────

export default function GanttChart({ items, periodStart, span, basePath }: Props) {
  const router = useRouter();
  const tc = useTranslations('Chart');

  const [resolvedTz] = useState(() =>
    typeof window !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'
  );

  // Stable color index per row across the whole chart
  const rowColorIndex = useMemo(() => {
    const seen = new Map<string, number>();
    for (const item of items) {
      if (!seen.has(item.row_id)) seen.set(item.row_id, seen.size % BAR_BG.length);
    }
    return seen;
  }, [items]);

  // ── Navigation ───────────────────────────────────────────────────────────────

  function navigate(direction: 1 | -1) {
    const d = dayjs(periodStart);
    let newStart: string;
    if (span === 'week') {
      newStart = d.add(direction * 7, 'day').format('YYYY-MM-DD');
    } else if (span === 'month') {
      newStart = d.add(direction, 'month').format('YYYY-MM-DD');
    } else {
      newStart = d.add(direction, 'year').format('YYYY-MM-DD');
    }
    router.push(`${basePath}/chart?start=${newStart}`);
  }

  function handleDateChange(value: Dayjs | null) {
    if (!value?.isValid()) return;
    let newStart: string;
    if (span === 'week') {
      newStart = value.format('YYYY-MM-DD');
    } else if (span === 'month') {
      newStart = value.startOf('month').format('YYYY-MM-DD');
    } else {
      newStart = value.startOf('year').format('YYYY-MM-DD');
    }
    router.push(`${basePath}/chart?start=${newStart}`);
  }

  const pickerViews = span === 'year'
    ? ['year'] as const
    : span === 'month'
      ? ['year', 'month'] as const
      : undefined;
  const pickerLabel = span === 'week' ? 'weekStart' : span === 'month' ? 'month' : 'year';
  const backLabel   = span === 'week' ? 'prevWeek'  : span === 'month' ? 'prevMonth' : 'prevYear';
  const fwdLabel    = span === 'week' ? 'nextWeek'  : span === 'month' ? 'nextMonth' : 'nextYear';

  // ── Week-specific data ───────────────────────────────────────────────────────

  const days = useMemo<DayInfo[]>(() => {
    if (span !== 'week') return [];
    return Array.from({ length: 7 }, (_, i) => {
      const d = dayjs.tz(periodStart, resolvedTz).add(i, 'day');
      return {
        key: d.format('YYYY-MM-DD'),
        midnight: d.toDate(),
        nextMidnight: d.add(1, 'day').toDate(),
        dayOfWeek: d.day(),
      };
    });
  }, [span, periodStart, resolvedTz]);

  const itemsByDay = useMemo(() => {
    if (span !== 'week') return new Map<string, GanttItem[]>();
    const map = new Map<string, GanttItem[]>();
    for (const { key } of days) map.set(key, []);
    for (const item of items) {
      const start = new Date(item.start_time);
      const end   = new Date(item.end_time);
      for (const { key, midnight, nextMidnight } of days) {
        if (start < nextMidnight && end > midnight) map.get(key)?.push(item);
      }
    }
    return map;
  }, [span, items, days]);

  // ── Month/Year flat-timeline data ────────────────────────────────────────────

  const flatData = useMemo(() => {
    if (span === 'week') return { periodStartDate: new Date(0), periodEndDate: new Date(0), xTicks: [] as XTick[], rows: [] as Array<{ rowId: string; rowLabel: string; rowItems: GanttItem[] }>, label: '' };

    const d = dayjs(periodStart);
    let periodStartDate: Date;
    let periodEndDate: Date;
    let xTicks: XTick[];
    let label: string;

    if (span === 'month') {
      periodStartDate = d.startOf('month').toDate();
      periodEndDate   = d.endOf('month').add(1, 'ms').toDate();
      label = d.format('MMMM YYYY');
      const daysInMonth = d.daysInMonth();
      const totalMs = periodEndDate.getTime() - periodStartDate.getTime();
      const tickDayNumbers = [1, 8, 15, 22, 29].filter((day) => day <= daysInMonth);
      xTicks = tickDayNumbers.map((day) => {
        const tickDate = d.date(day).startOf('day').toDate();
        return { label: String(day), pct: (tickDate.getTime() - periodStartDate.getTime()) / totalMs * 100 };
      });
    } else {
      // year
      periodStartDate = d.startOf('year').toDate();
      periodEndDate   = d.endOf('year').add(1, 'ms').toDate();
      label = d.format('YYYY');
      const totalMs = periodEndDate.getTime() - periodStartDate.getTime();
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      xTicks = monthNames.map((name, i) => {
        const tickDate = d.month(i).startOf('month').toDate();
        return { label: name, pct: (tickDate.getTime() - periodStartDate.getTime()) / totalMs * 100 };
      });
    }

    // Build rows grouped by row_id, clipped to period
    const rowMap = new Map<string, { rowId: string; rowLabel: string; rowItems: GanttItem[] }>();
    for (const item of items) {
      const start = new Date(item.start_time);
      const end   = new Date(item.end_time);
      if (start >= periodEndDate || end <= periodStartDate) continue;
      if (!rowMap.has(item.row_id)) {
        rowMap.set(item.row_id, { rowId: item.row_id, rowLabel: item.row_label, rowItems: [] });
      }
      rowMap.get(item.row_id)!.rowItems.push(item);
    }

    return { periodStartDate, periodEndDate, xTicks, rows: Array.from(rowMap.values()), label };
  }, [span, periodStart, items]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ p: 2 }}>
      {/* Navigation header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, flexWrap: 'wrap' }}>
        <Button variant="outlined" size="small" startIcon={<ChevronLeftIcon />} onClick={() => navigate(-1)}>
          {tc(backLabel)}
        </Button>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <DatePicker
            label={tc(pickerLabel)}
            value={dayjs(periodStart)}
            onChange={handleDateChange}
            views={pickerViews}
            enableAccessibleFieldDOMStructure={false}
            slotProps={{ textField: { size: 'small' } }}
          />
        </LocalizationProvider>
        <Button variant="outlined" size="small" endIcon={<ChevronRightIcon />} onClick={() => navigate(1)}>
          {tc(fwdLabel)}
        </Button>
      </Box>

      {span === 'week' ? (
        // ── Week view: one section per day with 24-hour timeline ───────────────
        <>
          {days.map((dayInfo) => {
            const dayItems = itemsByDay.get(dayInfo.key) ?? [];
            const rowIds: string[] = [];
            for (const item of dayItems) {
              if (!rowIds.includes(item.row_id)) rowIds.push(item.row_id);
            }

            return (
              <Box key={dayInfo.key} sx={{ mb: 3 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
                  {DAY_NAMES[dayInfo.dayOfWeek]}, {fmtDateShort(dayInfo.midnight, resolvedTz)}
                </Typography>

                <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                  {/* Time ruler */}
                  <Box sx={{ position: 'relative', height: 22, bgcolor: 'grey.100', borderBottom: '1px solid', borderColor: 'divider', ml: `${ROW_LABEL_WIDTH}px` }}>
                    {HOUR_TICKS.map((h) => (
                      <Box key={h} sx={{ position: 'absolute', left: `${(h / 24) * 100}%`, transform: h === 24 ? 'translateX(-100%)' : 'translateX(-50%)', fontSize: '0.6rem', color: 'text.secondary', userSelect: 'none', lineHeight: '22px' }}>
                        {String(h).padStart(2, '0')}:00
                      </Box>
                    ))}
                  </Box>

                  {rowIds.length === 0 ? (
                    <Box sx={{ px: 2, py: 1, color: 'text.disabled', fontSize: '0.8rem' }}>No items</Box>
                  ) : (
                    rowIds.map((rowId) => {
                      const rowItems = dayItems.filter((item) => item.row_id === rowId);
                      const rowLabel = rowItems[0]?.row_label ?? rowId;
                      const ci = rowColorIndex.get(rowId) ?? 0;

                      return (
                        <Box key={rowId} sx={{ display: 'flex', alignItems: 'center', minHeight: 44, borderTop: '1px solid', borderColor: 'divider' }}>
                          {/* Row label */}
                          <Box sx={{ width: ROW_LABEL_WIDTH, minWidth: ROW_LABEL_WIDTH, px: 1, fontSize: '0.78rem', fontWeight: 500, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {rowLabel}
                          </Box>

                          {/* 24-hour timeline */}
                          <Box sx={{ flex: 1, position: 'relative', height: 44 }}>
                            {/* Grid lines */}
                            {HOUR_TICKS.slice(1, -1).map((h) => (
                              <Box key={h} sx={{ position: 'absolute', left: `${(h / 24) * 100}%`, top: 0, bottom: 0, width: '1px', bgcolor: 'grey.200' }} />
                            ))}

                            {/* Bars */}
                            {rowItems.map((item) => {
                              const start = new Date(item.start_time);
                              const end   = new Date(item.end_time);
                              const fromPrevDay = start < dayInfo.midnight;
                              const toNextDay   = end > dayInfo.nextMidnight;
                              const effectiveStart = fromPrevDay ? dayInfo.midnight    : start;
                              const effectiveEnd   = toNextDay   ? dayInfo.nextMidnight : end;
                              const startMin = (effectiveStart.getTime() - dayInfo.midnight.getTime()) / 60000;
                              const endMin   = (effectiveEnd.getTime()   - dayInfo.midnight.getTime()) / 60000;
                              const leftPct  = (startMin / MINUTES_IN_DAY) * 100;
                              const widthPct = Math.max(0.3, ((endMin - startMin) / MINUTES_IN_DAY) * 100);
                              const br = `${fromPrevDay ? 0 : 3}px ${toNextDay ? 0 : 3}px ${toNextDay ? 0 : 3}px ${fromPrevDay ? 0 : 3}px`;
                              const tipSuffix = item.tooltip ? ` (${item.tooltip})` : '';
                              const tipText = `${rowLabel}: ${fmtTimeInTz(start, resolvedTz)}–${fmtTimeInTz(end, resolvedTz)}${tipSuffix}`;

                              return (
                                <Tooltip key={item.id} title={tipText} arrow>
                                  <Box sx={{ position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`, top: '15%', height: '70%', bgcolor: BAR_BG[ci], border: `2px solid ${BAR_BORDER[ci]}`, borderRadius: br, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'default', transition: 'opacity 0.15s', '&:hover': { opacity: 0.75 } }}>
                                    <Link href={`${basePath}/edit/${item.id}`} style={{ color: 'inherit', textDecoration: 'none', display: 'block', width: '100%', textAlign: 'center' }}>
                                      <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: BAR_BORDER[ci], px: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {fmtTimeInTz(start, resolvedTz)}–{fmtTimeInTz(end, resolvedTz)}
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
        </>
      ) : (
        // ── Month / Year view: flat Gantt timeline ─────────────────────────────
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            {flatData.label}
          </Typography>

          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
            {/* X-axis ruler */}
            <Box sx={{ position: 'relative', height: 22, bgcolor: 'grey.100', borderBottom: '1px solid', borderColor: 'divider', ml: `${ROW_LABEL_WIDTH}px` }}>
              {flatData.xTicks.map((tick, i) => (
                <Box key={i} sx={{ position: 'absolute', left: `${tick.pct}%`, transform: tick.pct > 90 ? 'translateX(-100%)' : 'translateX(-50%)', fontSize: '0.6rem', color: 'text.secondary', userSelect: 'none', lineHeight: '22px' }}>
                  {tick.label}
                </Box>
              ))}
            </Box>

            {/* Rows */}
            {flatData.rows.length === 0 ? (
              <Box sx={{ px: 2, py: 1, color: 'text.disabled', fontSize: '0.8rem' }}>No items</Box>
            ) : (
              flatData.rows.map(({ rowId, rowLabel, rowItems }) => {
                const ci = rowColorIndex.get(rowId) ?? 0;
                const totalMs = flatData.periodEndDate.getTime() - flatData.periodStartDate.getTime();

                return (
                  <Box key={rowId} sx={{ display: 'flex', alignItems: 'center', minHeight: 44, borderTop: '1px solid', borderColor: 'divider' }}>
                    {/* Row label */}
                    <Box sx={{ width: ROW_LABEL_WIDTH, minWidth: ROW_LABEL_WIDTH, px: 1, fontSize: '0.78rem', fontWeight: 500, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {rowLabel}
                    </Box>

                    {/* Timeline */}
                    <Box sx={{ flex: 1, position: 'relative', height: 44 }}>
                      {/* Grid lines at tick positions */}
                      {flatData.xTicks.map((tick, i) => (
                        <Box key={i} sx={{ position: 'absolute', left: `${tick.pct}%`, top: 0, bottom: 0, width: '1px', bgcolor: 'grey.200' }} />
                      ))}

                      {/* Bars */}
                      {rowItems.map((item) => {
                        const start = new Date(item.start_time);
                        const end   = new Date(item.end_time);
                        const effectiveStart = start < flatData.periodStartDate ? flatData.periodStartDate : start;
                        const effectiveEnd   = end   > flatData.periodEndDate   ? flatData.periodEndDate   : end;
                        const leftPct  = (effectiveStart.getTime() - flatData.periodStartDate.getTime()) / totalMs * 100;
                        const widthPct = Math.max(0.3, (effectiveEnd.getTime() - effectiveStart.getTime()) / totalMs * 100);
                        const tipSuffix = item.tooltip ? ` (${item.tooltip})` : '';
                        const tipText = `${rowLabel}: ${fmtDateShort(start, 'UTC')}–${fmtDateShort(end, 'UTC')}${tipSuffix}`;

                        return (
                          <Tooltip key={item.id} title={tipText} arrow>
                            <Box sx={{ position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`, top: '15%', height: '70%', bgcolor: BAR_BG[ci], border: `2px solid ${BAR_BORDER[ci]}`, borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'default', transition: 'opacity 0.15s', '&:hover': { opacity: 0.75 } }}>
                              <Link href={`${basePath}/edit/${item.id}`} style={{ color: 'inherit', textDecoration: 'none', display: 'block', width: '100%', textAlign: 'center' }}>
                                <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: BAR_BORDER[ci], px: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {item.row_label}
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
      )}
    </Box>
  );
}
