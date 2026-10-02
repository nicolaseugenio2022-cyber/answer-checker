import { RecordInUseError } from '../../../core/application/errors';
import type { Subject } from '../domain/subject';

/** The subject cannot be deleted because exams use it. */
export class SubjectInUseError extends RecordInUseError {
  readonly examCount: number;

  constructor(examCount: number) {
    super('The subject is used by exams.');
    this.name = 'SubjectInUseError';
    this.examCount = examCount;
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
   * Permanently deletes the subject. Never deletes exams.
   * @throws RecordNotFoundError, SubjectInUseError
   */
  delete(id: string): Promise<void>;
};
