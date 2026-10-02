import { RecordInUseError, RecordNotFoundError } from '../../../core/application/errors';
import type { Subject } from '../domain/subject';

/** An operation named a subject that does not exist. */
export class SubjectNotFoundError extends RecordNotFoundError {
  constructor(id: string) {
    super(id);
    this.name = 'SubjectNotFoundError';
  }
}

/** The subject cannot be deleted because answer keys belong to it. */
export class SubjectInUseError extends RecordInUseError {
  readonly answerKeyCount: number;

  constructor(answerKeyCount: number) {
    super('The subject has answer keys.');
    this.name = 'SubjectInUseError';
    this.answerKeyCount = answerKeyCount;
  }
}

/**
 * Local storage for subjects. Besides the errors named below, every method
 * can fail with an error whose code is `DATABASE_ERROR`.
 */
export type SubjectRepository = {
  /** All subjects, alphabetically, ignoring letter case. */
  list(): Promise<Subject[]>;
  getById(id: string): Promise<Subject | null>;
  /** @throws DuplicateNameError when another subject has this name. */
  create(subject: Subject): Promise<void>;
  /**
   * Changes the name and `updatedAt`; `createdAt` is kept.
   * @throws RecordNotFoundError, DuplicateNameError
   */
  rename(id: string, name: string, updatedAt: string): Promise<Subject>;
  /**
   * Permanently deletes the subject. Never deletes answer keys.
   * @throws RecordNotFoundError, SubjectInUseError
   */
  delete(id: string): Promise<void>;
};
