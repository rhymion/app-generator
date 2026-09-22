// AUTO-GENERATED - DO NOT EDIT
// State-transition gatekeeper (Issue #696 Stage 1 PR2b/PR2c). Model-scoped,
// not per-entity -- one table and one judgment function for every
// x-state-machines-governed field across the whole schema, mirroring
// lib/dashboard/catalog.ts's shape. Each entity's own
// service_validation.ts imports assertTransitionAllowed() from here and
// calls it at the update{Entity}/add{Entity} convergence point (the same
// place x-approval's own guard runs) -- never a dedicated per-field entry
// point.
import { AppError } from '@/lib/_errors';

type TransitionEdge = [string, string];

type TransitionConfig = {
  edges: TransitionEdge[];
  approvalEdges: TransitionEdge[] | null;
};

const TRANSITIONS: Record<string, TransitionConfig> = {
};

// Throws when (fromState, toState) is not a legal transition for
// `model.field`. A (model, field) pair absent from TRANSITIONS is not
// state-transition-governed at all -- callers only ever invoke this for a
// field they already know is governed (state_machine_transitions is
// non-empty), so that case is unreachable in generated code, not silently
// permitted.
export function assertTransitionAllowed(model: string, field: string, fromState: string, toState: string): void {
  const config = TRANSITIONS[`${model}.${field}`];
  if (!config) {
    throw new AppError('VALIDATION', 'no such transition', field, 'invalid');
  }
  const diagramPermits = config.edges.some(([from, to]) => from === fromState && to === toState);
  if (!diagramPermits) {
    throw new AppError('VALIDATION', 'no such transition', field, 'invalid');
  }
  if (config.approvalEdges) {
    const approvalPermits = config.approvalEdges.some(([from, to]) => from === fromState && to === toState);
    if (!approvalPermits) {
      throw new AppError('VALIDATION', 'transition not permitted by x-approval', field, 'invalid');
    }
  }
}
