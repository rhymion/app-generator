import { useState, useEffect, useMemo } from 'react';
import { checkBookingOverlap } from '@/lib/booking/service_validation';
import type { Dayjs } from 'dayjs';

export function useFormValidation(values: Record<string, unknown>): string | null {
  const { resource_id, start_time, end_time, isEdit, id } = values as {
    resource_id: string | null;
    start_time: Dayjs | null;
    end_time: Dayjs | null;
    isEdit: boolean;
    id: string;
  };

  const syncError = useMemo(() => {
    if (!resource_id || !start_time || !end_time) return null;
    if (start_time.isAfter(end_time) || start_time.isSame(end_time)) return 'Start time must be before end time';
    return null;
  }, [resource_id, start_time, end_time]);

  const [asyncError, setAsyncError] = useState<string | null>(null);

  useEffect(() => {
    if (syncError !== null || !resource_id || !start_time || !end_time) return;
    let cancelled = false;
    const excludeId = isEdit ? id : null;
    checkBookingOverlap(resource_id, start_time.toISOString(), end_time.toISOString(), excludeId)
      .then((hasOverlap) => {
        if (!cancelled) setAsyncError(hasOverlap ? 'Booking time overlaps with an existing booking for this resource' : null);
      })
      .catch(() => { if (!cancelled) setAsyncError(null); });
    return () => { cancelled = true; };
  }, [syncError, resource_id, start_time, end_time, isEdit, id]);

  return syncError ?? asyncError;
}