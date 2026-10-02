/**
 * Rules for the names the Teacher gives records (subjects, classes). Pure
 * functions: no React, Expo, or SQLite.
 */

export type NameProblem = 'EMPTY' | 'TOO_LONG';

/** The form in which a name is stored: surrounding whitespace removed. */
export function normalizeName(raw: string): string {
  return raw.trim();
}

/** Length as the Teacher counts it: one per character, not per UTF-16 unit. */
export function nameLength(name: string): number {
  return Array.from(name).length;
}

/** What is wrong with an already normalized name, or null when it is acceptable. */
export function findNameProblem(name: string, maxLength: number): NameProblem | null {
  if (name.length === 0) return 'EMPTY';
  if (nameLength(name) > maxLength) return 'TOO_LONG';
  return null;
}

/**
 * Key for comparing names: two names with the same key are the same name.
 * Ignores letter case, including for letters outside ASCII, which SQLite's
 * NOCASE collation does not fold.
 */
export function nameKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}
