// Hand-written -- not part of the generated entity test set.
// Who a comment's @mention notifies. The scope is the organization of the RECORD the comment
// belongs to, never the commenter's:
//   * cr_memo has no organization column: everyone mentioned is notified, whatever organizations they
//     belong to and even though the commenter belongs to none;
//   * cr_ticket belongs to an organization: only that organization's members are notified, not a user
//     who merely shares another organization with the commenter, nor one from a foreign organization.
// Covers the add and the edit of a comment.
import { TEST_API_KEY } from '../../support/test-credentials';

type Record = { id: string; organization_id?: string };
type Candidate = { id: string; name: string };

const asKey = () => ({ 'X-API-Key': TEST_API_KEY });
const mention = (user: Candidate) => `@[user_id:${user.id}]`;

function candidate(name: string, organizationId?: string | null) {
  return cy.task<Candidate>('db:createMentionCandidate', { name, organizationId: organizationId ?? null });
}

function mentionedCount(user: Candidate) {
  return cy
    .task<Array<{ type: string }>>('db:getNotificationsForUser', user.id)
    .then((rows) => rows.filter((n) => n.type === 'mentioned_in_comment').length);
}

function addComment(entity: string, recordId: string, message: string) {
  return cy.request({ method: 'POST', url: `/api/${entity}/${recordId}/comments`, headers: asKey(), body: { message } });
}

function editComment(entity: string, recordId: string, commentId: string, message: string) {
  return cy.request({
    method: 'PATCH',
    url: `/api/${entity}/${recordId}/comments/${commentId}`,
    headers: asKey(),
    body: { message },
  });
}

describe('API: who a comment mention notifies', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  describe('a record without an organization column (cr_memo)', () => {
    it('notifies everyone mentioned, whatever their organizations, although the commenter belongs to none', () => {
      cy.task<Record[]>('db:populateCrMemo', 1).then(([memo]) => {
        cy.task<{ orgB: { id: string } }>('db:createCrossOrgScenario', { entityName: 'memoscope' }).then(({ orgB }) => {
          candidate('Memo Foreign', orgB.id).then((foreign) => {
            candidate('Memo No Org').then((noOrg) => {
              addComment('cr_memo', memo.id, `${mention(foreign)} ${mention(noOrg)}`).its('status').should('eq', 201);
              mentionedCount(foreign).should('eq', 1);
              mentionedCount(noOrg).should('eq', 1);
            });
          });
        });
      });
    });

    it('notifies a user mentioned by an edit, too', () => {
      cy.task<Record[]>('db:populateCrMemo', 1).then(([memo]) => {
        candidate('Memo Late Mention').then((late) => {
          addComment('cr_memo', memo.id, 'first draft').then((created) => {
            editComment('cr_memo', memo.id, (created.body as { id: string }).id, `now with ${mention(late)}`)
              .its('status')
              .should('eq', 200);
            mentionedCount(late).should('eq', 1);
          });
        });
      });
    });
  });

  describe('a record of an organization (cr_ticket)', () => {
    it('notifies only members of the record\'s organization on add, not one who shares another organization with the commenter', () => {
      cy.task<Record[]>('db:populateCrTicket', 1).then(([ticket]) => {
        // The commenter (the seeded test user) also belongs to orgA, which is not the ticket's organization.
        cy.task<{ orgA: { id: string }; orgB: { id: string } }>('db:createCrossOrgScenario', { entityName: 'ticketscope' }).then(({ orgA, orgB }) => {
          candidate('Ticket Member', ticket.organization_id).then((member) => {
            candidate('Ticket Shares Commenter Org', orgA.id).then((sharesCommenterOrg) => {
              candidate('Ticket Foreign', orgB.id).then((foreign) => {
                candidate('Ticket No Org').then((noOrg) => {
                  addComment('cr_ticket', ticket.id, [member, sharesCommenterOrg, foreign, noOrg].map(mention).join(' '))
                    .its('status')
                    .should('eq', 201);
                  mentionedCount(member).should('eq', 1);
                  mentionedCount(sharesCommenterOrg).should('eq', 0);
                  mentionedCount(foreign).should('eq', 0);
                  mentionedCount(noOrg).should('eq', 0);
                });
              });
            });
          });
        });
      });
    });

    it('applies the same scope when an edit adds the mentions', () => {
      cy.task<Record[]>('db:populateCrTicket', 1).then(([ticket]) => {
        cy.task<{ orgA: { id: string } }>('db:createCrossOrgScenario', { entityName: 'ticketedit' }).then(({ orgA }) => {
          candidate('Ticket Edit Member', ticket.organization_id).then((member) => {
            candidate('Ticket Edit Shares Commenter Org', orgA.id).then((sharesCommenterOrg) => {
              addComment('cr_ticket', ticket.id, 'first draft').then((created) => {
                editComment('cr_ticket', ticket.id, (created.body as { id: string }).id, `${mention(member)} ${mention(sharesCommenterOrg)}`)
                  .its('status')
                  .should('eq', 200);
                mentionedCount(member).should('eq', 1);
                mentionedCount(sharesCommenterOrg).should('eq', 0);
              });
            });
          });
        });
      });
    });
  });
});
