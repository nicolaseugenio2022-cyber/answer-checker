# Answer Checker

Offline-first mobile app for Teachers to check shaded multiple-choice answer sheets with the phone camera. Built with React Native, Expo, and TypeScript.

**Status:** foundation only. The app shell, design system, home screen, and on-device SQLite bootstrap exist. Scanning, OMR, exams, results, and synchronization are not built yet. See [docs/project.md](docs/project.md#current-implementation-status).

## Get started

```bash
npm install
npx expo start
```

SQLite and the planned camera and OpenCV modules need native code, so use a development build or an emulator rather than a browser for real testing. Web is supported only as a build-verification target and opens no database.

## Checks

```bash
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
- [docs/api-routes.md](docs/api-routes.md) — network routes (none exist)
- [docs/diagrams.md](docs/diagrams.md) — architecture and flow diagrams

## Adding UI components

```bash
npx @react-native-reusables/cli@latest add <component>
```

Components are placed in `src/core/presentation/components/ui`. Do not import browser-only `shadcn/ui` components.
