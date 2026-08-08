// GENERATED ONCE — safe to edit (will not be overwritten on regeneration)
// Autocomplete candidate filter for approval_flow.
//
// filterAutocompleteOptions() returns a WHERE contribution that is ANDed
// after the existing authorization (accessAnd) and search-token (matchOr)
// clauses inside searchApprovalFlowOptions() — it can only NARROW the
// candidate set, never widen or replace the authorization scope.
//
// WARNING: `context.formValues` is untrusted client input. Use it only to
// narrow results (e.g. filter by a sibling FK selected in the same form).
// Never use it to widen the result set or to bypass authorization.
export type AutocompleteFilterContext = {
  callerEntity?: string;
  formValues?: Record<string, unknown>;
};

// approval_flow's preceded_by / followed_by are a self-referential m2m: an
// approval_flow row's predecessor/successor is only ever meaningful within
// the same entity_name chain (the standard use case is a multi-stage
// approval sequence for ONE entity type, e.g. purchase_order: draft role ->
// manager role -> finance role — mixing entity_name values would link
// unrelated approval chains together). Cross-entity_name candidates are
// filtered out here rather than merely hidden in the UI, so the narrowing
// also applies to server-side create/update validation paths that reuse
// this same search.
export function filterAutocompleteOptions(
  context: AutocompleteFilterContext,
): Record<string, unknown> {
  if (context.callerEntity !== 'approval_flow') return {};
  const entityName = context.formValues?.entity_name;
  if (typeof entityName !== 'string' || entityName.length === 0) return {};
  return { entity_name: entityName };
}
