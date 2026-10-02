/**
 * Migration 3: a Student ID identifies one student in the whole app.
 *
 * Migration 1 made `student_number` unique only within a class. The Students
 * feature treats it as unique across all classes, ignoring letter case, so
 * that a roster import can never create the same student twice and a scanned
 * sheet can later be matched to exactly one student.
 *
 * The repository checks this itself before writing (it also folds letters
 * outside ASCII, which NOCASE does not); this index is the final safeguard.
 *
 * No build before this migration could create students, so no installed
 * database has rows that would violate the index.
 */
export const STUDENT_NUMBER_UNIQUE_SQL = `
CREATE UNIQUE INDEX idx_students_student_number ON students (student_number COLLATE NOCASE);
`;
