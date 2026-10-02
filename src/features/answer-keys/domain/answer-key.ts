import { nameLength } from '../../../core/domain/record-name';

/**
 * An answer key: the correct answers of one physical test. The Teacher does
 * not create the test in the app, only its key. A key belongs to one subject
 * and to no class: it is used with every class that takes the subject.
 */

export const ANSWER_CHOICES = ['A', 'B', 'C', 'D'] as const;

/** One bubble of the answer sheet. */
export type AnswerChoice = (typeof ANSWER_CHOICES)[number];

export const ANSWER_KEY_MIN_QUESTIONS = 1;

/**
 * The Teacher decides how many questions a test has; the database sets no
 * upper limit. This ceiling only keeps a mistyped number (2000 for 20) from
 * building a form the phone cannot show. Raise it here if a real test needs
 * more; no migration is involved.
 */
export const ANSWER_KEY_MAX_QUESTIONS = 200;

/** The same limit as subject and class names, so a name fits a list row. */
export const ANSWER_KEY_NAME_MAX_LENGTH = 60;

export type AnswerKey = {
  id: string;
  subjectId: string;
  name: string;
  questionCount: number;
  /** The correct answer of each question in order: index 0 is question 1. */
  answers: AnswerChoice[];
  /** UTC ISO-8601 instants, as Date.prototype.toISOString() produces. */
  createdAt: string;
  updatedAt: string;
};

/** What the Teacher enters. An answer that is not chosen yet is null. */
export type AnswerKeyInput = {
  name: string;
  subjectId: string;
  questionCount: number;
  answers: readonly (string | null | undefined)[];
};

/** Input that passed validation: complete and in stored form. */
export type ValidAnswerKeyInput = {
  name: string;
  subjectId: string;
  questionCount: number;
  answers: AnswerChoice[];
};

export type AnswerKeyProblem =
  | { field: 'name'; problem: 'EMPTY' }
  | { field: 'name'; problem: 'TOO_LONG'; maxLength: number }
  | { field: 'subjectId'; problem: 'EMPTY' }
  | { field: 'questionCount'; problem: 'OUT_OF_RANGE'; min: number; max: number }
  /** There are more or fewer answers than questions. */
  | { field: 'answers'; problem: 'WRONG_COUNT'; expected: number; actual: number }
  | { field: 'answers'; problem: 'MISSING'; questionNumbers: number[] }
  | { field: 'answers'; problem: 'INVALID_CHOICE'; questionNumbers: number[] };

export function isAnswerChoice(value: unknown): value is AnswerChoice {
  return typeof value === 'string' && (ANSWER_CHOICES as readonly string[]).includes(value);
}

export function isValidQuestionCount(count: number): boolean {
  return (
    Number.isInteger(count) &&
    count >= ANSWER_KEY_MIN_QUESTIONS &&
    count <= ANSWER_KEY_MAX_QUESTIONS
  );
}

/**
 * Checks what the Teacher entered. Returns the input in its stored form, or
 * everything that is wrong with it. A key is valid only when every question
 * from 1 to the question count has exactly one of A, B, C, D.
 */
export function validateAnswerKeyInput(
  input: AnswerKeyInput
): { ok: true; value: ValidAnswerKeyInput } | { ok: false; problems: AnswerKeyProblem[] } {
  const problems: AnswerKeyProblem[] = [];
  const name = input.name.trim();
  const subjectId = input.subjectId.trim();

  if (name.length === 0) {
    problems.push({ field: 'name', problem: 'EMPTY' });
  } else if (nameLength(name) > ANSWER_KEY_NAME_MAX_LENGTH) {
    problems.push({ field: 'name', problem: 'TOO_LONG', maxLength: ANSWER_KEY_NAME_MAX_LENGTH });
  }

  if (subjectId.length === 0) problems.push({ field: 'subjectId', problem: 'EMPTY' });

  if (!isValidQuestionCount(input.questionCount)) {
    problems.push({
      field: 'questionCount',
      problem: 'OUT_OF_RANGE',
      min: ANSWER_KEY_MIN_QUESTIONS,
      max: ANSWER_KEY_MAX_QUESTIONS,
    });
  } else if (input.answers.length !== input.questionCount) {
    problems.push({
      field: 'answers',
      problem: 'WRONG_COUNT',
      expected: input.questionCount,
      actual: input.answers.length,
    });
  } else {
    const missing: number[] = [];
    const invalid: number[] = [];
    input.answers.forEach((answer, index) => {
      if (answer === null || answer === undefined || answer === '') missing.push(index + 1);
      else if (!isAnswerChoice(answer)) invalid.push(index + 1);
    });
    if (missing.length > 0) {
      problems.push({ field: 'answers', problem: 'MISSING', questionNumbers: missing });
    }
    if (invalid.length > 0) {
      problems.push({ field: 'answers', problem: 'INVALID_CHOICE', questionNumbers: invalid });
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      name,
      subjectId,
      questionCount: input.questionCount,
      answers: input.answers as AnswerChoice[],
    },
  };
}

/** One stored answer of a key, as a row: a question number and its letter. */
export type AnswerKeyItem = { questionNumber: number; correctAnswer: string };

export type AnswerItemsProblem =
  | 'WRONG_COUNT'
  | 'DUPLICATE_QUESTION'
  | 'NOT_CONTINUOUS'
  | 'INVALID_CHOICE';

/**
 * Builds the ordered answers of a key from its stored items, in any order.
 * The items must be exactly questions 1 to `questionCount`, each once, each
 * with one of A, B, C, D; anything else is reported instead of being patched
 * up, because a key with a gap or a guess would score sheets wrongly.
 */
export function assembleAnswers(
  questionCount: number,
  items: readonly AnswerKeyItem[]
): { ok: true; answers: AnswerChoice[] } | { ok: false; problem: AnswerItemsProblem } {
  const byNumber = new Map<number, string>();
  for (const item of items) {
    if (byNumber.has(item.questionNumber)) return { ok: false, problem: 'DUPLICATE_QUESTION' };
    byNumber.set(item.questionNumber, item.correctAnswer);
  }
  if (items.length !== questionCount) return { ok: false, problem: 'WRONG_COUNT' };

  const answers: AnswerChoice[] = [];
  for (let questionNumber = 1; questionNumber <= questionCount; questionNumber++) {
    const answer = byNumber.get(questionNumber);
    if (answer === undefined) return { ok: false, problem: 'NOT_CONTINUOUS' };
    if (!isAnswerChoice(answer)) return { ok: false, problem: 'INVALID_CHOICE' };
    answers.push(answer);
  }
  return { ok: true, answers };
}

/** Whether a change touches what a sheet is scored against: subject, count, or any answer. */
export function changesScoring(
  current: Pick<AnswerKey, 'subjectId' | 'questionCount' | 'answers'>,
  next: Pick<ValidAnswerKeyInput, 'subjectId' | 'questionCount' | 'answers'>
): boolean {
  return (
    current.subjectId !== next.subjectId ||
    current.questionCount !== next.questionCount ||
    current.answers.length !== next.answers.length ||
    current.answers.some((answer, index) => answer !== next.answers[index])
  );
}

const COPY_SUFFIX = ' – Copy';

/**
 * A name for a copy that no key of the subject has yet: "Name – Copy", then
 * "Name – Copy 2", and so on. The original name is shortened if needed so the
 * result stays within the name limit.
 */
export function proposeCopyName(name: string, takenNames: readonly string[]): string {
  const taken = new Set(takenNames.map((taken) => taken.trim().normalize('NFC').toLowerCase()));
  for (let attempt = 1; ; attempt++) {
    const suffix = attempt === 1 ? COPY_SUFFIX : `${COPY_SUFFIX} ${attempt}`;
    const room = ANSWER_KEY_NAME_MAX_LENGTH - nameLength(suffix);
    const base = Array.from(name.trim()).slice(0, room).join('').trimEnd();
    const candidate = `${base}${suffix}`;
    if (!taken.has(candidate.normalize('NFC').toLowerCase())) return candidate;
  }
}
