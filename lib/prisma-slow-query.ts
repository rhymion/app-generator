// Formats the slow-query WARN line without the bound parameter values.
// The SQL text already carries positional placeholders ($1, $2, ...), and the
// raw values may include write-only or personal data (emails, password hashes,
// API key material), so only the number of bound parameters is logged.
export function formatSlowQueryLog(e: { duration: number; query: string; params: string }): string {
  let count = 0;
  try {
    const parsed: unknown = JSON.parse(e.params);
    if (Array.isArray(parsed)) count = parsed.length;
  } catch {
    // Unparseable params: report zero rather than echo the raw string.
  }
  return `[prisma slow-query ${e.duration}ms] ${e.query} -- params=[${count} redacted]`;
}
