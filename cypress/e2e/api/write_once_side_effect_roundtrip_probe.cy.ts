// cmd_941 gate 2: verifies the write-once side-effect round-trip probe
// itself (snapshotOtherModels()/diffTouchedModels() in
// cypress/support/db-helpers.ts, exposed here via the db:snapshotOtherModels
// task) — the mechanism a per-entity round-trip test is built on, not a
// specific entity's hook (no entity in this dogfood schema currently
// implements service_after_update.ts — see docs/knowledge/write-once-side-
// effect-roundtrip-test.md for why this file tests the probe directly
// instead of a per-entity spec, and for the worked example of wiring it to
// a real hook once one exists).
//
// The two cases below are exactly the two outcomes gate 2's actual
// assertion (in a real per-entity spec) depends on:
//   - "another model was touched" must be detected (T1) — the forward-edit
//     half of the round trip.
//   - "no other model was touched" must be detected too (T2) — this is the
//     one-way-hook failure signal a real spec asserts did NOT happen on the
//     revert-edit half. A probe that can't tell these apart is not a gate.
import { TEST_CREDENTIALS } from '../../support/test-credentials';

describe('Write-once side-effect round-trip probe (cmd_941 gate 2)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    Cypress.session.clearAllSavedSessions();
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  it('T1: an operation that writes to other models is detected as touching them', () => {
    cy.task<Record<string, string>>('db:snapshotOtherModels', 'organization').then((before) => {
      // db:grantAllPermissions creates a role row and one permission row
      // per entity — an implicit many-to-many `connect` (role <-> user)
      // writes only to Prisma's hidden join table, not to `user`'s own
      // columns, so `user` is deliberately not asserted here even though
      // grantAllEntityPermissions() does touch it relationally. None of
      // this touches `organization`, so excluding it below is deliberate:
      // we are proving the probe sees writes to *other* models, not a
      // self-write.
      cy.task('db:grantAllPermissions');
      cy.task<Record<string, string>>('db:snapshotOtherModels', 'organization').then((after) => {
        // Diffing is plain object comparison in the spec itself — no task
        // round trip needed, since snapshotOtherModels() already returns
        // serialized, order-independent strings per model. This is the
        // same comparison db-helpers.ts's diffTouchedModels() does; that
        // export exists for Node-side callers (e.g. a future cy.task that
        // wants to return the diff pre-computed instead of the raw
        // snapshots) rather than for spec files, which never run in Node.
        const touched = Object.keys(before).filter((model) => before[model] !== after[model]);
        expect(touched).to.include('role');
        expect(touched).to.include('permission');
      });
    });
  });

  it('T2: no writes between two snapshots is detected as touching nothing (the one-way-hook failure signal)', () => {
    cy.task<Record<string, string>>('db:snapshotOtherModels', 'organization').then((before) => {
      cy.task<Record<string, string>>('db:snapshotOtherModels', 'organization').then((after) => {
        expect(Object.keys(before)).to.have.length.greaterThan(0);
        expect(after).to.deep.equal(before);
      });
    });
  });
});
