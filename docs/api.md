# Application API

Last reviewed: 2026-10-02

This document describes the application's internal contracts: the boundaries between UI, application use cases, the sheet reader, the camera, and local storage. The application is offline-only, so every contract here is an in-process contract on the device. There are no network routes; see [api-routes.md](./api-routes.md).

> **Status.** Implemented: every contract in this document.

## API Philosophy

- "API" here does not mean HTTP. The app is offline-only, so all of its contracts are in-process TypeScript boundaries.
- The UI calls application use cases. Use cases call repositories and ports: the sheet reader, the scan image store, the printable-sheet sharer. The UI does not talk to SQLite, files, or the reader directly. The camera is a presentation component that hands a photo's location to a use case.
- Every operation completes against local resources only: the local SQLite database, local files, the camera, and the on-device reader. No contract may use the network.
- IDs are device-generated UUIDs.
- Operations return typed results or throw typed errors from the [Error Model](#error-model); they do not fail silently, and raw SQLite messages never reach the Teacher.
- There is one role, Teacher. No contract takes a role or permission argument.
- Contracts follow the clean architecture layers in [source-of-truth.md](./source-of-truth.md#clean-architecture-layers): use cases and repository contracts live in a feature's application layer, their SQLite implementations in its infrastructure layer.
- Use cases receive a `Clock` (`now()` returns a UTC ISO-8601 string) and an `IdGenerator` (`newId()`) by injection. The app supplies the system clock and `expo-crypto`'s `randomUUID`; tests supply fixed values.

## Application Use Cases

| Area | Operations | Status |
| --- | --- | --- |
| Subjects | `listSubjects()`, `addSubject(name)`, `renameSubject(id, name)`, `deleteSubject(id)` | Implemented and verified |
| Classes | `listClasses()`, `addClass(name)`, `renameClass(id, name)`, `deleteClass(id)` | Implemented and verified |
| Subject-to-Class assignments | `listSubjectsForClass(classId)`, `listClassesForSubject(subjectId)`, `isSubjectAssignedToClass(classId, subjectId)`, `assignSubjectToClass(classId, subjectId)`, `removeSubjectFromClass(classId, subjectId)`, `replaceSubjectsForClass(classId, subjectIds)`, `countSubjectsByClass()`, `countClassesBySubject()` | Implemented |
| Students | `listStudents({ classId, search })`, `getStudent(id)`, `addStudent(input)`, `updateStudent(id, input)`, `deleteStudent(id)`, `pickRoster()`, `prepareRoster(fileName, text)`, `importStudents(inputs)` | Implemented and verified |
| Answer Keys | `listAnswerKeys({ subjectId, search })`, `getAnswerKey(id)`, `createAnswerKey(input)`, `updateAnswerKey(id, input)`, `draftDuplicate(id)`, `duplicateAnswerKey(id, name?)`, `hasResults(id)`, `countResults(id)`, `deleteAnswerKey(id)` | Implemented and verified |
| Scan | `listOptions(selection)`, `classIdsOfSubject(subjectId)`, `validateSelection(selection)`, `previousAttempts(selection)`, `resumeSession({ subjectId, answerKeyId, classId })`, `readCapture(captureUri, selection)`, `discardCapture(captureUri)`, `discardDraft(draft)`, `saveResult(draft, review, { confirmDuplicate })`, `cleanUpScanFiles()`, `sharePrintableSheet(questionCount)`, `imageUri(path)` | Implemented and verified |
| Results | `listResults({ filter, search, after, limit })`, `countResults(filter, search)`, `listFilterLinks()`, `getResult(id)`, `deleteResult(id)`, `settleInterruptedDeletions()` | Implemented and verified |
| Dashboard (Home) | `getDashboard()` | Implemented and verified |
| Demo data (development builds) | `hasDemoData()`, `addDemoData()`, `removeDemoData()` | Implemented |

All delete operations are permanent deletions as defined in the [Permanent Deletion Contract](#permanent-deletion-contract).

## Database Contract

Implemented in `src/core/infrastructure/database/`.

### Bootstrap

- `DatabaseProvider` wraps the app in `src/app/_layout.tsx`. On native it opens `answer-checker.db` and finishes initialization before any screen renders. On web it is a pass-through and opens no database.
- Initialization sets `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`, confirms that foreign keys are on, then runs migrations. If foreign keys cannot be enabled, initialization fails with `DATABASE_ERROR`.
- `useDatabaseIfAvailable()` returns the connection, or null on web. The composition root builds use cases only when it is not null.

### Migrations

- `runMigrations(db, migrations)` reads `PRAGMA user_version`, applies each pending migration, and returns the resulting version.
  - Migration versions must be 1, 2, 3 and so on, in order; anything else throws before the database is touched.
  - Each migration and its version bump commit in one exclusive transaction. A failed migration rolls back completely and leaves the previous version in place.
  - A database whose version is higher than the app knows is refused rather than downgraded.
- `MIGRATIONS` in `migrations.ts` is the only place schema is defined, one file per migration under `migrations/`.
- Migrations are forward-only and must preserve existing local data. A migration that has run on a device is never edited.

| Version | File | Change | Device status |
| --- | --- | --- | --- |
| 1 | `0001-initial-schema.ts` | Creates `subjects`, `classes`, `students`, and the exam model: `exams`, `exam_questions`, a per-question `answer_keys`, `exam_results`, `student_answers`, `scan_records` | Verified on an Android 14 emulator and a physical phone |
| 2 | `0002-class-subjects.ts` | Adds `class_subjects` | Has run on a physical phone |
| 3 | `0003-student-number-unique.ts` | Adds a unique index on `students.student_number`, ignoring letter case: a Student ID is unique in the whole app, not only within a class | Has run on a physical phone |
| 4 | `0004-answer-keys.ts` | Replaces the exam model: creates `answer_keys` (per subject) and `answer_key_items`, renames `exam_results` to `results`, rebuilds `student_answers` and `scan_records`, and drops `exams`, `exam_questions`, and the old `answer_keys` | Has run on a physical phone, with no legacy rows to convert |
| 5 | `0005-question-count-unbounded.ts` | Rebuilds `answer_keys`, `answer_key_items`, and `student_answers` so that `question_count` and `question_number` only have to be 1 or more. Rows are copied unchanged | Has run on a physical phone |
| 6 | `0006-scan-results.ts` | Rebuilds `results` (adds `class_id`, `template_id`, `captured_at`; the index on answer key and student is no longer unique) and `student_answers` (`detected_state`, `detected_answer`, `final_answer`, `correct_answer`, `is_correct`, `manually_corrected`, `confidence`) | Has run on a physical phone, with no result rows to convert |
| 7 | `0007-result-snapshots.ts` | Rebuilds `results` to add `student_name`, `student_number`, `class_name`, `subject_name`, and `answer_key_name`, filled for existing rows from the records they point to. Adds `idx_results_captured_at`; `idx_results_created_at` is not recreated | Has run on a physical phone |

Migration 4 converts legacy data instead of discarding it:

- An exam becomes an Answer Key with the same ID, Subject, question count, and timestamps. Its class is dropped.
- The exam title becomes the name. Where two exams of one Subject had the same title, the class name is appended, as in "Midterm (BSIT 1A)".
- Each question with its correct letter becomes an item. Result rows keep their IDs and reference the Answer Key.
- It stops and rolls back, leaving version 3 and every row intact, when a legacy exam cannot be converted exactly: a question count outside 1 to 40, questions that are not exactly 1 to the count with an answer each, a question worth other than one point, or two names that are still equal after the class name is appended.

Migration 6 also converts rather than discards. An existing result gets the class its student is in, the template `UNKNOWN`, and its creation time as capture time. An existing answer gets the key's letter as `correct_answer`; the old states `SELECTED` and `UNCERTAIN` become `MARKED` and `UNCLEAR`. It rolls back when a saved answer has no letter in its answer key.

Migration 7 rolls back, leaving version 6 and every row intact, when a result's student, class, answer key, or subject cannot be found: a result must not get an incomplete history.

The Node tests cover a fresh install, the upgrade from every earlier version, each rollback case, `PRAGMA foreign_key_check`, `PRAGMA integrity_check`, and the query plans of the Results list and filters.

### Schema conventions

- Every table is `STRICT`.
- Primary keys are `TEXT` UUIDs named `id`, except `class_subjects`, whose primary key is `(class_id, subject_id)`, and `answer_key_items`, whose primary key is `(answer_key_id, question_number)`.
- Timestamps are `TEXT`, checked against the UTC ISO-8601 form `YYYY-MM-DDTHH:MM:SS.sssZ`.
- Booleans are `INTEGER` 0 or 1.
- Subject, class, and answer key names are `COLLATE NOCASE`.
- Answer letters are restricted to `A`, `B`, `C`, `D`. `question_count` and `question_number` are 1 or more; the database sets no upper limit.
- `results`: `score` is from 0 to `total`, and `total` is 1 or more. The five snapshot names are required and not empty.
- `student_answers`: one row per result and question. `detected_state` is `MARKED`, `BLANK`, `MULTIPLE`, or `UNCLEAR`; `detected_answer` is set exactly when the state is `MARKED`; `is_correct` is 1 exactly when `final_answer` is set and equals `correct_answer`; `confidence` is null or from 0 to 1.
- No table has a soft-delete, archive, tombstone, or synchronization column.

### Indexes

| Index | Table and columns |
| --- | --- |
| `idx_students_class_id_full_name` | `students (class_id, full_name)` |
| `idx_students_student_number` (unique) | `students (student_number COLLATE NOCASE)` |
| `idx_class_subjects_subject_id` | `class_subjects (subject_id)` |
| `idx_answer_keys_subject_id_name` (unique) | `answer_keys (subject_id, name)` |
| `idx_answer_keys_created_at` | `answer_keys (created_at)` |
| `idx_results_answer_key_id_student_id` (not unique since migration 6) | `results (answer_key_id, student_id)` |
| `idx_results_student_id` | `results (student_id)` |
| `idx_results_class_id` | `results (class_id)` |
| `idx_results_captured_at` | `results (captured_at, created_at, id)`: the order of the Results list |

`students` also keeps the table constraint `UNIQUE (class_id, student_number)` from migration 1; the app-wide index makes it redundant.

### Foreign keys and delete rules

| Child column | Parent | On delete |
| --- | --- | --- |
| `students.class_id` | `classes.id` | RESTRICT |
| `answer_keys.subject_id` | `subjects.id` | RESTRICT |
| `results.answer_key_id` | `answer_keys.id` | RESTRICT |
| `results.student_id` | `students.id` | RESTRICT |
| `results.class_id` | `classes.id` | RESTRICT |
| `answer_key_items.answer_key_id` | `answer_keys.id` | CASCADE |
| `student_answers.result_id` | `results.id` | CASCADE |
| `scan_records.result_id` | `results.id` | CASCADE |
| `class_subjects.class_id` | `classes.id` | CASCADE |
| `class_subjects.subject_id` | `subjects.id` | CASCADE |

### Transactions

- `runInTransaction(db, task)` runs a task in one `BEGIN IMMEDIATE` transaction on the initialized connection: everything commits together or nothing does. Calls on the same connection run one after another.
- Data writes must use it. `expo-sqlite`'s `withExclusiveTransactionAsync` opens a second connection on which foreign keys are off, so `RESTRICT` and `CASCADE` would not apply there. Only the migration runner uses that method.
- If the task throws, the transaction rolls back and the task's error is rethrown.

## Repository Rules

Implemented for Subjects, Classes, assignments, Students, Answer Keys, and Results; binding for every later repository.

- Repositories are the only code that issues SQL. They use raw `expo-sqlite` through a small `SqlConnection` type, so the same code runs against Node's SQLite in tests. Drizzle ORM is undecided and not installed.
- Values are passed as parameters. Nothing supplied by the Teacher is placed in SQL text.
- Multi-step writes and deletion checks run inside `runInTransaction`.
- A list is read with a fixed number of statements, however many records it returns. A batch is checked and inserted with a few statements, not one per record.
- Only typed errors leave a repository: application errors pass through, and any other failure is wrapped as `DATABASE_ERROR` with the original kept as its cause.
- No repository touches the network.

## Subjects and Classes Contract

Implemented and verified on a physical Android phone. The two features have the same shape.

A record is `{ id, name, createdAt, updatedAt }`.

| Operation | Behavior | Errors |
| --- | --- | --- |
| `listSubjects()` / `listClasses()` | All records, alphabetical ignoring letter case, in a stable order | `DATABASE_ERROR` |
| `addSubject(name)` / `addClass(name)` | Trims the name, validates it, generates the ID and both timestamps, stores and returns the record | `VALIDATION_ERROR`, `DUPLICATE_NAME`, `DATABASE_ERROR` |
| `renameSubject(id, name)` / `renameClass(id, name)` | Trims and validates. Keeps `createdAt`, sets `updatedAt`. Renaming to the current name changes nothing. Changing only letter case is allowed | `VALIDATION_ERROR`, `NOT_FOUND`, `DUPLICATE_NAME`, `DATABASE_ERROR` |
| `deleteSubject(id)` / `deleteClass(id)` | Physically deletes the record if nothing independent depends on it | `NOT_FOUND`, `IN_USE`, `DATABASE_ERROR` |

Name rules:

- Surrounding whitespace is removed.
- An empty or whitespace-only name is rejected.
- The maximum is 60 characters, counted as characters rather than UTF-16 units.
- Names are unique ignoring letter case. The repository compares names itself inside the write transaction, because SQLite's `NOCASE` folds only ASCII letters; the `UNIQUE` constraint remains the final safeguard.

Deletion restrictions:

- A Subject with Answer Keys is not deleted. The error carries `answerKeyCount`.
- A Class with Students, or with Results scanned under it, is not deleted. The error carries `studentCount` and `resultCount`. An Answer Key does not belong to a Class and never blocks one.
- The check and the delete run in the same transaction. Nothing is deleted automatically except the record's own `class_subjects` rows.

Repository operations behind these use cases: `list`, `getById`, `create`, `rename`, `delete`.

## Subject-to-Class Assignment Contract

Implemented.

| Operation | Behavior |
| --- | --- |
| `listSubjectsForClass(classId)` | Subjects assigned to the class, alphabetical ignoring letter case |
| `listClassesForSubject(subjectId)` | Classes assigned to the subject, alphabetical ignoring letter case. The Scan flow calls this after the Teacher picks a Subject |
| `isSubjectAssignedToClass(classId, subjectId)` | True or false |
| `assignSubjectToClass(classId, subjectId)` | Adds the assignment. If it already exists nothing changes and the first timestamp is kept |
| `removeSubjectFromClass(classId, subjectId)` | Physically deletes the assignment row. If it does not exist nothing changes |
| `replaceSubjectsForClass(classId, subjectIds)` | Makes the given set the complete selection for the class in one transaction. Assignments that stay keep their timestamp. If any step fails, nothing changes |
| `countSubjectsByClass()` / `countClassesBySubject()` | Counts by ID, for the row summaries. Records with no assignment are absent |

- An unknown class throws `ClassNotFoundError`, an unknown subject `SubjectNotFoundError`; both carry the code `NOT_FOUND`.
- A duplicate assignment is impossible: `(class_id, subject_id)` is the primary key.
- Removing assignments never deletes a Subject, Class, Student, or Answer Key.
- The only editing workflow is Classes → Manage subjects, which calls `replaceSubjectsForClass`.

## Student Contract

Implemented and verified on a physical Android phone.

A Student is `{ id, studentNumber, fullName, classId, createdAt, updatedAt }`. `studentNumber` is the "Student ID" the Teacher sees. Lists return it with `className`.

| Operation | Behavior | Errors |
| --- | --- | --- |
| `listStudents({ classId, search })` | Students of one Class or of all, ordered by Class name, full name, Student ID, then ID. `search` matches the Student ID or the full name, ignoring letter case | `DATABASE_ERROR` |
| `getStudent(id)` | One Student with its Class name, or null | `DATABASE_ERROR` |
| `addStudent(input)` | Trims and validates, generates the ID and timestamps, stores and returns the Student | `VALIDATION_ERROR`, `NOT_FOUND` (class), `DUPLICATE_STUDENT_ID`, `DATABASE_ERROR` |
| `updateStudent(id, input)` | Changes the Student ID, the full name, the Class, or any of them. Keeps `createdAt`. Saving without a change does nothing | `VALIDATION_ERROR`, `NOT_FOUND`, `DUPLICATE_STUDENT_ID`, `DATABASE_ERROR` |
| `deleteStudent(id)` | Physically deletes the Student when no Result belongs to it | `NOT_FOUND`, `IN_USE` (with `resultCount`), `DATABASE_ERROR` |

Rules:

- Student ID: trimmed, required, at most 32 characters, unique across all Students ignoring letter case. The repository compares IDs itself inside the write transaction; the unique index is the final safeguard.
- Full name: trimmed, required, at most 100 characters, counted as characters.
- Class: required and must exist. A missing Class is `ClassNotFoundError`.
- A Student has no Subject and no grade, course, strand, or section field.

### Roster import

| Operation | Behavior |
| --- | --- |
| `pickRoster()` | Opens the device file picker, reads the chosen file, releases it, and returns a checked draft, or null when the picker was closed. Stores nothing |
| `prepareRoster(fileName, text)` | Reads CSV text and checks it against the stored Students and Classes. Returns the draft. Stores nothing |
| `resolveRoster(draft, selection)` | Pure function: which rows would be imported with the Teacher's choice of Class or of Class per group |
| `importStudents(inputs)` | Validates every row again and stores them in one transaction: all, or none. Returns the number added |

CSV rules:

- UTF-8, with or without a byte-order mark. LF, CRLF, or CR line endings.
- Header names are trimmed and compared ignoring letter case. Columns may be in any order; other columns are ignored.
- `student_id,full_name` is a single-Class roster. Adding `grade_and_section` and `course` makes it a multi-Class roster; having only one of the two is an error.
- Quoted values, commas and line breaks inside quotes, and `""` for a quote are supported. Completely blank rows are ignored.
- Every reported row carries its line number in the file, counting the header as 1.

A draft separates:

| List | Meaning |
| --- | --- |
| `rows` | Valid and importable once a Class is chosen |
| `invalid` | Missing or too-long Student ID or name, no class values, or more values than columns |
| `duplicates` | Student ID already used by an earlier row of the file. The first row is kept |
| `existing` | Student ID already stored. The stored Student is not changed |
| `groups` | Each distinct `grade_and_section` plus `course`, with a suggested Class when exactly one Class matches exactly |

A file that cannot be used at all throws `ROSTER_FILE_ERROR` with a reason: empty, malformed (with the line), missing headers (named), a repeated header, too large (over 1 MB), or unreadable.

### Roster file port

`RosterFilePicker` is the application port; `createRosterFilePicker(fileSystem)` implements it over five file operations, and `expoRosterFileSystem` supplies them with `expo-document-picker` and `expo-file-system`.

- The picker copies the chosen file into the app's cache folder `DocumentPicker`. The app reads that copy.
- `release()` deletes the copy and is called in a `finally`, so it runs after success, a parsing error, a read error, an oversized file, and a database error alike.
- Only a path inside that cache folder is ever deleted. Any other URI is read and left alone.
- `cleanUpStale()` empties the folder before each pick, removing copies left by an interrupted session.
- Nothing of the file reaches SQLite: not its contents, its name, or its path.

## Answer Key Contract

Implemented and verified on a physical Android phone.

An Answer Key is `{ id, subjectId, name, questionCount, answers, createdAt, updatedAt }`. `answers` holds one `AnswerChoice` (`'A' | 'B' | 'C' | 'D'`) per question in order: index 0 is question 1. Lists return it with `subjectName` and `resultCount`.

| Operation | Behavior | Errors |
| --- | --- | --- |
| `listAnswerKeys({ subjectId, search })` | Complete keys of one Subject or of all, ordered by Subject name, key name, then ID. `search` matches the name. With `subjectId`, this is what the Scan flow calls | `DATABASE_ERROR` |
| `getAnswerKey(id)` | One complete key with its answers in question order, or null | `DATABASE_ERROR` |
| `createAnswerKey(input)` | Validates, generates the ID and timestamps, stores header and items together | `VALIDATION_ERROR`, `NOT_FOUND` (subject), `DUPLICATE_NAME`, `DATABASE_ERROR` |
| `updateAnswerKey(id, input)` | Replaces the whole key. Keeps `createdAt`. Saving without a change does nothing | `VALIDATION_ERROR`, `NOT_FOUND`, `DUPLICATE_NAME`, `ANSWER_KEY_LOCKED`, `DATABASE_ERROR` |
| `draftDuplicate(id)` | Returns a copy as unsaved input with a free name. Stores nothing | `NOT_FOUND` |
| `duplicateAnswerKey(id, name?)` | Stores a copy under a new ID. Copies no Results | `NOT_FOUND`, `VALIDATION_ERROR`, `DUPLICATE_NAME` |
| `countResults(id)`, `hasResults(id)` | How many saved Results were scored with the key | `DATABASE_ERROR` |
| `deleteAnswerKey(id)` | Physically deletes the key and its items when no Result uses it | `NOT_FOUND`, `IN_USE` (with `resultCount`), `DATABASE_ERROR` |

Rules:

- Name: trimmed, required, at most 60 characters, unique within its Subject ignoring letter case. The same name is allowed under another Subject. A rename that changes only letter case is allowed.
- Subject: required and must exist. A missing Subject is `SubjectNotFoundError`.
- Question count: an integer of 1 or more. The use case refuses more than 200 (`ANSWER_KEY_MAX_QUESTIONS`), a guard against a mistyped number that can be raised without a migration. The database has no upper limit.
- Answers: exactly one of A, B, C, D for every question from 1 to the count. A missing answer, another letter, or the wrong number of answers is `VALIDATION_ERROR`, and the error names the questions.
- A key is written whole in one transaction. If writing the items fails, the header is rolled back.
- A key is read whole. Listing uses two statements however many keys there are. A stored key with a gap is refused with `DATABASE_ERROR` rather than completed with a guess.
- An Answer Key has no Class.

Historical integrity:

- When `resultCount` is above zero, a change of Subject, question count, or any answer throws `AnswerKeyLockedError` (`ANSWER_KEY_LOCKED`) with the count. Nothing is changed, including a name sent with the blocked change.
- The name alone can still be changed.
- The check runs inside the write transaction. Results are never rescored.
- The supported way to revise a used key is to duplicate it.

## Scan Selection Contract

Implemented and verified on a physical Android phone.

A selection is `{ subjectId, answerKeyId, classId, studentId }`, each an ID or null. It is changed only through four pure functions:

| Function | Effect |
| --- | --- |
| `selectSubject(selection, subjectId, classIdsOfSubject)` | Sets the Subject and clears the Answer Key. Keeps the Class and Student only when the Class also takes the new Subject. Choosing the same Subject changes nothing |
| `selectAnswerKey(selection, answerKeyId)` | Sets the Answer Key |
| `selectClass(selection, classId)` | Sets the Class and clears the Student, unless it is the same Class |
| `selectStudent(selection, studentId)` | Sets or clears the Student |

| Operation | Behavior |
| --- | --- |
| `listOptions(selection)` | All Subjects; the Answer Keys of the chosen Subject, each with `questionCount` and `fitsSheet`; the Classes assigned to the chosen Subject; the Students of the chosen Class, each with `scanCount`, the number of Results the Student has with the chosen Answer Key; and `maxSheetQuestions` |
| `classIdsOfSubject(subjectId)` | The IDs of the Classes a Subject is taught to, for `selectSubject` |
| `validateSelection(selection)` | Checks the four choices against the database and returns the records they name. Throws `ScanSelectionError` |
| `previousAttempts(selection)` | Earlier Results of the chosen Student with the chosen Answer Key, newest first |
| `resumeSession({ subjectId, answerKeyId, classId })` | The selection to continue an earlier session with, and no Student. Returned only when the Subject exists, the Answer Key belongs to it and fits one sheet, and the Class is still assigned to the Subject; otherwise the empty selection. Never throws |

`ScanSelectionError` (`VALIDATION_ERROR`) carries one `problem`: `INCOMPLETE`, `SUBJECT_MISSING`, `ANSWER_KEY_MISSING`, `ANSWER_KEY_NOT_OF_SUBJECT`, `ANSWER_KEY_TOO_LONG` (more than 100 questions), `CLASS_MISSING`, `CLASS_NOT_ASSIGNED`, `STUDENT_MISSING`, or `STUDENT_NOT_IN_CLASS`.

Each list is searched in the picker by name and second line (question count, Student ID) on the device; no further query is made.

## Answer Sheet Contract

Implemented and verified on a physical Android phone. Pure domain code in `features/scan/domain`.

| Function | Behavior |
| --- | --- |
| `sheetTemplate(questionCount)` | The geometry of the sheet for exactly that many questions, in millimetres on A4: four corner markers, the orientation square, the identity cells and their pattern, the bubble radius, and the column layout. Throws `RangeError` outside 1 to `MAX_SHEET_QUESTIONS` (100) |
| `fitsOneSheet(questionCount)` | Whether a sheet exists for that count |
| `bubbleCenter(template, questionNumber, choice)` | The centre of one bubble. Throws for a question the sheet does not have |
| `identityPattern(questionCount)` / `decodeIdentity(cells)` | The row of ten cells that spells the count: a start cell, seven bits, a parity cell, an end cell. Decoding returns the count, or null for a row that is not valid |
| `buildAnswerSheetPdf(template)` | The bytes of a one-page PDF drawn from the template: questions 1 to the count and nothing more. No PDF library |

- Template ID: `AC-<question count>-V2`. It is printed on the sheet and stored in `results.template_id`.
- Layout by length: 1 to 40 questions in up to two columns of 20; 41 to 75 in up to three columns of 25; 76 to 100 in four columns of 25. Only the columns that are needed are printed.
- The markers, the orientation square, and the identity row are in the same place on every sheet, so the reader can read the count before it knows the layout.
- `sharePrintableSheet(questionCount)` builds the PDF and passes its bytes and a file name such as "Answer sheet - 10 questions.pdf" to the `PrintableSheet` port, which writes one file in the app's cache and opens the system share sheet. It throws `SheetShareError` (`FILE_ERROR`) with the reason `TOO_LONG`, `UNAVAILABLE`, or `FAILED`.

## OMR Contract

Implemented and verified on a physical Android phone. Port: `SheetReader`; implementation: `features/scan/infrastructure/omr`, the project's own TypeScript.

**Input:**

- A grayscale picture of the photographed sheet: width, height, and one byte per pixel.
- The template of the sheet that is expected: `sheetTemplate(answerKey.questionCount)`.

**Processing:** find dark squares, pick the four corner markers, try the four quarter turns until the orientation square fits and the identity row decodes, compare the sheet's question count with the expected one, flatten the sheet to 4 pixels per millimetre, check light and focus, measure the fill of each bubble at its template position, classify each question. All on-device and deterministic: the same picture and template give the same output.

**Output when the sheet is read:**

```json
{
  "ok": true,
  "templateId": "AC-10-V2",
  "detections": [
    { "questionNumber": 1, "state": "marked", "answer": "B", "fills": [0.03, 0.94, 0.02, 0.04], "confidence": 0.97 },
    { "questionNumber": 2, "state": "blank", "answer": null, "fills": [0.02, 0.03, 0.02, 0.01], "confidence": 0.95 }
  ],
  "rectified": "the flattened sheet as a grayscale picture"
}
```

The numbers are illustrative. In code the states are lower case; in the database they are stored upper case.

**Output when the photo is refused:** `{ "ok": false, "problem": ... }` with no detections and no picture.

| Problem | Meaning |
| --- | --- |
| `IMAGE_TOO_SMALL` | Too few pixels to measure bubbles |
| `MARKERS_NOT_FOUND` | The four corner markers were not all found: cropped, covered, or not a sheet |
| `SHEET_TOO_SMALL` | The sheet is a small part of the picture |
| `PERSPECTIVE_UNRELIABLE` | Too steep an angle to flatten reliably |
| `UNSUPPORTED_TEMPLATE` | The markers are there, but the orientation square or identity row is not: not a sheet the app can read |
| `WRONG_SHEET` | A sheet printed for another question count. The outcome carries that count |
| `TOO_BLURRY` | Out of focus or moved |
| `BAD_LIGHTING` | Too dark, or too little difference between paper and print |

**States:**

| State | Meaning | Before a Result can be saved |
| --- | --- | --- |
| `MARKED` | Exactly one bubble is clearly filled | Accepted; the Teacher may change it |
| `BLANK` | No bubble is filled | The Teacher confirms Blank or chooses a letter |
| `MULTIPLE` | More than one bubble is filled | The Teacher chooses a letter or Blank |
| `UNCLEAR` | A mark is too faint, or does not clearly lead the others | The Teacher chooses a letter or Blank |

**Rules:**

- The reader never guesses. Ambiguity becomes `UNCLEAR`, not a best-effort `MARKED`.
- A refused photo returns no partial answers.
- The number of detections equals the template's question count, and the use case rejects a reading whose template or count is not the expected one.
- Only A–D bubbles and the sheet's own markers are read. Handwritten names and subjects are not recognized.
- An identity read from a future QR code or bubbled Student ID is a suggestion that the Teacher confirms; it is never saved unconfirmed.
- Thresholds are configuration, not scattered constants: image thresholds in `OMR_SETTINGS` (`read-sheet.ts`), classification thresholds in `DETECTION_THRESHOLDS` (`detection.ts`). They are initial values and must be calibrated against real sheets, pencils and pens, lighting, cameras, and erasures before being called final.
- Sharpness is measured around the four corner markers, which are the same on every sheet, so a sheet with few questions is not mistaken for a blurred one.
- The reader does not score. It reports marks; scoring is a separate contract.
- No AI/LLM inference and no remote call.

## Camera and Scan Image Contract

Implemented and verified on a physical Android phone.

- The camera (`expo-camera`) is a presentation component. Permission is requested when the Teacher opens it; a denial is explained there with a way to the system settings. Audio is not requested.
- A capture is a file in the app's cache. The UI passes its location to `readCapture`; image data is never sent anywhere.
- `readCapture(captureUri, selection)` validates the selection, loads the photo resized to a working width as grayscale, reads it, and returns a draft: the validated records, the template, the capture time, the location of a preview image (the flattened sheet), and one review item per question. The capture is deleted whatever happens. A refused photo throws `CaptureRejectedError` (`CAPTURE_REJECTED`) with the problem and, for `WRONG_SHEET`, both question counts.
- `discardCapture` and `discardDraft` delete a capture or a draft's preview on Retake or Cancel.

`ScanImageStore` is the port. Three kinds of file, all app-private:

| File | Where | Lifetime |
| --- | --- | --- |
| Capture | App cache, as the camera wrote it | Deleted as soon as the sheet is read or refused |
| Preview | App cache, `scan-previews` | During the review; deleted on Retake or Cancel |
| Final image | App documents, `scans/<result id>.png` | From the save until the Result is deleted |

- Only a path inside those folders is ever deleted. A file anywhere else, such as a gallery photo, is left alone.
- Nothing is written to the device gallery. An image is never a database value; `scan_records.image_path` holds the relative path.
- `cleanUpScanFiles()` runs at the start of a scan session and removes captures and previews left by an interrupted session and final images no Result refers to. Its failure never blocks scanning.
- A file failure is `ScanImageError` (`FILE_ERROR`); nothing is saved.

## Result Scoring and Saving Contract

Implemented and verified on a physical Android phone.

Review, pure functions in `detection.ts`:

- `startReview(detections)` gives one item per question. A `marked` question starts resolved with the letter read; the others wait for the Teacher.
- `setReviewAnswer(item, answer)` records the Teacher's decision: a letter, or null for Blank. It is a manual correction when it differs from what was read; confirming a blank as blank is not.
- `unresolvedCount(review)` is the number of questions still waiting.

Scoring, pure functions in `scoring.ts`:

- `scoreReview(review, correctAnswers)` returns the score, the total, and one scored answer per question, or a problem: `UNRESOLVED` while a question waits, `MISMATCH` when the review does not cover exactly the questions of the key.
- One point per question whose final answer equals the key's letter. A blank scores as incorrect.
- `previewScore` shows the score during the review, counting unresolved questions as incorrect.

`saveResult(draft, review, { confirmDuplicate })`, in order:

1. Validates the selection again against the database (`ScanSelectionError`).
2. Compares the Answer Key with the one the sheet was read against. Any change of question count or answers throws `AnswerKeyChangedError` (`ANSWER_KEY_CHANGED`).
3. Refuses while a question is unresolved: `IncompleteReviewError` (`VALIDATION_ERROR`, with the count).
4. Scores.
5. If the Student already has Results with this key and `confirmDuplicate` is not true, throws `DuplicateAttemptError` (`DUPLICATE_ATTEMPT`, with the earlier attempts). A confirmed second attempt is a separate Result with its own ID and image; the earlier one is never changed.
6. Moves the preview to its final place.
7. Writes the result, every answer, and the scan record in one transaction. If it fails, the moved image is deleted again and the error is rethrown.

A stored Result holds: the Answer Key, the Student, the Class of the scan, the names of all of them and of the Subject as they were at the save, score and total, the template ID, when the photo was taken, when it was saved; and per question what was read, what was scored, the correct answer at that time, whether it was correct, whether the Teacher corrected it, and the reader's confidence.

`ResultRepository`: `save(result)`, `listAttempts(answerKeyId, studentId)`, `countAttemptsByStudent(answerKeyId)`, `listImagePaths()`.

Results are never rescored. Per-question points are one; weighted questions are not supported.

## Results Contract

Implemented and verified on a physical Android phone. Feature `features/results`. It reads and deletes what Scan saved; it has no operation that changes a Result.

A summary is `{ id, score, total, capturedAt, createdAt, studentName, studentNumber, className, subjectName, answerKeyName, attempt: { number, count } }`. The names are the ones stored with the Result. A detail adds `answerKeyId`, `studentId`, `classId`, `templateId`, `imagePath`, and `answers`: per question `{ questionNumber, detectedState, detectedAnswer, finalAnswer, correctAnswer, isCorrect, manuallyCorrected, confidence }`.

| Operation | Behavior | Errors |
| --- | --- | --- |
| `listResults({ filter, search, after, limit })` | One page (30 by default), newest first: capture time, then save time, then ID, all descending. Returns `{ items, next }`; `next` is the cursor of the following page, or null. One statement however many Results exist | `DATABASE_ERROR` |
| `countResults(filter, search)` | `{ matching, total }`: Results within the filters and the search, and Results saved at all | `DATABASE_ERROR` |
| `listFilterLinks()` | Every combination of Subject, Answer Key, Class of the scan, and Student that has a Result, with current names | `DATABASE_ERROR` |
| `getResult(id)` | `{ result, imageUri }`, or null. `imageUri` is null when the stored image is missing, unreadable, or not a scan image; the Result is complete without it. Two statements | `DATABASE_ERROR` |
| `deleteResult(id)` | Permanently deletes the Result, its answers, its scan record, and its image | `NOT_FOUND`, `FILE_ERROR`, `DATABASE_ERROR` |
| `settleInterruptedDeletions()` | Finishes or undoes deletions that were interrupted. Never throws | None |

Rules:

- A filter is `{ subjectId, answerKeyId, classId, studentId }`, each an ID or null. The Subject is matched through the Answer Key, the Class is the Class of the scan.
- `filterChoices(links, filter)` gives what each filter offers: every Subject, the Answer Keys of the chosen Subject, the Classes scanned with the chosen Subject and Answer Key, and the Students scanned in the chosen Class. `setFilter` sets one and clears those below it that no longer fit; `withoutIncompatible` does the same after a deletion.
- Search is trimmed and matches any of the five stored names, ignoring letter case. What is typed is always literal text, passed as a parameter.
- The attempt number is the Result's place, by capture time, among the Results of the same Student with the same Answer Key. It is counted over all Results, so it does not change with the filters or the search.
- `tallyAnswers` counts correct, incorrect, blank, and manually corrected answers; correct, incorrect, and blank add up to the total. `percentage(score, total)` is a whole number.
- Only the stored path `scans/<name>.png` is accepted as a scan image. No image bytes are ever read into the database or by the list.

Ports: `ResultsRepository` (`list`, `count`, `listLinks`, `getById`, `delete`, `listImagePaths`) and `ResultImageStore` (`displayUri`, `stage`, `restore`, `discard`, `settleStaged`).

## Dashboard Contract

Implemented and verified on a physical Android phone. Feature `features/dashboard`: a read model for Home alone. It writes nothing.

`getDashboard()` returns:

```text
{
  counts:           { students, classes, answerKeys, results, scannedToday } | null
  recentResults:    [{ id, studentName, studentNumber, answerKeyName, score, total, capturedAt, attempt: { number, count } }] | null
  recentAnswerKeys: [{ id, name, subjectName, questionCount, updatedAt }] | null
  lastScan:         { subjectId, subjectName, answerKeyId, answerKeyName, classId, className } | null
  isIncomplete:     boolean
}
```

- It never throws. A part that could not be read is null and `isIncomplete` is true; `lastScan` is also null when no Result exists.
- `DashboardRepository` has one method per part: `counts(today)`, `recentResults(limit)`, `recentAnswerKeys(limit)`, `lastScan()`. Each is one statement, so a reading is four statements however much is stored. Each can fail with `DATABASE_ERROR`.
- Counts are aggregates computed by SQLite. No list is loaded to be counted or cut down. Answers and images are never read.
- `scannedToday` counts Results with `captured_at` from the start of the phone's local calendar day (included) to the start of the next (not included). `localDayRange(now)` gives those two local midnights as UTC ISO-8601 strings; stored timestamps stay UTC.
- Recent Results: at most 3, by capture time, then save time, then ID, all descending, with the names stored with each Result.
- Recent Answer Keys: at most 3, by `updated_at`, then `created_at`, then ID, all descending, with the Subject's current name.
- `lastScan` is taken from the newest Result: its Answer Key, that key's Subject, and the Class of the scan, named as they are called now.
- No migration or index was added. The newest Results and the count for today are read through `idx_results_captured_at`.

### Opening a screen with something to do

Home tells another screen what to open through a one-time, in-memory intent (`core/presentation/navigation/screen-intent.ts`): `requestIntent(route, intent)` before navigating, `takeIntent(route)` when the target is shown and its data is loaded. An intent is taken once; nothing is stored.

| Route | Intent | Effect |
| --- | --- | --- |
| `/keys` | `{ type: 'create' }` | Opens the Answer Key form, when a Subject exists |
| `/keys` | `{ type: 'view', answerKeyId }` | Opens that Answer Key |
| `/students` | `{ type: 'add' }` | Opens the Student form, when a Class exists |
| `/results` | `{ type: 'open', resultId }` | Opens that Result |
| `/scan` | `{ type: 'continue', subjectId, answerKeyId, classId }` | Passed to `resumeSession` |

Route parameters are not used for this: screens stay mounted in the tab shell, so a parameter would act again on every later visit.

## Demo Data Contract

Implemented. A development aid in `features/demo-data`; the Settings screen shows it only in development builds.

| Operation | Behavior |
| --- | --- |
| `hasDemoData()` | Whether any demo record is stored |
| `addDemoData()` | Stores a fixed set in one transaction: 2 Subjects, 2 Classes, 3 assignments, 8 Students, 3 Answer Keys, and 16 Results with their answers and scan records. Returns false and adds nothing when demo data is already stored. Throws `DemoDataConflictError` (`DUPLICATE_NAME`), adding nothing, when a demo name or Student ID is already taken |
| `removeDemoData()` | Physically deletes, in one transaction, every demo record and everything saved under one: Results of a demo Student, Answer Key, or Class, Students of a demo Class, and Answer Keys of a demo Subject. Returns the counts |

- Demo IDs share a fixed prefix; names start with "Demo" and Student IDs with "DEMO-".
- Demo Results have no image file, so they show "Stored scan image is unavailable".
- Records not connected to demo data are never changed or deleted.

## Permanent Deletion Contract

Permanent physical deletion removes rows from the local SQLite database. It never sets a flag, never archives, and leaves no tombstone, soft-deleted record, or synchronization instruction.

### Implemented

| Deleting | Behavior |
| --- | --- |
| Subject | Blocked with `IN_USE` while Answer Keys belong to it. Otherwise the row and its `class_subjects` rows are removed |
| Class | Blocked with `IN_USE` while it has Students or Results scanned under it. Otherwise the row and its `class_subjects` rows are removed |
| Assignment | The `class_subjects` row is removed. Nothing else is affected |
| Student | Blocked with `IN_USE` while saved Results belong to it. Otherwise the row is removed. Results are never removed from here |
| Answer Key | Blocked with `IN_USE` while saved Results were scored with it. Otherwise the row and its `answer_key_items` rows are removed |

- The dependency check and the delete are one transaction.
- The record disappears from the list only after commit.
- The earlier open decision "block or cascade" is settled for every record above: **block**.
- Every deletion is confirmed in a dialog that names the record, says it is permanent, and offers Cancel first. For a Student it shows the name and Student ID; for an Answer Key, the name, Subject, and question count; for a Result, the Student, Student ID, Answer Key, capture date, score, and attempt.

### `deleteResult(id)`

Implemented and verified on a physical Android phone.

1. Read the Result with its image path from `scan_records.image_path`. If it does not exist, throw `ResultNotFoundError` (`NOT_FOUND`); the screen treats that as already deleted.
2. If the path is a scan image and the file exists, move it to the app's private staging folder `scans-deleting/`. If the move fails, throw `ResultImageError` (`FILE_ERROR`); nothing has changed.
3. In one transaction delete the `student_answers` rows, the `scan_records` row, and the `results` row, each by name.
4. If the transaction fails, move the image back and rethrow; the Result is exactly as it was.
5. Delete the staged image. A failure here is not an error: the Result stays deleted.

- Deletions requested through one set of use cases run one after another, so a double tap cannot move the same image twice.
- A Result is never restored after its transaction has committed.
- `settleInterruptedDeletions()` runs when Results is opened. A staged file whose Result still exists (the app stopped between steps 2 and 3, or step 4 could not move it back) is returned to the scans folder; every other staged file is deleted.
- A path that is not exactly `scans/<name>.png` is never moved or deleted. Such a Result, and a Result whose image is already missing, is deleted from the database all the same.
- Nothing outside the app's `scans/` and `scans-deleting/` folders is touched.

A Student, an Answer Key, or a Class with Results stays blocked. The Teacher deletes the Results first; no use case removes them on a parent's behalf. The blocking counts are read inside each deletion, so the record is released as soon as its last Result is gone.

**Error handling**

- A failure inside the transaction rolls everything back and is raised as `DATABASE_ERROR`. The record remains fully intact, with its image.

**No recovery**

- There is no backup and no remote copy. A committed deletion cannot be undone.

## Error Model

| Code | Meaning | Status |
| --- | --- | --- |
| `VALIDATION_ERROR` | Input is missing or invalid. `InvalidNameError`, `InvalidStudentError`, and `InvalidAnswerKeyError` carry the list of problems, each with its field. `ScanSelectionError` carries which choice does not hold; `IncompleteReviewError` how many questions still wait | Implemented |
| `DUPLICATE_NAME` | Another Subject or Class, or another Answer Key of the same Subject, has this name, ignoring letter case. Also `DemoDataConflictError`: a demo name or Student ID is already taken | Implemented |
| `DUPLICATE_STUDENT_ID` | Another Student has this Student ID, ignoring letter case | Implemented |
| `NOT_FOUND` | The requested record does not exist (`RecordNotFoundError`, `ClassNotFoundError`, `SubjectNotFoundError`, `ResultNotFoundError`) | Implemented |
| `IN_USE` | Deletion is blocked because other records depend on this one (`SubjectInUseError`, `ClassInUseError`, `StudentInUseError`, `AnswerKeyInUseError`, each with a count; a Class carries its Student and Result counts) | Implemented |
| `ANSWER_KEY_LOCKED` | The Answer Key has saved Results, so its Subject, question count, and answers cannot change (`AnswerKeyLockedError`, with the count) | Implemented |
| `ROSTER_FILE_ERROR` | The picked file cannot be used as a roster (`RosterFileError`, with the reason) | Implemented |
| `DATABASE_ERROR` | A SQLite operation failed (`DatabaseError`, `MigrationFailedError`, `UnsupportedSchemaVersionError`). The original failure is kept as the cause and is not shown to the Teacher | Implemented |
| `CAPTURE_REJECTED` | The photo cannot be read (`CaptureRejectedError`, with the problem and, for a sheet of another question count, both counts). No answers and no score were produced | Implemented |
| `ANSWER_KEY_CHANGED` | The Answer Key was edited after the sheet was read (`AnswerKeyChangedError`). Nothing was saved; the sheet is scanned again | Implemented |
| `DUPLICATE_ATTEMPT` | The Student already has a Result with this Answer Key and a second attempt was not confirmed (`DuplicateAttemptError`, with the earlier attempts) | Implemented |
| `FILE_ERROR` | A scan image could not be read, written, or moved (`ScanImageError`), the answer sheet could not be shared (`SheetShareError`, with the reason), or a Result's image could not be set aside for deletion (`ResultImageError`) | Implemented |

The codes `CAMERA_ERROR`, `OMR_FAILED`, `OMR_UNCERTAIN`, and `PERMISSION_ERROR` that earlier versions of this document planned were not built. A refused photo is `CAPTURE_REJECTED`; questions needing review are a state of the review, not an error; and a camera failure or a denied permission is handled inside the camera dialog without a typed error.

Errors are classes with a `code` field. Callers branch on the class or the code, never on the message. The presentation layer turns each error into Teacher-facing text; for example `IN_USE` on a Subject becomes "This subject has 2 answer keys. Delete those answer keys permanently first; then the subject can be deleted."

## Versioning

- **Database schema:** versioned migrations applied on app start; see [Database Contract](#database-contract). The current version is 7.
- **Answer sheet template:** the template ID carries the question count and the layout version, `AC-<count>-V2`, and is stored with every Result. The reader reads the current layout version only: after a change of geometry, sheets printed earlier are refused and must be printed again. Reading several layout versions side by side is not built.
- **This document:** updated only during an authorized documentation pass; `docs/` is otherwise frozen.
