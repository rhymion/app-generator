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

// cmd_646: the ONE judgment "does this candidate belong to a different
// entity_name chain than the record being edited?" — shared verbatim by
// filterAutocompleteOptions() below (client-side narrowing, best-effort:
// missing/empty entityName degrades to "show everything", see below) and
// service_validation.ts's validateSameEntityRefs() (save-time backstop,
// authoritative: rejects the save outright). Keeping both call sites on
// this single function is what makes them provably the same check rather
// than two independently-maintained copies of the same string comparison —
// see json_schema.yaml's x-relationships.<rel>.sameEntityField comment on
// approval_flow.preceded_by for the generator-side half of this contract.
// A future entity adopting the same "sameEntityField" pattern should add
// its own isCrossEntityRef() here (or in its own lib/{{entity}}/
// autocomplete_filter.ts) with the same signature.
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
// validateSameEntityRefs() in service_validation.ts (same isCrossEntityRef
// predicate), which always runs at save time regardless of what the
// client-side filter allowed through.
export function filterAutocompleteOptions(
  context: AutocompleteFilterContext,
): Record<string, unknown> {
  if (context.callerEntity !== 'approval_flow') return {};
  const entityName = context.formValues?.entity_name;
  if (typeof entityName !== 'string' || entityName.length === 0) return {};
  return { entity_name: entityName };
}
