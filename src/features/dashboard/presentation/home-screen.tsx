import { useRouter, type Href } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import BookOpen from 'lucide-react-native/icons/book-open';
import ClipboardCheck from 'lucide-react-native/icons/clipboard-check';
import FilePlus from 'lucide-react-native/icons/file-plus';
import FileText from 'lucide-react-native/icons/file-text';
import Info from 'lucide-react-native/icons/info';
import ScanLine from 'lucide-react-native/icons/scan-line';
import ScanSearch from 'lucide-react-native/icons/scan-search';
import Settings from 'lucide-react-native/icons/settings';
import UserPlus from 'lucide-react-native/icons/user-plus';
import Users from 'lucide-react-native/icons/users';
import { Pressable, View } from 'react-native';

import { GLASS_CLASSES } from '@/core/presentation/components/glass-surface';
import { Item, ItemGroup } from '@/core/presentation/components/item';
import { Screen } from '@/core/presentation/components/screen';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { cn } from '@/core/presentation/lib/utils';

import { useGreeting } from './greeting';

type Shortcut = { label: string; description?: string; icon: LucideIcon; href: Href };

const SHORTCUTS: readonly Shortcut[] = [
  { label: 'Create exam', icon: FilePlus, href: '/exams' },
  { label: 'Add student', icon: UserPlus, href: '/students' },
  { label: 'View results', icon: ClipboardCheck, href: '/results' },
  { label: 'Manage classes', icon: Users, href: '/classes' },
];

type ActivityRow = {
  title: string;
  emptyMessage: string;
  icon: LucideIcon;
  action: string;
  href: Href;
};

// No exams, scans, or results can exist yet: the database has no tables. These
// rows always show their empty state until those features store data.
const ACTIVITY: readonly ActivityRow[] = [
  {
    title: 'Needs review',
    emptyMessage: 'Nothing needs review.',
    icon: ScanSearch,
    action: 'Scan',
    href: '/scan',
  },
  {
    title: 'Recent exams',
    emptyMessage: 'No exams yet.',
    icon: FileText,
    action: 'Create',
    href: '/exams',
  },
  {
    title: 'Recent results',
    emptyMessage: 'No saved results.',
    icon: ClipboardCheck,
    action: 'Open',
    href: '/results',
  },
];

const MORE: readonly Shortcut[] = [
  {
    label: 'Classes',
    description: 'Student groups, such as Grade 11 STEM-A or BSIT 1A',
    icon: Users,
    href: '/classes',
  },
  {
    label: 'Subjects',
    description: 'What you teach, such as Mathematics or Data Structures',
    icon: BookOpen,
    href: '/subjects',
  },
  { label: 'Settings', description: 'Theme and your data', icon: Settings, href: '/settings' },
];

const FOCUS_RING = 'web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring';

// Extends a 44dp-high control's touch area to 48dp without changing its size.
const TOUCH_SLOP = { top: 2, bottom: 2 };

function SectionHeading({ children }: { children: string }) {
  return (
    <View className="flex-row items-center gap-2">
      <View className="h-4 w-1 rounded-full bg-primary" />
      <Text variant="h4" aria-level="2" className="text-base">
        {children}
      </Text>
    </View>
  );
}

function SettingsButton({ onPress }: { onPress: () => void }) {
  const { isPressed, pressHandlers } = usePressFeedback();

  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      accessibilityRole="button"
      accessibilityLabel="Settings"
      className={cn(
        'h-12 w-12 items-center justify-center rounded-md',
        GLASS_CLASSES,
        isPressed && 'bg-secondary',
        FOCUS_RING
      )}>
      <Icon as={Settings} size={20} />
    </Pressable>
  );
}

function ScanAction({ onPress }: { onPress: () => void }) {
  const { isPressed, pressHandlers } = usePressFeedback();

  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      hitSlop={TOUCH_SLOP}
      accessibilityRole="button"
      accessibilityLabel="Scan answer sheet"
      className={cn(
        'h-11 flex-row items-center justify-center gap-2 rounded-md bg-primary',
        isPressed && 'opacity-80',
        FOCUS_RING
      )}>
      <Icon as={ScanLine} size={18} className="text-primary-foreground" />
      <Text className="text-sm font-semibold text-primary-foreground">Scan answer sheet</Text>
    </Pressable>
  );
}

function ShortcutTile({ shortcut, onPress }: { shortcut: Shortcut; onPress: () => void }) {
  const { isPressed, pressHandlers } = usePressFeedback();

  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      accessibilityRole="button"
      accessibilityLabel={shortcut.label}
      className={cn(
        'min-h-[52px] min-w-[45%] flex-1 flex-row items-center gap-2.5 rounded-lg p-2',
        GLASS_CLASSES,
        isPressed && 'bg-secondary',
        FOCUS_RING
      )}>
      <View className="h-9 w-9 items-center justify-center rounded-md bg-accent">
        <Icon as={shortcut.icon} size={18} className="text-accent-foreground" />
      </View>
      <Text className="flex-1 text-sm font-medium">{shortcut.label}</Text>
    </Pressable>
  );
}

export function HomeScreen() {
  const router = useRouter();
  const greeting = useGreeting();

  return (
    <Screen>
      <View className="flex-row items-center gap-3">
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-center gap-2">
            <View className="flex-row gap-1">
              <View className="h-2 w-2 rounded-full border border-muted-foreground" />
              <View className="h-2 w-2 rounded-full bg-primary" />
              <View className="h-2 w-2 rounded-full border border-muted-foreground" />
            </View>
            <Text className="text-sm font-medium text-muted-foreground">Answer Checker</Text>
          </View>
          <Text variant="h3" aria-level="1" className="leading-8">
            {greeting}
          </Text>
        </View>
        <SettingsButton onPress={() => router.navigate('/settings')} />
      </View>

      <View className="gap-2.5">
        <SectionHeading>Quick actions</SectionHeading>
        <ScanAction onPress={() => router.navigate('/scan')} />
        <View className="flex-row flex-wrap gap-2">
          {SHORTCUTS.map((shortcut) => (
            <ShortcutTile
              key={shortcut.label}
              shortcut={shortcut}
              onPress={() => router.navigate(shortcut.href)}
            />
          ))}
        </View>
        <View className="flex-row items-start gap-2 rounded-md bg-muted px-3 py-2">
          {/* 14dp icon on an 18dp first line: 2dp down centers it on that line. */}
          <Icon as={Info} size={14} className="mt-0.5 text-muted-foreground" />
          <Text className="flex-1 text-[13px] leading-[18px] text-muted-foreground">
            Scanning, exams, students, and results are not built yet. Each screen explains what it
            will do.
          </Text>
        </View>
      </View>

      <View className="gap-2.5">
        <SectionHeading>Activity</SectionHeading>
        <ItemGroup className={GLASS_CLASSES}>
          {ACTIVITY.map((row) => (
            <Item
              key={row.title}
              title={row.title}
              description={row.emptyMessage}
              icon={row.icon}
              actionLabel={row.action}
              onPress={() => router.navigate(row.href)}
            />
          ))}
        </ItemGroup>
      </View>

      <View className="gap-2.5">
        <SectionHeading>More</SectionHeading>
        <ItemGroup>
          {MORE.map((item) => (
            <Item
              key={item.label}
              title={item.label}
              description={item.description}
              icon={item.icon}
              onPress={() => router.navigate(item.href)}
            />
          ))}
        </ItemGroup>
      </View>
    </Screen>
  );
}
