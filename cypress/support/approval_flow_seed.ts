// Hand-written self-seed helper for approval_flow specs — cmd_665.
//
// approval_flow's generator-produced seed helper
// (cypress/support/approval_flow/helper.ts) and its Cypress tasks
// (db:populateApprovalFlow / db:populateApprovalFlowDependencies /
// db:populateApprovalFlowFull / db:resetApprovalFlowCallSeq) only exist
// while x-generate.test is true for approval_flow (cmd_661: set false).
// The specs in this directory that cover the CRUD/list/permission surface
// those generated files used to cover create their own dependency rows
// directly through the still-generated /api/role and /api/approval_flow
// endpoints instead — the same self-seed pattern already used by
// approval_flow_same_entity_autocomplete_filter.cy.ts (cmd_613/661) and
// approval_flow_self_referential_children.cy.ts (cmd_665).
import { TEST_API_KEY } from './test-credentials';

let _roleSeq = 0;

// Fresh, collision-free role name per call within a test run (mirrors the
// generated helper's per-call-index uniqueness, cmd_620 Option β) — a spec
// file only resets on cy.task('db:reset') in beforeEach, so this counter is
// scoped per spec-file load, not per test, but db:reset wipes the role
// table between tests anyway so uniqueness only matters within one test.
function nextRoleName(label: string): string {
  _roleSeq += 1;
  return `${label} ${_roleSeq}`;
}

export function apiCreateRole(name?: string) {
  const roleName = name ?? nextRoleName('Seed Role');
  return cy
    .request({
      method: 'POST',
      url: '/api/role',
      headers: { 'X-API-Key': TEST_API_KEY },
      body: { name: roleName },
    })
    .then((res) => {
      expect(res.status).to.eq(201);
      return { id: (res.body as { id: string }).id, name: roleName };
    });
}

export type SeedApprovalFlow = {
  id: string;
  entity_name: string;
  approver_role_id: string;
  requestor_role_id: string | null;
};

export function apiCreateApprovalFlow(opts: {
  entityName: string;
  approverRoleId: string;
  requestorRoleId?: string | null;
  precededByIds?: string[];
  followedByIds?: string[];
}) {
  return cy
    .request({
      method: 'POST',
      url: '/api/approval_flow',
      headers: { 'X-API-Key': TEST_API_KEY },
      body: {
        entity_name: opts.entityName,
        requestor_role_id: opts.requestorRoleId ?? null,
        approver_role_id: opts.approverRoleId,
        precededBy_ids: opts.precededByIds ?? [],
        followedBy_ids: opts.followedByIds ?? [],
      },
    })
    .then((res) => {
      expect(res.status).to.eq(201);
      return {
        id: (res.body as { id: string }).id,
        entity_name: opts.entityName,
        approver_role_id: opts.approverRoleId,
        requestor_role_id: opts.requestorRoleId ?? null,
      } as SeedApprovalFlow;
    });
}

// Mirrors the generated populateApprovalFlowData(length): `length` bare
// approval_flow rows, entity_name 'user', each with its own fresh role, no
// requestor_role, no preceded_by/followed_by.
export function seedApprovalFlowRows(length: number) {
  const create = (i: number): Cypress.Chainable<SeedApprovalFlow[]> =>
    apiCreateRole().then((role) =>
      apiCreateApprovalFlow({ entityName: 'user', approverRoleId: role.id }).then((row) => {
        if (i + 1 >= length) return cy.wrap([row]);
        return create(i + 1).then((rest) => [row, ...rest]);
      }),
    );
  if (length <= 0) return cy.wrap([] as SeedApprovalFlow[]);
  return create(0);
}

// Mirrors the generated populateApprovalFlowFullData(length): like
// seedApprovalFlowRows, but each row also carries a requestor_role
// (NOTE: the generated helper's "Full" name is misleading — it never
// attaches preceded_by/followed_by children, see
// db:populateApprovalFlowFull's implementation in the pre-test:false
// commit; verified while porting these specs, cmd_665).
export function seedApprovalFlowRowsFull(length: number) {
  return apiCreateRole('Test Requestor Role Full').then((requestorRole) => {
    const create = (i: number): Cypress.Chainable<SeedApprovalFlow[]> =>
      apiCreateRole().then((role) =>
        apiCreateApprovalFlow({
          entityName: 'user',
          approverRoleId: role.id,
          requestorRoleId: requestorRole.id,
        }).then((row) => {
          if (i + 1 >= length) return cy.wrap([row]);
          return create(i + 1).then((rest) => [row, ...rest]);
        }),
      );
    if (length <= 0) return cy.wrap([] as SeedApprovalFlow[]);
    return create(0);
  });
}

// Mirrors the generated populateApprovalFlowDependencies(): a requestor
// role, an approver role (+ a second approver role + an alias role, used by
// desktop 2.2/3.1's "Add Preceded By"/"Add Followed By" flows), and two
// existing approval_flow rows (precededBy/followedBy candidates) that share
// entity_name 'user' with whatever the caller subsequently creates/edits
// with Entity Name = 'User' — this is why the ORIGINAL generated 2.2/3.1
// tests never actually exercised a cross-entity_name link (verified by
// reading the pre-cmd_661 helper.ts; see the earlier investigation reports).
//
// The precededBy candidate uses its OWN role (Test Approver Role C),
// distinct from `approverRole`/`deps.role` — callers create/select their
// OWN record with `deps.role`/`deps.approverRole` (entity_name 'user'), and
// on a consumer schema carrying approval_flow's
// @@unique([entity_name, approver_role_id]) (cmd_681), reusing approverRole
// for the precededBy decoy would collide with that record. Same three
// distinct-role pattern already used by
// approval_flow_self_referential_children.cy.ts and
// approval_flow_same_entity_autocomplete_filter.cy.ts.
export function apiPopulateApprovalFlowDependencies() {
  return apiCreateRole('Test Requestor Role A').then((requestorRole) =>
    apiCreateRole('Test Approver Role A').then((approverRole) =>
      apiCreateRole('Test Approver Role B').then((approverRole2) =>
        apiCreateRole('Test Approver Role C').then((precededByApproverRole) =>
          apiCreateApprovalFlow({ entityName: 'user', approverRoleId: precededByApproverRole.id }).then((precededBy) =>
            apiCreateApprovalFlow({ entityName: 'user', approverRoleId: approverRole2.id }).then((followedBy) => ({
              requestorRole,
              approverRole,
              approverRole2,
              role: approverRole,
              precededBy: { ...precededBy, name: `user ${precededByApproverRole.name}` },
              followedBy: { ...followedBy, name: `user ${approverRole2.name}` },
            })),
          ),
        ),
      ),
    ),
  );
}
