// app/dashboard/error.tsx
'use client'; // Required for error components

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service (e.g., Sentry)
    console.error(error);
  }, [error]);

  return (
    <div>
      <h2>Something went wrong!</h2>
      {error.message && (
        <p style={{ color: '#555', margin: '0.5rem 0' }}>{error.message}</p>
      )}
      {error.digest && (
        <p style={{ color: '#999', fontSize: '0.8em' }}>Error ID: {error.digest}</p>
      )}
      <button onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
