// Hand-written -- not part of the generated entity test set.
// POST/PATCH/DELETE /api/cr_ticket/{id}/comments[/{commentId}] and GET /api/mention/users:
// the REST side of the comment box and the @-mention picker the web edit form uses.
import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';

type Ticket = { id: string; organization_id: string; commentable_id: string };
type Comment = { id: string; message: string; creator?: { id: string } | null };

const base = (ticketId: string) => `/api/cr_ticket/${ticketId}/comments`;
const asKey = (key = TEST_API_KEY) => ({ 'X-API-Key': key });

function listComments(ticketId: string, key = TEST_API_KEY) {
  return cy
    .request({ url: `/api/cr_ticket/${ticketId}`, headers: asKey(key) })
    .then((res) => (res.body.commentable.comments as Comment[]) ?? []);
}

function addComment(ticketId: string, message: string, key = TEST_API_KEY) {
  return cy.request({ method: 'POST', url: base(ticketId), headers: asKey(key), body: { message }, failOnStatusCode: false });
}

describe('API: comment writes', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  describe('authentication', () => {
    it('rejects a request without credentials', () => {
      cy.task<Ticket[]>('db:populateCrTicket', 1).then(([ticket]) => {
        cy.request({ method: 'POST', url: base(ticket.id), body: { message: 'hi' }, failOnStatusCode: false })
          .its('status')
          .should('eq', 401);
      });
    });

    it('rejects an invalid API key and an invalid mobile access token', () => {
      cy.task<Ticket[]>('db:populateCrTicket', 1).then(([ticket]) => {
        addComment(ticket.id, 'hi', 'not-a-real-key').its('status').should('eq', 401);
        cy.request({
          method: 'POST',
          url: base(ticket.id),
          headers: { Authorization: 'Bearer aaa.bbb.ccc' },
          body: { message: 'hi' },
          failOnStatusCode: false,
        })
          .its('status')
          .should('eq', 401);
      });
    });

    it('accepts a mobile access token for add, edit and delete', () => {
      cy.task<Ticket[]>('db:populateCrTicket', 1).then(([ticket]) => {
        cy.request('POST', '/api/mobile/auth/token', {
          email: TEST_CREDENTIALS.email,
          password: TEST_CREDENTIALS.password,
        }).then((login) => {
          const headers = { Authorization: `Bearer ${(login.body as { access_token: string }).access_token}` };
          cy.request({ method: 'POST', url: base(ticket.id), headers, body: { message: 'from mobile' } }).then((created) => {
            expect(created.status).to.eq(201);
            const commentId = (created.body as { id: string }).id;
            cy.request({ method: 'PATCH', url: `${base(ticket.id)}/${commentId}`, headers, body: { message: 'edited on mobile' } })
              .its('status')
              .should('eq', 200);
            listComments(ticket.id).then((comments) => {
              expect(comments.find((c) => c.id === commentId)?.message).to.eq('edited on mobile');
            });
            cy.request({ method: 'DELETE', url: `${base(ticket.id)}/${commentId}`, headers }).its('status').should('eq', 204);
          });
        });
      });
    });
  });

  describe('add', () => {
    it('stores the comment for the caller and returns its id', () => {
      cy.task<Ticket[]>('db:populateCrTicket', 1).then(([ticket]) => {
        addComment(ticket.id, '  First comment  ').then((res) => {
          expect(res.status).to.eq(201);
          const id = (res.body as { id: string }).id;
          listComments(ticket.id).then((comments) => {
            const created = comments.find((c) => c.id === id);
            expect(created?.message).to.eq('First comment');
          });
        });
      });
    });

    it('notifies a mentioned user, as the web form does', () => {
      cy.task<{ record: Ticket; mentionedUserId: string }>('db:populateCrTicketWithMentionUser').then(({ record, mentionedUserId }) => {
        cy.task<unknown[]>('db:getNotificationsForUser', mentionedUserId).then((before) => {
          addComment(record.id, `hello @[user_id:${mentionedUserId}]`).its('status').should('eq', 201);
          cy.task<unknown[]>('db:getNotificationsForUser', mentionedUserId).then((after) => {
            expect(after.length).to.eq(before.length + 1);
          });
        });
      });
    });

    it('rejects an empty, blank, missing or non-string message and a body that is not JSON', () => {
      cy.task<Ticket[]>('db:populateCrTicket', 1).then(([ticket]) => {
        for (const message of ['', '   ', undefined, 7, null]) {
          cy.request({ method: 'POST', url: base(ticket.id), headers: asKey(), body: { message }, failOnStatusCode: false })
            .its('status')
            .should('eq', 400);
        }
        cy.request({
          method: 'POST',
          url: base(ticket.id),
          headers: { ...asKey(), 'Content-Type': 'application/json' },
          body: 'not json',
          failOnStatusCode: false,
        })
          .its('status')
          .should('eq', 400);
        addComment(ticket.id, 'x'.repeat(10001)).its('status').should('eq', 400);
        listComments(ticket.id).then((comments) => expect(comments).to.have.length(0));
      });
    });

    it('answers 404 for a record that does not exist', () => {
      addComment('does-not-exist', 'hi').its('status').should('eq', 404);
    });
  });

  describe('permission', () => {
    it('answers 403 when the caller cannot update the record, and writes nothing', () => {
      cy.task<Ticket[]>('db:populateCrTicket', 1).then(([ticket]) => {
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'cr_ticket',
          flags: { read: true },
          label: 'readonly',
          organizationId: ticket.organization_id,
        }).then((key) => {
          addComment(ticket.id, 'not allowed', key).its('status').should('eq', 403);
          listComments(ticket.id).then((comments) => expect(comments).to.have.length(0));
        });
      });
    });

    it('lets a caller who can update the record comment on it', () => {
      cy.task<Ticket[]>('db:populateCrTicket', 1).then(([ticket]) => {
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'cr_ticket',
          flags: { read: true, update: true },
          label: 'updater',
          organizationId: ticket.organization_id,
        }).then((key) => {
          addComment(ticket.id, 'allowed', key).its('status').should('eq', 201);
        });
      });
    });
  });

  describe('organization isolation', () => {
    it('answers 404 for add, edit and delete on a record of a foreign organization', () => {
      cy.task<Ticket[]>('db:populateCrTicket', 2).then(([own, foreign]) => {
        addComment(foreign.id, 'seed comment').its('status').should('eq', 201);
        listComments(foreign.id).then(([seeded]) => {
          cy.task<{ entityInOrgB: { id: string } }>('db:createCrossOrgScenario', {
            entityName: 'cr_ticket',
            entityId: foreign.id,
          }).then(() => {
            addComment(foreign.id, 'from outside').its('status').should('eq', 404);
            cy.request({ method: 'PATCH', url: `${base(foreign.id)}/${seeded.id}`, headers: asKey(), body: { message: 'changed' }, failOnStatusCode: false })
              .its('status')
              .should('eq', 404);
            cy.request({ method: 'DELETE', url: `${base(foreign.id)}/${seeded.id}`, headers: asKey(), failOnStatusCode: false })
              .its('status')
              .should('eq', 404);
            // The record of the caller's own organization is still reachable.
            addComment(own.id, 'inside').its('status').should('eq', 201);
          });
        });
      });
    });
  });

  // The Server Actions run the same permission and organization checks themselves. The test-only
  // probe route (probe_routes/action_probe_route.ts) calls them directly, skipping the REST pre-gates, so
  // these specs fail if an action stops checking even though the REST routes still would.
  describe('Server Actions on their own (no REST pre-gates)', () => {
    const probe = (ticketId: string, body: { op: 'add' | 'update' | 'delete'; commentId?: string; message?: string }, key = TEST_API_KEY) =>
      cy.request({ method: 'POST', url: `/api/cr_ticket/${ticketId}/action_probe`, headers: asKey(key), body, failOnStatusCode: false });

    it('denies add and delete to a caller without update permission and writes nothing', () => {
      cy.task<Ticket[]>('db:populateCrTicket', 1).then(([ticket]) => {
        addComment(ticket.id, 'seeded by the admin').then((seeded) => {
          const seededId = (seeded.body as { id: string }).id;
          cy.task<string>('db:createApiUserWithPermission', {
            entityName: 'cr_ticket',
            flags: { read: true, delete: true },
            label: 'actionnoupdate',
            organizationId: ticket.organization_id,
          }).then((key) => {
            probe(ticket.id, { op: 'add', message: 'not allowed' }, key).its('status').should('eq', 403);
            probe(ticket.id, { op: 'delete', commentId: seededId }, key).its('status').should('eq', 403);
            listComments(ticket.id).then((comments) => expect(comments.map((c) => c.id)).to.deep.equal([seededId]));
          });
        });
      });
    });

    it('denies a non-author who has update but not delete permission from deleting', () => {
      cy.task<Ticket[]>('db:populateCrTicket', 1).then(([ticket]) => {
        addComment(ticket.id, 'by the admin').then((seeded) => {
          const seededId = (seeded.body as { id: string }).id;
          cy.task<string>('db:createApiUserWithPermission', {
            entityName: 'cr_ticket',
            flags: { read: true, update: true },
            label: 'actionnodelete',
            organizationId: ticket.organization_id,
          }).then((key) => {
            probe(ticket.id, { op: 'delete', commentId: seededId }, key).its('status').should('eq', 403);
            listComments(ticket.id).then((comments) => expect(comments.map((c) => c.id)).to.include(seededId));
          });
        });
      });
    });

    it('lets a same-organization caller with update permission add, edit and delete', () => {
      cy.task<Ticket[]>('db:populateCrTicket', 1).then(([ticket]) => {
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'cr_ticket',
          flags: { read: true, update: true },
          label: 'actionupdater',
          organizationId: ticket.organization_id,
        }).then((key) => {
          probe(ticket.id, { op: 'add', message: 'via the action' }, key).then((added) => {
            expect(added.status).to.eq(200);
            const id = (added.body as { result: { id: string } }).result.id;
            probe(ticket.id, { op: 'update', commentId: id, message: 'edited' }, key).its('status').should('eq', 200);
            listComments(ticket.id).then((comments) => expect(comments.find((c) => c.id === id)?.message).to.eq('edited'));
            probe(ticket.id, { op: 'delete', commentId: id }, key).its('status').should('eq', 200);
            listComments(ticket.id).then((comments) => expect(comments).to.have.length(0));
          });
        });
      });
    });

    it('answers not found for add, edit and delete once the record is outside the caller\'s organizations', () => {
      cy.task<Ticket[]>('db:populateCrTicket', 1).then(([ticket]) => {
        addComment(ticket.id, 'before the move').then((seeded) => {
          const seededId = (seeded.body as { id: string }).id;
          cy.task('db:createCrossOrgScenario', { entityName: 'cr_ticket', entityId: ticket.id }).then(() => {
            probe(ticket.id, { op: 'add', message: 'from outside' }).its('status').should('eq', 404);
            probe(ticket.id, { op: 'update', commentId: seededId, message: 'changed' }).its('status').should('eq', 404);
            probe(ticket.id, { op: 'delete', commentId: seededId }).its('status').should('eq', 404);
          });
        });
      });
    });
  });

  describe('edit', () => {
    it('lets the author change the message and answers 404 for a comment of another record or none', () => {
      cy.task<Ticket[]>('db:populateCrTicket', 2).then(([ticket, other]) => {
        addComment(ticket.id, 'before').then((created) => {
          const id = (created.body as { id: string }).id;
          cy.request({ method: 'PATCH', url: `${base(ticket.id)}/${id}`, headers: asKey(), body: { message: ' after ' } })
            .its('status')
            .should('eq', 200);
          listComments(ticket.id).then((comments) => expect(comments.find((c) => c.id === id)?.message).to.eq('after'));
          cy.request({ method: 'PATCH', url: `${base(other.id)}/${id}`, headers: asKey(), body: { message: 'x' }, failOnStatusCode: false })
            .its('status')
            .should('eq', 404);
          cy.request({ method: 'PATCH', url: `${base(ticket.id)}/no-such-comment`, headers: asKey(), body: { message: 'x' }, failOnStatusCode: false })
            .its('status')
            .should('eq', 404);
          cy.request({ method: 'PATCH', url: `${base(ticket.id)}/${id}`, headers: asKey(), body: { message: '  ' }, failOnStatusCode: false })
            .its('status')
            .should('eq', 400);
        });
      });
    });

    it('refuses anyone but the author, whatever their permissions', () => {
      cy.task<Ticket[]>('db:populateCrTicket', 1).then(([ticket]) => {
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'cr_ticket',
          flags: { read: true, update: true, delete: true },
          label: 'otheruser',
          organizationId: ticket.organization_id,
        }).then((key) => {
          addComment(ticket.id, 'mine').then((created) => {
            const id = (created.body as { id: string }).id;
            cy.request({ method: 'PATCH', url: `${base(ticket.id)}/${id}`, headers: asKey(key), body: { message: 'taken over' }, failOnStatusCode: false })
              .its('status')
              .should('eq', 403);
            listComments(ticket.id).then((comments) => expect(comments.find((c) => c.id === id)?.message).to.eq('mine'));
          });
        });
      });
    });

    it('notifies only a user newly mentioned by the edit', () => {
      cy.task<{ record: Ticket; mentionedUserId: string }>('db:populateCrTicketWithMentionUser').then(({ record, mentionedUserId }) => {
        addComment(record.id, 'no mention yet').then((created) => {
          const id = (created.body as { id: string }).id;
          cy.task<unknown[]>('db:getNotificationsForUser', mentionedUserId).then((before) => {
            cy.request({ method: 'PATCH', url: `${base(record.id)}/${id}`, headers: asKey(), body: { message: `now @[user_id:${mentionedUserId}]` } })
              .its('status')
              .should('eq', 200);
            cy.request({ method: 'PATCH', url: `${base(record.id)}/${id}`, headers: asKey(), body: { message: `again @[user_id:${mentionedUserId}]` } })
              .its('status')
              .should('eq', 200);
            cy.task<unknown[]>('db:getNotificationsForUser', mentionedUserId).then((after) => {
              expect(after.length).to.eq(before.length + 1);
            });
          });
        });
      });
    });
  });

  describe('delete', () => {
    it('lets the author delete, and answers 404 afterwards', () => {
      cy.task<Ticket[]>('db:populateCrTicket', 1).then(([ticket]) => {
        addComment(ticket.id, 'to delete').then((created) => {
          const id = (created.body as { id: string }).id;
          cy.request({ method: 'DELETE', url: `${base(ticket.id)}/${id}`, headers: asKey() }).its('status').should('eq', 204);
          listComments(ticket.id).then((comments) => expect(comments).to.have.length(0));
          cy.request({ method: 'DELETE', url: `${base(ticket.id)}/${id}`, headers: asKey(), failOnStatusCode: false })
            .its('status')
            .should('eq', 404);
        });
      });
    });

    it('lets a non-author delete only with delete permission on the entity', () => {
      cy.task<Ticket[]>('db:populateCrTicket', 1).then(([ticket]) => {
        cy.task<string>('db:createApiUserWithPermission', {
          entityName: 'cr_ticket',
          flags: { read: true, update: true },
          label: 'nodelete',
          organizationId: ticket.organization_id,
        }).then((withoutDelete) => {
          addComment(ticket.id, 'by the admin').then((created) => {
            const id = (created.body as { id: string }).id;
            cy.request({ method: 'DELETE', url: `${base(ticket.id)}/${id}`, headers: asKey(withoutDelete), failOnStatusCode: false })
              .its('status')
              .should('eq', 403);
            listComments(ticket.id).then((comments) => expect(comments.map((c) => c.id)).to.include(id));
          });
          addComment(ticket.id, 'by the other user', withoutDelete).then((byOther) => {
            const id = (byOther.body as { id: string }).id;
            // The admin holds delete permission, so may delete another user's comment.
            cy.request({ method: 'DELETE', url: `${base(ticket.id)}/${id}`, headers: asKey() }).its('status').should('eq', 204);
          });
        });
      });
    });
  });
});

describe('API: @-mention user search', () => {
  const search = (query: string, key = TEST_API_KEY) =>
    cy.request({ url: `/api/mention/users${query}`, headers: asKey(key), failOnStatusCode: false });

  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('rejects a request without credentials and an invalid mobile access token', () => {
    cy.request({ url: '/api/mention/users', failOnStatusCode: false }).its('status').should('eq', 401);
    cy.request({ url: '/api/mention/users', headers: { Authorization: 'Bearer aaa.bbb.ccc' }, failOnStatusCode: false })
      .its('status')
      .should('eq', 401);
  });

  it('returns only users of the caller\'s organizations, through an API key and a mobile access token', () => {
    cy.task<{ orgA: { id: string }; orgB: { id: string } }>('db:createCrossOrgScenario', { entityName: 'mention' }).then(({ orgA, orgB }) => {
      cy.task<string>('db:createApiUserWithPermission', { entityName: 'user', flags: { read: true }, label: 'mentionown', organizationId: orgA.id });
      cy.task<string>('db:createApiUserWithPermission', { entityName: 'user', flags: { read: true }, label: 'mentionforeign', organizationId: orgB.id });
      search('?q=mentionown').then((res) => {
        expect(res.status).to.eq(200);
        const body = res.body as { options: { id: string; name: string; email: string }[]; permissionDenied: boolean };
        expect(body.permissionDenied).to.eq(false);
        expect(body.options.map((o) => o.name)).to.deep.equal(['API User (mentionown/user)']);
        expect(Object.keys(body.options[0]).sort()).to.deep.equal(['email', 'id', 'name']);
      });
      search('?q=mentionforeign').then((res) => {
        expect(res.status).to.eq(200);
        expect((res.body as { options: unknown[] }).options).to.deep.equal([]);
      });
      cy.request('POST', '/api/mobile/auth/token', {
        email: TEST_CREDENTIALS.email,
        password: TEST_CREDENTIALS.password,
      }).then((login) => {
        const headers = { Authorization: `Bearer ${(login.body as { access_token: string }).access_token}` };
        cy.request({ url: '/api/mention/users?q=mentionforeign', headers }).then((res) => {
          expect((res.body as { options: unknown[] }).options).to.deep.equal([]);
        });
        cy.request({ url: '/api/mention/users?q=mentionown', headers }).then((res) => {
          expect((res.body as { options: unknown[] }).options).to.have.length(1);
        });
      });
    });
  });

  it('returns at most 20 users, ordered by name, for an empty query', () => {
    cy.task<{ orgA: { id: string } }>('db:createCrossOrgScenario', { entityName: 'mentionlimit' }).then(({ orgA }) => {
      for (let i = 0; i < 22; i++) {
        cy.task('db:createApiUserWithPermission', { entityName: 'user', flags: { read: true }, label: `bulk${String(i).padStart(2, '0')}`, organizationId: orgA.id });
      }
      search('').then((res) => {
        const names = (res.body as { options: { name: string }[] }).options.map((o) => o.name);
        expect(names).to.have.length(20);
        expect(names).to.deep.equal([...names].sort((a, b) => a.localeCompare(b)));
      });
    });
  });

  it('answers an empty list with permissionDenied when the caller cannot read users', () => {
    cy.task<string>('db:createApiUserWithPermission', { entityName: 'role', flags: { read: true }, label: 'nouserread' }).then((key) => {
      search('?q=a', key).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.deep.equal({ options: [], permissionDenied: true });
      });
    });
  });

  it('answers an empty list for a caller with no organization membership', () => {
    cy.task<string>('db:createApiUserWithPermission', { entityName: 'user', flags: { read: true }, label: 'noorg' }).then((key) => {
      search('?q=a', key).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.deep.equal({ options: [], permissionDenied: false });
      });
    });
  });

  it('rejects a query longer than 200 characters', () => {
    search(`?q=${'a'.repeat(201)}`).its('status').should('eq', 400);
  });
});
