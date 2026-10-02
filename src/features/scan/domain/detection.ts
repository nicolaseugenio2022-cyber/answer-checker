import { ANSWER_CHOICES, type AnswerChoice } from '../../answer-keys/domain/answer-key';

/**
 * Turning the measured darkness of four bubbles into what the student
 * answered. Pure: numbers in, a decision out. It never guesses: when the
 * darkest bubble is not clearly a mark, or not clearly darker than the next
 * one, the question is reported as unclear and the Teacher decides.
 *
 * A "fill" is the share of a bubble's inner area that is dark, from 0 (empty
 * paper) to 1 (completely shaded).
 *
 * The thresholds are starting values derived from generated test sheets. They
 * are not calibrated on printed sheets under classroom light yet; calibrate
 * them here, in one place, when real scans are available.
 */
export const DETECTION_THRESHOLDS = {
  /** At or above this fill a bubble counts as deliberately marked. */
  markedFill: 0.5,
  /** Below this fill a bubble counts as empty: stray dots, a faint eraser shadow. */
  blankFill: 0.15,
  /**
   * How much darker the strongest bubble must be than the second strongest
   * for the reader to pick it by itself.
   */
  separation: 0.25,
  /**
   * The second-strongest bubble may be a smudge or an erased mark up to this
   * fill. Above it, with the strongest one marked, the question is unclear.
   */
  erasedMaxFill: 0.38,
  /** A decision with less confidence than this is reported as unclear. */
  minConfidence: 0.35,
} as const;

/** What the reader concluded about one question, before the Teacher reviews it. */
export type DetectionState = 'marked' | 'blank' | 'multiple' | 'unclear';

/** The fill of each bubble of one question, in the order A, B, C, D. */
export type BubbleFills = readonly [number, number, number, number];

export type QuestionDetection = {
  questionNumber: number;
  state: DetectionState;
  /** The letter read, only when the state is `marked`. */
  answer: AnswerChoice | null;
  fills: BubbleFills;
  /** How sure the reader is of this state, from 0 to 1. */
  confidence: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Decides one question from its four fills. */
export function classifyQuestion(questionNumber: number, fills: BubbleFills): QuestionDetection {
  const { markedFill, blankFill, separation, erasedMaxFill, minConfidence } = DETECTION_THRESHOLDS;
  const ranked = fills.map((fill, index) => ({ fill, index })).sort((a, b) => b.fill - a.fill);
  const strongest = ranked[0];
  const second = ranked[1];
  const markedCount = fills.filter((fill) => fill >= markedFill).length;

  const result = (state: DetectionState, confidence: number, answer: AnswerChoice | null = null) => ({
    questionNumber,
    state,
    answer,
    fills,
    confidence: clamp01(confidence),
  });

  // Nothing is dark enough to be a mark.
  if (strongest.fill < blankFill) {
    return result('blank', 1 - strongest.fill / blankFill / 2);
  }
  // Two or more bubbles are fully marked.
  if (markedCount >= 2) {
    return result('multiple', (second.fill - markedFill) / (1 - markedFill) / 2 + 0.5);
  }
  // Something is there, but too faint to call a mark.
  if (strongest.fill < markedFill) {
    return result('unclear', 1 - (strongest.fill - blankFill) / (markedFill - blankFill));
  }
  // One clear mark; is the runner-up only a smudge?
  const gap = strongest.fill - second.fill;
  const confidence = Math.min(
    (strongest.fill - markedFill) / (1 - markedFill) + 0.5,
    gap / separation / 2
  );
  if (gap < separation || second.fill > erasedMaxFill || confidence < minConfidence) {
    return result('unclear', 1 - confidence);
  }
  return result('marked', confidence, ANSWER_CHOICES[strongest.index]);
}

/**
 * One question while the Teacher reviews the scan. The detection is kept as
 * read; `finalAnswer` is what will be scored.
 */
export type ReviewItem = {
  questionNumber: number;
  detection: QuestionDetection;
  /** The answer to score: a letter, or null for "left blank". */
  finalAnswer: AnswerChoice | null;
  /**
   * False while the Teacher still has to look at the question: it was read as
   * blank, multiple, or unclear and nothing was chosen or confirmed yet.
   */
  isResolved: boolean;
  /** True once the Teacher set an answer other than the one read. */
  wasCorrected: boolean;
};

/** How a reviewed question is described to the Teacher and stored. */
export type ReviewState = DetectionState | 'manually_corrected';

export function reviewState(item: ReviewItem): ReviewState {
  return item.wasCorrected ? 'manually_corrected' : item.detection.state;
}

/**
 * The review a scan starts with. A confidently marked question needs no
 * interaction. Blank, multiple, and unclear ones start unresolved: a blank may
 * stay blank, but only after the Teacher confirms it.
 */
export function startReview(detections: readonly QuestionDetection[]): ReviewItem[] {
  return detections.map((detection) => ({
    questionNumber: detection.questionNumber,
    detection,
    finalAnswer: detection.state === 'marked' ? detection.answer : null,
    isResolved: detection.state === 'marked',
    wasCorrected: false,
  }));
}

/**
 * The Teacher chooses a letter, or Blank (null), for one question. Choosing
 * what the reader already read is a confirmation, not a correction.
 */
export function setReviewAnswer(
  items: readonly ReviewItem[],
  questionNumber: number,
  answer: AnswerChoice | null
): ReviewItem[] {
  return items.map((item) => {
    if (item.questionNumber !== questionNumber) return item;
    const readAnswer = item.detection.state === 'marked' ? item.detection.answer : null;
    const isSameAsRead = answer === readAnswer && item.detection.state !== 'multiple' && item.detection.state !== 'unclear';
    return { ...item, finalAnswer: answer, isResolved: true, wasCorrected: !isSameAsRead };
  });
}

export function unresolvedCount(items: readonly ReviewItem[]): number {
  return items.filter((item) => !item.isResolved).length;
}

/** How many questions the reader put in each state. */
export function countStates(items: readonly ReviewItem[]): Record<DetectionState, number> {
  const counts: Record<DetectionState, number> = { marked: 0, blank: 0, multiple: 0, unclear: 0 };
  for (const item of items) counts[item.detection.state]++;
  return counts;
}
