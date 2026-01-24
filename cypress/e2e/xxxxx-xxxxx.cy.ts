beforeEach(() => {
  cy.login('sean@doreenslab.com', 'password123');
});

describe('View xxxxx xxxxx list page', () => {
  it('passes', () => {
    cy.visit('/xxxxx_xxxxx');
  })
})

describe('View new xxxxx xxxxx page', () => {
  it('passes', () => {
    cy.visit('/xxxxx_xxxxx/new');
  })
})