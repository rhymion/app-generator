// AUTO-GENERATED — DO NOT EDIT
//
// The "independent entity" list and per-entity permission grants derived
// from the project schema (see seed_entities_context() in
// code_generator/generators.py). Consumed by scripts/grant-all-
// permissions.ts — a development / verification tool, NOT scripts/seed-
// baseline.ts, which keeps its own fixed enumeration unchanged (see
// docs/knowledge/seed-baseline-credential-hardening.md).
export const SEED_ENTITIES: string[] = [
  'app_setting',
  'approval_flow',
  'approval_request',
  'attachment',
  'comment',
  'dashboard',
  'dashboard_widget',
  'organization',
  'permission',
  'reaction',
  'role',
  'user',
];

export interface SeedEntityGrant {
  create: boolean;
  read: boolean;
  update: boolean;
  delete: boolean;
  import: boolean;
}

// Per-entity operation flags, derived from each entity's own x-generate
// block (_seed_entity_grant_flags() in code_generator/generators.py) so
// grant-all-permissions.ts never grants an operation the generated app
// cannot actually perform (e.g. `create` stays false when x-generate.new
// is false, so no "+" button that would 404 appears once granted).
export const SEED_ENTITY_GRANTS: Record<string, SeedEntityGrant> = {
  'app_setting': {
    create: true,
    read: true,
    update: true,
    delete: false,
    import: false,
  },
  'approval_flow': {
    create: true,
    read: true,
    update: true,
    delete: true,
    import: true,
  },
  'approval_request': {
    create: true,
    read: true,
    update: true,
    delete: true,
    import: false,
  },
  'attachment': {
    create: true,
    read: true,
    update: true,
    delete: true,
    import: false,
  },
  'comment': {
    create: true,
    read: true,
    update: true,
    delete: true,
    import: false,
  },
  'dashboard': {
    create: true,
    read: true,
    update: true,
    delete: true,
    import: false,
  },
  'dashboard_widget': {
    create: true,
    read: true,
    update: true,
    delete: true,
    import: false,
  },
  'organization': {
    create: true,
    read: true,
    update: true,
    delete: true,
    import: true,
  },
  'permission': {
    create: true,
    read: true,
    update: true,
    delete: true,
    import: true,
  },
  'reaction': {
    create: true,
    read: true,
    update: true,
    delete: true,
    import: false,
  },
  'role': {
    create: true,
    read: true,
    update: true,
    delete: true,
    import: true,
  },
  'user': {
    create: false,
    read: true,
    update: true,
    delete: false,
    import: true,
  },
};
