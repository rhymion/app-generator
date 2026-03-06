import { getShiftsForChart } from '@/lib/shift/chart-getters';
import GanttChart from '@/components/GanttChart';
import type { GanttItem } from '@/components/GanttChart';
import { getTranslations } from 'next-intl/server';

function parsePeriodStart(dateStr: string | undefined): Date {
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const now = new Date();
  const dow = now.getUTCDay();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
}

export default async function ShiftChartPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  const ts = await getTranslations('ShiftStatus');
  const { start } = await searchParams;
  const periodStart = parsePeriodStart(start);
  const periodStartStr = periodStart.toISOString().slice(0, 10);
  const DAY_MS = 86400000;
  const queryStart = new Date(periodStart.getTime() - DAY_MS);
  const queryEnd   = new Date(periodStart.getTime() + 8 * DAY_MS);
  const items = await getShiftsForChart(queryStart, queryEnd);
  const statusLabels = [ts('scheduled'), ts('approved'), ts('cancelled')];
  const ganttItems: GanttItem[] = items.map((item) => ({
    id: item.id,
    start_time: item.start_time,
    end_time: item.end_time,
    row_id: item.user_account_id,
    row_label: item.user_account_name,
    tooltip: statusLabels[item.status as number] ?? String(item.status),
  }));

  return (
    <GanttChart
      items={ganttItems}
      periodStart={periodStartStr}
      span="week"
      basePath="/shift"
    />
  );
}
