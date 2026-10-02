import type { AnswerChoice } from '../../answer-keys/domain/answer-key';

/**
 * A saved result is a historical record. Nothing in it can be changed: not the
 * score, not an answer, not who or what it was saved under. A wrong result is
 * deleted permanently and the sheet is scanned again. That is why this module
 * has ways to read a result and none to alter one.
 */

/** What the reader concluded about a question when the sheet was scanned. */
export type StoredDetectionState = 'MARKED' | 'BLANK' | 'MULTIPLE' | 'UNCLEAR';

/**
 * Which attempt a result is among the results of the same student with the
 * same answer key, counted from the earliest photo. `count` is how many there
 * are now; it is 1 for almost every result.
 */
export type Attempt = { number: number; count: number };

/** The names a result was saved under. They do not follow later renames or a student's move. */
export type ResultIdentity = {
  studentName: string;
  studentNumber: string;
  className: string;
  subjectName: string;
  answerKeyName: string;
};

/** One row of the results list. */
export type ResultSummary = ResultIdentity & {
  id: string;
  score: number;
  total: number;
  /** When the photo was taken. */
  capturedAt: string;
  /** When the result was saved. */
  createdAt: string;
  attempt: Attempt;
};

/** One question of a saved result, as it was scored. */
export type ResultAnswer = {
  questionNumber: number;
  detectedState: StoredDetectionState;
  /** The letter the reader read; null unless it read one clear mark. */
  detectedAnswer: AnswerChoice | null;
  /** What was scored after the Teacher's review; null is a blank. */
  finalAnswer: AnswerChoice | null;
  /** The answer key's letter when the result was scored. */
  correctAnswer: AnswerChoice;
  isCorrect: boolean;
  manuallyCorrected: boolean;
  /** How sure the reader was, from 0 to 1; null when it was not recorded. */
  confidence: number | null;
};

/** A complete result: its row of the list, where it points, and every answer in question order. */
export type ResultDetail = ResultSummary & {
  answerKeyId: string;
  studentId: string;
  classId: string;
  templateId: string;
  answers: ResultAnswer[];
  /** The stored path of the scan image, relative to the app's documents; null when none was recorded. */
  imagePath: string | null;
};

/** The score as a whole percentage. */
export function percentage(score: number, total: number): number {
  return total <= 0 ? 0 : Math.round((score / total) * 100);
}

export type AnswerTally = {
  total: number;
  correct: number;
  /** Answered with a letter that is not the key's. */
  incorrect: number;
  /** Left blank. A blank scores as not correct and is counted here, not as incorrect. */
  blank: number;
  manuallyCorrected: number;
};

/** Correct, incorrect, and blank always add up to the total. */
export function tallyAnswers(answers: readonly ResultAnswer[]): AnswerTally {
  const tally: AnswerTally = {
    total: answers.length,
    correct: 0,
    incorrect: 0,
    blank: 0,
    manuallyCorrected: 0,
  };
  for (const answer of answers) {
    if (answer.finalAnswer === null) tally.blank++;
    else if (answer.isCorrect) tally.correct++;
    else tally.incorrect++;
    if (answer.manuallyCorrected) tally.manuallyCorrected++;
  }
  return tally;
}

/** Which questions the detail screen lists. */
export type AnswerView = 'all' | 'incorrect' | 'blank' | 'corrected';

export function answersInView(answers: readonly ResultAnswer[], view: AnswerView): ResultAnswer[] {
  switch (view) {
    case 'incorrect':
      return answers.filter((answer) => answer.finalAnswer !== null && !answer.isCorrect);
    case 'blank':
      return answers.filter((answer) => answer.finalAnswer === null);
    case 'corrected':
      return answers.filter((answer) => answer.manuallyCorrected);
    default:
      return [...answers];
  }
}
