# Source of Truth

Last reviewed: 2026-10-02

This document records the authoritative product and architecture decisions for the Offline Answer Sheet Scanner. Developers and AI coding agents must read it before changing the project.

> **Implementation status at time of writing:** the app shell, the local SQLite database (schema version 6), Subjects, Classes, Subject-to-Class assignments, Students with CSV roster import, Answer Keys, and Scan (printable answer sheet, camera capture, on-device reading, review, scoring, and saving a Result) exist. Viewing and deleting Results do not. Unless a row or sentence says "Implemented", everything below is a **target decision**, not a description of working software. See [project.md](./project.md#current-implementation-status).

## Status Vocabulary

Every feature in these documents carries one of these labels:

| Label | Meaning |
| --- | --- |
| Implemented and verified | Code exists and was accepted on a physical Android phone |
| Implemented, not verified on a device | Code exists and passes automated checks, but has not been confirmed on a physical phone |
| Planned | Approved, not built |
| Optional/Future | Possible later; not approved for the initial product |
| Excluded | Not part of the architecture; must not be built |

## Product Truth

- This is a **mobile application**, Android first.
- The application is **offline-only**. Every feature works with no network, and no feature uses one.
- The only role is **Teacher**.
- All data is held in a **local SQLite database stored on the Teacher's device**. It is the only application database.
- The Teacher does **not create an exam in the app**. The examination is a physical paper that already exists. The Teacher creates only an **Answer Key** for it. See [Answer Key Truth](#answer-key-truth).
- The application scans **standardized shaded answer sheets** designed for this system. The app generates the sheet itself, for the exact number of questions of an Answer Key.
- Answer recognition uses **deterministic OMR / computer vision**, not AI/LLM inference, and runs on the device.
- The application must support **permanent physical deletion**.

This replaces the earlier "offline-first with planned online synchronization" decision. See [Excluded: Cloud and Synchronization](#excluded-cloud-and-synchronization).

## Role Truth

Current roles:

- Teacher

Do not create `Admin`, `Student`, `Super Admin`, `Staff`, or `Examiner` roles unless future requirements explicitly change the project.

Do not introduce RBAC. With a single role there is nothing to authorize between. There is no authentication and there are no accounts: the person using the device is the Teacher. Students are data records managed by the Teacher; they never sign in.

## Technology Truth

| Area | Decision | Status |
| --- | --- | --- |
| Mobile | React Native, Expo, TypeScript | Implemented |
| Navigation | Expo Router, routes under `src/app` | Implemented |
| UI | React Native Reusables, NativeWind, shadcn New York style, pink glass theme | Implemented |
| Persistence | SQLite via `expo-sqlite`. Required; the only application database | Implemented (schema version 6) |
| Record IDs | UUIDs from `expo-crypto` (`randomUUID`) | Implemented |
| Roster files | `expo-document-picker` to choose a CSV file, `expo-file-system` to read and delete its temporary copy. The CSV reader is the project's own code | Implemented |
| Camera | `expo-camera`, on-device. Permission is asked only when the Teacher opens the camera | Implemented |
| OMR | The project's own deterministic image processing in TypeScript (`features/scan/infrastructure/omr`), on-device. OpenCV is not used | Implemented |
| Scan images | `expo-image-manipulator` resizes the photo; the project's own PNG reader and writer use `fflate`; files are handled with `expo-file-system` | Implemented |
| Printable answer sheet | A PDF drawn by the project's own code on the phone and handed to the system share sheet with `expo-sharing` | Implemented |
| Query/ORM layer | Drizzle ORM | Optional, not decided, not installed. Repositories use raw `expo-sqlite` today |
| Backend, cloud database, synchronization, authentication | None | Excluded from the approved architecture |

`expo-sqlite` is the required persistence technology. Supabase, MongoDB, PostgreSQL, and any other remote or hosted database are not part of the approved architecture and must not be installed.

Expo Router is the navigation system. Do not add MobX, Inversify, a separate navigation library, or another state or dependency-injection framework without a documented need; wire dependencies with plain TypeScript composition.

This is not a Next.js application and not a browser-first React application. There is no server of any kind: no FastAPI, no Python service, no backend API.

## UI Truth

- The project's design language is **shadcn New York style** with a **pink glass** theme.
- Browser-only `shadcn/ui` is **not** the mobile runtime. Its components depend on the DOM and Radix web primitives and must not be imported into the React Native app.
- The mobile implementation uses React Native-compatible components: **React Native Reusables** styled with **NativeWind**.
- Pink is the product's identity color on a neutral base. It marks primary actions, the selected tab, focus rings, icon plates, section accents, selected checkboxes, and success notices. Surfaces and body text stay neutral.
- All colors are semantic tokens defined in `src/global.css` and mirrored in `src/core/presentation/lib/theme.ts`. Do not hard-code colors in components. Change both files together.
- Dark mode is a plum-tinted near-black, not pure black. Surfaces step up in lightness (background, card, popover) so layers stay distinguishable, borders are visible, and muted text stays readable. Every text pair must keep at least 4.5:1 contrast in both themes.
- Glass is used selectively: the bottom tab bar, the Home header control, quick actions, the Activity panel, list-state panels, and the in-app notice. Glass means the `glass` token at partial opacity plus a thin edge. Do not put glass inside glass, and do not apply it to every surface.
- Only the tab bar uses a live blur (`expo-blur`), and only on iOS and the web preview. Android uses a nearly opaque surface instead, for performance and because the Android blur path is unverified on a device. Content must stay readable with blur off.
- The product is designed for phones, Android first. There is no desktop or tablet layout, no sidebar, and no drawer. Web exists only to preview the phone UI and is held to a phone-width column. Do not design hover-dependent or mouse-specific behavior. When web and a physical Android device differ, the device is the authority.
- The Home dashboard shows real data or a truthful empty state with a next action. Never fake statistics, records, or activity.
- Icons come from one family, Lucide (`lucide-react-native`), imported per icon (`lucide-react-native/icons/<name>`) to keep the bundle small. No emoji icons.
- A screen for an unbuilt feature must say it is not built and must not show controls, sample records, or statistics that imply it works.
- Feedback after an action is one themed in-app notice (a glass card with a pink check for success, a destructive border and alert icon for an error) that floats just above the tab bar and closes itself. Native toasts and alert popups are not used for this. Validation messages stay inside the form, and a blocked deletion is explained inside its dialog.
- Destructive actions always go through a confirmation dialog that names the record, says the deletion is permanent, and offers Cancel first.
- Visual rules: compact controls, clean typography, strong hierarchy, subtle borders, restrained border radius, dense but readable layouts, minimal visual noise, consistent spacing, accessible contrast, and touch targets of at least 48dp.

The correct short description of the UI stack is "React Native + Expo, React Native Reusables, NativeWind, shadcn New York visual style" — never "React + shadcn/ui".

## Navigation Truth

Implemented and verified on a physical Android phone.

The bottom navigation has exactly five items, in this order:

1. Home
2. Keys
3. Scan
4. Students
5. Results

- `Keys` opens the Answer Keys screen (route `/keys`, title `Answer Keys`). There is no Exams tab, route, or screen.
- Subjects, Classes, and Settings are **not** bottom-tab items. They have no slot, icon, or label in the bar. They are secondary screens reached through:

```text
Home → More → Classes
Home → More → Subjects
Home → More → Settings
```

- A secondary screen keeps the bottom bar visible, shows a compact header with a Back action, and leaves **Home as the selected tab**. The header Back action and the Android back button return to the screen it was opened from, which is Home.
- One exception: when no Subject exists, the Answer Keys screen offers an "Open Subjects" button, because an Answer Key needs a Subject. Back from Subjects then returns to Answer Keys.
- The bar is a floating glass capsule with side margins, sitting above the bottom safe-area inset, with a visible label under every icon. The selected tab's icon sits in a raised pink circle that overlaps the capsule's top edge. The circle rises in with a short fade; it does not slide between tabs, and the animation is skipped when the system asks for reduced motion. Tab positions and touch areas never move.
- The bar steps aside while the on-screen keyboard is open, so it never covers a field.
- Exactly one tab looks selected. Scan is the central tab and is styled like every other tab when it is not selected; it is a normal tab, not a floating button.
- The selected tab is marked by position (the raised circle), shape, and label weight as well as color.
- The destination list lives in `src/core/presentation/navigation/destinations.ts`.

## Subject and Class Truth

### Subject

A Subject is what the Teacher teaches, for example Mathematics, Biology, Programming 1, or Data Structures.

### Class

A Class is the complete student group. Its single name contains the relevant grade or year, course or strand, and section, for example Grade 11 STEM-A, Grade 12 ABM-B, BSIT 1A, or BSCS 2B.

Course, Grade, Strand, and Section are **not** separate fields or database entities. The feature is called Classes, never Courses or Sections.

### Rules (implemented)

- A name is trimmed, must not be empty, and has at most 60 characters.
- Names are unique within their kind, ignoring letter case.
- Renaming keeps `created_at` and updates `updated_at`. Renaming to the same name changes nothing.
- Lists are alphabetical, ignoring letter case.
- A Subject cannot be deleted while Answer Keys belong to it. A Class cannot be deleted while it has Students or while Results were scanned under it. The Teacher is told how many records block the deletion. Nothing cascades to those records.
- An Answer Key does not belong to a Class, so it never blocks deleting one.

### Subject-to-Class assignments

Implemented. Migration 2 has run on a physical Android phone.

```text
Subject ← class_subjects → Class
```

- A Class can have several Subjects, and a Subject can be taught to several Classes.
- The Teacher manages assignments in one place: Classes → Manage subjects. The Subjects screen only shows how many classes take each subject.
- A duplicate assignment is impossible (composite primary key).
- Saving a selection replaces the whole set for that class in one transaction.
- Assignment rows are physically deleted. Deleting an otherwise deletable Subject or Class also removes its assignment rows, and only those.
- The Scan flow uses this relationship to offer only the Classes of the chosen Subject.

## Student Truth

Implemented and verified on a physical Android phone.

```text
Student
- internal application ID (UUID, never shown)
- Student ID shown to the Teacher (column student_number)
- Full name
- Class ID
```

- A Student belongs to exactly one Class.
- A Student has no Course, Grade, Strand, or Section field, and no Subject. That information is carried by the assigned Class; Subjects reach a Student through the Class.
- The Student ID is trimmed, required, at most 32 characters, and **unique across all Students in the app**, ignoring letter case.
- The full name is trimmed, required, and at most 100 characters.
- The Teacher can add, edit, move to another Class, search, filter by Class, and permanently delete a Student.
- A Student with saved Results cannot be deleted. The Results are never deleted from the Students screen.
- Lists are ordered by Class name, full name, Student ID, then internal ID.

### Roster import

Implemented. The Teacher imports a CSV file chosen on the device. Nothing uses the network.

Format A, into one Class the Teacher chooses:

```csv
student_id,full_name
2026-001,Maria Santos
2026-002,Paolo Garcia
```

Format B, a roster of several Classes:

```csv
student_id,full_name,grade_and_section,course
SHS-001,Maria Santos,Grade 11 A,STEM
COL-001,Paolo Garcia,1A,BSIT
```

- Format B replaces the earlier idea of a single `class` column.
- Rows are grouped by `grade_and_section` plus `course`, and each group is mapped to an **existing** Class. A Class is selected automatically only when its name equals the two values joined in either order, compared by letters and digits alone, and exactly one Class matches. Everything else is chosen by the Teacher. The import never creates a Class.
- Only `class_id` is stored. `grade_and_section` and `course` are not kept.
- Before anything is stored, a preview shows the file name, the number of rows, the valid rows, the invalid rows, the Student IDs repeated in the file, the Students already stored, the groups without a Class, and how many Students will be added. Every rejected row is listed with its CSV row number.
- A stored Student is never overwritten or updated by an import.
- The confirmed rows are stored in one transaction: all of them, or none.

### Roster file lifecycle

Binding storage rule.

- The CSV is an import source, not app data. Its contents, name, and path are never stored in SQLite.
- The app reads the file into memory and deletes its own temporary copy immediately, before the preview opens, whatever happens next.
- Only a file inside the app's own import cache folder is ever deleted. The Teacher's original file is never deleted, changed, renamed, or moved.
- Copies left by an interrupted session are removed the next time the Teacher picks a file.

### Not built

Adding several Students in one manual form is not built. A roster import covers that need.

## Answer Key Truth

Binding product decision. Implemented and verified on a physical Android phone.

The Teacher does not create an exam in the app. The Teacher creates only an Answer Key for an existing physical examination. There is no Exam entity, table, screen, or route.

User-facing terminology:

| Place | Text |
| --- | --- |
| Bottom-tab label | `Keys` |
| Screen title | `Answer Keys` |
| Primary action and Home shortcut | `Create answer key` |
| Home activity label | `Recent answer keys` |

The word "exam" appears only in ordinary copy about the paper test, such as the example name "Midterm examination".

An Answer Key contains:

- A name, unique within its Subject, ignoring letter case. The same name may be used under another Subject.
- One Subject.
- As many questions as the Teacher enters, 1 or more. The database sets no upper limit (migration 5). The app refuses more than 200 as a guard against a mistyped number; that ceiling is not a schema rule. There is no fixed limit of 40.
- Exactly one correct answer, A, B, C, or D, for every question.

The app does not store question text, choice text, or any other content of the physical examination.

A Subject can have several Answer Keys. An Answer Key does not belong to a Class: it is used with every Class assigned to its Subject.

### Rules

- A key is saved whole, header and answers together, in one transaction. An incomplete key is never stored.
- The Teacher can list, search, filter by Subject, view, create, edit, duplicate, and permanently delete Answer Keys.
- Duplicating copies the Subject, the question count, and every answer under a new ID, proposes a free name such as "Midterm – Copy", and copies no Results.

### Historical integrity

- Once a saved Result was scored with an Answer Key, its Subject, question count, and answers are frozen. Its name can still change.
- Old Results are never rescored.
- To revise a used key, the Teacher duplicates it and edits the copy.
- A key with Results cannot be deleted until those Results are permanently deleted.

### Schema history

Migration 1 modelled exams: `exams` (with a required class), `exam_questions`, and a per-question `answer_keys` table. Migration 4 converted that into `answer_keys` and `answer_key_items`, kept the IDs, renamed `exam_results` to `results`, and removed the class ownership and the old tables. Migration 5 removed the 40-question limit that migrations 1 and 4 had written into the tables. See [api.md](./api.md#migrations).

## Scanning Truth

Implemented and verified on a physical Android phone (accepted by the project owner on 2026-10-02).

Flow:

1. Select a Subject.
2. Select an Answer Key. Only the Answer Keys of that Subject are offered.
3. Select a Class. Only the Classes assigned to that Subject through `class_subjects` are offered.
4. Select a Student. Only the Students whose `class_id` is that Class are offered.
5. Photograph the answer sheet printed for that Answer Key.
6. The sheet is read on the device.
7. Review the reading. Every blank, multiple, or unclear question must be decided by the Teacher.
8. The sheet is scored against the selected Answer Key.
9. The Result is saved locally with its answers and one image of the flattened sheet.

Rules:

- Changing the Subject clears a selected Answer Key, and a Class and Student that no longer match. Changing the Class clears the Student.
- Each choice is made in a bottom sheet with a search field that filters the offered list as the Teacher types.
- Identity comes only from the Teacher's four choices. Nothing handwritten on the sheet is read.
- The application layer validates the relationships against the database before reading a photo and again immediately before saving. Filtering in the UI alone is not sufficient.
- The save also checks that the Answer Key still has the answers the sheet was reviewed against. If it changed, nothing is saved and the sheet is scanned again.
- A Student who already has a Result with the same Answer Key gets a second, separate Result only after the Teacher confirms. An earlier Result is never replaced or overwritten.
- After a save, the Subject, Answer Key, and Class stay selected for the next Student. Students already scanned with the chosen Answer Key are labelled.
- A Result records the Class the Student was in at the time of the scan, the template of the sheet, when the photo was taken, and, for every question, the correct answer at the time of scoring. Later changes to the Student or the Answer Key name do not alter it.

## Answer Sheet Truth

Binding product decision. Implemented and verified on a physical Android phone.

- The app has no fixed answer sheet. A sheet is **generated for the exact question count of the selected Answer Key**: a 10-question key prints questions 1 to 10 and nothing else. No spare rows, no unused columns, and no wording such as "up to 40 questions".
- One definition of the sheet's geometry is shared by the PDF generator, the reader, and the test images, so the printed sheet and the reader cannot drift apart.
- The sheet is A4 with four corner markers, one orientation square, and a row of cells that spells the sheet's question count for the reader. Each question has bubbles A to D.
- The reader is given the question count of the selected Answer Key. A sheet printed for another count is refused with a message naming both counts; it is never read with the wrong layout.
- One sheet holds at most **100 questions**. An Answer Key with more is listed in Scan but cannot be scanned and has no printable sheet.
- The Teacher gets the sheet from the Scan screen ("View or share printable sheet"), which hands a PDF made on the phone to the system share sheet for viewing, printing, or sending. No sheet file ships with the app, and nothing is downloaded.
- The template identifier (`AC-<question count>-V2`) is printed on the sheet and stored with every Result. A change of geometry needs a new layout version; sheets printed with an older version are no longer read. Sheets of the first layout (`AC-40-V1`, a fixed 40-question sheet that was never released) are refused.
- The layout is original to this project.

## Architecture Truth

```text
React Native + Expo + TypeScript
  -> Mobile presentation layer
  -> Application use cases
  -> Domain rules
  -> Local infrastructure
  -> SQLite on the Teacher's device
```

- Everything runs inside the mobile application. Nothing in this flow leaves the device.
- SQLite runs inside the app. Every read and write goes to the local SQLite database.
- Camera capture and OMR run entirely on the device. Scan images are local files in the app's private storage.
- The presentation layer is shadcn New York-style mobile UI built with React Native Reusables and NativeWind.

### Clean architecture layers

Code is organized by feature, and each feature is split into layers:

```text
src/
  app/                  Thin Expo Router route adapters and the composition root
  core/                 Shared cross-cutting code
    domain/
    application/
    infrastructure/
    presentation/
  features/
    <feature>/
      domain/
      application/
      infrastructure/
      presentation/
```

| Layer | Contains | May import |
| --- | --- | --- |
| Domain | Entities and pure business rules | Nothing outside domain |
| Application | Use cases and the ports (interfaces) they need | Domain |
| Infrastructure | Port implementations, all local: SQLite, local files, the sheet reader | Application, domain |
| Presentation | React Native screens, components, hooks | Application, domain |
| `src/app` | Route files and provider wiring | Any layer |

Rules:

- Dependencies point inward. Domain and application must not import React, React Native, Expo, Expo Router, or SQLite.
- No layer makes network requests.
- SQL lives only in infrastructure, always parameterized.
- Use cases receive their clock and ID generator by injection, so they are deterministic in tests.
- Route files stay thin: they re-export or render a presentation screen and contain no business logic.
- `src/app/_layout.tsx` is the composition root, the one place allowed to connect infrastructure to presentation.
- A layer folder is created only when it has real code. Do not add empty folders, placeholder interfaces, or ports with no use case behind them.

Layers that exist today:

| Location | Layers present |
| --- | --- |
| `src/core` | `domain`, `application`, `infrastructure/database`, `presentation` |
| `features/subjects`, `classes`, `students`, `answer-keys`, `scan` | `domain`, `application`, `infrastructure`, `presentation` |
| `features/class-subjects` | `application`, `infrastructure`, `presentation` (it has no entity of its own) |
| `features/dashboard`, `results`, `settings` | `presentation` only |

## Offline Truth

The application is offline-only. No network is required for any feature, and no feature uses one. That includes:

- Opening the app
- Creating and editing subjects, classes, assignments, students, and answer keys
- Importing a student roster from a local CSV file
- Making and sharing the printable answer sheet
- Opening the camera and scanning an answer sheet
- Running OMR and detecting answers
- Reviewing and correcting detections
- Comparing against the answer key and calculating the score
- Saving and viewing results
- Permanently deleting records

The scanning path is `Mobile camera -> On-device OMR -> Application use cases -> Local SQLite database`. It must never pass through a server.

A feature that would need the internet is out of scope until the requirements change.

## OMR Truth

Implemented and verified on a physical Android phone.

- **Decision (project owner, 2026-10-02):** the reader is the project's own TypeScript image processing, not native OpenCV. It runs in Expo Go without a development build, and the same code runs in the automated tests. OpenCV is not installed and must not be added without a new decision recorded here.
- OMR is deterministic: the same picture always gives the same reading. Steps: find the dark squares, pick the four corner markers, find which way up the sheet is, read its question count, flatten the sheet onto its own coordinates, check light and focus, measure the fill of every bubble at its known position, decide each question.
- Bubbles are never searched for in the photo. They are measured where the template says they are.
- The reader recognizes only the letters A, B, C, and D.
- Each question is read as one of four states: `MARKED` (one clear mark), `BLANK`, `MULTIPLE`, `UNCLEAR`. These replace the earlier names `SELECTED` and `UNCERTAIN`.
- The reader never guesses. A faint mark, or a mark that does not clearly lead the others, is `UNCLEAR`, not a best-effort answer.
- `BLANK`, `MULTIPLE`, and `UNCLEAR` questions must be decided by the Teacher (a letter, or Blank confirmed) before a Result can be saved. The Teacher may also change a `MARKED` answer. The Teacher's decision is authoritative, and the Result keeps both what was read and what was decided.
- A photo that cannot be trusted is refused with a reason and produces no answers and no score: too few pixels, corner markers not all visible, sheet too far away, too steep an angle, not an Answer Checker sheet, a sheet for another question count, blurred, or badly lit.
- Only the project's own generated answer sheet is supported. Arbitrary third-party sheets are out of scope.
- The app does **not** try to read a handwritten Student name or Subject. That needs OCR or handwriting recognition, which is outside the product because a misread could attach a score to the wrong Student.
- The Teacher selects the Answer Key and the Student manually.
- Optional/Future: the sheet may carry a QR code or a bubbled Student ID for automatic identification. Any automatically detected identity must be shown to the Teacher for confirmation before saving.
- The branded ZipGrade sheet used as a visual reference must not be copied or distributed. The project's sheet is its own.
- **Thresholds are initial values, not final.** Every image threshold is in one place (`OMR_SETTINGS`) and every classification threshold in another (`DETECTION_THRESHOLDS`). They were set on generated test images and accepted on one phone. They have not been calibrated across pencils, pens, printers, lighting conditions, cameras, and erasures, and must not be documented as final until they are.
- No AI/LLM inference and no remote call.

## Data Truth

- The local SQLite database is the only application database and the system of record.
- The database file is `answer-checker.db`, stored in the app's private device storage.
- Each installation on each device has its own independent database. Devices do not share data, and there is no cross-device access.
- Data persists across closing and restarting the app. Clearing the app's data or uninstalling the app generally removes the database. Losing or replacing the phone may lose the data. There is no automatic backup.
- The database is not encrypted by the application. Do not claim encryption unless it is implemented.
- The web preview opens no database and persists nothing.
- Record IDs are UUIDs generated on the device, not auto-increment integers.
- Timestamps are UTC ISO-8601 strings as `Date.prototype.toISOString()` produces them.
- Tables are `STRICT`. Foreign-key enforcement is turned on, and verified, on every connection. Journaling is WAL.
- Schema changes are made only through ordered, versioned migrations in `src/core/infrastructure/database/migrations.ts`, one file per migration. The schema version is stored in `PRAGMA user_version`. The latest version is **6**.
- A migration that has run on a device is frozen. Migrations 1 to 6 have run on a physical Android phone; never edit them. Change the schema by appending migration 7.
- The schema is the evidence of what is implemented. The implemented schema is drawn in [diagrams.md](./diagrams.md#implemented-sqlite-schema).
- Do not add role, permission, account, teacher, or synchronization tables.

## Deletion Truth

Permanent physical deletion is mandatory.

- "Delete Permanently" means the local domain record is **physically removed** from SQLite.
- It is not `isDeleted = true`. It is not `status = archived`. There is no `deleted_at` column, tombstone, or soft-delete flag, and one must not be added. An archive feature, if ever added, is a separate feature.
- Deletion requires explicit confirmation that names the record and states the action cannot be undone.
- A shared parent record must not silently destroy unrelated records. A Class with Students or with Results scanned under it, a Subject with Answer Keys, and a Student or Answer Key with Results are blocked from deletion (`ON DELETE RESTRICT`) until those records are removed deliberately.
- Dependent rows that cannot exist on their own are removed with their parent: a Result's answer rows and scan metadata, an Answer Key's items, and the Subject-to-Class assignment rows of a deleted Subject or Class.
- Deleting a Result removes its answer rows and scan metadata. The local image paths are collected before the database deletion is committed, and the files are deleted after the commit.
- Deletion leaves nothing behind: no tombstone, no soft-deleted row, and no synchronization instruction.
- Because there is no backup, a permanent deletion cannot be recovered.

Implemented today: permanent deletion of Subjects, Classes, assignments, Students, and Answer Keys. Result deletion is Planned. Until it exists, a Student, Answer Key, or Class that has Results cannot be deleted.

## Excluded: Cloud and Synchronization

The following are **not part of the approved architecture**. They are not planned for the initial product and must not be built, installed, configured, or designed for:

- Supabase
- MongoDB
- PostgreSQL or any other remote or hosted database
- Cloud synchronization, including outbox or sync-queue tables
- A backend API
- Authentication and online accounts
- Cross-device synchronization or access
- Automatic cloud backup
- Persistence in the web preview

Cloud functionality may be reconsidered only after an explicit future requirement change. That change must be recorded as a new architecture decision in this document before any related code, dependency, or schema is added.

A manual backup/export and restore feature that works on local files is a possible future feature. It would not make the application cloud-dependent and is not a synchronization layer. It is not designed or approved yet.

## Security Truth

- Student information and scanned sheets are personal data stored on the Teacher's device.
- The data is protected only by the operating system's app sandbox and the device's own lock. The application implements no encryption, authentication, or access control. Do not claim otherwise.
- Scan images are kept to the minimum: the camera's photo is deleted as soon as the sheet is read or refused, and one flattened image is kept per saved Result, in the app's private storage, until that Result is deleted. Images never go to the device gallery.
- The application talks to no service, so it holds no API keys, tokens, or credentials. None may be added.
- Secrets must never be committed to source code.

## Documentation Precedence

When architectural documents disagree, the higher entry wins:

1. `source-of-truth.md`
2. `project.md`
3. `api.md`
4. `api-routes.md`
5. `diagrams.md`

Two different kinds of authority apply:

- `source-of-truth.md` = authoritative **product and architecture decisions**.
- Actual code and schema = authoritative **evidence of current implementation**.

If the implementation disagrees with the architecture documentation, **report the discrepancy**. Do not silently change either side.

### Documentation freeze

`docs/` is frozen. Agents may read it but must not modify, rename, format, regenerate, or delete documentation unless the user explicitly says to unfreeze it. When temporarily unfrozen, edits are limited to the authorized documentation task, after which the freeze resumes automatically.

## Rules for AI Coding Agents

1. Inspect before editing.
2. Do not invent implementation. Do not describe a feature as working unless the code proves it.
3. Do not introduce new roles without explicit requirements.
4. Do not turn the project into Next.js or any browser-first application.
5. Do not use browser-only shadcn components in the React Native runtime.
6. Do not introduce any network dependency, network request, backend, or account. The application is offline-only.
7. Do not replace permanent physical deletion with soft deletion, tombstones, or archiving.
8. Do not move OMR processing to a required remote API.
9. Do not use AI/LLM inference as the answer-recognition mechanism.
10. Do not treat OMR thresholds as final without calibration evidence, and keep them in `OMR_SETTINGS` and `DETECTION_THRESHOLDS`, not scattered through the code.
11. Respect the clean architecture layer rules: dependencies point inward, SQL stays in infrastructure, route files stay thin.
12. Do not add empty layers, placeholder interfaces, or state/DI frameworks without a current need.
13. Do not install Supabase, MongoDB, or any cloud, synchronization, backend, or authentication dependency; they are excluded. Do not install OpenCV or Drizzle without an explicit decision recorded here.
14. Do not edit a migration that has run on a device. Append a new one.
15. Do not add Subjects, Classes, or Settings to the bottom navigation.
16. Do not edit `docs/` while it is frozen.
17. Clearly distinguish Implemented, Planned, and Optional/Future features.
18. Do not reintroduce a fixed-size answer sheet, a bundled sheet file, or a fixed limit of 40 questions.
