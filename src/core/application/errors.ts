import type { NameProblem } from '../domain/record-name';

/**
 * Failures a use case can report. Callers branch on the class or on `code`,
 * never on the message. `VALIDATION_ERROR` and `NOT_FOUND` are the codes in
 * docs/api.md; `DUPLICATE_NAME` and `IN_USE` are additions for cases that list
 * does not cover. Any other failure of local storage reaches the caller as an
 * error whose code is `DATABASE_ERROR`.
 *
 * Fields are assigned explicitly (no constructor parameter properties) so
 * these files also run under Node's type stripping in the tests.
 */
export class ApplicationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
  }
}

export class InvalidNameError extends ApplicationError {
  readonly problem: NameProblem;
  readonly maxLength: number;

  constructor(problem: NameProblem, maxLength: number) {
    super(
      'VALIDATION_ERROR',
      problem === 'EMPTY' ? 'A name is required.' : `A name can have at most ${maxLength} characters.`
    );
    this.name = 'InvalidNameError';
    this.problem = problem;
    this.maxLength = maxLength;
  }
}

/** Another record of the same kind already has this name, ignoring letter case. */
export class DuplicateNameError extends ApplicationError {
  readonly duplicateName: string;

  constructor(duplicateName: string) {
    super('DUPLICATE_NAME', 'Another record already has this name.');
    this.name = 'DuplicateNameError';
    this.duplicateName = duplicateName;
  }
}

export class RecordNotFoundError extends ApplicationError {
  readonly id: string;

  constructor(id: string) {
    super('NOT_FOUND', 'The record does not exist.');
    this.name = 'RecordNotFoundError';
    this.id = id;
  }
}

/** Base for "cannot delete: other records depend on this one". Features add the counts. */
export class RecordInUseError extends ApplicationError {
  constructor(message: string) {
    super('IN_USE', message);
    this.name = 'RecordInUseError';
  }
}
