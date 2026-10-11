import { TEST_API_KEY } from '../../support/test-credentials';

const API_BASE = '/api/user';
const INVALIDATE_PATH = (id: string) => `${API_BASE}/${id}/actions/invalidate`;

describe('API: User Invalidate DP-6 functional tests (cmd_244)', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
  });

  it('test1: list page has no removeAction and has invalidateAction for user (delete:false, invalidate:true)', () => {
    // Generated list page must wire invalidateAction but not removeAction
    cy.readFile('app/[locale]/user/page.tsx').then((content: string) => {
      expect(content).not.to.include('removeAction');
      expect(content).to.include('invalidateAction={invalidateUser}');
    });
    // Generated edit page must have no delete handler
    cy.readFile('components/user/FormUpsert.tsx').then((content: string) => {
      expect(content).to.include('onDelete={undefined}');
      expect(content).to.include('onInvalidate');
    });
  });

  it('test2: anonymize_user never writes to audit_log (append-only; metadata holds no personal data)', () => {
    // audit_log is append-only (app-generator #945), so the erasure transaction must neither
    // update its rows nor null actor_user_id.
    cy.readFile('lib/compliance/anonymize_user.ts').then((content: string) => {
      expect(content).not.to.include("data: { actor_user_id: null }");
      expect(content).not.to.include('audit_log.update');
      expect(content).not.to.include('audit_log.findMany');
      expect(content).not.to.include("'[redacted]'");
    });
    cy.readFile('code_generator/templates/anonymize_user.ts.jinja2').then((content: string) => {
      expect(content).not.to.include("data: { actor_user_id: null }");
      expect(content).not.to.include('audit_log.update');
      expect(content).not.to.include("'[redacted]'");
    });
  });

  it('test3: anonymize_user preserves actor_user_id as pseudonymous key (DP-6 ruling)', () => {
    cy.readFile('lib/compliance/anonymize_user.ts').then((content: string) => {
      // The old NULL step must be gone
      expect(content).not.to.match(/updateMany[\s\S]{0,200}actor_user_id: null/);
      // actor_user_id stays as the pseudonymous key, with the GDPR basis cited
      expect(content).to.include('actor_user_id stays as the');
      expect(content).to.include('GDPR Art.17(3)(b)(e)');
    });
  });

  it('test4: no-delete-permission user cannot invalidate via API, and user list has no removeAction', () => {
    cy.task<any[]>('db:populateUser', 1).then((records) => {
      const userId = records[0].id;
      cy.task<string>('db:createLimitedApiUser', 'user').then((limitedKey) => {
        cy.request({
          method: 'POST',
          url: INVALIDATE_PATH(userId),
          headers: { 'X-API-Key': limitedKey },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.eq(403);
        });
      });
    });
    // UI: list page has no delete toolbar (no removeAction) — confirmed by generated file check
    cy.readFile('app/[locale]/user/page.tsx').then((content: string) => {
      expect(content).not.to.include('removeAction');
    });
  });

  it('test5: regeneration-safe — invalidate:false entity (role) has no Invalidate button or route', () => {
    // No invalidate API route for role
    cy.request({
      method: 'POST',
      url: '/api/role/non-existent-id/actions/invalidate',
      headers: { 'X-API-Key': TEST_API_KEY },
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.eq(404);
    });
    // Generated role list page: no invalidateAction
    cy.readFile('app/[locale]/role/page.tsx').then((content: string) => {
      expect(content).not.to.include('invalidateAction');
      expect(content).not.to.include('invalidateRole');
    });
    // Generated role form: no onInvalidate prop
    cy.readFile('components/role/FormUpsert.tsx').then((content: string) => {
      expect(content).not.to.include('onInvalidate');
    });
  });
});
