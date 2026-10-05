/**
 * Runtime for the hand-written dependency-value hook of generated test helpers.
 *
 * A generated `cypress/support/<entity>/helper.ts` creates the parent rows
 * (dependencies) its entity needs. Before each create, and before each
 * find-or-create lookup, it passes the values through the entity's
 * `helper_custom.ts` `dependencyValues(key, defaults)` and uses what comes back.
 * This module checks the returned values and fails closed.
 *
 * Rules (the error names the dependency key and the column):
 *   - a column that was supplied may keep its value or be a plain column the
 *     hook changes; a foreign-key or system column may not be changed or removed
 *   - a column that was not supplied must be a plain (non-foreign-key) column of
 *     the dependency's model
 */

export type DependencyColumns = {
  /** Plain columns of the dependency's model (not foreign keys, not system columns). */
  scalars: readonly string[];
  /** Foreign-key columns and system columns: the hook may not reassign these. */
  protectedColumns: readonly string[];
};

export type DependencyHook = (
  key: never,
  defaults: Record<string, unknown>,
) => Record<string, unknown>;

type Values = Record<string, unknown>;

function check(
  key: string,
  model: string,
  columns: DependencyColumns | undefined,
  defaults: Values,
  returned: Values,
): Values {
  if (returned === null || typeof returned !== 'object' || Array.isArray(returned)) {
    throw new Error(
      `dependencyValues(${JSON.stringify(key)}) must return an object of column values (dependency model ${model}).`,
    );
  }
  const scalars = new Set(columns?.scalars ?? []);
  const locked = new Set(columns?.protectedColumns ?? []);
  for (const column of Object.keys(returned)) {
    const supplied = Object.prototype.hasOwnProperty.call(defaults, column);
    if (supplied && returned[column] === defaults[column]) continue;
    if (locked.has(column)) {
      throw new Error(
        `dependencyValues(${JSON.stringify(key)}) changed "${column}" on ${model}: foreign-key and system columns cannot be reassigned.`,
      );
    }
    if (!supplied && !scalars.has(column)) {
      throw new Error(
        `dependencyValues(${JSON.stringify(key)}) returned "${column}", which is not a plain column of ${model}.`,
      );
    }
  }
  for (const column of Object.keys(defaults)) {
    if (!(column in returned) && locked.has(column)) {
      throw new Error(
        `dependencyValues(${JSON.stringify(key)}) dropped "${column}" on ${model}: foreign-key and system columns cannot be removed.`,
      );
    }
  }
  return returned;
}

/** Values for a dependency row about to be created. */
export function dependencyData(
  hook: DependencyHook,
  columnsByModel: Record<string, DependencyColumns>,
  key: string,
  model: string,
  defaults: Values,
): Values {
  const returned = (hook as (k: string, d: Values) => Values)(key, defaults);
  return check(key, model, columnsByModel[model], defaults, returned);
}

/**
 * The `where` of a find-or-create lookup. The hook receives the lookup columns
 * as `defaults`, so a row that only matches the default value is not reused.
 */
export function dependencyLookup(
  hook: DependencyHook,
  columnsByModel: Record<string, DependencyColumns>,
  key: string,
  model: string,
  where: Values,
): Values {
  const returned = (hook as (k: string, d: Values) => Values)(key, where);
  return check(key, model, columnsByModel[model], where, returned);
}
