// GENERATED ONCE — safe to edit (will not be overwritten on regeneration)
// Custom save-time validation for organization.
//
// validateCustomRules() is called unconditionally from validateOnAdd()/
// validateOnUpdate() (see lib/organization/service_validation.ts), after the
// generated schema-driven checks (required fields, one-to-one uniqueness).
// Throw an Error to reject the save — the message surfaces to the caller
// (UI form or direct API request) as the save failure.
//
// `data` is the same raw create/update payload service_validation.ts
// receives, including every connect-style (many-to-many / optional-FK-list)
// child's selected id array under its property name (e.g. a self-ref m2m
// child exposes its linked ids as `data.<property_name>: string[]`) —
// see build_context.py's validation_data_obj for what is exposed.
//
// `prevRow` (cmd_834) is the row as it stood BEFORE this write -- the full
// current record, fetched once in updateOrganization() and reused
// both for this call and (on entities with an x-approval edge trigger) the
// approval transition check, so it costs a single findUnique, not two. On
// create it is always null (there is no previous row to read). Use it to
// reject a save based on what a field WAS, e.g. "status may not change once
// it reaches 'closed'" -- something `data` alone (the submitted values)
// cannot answer. See docs/knowledge/pre-edit-row-handoff-to-custom-validation.md.
//
// This predicate runs server-side only -- a UI that wants to disable the
// field being guarded here (rather than letting the user edit it and only
// failing on save) should export a second, plain function alongside this
// one, e.g. a synchronous `forbiddenFieldsFor(prevRow)` returning the field
// keys this rule currently locks, and call it from both this file and the
// client form. No such bridge is generated yet (cmd_834 leaves that for
// whenever the same shape of hand-written rule shows up on more than one
// entity) -- this note only keeps the door open.
//
// Default (unedited) stub is a no-op. Cast `tx` to your own Prisma
// transaction-client type as needed, e.g.:
//   import type { PrismaClient } from '@/app/generated/prisma/client';
//   type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
// Generator regression fixture: an organization's description carrying the
// marker below may not be cleared. Scoped to that marker -- not "any
// non-empty description" -- deliberately: this generated entity's own
// standard Cypress CRUD spec (cypress/e2e/organization.cy.ts, "removes
// optional data and child items") always populates every optional field
// including description via db:populateOrganizationFull and then clears it
// as routine coverage that optional fields really are optional. A rule
// keyed on "any non-empty description" fires on that fixture data too and
// breaks a spec this file has no business touching; keying on a marker no
// generated fixture ever produces keeps the two fully independent while
// still genuinely exercising prevRow: "clearing an existing value" is only
// distinguishable from "never had one" by comparing the submitted value
// against what the row held BEFORE this write -- `data` alone (the value
// being submitted) cannot answer that on its own.
// See test/flows/pre_edit_row_custom_validation.test.ts for the real-DB
// regression test this line exists to keep green, and
// docs/knowledge/pre-edit-row-handoff-to-custom-validation.md for the
// mechanism this fixture exercises.
const LOCK_MARKER = 'PRE_EDIT_ROW_FIXTURE_LOCKED';

export async function validateCustomRules(
  _tx: unknown,
  data: Record<string, unknown>,
  _currentId: string | null,
  prevRow: Record<string, unknown> | null,
): Promise<void> {
  const hadLockedDescription = typeof prevRow?.description === 'string' && prevRow.description.includes(LOCK_MARKER);
  if (!hadLockedDescription) return;

  const incoming = data.description;
  const stillLocked = typeof incoming === 'string' && incoming.includes(LOCK_MARKER);
  if (!stillLocked) {
    throw new Error('description cannot be cleared once locked');
  }
}
