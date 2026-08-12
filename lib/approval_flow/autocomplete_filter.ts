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

// cmd_652 (corrected from cmd_646 — see docs/knowledge/
// same-entity-validation-socket.md): the ONE judgment "does this candidate
// belong to a different entity_name chain than the record being edited?".
// This is hand-written business content — it does NOT come from
// json_schema.yaml or any *.jinja2 template; the generator only knows to
// call filterAutocompleteOptions()/validateCustomRules() unconditionally
// and to expose live form values / connected child ids for this file to
// use however it needs (see build_context.py / generators.py comments).
//
// filterAutocompleteOptions() below expresses this rule as a Prisma WHERE
// equality (a query predicate — there is no per-row candidate value at
// query-construction time, so it can't call this function directly).
// service_validation_custom.ts's validateCustomRules() expresses the exact
// same rule as a per-row check AFTER fetching the linked rows, and calls
// this function directly for that comparison. Both live in this one
// hand-written place so a future change to the rule only needs one edit.
export function isCrossEntityRef(entityName: string, relatedEntityName: string): boolean {
  return entityName !== relatedEntityName;
}

// approval_flow's preceded_by / followed_by are a self-referential m2m: an
// approval_flow row's predecessor/successor is only ever meaningful within
// the same entity_name chain (the standard use case is a multi-stage
// approval sequence for ONE entity type, e.g. purchase_order: draft role ->
// manager role -> finance role — mixing entity_name values would link
// unrelated approval chains together). Cross-entity_name candidates are
// filtered out here rather than merely hidden in the UI, so the narrowing
// also applies to server-side create/update validation paths that reuse
// this same search.
//
// entityName empty/absent (CREATE mode before the user has picked an
// entity_name, or any other caller that hasn't supplied one) intentionally
// falls through to "show everything" (Option B, cmd_646 D1) rather than
// disabling/hiding preceded_by/followed_by — there is no existing
// generator mechanism to conditionally disable a child list based on a
// sibling field's value, and bolting one on for this one case would not be
// a reusable template. Safety in that window is provided entirely by
// validateCustomRules() in service_validation_custom.ts (same
// isCrossEntityRef predicate), which always runs at save time regardless of
// what the client-side filter allowed through.
export function filterAutocompleteOptions(
  context: AutocompleteFilterContext,
): Record<string, unknown> {
  if (context.callerEntity !== 'approval_flow') return {};
  const entityName = context.formValues?.entity_name;
  if (typeof entityName !== 'string' || entityName.length === 0) return {};
  return { entity_name: entityName };
}
