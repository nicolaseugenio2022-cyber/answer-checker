/**
 * Migration 4: answer keys replace exams.
 *
 * The Teacher does not create an exam in the app. The examination is a paper
 * that already exists; the app stores only the answer key used to check it. An
 * answer key belongs to one subject, has 1 to 40 questions with one correct
 * letter each, and is reused with every class that takes the subject. It is no
 * longer tied to a class.
 *
 * Before                                   After
 *   exams (subject_id, class_id, title)      answer_keys (subject_id, name)
 *   exam_questions + answer_keys             answer_key_items
 *   exam_results (exam_id)                   results (answer_key_id)
 *   student_answers, scan_records            the same, now pointing at results
 *
 * Conversion
 * - An exam row becomes an answer key with the same id, subject, question
 *   count, and timestamps. Its class is dropped.
 * - Its title becomes the name. Where two exams of one subject share a title
 *   (the old schema allowed that for different classes), the class name is
 *   appended, "Quiz 1 (BSIT 1A)", so both survive and stay distinguishable.
 * - Each question with its correct letter becomes one item. Result rows keep
 *   their ids and now reference the answer key.
 *
 * Nothing is invented and nothing is dropped silently. The migration stops,
 * and the runner rolls it back, when legacy data cannot be converted exactly:
 *   - a question count outside 1 to 40,
 *   - an exam whose questions are not exactly 1..question_count, each with a
 *     correct answer,
 *   - a question worth other than one point (the new model has no weights),
 *   - two names that are still equal after the class name is appended.
 * The first three are detected by the guard table below; its CHECK fails and
 * names the problem. No build before this one could create exam rows, so an
 * installed database has none.
 *
 * Deletion policy
 * - CASCADE inside an aggregate: an answer key with its items; a result with
 *   its answers and scan record.
 * - RESTRICT elsewhere: a subject with answer keys, and an answer key or a
 *   student with results, cannot be deleted.
 *
 * The runner applies migrations on a connection where foreign-key enforcement
 * is off, which is what rebuilding tables requires; the tests run
 * PRAGMA foreign_key_check afterwards.
 */

const ISO_UTC =
  `'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T` +
  `[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'`;

const ID = `TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0)`;
const timestamp = (column: string) => `${column} TEXT NOT NULL CHECK (${column} GLOB ${ISO_UTC})`;
const ANSWER_LETTERS = `('A', 'B', 'C', 'D')`;

export const ANSWER_KEYS_SQL = `
CREATE TEMP TABLE migration_4_guard (
  problem TEXT NOT NULL,
  is_absent INTEGER NOT NULL CHECK (is_absent = 1)
);

INSERT INTO migration_4_guard
SELECT 'an exam has a question count outside 1 to 40',
       NOT EXISTS (SELECT 1 FROM exams WHERE question_count NOT BETWEEN 1 AND 40);

INSERT INTO migration_4_guard
SELECT 'an exam does not have exactly one answered question for each number',
       NOT EXISTS (
         SELECT 1
           FROM exams e
          WHERE e.question_count <> (SELECT COUNT(*) FROM exam_questions q WHERE q.exam_id = e.id)
             OR e.question_count <> (
                  SELECT COUNT(*)
                    FROM exam_questions q
                    JOIN answer_keys k ON k.exam_question_id = q.id
                   WHERE q.exam_id = e.id
                     AND q.question_number BETWEEN 1 AND e.question_count
                )
       );

INSERT INTO migration_4_guard
SELECT 'a question is worth other than one point',
       NOT EXISTS (SELECT 1 FROM exam_questions WHERE points <> 1);

DROP TABLE migration_4_guard;

CREATE TABLE new_answer_keys (
  id ${ID},
  subject_id TEXT NOT NULL REFERENCES subjects (id) ON DELETE RESTRICT,
  name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0),
  question_count INTEGER NOT NULL CHECK (question_count BETWEEN 1 AND 40),
  ${timestamp('created_at')},
  ${timestamp('updated_at')}
) STRICT;

INSERT INTO new_answer_keys (id, subject_id, name, question_count, created_at, updated_at)
SELECT e.id,
       e.subject_id,
       CASE
         WHEN (SELECT COUNT(*)
                 FROM exams other
                WHERE other.subject_id = e.subject_id
                  AND trim(other.title) = trim(e.title) COLLATE NOCASE) > 1
         THEN trim(e.title) || ' (' || c.name || ')'
         ELSE trim(e.title)
       END,
       e.question_count,
       e.created_at,
       e.updated_at
  FROM exams e
  JOIN classes c ON c.id = e.class_id;

CREATE TABLE answer_key_items (
  answer_key_id TEXT NOT NULL REFERENCES answer_keys (id) ON DELETE CASCADE,
  question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 40),
  correct_answer TEXT NOT NULL CHECK (correct_answer IN ${ANSWER_LETTERS}),
  PRIMARY KEY (answer_key_id, question_number)
) STRICT;

INSERT INTO answer_key_items (answer_key_id, question_number, correct_answer)
SELECT q.exam_id, q.question_number, k.correct_answer
  FROM exam_questions q
  JOIN answer_keys k ON k.exam_question_id = q.id;

CREATE TABLE results (
  id ${ID},
  answer_key_id TEXT NOT NULL REFERENCES answer_keys (id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  score INTEGER NOT NULL CHECK (score >= 0),
  total INTEGER NOT NULL CHECK (total >= 0),
  ${timestamp('created_at')},
  CHECK (score <= total)
) STRICT;

INSERT INTO results (id, answer_key_id, student_id, score, total, created_at)
SELECT id, exam_id, student_id, score, total, created_at FROM exam_results;

CREATE TABLE new_student_answers (
  id ${ID},
  result_id TEXT NOT NULL REFERENCES results (id) ON DELETE CASCADE,
  question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 40),
  state TEXT NOT NULL CHECK (state IN ('SELECTED', 'BLANK', 'MULTIPLE', 'UNCERTAIN')),
  selected_answer TEXT CHECK (selected_answer IN ${ANSWER_LETTERS}),
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  teacher_corrected INTEGER NOT NULL DEFAULT 0 CHECK (teacher_corrected IN (0, 1)),
  UNIQUE (result_id, question_number),
  -- An answer letter is recorded exactly when one bubble was read as selected.
  CHECK ((state = 'SELECTED') = (selected_answer IS NOT NULL))
) STRICT;

INSERT INTO new_student_answers
SELECT id, result_id, question_number, state, selected_answer, is_correct, teacher_corrected
  FROM student_answers;

CREATE TABLE new_scan_records (
  id ${ID},
  result_id TEXT NOT NULL REFERENCES results (id) ON DELETE CASCADE,
  -- Path of the scan image in local storage, or NULL when no image was kept.
  image_path TEXT CHECK (image_path IS NULL OR length(image_path) > 0),
  ${timestamp('scanned_at')},
  UNIQUE (result_id)
) STRICT;

INSERT INTO new_scan_records
SELECT id, result_id, image_path, scanned_at FROM scan_records;

DROP TABLE student_answers;
DROP TABLE scan_records;
DROP TABLE exam_results;
DROP TABLE answer_keys;
DROP TABLE exam_questions;
DROP TABLE exams;

ALTER TABLE new_answer_keys RENAME TO answer_keys;
ALTER TABLE new_student_answers RENAME TO student_answers;
ALTER TABLE new_scan_records RENAME TO scan_records;

-- A name is unique within its subject, ignoring letter case; the same name may
-- be used under another subject. Also serves listing and filtering by subject.
CREATE UNIQUE INDEX idx_answer_keys_subject_id_name ON answer_keys (subject_id, name);
CREATE INDEX idx_answer_keys_created_at ON answer_keys (created_at);

-- One saved result per student per answer key. A separate index rather than a
-- table constraint so a later migration can drop it if retakes are allowed.
CREATE UNIQUE INDEX idx_results_answer_key_id_student_id ON results (answer_key_id, student_id);
CREATE INDEX idx_results_student_id ON results (student_id);
CREATE INDEX idx_results_created_at ON results (created_at);
`;
