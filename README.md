# Answer Checker

Offline-only mobile app for Teachers to check shaded multiple-choice answer sheets with the phone camera. Built with React Native, Expo, and TypeScript.

Everything runs on the phone. Data is kept in a local SQLite database stored on the Teacher's device. There is no backend, no cloud database, no account, and no synchronization, so the app never needs the internet. Data is not shared between phones, and uninstalling the app or clearing its data removes it.

**Status:** the Teacher can manage Subjects and Classes and choose which Subjects are taught to each Class, all stored in the local SQLite database (schema version 2). Students, Answer Keys, scanning, OMR, and Results are not built yet; their screens are placeholders. See [docs/project.md](docs/project.md#current-implementation-status).

## Get started

```bash
npm install
npx expo start
```

SQLite and the planned camera and OpenCV modules need native code, so use a phone or an emulator rather than a browser for real testing. Web is only a preview of the phone UI: it opens no database and stores nothing.

## Checks

```bash
npm run test:db
npx expo-doctor@latest
npx tsc --noEmit
npm run lint
npx @react-native-reusables/cli@latest doctor --summary -y
```

## Documentation

Read [docs/source-of-truth.md](docs/source-of-truth.md) before changing architecture.

- [docs/source-of-truth.md](docs/source-of-truth.md) — authoritative product and architecture decisions
- [docs/project.md](docs/project.md) — overview, stack, and implementation status
- [docs/api.md](docs/api.md) — in-app contracts
- [docs/api-routes.md](docs/api-routes.md) — network routes (there are none, by design)
- [docs/diagrams.md](docs/diagrams.md) — architecture and flow diagrams

`docs/` is frozen: it changes only in an explicitly authorized documentation pass.

## Adding UI components

```bash
npx @react-native-reusables/cli@latest add <component>
```

Components are placed in `src/core/presentation/components/ui`. Do not import browser-only `shadcn/ui` components.
