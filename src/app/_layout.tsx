import '@/global.css';

import { PortalHost } from '@rn-primitives/portal';
import { randomUUID } from 'expo-crypto';
import { ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { useMemo, type PropsWithChildren } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import type { Clock, IdGenerator } from '@/core/application/ports';
import {
  DatabaseProvider,
  useDatabaseIfAvailable,
} from '@/core/infrastructure/database/database-provider';
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
import { createStudentUseCases } from '@/features/students/application/student-use-cases';
import { expoRosterFileSystem } from '@/features/students/infrastructure/expo-roster-file-system';
import { createRosterFilePicker } from '@/features/students/infrastructure/roster-file-picker';
import { createSqliteStudentRepository } from '@/features/students/infrastructure/sqlite-student-repository';
import { StudentUseCasesProvider } from '@/features/students/presentation/student-use-cases-context';
import { createSubjectUseCases } from '@/features/subjects/application/subject-use-cases';
import { createSqliteSubjectRepository } from '@/features/subjects/infrastructure/sqlite-subject-repository';
import { SubjectUseCasesProvider } from '@/features/subjects/presentation/subject-use-cases-context';

const clock: Clock = { now: () => new Date().toISOString() };
const idGenerator: IdGenerator = { newId: () => randomUUID() };

/**
 * Composition root for the features: builds each use case with its SQLite
 * repository and hands it to the screens. Where there is no database (the web
 * preview) the use cases are null and the screens say so.
 */
function UseCaseProviders({ children }: PropsWithChildren) {
  const db = useDatabaseIfAvailable();
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
                    {children}
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

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={NAV_THEME[scheme]}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <DatabaseProvider>
          {/* Web is only a preview of the phone app, so it is held to a phone-width column. */}
          <UseCaseProviders>
            <View className="flex-1 bg-muted">
              <View className="w-full flex-1 self-center bg-background web:max-w-[480px]">
                <AppTabs />
              </View>
            </View>
          </UseCaseProviders>
        </DatabaseProvider>
        <PortalHost />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
