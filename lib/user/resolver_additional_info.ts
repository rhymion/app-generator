/**
 * Virtual column resolver for user.additional_info.
 * Generated once by generate-code — will NOT be overwritten. Customize freely.
 * Called once per list-page row to populate the virtual 'additional_info' column.
 *
 * @param row - the raw User record from the database
 * @returns string value to display in the table cell
 */
export function resolveAdditionalInfo(row: Record<string, unknown>): string {
  return `INFO-${row['id'] ?? 'unknown'}`;
}
