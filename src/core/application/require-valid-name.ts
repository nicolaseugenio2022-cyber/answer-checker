import { findNameProblem, normalizeName } from '../domain/record-name';
import { InvalidNameError } from './errors';

/** Returns the name in its stored form, or throws InvalidNameError. */
export function requireValidName(raw: string, maxLength: number): string {
  const name = normalizeName(raw);
  const problem = findNameProblem(name, maxLength);
  if (problem) throw new InvalidNameError(problem, maxLength);
  return name;
}
