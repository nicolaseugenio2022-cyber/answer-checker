import '@/global.css';

import { PortalHost } from '@rn-primitives/portal';
import { ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DatabaseProvider } from '@/core/infrastructure/database/database-provider';
import { NAV_THEME } from '@/core/presentation/lib/theme';
import { AppTabs } from '@/core/presentation/navigation/app-tabs';

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={NAV_THEME[scheme]}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <DatabaseProvider>
          {/* Web is only a preview of the phone app, so it is held to a phone-width column. */}
          <View className="flex-1 bg-muted">
            <View className="w-full flex-1 self-center bg-background web:max-w-[480px]">
              <AppTabs />
            </View>
          </View>
        </DatabaseProvider>
        <PortalHost />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
