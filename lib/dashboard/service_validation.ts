import prisma from '@/lib/prisma';
import { validateCustomRules } from '@/lib/dashboard/service_validation_custom';
import { AppError } from '@/lib/_errors';

type TransactionClient = Pick<typeof prisma, 'dashboard'>;
type RequiredField = { key: string; label: string };
type OneToOneRelation = { key: string; label: string; target: string; required: boolean };

const REQUIRED_FIELDS: RequiredField[] = [
  { key: 'name', label: 'Name' },
] ;

const DECIMAL_FIELDS: RequiredField[] = [
] ;

// Optional sign, digits, optional fractional part -- matches what a Prisma
// Decimal column accepts. This is the authoritative guard for the REST
// API / server-action write path (CSV import bypasses validateOnAdd/
// validateOnUpdate entirely -- see api_import_route.ts.jinja2's own
// DECIMAL_CELL_RE check).
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

function isInvalidDecimal(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  return !DECIMAL_PATTERN.test(value.trim());
}

const ONE_TO_ONE_RELATIONS: OneToOneRelation[] = [
] ;

function isMissingValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'boolean') return false;
  if (typeof value === 'number') return Number.isNaN(value);
  if (value instanceof Date) return Number.isNaN(value.getTime());
  if (typeof value === 'object' && value !== null && 'isValid' in value) {
    const maybeDayjs = value as { isValid?: () => boolean };
    if (typeof maybeDayjs.isValid === 'function') {
      return !maybeDayjs.isValid();
    }
  }
  return false;
}

// cmd_834: validateCustomRules's declared arity varies by entity -- newly
// generated stubs accept the pre-edit row as a 4th parameter, but every
// already-generated (GENERATED-ONCE, never rewritten in place)
// service_validation_custom.ts across every existing consumer entity still
// declares the pre-cmd_834 3-parameter signature. A function type with
// fewer parameters is always structurally assignable to one with more (the
// same rule that lets `(x) => x` satisfy an Array.prototype.map callback
// typed to take (item, index, array)), so casting the import through
// CustomRulesFn below compiles against BOTH shapes with no back-compat
// branch: an old 3-param implementation simply never binds the extra
// argument (JavaScript silently discards a call's trailing arguments a
// function doesn't declare); a new 4-param one receives it.
//
// cmd_891: actorId is added the same way, as a 5th parameter -- unlike
// prevRow it is never null at either call site (addDashboard/
// updateDashboard both declare `actorId: string`, resolved from
// the session cookie on the Server Action path and from the API key on the
// REST path -- see resolveActorId()/authenticateApiKey() in
// lib/api-auth.ts), so it is typed as a plain `string`, not
// `string | null`. Existing 3- and 4-parameter hand-written implementations
// widen the same structural way prevRow's did: a 5th argument they don't
// declare is silently discarded at the call site.
type CustomRulesFn = (
  tx: TransactionClient,
  data: Record<string, unknown>,
  currentId: string | null,
  prevRow: Record<string, unknown> | null,
  actorId: string,
) => Promise<void>;

async function validateSchemaRules(tx: TransactionClient, data: Record<string, unknown>, currentId: string | null, prevRow: Record<string, unknown> | null, actorId: string): Promise<void> {
  for (const field of REQUIRED_FIELDS) {
    if (isMissingValue(data[field.key])) {
      throw new AppError('VALIDATION', `${field.label} is required`, field.key, 'missing');
    }
  }

  for (const field of DECIMAL_FIELDS) {
    if (isInvalidDecimal(data[field.key])) {
      throw new AppError('VALIDATION', `${field.label} must be a valid decimal number`, field.key, 'invalid');
    }
  }

  for (const relation of ONE_TO_ONE_RELATIONS) {
    const value = data[relation.key];
    if (isMissingValue(value)) {
      if (relation.required) {
        throw new AppError('VALIDATION', `${relation.label} is required`, relation.key, 'missing');
      }
      continue;
    }

    const relationId = String(value);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targetExists = await (tx as any)[relation.target].findUnique({
      where: { id: relationId },
      select: { id: true },
    });
    if (!targetExists) {
      throw new AppError('VALIDATION', `${relation.label} does not exist`, relation.key, 'invalid');
    }

    const conflict = await tx.dashboard.findFirst({
      where: currentId
        ? { [relation.key]: relationId, NOT: { id: currentId } }
        : { [relation.key]: relationId },
      select: { id: true },
    });
    if (conflict) {
      throw new AppError('CONFLICT', `${relation.label} is already linked`, relation.key);
    }
  }

  // cmd_652: hand-written entity-specific business rules (e.g. a
  // self-referential relation that must only link same-"chain" rows) live
  // entirely in lib/dashboard/service_validation_custom.ts, a
  // GENERATED-ONCE stub — see that file for the socket contract. This call
  // is unconditional and identical for every entity; the generator carries
  // no knowledge of what (if anything) the hook checks.
  //
  // cmd_830: a hand-written rule rejects a value that IS present (e.g. "X
  // is not a party on the claimed policy") -- never a missing one, since
  // the REQUIRED_FIELDS loop above already owns that case for any field it
  // covers. service_validation_custom.ts predates the 'reason' discriminator
  // and always constructs AppError('VALIDATION', ...) with no 4th argument,
  // so re-tag it here rather than requiring every hand-written file across
  // every consumer project to be edited.
  try {
    await (validateCustomRules as CustomRulesFn)(tx, data, currentId, prevRow, actorId);
  } catch (e) {
    if (e instanceof AppError && e.code === 'VALIDATION' && !e.reason) {
      throw new AppError('VALIDATION', e.message, e.field, 'invalid');
    }
    throw e;
  }
}

export async function validateOnAdd(tx: TransactionClient, data: Record<string, unknown>, actorId: string): Promise<void> {
  await validateSchemaRules(tx, data, null, null, actorId);
}

export async function validateOnUpdate(tx: TransactionClient, id: string, data: Record<string, unknown>, prevRow: Record<string, unknown> | null, actorId: string): Promise<void> {
  await validateSchemaRules(tx, data, id, prevRow, actorId);
}
