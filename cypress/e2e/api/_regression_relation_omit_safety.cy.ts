// Hand-written regression gate (cmd_366). NOT auto-generated — generate-code
// never touches this file, so it survives regeneration and stays a durable
// machine check for the bug class below.
//
// Root cause (cmd_366): a many-to-many "connect" relation field (e.g.
// role.users) that a client omits from a PUT body was defaulted to `[]` at
// the call site (`{child}_ids ?? []` in the old build_context.py), which
// Prisma's `users: { set: [] } }` then reads as "detach every related row".
// The mobile app's role edit form has no user-membership UI, so every
// mobile role save silently wiped ALL of that role's user memberships --
// including, when the editor's own account held the role being edited, the
// editor's own permission grant (observed as the mobile Roles list
// suddenly failing to load with "Access denied: role.read"; see
// queue/reports/subtask_366a_ashigaru2.yaml for the full runtime repro).
//
// Fix: build_context.py now threads the relation ids through as
// `string[] | undefined` on update, and the generated service only emits
// `users: { set: [...] } }` when the caller actually supplied the field
// (see lib/role/service.ts's `...(usersIds !== undefined ? {...} : {})`).
// A client that omits the field now leaves the relation untouched instead
// of detaching everything.
//
// This test proves the fix end-to-end over the real HTTP API (no direct
// Prisma access), so it fails the same way the mobile client actually
// observed it: PUT without the relation field, then re-GET.
import { TEST_API_KEY, TEST_CREDENTIALS } from '../../support/test-credentials';

const ROLE_API_BASE = '/api/role';
const AUTH_TOKEN_URL = '/api/mobile/auth/token';

function decodeJwtSub(jwt: string): string {
  const payload = jwt.split('.')[1];
  const json = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  return json.sub;
}

describe('API: Role update — relation-omission safety (cmd_366 regression)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('PUT without users_ids leaves an existing user connection intact', () => {
    cy.request({
      method: 'POST',
      url: AUTH_TOKEN_URL,
      body: { email: TEST_CREDENTIALS.email, password: TEST_CREDENTIALS.password },
    }).then((tokenRes) => {
      expect(tokenRes.status).to.eq(201);
      const testUserId = decodeJwtSub(tokenRes.body.access_token);

      cy.request({
        method: 'POST',
        url: ROLE_API_BASE,
        headers: { 'X-API-Key': TEST_API_KEY },
        body: { name: 'cmd_366 regression role', description: 'before', users_ids: [testUserId] },
      }).then((createRes) => {
        expect(createRes.status).to.eq(201);
        const roleId = createRes.body.id;

        cy.request({ url: `${ROLE_API_BASE}/${roleId}`, headers: { 'X-API-Key': TEST_API_KEY } })
          .then((getRes) => {
            const ids = (getRes.body.users ?? []).map((u: { id: string }) => u.id);
            expect(ids, 'user connected at create time').to.include(testUserId);
          });

        // The regression trigger: a PUT body that omits users_ids entirely,
        // exactly like the mobile role-edit form's RoleInput ({name, description}).
        cy.request({
          method: 'PUT',
          url: `${ROLE_API_BASE}/${roleId}`,
          headers: { 'X-API-Key': TEST_API_KEY },
          body: { name: 'cmd_366 regression role', description: 'after' },
        }).then((putRes) => {
          expect(putRes.status).to.eq(200);
        });

        cy.request({ url: `${ROLE_API_BASE}/${roleId}`, headers: { 'X-API-Key': TEST_API_KEY } })
          .then((getRes) => {
            expect(getRes.body.description).to.eq('after');
            const ids = (getRes.body.users ?? []).map((u: { id: string }) => u.id);
            expect(ids, 'user connection must survive a PUT that omits users_ids').to.include(testUserId);
          });
      });
    });
  });
});

// cmd_376 batch1 supplement: the mobile role-edit screen (unlike the plain
// PUT-with-no-field case above) now sends `users_ids` explicitly on every
// save (cmd366_prevention.mobile_edit_screen_invariants). This proves the
// mobile save path itself over the mobile Bearer-token auth flow: load the
// detail, derive selectedUserIds from the response's `users` array exactly
// as edit.tsx.jinja2 does, PUT that same array back untouched, then confirm
// both the membership and the actor's own role.read access survive — the
// same access-denied symptom cmd_366 produced when membership was silently
// wiped.
describe('Mobile: role edit — users_ids explicit-send guard (cmd_366/cmd_376)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('PUT with users_ids re-sent unchanged (picker untouched) preserves membership and role.read access', () => {
    cy.request({
      method: 'POST',
      url: AUTH_TOKEN_URL,
      body: { email: TEST_CREDENTIALS.email, password: TEST_CREDENTIALS.password },
    }).then((tokenRes) => {
      expect(tokenRes.status).to.eq(201);
      const accessToken = tokenRes.body.access_token;
      const testUserId = decodeJwtSub(accessToken);
      const authHeaders = { Authorization: `Bearer ${accessToken}` };

      cy.request({
        method: 'POST',
        url: ROLE_API_BASE,
        headers: authHeaders,
        body: { name: 'cmd_376 mobile guard role', description: 'before', users_ids: [testUserId] },
      }).then((createRes) => {
        expect(createRes.status).to.eq(201);
        const roleId = createRes.body.id;

        cy.request({ url: `${ROLE_API_BASE}/${roleId}`, headers: authHeaders }).then((getRes) => {
          const selectedUserIds = (getRes.body.users ?? []).map((u: { id: string }) => u.id);
          expect(selectedUserIds, 'membership loaded before edit').to.include(testUserId);

          cy.request({
            method: 'PUT',
            url: `${ROLE_API_BASE}/${roleId}`,
            headers: authHeaders,
            body: { name: 'cmd_376 mobile guard role', description: 'after', users_ids: selectedUserIds },
          }).then((putRes) => {
            expect(putRes.status).to.eq(200);
          });
        });

        cy.request({ url: `${ROLE_API_BASE}/${roleId}`, headers: authHeaders }).then((getRes) => {
          expect(getRes.status, 'role.read must still be granted to this actor after the edit').to.eq(200);
          expect(getRes.body.description).to.eq('after');
          const ids = (getRes.body.users ?? []).map((u: { id: string }) => u.id);
          expect(ids, 'user connection survives an explicit users_ids re-send').to.include(testUserId);
        });
      });
    });
  });
});
