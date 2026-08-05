// GENERATED ONCE — safe to edit (will not be overwritten on regeneration)
// List query filter for dashboard.
//
// filterListQuery() returns a WHERE contribution that is ANDed after the
// existing authorization (accessAnd) and column-filter (filterAnd) clauses
// inside getDashboardPage() — it can only NARROW the result set,
// never widen or replace the authorization scope.
//
// WARNING: `queryParams` are untrusted client input (parsed from the list
// page's URL search params). Use them only to narrow results. Never use
// them to widen the result set or to bypass authorization.
export function filterListQuery(
  _queryParams: Record<string, unknown>,
): Record<string, unknown> {
  return {};
}
