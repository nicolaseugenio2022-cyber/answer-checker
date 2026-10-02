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
import { createClassUseCases } from '@/features/classes/application/class-use-cases';
import { createSqliteClassRepository } from '@/features/classes/infrastructure/sqlite-class-repository';
import { ClassUseCasesProvider } from '@/features/classes/presentation/class-use-cases-context';
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
  const useCases = useMemo(
    () =>
      db && {
        subjects: createSubjectUseCases({
          repository: createSqliteSubjectRepository(db),
          clock,
          idGenerator,
        }),
        classes: createClassUseCases({
          repository: createSqliteClassRepository(db),
          clock,
          idGenerator,
        }),
      },
    [db]
  );

  return (
    <SubjectUseCasesProvider value={useCases?.subjects ?? null}>
      <ClassUseCasesProvider value={useCases?.classes ?? null}>{children}</ClassUseCasesProvider>
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
