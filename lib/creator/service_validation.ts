import prisma from '@/lib/prisma';

type TransactionClient = Pick<typeof prisma, 'creator'>;
type RequiredField = { key: string; label: string };
type OneToOneRelation = { key: string; label: string; target: string; required: boolean };

const REQUIRED_FIELDS: RequiredField[] = [
  { key: 'name', label: 'Name' },
  { key: 'role', label: 'Role' },
  { key: 'affiliation', label: 'Affiliation' },
] ;

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

async function validateSchemaRules(tx: TransactionClient, data: Record<string, unknown>, currentId: string | null): Promise<void> {
  for (const field of REQUIRED_FIELDS) {
    if (isMissingValue(data[field.key])) {
      throw new Error(`${field.label} is required`);
    }
  }

  for (const relation of ONE_TO_ONE_RELATIONS) {
    const value = data[relation.key];
    if (isMissingValue(value)) {
      if (relation.required) {
        throw new Error(`${relation.label} is required`);
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
      throw new Error(`${relation.label} does not exist`);
    }

    const conflict = await tx.creator.findFirst({
      where: currentId
        ? { [relation.key]: relationId, NOT: { id: currentId } }
        : { [relation.key]: relationId },
      select: { id: true },
    });
    if (conflict) {
      throw new Error(`${relation.label} is already linked`);
    }
  }
}

export async function validateOnAdd(tx: TransactionClient, data: Record<string, unknown>): Promise<void> {
  await validateSchemaRules(tx, data, null);
}

export async function validateOnUpdate(tx: TransactionClient, id: string, data: Record<string, unknown>): Promise<void> {
  await validateSchemaRules(tx, data, id);
}
