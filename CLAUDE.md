# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Answer Checker: an offline-only mobile app (React Native, Expo, TypeScript, Expo Router) for a Teacher to check shaded multiple-choice answer sheets with the phone camera using on-device OMR.

What exists: design system, bottom-tab navigation shell, a Home dashboard of shortcuts and empty states, a Settings screen with a theme switch, a local SQLite database whose first migration creates the schema, and the first two working features: Subjects and Classes (view, add, rename, delete permanently). Exams, Scan, Students, and Results are still placeholder screens.

Phone-only product, Android first. No desktop or tablet layout, no sidebar, no drawer, no hover-dependent behavior. Web is only a preview of the phone UI (held to a 480-point column in the root layout); a physical Android device is the authority when they differ. Camera, OMR, students, exams, and results are not built. `docs/` is frozen and predates Subjects and Classes, so where it says they are placeholders or that no domain code exists, this file and the code are current.

## Read before changing architecture

`docs/source-of-truth.md` is the authority for product and architecture decisions. Precedence when docs disagree: `source-of-truth.md` > `project.md` > `api.md` > `api-routes.md` > `diagrams.md`. Code and schema are the evidence of what is implemented. If code and docs disagree, report the discrepancy; do not silently change either side.

Decisions that must not be broken:

- One role only: Teacher. No Admin/Student roles, no RBAC, no student login.
- Offline-only. The local SQLite database (`expo-sqlite`) on the Teacher's device is the only application database. No feature may use the network: no backend, no API, no cloud database, no accounts.
- Supabase, MongoDB, PostgreSQL, cloud synchronization, outbox or sync tables, and authentication are excluded from the architecture. Do not install, configure, or design for them. Reconsidering needs an explicit requirement change recorded in `docs/source-of-truth.md` first.
- OMR is deterministic OpenCV running on-device. Never a remote scan/score API, never AI/LLM recognition. No OMR thresholds are final until calibrated on real sheets.
- "Delete Permanently" is a physical row delete, with dependents in the same transaction and local files removed after commit. Never a soft-delete flag, archive status, or tombstone.
- Record IDs are device-generated UUIDs, not auto-increment integers.
- Not a Next.js or browser-first app. Do not import browser-only `shadcn/ui` or Radix web components.
- Do not install OpenCV or Drizzle without a decision recorded in `docs/source-of-truth.md`. Drizzle is still undecided.
- `docs/` is frozen. Do not create, edit, rename, or delete anything in it, by any means (editor tools, shell commands, or scripts), unless the user explicitly asks to change the docs. `.claude/settings.json` denies Edit and Write there. If code and docs drift apart, say so in your report instead of editing the docs; record new conventions in this file.

## Commands

```bash
npx expo start                 # dev server (use a development build or emulator; see below)
npx tsc --noEmit               # typecheck
npm run lint                   # ESLint via expo lint
npx expo-doctor@latest         # Expo project health
npx @react-native-reusables/cli@latest doctor --summary -y   # design-system setup check
npx expo export --platform android --output-dir .expo/verify-android   # bundle check without a device (includes SQLite code)
npx expo export --platform web --output-dir .expo/verify-web           # bundle check, web
npx @react-native-reusables/cli@latest add <component>       # add a UI component
npx expo install <package>     # add an Expo-compatible dependency version
```

`npm run test:db` runs every `tests/database/*.test.mjs` file with Node's built-in test runner and `node:sqlite`: the schema tests and the Subjects and Classes use-case and repository tests. There is no other test runner and no UI tests.

Do not run `npm audit fix --force`: the current moderate findings come from `uuid` via `xcode` inside Expo build tooling, and the forced fix is breaking.

Do not create `android/` or `ios/` folders; the project is managed Expo (CNG).

## Architecture

Feature-oriented clean architecture. Full rules: `docs/source-of-truth.md#clean-architecture-layers`.

```text
src/app/                      Expo Router routes + composition root
src/core/<layer>/             shared cross-cutting code
src/features/<feature>/<layer>/
```

Layers and allowed imports:

- `domain` — entities and pure rules. Imports nothing outside domain (no React, React Native, Expo, SQLite).
- `application` — use cases and the ports they need. Imports domain.
- `infrastructure` — port implementations, all local (SQLite, local files, later camera and OpenCV). Imports application and domain. All SQL lives here.
- `presentation` — screens, components, hooks. Imports application and domain.
- `src/app` — route files stay thin (re-export or render a presentation screen). `src/app/_layout.tsx` is the composition root and the only place that wires infrastructure into the UI.

Create a layer folder only when it has real code. No empty folders, placeholder interfaces, or ports without a use case. No MobX, Inversify, or other state/DI framework; use plain TypeScript composition. Expo Router is the navigation system.

Subjects and Classes have all four layers and are the pattern to copy for the next feature:

- `domain/` — the entity type and its limits (`Subject`, `SchoolClass`, name maximum 60 characters).
- `application/` — the repository contract with its typed in-use error, and `create<Feature>UseCases({ repository, clock, idGenerator })`.
- `infrastructure/` — `createSqlite<Feature>Repository(db)`: parameterized SQL, row mapping, every write inside `runInTransaction`.
- `presentation/` — the screen and a context that carries the use cases (null where there is no database).

Shared pieces: `core/domain/record-name.ts` (trim, length in characters, case-insensitive key), `core/application/errors.ts` (`InvalidNameError`, `DuplicateNameError`, `RecordNotFoundError`, `RecordInUseError`), `core/application/ports.ts` (`Clock`, `IdGenerator`). `UseCaseProviders` in `src/app/_layout.tsx` builds the use cases with `expo-crypto`'s `randomUUID` and the system clock.

Domain, application, and infrastructure files use relative imports, `import type` for types, and no constructor parameter properties, because the Node tests load them directly with type stripping (no `@/` alias there). Presentation files use `@/`.

Other features still have only a `presentation` folder.

### Navigation

- `AppTabs` (`src/core/presentation/navigation/`) is the shell, rendered by the root layout. It uses Expo Router's `Tabs` with a custom `BottomTabBar`; do not install `@react-navigation/*` packages (Expo Router bundles them).
- Every route is a screen of the `Tabs` navigator. Exactly five are drawn in the bar, in this order: Home, Exams, Scan, Students, Results (`TAB_DESTINATIONS`). Classes, Subjects, and Settings (`SECONDARY_DESTINATIONS`) have no slot, icon, or label in the bar; they open only from Home (the More list, the header Settings button, the Manage classes shortcut) and keep the bar visible. Do not link to them from anywhere else: `backBehavior="history"` returns to the previous screen, and both the header Back action and Android back must land on Home.
- While a secondary screen is open, Home is the selected tab (`HOME_ROUTE` in `BottomTabBar`), and pressing Home returns to it.
- A Subject is what the Teacher teaches (Mathematics, Data Structures). A Class is the whole student group in one name: grade or year, course or strand, and section (Grade 11 STEM-A, BSIT 1A). No separate course, strand, grade, or section fields. A student will belong to one class (`class_id`); an exam to one subject and one class. The feature is called Classes, never Courses or Sections.
- The navigator draws no header (`headerShown: false`). Every screen except Home passes `title` to `Screen`, which renders the shared compact `ScreenHeader` (56dp row, 24sp title, no divider); secondary screens add `showBack`. Take the title from `destinationTitle(route)`.
- Exactly one tab looks selected: only the selected route gets the raised indicator. Scan is styled like every other tab when it is not current. Do not give any tab a permanent filled plate.
- The raised indicator is rendered inside the active tab's own slot and centered by layout (`left: '50%'` plus a negative half-width margin). Do not position it with measured widths or a translation formula; that drifted from the icon column on a physical Android phone. It rises in with a short fade (no slide between tabs) and skips the animation under reduced motion.
- The indicator is three layers: an opaque disc in the bar's surface color that hides the capsule's border beneath it, the collar border clipped to the part above the capsule's edge, and the pink disc with the icon.
- Tab slots divide the capsule width left after `TAB_BAR_INNER_PADDING`, which keeps the Home and Results collars off the rounded corners. Change sizes only in `tab-bar-metrics.ts`; no per-tab offsets.
- The bar's container and every tab's touch target include the collar's rise (`TAB_BAR_HEIGHT` = capsule + rise) on purpose: Android does not deliver touches to a child that overflows its parent. The indicator is decorative (`pointerEvents="none"`, hidden from accessibility); the tab underneath owns the press and the selected state.
- Position `Animated.View` with `style`, not `className`: NativeWind classes are not applied to Reanimated components here.
- Do not use NativeWind `active:` or `group-active:` classes for press feedback on anything that navigates. On Android they stayed applied after navigation, so an inactive tab kept a gray plate. Use `usePressFeedback()` (`core/presentation/hooks`) and style from `isPressed`.
- Do not combine `contentContainerClassName` with `contentContainerStyle` on a ScrollView. On Android the class replaced the style and dropped the bottom clearance. Put spacing on a plain `View` inside the ScrollView, as `Screen` does.
- The capsule uses `boxShadow`, not Android `elevation`: elevation shows through a translucent surface and also changes draw order.
- To add a destination: add it to `destinations.ts`, add a one-line route file in `src/app`, add the screen under `src/features/<feature>/presentation`, and, if it is secondary, link it from the Home screen.
- Anything that depends on the clock or window size must render a stable value first on web (see `useGreeting`): pages are statically rendered, and a mismatch causes React hydration error #418.
- The custom tab bar does not hide when the keyboard opens. Text entry so far happens only in `ModalCard` dialogs, which cover the bar. Handle the bar when a text input is added to a screen body.
- List rows use `ItemGroup` / `Item` (`core/presentation/components/item.tsx`), a native take on shadcn Item: whole-row press targets with separators. Status tags use the Reusables `Badge`.
- Screens that manage a list of named records use `NameListScreen` (`core/presentation/components`): intro, Add button, loading / empty / failed / device-only states, rows with 48dp rename and delete buttons, `NameFormDialog`, `DeleteDialog`, and a `Notice`. A feature passes its words, its use cases as `operations`, and a `describeError` that turns typed errors into Teacher-facing text.
- Dialogs use `ModalCard` (React Native `Modal`): Android back cancels, a tap outside does nothing. Use `position="top"` for a dialog with a text field so the keyboard cannot cover it. Mount a dialog only while it is open.
- Never delete from a list action directly: open `DeleteDialog`, which names the record and says the deletion is permanent, with Cancel first.
- Brief feedback goes through `Notice`, the only notification component: a glass card with a pink border and check (success, closes after 3 seconds) or a destructive border and alert icon (error, 6 seconds), with a 48dp close button. Pass it to `Screen` as `overlay`, keyed by its id, so a new notice replaces the current one. It floats just above the tab bar and never shifts content. Do not use `ToastAndroid`, `Alert`, or an inverted `bg-foreground` surface for feedback. Announce the text once with `AccessibilityInfo.announceForAccessibility`; the notice is not a live region. Validation and blocked-deletion messages stay inside their dialogs.
- Check that a Lucide icon file exists under `node_modules/lucide-react-native/dist/esm/icons` before importing it; the typecheck does not catch a wrong icon path, only the bundle export does.
- The shadcn MCP is a design reference only. Never install its web registry items; add native components with the Reusables CLI.
- Screen bodies use `Screen` (`core/presentation/components/screen.tsx`), which also applies the status-bar inset. Unbuilt features use `PlannedFeature`: a compact glass intro panel, a secondary "Not built yet" badge, and a list of planned abilities; no controls and no sample data.
- Import Lucide icons per icon: `import Menu from 'lucide-react-native/icons/menu'`. The barrel import roughly doubles the bundle. Render them through the Reusables `Icon` component.

### Database

- `DatabaseProvider` (`src/core/infrastructure/database/`) wraps the app in the root layout. Native: opens `answer-checker.db` and runs `initializeDatabase` (WAL, `foreign_keys = ON`, verify it is on, migrate) before any screen renders. `database-provider.web.tsx` is a pass-through and `useDatabase()` throws there: web opens no database and persists nothing.
- Schema is defined only by appending to `MIGRATIONS` in `migrations.ts`, one file per migration under `migrations/`. Versions must be 1, 2, 3… in order; never edit or reorder a migration once a build containing it has been installed. Version is tracked in `PRAGMA user_version`; each migration commits atomically with its version bump.
- Migration 1 creates `subjects`, `classes`, `students`, `exams`, `exam_questions`, `answer_keys`, `exam_results`, `student_answers`, `scan_records`. STRICT tables, TEXT UUID ids, UTC `toISOString()` timestamps, INTEGER 0/1 booleans. No teacher/account table and no soft-delete or sync columns.
- Delete rules: CASCADE only inside an aggregate (exam to questions to answer keys; result to answers and scan record). RESTRICT elsewhere: a class with students or exams, a subject with exams, and a student or exam with results cannot be deleted. A use case that removes such a parent must delete its results explicitly in the same transaction, after reading their `scan_records.image_path` so the files can be removed after commit.
- For data writes use `runInTransaction(db, task)`, never expo-sqlite's `withExclusiveTransactionAsync`: that opens a second connection where foreign keys are off, so RESTRICT and CASCADE would not apply. Migrations do use it, deliberately.
- Database errors are `DatabaseError` (`code: 'DATABASE_ERROR'`) and its subclasses. No constructor parameter properties in files the tests load: Node's type stripping rejects them.
- `npm run test:db` runs the schema, migration, constraint, and transaction tests against Node's built-in SQLite with disposable temp databases (no test framework, no new dependency). It proves the SQL, not expo-sqlite on a device.
- Repositories take a `SqlConnection` (`sql-connection.ts`), the subset of expo-sqlite they use, so the same code runs on Node's SQLite in tests. Values go in the params array, never into the SQL text. Wrap each operation in `withTypedErrors` so only application errors and `DatabaseError` leave a repository; raw SQLite messages are never shown to the Teacher.
- Name uniqueness is checked in the repository inside the write transaction with `nameKey`, because the table's `COLLATE NOCASE` folds only ASCII letters; the UNIQUE constraint stays as the safeguard and maps to `DuplicateNameError`.
- Deleting a subject or class is blocked while dependents exist (exams; students or exams). The repository counts dependents and deletes in the same transaction and throws `SubjectInUseError` / `ClassInUseError` with the counts. Nothing cascades. `docs/api.md` still lists this as an open decision; blocking is what is implemented.
- `useDatabaseIfAvailable()` returns null on web. Screens then show a device-only state instead of pretending to save.
- SQL belongs in infrastructure only.

### UI

- Design language is shadcn New York style, implemented with React Native Reusables + NativeWind 4 (Tailwind 3). `components.json` aliases point into `src/core/presentation`; CLI-added components land in `src/core/presentation/components/ui`.
- Theme tokens live in `src/global.css` (HSL channels, `:root` and `.dark:root`) and are mirrored in `src/core/presentation/lib/theme.ts` for the navigation theme. Change both together; the Reusables doctor checks the mirror.
- Neutral base with pink as the identity color (primary actions, Scan tab, active tab, focus rings, icon plates, section accents). Dark mode is plum-tinted with stepped surfaces. Never hard-code colors; use tokens.
- Glass is selective: `GLASS_CLASSES` (`bg-glass/70` plus `border-glass-border/15`), no blur, never nested. Only `BottomTabBar` uses `expo-blur`, and `HAS_LIVE_BLUR` turns it off on Android (needs `BlurTargetView`, unverified on a device).
- The tab bar is a floating glass capsule: 16dp side margins, 12dp above the bottom safe-area inset, never inside the gesture area. It floats over the scene with a background scrim behind it. `Screen` pads the bottom with `tabBarClearance(insets.bottom)`; any scrolling screen that does not use `Screen` must do the same. Never use an arbitrary padding number.
- Scenes must stay opaque (`sceneStyle` background): inactive tabs remain mounted underneath, so a transparent scene shows the previous screen through it. The backdrop glow is therefore drawn inside `Screen`.
- Use the Reusables `Text` component, not React Native's, so text inherits button and theme classes.
- The default Reusables button is 40px high; use `size="lg"` (44px) for primary touch targets.
- Color scheme comes from NativeWind's `useColorScheme`, with `darkMode: 'class'`.
- Path alias: `@/*` maps to `src/*`.

### Verification limits

SQLite, and later camera and OpenCV, need native code, so real testing needs a development build or emulator, not Expo Go or a browser. When no device is available, run the typecheck, lint, both doctors, and the Android bundle export, and state plainly that nothing ran on a device.
