import { ApplicationError, RecordInUseError } from '../../../core/application/errors';
import type { AnswerKey, AnswerKeyProblem, ValidAnswerKeyInput } from '../domain/answer-key';

/** An answer key with what a list needs to show beside it. */
export type AnswerKeyDetails = AnswerKey & {
  subjectName: string;
  /** Saved results scored with this key. Above zero, its scoring is frozen. */
  resultCount: number;
};

/** The name, subject, question count, or answers are missing or not allowed. */
export class InvalidAnswerKeyError extends ApplicationError {
  readonly problems: AnswerKeyProblem[];

  constructor(problems: AnswerKeyProblem[]) {
    super('VALIDATION_ERROR', 'The answer key is not valid.');
    this.name = 'InvalidAnswerKeyError';
    this.problems = problems;
  }
}

/**
 * Saved results were scored with this key, so its subject, question count,
 * and answers can no longer change. Its name still can. To revise it, the
 * Teacher duplicates it.
 */
export class AnswerKeyLockedError extends ApplicationError {
  readonly resultCount: number;

  constructor(resultCount: number) {
    super('ANSWER_KEY_LOCKED', 'The answer key has saved results and its answers are frozen.');
    this.name = 'AnswerKeyLockedError';
    this.resultCount = resultCount;
  }
}

/** The answer key cannot be deleted because saved results were scored with it. */
export class AnswerKeyInUseError extends RecordInUseError {
  readonly resultCount: number;

  constructor(resultCount: number) {
    super('The answer key has saved results.');
    this.name = 'AnswerKeyInUseError';
    this.resultCount = resultCount;
  }
}

/**
 * Local storage for answer keys. A key is always read and written whole: its
 * header and all of its answers together. Besides the errors named below,
 * every method can fail with an error whose code is `DATABASE_ERROR`.
 */
export type AnswerKeyRepository = {
  /**
   * Keys of one subject, or of every subject when `subjectId` is null, each
   * complete with its ordered answers, ordered by subject name, key name
   * (ignoring letter case), then id.
   */
  list(subjectId: string | null): Promise<AnswerKeyDetails[]>;
  getById(id: string): Promise<AnswerKeyDetails | null>;
  /** How many saved results were scored with the key. Zero for an unknown id. */
  countResults(id: string): Promise<number>;
  /**
   * Stores the key and all of its answers, or nothing.
   * @throws SubjectNotFoundError, DuplicateNameError
   */
  create(answerKey: AnswerKey): Promise<void>;
  /**
   * Replaces the key's values, all or nothing; `createdAt` is kept. When
   * results exist, only the name may differ.
   * @throws RecordNotFoundError, SubjectNotFoundError, DuplicateNameError, AnswerKeyLockedError
   */
  update(id: string, changes: ValidAnswerKeyInput, updatedAt: string): Promise<AnswerKey>;
  /**
   * Permanently deletes the key and its answers. Never deletes results.
   * @throws RecordNotFoundError, AnswerKeyInUseError
   */
  delete(id: string): Promise<void>;
};
