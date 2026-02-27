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

export default async function ShiftChartPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  const { start } = await searchParams;
  const weekStart = parseWeekStart(start);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const shifts = await getShiftsForChart(weekStart, weekEnd);

  // Pass as plain "YYYY-MM-DD" so the client parses it as local midnight
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  return <ShiftGanttChart shifts={shifts} weekStart={weekStartStr} />;
}
