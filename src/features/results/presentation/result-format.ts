import { percentage, type Attempt, type ResultSummary } from '@/features/results/domain/result';

/** "Oct 2, 10:42 AM": short enough for a list row. */
export const formatShortDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** "Oct 2, 2026, 10:42 AM": with the year, for details and confirmations. */
export const formatFullDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** "8/10": correct answers over questions. No pass or fail: the app has no passing mark. */
export const formatScore = (score: number, total: number) => `${score}/${total}`;

export const formatPercentage = (score: number, total: number) => `${percentage(score, total)}%`;

/** "Attempt 2 of 3", or null for the usual case of a single result. */
export const formatAttempt = (attempt: Attempt) =>
  attempt.count > 1 ? `Attempt ${attempt.number} of ${attempt.count}` : null;

/** One sentence per fact, for a screen reader. */
export function describeSummary(result: ResultSummary): string {
  return [
    `${result.studentName}, Student ID ${result.studentNumber}, class ${result.className}`,
    `${result.answerKeyName}, ${result.subjectName}`,
    `Score ${result.score} of ${result.total}, ${percentage(result.score, result.total)} percent`,
    `Scanned ${formatFullDate(result.capturedAt)}`,
    formatAttempt(result.attempt),
  ]
    .filter(Boolean)
    .join('. ');
}
