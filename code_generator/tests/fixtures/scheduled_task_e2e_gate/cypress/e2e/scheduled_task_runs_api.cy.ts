import { TEST_CREDENTIALS, TEST_API_KEY } from '../../support/test-credentials';

// REST routes of the scheduled-task admin page: GET /api/scheduled-task-runs and
// POST /api/scheduled-task-runs/{task}/{rerun|resolve|skip}. Tasks (see the fixture schema):
// st_first, st_second (depends on st_first), st_boom (handler always throws).
const OVERVIEW = '/api/scheduled-task-runs';
const apiKey = { 'X-API-Key': TEST_API_KEY };
const today = new Date().toISOString().slice(0, 10);

type Row = {
  task_id: string; business_date: string; status: string; started_at: string | null; finished_at: string | null;
  message: string | null; blocked_by: string[]; interval: string | null;
  actions: { rerun: boolean; resolve: boolean; skip: boolean };
};

const post = (task: string, action: string, body: unknown, headers: Record<string, string> = apiKey) =>
  cy.request({ method: 'POST', url: `${OVERVIEW}/${task}/${action}`, headers, body, failOnStatusCode: false });

const rowFor = (rows: Row[], taskId: string) => rows.find((row) => row.task_id === taskId) as Row;

const runRecord = (taskId: string, businessDate = today) =>
  cy.task<{ status: string; error_message: string | null } | null>('db:getScheduledTaskRun', { taskId, businessDate });

describe('API: scheduled task administration', () => {
  beforeEach(() => {
    cy.task('db:reset');
    cy.task('db:seed');
    cy.task('db:grantAllPermissions');
    cy.task('db:prepareScheduledTasks');
  });

  describe('who may use it', () => {
    it('rejects a request without a credential', () => {
      cy.request({ url: OVERVIEW, failOnStatusCode: false }).its('status').should('eq', 401);
      post('st_first', 'rerun', { business_date: today }, {}).its('status').should('eq', 401);
    });

    it('rejects a user without the ScheduledTaskRunner role, even with every entity permission', () => {
      cy.request({ url: OVERVIEW, headers: apiKey, failOnStatusCode: false }).its('status').should('eq', 403);
      post('st_first', 'skip', { business_date: today, reason: 'not mine' }).its('status').should('eq', 403);
    });

    it('rejects a user whose role grants only another permission, and changes nothing', () => {
      cy.task<string>('db:createApiUserWithPermission', { entityName: 'role', flags: { read: true }, label: 'schedlimited' })
        .then((limitedKey) => {
          const headers = { 'X-API-Key': limitedKey };
          cy.request({ url: OVERVIEW, headers, failOnStatusCode: false }).its('status').should('eq', 403);
          for (const action of ['rerun', 'resolve', 'skip']) {
            post('st_first', action, { business_date: today, reason: 'no' }, headers).its('status').should('eq', 403);
          }
          post('st_boom', 'rerun', { business_date: today }, headers).its('status').should('eq', 403);
        });
      runRecord('st_first').should('be.null');
      runRecord('st_boom').should('be.null');
      cy.task('db:getScheduledTaskAuditRows', 'scheduled_task_run.skip').should('have.length', 0);
      cy.task('db:getScheduledTaskAuditRows', 'scheduled_task_run.rerun').should('have.length', 0);
    });

    it('accepts a mobile access token of a user holding the role', () => {
      cy.task('db:grantScheduledTaskRole', TEST_CREDENTIALS.email);
      cy.request('POST', '/api/mobile/auth/token', { email: TEST_CREDENTIALS.email, password: TEST_CREDENTIALS.password })
        .then((login) => {
          const headers = { Authorization: `Bearer ${login.body.access_token}` };
          cy.request({ url: OVERVIEW, headers }).its('body.rows').should('have.length', 3);
          post('st_first', 'rerun', { business_date: today }, headers).then((res) => {
            expect(res.status).to.eq(200);
            expect(res.body).to.deep.equal({ ok: true, outcome: 'succeeded' });
          });
        });
      runRecord('st_first').should('deep.equal', { status: 'succeeded', error_message: null });
    });
  });

  describe('overview', () => {
    beforeEach(() => {
      cy.task('db:grantScheduledTaskRole', TEST_CREDENTIALS.email);
    });

    it('lists every declared task with its status, the reason it did not run and the open actions', () => {
      cy.request({ url: OVERVIEW, headers: apiKey }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.business_date).to.eq(today);
        expect(res.body.settings).to.deep.equal({ stuck_after_minutes: 60, predecessor_recheck_minutes: 5 });
        const rows = res.body.rows as Row[];
        expect(rows.map((row) => row.task_id)).to.deep.equal(['st_first', 'st_second', 'st_boom']);
        expect(rowFor(rows, 'st_first')).to.deep.include({ status: 'pending', started_at: null, message: null, blocked_by: [] });
        expect(rowFor(rows, 'st_first').actions).to.deep.equal({ rerun: true, resolve: false, skip: true });
        expect(rowFor(rows, 'st_second')).to.deep.include({ status: 'blocked', blocked_by: ['st_first'] });
        expect(res.body.attention).to.deep.equal([]);
      });
    });

    it('shows the last run: succeeded, failed with its message, and a running record that is stuck', () => {
      const longAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      cy.task('db:seedScheduledTaskRun', { taskId: 'st_first', businessDate: today, status: 'succeeded' });
      cy.task('db:seedScheduledTaskRun', { taskId: 'st_boom', businessDate: today, status: 'failed', errorMessage: 'it broke' });
      cy.task('db:seedScheduledTaskRun', { taskId: 'st_second', businessDate: today, status: 'running', startedAt: longAgo });
      cy.request({ url: OVERVIEW, headers: apiKey }).then((res) => {
        const rows = res.body.rows as Row[];
        expect(rowFor(rows, 'st_first').status).to.eq('succeeded');
        expect(rowFor(rows, 'st_first').started_at).to.be.a('string');
        expect(rowFor(rows, 'st_first').finished_at).to.be.a('string');
        expect(rowFor(rows, 'st_first').actions).to.deep.equal({ rerun: false, resolve: false, skip: false });
        expect(rowFor(rows, 'st_boom')).to.deep.include({ status: 'failed', message: 'it broke' });
        expect(rowFor(rows, 'st_boom').actions).to.deep.equal({ rerun: true, resolve: true, skip: true });
        expect(rowFor(rows, 'st_second').status).to.eq('stuck');
      });
    });

    it('answers for another business date and lists failed runs of other dates under attention', () => {
      cy.task('db:seedScheduledTaskRun', { taskId: 'st_boom', businessDate: '2020-01-02', status: 'failed', errorMessage: 'old failure' });
      cy.request({ url: `${OVERVIEW}?date=2020-01-03`, headers: apiKey }).then((res) => {
        expect(res.body.business_date).to.eq('2020-01-03');
        expect(rowFor(res.body.rows, 'st_boom').status).to.eq('pending');
        expect(res.body.attention).to.have.length(1);
        expect(res.body.attention[0]).to.deep.include({ task_id: 'st_boom', business_date: '2020-01-02', status: 'failed', message: 'old failure' });
      });
    });

    it('rejects a date that is not a YYYY-MM-DD date', () => {
      cy.request({ url: `${OVERVIEW}?date=tomorrow`, headers: apiKey, failOnStatusCode: false }).its('status').should('eq', 400);
    });
  });

  describe('rerun', () => {
    beforeEach(() => {
      cy.task('db:grantScheduledTaskRole', TEST_CREDENTIALS.email);
    });

    it('runs the handler, records success and audits it with the operator', () => {
      post('st_first', 'rerun', { business_date: today }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.deep.equal({ ok: true, outcome: 'succeeded' });
      });
      runRecord('st_first').should('deep.equal', { status: 'succeeded', error_message: null });
      cy.request({ url: OVERVIEW, headers: apiKey }).its('body.rows').then((rows) => {
        expect(rowFor(rows, 'st_first').status).to.eq('succeeded');
        expect(rowFor(rows, 'st_second').status).to.eq('pending'); // its predecessor has succeeded now
      });
      cy.task<Array<{ actor_email: string; target_table: string; metadata: Record<string, unknown> }>>(
        'db:getScheduledTaskAuditRows', 'scheduled_task_run.rerun',
      ).then((rows) => {
        expect(rows).to.have.length(1);
        expect(rows[0].actor_email).to.eq(TEST_CREDENTIALS.email);
        expect(rows[0].target_table).to.eq('scheduled_task_run');
        expect(rows[0].metadata).to.include({ task_id: 'st_first', business_date: today, outcome: 'succeeded' });
      });
    });

    it('refuses to run ahead of a predecessor that has not succeeded', () => {
      post('st_second', 'rerun', { business_date: today }).then((res) => {
        expect(res.status).to.eq(409);
        expect(res.body).to.deep.equal({ ok: false, code: 'BLOCKED', detail: 'st_first' });
      });
      runRecord('st_second').should('be.null');
    });

    it('answers 500 FAILED with the handler message and records the failure', () => {
      post('st_boom', 'rerun', { business_date: today }).then((res) => {
        expect(res.status).to.eq(500);
        expect(res.body).to.deep.include({ ok: false, code: 'FAILED' });
        expect(res.body.detail).to.contain('st_boom always fails');
      });
      runRecord('st_boom').its('status').should('eq', 'failed');
    });

    it('takes over a failed record, and refuses a succeeded one', () => {
      cy.task('db:seedScheduledTaskRun', { taskId: 'st_first', businessDate: today, status: 'failed', errorMessage: 'earlier' });
      post('st_first', 'rerun', { business_date: today }).its('status').should('eq', 200);
      runRecord('st_first').its('status').should('eq', 'succeeded');
      post('st_first', 'rerun', { business_date: today }).then((res) => {
        expect(res.status).to.eq(409);
        expect(res.body).to.deep.equal({ ok: false, code: 'NOT_ALLOWED' });
      });
    });

    it('reruns the recorded business date, not today', () => {
      cy.task('db:seedScheduledTaskRun', { taskId: 'st_first', businessDate: '2020-01-02', status: 'failed', errorMessage: 'old' });
      post('st_first', 'rerun', { business_date: '2020-01-02' }).its('status').should('eq', 200);
      runRecord('st_first', '2020-01-02').its('status').should('eq', 'succeeded');
      runRecord('st_first').should('be.null');
    });
  });

  describe('resolve', () => {
    beforeEach(() => {
      cy.task('db:grantScheduledTaskRole', TEST_CREDENTIALS.email);
    });

    it('marks a failed record succeeded, keeps the previous error and audits it', () => {
      cy.task('db:seedScheduledTaskRun', { taskId: 'st_boom', businessDate: today, status: 'failed', errorMessage: 'it broke' });
      post('st_boom', 'resolve', { business_date: today, reason: 'checked by hand' }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.deep.equal({ ok: true });
      });
      runRecord('st_boom').then((record) => {
        expect(record?.status).to.eq('succeeded');
        expect(record?.error_message).to.eq('Resolved manually: checked by hand. Previous error: it broke');
      });
      cy.task<Array<{ actor_email: string; metadata: Record<string, unknown> }>>(
        'db:getScheduledTaskAuditRows', 'scheduled_task_run.resolve',
      ).then((rows) => {
        expect(rows).to.have.length(1);
        expect(rows[0].actor_email).to.eq(TEST_CREDENTIALS.email);
        expect(rows[0].metadata).to.include({ task_id: 'st_boom', previous_status: 'failed', reason: 'checked by hand' });
      });
    });

    it('refuses where there is no failure to resolve', () => {
      post('st_first', 'resolve', { business_date: today, reason: 'x' }).then((res) => {
        expect(res.status).to.eq(409);
        expect(res.body).to.deep.equal({ ok: false, code: 'NOT_ALLOWED' });
      });
      cy.task('db:seedScheduledTaskRun', { taskId: 'st_second', businessDate: today, status: 'succeeded' });
      post('st_second', 'resolve', { business_date: today, reason: 'x' }).its('status').should('eq', 409);
      cy.task('db:getScheduledTaskAuditRows', 'scheduled_task_run.resolve').should('have.length', 0);
    });
  });

  describe('skip', () => {
    beforeEach(() => {
      cy.task('db:grantScheduledTaskRole', TEST_CREDENTIALS.email);
    });

    it('records a task with no record succeeded with the reason, which releases its successor', () => {
      post('st_first', 'skip', { business_date: today, reason: 'not needed tonight' }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.deep.equal({ ok: true });
      });
      runRecord('st_first').should('deep.equal', { status: 'succeeded', error_message: 'Skipped: not needed tonight' });
      cy.request({ url: OVERVIEW, headers: apiKey }).its('body.rows').then((rows) => {
        expect(rowFor(rows, 'st_second').status).to.eq('pending');
      });
      cy.task<Array<{ actor_email: string; metadata: Record<string, unknown> }>>(
        'db:getScheduledTaskAuditRows', 'scheduled_task_run.skip',
      ).then((rows) => {
        expect(rows).to.have.length(1);
        expect(rows[0].actor_email).to.eq(TEST_CREDENTIALS.email);
        expect(rows[0].metadata).to.include({ task_id: 'st_first', previous_status: null, reason: 'not needed tonight' });
      });
    });

    it('skips a failed record', () => {
      cy.task('db:seedScheduledTaskRun', { taskId: 'st_boom', businessDate: today, status: 'failed', errorMessage: 'it broke' });
      post('st_boom', 'skip', { business_date: today, reason: 'give up' }).its('status').should('eq', 200);
      runRecord('st_boom').should('deep.equal', { status: 'succeeded', error_message: 'Skipped: give up' });
    });

    it('requires a reason', () => {
      for (const body of [{ business_date: today }, { business_date: today, reason: '   ' }]) {
        post('st_first', 'skip', body).then((res) => {
          expect(res.status).to.eq(400);
          expect(res.body).to.deep.equal({ ok: false, code: 'REASON_REQUIRED' });
        });
      }
      runRecord('st_first').should('be.null');
    });

    it('refuses a succeeded record', () => {
      cy.task('db:seedScheduledTaskRun', { taskId: 'st_first', businessDate: today, status: 'succeeded' });
      post('st_first', 'skip', { business_date: today, reason: 'again' }).its('status').should('eq', 409);
    });
  });

  describe('refused input', () => {
    beforeEach(() => {
      cy.task('db:grantScheduledTaskRole', TEST_CREDENTIALS.email);
    });

    it('answers 404 for an unknown task and for an unknown action', () => {
      post('no_such_task', 'skip', { business_date: today, reason: 'x' }).then((res) => {
        expect(res.status).to.eq(404);
        expect(res.body).to.deep.equal({ ok: false, code: 'UNKNOWN_TASK' });
      });
      post('no_such_task', 'rerun', { business_date: today }).its('status').should('eq', 404);
      post('st_first', 'delete', { business_date: today }).its('status').should('eq', 404);
    });

    it('answers 400 BAD_INPUT for a missing or invalid business_date or an unreadable body', () => {
      for (const body of [{}, { business_date: '2026-02-30' }, { business_date: 20260101 }, { business_date: 'today' }, 'not json at all']) {
        post('st_first', 'skip', body, { ...apiKey, 'Content-Type': 'application/json' }).then((res) => {
          expect(res.status).to.eq(400);
          expect(res.body).to.deep.equal({ ok: false, code: 'BAD_INPUT' });
        });
      }
      runRecord('st_first').should('be.null');
    });
  });
});
