// app/dashboard/error.tsx
'use client'; // Required for error components

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('Errors');

  useEffect(() => {
    // Log the error to an error reporting service (e.g., Sentry)
    console.error(error);
  }, [error]);

  return (
    <div>
      <h2>{t('pageError')}</h2>
      {error.message && (
        <p style={{ color: '#555', margin: '0.5rem 0' }}>{error.message}</p>
      )}
      {error.digest && (
        <p style={{ color: '#999', fontSize: '0.8em' }}>Error ID: {error.digest}</p>
      )}
      <button onClick={() => reset()}>
        {t('tryAgain')}
      </button>
    </div>
  );
}
