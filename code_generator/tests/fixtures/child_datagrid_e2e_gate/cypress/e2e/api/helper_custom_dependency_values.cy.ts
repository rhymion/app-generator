// The generated test helper of hook_slot passes every dependency row it creates, and the
// find-or-create lookup that may reuse one, through the hand-written
// cypress/support/hook_slot/helper_custom.ts (custom_helper/hook_slot.ts in this fixture).
// That file makes the `unit` dependency 'composite'; hook_unit.kind defaults to 'atomic'
// and `second_unit` is left alone.
type Unit = { id: string; name: string; kind: string };
type Slot = { unit_id: string; second_unit_id: string | null };

const unitById = (units: Unit[], id: string) => units.find((u) => u.id === id)!;

describe('generated test helper: hand-written dependency values', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
  });

  it('creates the unit dependency with the hand-written value and keeps the default elsewhere', () => {
    cy.task('db:populateHookSlotFull', 1).then((rows) => {
      const slot = (rows as Slot[])[0];
      cy.task('db:getHookUnits').then((units) => {
        expect(unitById(units as Unit[], slot.unit_id).kind).to.eq('composite');
        if (slot.second_unit_id) {
          expect(unitById(units as Unit[], slot.second_unit_id).kind).to.eq('atomic');
        }
      });
    });
  });

  it('does not reuse a row that matches the lookup name only with the default value', () => {
    cy.task('db:insertHookUnit', { name: 'Test Unit A', kind: 'atomic' }).then((atomicId) => {
      cy.task('db:populateHookSlot', 1).then((rows) => {
        const slot = (rows as Slot[])[0];
        expect(slot.unit_id).to.not.eq(atomicId);
        cy.task('db:getHookUnits').then((units) => {
          expect(unitById(units as Unit[], slot.unit_id).kind).to.eq('composite');
          // the pre-existing atomic row is untouched
          expect(unitById(units as Unit[], atomicId as string).kind).to.eq('atomic');
        });
      });
    });
  });

  it('reuses its own composite row on a second call', () => {
    cy.task('db:populateHookSlot', 1).then((first) => {
      cy.task('db:populateHookSlot', 1).then((second) => {
        expect((second as Slot[])[0].unit_id).to.eq((first as Slot[])[0].unit_id);
      });
    });
  });
});
