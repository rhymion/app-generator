import { getShiftsForChart } from '@/lib/shift/chart-getters';
import ShiftGanttChart from '@/components/shift/ShiftGanttChart';

function parseWeekStart(dateStr: string | undefined): Date {
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    // Parse as UTC midnight so the date string is preserved exactly
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
  }
  // Default: most recent Sunday in UTC
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOfWeek));
}

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function ShiftChartPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; tz?: string }>;
}) {
  const { start, tz } = await searchParams;
  const weekStart = parseWeekStart(start);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  // Add 1-day buffer on each side so any client timezone can correctly display
  // the full 7-day window without missing boundary shifts.
  const queryStart = new Date(weekStart.getTime() - DAY_MS);
  const queryEnd = new Date(weekStart.getTime() + 8 * DAY_MS);

  const shifts = await getShiftsForChart(queryStart, queryEnd);

  return <ShiftGanttChart shifts={shifts} weekStart={weekStartStr} timeZone={tz ?? ''} />;
}
