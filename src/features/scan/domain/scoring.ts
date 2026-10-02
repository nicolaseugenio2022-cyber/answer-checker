import type { AnswerChoice } from '../../answer-keys/domain/answer-key';
import {
  reviewState,
  type DetectionState,
  type ReviewItem,
  type ReviewState,
} from './detection';

/** One scored question, with the correct answer as it was when the sheet was scored. */
export type ScoredAnswer = {
  questionNumber: number;
  /** Snapshot of the answer key's letter. Later edits to the key do not change it. */
  correctAnswer: AnswerChoice;
  /** What the student is taken to have answered; null is a blank. */
  finalAnswer: AnswerChoice | null;
  isCorrect: boolean;
  state: ReviewState;
  /** What the reader concluded before any correction. */
  detectedState: DetectionState;
  detectedAnswer: AnswerChoice | null;
  wasCorrected: boolean;
  confidence: number;
};

export type Score = {
  /** One point per correct answer. No partial credit. */
  score: number;
  /** The number of questions of the answer key. */
  total: number;
  answers: ScoredAnswer[];
};

export type ScoringProblem =
  /** The review does not cover exactly questions 1 to the number of correct answers. */
  | 'QUESTIONS_DO_NOT_MATCH'
  /** A question still waits for the Teacher. */
  | 'UNRESOLVED';

/**
 * Scores a reviewed scan against the correct answers. A blank is incorrect.
 * Refuses to score while a question is unresolved or the questions do not
 * line up with the key.
 */
export function scoreReview(
  items: readonly ReviewItem[],
  correctAnswers: readonly AnswerChoice[]
): { ok: true; value: Score } | { ok: false; problem: ScoringProblem } {
  const ordered = [...items].sort((a, b) => a.questionNumber - b.questionNumber);
  const lineUp =
    ordered.length === correctAnswers.length &&
    ordered.every((item, index) => item.questionNumber === index + 1);
  if (!lineUp) return { ok: false, problem: 'QUESTIONS_DO_NOT_MATCH' };
  if (ordered.some((item) => !item.isResolved)) return { ok: false, problem: 'UNRESOLVED' };

  const answers = ordered.map((item, index): ScoredAnswer => {
    const correctAnswer = correctAnswers[index];
    return {
      questionNumber: item.questionNumber,
      correctAnswer,
      finalAnswer: item.finalAnswer,
      isCorrect: item.finalAnswer !== null && item.finalAnswer === correctAnswer,
      state: reviewState(item),
      detectedState: item.detection.state,
      detectedAnswer: item.detection.answer,
      wasCorrected: item.wasCorrected,
      confidence: item.detection.confidence,
    };
  });

  return {
    ok: true,
    value: {
      score: answers.filter((answer) => answer.isCorrect).length,
      total: correctAnswers.length,
      answers,
    },
  };
}

/** The score as it stands, counting unresolved questions as incorrect. For the preview only. */
export function previewScore(
  items: readonly ReviewItem[],
  correctAnswers: readonly AnswerChoice[]
): { score: number; total: number } {
  const score = items.filter(
    (item) =>
      item.finalAnswer !== null && item.finalAnswer === correctAnswers[item.questionNumber - 1]
  ).length;
  return { score, total: correctAnswers.length };
}
