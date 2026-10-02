/**
 * What Home shows: a few counts and the most recent activity, read from the
 * local database. It is a read model for one screen, not a report: no
 * averages, no pass or fail, no charts.
 */

export type DashboardCounts = {
  students: number;
  classes: number;
  answerKeys: number;
  /** Saved results. Several attempts of one student count separately. */
  results: number;
  /** Results whose photo was taken during the phone's current calendar day. */
  scannedToday: number;
};

/** A saved result, with the names it was saved under. */
export type RecentResult = {
  id: string;
  studentName: string;
  studentNumber: string;
  answerKeyName: string;
  score: number;
  total: number;
  /** When the photo was taken. */
  capturedAt: string;
  /** Its place among the results of the same student with the same answer key, and how many there are. */
  attempt: { number: number; count: number };
};

export type RecentAnswerKey = {
  id: string;
  name: string;
  subjectName: string;
  questionCount: number;
  /** When it was created or last changed. */
  updatedAt: string;
};

/**
 * What the most recent result was scanned with, as those records are called
 * now: the starting point of "Continue scanning". It names no student.
 */
export type LastScan = {
  subjectId: string;
  subjectName: string;
  answerKeyId: string;
  answerKeyName: string;
  classId: string;
  className: string;
};

/** How many recent results and recent answer keys Home lists. */
export const RECENT_LIMIT = 3;

/** One calendar day as two instants: from `start` (included) to `end` (not included), in UTC ISO-8601. */
export type DayRange = { start: string; end: string };

/**
 * The calendar day that contains `now`, where the phone is. Timestamps are
 * stored in UTC; "today" is the Teacher's local day, so its two ends are
 * local midnights, expressed in UTC. A day with a daylight-saving change is
 * 23 or 25 hours long and still one day.
 */
export function localDayRange(now: Date): DayRange {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}
