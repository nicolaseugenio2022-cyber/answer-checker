import { Tabs } from 'expo-router';
import { useColorScheme } from 'nativewind';

import { THEME } from '@/core/presentation/lib/theme';

import { BottomTabBar } from './bottom-tab-bar';
import { SECONDARY_DESTINATIONS, TAB_DESTINATIONS } from './destinations';

/**
 * The app's navigation shell: five bottom tabs, plus secondary screens that keep
 * the tab bar visible. Every route is a tab screen, so each one is reachable by
 * deep link and by the Android back button. The navigator draws no header:
 * each screen renders the shared compact ScreenHeader (Home draws its own).
 */
export function AppTabs() {
  const { colorScheme } = useColorScheme();
  const colors = THEME[colorScheme === 'dark' ? 'dark' : 'light'];

  return (
    <Tabs
      backBehavior="history"
      tabBar={(props) => <BottomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        // Scenes must be opaque: inactive tabs stay mounted underneath the active one.
        sceneStyle: { backgroundColor: colors.background },
      }}>
      {[...TAB_DESTINATIONS, ...SECONDARY_DESTINATIONS].map((destination) => (
        <Tabs.Screen
          key={destination.route}
          name={destination.route}
          options={{ title: destination.title }}
        />
      ))}
    </Tabs>
  );
}
