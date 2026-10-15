// Server-side read of the business date. The rules and the pure date math live in business-date-core.ts.
import prisma from '@/lib/prisma';
import { businessContextOf, type BusinessContext } from '@/lib/business-date-core';

export * from '@/lib/business-date-core';

export interface BusinessContextOptions {
  /** The caller's organization: its own row wins over the tenant-wide default row. Omit for tenant-wide callers. */
  organizationId?: string | null;
  /** Injected clock (tests). Defaults to the current time. */
  now?: Date;
}

/**
 * The single read of the business date. Row choice: the organization's own `app_setting` row when
 * `organizationId` is given and the organization has one, otherwise the tenant-wide default row
 * (`organization_id` NULL), otherwise no row (UTC today). Scheduled tasks are tenant-wide, so they pass no
 * organization and always read the default row.
 */
export async function getBusinessContext(options: BusinessContextOptions = {}): Promise<BusinessContext> {
  const select = { business_date: true, is_pinned: true, timezone: true } as const;
  const own = options.organizationId
    ? await prisma.app_setting.findUnique({ where: { organization_id: options.organizationId }, select })
    : null;
  const row = own ?? (await prisma.app_setting.findFirst({ where: { organization_id: null }, select }));
  return businessContextOf(row, options.now);
}

/** The business date alone; see `getBusinessContext`. */
export async function getBusinessDate(options: BusinessContextOptions = {}): Promise<Date> {
  return (await getBusinessContext(options)).businessDate;
}
