'use server';

import prisma from '@/lib/prisma';
import { requirePermission, getSessionUserIdOrThrow } from '@/lib/authz';

type TxClient = Pick<typeof prisma, 'shift'>;

export type CopyShiftsResult = {
  success: number;
  failures: { label: string; reason: string }[];
};

async function hasShiftOverlap(
  client: TxClient,
  userAccountId: string,
  startTime: Date,
  endTime: Date,
): Promise<boolean> {
  // Get the latest shift for this user that started before this shift's start time
  const prevShift = await client.shift.findFirst({
    where: { user_account_id: userAccountId, start_time: { lt: startTime } },
    orderBy: { start_time: 'desc' },
    select: { end_time: true },
  });
  if (prevShift && prevShift.end_time > startTime) return true;

  // Get the earliest shift for this user that starts at or after this shift's start time
  const nextShift = await client.shift.findFirst({
    where: { user_account_id: userAccountId, start_time: { gte: startTime } },
    orderBy: { start_time: 'asc' },
    select: { start_time: true },
  });
  if (nextShift && nextShift.start_time < endTime) return true;

  return false;
}

export async function copyShiftTemplatesToShifts(
  startDateStr: string,
  endDateStr: string,
): Promise<CopyShiftsResult> {
  await requirePermission('shift_template', 'create');
  const userId = await getSessionUserIdOrThrow();

  const startDate = new Date(startDateStr + 'T00:00:00Z');
  const endDate = new Date(endDateStr + 'T00:00:00Z');

  const templates = await prisma.shift_template.findMany({
    include: { user_account: { select: { name: true } } },
  });

  let success = 0;
  const failures: { label: string; reason: string }[] = [];

  for (
    let current = new Date(startDate);
    current <= endDate;
    current = new Date(current.getTime() + 86400000)
  ) {
    const dayOfWeek = current.getUTCDay();
    const dayTemplates = templates.filter((t) => t.day_of_week === dayOfWeek);

    for (const template of dayTemplates) {
      // Timetz values are stored as Date objects with epoch date (1970-01-01) and time in UTC
      const isOvernight = template.start_time.getTime() > template.end_time.getTime();

      const shiftStart = new Date(
        Date.UTC(
          current.getUTCFullYear(),
          current.getUTCMonth(),
          current.getUTCDate(),
          template.start_time.getUTCHours(),
          template.start_time.getUTCMinutes(),
          template.start_time.getUTCSeconds(),
        ),
      );

      // Overnight shift: end time is on the next day (allowed even if next day > endDate)
      const shiftEnd = isOvernight
        ? new Date(
            Date.UTC(
              current.getUTCFullYear(),
              current.getUTCMonth(),
              current.getUTCDate() + 1,
              template.end_time.getUTCHours(),
              template.end_time.getUTCMinutes(),
              template.end_time.getUTCSeconds(),
            ),
          )
        : new Date(
            Date.UTC(
              current.getUTCFullYear(),
              current.getUTCMonth(),
              current.getUTCDate(),
              template.end_time.getUTCHours(),
              template.end_time.getUTCMinutes(),
              template.end_time.getUTCSeconds(),
            ),
          );

      const userName = template.user_account?.name ?? template.user_account_id;
      const dateStr = current.toISOString().slice(0, 10);
      const label = `${userName} on ${dateStr}`;

      try {
        await prisma.$transaction(async (tx) => {
          if (await hasShiftOverlap(tx, template.user_account_id, shiftStart, shiftEnd)) {
            throw new Error('Shift time overlaps with an existing shift for this user');
          }
          await tx.shift.create({
            data: {
              user_account_id: template.user_account_id,
              start_time: shiftStart,
              end_time: shiftEnd,
              status: 0,
              creator_id: userId,
              updater_id: userId,
            },
          });
        });
        success++;
      } catch (error) {
        failures.push({
          label,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  return { success, failures };
}
