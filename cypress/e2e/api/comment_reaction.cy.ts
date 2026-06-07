import { TEST_API_KEY } from '../../support/test-credentials';

const toggleUrl = (commentId: string) =>
  `/api/comment/${commentId}/reactions/toggle`;

describe('API: Comment Reactions', () => {
  let commentId: string;

  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task<{ commentId: string; userId: string }>('db:createTestComment').then((data) => {
      commentId = data.commentId;
    });
  });

  it('1. GET returns zero counts and empty myTypes initially', () => {
    cy.request({
      url: toggleUrl(commentId),
      headers: { 'X-API-Key': TEST_API_KEY },
    }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.commentId).to.eq(commentId);
      expect(res.body.counts).to.deep.eq([]);
      expect(res.body.myTypes).to.deep.eq([]);
    });
  });

  it('2. POST toggle creates a reaction and returns active: true', () => {
    cy.request({
      method: 'POST',
      url: toggleUrl(commentId),
      headers: { 'X-API-Key': TEST_API_KEY },
      body: { type: 0 },
    }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.active).to.eq(true);
      expect(res.body.type).to.eq(0);
      const count0 = res.body.counts.find((c: { type: number; count: number }) => c.type === 0);
      expect(count0?.count).to.eq(1);
      expect(res.body.myTypes).to.include(0);
    });
  });

  it('3. Repeating toggle removes reaction and returns active: false', () => {
    cy.request({
      method: 'POST',
      url: toggleUrl(commentId),
      headers: { 'X-API-Key': TEST_API_KEY },
      body: { type: 0 },
    }).then(() => {
      cy.request({
        method: 'POST',
        url: toggleUrl(commentId),
        headers: { 'X-API-Key': TEST_API_KEY },
        body: { type: 0 },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.active).to.eq(false);
        const count0 = res.body.counts.find((c: { type: number; count: number }) => c.type === 0);
        expect(count0?.count ?? 0).to.eq(0);
        expect(res.body.myTypes).to.not.include(0);
      });
    });
  });

  it('4. Same user can toggle two different types independently', () => {
    cy.request({
      method: 'POST',
      url: toggleUrl(commentId),
      headers: { 'X-API-Key': TEST_API_KEY },
      body: { type: 0 },
    }).then(() => {
      cy.request({
        method: 'POST',
        url: toggleUrl(commentId),
        headers: { 'X-API-Key': TEST_API_KEY },
        body: { type: 2 },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.myTypes).to.include(0);
        expect(res.body.myTypes).to.include(2);
      });
    });
  });

  it('5. Two users produce aggregate counts with user-specific myTypes', () => {
    cy.task<string>('db:createSecondUser').then((user2ApiKey) => {
      cy.request({
        method: 'POST',
        url: toggleUrl(commentId),
        headers: { 'X-API-Key': TEST_API_KEY },
        body: { type: 0 },
      }).then(() => {
        cy.request({
          method: 'POST',
          url: toggleUrl(commentId),
          headers: { 'X-API-Key': user2ApiKey },
          body: { type: 0 },
        }).then((res) => {
          expect(res.status).to.eq(200);
          const count0 = res.body.counts.find((c: { type: number; count: number }) => c.type === 0);
          expect(count0?.count).to.eq(2);
          expect(res.body.myTypes).to.include(0);
        });
        cy.request({
          url: toggleUrl(commentId),
          headers: { 'X-API-Key': TEST_API_KEY },
        }).then((res) => {
          const count0 = res.body.counts.find((c: { type: number; count: number }) => c.type === 0);
          expect(count0?.count).to.eq(2);
          expect(res.body.myTypes).to.include(0);
        });
      });
    });
  });

  it('6. Deleting a comment removes reactions via cascade (POST returns 404)', () => {
    cy.request({
      method: 'POST',
      url: toggleUrl(commentId),
      headers: { 'X-API-Key': TEST_API_KEY },
      body: { type: 0 },
    }).then(() => {
      cy.task('db:deleteTestComment', commentId).then(() => {
        cy.request({
          method: 'POST',
          url: toggleUrl(commentId),
          headers: { 'X-API-Key': TEST_API_KEY },
          body: { type: 0 },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.eq(404);
        });
      });
    });
  });

  it('7. Missing API key returns 401', () => {
    cy.request({
      url: toggleUrl(commentId),
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.eq(401);
    });
  });

  it('8. Invalid type outside enum range returns 400', () => {
    cy.request({
      method: 'POST',
      url: toggleUrl(commentId),
      headers: { 'X-API-Key': TEST_API_KEY },
      body: { type: 99 },
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.eq(400);
    });
  });
});
