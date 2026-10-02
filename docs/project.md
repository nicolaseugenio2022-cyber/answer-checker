# Answer Checker — Offline Answer Sheet Scanner

Last reviewed: 2026-10-02

"Answer Checker" is the working name, taken from the repository folder. The final product name is an open decision.

## Overview

Answer Checker is a mobile application that checks shaded multiple-choice answer sheets with the phone camera. The examination itself is a physical paper that already exists; the Teacher does not create an exam in the app. The Teacher creates an Answer Key for it, scans each student's standardized answer sheet, reviews the detected answers, and gets a score that is saved on the device. Recognition uses on-device Optical Mark Recognition (OMR).

The app is **offline-only**. Everything runs on the phone and is stored in a local SQLite database on the Teacher's device. There is no backend, no cloud database, no synchronization, and no account.

Today the Teacher can manage Subjects and Classes and choose which Subjects are taught to each Class. Students, Answer Keys, scanning, and Results are not built.

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

Accepted on a physical Android phone by the project owner on 2026-10-02.

- Expo + TypeScript project with Expo Router
- Design system: NativeWind, React Native Reusables, neutral theme with pink identity color, light and dark tokens, selective glass surfaces
- Navigation shell: a floating glass tab bar with exactly five tabs (Home, Exams, Scan, Students, Results) and a raised circular indicator on the selected tab
- Home dashboard: greeting, quick actions, empty-state Activity rows, and a More list with Classes, Subjects, and Settings. It shows no statistics or records
- **Subjects**: view, add, rename, and permanently delete, stored in SQLite
- **Classes**: view, add, rename, and permanently delete, stored in SQLite
- Name validation, case-insensitive uniqueness, deletion restrictions with the blocking counts, and typed errors for both
- Confirmation dialog before every deletion
- Themed in-app notice after create, rename, and delete
- Settings screen with a working light/dark theme switch and a note that data is stored only on the device
- On-device SQLite database with versioned migrations; migration 1 (the base schema) has run on the phone
- Web preview that shows an honest "Only on the phone" state instead of pretending to store data

### Implemented, not verified on a device

Code exists and passes the automated checks. Not yet confirmed on a physical phone.

- **Migration 2**: the `class_subjects` table
- **Subject-to-Class assignments**: Classes → Manage subjects, with a checkbox list of all subjects and an atomic save
- Row summaries: the number of subjects on each Class row and the number of classes on each Subject row

### Planned

- Students: add one, add several, and offline CSV roster import (Stage 3)
- Answer Keys, replacing the "Exams" placeholder, with the schema and terminology migration it needs (Stage 4)
- Scan standardized answer sheets with the camera
- On-device OMR with `SELECTED`, `BLANK`, `MULTIPLE`, and `UNCERTAIN` states
- Review and correct detected answers
- Calculate scores against the selected Answer Key
- Save results locally and view previous results
- Permanently delete results, including answer rows, scan metadata, and scan images
- An original printable answer sheet with four alignment markers

Placeholder screens exist for Exams & answer keys, Scan answer sheet, Students, and Results. Each says what it will do and that it is not built; none has controls or data.

### Optional/Future

- QR code on the sheet to identify the Answer Key or template automatically
- Bubbled or QR-coded Student ID on the sheet, always confirmed by the Teacher before saving
- Batch scanning
- Result export
- Manual backup/export to a local file, and restore from one. This would not make the app cloud-dependent. Not designed or approved yet

### Excluded

Backend, cloud database, synchronization, authentication, accounts, web persistence, handwriting recognition, and AI/LLM answer recognition. See [Non-Goals](#non-goals).

## Subjects and Classes

- A **Subject** is what the Teacher teaches: Mathematics, Biology, Programming 1, Data Structures.
- A **Class** is the complete student group. Its name carries the grade or year, the course or strand, and the section: Grade 11 STEM-A, Grade 12 ABM-B, BSIT 1A, BSCS 2B.
- Course, Grade, Strand, and Section are not separate fields or tables.
- Subjects and Classes are linked many-to-many through `class_subjects`. The Teacher edits the link from Classes → Manage subjects.

Rules are in [source-of-truth.md](./source-of-truth.md#subject-and-class-truth); the operations are in [api.md](./api.md#subjects-and-classes-contract).

## Technology Stack

| Area | Technology | Status |
| --- | --- | --- |
| Framework | Expo 57, React Native 0.86, React 19.2, TypeScript 6.0 | Implemented |
| Navigation | Expo Router 57 `Tabs` with a custom bottom tab bar, typed routes | Implemented |
| Icons | `lucide-react-native` with `react-native-svg`, through the Reusables `Icon` component | Implemented |
| Blur | `expo-blur` 57, tab bar only; live blur on iOS and web, opaque fallback on Android | Implemented |
| UI components | React Native Reusables (`Button`, `Text`, `Icon`, `Badge`, `Input`), native `Item` list rows modeled on shadcn Item, dialogs on React Native `Modal`, `@rn-primitives/portal`, `@rn-primitives/slot` | Implemented |
| Styling | NativeWind 4.2, Tailwind CSS 3.4, `tailwindcss-animate`, `class-variance-authority`, `clsx`, `tailwind-merge` | Implemented |
| Animation | `react-native-reanimated` 4 | Implemented |
| Local SQLite database | `expo-sqlite` 57. Required; the only application database | Implemented (schema version 2) |
| Record IDs | `expo-crypto` 57 (`randomUUID`) | Implemented |
| Linting | ESLint 9 with `eslint-config-expo` | Implemented |
| Automated tests | Node's built-in test runner with `node:sqlite`; no test framework installed | Implemented (141 database and use-case tests) |
| Camera | Expo Camera or compatible React Native camera library | Planned, not installed |
| OMR | OpenCV, on-device | Planned, not installed |
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
2. Exams — temporary label of a placeholder that will become `Keys` (Answer Keys)
3. Scan
4. Students
5. Results

Subjects, Classes, and Settings are not bottom-tab items. They open from Home:

```text
Home → More → Classes
Home → More → Subjects
Home → More → Settings
```

While one of them is open the bar stays visible, Home stays the selected tab, and both the header Back action and the Android back button return to Home. Rules are in [source-of-truth.md](./source-of-truth.md#navigation-truth).

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
(SQLite, local files, camera, on-device OMR)
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
    domain/                             Name rules shared by named records
    application/                        Typed errors, Clock and IdGenerator ports, name validation
    infrastructure/database/            SQLite provider, migrations, transactions, SQL connection type
    presentation/components/            Screen body, list screen, dialogs, notice, placeholder
    presentation/components/ui/         React Native Reusables components
    presentation/navigation/            Bottom-tab shell and the destination list
    presentation/hooks/, lib/           Press feedback, theme tokens, helpers
  features/
    subjects/                           domain, application, infrastructure, presentation
    classes/                            domain, application, infrastructure, presentation
    class-subjects/                     application, infrastructure, presentation
    dashboard/, settings/               presentation
    exams/, scan/, students/, results/  presentation (placeholders)
  global.css                            Tailwind layers and theme tokens
tests/database/                         Node tests for schema, migrations, repositories, use cases
```

## Main User Flow

Planned. Only the first step works today.

```text
Teacher opens app
  -> Home
  -> Select Subject
  -> Select Answer Key of that Subject
  -> Select Class assigned to that Subject
  -> Select Student of that Class
  -> Scan answer sheet
  -> On-device OMR
  -> Review detected answers
  -> Resolve BLANK / MULTIPLE / UNCERTAIN if needed
  -> Confirm
  -> Calculate score
  -> Save to SQLite
  -> View result
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

## OMR Overview

Planned. Nothing in this section is built.

The app scans its own standardized answer sheet. Arbitrary third-party sheets are not supported, and the branded ZipGrade sheet used as a visual reference must not be copied or shipped.

Pipeline:

```text
Camera capture
  -> Detect answer sheet
  -> Detect alignment markers
  -> Perspective correction
  -> Grayscale
  -> Thresholding
  -> Locate bubble regions
  -> Measure fill percentage
  -> Determine selected answers
  -> Validate detection
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

Each question resolves to `SELECTED`, `BLANK`, `MULTIPLE`, or `UNCERTAIN`. The numbers above are illustrative only. No production thresholds exist; they must be calibrated against real sheets, different pencils and pens, lighting, cameras, and erasures.

The initial version reads only the A–D bubbles and the alignment markers. It does not read a handwritten name or subject: the Teacher selects the Answer Key and the Student. A QR code or bubbled Student ID is Optional/Future and would always be confirmed by the Teacher before saving.

## Data Storage

- The only database is the local SQLite database (`expo-sqlite`), stored on the Teacher's device in the app's private storage.
- The file is `answer-checker.db`. It is opened at app start with WAL journaling and foreign keys enabled and verified, then migrated.
- The schema version is kept in `PRAGMA user_version`. The latest version is **2**.
- Tables (all `STRICT`): `subjects`, `classes`, `class_subjects`, `students`, `exams`, `exam_questions`, `answer_keys`, `exam_results`, `student_answers`, `scan_records`.
- Only `subjects`, `classes`, and `class_subjects` are read or written by the app today. The other tables exist in the schema and are unused.
- There is no teacher, account, role, or synchronization table.
- IDs are UUIDs generated on the device. Timestamps are UTC ISO-8601 strings.
- Each installation has its own independent database.
- Scan images, when that feature exists, are local files in the app's storage.
- The database is not encrypted by the app.
- The web preview opens no database.

The schema is drawn in [diagrams.md](./diagrams.md#implemented-sqlite-schema) and described in [api.md](./api.md#database-contract).

## Permanent Deletion

"Delete Permanently" is permanent physical deletion: the record is removed from SQLite. It is not a soft delete and not an archive, and it leaves no tombstone behind.

Implemented for Subjects, Classes, and assignments. The confirmation shown today:

```text
Delete “BSIT 1A”?

This permanently deletes the class from this device.
It cannot be undone.

[Cancel] [Delete]
```

When other records depend on the one being deleted, the deletion is blocked and the dialog says why, for example "This class contains 24 students and is used by 2 exams." Nothing is cascaded to those records.

Planned: deleting a result also removes its student answers, scan metadata, and local scan image. The rules are in [api.md](./api.md#permanent-deletion-contract). Because there is no backup, a deleted record cannot be recovered.

## Excluded: Cloud and Synchronization

Supabase, MongoDB, PostgreSQL, cloud synchronization, a backend API, authentication, online accounts, and cross-device synchronization are not part of the approved architecture and are not planned for the initial product. See [source-of-truth.md](./source-of-truth.md#excluded-cloud-and-synchronization).

They may be reconsidered only after an explicit requirement change, recorded as a new architecture decision.

## Security and Privacy Considerations

- Student information is stored on the Teacher's device and nowhere else.
- Scanned answer sheets may contain identifiable information.
- Scan images should not be retained longer than necessary. Whether images are kept at all after scoring is an open decision.
- Permanent deletion removes associated stored images.
- The local SQLite database is not encrypted by the app. It is protected by the operating system's app sandbox and the device lock.
- There is no authentication: anyone who can open the phone and the app can see the data.
- The app holds no API keys, tokens, or credentials, because it connects to nothing.

## Constraints

- Must run acceptably on low and mid-range Android devices: camera responsiveness, image preprocessing time, and memory use matter.
- OpenCV on-device requires native code that Expo Go does not contain, so the scanning stage will need an Expo development build. The features built so far use only modules that a development build or standard Expo client provides.
- Large sheets (many questions) and batch scanning increase processing time and memory pressure.
- Temporary images must be cleaned up; full-resolution images should not be stored after processing unless required.
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
| Navigation | Implemented and verified. Bottom tabs: `/`, `/exams`, `/scan`, `/students`, `/results`. Secondary screens opened from Home → More, with Back and Home still selected: `/classes`, `/subjects`, `/settings`. No drawer or sidebar |
| Design system | Implemented and verified. Light and dark tokens, selective glass surfaces. Live blur is off on Android |
| Home dashboard | Implemented and verified. Shortcuts, static empty states, and the More list; it reads no data yet |
| SQLite database | Implemented. `answer-checker.db`, WAL, foreign keys on, `STRICT` tables, `PRAGMA user_version` = 2 |
| Migration 1 (base schema, nine tables) | Implemented and verified on an Android 14 emulator and on a physical phone |
| Migration 2 (`class_subjects`) | Implemented. Fresh-install and version-1 upgrade paths pass in the Node tests. Not verified on a device |
| Subjects | Implemented and verified: list, add, rename, permanent delete |
| Classes | Implemented and verified: list, add, rename, permanent delete |
| Subject-to-Class assignments | Implemented, not verified on a device |
| In-app notice | Implemented and verified |
| Students | Planned. Placeholder screen; table exists and is unused |
| Answer Keys | Planned. Placeholder screen labelled "Exams"; the schema does not yet match the approved model |
| Camera, OMR, review, scoring | Planned. Expo Camera and OpenCV not installed |
| Results | Planned. Placeholder screen; tables exist and are unused |
| Permanent deletion | Implemented for Subjects, Classes, and assignments. Planned for everything else |
| Repositories and use cases | Subjects, Classes, and Subject-to-Class assignments only |
| Backend | None. No server code, no network requests |
| Supabase, MongoDB | Not installed. Excluded from the architecture |
| Authentication, synchronization | None. Excluded from the architecture |
| Automated tests | 141 tests in `tests/database/`, run by `npm run test:db`, all passing. No UI tests |
| App icons and splash | Still the Expo template artwork |
| Native identifiers | `android.package` and `ios.bundleIdentifier` not set |

Verification performed on the review date: `npm run test:db` (141 pass), `tsc --noEmit`, ESLint, `expo-doctor` (21 of 21), React Native Reusables `doctor`, and JavaScript bundle exports for web and Android all pass.

The Node tests prove the SQL, the migrations, the repositories, and the use cases against Node's built-in SQLite. They do not prove `expo-sqlite` on a device; the device checks above do that for migration 1, Subjects, and Classes.

Not verified on a physical device: migration 2, the Manage subjects dialog, and the row summaries. TalkBack and raised font sizes have not been systematically checked.

Web is a preview of the phone app only. In a browser the app is held to a 480-point column; there is no desktop or tablet layout. The database provider is a pass-through there, and the Subjects and Classes screens show "Only on the phone" with no Add action.

## Known Mismatches

| Mismatch | Detail |
| --- | --- |
| "Exams" versus "Answer Keys" | The tab, the placeholder screen, the Home action ("Create exam"), and the Home activity row ("Recent exams") still use the old wording. The approved wording is in [source-of-truth.md](./source-of-truth.md#answer-key-truth) |
| Schema versus Answer Key model | `exams.class_id` is required, so the schema cannot yet express an Answer Key reused across Classes. A migration is required before Stage 4 |
| `exams` in deletion messages | A blocked deletion reports "exams" because that is the table that exists. The wording changes with the Answer Keys migration |

## Roadmap

| Stage | Scope | Status |
| --- | --- | --- |
| 1 | Database foundation: SQLite, migrations, base schema, transactions, tests | Implemented and verified |
| 2 | Subjects, Classes, and Subject-to-Class assignments | Subjects and Classes: implemented and verified. Assignments (migration 2): implemented, not verified on a device |
| 3 | Students and offline roster import | Planned |
| 4 | Answer Keys and the required schema and terminology migration | Planned |
| 5 | Scan, camera, on-device OMR, and review | Planned |
| 6 | Results and permanent result and image deletion | Planned |
| 7 | Home integration with real data | Planned |
| 8 | Settings, accessibility, and final device testing | Planned |

## Future Features

- QR code Answer Key or template identification
- Bubbled or QR-coded Student ID, confirmed by the Teacher before saving
- Batch scanning
- Result export
- Manual backup/export and restore using local files
