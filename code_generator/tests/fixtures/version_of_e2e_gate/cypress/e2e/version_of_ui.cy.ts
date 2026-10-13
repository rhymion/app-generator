import { TEST_CREDENTIALS } from '../../support/test-credentials';

// Permanent gate spec for the standard version list and two-version diff on the identity's
// detail screen: what the list shows, the default pair, the detail-screen field rendering,
// the "compare with current" entry from a version's own screen, read permission and
// organization isolation.
const LONG_OLD = 'The quick brown fox jumps over the lazy dog and keeps running through the forest until night falls over the hills';
const LONG_NEW = 'The quick red fox jumps over the lazy dog and keeps running through the forest until morning breaks over the hills';

type Seed = { itemId: string; v1: string; v2: string; draft: string };

function seed(withForeign = false) {
  return cy.task<{ own: string; foreign: string }>('db:voSeedOrgs', TEST_CREDENTIALS.email).then((orgs) => {
    return cy.task<string>('db:voCreateItem', 'Gadget').then((itemId) => {
      const insert = (p: object, org = orgs.own) => cy.task<string>('db:voInsertVersion', { itemId, orgId: org, ...p });
      return insert({ title: 'First', notes: LONG_OLD, versionNo: 1, lines: ['a', 'b'] }).then((v1) =>
        insert({ title: 'Second', notes: LONG_NEW, versionNo: 2, current: true, lines: ['a', 'c'] }).then((v2) =>
          (withForeign
            ? insert({ title: 'Foreign draft', versionNo: null }, orgs.foreign)
            : insert({ title: 'Third', notes: LONG_NEW, versionNo: null, lines: ['a'] })
          ).then((draft) => ({ itemId, v1, v2, draft }) as Seed),
        ),
      );
    });
  });
}

describe('x-version-of: version list and diff', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    cy.task('db:setupVoApprover', TEST_CREDENTIALS.email);
    Cypress.session.clearAllSavedSessions();
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  it('lists every version, drafts included, and opens the draft against the current version', () => {
    seed().then((s) => {
      cy.visit(`/vo_item/view/${s.itemId}`);
      cy.get('[data-testid="version-history-list"]').should('be.visible');
      [s.v1, s.v2, s.draft].forEach((id) => cy.get(`[data-testid="version-row-${id}"]`).should('exist'));
      cy.get(`[data-testid="version-row-${s.draft}"]`).should('contain.text', 'Draft');
      cy.get(`[data-testid="version-row-${s.v2}"]`).should('contain.text', 'Current');
      // default pair: current version against the open draft
      cy.get('[data-testid="version-diff"]').should('be.visible');
      cy.get('[data-testid="diff-field-title"]').should('have.attr', 'data-changed', 'true');
      cy.get('[data-testid="diff-field-title"] input').then(($i) => {
        expect([...$i].map((e) => (e as HTMLInputElement).value)).to.deep.eq(['Second', 'Third']);
      });
    });
  });

  it('renders each field like the detail screen and word-diffs long text', () => {
    seed().then((s) => {
      cy.visit(`/vo_item/view/${s.itemId}`);
      cy.get(`[data-testid="version-row-${s.v1}"]`).contains('button', 'Compare').click();
      cy.get('[data-testid="diff-field-title"] input').then(($i) => {
        expect([...$i].map((e) => (e as HTMLInputElement).value)).to.deep.eq(['Second', 'First']);
      });
      cy.get('[data-testid="diff-field-notes"]').should('have.attr', 'data-changed', 'true');
      cy.get('[data-testid="diff-words-notes"] [data-kind="removed"]').should('contain.text', 'red');
      cy.get('[data-testid="diff-words-notes"] [data-kind="added"]').should('contain.text', 'brown');
      // the child rows have no declared key or order: additions and removals only
      cy.get('[data-testid="diff-rows-unmatched"]').should('exist');
      cy.get('[data-testid="diff-children-vo_item_version_lines"] [data-status="added"]').should('exist');
      cy.get('[data-testid="diff-children-vo_item_version_lines"] [data-status="removed"]').should('exist');
    });
  });

  it('opens the same diff from "compare with current" on a version\'s own screen', () => {
    seed().then((s) => {
      cy.visit(`/vo_item_version/view/${s.draft}`);
      cy.get('[data-testid="compare-with-current"]').click();
      cy.url().should('include', `/vo_item/view/${s.itemId}`).and('include', `compare=${s.draft}`);
      cy.get('[data-testid="diff-field-title"] input').then(($i) => {
        expect([...$i].map((e) => (e as HTMLInputElement).value)).to.deep.eq(['Second', 'Third']);
      });
    });
  });

  it('shows no version list to a role without read permission on the version entity', () => {
    seed().then((s) => {
      cy.task('db:voRevokeVersionRead');
      cy.visit(`/vo_item/view/${s.itemId}`);
      cy.get('[data-testid="version-history-list"]').should('not.exist');
      cy.get('[data-testid="version-diff"]').should('not.exist');
      cy.contains('Third').should('not.exist');
    });
  });

  it('never shows another organization\'s version, even through a crafted compare link', () => {
    seed(true).then((s) => {
      cy.visit(`/vo_item/view/${s.itemId}?compare=${s.draft}`);
      cy.get('[data-testid="version-history-list"]').should('be.visible');
      cy.get(`[data-testid="version-row-${s.draft}"]`).should('not.exist');
      cy.contains('Foreign draft').should('not.exist');
      [s.v1, s.v2].forEach((id) => cy.get(`[data-testid="version-row-${id}"]`).should('exist'));
    });
  });
});
