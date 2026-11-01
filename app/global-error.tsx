'use client'; // Required for error components

// Issue #1304 (ASVS V16.5.4): the root-level error boundary. app/[locale]/error.tsx only catches
// errors below the locale layout; this file catches an error thrown by the root layout itself and
// replaces it, so it must render its own <html> and <body>. It sits outside the locale and
// translation providers, so it uses plain, fixed English text.
//
// The page shows a generic message and the error digest only. The raw error message is never
// rendered: it can carry internal detail, and the server-side record of the error is written by
// onRequestError() in instrumentation.ts, which logs the name and digest without the message.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <h2>Something went wrong</h2>
        <p>An unexpected error occurred. Please try again.</p>
        {error.digest && (
          <p style={{ color: '#999', fontSize: '0.8em' }}>Error ID: {error.digest}</p>
        )}
        <button onClick={() => reset()}>Try again</button>
      </body>
    </html>
  );
}
