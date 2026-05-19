'use server';

import prisma from '@/lib/prisma';
import { requirePermission, getSessionUserIdOrThrow } from '@/lib/authz';
import dayjs from 'dayjs';
import utcPlugin from 'dayjs/plugin/utc';
import timezonePlugin from 'dayjs/plugin/timezone';

dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);

type TxClient = Pick<typeof prisma, 'shift'>;

/** Extract local {h, m, s} from a Timetz Date (stored UTC-normalized at epoch 1970-01-01). */
function localTimeIn(date: Date, tz: string): { h: number; m: number; s: number } {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  return { h: get('hour') % 24, m: get('minute'), s: get('second') };
}

export type CopyShiftsResult = {
  success: number;
  failures: { label: string; reason: string }[];
};

async function hasShiftOverlap(
  client: TxClient,
  userId: string,
  startTime: Date,
  endTime: Date,
): Promise<boolean> {
  // Get the latest shift for this user that started before this shift's start time
  const prevShift = await client.shift.findFirst({
    where: { user_id: userId, start_time: { lt: startTime } },
    orderBy: { start_time: 'desc' },
    select: { end_time: true },
  });
  if (prevShift && prevShift.end_time > startTime) return true;

  // Get the earliest shift for this user that starts at or after this shift's start time
  const nextShift = await client.shift.findFirst({
    where: { user_id: userId, start_time: { gte: startTime } },
    orderBy: { start_time: 'asc' },
    select: { start_time: true },
  });
  if (nextShift && nextShift.start_time < endTime) return true;

  return false;
}

export async function copyShiftTemplatesToShifts(
  startDateStr: string,
  endDateStr: string,
  timeZone: string = 'UTC',
): Promise<CopyShiftsResult> {
  await requirePermission('shift_template', 'create');
  const userId = await getSessionUserIdOrThrow();

  // Iterate day by day in the specified timezone
  const startDay = dayjs.tz(startDateStr, timeZone);
  const endDay = dayjs.tz(endDateStr, timeZone);

  const templates = await prisma.shift_template.findMany({
    include: { user: { select: { name: true } } },
  });

  let success = 0;
  const failures: { label: string; reason: string }[] = [];

  for (
    let current = startDay;
    !current.isAfter(endDay, 'day');
    current = current.add(1, 'day')
  ) {
    const dayOfWeek = current.day(); // 0 = Sunday, same convention as JS Date
    const dayTemplates = templates.filter((t) => t.day_of_week === dayOfWeek);

    for (const template of dayTemplates) {
      // Timetz values are stored as UTC-normalized Dates at epoch 1970-01-01.
      // e.g. "8:00 AM JST" is stored as 1970-01-01T23:00:00Z.
      // We must extract the LOCAL hour/minute/second in the user's timezone.
      const startLocal = localTimeIn(template.start_time, timeZone);
      const endLocal = localTimeIn(template.end_time, timeZone);

      // Overnight: start is later in the day than end (in local time)
      const isOvernight = (startLocal.h * 60 + startLocal.m) > (endLocal.h * 60 + endLocal.m);

      // Apply local time to the current date in the timezone
      const shiftStart = current
        .hour(startLocal.h).minute(startLocal.m).second(startLocal.s).millisecond(0)
        .toDate();

      const nextDay = current.add(1, 'day');
      const shiftEnd = isOvernight
        ? nextDay.hour(endLocal.h).minute(endLocal.m).second(endLocal.s).millisecond(0).toDate()
        : current.hour(endLocal.h).minute(endLocal.m).second(endLocal.s).millisecond(0).toDate();

      const userName = template.user?.name ?? template.user_id;
      const label = `${userName} on ${current.format('YYYY-MM-DD')}`;

      try {
        await prisma.$transaction(async (tx) => {
          if (await hasShiftOverlap(tx, template.user_id, shiftStart, shiftEnd)) {
            throw new Error('Shift time overlaps with an existing shift for this user');
          }
          await tx.shift.create({
            data: {
              user_id: template.user_id,
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