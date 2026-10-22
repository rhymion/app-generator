'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import AppFieldSelect from '@/components/ui/forms/AppFieldSelect';
import { TIMEZONE_VALUES, type Timezone } from '@/lib/_timezone';

interface Props {
  label: React.ReactNode;
  value: string | null;
  onChange: (tz: Timezone | null) => void;
  required?: boolean;
}

// Options are the `Timezone` enum members; labels come from the `Timezone` namespace of
// messages/*.json. The IANA spelling is never shown or stored here -- computing with a zone goes
// through TIMEZONE_IANA_NAME in lib/_timezone.ts.
export default function TimeZoneSelect({ label, value, onChange, required }: Props) {
  const t = useTranslations('Timezone');
  const options = useMemo(
    () => TIMEZONE_VALUES.map((tz) => ({ value: tz, label: t(tz) })),
    [t],
  );
  return (
    <AppFieldSelect
      label={label}
      options={options}
      value={options.find((o) => o.value === value) ?? null}
      onChange={onChange}
      required={required}
    />
  );
}
