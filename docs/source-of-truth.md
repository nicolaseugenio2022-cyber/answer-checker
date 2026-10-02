# Source of Truth

Last reviewed: 2026-10-02

This document records the authoritative product and architecture decisions for the Offline Answer Sheet Scanner. Developers and AI coding agents must read it before changing the project.

> **Implementation status at time of writing:** the app shell, the local SQLite database (schema version 2), Subjects, Classes, and Subject-to-Class assignments exist. Students, Answer Keys, scanning, OMR, and Results do not. Unless a row or sentence says "Implemented", everything below is a **target decision**, not a description of working software. See [project.md](./project.md#current-implementation-status).

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
- The application scans **standardized shaded answer sheets** designed for this system.
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
| Persistence | SQLite via `expo-sqlite`. Required; the only application database | Implemented (schema version 2) |
| Record IDs | UUIDs from `expo-crypto` (`randomUUID`) | Implemented |
| Camera | Expo Camera, or a compatible React Native camera library, on-device | Planned, not installed |
| OMR | OpenCV running on-device | Planned, not installed |
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
2. Exams
3. Scan
4. Students
5. Results

- `Exams` is the **temporary implemented label** of a placeholder screen. The approved future label is `Keys` (screen title `Answer Keys`). The rename has not been made; see [Answer Key Truth](#answer-key-truth).
- Subjects, Classes, and Settings are **not** bottom-tab items. They have no slot, icon, or label in the bar. They are secondary screens reached through:

```text
Home → More → Classes
Home → More → Subjects
Home → More → Settings
```

- A secondary screen keeps the bottom bar visible, shows a compact header with a Back action, and leaves **Home as the selected tab**. The header Back action and the Android back button both return to Home.
- The bar is a floating glass capsule with side margins, sitting above the bottom safe-area inset, with a visible label under every icon. The selected tab's icon sits in a raised pink circle that overlaps the capsule's top edge. The circle rises in with a short fade; it does not slide between tabs, and the animation is skipped when the system asks for reduced motion. Tab positions and touch areas never move.
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
- A Subject cannot be deleted while an exam row (the future Answer Key) uses it. A Class cannot be deleted while it has students or exam rows. The Teacher is told how many records block the deletion. Nothing cascades to those records.

### Subject-to-Class assignments

Implemented, not yet verified on a physical device.

```text
Subject ← class_subjects → Class
```

- A Class can have several Subjects, and a Subject can be taught to several Classes.
- The Teacher manages assignments in one place: Classes → Manage subjects. The Subjects screen only shows how many classes take each subject.
- A duplicate assignment is impossible (composite primary key).
- Saving a selection replaces the whole set for that class in one transaction.
- Assignment rows are physically deleted. Deleting an otherwise deletable Subject or Class also removes its assignment rows, and only those.
- The future Scan flow uses this relationship to offer only the Classes of the chosen Subject.

## Student Truth

Planned. No Student feature is implemented; the `students` table exists but nothing reads or writes it.

```text
Student
- internal application ID (UUID, never shown)
- Student ID shown to the Teacher
- Full name
- Class ID
```

- A Student belongs to exactly one Class.
- A Student has no Course, Grade, Strand, or Section field. That information is carried by the assigned Class.
- Planned entry methods: add one Student, add several Students, and offline CSV import.

CSV imported inside a selected Class:

```csv
student_id,full_name
2024-00125,Paolo Garcia
2024-00126,Sofia Mendoza
```

Optional multi-Class CSV:

```csv
student_id,full_name,class
SHS-001,Maria Santos,Grade 11 STEM-A
COL-001,Paolo Garcia,BSIT 1A
```

The file is read from local storage. Import never uses the network.

## Answer Key Truth

Binding product decision. **Planned; not implemented.**

The Teacher does not create an exam in the app. The Teacher creates only an Answer Key for an existing physical examination.

Approved user-facing terminology:

| Place | Approved text | Implemented today |
| --- | --- | --- |
| Bottom-tab label | `Keys` | `Exams` |
| Screen title | `Answer Keys` | `Exams & answer keys` (placeholder) |
| Home action | `Create answer key` | `Create exam` |
| Home activity label | `Recent answer keys` | `Recent exams` |

An Answer Key contains:

- A name or identifying label
- A Subject
- The number of questions
- The correct answer, A, B, C, or D, for each question

The app does not store question text, choice text, or any other content of the physical examination.

A Subject can have several Answer Keys. An Answer Key may be reused across several Classes.

### Current mismatch between the schema and this decision

- The physical SQLite schema (migration 1) still contains `exams`, `exam_questions`, and `answer_keys`.
- `exams.class_id` is required, so today's schema ties one exam row to one Class.
- That does not match a reusable Answer Key that belongs to a Subject and is used with several Classes.
- A deliberate schema and terminology migration is required before the Answer Keys stage is built. It does not exist yet.
- Until then, documents show the implemented physical schema and the approved model separately. Do not rename tables in documentation while the code is unchanged.

## Scanning Truth

Planned. No scanning screen, camera, or OMR code exists.

Approved flow:

1. Select a Subject.
2. Show only the Answer Keys belonging to that Subject.
3. Show only the Classes assigned to that Subject through `class_subjects`.
4. Select a Class.
5. Show only the Students whose `class_id` is that Class.
6. Select a Student.
7. Scan the sheet.
8. Detect the A–D bubbles on the device.
9. Review blank, multiple, or uncertain answers.
10. Score against the selected Answer Key.
11. Save the Result locally.

- Changing the Subject clears a selected Answer Key, Class, and Student that no longer match.
- Changing the Class clears a selected Student that no longer matches.
- The application layer validates these relationships again before saving. Filtering in the UI alone is not sufficient.

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
- Camera capture and OMR are local infrastructure and run entirely on the device. Scan images are local files.
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
| Infrastructure | Port implementations, all local: SQLite, local files, camera, OpenCV | Application, domain |
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
| `features/subjects`, `features/classes` | `domain`, `application`, `infrastructure`, `presentation` |
| `features/class-subjects` | `application`, `infrastructure`, `presentation` (it has no entity of its own) |
| `features/dashboard`, `exams`, `scan`, `students`, `results`, `settings` | `presentation` only |

## Offline Truth

The application is offline-only. No network is required for any feature, and no feature uses one. That includes:

- Opening the app
- Creating and editing subjects, classes, assignments, students, and answer keys
- Importing a student roster from a local CSV file
- Opening the camera and scanning an answer sheet
- Running OMR and detecting answers
- Reviewing and correcting detections
- Comparing against the answer key and calculating the score
- Saving and viewing results
- Permanently deleting records

The scanning path is `Mobile camera -> On-device OMR -> Application use cases -> Local SQLite database`. It must never pass through a server.

A feature that would need the internet is out of scope until the requirements change.

## OMR Truth

Planned. OpenCV and a camera library are not installed.

- OMR is deterministic computer vision: detect sheet, detect alignment markers, correct perspective, grayscale, threshold, locate bubble regions, measure fill, determine answers, validate.
- The initial OMR recognizes fixed A–D answer bubbles and alignment markers. The schema accepts only the letters A, B, C, and D.
- Each question resolves to one of four states: `SELECTED`, `BLANK`, `MULTIPLE`, `UNCERTAIN`.
- Anything other than a confident `SELECTED` or `BLANK` must be surfaced to the Teacher for review before scoring is finalized. The Teacher's correction is authoritative.
- Only the project's own standardized answer sheet is supported. Arbitrary third-party sheets are out of scope.
- The app does **not** try to read a handwritten Student name or Subject. That needs OCR or handwriting recognition, which is outside the MVP because a misread could attach a score to the wrong Student.
- In the initial version the Teacher selects the Answer Key and the Student manually.
- Optional/Future: an original answer-sheet template may carry a QR code or a bubbled Student ID for automatic identification, and a QR code may identify the Answer Key or template. Any automatically detected identity must be shown to the Teacher for confirmation before saving.
- The branded ZipGrade sheet used as a visual reference must not be copied or distributed as an application asset. The project needs its own original template.
- **No production thresholds are defined.** Fill thresholds must be calibrated against real sheets across pencils, pens, lighting conditions, cameras, and erasures before any value is documented as final.

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
- Schema changes are made only through ordered, versioned migrations in `src/core/infrastructure/database/migrations.ts`, one file per migration. The schema version is stored in `PRAGMA user_version`. The latest version is **2**.
- A migration that has run on a device is frozen. Migration 1 has run on a physical Android phone; never edit it. Treat migration 2 the same way.
- The schema is the evidence of what is implemented. The implemented schema is drawn in [diagrams.md](./diagrams.md#implemented-sqlite-schema).
- Do not add role, permission, account, teacher, or synchronization tables.

## Deletion Truth

Permanent physical deletion is mandatory.

- "Delete Permanently" means the local domain record is **physically removed** from SQLite.
- It is not `isDeleted = true`. It is not `status = archived`. There is no `deleted_at` column, tombstone, or soft-delete flag, and one must not be added. An archive feature, if ever added, is a separate feature.
- Deletion requires explicit confirmation that names the record and states the action cannot be undone.
- A shared parent record must not silently destroy unrelated records. A Class with students or exam rows, a Subject with exam rows, and a Student or exam row with results are blocked from deletion (`ON DELETE RESTRICT`) until a use case removes those records deliberately.
- Dependent rows that cannot exist on their own are removed with their parent: a result's answer rows and scan metadata, an exam row's questions and answer letters, and the Subject-to-Class assignment rows of a deleted Subject or Class.
- Deleting a Result removes its answer rows and scan metadata. The local image paths are collected before the database deletion is committed, and the files are deleted after the commit.
- Deletion leaves nothing behind: no tombstone, no soft-deleted row, and no synchronization instruction.
- Because there is no backup, a permanent deletion cannot be recovered.

Implemented today: permanent deletion of Subjects, Classes, and assignments. Result deletion and file cleanup are Planned.

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
- Scan images should not be retained longer than necessary.
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
10. Do not hard-code OMR thresholds as final without calibration evidence.
11. Respect the clean architecture layer rules: dependencies point inward, SQL stays in infrastructure, route files stay thin.
12. Do not add empty layers, placeholder interfaces, or state/DI frameworks without a current need.
13. Do not install Supabase, MongoDB, or any cloud, synchronization, backend, or authentication dependency; they are excluded. Do not install OpenCV or Drizzle without an explicit decision recorded here.
14. Do not edit a migration that has run on a device. Append a new one.
15. Do not add Subjects, Classes, or Settings to the bottom navigation.
16. Do not edit `docs/` while it is frozen.
17. Clearly distinguish Implemented, Planned, and Optional/Future features.
