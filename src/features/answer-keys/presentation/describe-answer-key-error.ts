import { DuplicateNameError, RecordNotFoundError } from '@/core/application/errors';
import { countOf, type ErrorDescription } from '@/core/presentation/lib/describe-name-error';
import {
  AnswerKeyInUseError,
  AnswerKeyLockedError,
  InvalidAnswerKeyError,
} from '@/features/answer-keys/application/answer-key-repository';
import type { AnswerKeyProblem } from '@/features/answer-keys/domain/answer-key';
import { SubjectNotFoundError } from '@/features/subjects/application/subject-repository';

export type AnswerKeyField = AnswerKeyProblem['field'];

const results = (count: number) => countOf(count, 'saved result');

/** Why a key with results cannot be changed, and what to do instead. */
export function describeLock(resultCount: number): string {
  return `This answer key has ${results(resultCount)}, so its subject, question count, and answers can no longer change. Duplicate it to make a revised version.`;
}

function describeProblem(problem: AnswerKeyProblem): string {
  switch (problem.field) {
    case 'name':
      return problem.problem === 'EMPTY'
        ? 'Enter a name for the answer key.'
        : `Use ${problem.maxLength} characters or fewer for the name.`;
    case 'subjectId':
      return 'Choose a subject.';
    case 'questionCount':
      return `Use ${problem.min} to ${problem.max} questions.`;
    case 'answers':
      return problem.problem === 'WRONG_COUNT'
        ? 'Every question needs an answer.'
        : problem.problem === 'MISSING'
          ? `${countOf(problem.questionNumbers.length, 'question')} without an answer.`
          : 'An answer can only be A, B, C, or D.';
  }
}

/** Which field a failed save belongs to, so the message can sit next to it. */
export function fieldOfAnswerKeyError(error: unknown): AnswerKeyField | null {
  if (error instanceof DuplicateNameError) return 'name';
  if (error instanceof SubjectNotFoundError) return 'subjectId';
  if (error instanceof InvalidAnswerKeyError) return error.problems[0]?.field ?? null;
  return null;
}

/** What to tell the Teacher about a failed answer key action. Never a raw database message. */
export function describeAnswerKeyError(error: unknown): ErrorDescription {
  if (error instanceof AnswerKeyInUseError) {
    return {
      kind: 'blocked',
      message: `This answer key has ${results(error.resultCount)}. Delete those results permanently first; then the answer key can be deleted.`,
    };
  }
  if (error instanceof AnswerKeyLockedError) {
    return { kind: 'invalid', message: describeLock(error.resultCount) };
  }
  if (error instanceof InvalidAnswerKeyError) {
    return { kind: 'invalid', message: error.problems.map(describeProblem).join(' ') };
  }
  if (error instanceof DuplicateNameError) {
    return {
      kind: 'invalid',
      message: `This subject already has an answer key named “${error.duplicateName}”.`,
    };
  }
  // Before RecordNotFoundError, which it extends: a missing subject is correctable.
  if (error instanceof SubjectNotFoundError) {
    return { kind: 'invalid', message: 'That subject no longer exists. Choose another subject.' };
  }
  if (error instanceof RecordNotFoundError) {
    return { kind: 'missing', message: 'That answer key no longer exists.' };
  }
  return {
    kind: 'failure',
    message: 'Something went wrong on this device. Nothing was changed. Try again.',
  };
}
