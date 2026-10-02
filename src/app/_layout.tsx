import '@/global.css';

import { PortalHost } from '@rn-primitives/portal';
import { randomUUID } from 'expo-crypto';
import { ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { colorScheme as appColorScheme, useColorScheme } from 'nativewind';
import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import type { Clock, IdGenerator } from '@/core/application/ports';
import {
  DatabaseProvider,
  useDatabaseIfAvailable,
  type DatabaseStage,
} from '@/core/infrastructure/database/database-provider';
import { StartupErrorBoundary } from '@/core/presentation/components/startup-error-boundary';
import { StartupStalled } from '@/core/presentation/components/startup-stalled';
import { hasStartupMark, markStartup } from '@/core/presentation/lib/startup-marks';
import { NAV_THEME } from '@/core/presentation/lib/theme';
import { AppTabs } from '@/core/presentation/navigation/app-tabs';
import { createAnswerKeyUseCases } from '@/features/answer-keys/application/answer-key-use-cases';
import { createSqliteAnswerKeyRepository } from '@/features/answer-keys/infrastructure/sqlite-answer-key-repository';
import { AnswerKeyUseCasesProvider } from '@/features/answer-keys/presentation/answer-key-use-cases-context';
import { createClassSubjectUseCases } from '@/features/class-subjects/application/class-subject-use-cases';
import { createSqliteClassSubjectRepository } from '@/features/class-subjects/infrastructure/sqlite-class-subject-repository';
import { ClassSubjectUseCasesProvider } from '@/features/class-subjects/presentation/class-subject-use-cases-context';
import { createClassUseCases } from '@/features/classes/application/class-use-cases';
import { createSqliteClassRepository } from '@/features/classes/infrastructure/sqlite-class-repository';
import { ClassUseCasesProvider } from '@/features/classes/presentation/class-use-cases-context';
import { createDashboardUseCases } from '@/features/dashboard/application/dashboard-use-cases';
import { createSqliteDashboardRepository } from '@/features/dashboard/infrastructure/sqlite-dashboard-repository';
import { DashboardUseCasesProvider } from '@/features/dashboard/presentation/dashboard-use-cases-context';
import { createDemoDataUseCases } from '@/features/demo-data/application/demo-data-use-cases';
import { createSqliteDemoDataRepository } from '@/features/demo-data/infrastructure/sqlite-demo-data-repository';
import { DemoDataUseCasesProvider } from '@/features/demo-data/presentation/demo-data-use-cases-context';
import { createResultsUseCases } from '@/features/results/application/results-use-cases';
import { expoResultFileSystem } from '@/features/results/infrastructure/expo-result-file-system';
import { createResultImageStore } from '@/features/results/infrastructure/result-image-store';
import { createSqliteResultsRepository } from '@/features/results/infrastructure/sqlite-results-repository';
import { ResultsUseCasesProvider } from '@/features/results/presentation/results-use-cases-context';
import { createScanUseCases } from '@/features/scan/application/scan-use-cases';
import { expoPrintableSheet } from '@/features/scan/infrastructure/expo-printable-sheet';
import { expoScanFileSystem } from '@/features/scan/infrastructure/expo-scan-file-system';
import { createScanImageStore } from '@/features/scan/infrastructure/scan-image-store';
import { createSqliteResultRepository } from '@/features/scan/infrastructure/sqlite-result-repository';
import { typescriptSheetReader } from '@/features/scan/infrastructure/typescript-sheet-reader';
import { ScanUseCasesProvider } from '@/features/scan/presentation/scan-use-cases-context';
import { createSettingsUseCases } from '@/features/settings/application/settings-use-cases';
import { createAppFiles } from '@/features/settings/infrastructure/app-files';
import { expoAppFileSystem } from '@/features/settings/infrastructure/expo-app-file-system';
import { createSqliteAcademicDataRepository } from '@/features/settings/infrastructure/sqlite-academic-data-repository';
import { createSqlitePreferenceStore } from '@/features/settings/infrastructure/sqlite-preference-store';
import {
  PreferencesProvider,
  usePreferences,
} from '@/features/settings/presentation/preferences-context';
import { SettingsUseCasesProvider } from '@/features/settings/presentation/settings-use-cases-context';
import { createStudentUseCases } from '@/features/students/application/student-use-cases';
import { expoRosterFileSystem } from '@/features/students/infrastructure/expo-roster-file-system';
import { createRosterFilePicker } from '@/features/students/infrastructure/roster-file-picker';
import { createSqliteStudentRepository } from '@/features/students/infrastructure/sqlite-student-repository';
import { StudentUseCasesProvider } from '@/features/students/presentation/student-use-cases-context';
import { createSubjectUseCases } from '@/features/subjects/application/subject-use-cases';
import { createSqliteSubjectRepository } from '@/features/subjects/infrastructure/sqlite-subject-repository';
import { SubjectUseCasesProvider } from '@/features/subjects/presentation/subject-use-cases-context';

// ---------------------------------------------------------------------------
// Start-up
//
// The native splash screen (the app's icon on the light or dark background set
// in app.json) stays up from the moment the app opens until the database is
// migrated, the providers exist, the first screen is mounted, and the stored
// theme is applied. Three things take it down, whichever comes first:
//
// 1. SplashGate, when the start has finished: the normal case.
// 2. The start-up error message, when the start failed.
// 3. The stall timer, when the start neither finished nor failed in time.
//
// And as a last resort a plain timer hides it whatever React is doing, so the
// splash screen can never stay up forever.
// ---------------------------------------------------------------------------

/** After this long without a first screen, the "taking long to start" screen is shown. */
const STALL_AFTER_MS = 12_000;
/** After this long the splash screen is hidden no matter what. */
const SPLASH_LAST_RESORT_MS = 20_000;

const FIRST_SCREEN = 'First screen mounted';

markStartup('JavaScript started');
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

let isSplashHidden = false;
let lastResort: ReturnType<typeof setTimeout> | null = null;

/** Hides the splash screen. Safe to call more than once and where there is none. */
function hideSplash(reason: string) {
  if (isSplashHidden) return;
  isSplashHidden = true;
  if (lastResort !== null) clearTimeout(lastResort);
  markStartup(`Splash screen hidden: ${reason}`);
  try {
    SplashScreen.hide();
  } catch {
    // No splash screen on this platform, or already hidden.
  }
}

// Not on web: there is no native splash screen there, and a pending timer
// would keep the static export from finishing.
if (Platform.OS !== 'web') {
  lastResort = setTimeout(() => hideSplash('last-resort timer'), SPLASH_LAST_RESORT_MS);
}

/**
 * Rendered inside every provider. By the time it mounts, the database has
 * been opened and migrated and the use cases exist. Once the stored
 * preferences have been read it applies the stored theme, lets one frame be
 * drawn in it, and then lets the splash screen go.
 *
 * The theme is applied here and not while the database is being prepared:
 * setting it asks the operating system to change the app's night mode, which
 * re-renders the whole tree and, on Android, can restart the screen. Doing
 * that in the middle of the database's initialization is what once made the
 * start hang.
 */
function SplashGate({ children, onReady }: PropsWithChildren<{ onReady: () => void }>) {
  const { appearance, isLoaded } = usePreferences();
  // Once per mount, whatever re-renders: applying the theme re-renders the tree.
  const hasRun = useRef(false);

  useEffect(() => {
    markStartup(FIRST_SCREEN);
  }, []);

  useEffect(() => {
    if (!isLoaded || hasRun.current) return;
    hasRun.current = true;
    markStartup('Preferences read');
    try {
      // "system" is what the app already does; only a fixed choice needs applying.
      if (appearance !== 'system') appColorScheme.set(appearance);
      markStartup('Theme applied');
    } catch (error) {
      console.error(error);
    } finally {
      onReady();
      // One frame later, so the first screen is drawn, in the right theme, before it is uncovered.
      requestAnimationFrame(() => hideSplash('start finished'));
    }
  }, [isLoaded, appearance, onReady]);

  return children;
}

/** Defined once, outside every component: the database provider must not see a new function per render. */
function reportDatabaseStage(stage: DatabaseStage, ms?: number) {
  if (stage === 'opened') markStartup('Database opened');
  else if (stage === 'migrated') markStartup('Database migrated', ms);
  else markStartup('Database failed', ms);
}

const clock: Clock = { now: () => new Date().toISOString() };
const idGenerator: IdGenerator = { newId: () => randomUUID() };

/**
 * Composition root for the features: builds each use case with its SQLite
 * repository and hands it to the screens. Where there is no database (the web
 * preview) the use cases are null and the screens say so.
 */
function UseCaseProviders({ children }: PropsWithChildren) {
  const db = useDatabaseIfAvailable();
  useEffect(() => {
    markStartup('Providers ready');
  }, []);
  const useCases = useMemo(() => {
    if (!db) return null;
    const classRepository = createSqliteClassRepository(db);
    const subjectRepository = createSqliteSubjectRepository(db);
    const answerKeyRepository = createSqliteAnswerKeyRepository(db);
    const classSubjectRepository = createSqliteClassSubjectRepository(db);
    const studentRepository = createSqliteStudentRepository(db);
    return {
        scan: createScanUseCases({
          subjects: subjectRepository,
          answerKeys: answerKeyRepository,
          classSubjects: classSubjectRepository,
          students: studentRepository,
          results: createSqliteResultRepository(db),
          reader: typescriptSheetReader,
          images: createScanImageStore({ fileSystem: expoScanFileSystem, newName: randomUUID }),
          printableSheet: expoPrintableSheet,
          clock,
          idGenerator,
        }),
        dashboard: createDashboardUseCases({ repository: createSqliteDashboardRepository(db) }),
        settings: createSettingsUseCases({
          preferences: createSqlitePreferenceStore(db),
          academicData: createSqliteAcademicDataRepository(db),
          files: createAppFiles(expoAppFileSystem),
        }),
        demoData: createDemoDataUseCases({
          repository: createSqliteDemoDataRepository(db),
          clock,
        }),
        results: createResultsUseCases({
          repository: createSqliteResultsRepository(db),
          images: createResultImageStore(expoResultFileSystem),
        }),
        subjects: createSubjectUseCases({
          repository: createSqliteSubjectRepository(db),
          clock,
          idGenerator,
        }),
        classes: createClassUseCases({ repository: classRepository, clock, idGenerator }),
        answerKeys: createAnswerKeyUseCases({
          repository: createSqliteAnswerKeyRepository(db),
          clock,
          idGenerator,
        }),
        students: createStudentUseCases({
          repository: createSqliteStudentRepository(db),
          classRepository,
          rosterFilePicker: createRosterFilePicker(expoRosterFileSystem),
          clock,
          idGenerator,
        }),
        classSubjects: createClassSubjectUseCases({
          repository: createSqliteClassSubjectRepository(db),
          clock,
        }),
    };
  }, [db]);

  return (
    <SubjectUseCasesProvider value={useCases?.subjects ?? null}>
      <ClassUseCasesProvider value={useCases?.classes ?? null}>
        <ClassSubjectUseCasesProvider value={useCases?.classSubjects ?? null}>
          <StudentUseCasesProvider value={useCases?.students ?? null}>
            <AnswerKeyUseCasesProvider value={useCases?.answerKeys ?? null}>
              <ScanUseCasesProvider value={useCases?.scan ?? null}>
                <ResultsUseCasesProvider value={useCases?.results ?? null}>
                  <DemoDataUseCasesProvider value={useCases?.demoData ?? null}>
                    <DashboardUseCasesProvider value={useCases?.dashboard ?? null}>
                      <SettingsUseCasesProvider value={useCases?.settings ?? null}>
                        <PreferencesProvider settings={useCases?.settings ?? null}>
                          {children}
                        </PreferencesProvider>
                      </SettingsUseCasesProvider>
                    </DashboardUseCasesProvider>
                  </DemoDataUseCasesProvider>
                </ResultsUseCasesProvider>
              </ScanUseCasesProvider>
            </AnswerKeyUseCasesProvider>
          </StudentUseCasesProvider>
        </ClassSubjectUseCasesProvider>
      </ClassUseCasesProvider>
    </SubjectUseCasesProvider>
  );
}

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  // "stalled" means the start has neither finished nor failed after a generous wait.
  const [startup, setStartup] = useState<'starting' | 'stalled' | 'ready'>('starting');
  // A new attempt mounts everything below the error boundary from scratch.
  const [attempt, setAttempt] = useState(0);

  const markReady = useCallback(() => setStartup('ready'), []);

  useEffect(() => {
    markStartup('Root layout mounted');
  }, []);

  useEffect(() => {
    if (startup !== 'starting') return;
    const timer = setTimeout(() => {
      if (hasStartupMark(FIRST_SCREEN)) return;
      markStartup('Start-up stalled');
      // The splash screen must not hide the explanation.
      hideSplash('start-up stalled');
      setStartup('stalled');
    }, STALL_AFTER_MS);
    return () => clearTimeout(timer);
  }, [startup, attempt]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={NAV_THEME[scheme]}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        {/* A database that cannot be opened is explained, not shown as a blank screen. */}
        <StartupErrorBoundary
          key={attempt}
          onFailure={() => {
            markStartup('Start-up failed');
            hideSplash('start-up failed');
          }}>
          <DatabaseProvider onStage={reportDatabaseStage}>
            {/* Web is only a preview of the phone app, so it is held to a phone-width column. */}
            <UseCaseProviders>
              <View className="flex-1 bg-muted">
                <View className="w-full flex-1 self-center bg-background web:max-w-[480px]">
                  <SplashGate onReady={markReady}>
                    <AppTabs />
                  </SplashGate>
                </View>
              </View>
            </UseCaseProviders>
          </DatabaseProvider>
        </StartupErrorBoundary>
        {startup === 'stalled' && (
          <StartupStalled
            onRetry={() => {
              markStartup('Start-up retried');
              setStartup('starting');
              setAttempt((current) => current + 1);
            }}
          />
        )}
        <PortalHost />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
