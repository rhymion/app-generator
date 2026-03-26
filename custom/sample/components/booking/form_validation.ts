import { useState, useEffect } from 'react';
import { checkBookingOverlap } from '@/lib/booking/service_validation';
import type { Dayjs } from 'dayjs';

export function useFormValidation(values: Record<string, unknown>): string | null {
  const [error, setError] = useState<string | null>(null);
  const { resource_id, start_time, end_time, isEdit, id } = values as {
    resource_id: string | null;
    start_time: Dayjs | null;
    end_time: Dayjs | null;
    isEdit: boolean;
    id: string;
  };

  useEffect(() => {
    if (!resource_id || !start_time || !end_time) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(null);
      return;
    }
    if (start_time.isAfter(end_time) || start_time.isSame(end_time)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('Start time must be before end time');
      return;
    }
    const excludeId = isEdit ? id : null;
    checkBookingOverlap(resource_id, start_time.toISOString(), end_time.toISOString(), excludeId)
      .then((hasOverlap) => {
        setError(hasOverlap ? 'Booking time overlaps with an existing booking for this resource' : null);
      })
      .catch(() => setError(null));
  }, [resource_id, start_time, end_time, isEdit, id]);

  return error;
}