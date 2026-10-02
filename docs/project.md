# Answer Checker — Offline Answer Sheet Scanner

Last reviewed: 2026-10-03

"Answer Checker" is the working name, taken from the repository folder. The final product name is an open decision.

## Overview

Answer Checker is a mobile application that checks shaded multiple-choice answer sheets with the phone camera. The examination itself is a physical paper that already exists; the Teacher does not create an exam in the app. The Teacher creates an Answer Key for it, prints the answer sheet the app makes for that key, scans each student's sheet, reviews the detected answers, and gets a score that is saved on the device. Recognition uses on-device Optical Mark Recognition (OMR).

The app is **offline-only**. Everything runs on the phone and is stored in a local SQLite database on the Teacher's device. There is no backend, no cloud database, no synchronization, and no account.

Today the Teacher can manage Subjects, Classes, and Students, choose which Subjects are taught to each Class, import a class roster from a CSV file, create Answer Keys, print an answer sheet for a key, scan sheets (photograph, review, score, and save), and browse the saved Results: search, filter, open one to see every answer and the stored scan, and delete one permanently.

## Problem Statement

Checking multiple-choice exams by hand is slow and error-prone. Dedicated OMR scanners and machine-readable forms are expensive, and cloud-based scanning apps fail in classrooms with weak or no connectivity. Teachers need a tool that turns the phone they already own into a reliable answer sheet checker that works anywhere.

## Target User

A classroom Teacher who administers multiple-choice exams, often on a low or mid-range Android phone, often without reliable internet.

## Role Model

```text
Role: Teacher
```

There is only one role. Students, classes, and subjects are records the Teacher manages; none of them are user accounts. Do not introduce RBAC unless requirements change later.

## Objectives

- Check a shaded answer sheet in seconds using only the phone.
- Keep every function working with no internet, always.
- Make uncertain detections visible so the Teacher, not the algorithm, has the final say.
- Keep all data on the Teacher's device.
- Let the Teacher permanently remove data they no longer want.

## Core Features

Status labels are defined in [source-of-truth.md](./source-of-truth.md#status-vocabulary).

### Implemented and verified

Accepted on a physical Android phone by the project owner, stage by stage, on 2026-10-02.

- Expo + TypeScript project with Expo Router
- Design system: NativeWind, React Native Reusables, neutral theme with pink identity color, light and dark tokens, selective glass surfaces
- Navigation shell: a floating glass tab bar with exactly five tabs (Home, Keys, Scan, Students, Results) and a raised circular indicator on the selected tab
- **Home dashboard**: greeting, Scan answer sheet, Continue scanning, quick actions that open the create forms, real counts of Students, Classes, Answer Keys, and Results, Scanned today, the three most recent Results and Answer Keys, and a More list with Classes, Subjects, and Settings. Read from the database every time Home is shown
- **Subjects** and **Classes**: view, add, rename, and permanently delete
- **Students**: view grouped by Class, search by name or Student ID, filter by Class, add, edit, move to another Class, and permanently delete
- **Roster import**: a CSV file with `student_id,full_name` into one Class, or with `student_id,full_name,grade_and_section,course` mapped group by group to existing Classes, with a preview before anything is stored
- **Answer Keys**: view grouped by Subject, search, filter by Subject, create, view, edit, duplicate, and permanently delete, with as many questions as the Teacher enters (the app refuses more than 200) and one of A to D per question
- **Printable answer sheet**: a PDF made on the phone for the exact number of questions of the chosen Answer Key, up to 100, opened through the system share sheet to view, print, or send
- **Scan**: choose Subject, Answer Key, Class, and Student in searchable bottom sheets; photograph the sheet; the sheet is read on the device; review and correct the reading; score; save the Result with its answers and one image. A second scan of the same Student with the same key is saved as a separate attempt after confirmation
- Validation, case-insensitive uniqueness, and typed errors for all of the above
- Confirmation dialog before every deletion
- Themed in-app notice after each successful action
- **Results**: list newest first, read a page at a time; one search field over Student name, Student ID, Answer Key, Subject, and Class; filters by Subject, Answer Key, Class, and Student; attempt labels; details with score, counts, every question, and the stored scan image full screen; permanent deletion of a Result with its answers, scan record, and image
- **Settings**: System, Light, and Dark appearance stored on the device; the optional display name used in the Home greeting; the camera permission status; the counts and sizes of what is stored; "Clean temporary files"; "Delete all academic data" with its two confirmations; About with the version
- **Start-up**: the splash screen held until the database, the providers, the first screen, and the stored theme are ready
- **Loading skeletons** on every screen that loads, shown only when a load is slow
- On-device SQLite database with versioned migrations; migrations 1 to 8 have run on the phone
- Web preview that shows an honest "Only on the phone" state instead of pretending to store data

### Implemented, not verified on a device

Code exists and passes the automated tests. These paths were not reported separately in an acceptance pass.

- Deletion of a Student, an Answer Key, or a Class **blocked by saved Results**, with the count. Reachable on the phone now that scans are saved
- An Answer Key with Results being **locked**: only its name can change
- The sheet reader on **dense sheets** (41 to 100 questions) and under difficult light, angles, and pencils. It was accepted on the phone in ordinary use; its thresholds are not calibrated
- Screen-reader behavior of the Scan and Results pickers: focus moving into the sheet and back
- The recovery paths of Result deletion: a failed transaction putting the image back, and leftover staged files being settled when Results is opened. They are covered by tests with a fake file system
- Development demo data (Settings, development builds only): no separate acceptance report
- The start-up message shown when the database cannot be opened, the "taking long to start" screen, and the two timers behind it: they need a failed or stuck start, which was not provoked on the phone
- The recovery paths of "Delete all academic data" and of the temporary-file cleanup when a file cannot be removed
- The project's own app icon, adaptive icon, and splash image (they appear only in a standalone build, not in Expo Go)
- The development-only tools in Settings (loading skeletons control, timings): no separate acceptance report
- The conversion of legacy exam rows by migration 4. No installed database had such rows, so the phone ran the migration with nothing to convert
- Subject-to-Class assignments (Classes → Manage subjects) and the row summaries: in use on the phone since the Students stage, with no separate acceptance report

### Planned

- Calibration of the reader's thresholds on real printed sheets
- Device checks with TalkBack, large fonts, and display scaling, and the measurements of scanning speed and accuracy on a phone
- A standalone Android build, once the owner has chosen the package name (see [source-of-truth.md](./source-of-truth.md#release-truth))

No placeholder screen remains: all five tabs are working features.

### Optional/Future

- QR code on the sheet to identify the Answer Key or template automatically
- Bubbled or QR-coded Student ID on the sheet, always confirmed by the Teacher before saving
- Adding several Students in one manual form
- Batch scanning
- Result export
- Manual backup/export to a local file, and restore from one. This would not make the app cloud-dependent. Not designed or approved yet

### Excluded

Backend, cloud database, synchronization, authentication, accounts, web persistence, handwriting recognition, AI/LLM answer recognition, and creating or storing the examination itself. See [Non-Goals](#non-goals).

## Subjects and Classes

- A **Subject** is what the Teacher teaches: Mathematics, Biology, Programming 1, Data Structures.
- A **Class** is the complete student group. Its name carries the grade or year, the course or strand, and the section: Grade 11 STEM-A, Grade 12 ABM-B, BSIT 1A, BSCS 2B.
- Course, Grade, Strand, and Section are not separate fields or tables.
- Subjects and Classes are linked many-to-many through `class_subjects`. The Teacher edits the link from Classes → Manage subjects.

Rules are in [source-of-truth.md](./source-of-truth.md#subject-and-class-truth); the operations are in [api.md](./api.md#subjects-and-classes-contract).

## Students and Answer Keys

- A **Student** has a Student ID, a full name, and one Class. The Student ID is unique in the whole app.
- An **Answer Key** has a name, one Subject, as many questions as the Teacher enters, and one correct letter per question. It belongs to no Class and is used with every Class that takes its Subject.
- The Teacher never creates an exam in the app.

Rules are in [source-of-truth.md](./source-of-truth.md#student-truth) and [source-of-truth.md](./source-of-truth.md#answer-key-truth); the operations are in [api.md](./api.md#student-contract) and [api.md](./api.md#answer-key-contract).

## Technology Stack

| Area | Technology | Status |
| --- | --- | --- |
| Framework | Expo 57, React Native 0.86, React 19.2, TypeScript 6.0 | Implemented |
| Navigation | Expo Router 57 `Tabs` with a custom bottom tab bar, typed routes | Implemented |
| Icons | `lucide-react-native` with `react-native-svg`, through the Reusables `Icon` component | Implemented |
| Blur | `expo-blur` 57, tab bar only; live blur on iOS and web, opaque fallback on Android | Implemented |
| UI components | React Native Reusables (`Button`, `Text`, `Icon`, `Badge`, `Input`), native `Item` list rows modeled on shadcn Item, dialogs and full-screen forms on React Native `Modal`, `@rn-primitives/portal`, `@rn-primitives/slot` | Implemented |
| Styling | NativeWind 4.2, Tailwind CSS 3.4, `tailwindcss-animate`, `class-variance-authority`, `clsx`, `tailwind-merge` | Implemented |
| Animation | `react-native-reanimated` 4 | Implemented |
| Local SQLite database | `expo-sqlite` 57. Required; the only application database | Implemented (schema version 8) |
| Record IDs | `expo-crypto` 57 (`randomUUID`) | Implemented |
| Roster files | `expo-document-picker` 57 to choose a CSV file; `expo-file-system` 57 to read and delete its temporary copy; the CSV reader is project code, with no parser dependency | Implemented |
| Linting | ESLint 9 with `eslint-config-expo` | Implemented |
| Automated tests | Node's built-in test runner with `node:sqlite`; no test framework installed | Implemented (564 tests: database, use cases, CSV, file lifecycles, sheet template and PDF, sheet reader, scan, results, dashboard, settings, loading, tooling, demo data) |
| Bundle analysis | `expo-atlas` (development dependency), run with `EXPO_UNSTABLE_ATLAS=true` on an export | Implemented |
| Camera | `expo-camera` 57 | Implemented |
| OMR | The project's own TypeScript image processing, on-device. No OpenCV | Implemented |
| Scan images | `expo-image-manipulator` 57 to resize the photo; `fflate` 0.8 for the project's own PNG reader and writer; `expo-file-system` 57 | Implemented |
| Printable answer sheet | PDF written by project code, with no PDF library; shared with `expo-sharing` 57 | Implemented |
| Query/ORM layer | Drizzle ORM | Optional, not decided, not installed |
| Backend, cloud database, synchronization, authentication | None | Excluded. Not installed |

Versions are those in `package.json` on the review date.

This is not a Next.js application and not a browser-first React application.

## UI Design System

The design language is **shadcn New York style**, implemented with **React Native Reusables** and **NativeWind**. Browser-only `shadcn/ui` components are not used, because they depend on the DOM.

New York style in this app means:

- Compact controls
- Clean typography
- Strong hierarchy
- Subtle borders
- Restrained border radius
- Dense but readable layouts
- Minimal visual noise
- Consistent spacing
- Accessible contrast
- Mobile-friendly touch targets

Compact does not mean small tap areas: every control has a touch target of at least 48dp.

The theme is a neutral base with pink as the identity color: deeper pink in light mode, brighter pink in dark mode. Dark mode is a plum-tinted near-black with stepped surfaces and visible borders. A soft pink backdrop glow sits behind each screen, and selected surfaces are translucent glass with a thin edge. Light and dark tokens are defined in `src/global.css`; the rules are in [source-of-truth.md](./source-of-truth.md#ui-truth).

## Navigation

The bottom navigation has exactly five items:

1. Home
2. Keys (Answer Keys)
3. Scan
4. Students
5. Results

Subjects, Classes, and Settings are not bottom-tab items. They open from Home:

```text
Home → More → Classes
Home → More → Subjects
Home → More → Settings
```

While one of them is open the bar stays visible, Home stays the selected tab, and both the header Back action and the Android back button return to the screen it was opened from. That is Home, except when Subjects was opened from the "Open Subjects" button that Answer Keys shows while no Subject exists. The bar hides while the keyboard is open. Rules are in [source-of-truth.md](./source-of-truth.md#navigation-truth).

## Architecture Overview

```text
React Native + Expo + TypeScript
            |
 Mobile presentation layer
            |
  Application use cases
            |
      Domain rules
            |
  Local infrastructure
(SQLite, local files, on-device sheet reader)
            |
SQLite on the Teacher's device
```

Everything runs inside the mobile application. Nothing leaves the device. Diagrams are in [diagrams.md](./diagrams.md). Contracts are in [api.md](./api.md).

### Code structure

The code follows a feature-oriented clean architecture. The authoritative rules are in [source-of-truth.md](./source-of-truth.md#clean-architecture-layers).

```text
src/
  app/                                  Expo Router routes and composition root
    _layout.tsx                         Theme, database provider, use-case providers, navigation shell
    <route>.tsx                         One-line re-export of a feature screen
  core/
    domain/                             Name rules shared by named records; CSV reader
    application/                        Typed errors, Clock and IdGenerator ports, name validation
    infrastructure/database/            SQLite provider, migrations, transactions, SQL connection type
    presentation/components/            Screen body, list screen, dialogs, picker sheet, choice list, chips, search, notice
    presentation/components/ui/         React Native Reusables components
    presentation/navigation/            Bottom-tab shell and the destination list
    presentation/hooks/, lib/           Press feedback, keyboard height, theme tokens, helpers
  features/
    subjects/                           domain, application, infrastructure, presentation
    classes/                            domain, application, infrastructure, presentation
    class-subjects/                     application, infrastructure, presentation
    students/                           domain, application, infrastructure, presentation
    answer-keys/                        domain, application, infrastructure, presentation
    scan/                               domain, application, infrastructure, presentation
    results/                            domain, application, infrastructure, presentation
    dashboard/                          domain, application, infrastructure, presentation (Home)
    settings/                           domain, application, infrastructure, presentation
    demo-data/                          domain, application, infrastructure, presentation (development aid)
  global.css                            Tailwind layers and theme tokens
scripts/generate-answer-sheet.mjs       Writes an answer sheet PDF on the computer, for inspection
tests/database/                         Node tests for schema, migrations, repositories, use cases, CSV, files
tests/scan/                             Node tests for the sheet template and PDF, the reader, and the scan use cases
tests/results/                          Node tests for migration 7, the list, filters, details, image store, and deletion
tests/dashboard/                        Node tests for Home's counts, local day, recent lists, links, and Continue scanning
tests/settings/                         Node tests for migration 8, preferences, storage summary, cleanup, and delete all
tests/loading/                          Node tests for skeleton timing and the development loading control
tests/tooling/                          Node tests for the Metro block list, the splash configuration, and the start-up rules
tests/demo-data/                        Node tests for adding and removing the demo data
scripts/generate-brand-assets.mjs       Draws the icon, adaptive icon, splash image, and favicon
```

## Main User Flow

Implemented. After a save the app shows the score and offers the next Student; the saved Result is opened from the Results tab.

```text
Teacher opens app
  -> Home
  -> Select Subject
  -> Select Answer Key of that Subject
  -> Select Class assigned to that Subject
  -> Select Student of that Class
  -> Photograph the answer sheet printed for that Answer Key
  -> On-device reading
  -> Review detected answers
  -> Resolve BLANK / MULTIPLE / UNCLEAR if needed
  -> Confirm
  -> Calculate score
  -> Save to SQLite
  -> Results tab: search, filter, open, or permanently delete the Result
```

## Offline-Only Behavior

The app never needs the internet and never uses it. Everything it does, now and as planned, runs on the phone.

What this means for the Teacher:

- The app works the same with or without a connection, including in airplane mode.
- Data stays on the current device. Nothing is uploaded.
- Different phones do not share data. A class created on one phone does not appear on another.
- Closing or restarting the app keeps the data.
- Clearing the app's data or uninstalling the app generally removes its database.
- Losing or replacing the phone may mean losing the data.
- Automatic cloud backup and cross-device access are not included.

## Answer Sheet

Implemented. The app makes its own answer sheet; there is no fixed sheet and no sheet file in the app.

- The sheet is generated for the exact question count of the chosen Answer Key. A 10-question key gives a sheet with questions 1 to 10 only.
- A4, black only: four corner markers, an orientation square, a row of cells that spells the question count, fields for name, Student ID, Subject, and Class (for people; the app does not read them), and bubbles A to D for each question.
- Density follows the length: up to 40 questions in two columns of 20, up to 75 in three columns of 25, up to 100 in four columns of 25 with smaller bubbles.
- One sheet holds at most 100 questions. A longer Answer Key cannot be scanned.
- The Scan screen says "This answer sheet contains N questions with choices A–D" and offers "View or share printable sheet".
- A sheet printed for another question count is refused by the reader, which names both counts.

Arbitrary third-party sheets are not supported, and the branded ZipGrade sheet used as a visual reference must not be copied or shipped.

## OMR Overview

Implemented. The reader is the project's own TypeScript; OpenCV is not used.

Pipeline:

```text
Photo (resized to a working size, as grayscale)
  -> Find dark squares
  -> Pick the four corner markers
  -> Find which way up the sheet is; read its question count
  -> Refuse a sheet for another question count
  -> Flatten the sheet onto its own coordinates
  -> Check light and focus
  -> Measure the fill of every bubble at its known place
  -> Decide each question
  -> Review
  -> Score
```

Conceptual example of one question:

```text
Question 1
A = 10% filled
B = 82% filled
C = 11% filled
D = 9% filled
Detected answer: B
```

Each question is read as `MARKED`, `BLANK`, `MULTIPLE`, or `UNCLEAR`. The numbers above are illustrative. The thresholds in the code are initial values set on generated test images; they are not calibrated against real sheets, different pencils and pens, lighting, cameras, and erasures.

A photo that cannot be trusted is refused with a reason the Teacher can act on (move closer, hold the phone flat, more light, hold steady, show all four corners, use the sheet for this answer key). A refused photo gives no answers and no score.

The reader reads only the A–D bubbles and the sheet's own markers. It does not read a handwritten name or subject: the Teacher selects the Answer Key and the Student. A QR code or bubbled Student ID is Optional/Future and would always be confirmed by the Teacher before saving.

## Data Storage

- The only database is the local SQLite database (`expo-sqlite`), stored on the Teacher's device in the app's private storage.
- The file is `answer-checker.db`. It is opened at app start with WAL journaling and foreign keys enabled and verified, then migrated.
- The schema version is kept in `PRAGMA user_version`. The latest version is **8**.
- Tables (all `STRICT`): `subjects`, `classes`, `class_subjects`, `students`, `answer_keys`, `answer_key_items`, `results`, `student_answers`, `scan_records`.
- The app reads and writes `subjects`, `classes`, `class_subjects`, `students`, `answer_keys`, and `answer_key_items`. Scan writes `results`, `student_answers`, and `scan_records`; Results reads them and deletes them. A saved Result is never updated. Results are also counted to block deletions, lock used Answer Keys, and label Students already scanned.
- A Result stores the names it was saved under (Student, Student ID, Class, Subject, Answer Key), so it keeps showing them after a rename or a move.
- There is no exam, teacher, account, role, or synchronization table.
- IDs are UUIDs generated on the device. Timestamps are UTC ISO-8601 strings.
- Each installation has its own independent database.
- An imported roster file is never stored: not its contents, its name, or its path. Only the Students are.
- A saved Result has one image, the flattened sheet, stored as a PNG file in the app's private documents folder and named by the Result's ID. The database stores only its path. The camera's photo is deleted as soon as the sheet is read or refused. Nothing is written to the device gallery.
- A generated answer sheet PDF is a temporary file in the app's cache; only the newest one is kept.
- The database is not encrypted by the app.
- `app_settings` holds the app's own preferences: the appearance and the optional display name. It is kept when all academic data is deleted.
- The app makes no backup. Android's system backup is left at its default and may include the database when the Teacher has it enabled on the phone.
- The web preview opens no database.

The schema is drawn in [diagrams.md](./diagrams.md#implemented-sqlite-schema) and described in [api.md](./api.md#database-contract).

## Permanent Deletion

"Delete Permanently" is permanent physical deletion: the record is removed from SQLite. It is not a soft delete and not an archive, and it leaves no tombstone behind.

Implemented for Subjects, Classes, assignments, Students, Answer Keys, and Results. The confirmation shown for an Answer Key:

```text
Delete “Midterm examination”?

Subject: Mathematics. 40 questions.

This permanently deletes the answer key from this device.
It cannot be undone.

[Cancel] [Delete]
```

When other records depend on the one being deleted, the deletion is blocked and the dialog says why, for example "This class contains 24 students. Move or delete those students first; then the class can be deleted." Nothing is cascaded to those records.

| Record | Blocked while |
| --- | --- |
| Subject | Answer Keys belong to it |
| Class | Students belong to it, or Results were scanned under it |
| Student | Saved Results belong to it |
| Answer Key | Saved Results were scored with it |

Deleting a Result also removes its answers, its scan record, and its stored scan image, and is confirmed with the Student, Student ID, Answer Key, capture date, score, and attempt. The image is moved aside first, the rows are deleted in one transaction, and only then is the image destroyed; if the transaction fails the image is put back. Deleting the last Result of a Student, Answer Key, or Class releases that record for deletion. The rules are in [api.md](./api.md#permanent-deletion-contract). Because there is no backup, a deleted record cannot be recovered.

## Excluded: Cloud and Synchronization

Supabase, MongoDB, PostgreSQL, cloud synchronization, a backend API, authentication, online accounts, and cross-device synchronization are not part of the approved architecture and are not planned for the initial product. See [source-of-truth.md](./source-of-truth.md#excluded-cloud-and-synchronization).

They may be reconsidered only after an explicit requirement change, recorded as a new architecture decision.

## Security and Privacy Considerations

- Student information is stored on the Teacher's device and nowhere else.
- Scanned answer sheets may contain identifiable information.
- One image of the flattened sheet is kept with each saved Result, until that Result is deleted. The original photo is not kept. The image can be viewed inside the app only; it is not shared or copied to the gallery.
- Permanent deletion removes associated stored images.
- The local SQLite database is not encrypted by the app. It is protected by the operating system's app sandbox and the device lock.
- There is no authentication: anyone who can open the phone and the app can see the data.
- The app holds no API keys, tokens, or credentials, because it connects to nothing.

## Constraints

- Must run acceptably on low and mid-range Android devices: camera responsiveness, image preprocessing time, and memory use matter.
- A standalone build is blocked until the owner chooses the Android package name.
- Development needs the phone to reach the computer's dev server on port 8081 over the same Wi-Fi. A network that keeps its clients apart prevents that; the phone's own hotspot works instead. "Failed to download remote update" in Expo Go means the bundle could not be fetched, not that the app is broken.
- A cold Metro cache makes the first bundle take about 30 to 40 seconds on the development computer; the next takes well under a second. `--clear` forces the cold case and is not for everyday use.
- Everything built so far uses only Expo SDK modules and JavaScript, so it runs in Expo Go without a development build. Native OpenCV would end that and is not used.
- Reading a sheet takes a moment of JavaScript work on the phone; the photo is reduced to a working size first.
- One answer sheet holds at most 100 questions.
- Temporary images are cleaned up: after each reading, and again at the start of a scan session for anything an interrupted session left behind.
- SQLite queries must stay fast as results accumulate (indexes on foreign keys and common filters).
- Detection accuracy depends on print quality, lighting, and how bubbles are shaded.

## Non-Goals

- Creating or storing the examination itself: question text, choice text, or exam content
- Essay grading
- Handwriting recognition, including reading a handwritten student name or subject
- LLM-based answer recognition
- Any internet connection or network feature
- A backend server or API of any kind
- A cloud database (Supabase, MongoDB, PostgreSQL, or otherwise)
- Cloud synchronization, automatic cloud backup, and cross-device access
- Authentication, online accounts, and Teacher or student login
- Persistence in the web preview
- Arbitrary answer-sheet recognition
- Multiple-role RBAC

## Current Implementation Status

Inspected 2026-10-02.

| Item | Finding |
| --- | --- |
| Expo project | Implemented. Name "Answer Checker", slug `answer-checker`, scheme `answerchecker`. Managed/CNG: no `android/` or `ios/` folders |
| Navigation | Implemented and verified. Bottom tabs: `/`, `/keys`, `/scan`, `/students`, `/results`. Secondary screens opened from Home → More, with Back and Home still selected: `/classes`, `/subjects`, `/settings`. No drawer or sidebar, and no `/exams` route |
| Design system | Implemented and verified. Light and dark tokens, selective glass surfaces. Live blur is off on Android |
| Home dashboard | Implemented and verified. Real counts, Scanned today, recent Results and Answer Keys, Continue scanning, quick actions that open the create forms, and the More list. Read again on every visit; no static or sample values |
| SQLite database | Implemented. `answer-checker.db`, WAL, foreign keys on, `STRICT` tables, `PRAGMA user_version` = 8 |
| Migration 1 (base schema) | Verified on an Android 14 emulator and on a physical phone |
| Migration 2 (`class_subjects`) | Has run on a physical phone |
| Migration 3 (Student ID unique in the app) | Has run on a physical phone |
| Migration 4 (answer keys replace exams) | Has run on a physical phone, with no legacy rows to convert. The conversion and its rollback are covered by the Node tests |
| Migration 5 (no upper limit on questions) | Has run on a physical phone |
| Migration 6 (results as a scan saves them) | Has run on a physical phone |
| Migration 7 (the names a Result was saved under; list index) | Has run on a physical phone |
| Subjects, Classes | Implemented and verified: list, add, rename, permanent delete |
| Subject-to-Class assignments | Implemented and in use on the phone; no separate acceptance report |
| Students | Implemented and verified: list, search, filter, add, edit, move, permanent delete |
| Roster import | Implemented and verified: both CSV formats, preview, class mapping, atomic save, temporary-file cleanup |
| Answer Keys | Implemented and verified: list, search, filter, create, view, edit, duplicate, permanent delete |
| Blocked by Results; locked Answer Key | Implemented and tested in Node. Reachable on the phone since Scan saves Results; no separate acceptance report |
| Printable answer sheet | Implemented and verified: generated per Answer Key for 1 to 100 questions, shared as a PDF |
| Scan | Implemented and verified: selection in searchable bottom sheets, camera, on-device reading, review, scoring, saving, second attempts, scan-file cleanup |
| In-app notice | Implemented and verified |
| OMR thresholds | Initial values. Not calibrated on a range of printed sheets, pencils, light, and phones |
| Results | Implemented and verified: list, search, filters, attempts, details, stored-scan viewer, permanent deletion with its answers, scan record, and image |
| Permanent deletion | Implemented for Subjects, Classes, assignments, Students, Answer Keys, and Results |
| Migration 8 (`app_settings`) | Has run on a physical phone |
| Settings | Implemented and verified: appearance (System, Light, Dark) stored and restored, display name, camera permission status, storage counts and sizes, temporary-file cleanup, deletion of all academic data, About |
| Start-up | Implemented and verified: splash screen held until the app is ready. The failure and stall screens are implemented and covered by tests, not provoked on a device |
| Loading skeletons | Implemented and verified: shared skeleton and timing on every screen that loads; small refresh indicator on reloads |
| Metro configuration | The project's `tests/`, `docs/`, `scripts/`, and generated folders under `.expo/` are excluded from Metro's file watching |
| Demo data | Implemented. Settings, development builds only: adds and removes a fixed set of made-up records |
| Repositories and use cases | Subjects, Classes, Subject-to-Class assignments, Students, Answer Keys, Scan, Results, dashboard, settings, demo data |
| Backend | None. No server code, no network requests |
| Supabase, MongoDB | Not installed. Excluded from the architecture |
| Authentication, synchronization | None. Excluded from the architecture |
| Automated tests | 564 tests in `tests/database/`, `tests/scan/`, `tests/results/`, `tests/dashboard/`, `tests/settings/`, `tests/loading/`, `tests/tooling/`, and `tests/demo-data/`, run by `npm run test:db`, all passing. No UI tests |
| App icons and splash | The project's own artwork (three answer bubbles, the middle one checked, on pink), generated by `npm run brand`. The splash has a light and a dark background. Not seen on a device: Expo Go shows its own |
| Native identifiers | `android.package` and `ios.bundleIdentifier` not set. Blocked by an owner decision |
| Version | 1.0.0 in `app.json`; no Android version code or iOS build number set |
| License | `LICENSE` is the Expo template's MIT text; the copyright holder is an owner decision |
| Dependencies removed in stage 8 | `expo-device`, `expo-image`, `expo-web-browser`: template leftovers that no code used |
| Development dependencies added | `expo-atlas` (bundle analysis) and `@expo/ngrok` (tunnel mode of the dev server; not needed on a network where the phone can reach the computer) |

Verification performed on the review date: `npm run test:db` (564 pass), `tsc --noEmit`, ESLint, `expo-doctor` (21 of 21), React Native Reusables `doctor`, and JavaScript bundle exports for web and Android all pass.

The Node tests prove the SQL, the migrations and every upgrade path, the repositories, the use cases, the CSV reader, the roster-file and scan-file lifecycles and the image handling of Result deletion (with a fake file system), the sheet template and PDF for every question count, and the sheet reader on generated pictures of sheets. They do not prove `expo-sqlite`, the file picker, the camera, the reader on photos of printed sheets, or the UI on a device; the acceptance passes on the phone do that for the features marked verified.

"Verified" in this document rests on the project owner's acceptance on a physical Android phone. TalkBack, raised font sizes, and display scaling have not been systematically checked. Scanning speed, memory use, and accuracy across pencils, pens, erasures, shadow, glare, and blur have not been measured; the reader was accepted on a phone in ordinary use and its thresholds remain uncalibrated.

Web is a preview of the phone app only. In a browser the app is held to a 480-point column; there is no desktop or tablet layout. The database provider is a pass-through there, and the Subjects, Classes, Students, Answer Keys, Scan, and Results screens show "Only on the phone" with no Add or camera action, and Home shows its actions with "Only on the phone" in place of the numbers.

## Known Mismatches

The exam-versus-answer-key mismatches recorded earlier are resolved: migration 4 replaced the exam tables, and the tab, screen, and Home wording now say Keys and Answer Keys.

| Open point | Detail |
| --- | --- |
| Back from Subjects | Opened from the "Open Subjects" button on Answer Keys, Back returns to Answer Keys rather than Home |
| Names of older Results | A Result saved before migration 7 shows the names its records had at the upgrade, not at the scan |
| Scan viewer | The enlarged view is a fixed size with scrolling; there is no pinch zoom |
| Results search and letter case | Letters outside ASCII are matched as typed, in lower case, and in upper case. A mixed-case variant such as "pEÑa" may not match |
| Results filters | Only records that have a Result are offered |
| Home create actions | "Create answer key" opens Answer Keys without the form while no Subject exists, and "Add student" opens Students without the form while no Class exists; those screens explain what is missing |
| Home recent rows | A long name is cut to one line |
| After deleting all data | Screens that were open keep their search text and filters until they are next shown; they then read the empty database |
| Storage sizes | Approximate: they are the sizes of the files, measured when Settings is opened |
| Settings on web | The appearance choice is applied but not remembered; storage, cleanup, and deletion are phone-only |
| Long Answer Keys | A key may have up to 200 questions, but one sheet holds 100. A longer key cannot be scanned |
| Reader calibration | The reader's thresholds are initial values; see OMR Overview |
| Create answer key from Scan | The action in the empty Answer Key picker opens the Answer Keys screen, not the form itself |
| Large lists | The Students and Answer Keys lists are plain scrolling lists, not virtualized (the Results list is). Several hundred rows may open slowly |
| CSV encoding | A roster is read as UTF-8. A file saved in another encoding shows wrong characters for letters such as ñ |
| File types | The picker offers files reported as CSV or plain text. A provider that reports another type shows the file greyed out |

## Roadmap

| Stage | Scope | Status |
| --- | --- | --- |
| 1 | Database foundation: SQLite, migrations, base schema, transactions, tests | Implemented and verified |
| 2 | Subjects, Classes, and Subject-to-Class assignments | Implemented and verified |
| 3 | Students and offline roster import | Implemented and verified |
| 4 | Answer Keys and the schema and terminology migration | Implemented and verified |
| 5 | Scan: generated answer sheet, camera, on-device reading, review, scoring, saving | Implemented and verified |
| 6 | Results and permanent result and image deletion | Implemented and verified |
| 7 | Home integration with real data | Implemented and verified |
| 8 | Settings, data management, branding, start-up, loading feedback, and release audit | Implemented and verified |

## Future Features

- QR code Answer Key or template identification
- Bubbled or QR-coded Student ID, confirmed by the Teacher before saving
- Batch scanning
- Result export
- Manual backup/export and restore using local files
