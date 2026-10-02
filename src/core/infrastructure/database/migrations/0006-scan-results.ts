/**
 * Migration 6: results as a scan saves them.
 *
 * A result must still tell the truth long after it was saved, whatever
 * happens to the records around it. Two tables change.
 *
 * results
 * - class_id: the class the student was in when the sheet was scanned. A
 *   student moved to another class later keeps this result under the old one.
 * - template_id: which sheet was read ("AC-40-V1").
 * - captured_at: when the photo was taken; created_at is when it was saved.
 * - The one-result-per-student-per-key rule is dropped. A second scan of the
 *   same student with the same key is a separate attempt, saved only after the
 *   Teacher confirms; it never replaces the first.
 *
 * student_answers, one row per question
 * - correct_answer: the answer key's letter at the time of scoring. Old
 *   results are never rescored from the live key.
 * - detected_state and detected_answer: what the reader concluded.
 * - final_answer: what was scored after the Teacher's review; NULL is a blank.
 * - manually_corrected, confidence.
 * - is_correct must agree with final_answer and correct_answer.
 *
 * scan_records is unchanged: one row per result with the path of its image.
 *
 * Deletion policy
 * - results.class_id is RESTRICT: a class named by a result cannot be deleted.
 * - The rest is as before: answers and the scan record go with their result;
 *   a student or an answer key with results cannot be deleted.
 *
 * Existing rows are converted, not dropped. No build before this one could
 * save a result, so an installed database has none; the conversion exists so
 * that this holds for any database. A legacy answer whose question has no
 * letter in the answer key cannot be given a correct_answer, so the guard
 * stops the migration and the runner rolls it back.
 */

const ISO_UTC =
  `'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T` +
  `[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'`;

const ID = `TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0)`;
const timestamp = (column: string) => `${column} TEXT NOT NULL CHECK (${column} GLOB ${ISO_UTC})`;
const ANSWER_LETTERS = `('A', 'B', 'C', 'D')`;

export const SCAN_RESULTS_SQL = `
CREATE TEMP TABLE migration_6_guard (
  problem TEXT NOT NULL,
  is_absent INTEGER NOT NULL CHECK (is_absent = 1)
);

INSERT INTO migration_6_guard
SELECT 'a saved answer has no correct answer in its answer key',
       NOT EXISTS (
         SELECT 1
           FROM student_answers a
           JOIN results r ON r.id = a.result_id
          WHERE NOT EXISTS (
                  SELECT 1
                    FROM answer_key_items i
                   WHERE i.answer_key_id = r.answer_key_id
                     AND i.question_number = a.question_number
                )
       );

DROP TABLE migration_6_guard;

CREATE TABLE new_results (
  id ${ID},
  answer_key_id TEXT NOT NULL REFERENCES answer_keys (id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  class_id TEXT NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  score INTEGER NOT NULL CHECK (score >= 0),
  total INTEGER NOT NULL CHECK (total >= 1),
  template_id TEXT NOT NULL CHECK (length(template_id) > 0),
  ${timestamp('captured_at')},
  ${timestamp('created_at')},
  CHECK (score <= total)
) STRICT;

INSERT INTO new_results
  (id, answer_key_id, student_id, class_id, score, total, template_id, captured_at, created_at)
SELECT r.id, r.answer_key_id, r.student_id, s.class_id, r.score, r.total, 'UNKNOWN',
       r.created_at, r.created_at
  FROM results r
  JOIN students s ON s.id = r.student_id;

CREATE TABLE new_student_answers (
  id ${ID},
  result_id TEXT NOT NULL REFERENCES results (id) ON DELETE CASCADE,
  question_number INTEGER NOT NULL CHECK (question_number >= 1),
  detected_state TEXT NOT NULL
    CHECK (detected_state IN ('MARKED', 'BLANK', 'MULTIPLE', 'UNCLEAR')),
  detected_answer TEXT CHECK (detected_answer IN ${ANSWER_LETTERS}),
  final_answer TEXT CHECK (final_answer IN ${ANSWER_LETTERS}),
  correct_answer TEXT NOT NULL CHECK (correct_answer IN ${ANSWER_LETTERS}),
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  manually_corrected INTEGER NOT NULL DEFAULT 0 CHECK (manually_corrected IN (0, 1)),
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  UNIQUE (result_id, question_number),
  -- The reader names a letter exactly when it read one clear mark.
  CHECK ((detected_state = 'MARKED') = (detected_answer IS NOT NULL)),
  -- Correct means: an answer was given and it is the key's letter. A blank is incorrect.
  CHECK (is_correct = (final_answer IS NOT NULL AND final_answer = correct_answer))
) STRICT;

INSERT INTO new_student_answers
  (id, result_id, question_number, detected_state, detected_answer, final_answer,
   correct_answer, is_correct, manually_corrected, confidence)
SELECT a.id,
       a.result_id,
       a.question_number,
       CASE a.state WHEN 'SELECTED' THEN 'MARKED' WHEN 'UNCERTAIN' THEN 'UNCLEAR' ELSE a.state END,
       CASE WHEN a.state = 'SELECTED' THEN a.selected_answer END,
       a.selected_answer,
       i.correct_answer,
       a.is_correct,
       a.teacher_corrected,
       NULL
  FROM student_answers a
  JOIN results r ON r.id = a.result_id
  JOIN answer_key_items i
    ON i.answer_key_id = r.answer_key_id AND i.question_number = a.question_number;

DROP TABLE student_answers;
DROP TABLE results;

ALTER TABLE new_results RENAME TO results;
ALTER TABLE new_student_answers RENAME TO student_answers;

-- Not unique any more: a student may have several attempts with one key.
CREATE INDEX idx_results_answer_key_id_student_id ON results (answer_key_id, student_id);
CREATE INDEX idx_results_student_id ON results (student_id);
CREATE INDEX idx_results_class_id ON results (class_id);
CREATE INDEX idx_results_created_at ON results (created_at);
`;
