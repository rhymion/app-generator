import { TEST_CREDENTIALS } from '../support/test-credentials';

describe('Testing xxxxx xxxxx pages and their behavior', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  it('View xxxxx xxxxx list page', () => {
    cy.visit('/xxxxx_xxxxx');
  });

  it('View new xxxxx xxxxx page', () => {
    cy.visit('/xxxxx_xxxxx/new');
  })
});
