/**
 * Migration 7: a result keeps the names it was saved under.
 *
 * A result is a historical record. Until now it kept only the ids of its
 * student, class, and answer key, so renaming any of them, or the subject,
 * changed what an old result appeared to say. Five columns are added to
 * results and filled when the result is saved:
 *
 * - student_name, student_number: the student as written at the scan.
 * - class_name: the name of the class of the scan (class_id).
 * - subject_name, answer_key_name: the answer key and its subject.
 *
 * The ids stay, with their RESTRICT rules: they are what filtering and the
 * deletion restrictions use. The snapshots are what a result displays.
 *
 * Existing results are filled from the records they point to as they are now.
 * That is the best information there is: nothing older was stored. A result
 * whose student, class, answer key, or subject cannot be found would get an
 * incomplete history, so the guard stops the migration and the runner rolls
 * it back.
 *
 * SQLite cannot add a NOT NULL column with a CHECK to a table that has rows,
 * so results is rebuilt. student_answers and scan_records reference it by
 * name and are untouched.
 *
 * Indexes
 * - idx_results_captured_at (captured_at, created_at, id) is new: the list of
 *   results is read newest first in exactly that order, a page at a time.
 * - idx_results_created_at is not recreated: no query orders or filters by
 *   created_at alone.
 * - The indexes on (answer_key_id, student_id), student_id, and class_id are
 *   kept: they serve the filters, the attempt counts, and the checks that
 *   block deleting a student, an answer key, or a class with results.
 */

const ISO_UTC =
  `'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T` +
  `[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'`;

const ID = `TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0)`;
const timestamp = (column: string) => `${column} TEXT NOT NULL CHECK (${column} GLOB ${ISO_UTC})`;
const label = (column: string) => `${column} TEXT NOT NULL CHECK (length(${column}) > 0)`;

export const RESULT_SNAPSHOTS_SQL = `
CREATE TEMP TABLE migration_7_guard (
  problem TEXT NOT NULL,
  is_absent INTEGER NOT NULL CHECK (is_absent = 1)
);

INSERT INTO migration_7_guard
SELECT 'a result has no student, class, answer key, or subject to take its names from',
       (SELECT COUNT(*) FROM results) = (
         SELECT COUNT(*)
           FROM results r
           JOIN students st ON st.id = r.student_id
           JOIN classes c ON c.id = r.class_id
           JOIN answer_keys k ON k.id = r.answer_key_id
           JOIN subjects s ON s.id = k.subject_id
       );

DROP TABLE migration_7_guard;

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
  ${label('student_name')},
  ${label('student_number')},
  ${label('class_name')},
  ${label('subject_name')},
  ${label('answer_key_name')},
  CHECK (score <= total)
) STRICT;

INSERT INTO new_results
  (id, answer_key_id, student_id, class_id, score, total, template_id, captured_at, created_at,
   student_name, student_number, class_name, subject_name, answer_key_name)
SELECT r.id, r.answer_key_id, r.student_id, r.class_id, r.score, r.total, r.template_id,
       r.captured_at, r.created_at,
       st.full_name, st.student_number, c.name, s.name, k.name
  FROM results r
  JOIN students st ON st.id = r.student_id
  JOIN classes c ON c.id = r.class_id
  JOIN answer_keys k ON k.id = r.answer_key_id
  JOIN subjects s ON s.id = k.subject_id;

DROP TABLE results;
ALTER TABLE new_results RENAME TO results;

CREATE INDEX idx_results_answer_key_id_student_id ON results (answer_key_id, student_id);
CREATE INDEX idx_results_student_id ON results (student_id);
CREATE INDEX idx_results_class_id ON results (class_id);
CREATE INDEX idx_results_captured_at ON results (captured_at, created_at, id);
`;
