import type { Migration } from './run-migrations';

/**
 * Ordered schema migrations. Versions start at 1 and increase by one.
 * Never edit or reorder a migration that has shipped; append a new one.
 *
 * Empty on purpose: no production tables are defined yet.
 */
export const MIGRATIONS: readonly Migration[] = [];
