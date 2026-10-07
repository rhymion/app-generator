import { TEST_CREDENTIALS } from '../../support/test-credentials';

// Shared by inline_create.cy.ts (desktop) and inline_create_mobile.cy.ts (phone width).
//
// inline_note.inline_topic_id declares x-create-inline, so the note's form offers "Create new"
// beside the topic field. The dialog shows inline_topic's own generated form, which saves
// through inline_topic's own upsert action: required organisation, organisation membership and
// create permission are all that action's checks, not the dialog's.
const CREATE = 'Create new Inline Topic';
const NOTICE = 'A new Inline Topic was created. It stays even if this form is not saved.';

const dialog = () => cy.get('div[role="dialog"]').filter(':contains("Create new")').first();

// Everything is written before the sign-in: the permissions a session resolves are cached, so a
// grant made after the first page load might not be seen.
function start(options: { topicCreate: boolean; viewport?: { width: number; height: number } }) {
  cy.task('db:reset');
  cy.task('db:seed');
  cy.task('db:grantAllPermissions');
  cy.task('db:grantInlinePermissions', { topicCreate: options.topicCreate });
  cy.task<{ orgA: string; orgB: string }>('db:setupInlineOrganizations').as('orgs');
  Cypress.session.clearAllSavedSessions();
  cy.clearCookies();
  cy.clearLocalStorage();
  if (options.viewport) cy.viewport(options.viewport.width, options.viewport.height);
  cy.visit('/en/');
  cy.window().then((win) => { win.sessionStorage.clear(); });
  cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
}

function openNewNote() {
  cy.visit('/en/inline_note/new');
  cy.get('button[aria-label="Save"]').should('be.visible');
}

function saveInDialog() {
  dialog().within(() => {
    cy.get('button[aria-label="Save"]').click();
  });
}

function fillDialogTopic(name: string, organization: string) {
  dialog().within(() => {
    cy.fillField('Name', name);
    cy.selectAutocomplete('Organization', organization);
  });
}

export function defineInlineCreateFlows(viewport?: { width: number; height: number }) {
  it('creates the topic in a dialog and selects it in the note, without leaving the form', () => {
    start({ topicCreate: true, viewport });
    openNewNote();
    cy.clickButton(CREATE);
    fillDialogTopic('Dialog Topic', 'Inline Org A');
    saveInDialog();
    cy.get('div[role="dialog"]').should('not.exist');
    cy.url().should('match', /\/inline_note\/new$/);
    cy.checkField('Inline Topic', 'Dialog Topic');
    cy.contains(NOTICE).should('be.visible');
    cy.fillField('Title', 'Note with a new topic');
    cy.clickButton('Save');
    cy.url().should('match', /\/inline_note$/);
    cy.task<any[]>('db:getInlineTopics').then((topics) => {
      expect(topics).to.have.length(1);
      expect(topics[0].name).to.equal('Dialog Topic');
      cy.task<any[]>('db:getInlineNotes').then((notes) => {
        expect(notes).to.have.length(1);
        expect(notes[0].inline_topic_id).to.equal(topics[0].id);
      });
    });
  });

  it('cancelling the dialog creates nothing and leaves the field empty', () => {
    start({ topicCreate: true, viewport });
    openNewNote();
    cy.clickButton(CREATE);
    fillDialogTopic('Cancelled Topic', 'Inline Org A');
    dialog().within(() => {
      cy.get('button[aria-label="Cancel"]').click();
    });
    cy.get('div[role="dialog"]').should('not.exist');
    cy.checkField('Inline Topic', '');
    cy.contains(NOTICE).should('not.exist');
    cy.task<any[]>('db:getInlineTopics').should('have.length', 0);
  });

  it('keeps the created topic when the note form is left without saving, and said so', () => {
    start({ topicCreate: true, viewport });
    openNewNote();
    cy.clickButton(CREATE);
    fillDialogTopic('Orphan Topic', 'Inline Org A');
    saveInDialog();
    cy.contains(NOTICE).should('be.visible');
    cy.clickButton('Back to List');
    cy.contains('button', 'Go Back').click();
    cy.url().should('match', /\/inline_note$/);
    cy.task<any[]>('db:getInlineTopics').then((topics) => {
      expect(topics).to.have.length(1);
      expect(topics[0].name).to.equal('Orphan Topic');
    });
    cy.task<any[]>('db:getInlineNotes').should('have.length', 0);
  });

  it('shows a required-field error in the dialog and creates nothing', () => {
    start({ topicCreate: true, viewport });
    openNewNote();
    cy.clickButton(CREATE);
    dialog().within(() => {
      cy.selectAutocomplete('Organization', 'Inline Org A');
    });
    saveInDialog();
    cy.get('div[role="dialog"]').should('be.visible');
    dialog().should('contain.text', 'Name');
    cy.task<any[]>('db:getInlineTopics').should('have.length', 0);
  });

  it('offers only the organisations the user belongs to, in the dialog', () => {
    start({ topicCreate: true, viewport });
    openNewNote();
    cy.clickButton(CREATE);
    dialog().within(() => {
      cy.get('input[role="combobox"]').last().click({ force: true });
    });
    cy.get('.MuiAutocomplete-popper li').contains('Inline Org A').should('be.visible');
    cy.get('.MuiAutocomplete-popper li').contains('Inline Org B').should('not.exist');
  });

  it('refuses a topic for another organisation, even when the dialog request is altered', () => {
    start({ topicCreate: true, viewport });
    cy.get<{ orgA: string; orgB: string }>('@orgs').then(({ orgA, orgB }) => {
      openNewNote();
      cy.clickButton(CREATE);
      fillDialogTopic('Forged Topic', 'Inline Org A');
      // The dialog cannot pick organisation B. Rewrite the save request the way a caller
      // calling the action directly could: the organisation id is swapped for B's.
      cy.intercept('POST', '**/inline_note/new*', (req) => {
        if (typeof req.body === 'string' && req.body.includes(orgA)) {
          req.body = req.body.split(orgA).join(orgB);
        }
      }).as('save');
      saveInDialog();
      cy.wait('@save').then(({ request }) => {
        expect(String(request.body)).to.include(orgB);
        expect(String(request.body)).not.to.include(orgA);
      });
      cy.get('div[role="dialog"]').should('be.visible');
      cy.contains('The record could not be found').should('be.visible');
      cy.task<any[]>('db:getInlineTopics').should('have.length', 0);
    });
  });

  it('offers no create control to a user who may not create topics', () => {
    start({ topicCreate: false, viewport });
    cy.intercept('POST', '**/inline_note/new*').as('probe');
    openNewNote();
    cy.wait('@probe');
    cy.contains('label', 'Inline Topic').should('be.visible');
    cy.get(`button[aria-label="${CREATE}"]`).should('not.exist');
  });
}
