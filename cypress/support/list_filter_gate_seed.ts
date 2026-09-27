// Hand-written self-seed helper for list_filter_gate specs (app-generator#756),
// mirroring approval_flow_seed.ts's pattern: x-generate.test: false means no
// generator-produced cy.task('db:populateListFilterGate...') helper exists,
// so specs create their own rows directly through the still-generated
// /api/list_filter_gate endpoint.
import { TEST_API_KEY } from './test-credentials';

export type SeedListFilterGate = {
  id: string;
  label: string;
};

export function apiCreateListFilterGate(opts: {
  label: string;
  statusType?: 'queued' | 'running' | 'done' | null;
  isEnabled?: boolean | null;
  validFrom?: string | null; // ISO date-time string, e.g. '2026-01-15T00:00:00.000Z'
  startedAt?: string | null; // ISO date-time string
  priority?: number | null;
  weight?: string | null; // Decimal-as-string, e.g. '12.34'
}) {
  return cy
    .request({
      method: 'POST',
      url: '/api/list_filter_gate',
      headers: { 'X-API-Key': TEST_API_KEY },
      body: {
        label: opts.label,
        status_type: opts.statusType ?? null,
        is_enabled: opts.isEnabled ?? null,
        valid_from: opts.validFrom ?? null,
        started_at: opts.startedAt ?? null,
        priority: opts.priority ?? null,
        weight: opts.weight ?? null,
      },
    })
    .then((res) => {
      expect(res.status).to.eq(201);
      return { id: (res.body as { id: string }).id, label: opts.label } as SeedListFilterGate;
    });
}
