# Source of Truth

Last reviewed: 2026-10-02

This document records the authoritative product and architecture decisions for the Offline Answer Sheet Scanner. Developers and AI coding agents must read it before changing the project.

> **Implementation status at time of writing:** the repository contains only an empty Git repository (no commits) and the `docs/` folder. No application code, configuration, or schema exists. Everything below is a **target decision**, not a description of working software. See [project.md](./project.md#current-implementation-status).

## Product Truth

- This is a **mobile application**.
- The primary and only current role is **Teacher**.
- Core functionality must work **offline**.
- The application scans **standardized shaded answer sheets** designed for this system.
- Answer recognition uses **deterministic OMR / computer vision**, not AI/LLM inference.
- The application must support **permanent deletion**.

## Role Truth

Current roles:

- Teacher

Do not create `Admin`, `Student`, `Super Admin`, `Staff`, or `Examiner` roles unless future requirements explicitly change the project.

Do not introduce RBAC. With a single role there is nothing to authorize between. If authentication is added, the authenticated account *is* the Teacher. Students are data records managed by the Teacher; they never sign in.

## Technology Truth

| Area | Target | Status |
| --- | --- | --- |
| Mobile | React Native, Expo, TypeScript | Planned |
| UI | React Native Reusables, NativeWind, shadcn New York style | Planned |
| Camera | Expo Camera, or a compatible React Native camera library | Planned |
| OMR | OpenCV running on-device | Planned |
| Offline database | SQLite via `expo-sqlite` | Planned |
| Query/ORM layer | Drizzle ORM | Optional, not decided |
| Cloud | Supabase (PostgreSQL, Auth, Storage) | Optional/Future |

This is not a Next.js application and not a browser-first React application. No mandatory FastAPI, Python, or other server is part of the architecture.

## UI Truth

- The project's design language is **shadcn New York style**.
- Browser-only `shadcn/ui` is **not** the mobile runtime. Its components depend on the DOM and Radix web primitives and must not be imported into the React Native app.
- The mobile implementation uses React Native-compatible components: **React Native Reusables** styled with **NativeWind**.
- Visual rules: compact controls, clean typography, strong hierarchy, subtle borders, restrained border radius, dense but readable layouts, minimal visual noise, consistent spacing, accessible contrast, and mobile-friendly touch targets.

The correct short description of the UI stack is "React Native + Expo, React Native Reusables, NativeWind, shadcn New York visual style" — never "React + shadcn/ui".

## Architecture Truth

```text
React Native + Expo + TypeScript
  -> shadcn New York-style mobile UI (React Native Reusables + NativeWind)
  -> Camera
  -> On-device OpenCV OMR
  -> Application logic
  -> SQLite
  -> Optional sync queue
  -> Optional Supabase / PostgreSQL
```

- SQLite on the device is the primary database. Everyday reads and writes go to SQLite, never to the cloud first.
- OMR runs on the device. It must never depend on a remote API.
- The cloud is optional and secondary: backup, synchronization, and cross-device access only.

## Offline Truth

The following must work with no internet connection:

- Opening the app and selecting an exam
- Creating and editing students, classes, subjects, exams, and answer keys locally
- Opening the camera and scanning an answer sheet
- Running OMR and detecting answers
- Reviewing and correcting detections
- Comparing against the local answer key and calculating the score
- Saving and viewing results
- Permanently deleting local records

The scanning path must never be `Mobile -> Internet -> Server -> OpenCV -> Result`. It is `Mobile Camera -> On-device OMR -> Local application logic -> SQLite`.

## OMR Truth

- OMR is deterministic computer vision: detect sheet, detect alignment markers, correct perspective, grayscale, threshold, locate bubble regions, measure fill, determine answers, validate.
- Each question resolves to one of four states: `SELECTED`, `BLANK`, `MULTIPLE`, `UNCERTAIN`.
- Anything other than a confident `SELECTED` or `BLANK` must be surfaced to the Teacher for review before scoring is finalized. The Teacher's correction is authoritative.
- Only the project's own standardized answer sheet is supported. Arbitrary third-party sheets are out of scope.
- **No production thresholds are defined.** Fill thresholds must be calibrated against real sheets across pencils, pens, lighting conditions, cameras, and erasures before any value is documented as final.
- QR-based exam/template identification is Planned, not required.

## Data Truth

- Local SQLite is the system of record for the device.
- Record IDs are **stable, globally unique identifiers** (UUIDs or equivalent) generated on the device. Synchronization must never depend on local auto-increment IDs alone. The same ID identifies a record locally and in the cloud.
- The domain model in [diagrams.md](./diagrams.md#proposed-domain-model) is **proposed**. Once a real schema exists, the schema is the evidence of what is implemented.
- Do not add role or permission tables.

## Deletion Truth

- "Delete Permanently" means the local domain record is **physically removed** from SQLite.
- It is not `isDeleted = true`. It is not `status = archived`. A soft-delete column must not be used to implement this feature. An archive feature, if ever added, is a separate feature.
- Dependent data is removed with the parent where the relationship makes sense and is documented (for example, a result's student answers, scan metadata, and local scan image).
- Deletion requires explicit confirmation that states the action cannot be undone.
- The deleted domain record must not be kept locally for the sake of synchronization. Only a minimal sync instruction (operation, entity type, entity ID) may remain temporarily.

## Synchronization Truth

Synchronization is Optional/Future. When it exists:

- Local changes are recorded in a persistent outbox (sync queue) as `CREATE`, `UPDATE`, or `DELETE` operations.
- Local pending operations must never be overwritten blindly by stale cloud data.
- **Deleted records must not be resurrected.** A pull must not re-insert a record that has a pending local `DELETE`, and the cloud must not accept a stale write for a record that was deleted.
- Operations are idempotent and safe to retry. A remote `DELETE` of an already-missing record counts as success.
- Sync failure must never block or degrade offline use.

## Security Truth

- Student information and scanned sheets are personal data stored on the device.
- Scan images should not be retained longer than necessary.
- Secrets must never be committed to source code. The mobile client may contain only client-safe public configuration (for example, a Supabase URL and anon key protected by row-level security). Service-role keys never ship in the app.
- Session tokens and credentials belong in secure device storage, not plain SQLite or plain key-value storage.
- No encryption, authentication, or access control is implemented today. Do not claim otherwise.

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

## Rules for AI Coding Agents

1. Inspect before editing.
2. Do not invent implementation. Do not describe a feature as working unless the code proves it.
3. Do not introduce new roles without explicit requirements.
4. Do not turn the project into Next.js or any browser-first application.
5. Do not use browser-only shadcn components in the React Native runtime.
6. Do not introduce mandatory internet dependencies.
7. Do not replace permanent deletion with soft deletion.
8. Do not move OMR processing to a required remote API.
9. Do not use AI/LLM inference as the answer-recognition mechanism.
10. Do not hard-code OMR thresholds as final without calibration evidence.
11. Update documentation when contracts change.
12. Clearly distinguish Implemented, Planned, and Optional/Future features.
