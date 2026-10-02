import Moon from 'lucide-react-native/icons/moon';
import Sun from 'lucide-react-native/icons/sun';
import { useColorScheme } from 'nativewind';
import { useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';

import { Notice, type NoticeMessage } from '@/core/presentation/components/notice';
import { Screen } from '@/core/presentation/components/screen';
import { Button } from '@/core/presentation/components/ui/button';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { destinationTitle } from '@/core/presentation/navigation/destinations';
import { DemoDataSection } from '@/features/demo-data/presentation/demo-data-section';

function SectionHeading({ children }: { children: string }) {
  return (
    <Text variant="h4" aria-level="2" className="text-base">
      {children}
    </Text>
  );
}

export function SettingsScreen() {
  const { colorScheme, toggleColorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [notice, setNotice] = useState<NoticeMessage | null>(null);

  function announce(tone: NoticeMessage['tone'], text: string) {
    setNotice((previous) => ({ id: (previous?.id ?? 0) + 1, tone, text }));
    AccessibilityInfo.announceForAccessibility(text);
  }

  return (
    <Screen
      title={destinationTitle('settings')}
      showBack
      overlay={
        notice && <Notice key={notice.id} notice={notice} onDismiss={() => setNotice(null)} />
      }>
      <View className="gap-3">
        <SectionHeading>Appearance</SectionHeading>
        <View className="gap-3 rounded-lg border border-border bg-card p-4">
          <Text className="text-sm text-muted-foreground">
            The app is using the {isDark ? 'dark' : 'light'} theme.
          </Text>
          <Button variant="outline" onPress={toggleColorScheme} className="h-12 self-start">
            <Icon as={isDark ? Sun : Moon} size={16} />
            <Text>{isDark ? 'Switch to light theme' : 'Switch to dark theme'}</Text>
          </Button>
        </View>
      </View>

      <View className="gap-3">
        <SectionHeading>Your data</SectionHeading>
        <View className="gap-2 rounded-lg border border-border bg-card p-4">
          <Text className="text-sm">
            Everything is stored only on this device. There is no account, online backup, or sync
            with other phones.
          </Text>
          <Text className="text-sm text-muted-foreground">
            Uninstalling the app or clearing its data removes everything.
          </Text>
        </View>
      </View>

      {/* Development builds only; renders nothing otherwise. */}
      <DemoDataSection onDone={announce} />
    </Screen>
  );
}
