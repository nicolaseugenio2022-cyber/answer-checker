import { useFocusEffect, useRouter } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import BookOpen from 'lucide-react-native/icons/book-open';
import CalendarCheck from 'lucide-react-native/icons/calendar-check';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import ClipboardCheck from 'lucide-react-native/icons/clipboard-check';
import FileCheck from 'lucide-react-native/icons/file-check';
import FilePlus from 'lucide-react-native/icons/file-plus';
import GraduationCap from 'lucide-react-native/icons/graduation-cap';
import Play from 'lucide-react-native/icons/play';
import ScanLine from 'lucide-react-native/icons/scan-line';
import Settings from 'lucide-react-native/icons/settings';
import Smartphone from 'lucide-react-native/icons/smartphone';
import UserPlus from 'lucide-react-native/icons/user-plus';
import Users from 'lucide-react-native/icons/users';
import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Callout } from '@/core/presentation/components/callout';
import { GLASS_CLASSES } from '@/core/presentation/components/glass-surface';
import { Item, ItemGroup } from '@/core/presentation/components/item';
import { Screen } from '@/core/presentation/components/screen';
import {
  RefreshIndicator,
  Skeleton,
  SkeletonPulse,
  SkeletonRows,
} from '@/core/presentation/components/skeleton';
import { useLoadingPhase } from '@/core/presentation/hooks/use-loading-phase';
import type { LoadingPhase } from '@/core/presentation/lib/loading-gate';
import { Button } from '@/core/presentation/components/ui/button';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { countOf } from '@/core/presentation/lib/describe-name-error';
import { createLatestRequest } from '@/core/presentation/lib/latest-request';
import { cn } from '@/core/presentation/lib/utils';
import { requestIntent } from '@/core/presentation/navigation/screen-intent';
import type { Dashboard } from '@/features/dashboard/application/dashboard-use-cases';
import type { RecentAnswerKey, RecentResult } from '@/features/dashboard/domain/dashboard';
import { useDashboardUseCases } from '@/features/dashboard/presentation/dashboard-use-cases-context';
import {
  HOME_LINKS,
  openResultIntent,
  viewAnswerKeyIntent,
} from '@/features/dashboard/presentation/home-links';

import { usePreferences } from '@/features/settings/presentation/preferences-context';

import { useGreeting } from './greeting';

const FOCUS_RING = 'web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring';

/** "Oct 2, 10:42 AM" */
const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** "Oct 2" */
const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

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

/**
 * A bar the size of a value that is still being read. It keeps the value's
 * place from the first frame, so nothing shifts, and becomes visible only if
 * the reading takes longer than a moment.
 */
function ValueSkeleton({ phase, className }: { phase: LoadingPhase; className: string }) {
  return (
    <SkeletonPulse className={phase === 'skeleton' ? undefined : 'opacity-0'}>
      <Skeleton className={className} />
    </SkeletonPulse>
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

/** The one primary action of Home. */
function ScanAction({ onPress }: { onPress: () => void }) {
  const { isPressed, pressHandlers } = usePressFeedback();
  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      accessibilityRole="button"
      accessibilityLabel="Scan answer sheet"
      className={cn(
        'h-12 flex-row items-center justify-center gap-2 rounded-lg bg-primary',
        isPressed && 'opacity-80',
        FOCUS_RING
      )}>
      <Icon as={ScanLine} size={20} className="text-primary-foreground" />
      <Text className="text-[15px] font-semibold text-primary-foreground">Scan answer sheet</Text>
    </Pressable>
  );
}

type QuickActionProps = { label: string; icon: LucideIcon; onPress: () => void };

/** A secondary action: three share one row. */
function QuickAction({ label, icon, onPress }: QuickActionProps) {
  const { isPressed, pressHandlers } = usePressFeedback();
  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={cn(
        'min-h-[72px] flex-1 items-center justify-center gap-1.5 rounded-lg px-1.5 py-2',
        GLASS_CLASSES,
        isPressed && 'bg-secondary',
        FOCUS_RING
      )}>
      <Icon as={icon} size={20} className="text-primary" />
      <Text className="text-center text-[13px] font-medium leading-[18px]">{label}</Text>
    </Pressable>
  );
}

type CountCardProps = {
  /** Null while the first reading is on its way or when it could not be read. */
  value: number | null;
  /** The phase of the first reading; "content" once it is over. */
  phase: LoadingPhase;
  /** "student" */
  singular: string;
  /** "students", when it is not the singular plus "s". */
  plural?: string;
  /** "Students": the card's caption and the screen it opens. */
  label: string;
  icon: LucideIcon;
  onPress: () => void;
};

/** One count of the overview. The whole card opens the screen the records live on. */
function CountCard({ value, phase, singular, plural, label, icon, onPress }: CountCardProps) {
  const { isPressed, pressHandlers } = usePressFeedback();
  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      accessibilityRole="button"
      accessibilityLabel={
        value === null
          ? `${label}, open ${label}`
          : `${countOf(value, singular, plural)}, open ${label}`
      }
      className={cn(
        'min-h-16 min-w-[46%] flex-1 flex-row items-center gap-3 rounded-lg px-3 py-2',
        GLASS_CLASSES,
        isPressed && 'bg-secondary',
        FOCUS_RING
      )}>
      <View className="h-9 w-9 items-center justify-center rounded-md bg-accent">
        <Icon as={icon} size={18} className="text-accent-foreground" />
      </View>
      <View className="flex-1">
        {value !== null ? (
          <Text numberOfLines={1} adjustsFontSizeToFit className="text-xl font-semibold leading-7">
            {value.toLocaleString()}
          </Text>
        ) : phase !== 'content' ? (
          <ValueSkeleton phase={phase} className="my-1.5 h-4 w-10" />
        ) : (
          <Text className="text-xl font-semibold leading-7 text-muted-foreground">–</Text>
        )}
        <Text numberOfLines={1} className="text-[13px] leading-[18px] text-muted-foreground">
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

type RowProps = { isFirst: boolean; onPress: () => void };

function RecentResultRow({ result, isFirst, onPress }: RowProps & { result: RecentResult }) {
  const { isPressed, pressHandlers } = usePressFeedback();
  const attempt =
    result.attempt.count > 1 ? `Attempt ${result.attempt.number} of ${result.attempt.count}` : null;
  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      accessibilityRole="button"
      accessibilityLabel={[
        `${result.studentName}, Student ID ${result.studentNumber}`,
        result.answerKeyName,
        `Score ${result.score} of ${result.total}`,
        `Scanned ${formatWhen(result.capturedAt)}`,
        attempt,
        'Open result',
      ]
        .filter(Boolean)
        .join('. ')}
      className={cn(
        'min-h-14 flex-row items-center gap-3 px-3 py-2',
        !isFirst && 'border-t border-border',
        isPressed && 'bg-secondary',
        FOCUS_RING
      )}>
      <View className="flex-1 gap-0.5">
        <Text numberOfLines={1} className="text-sm font-semibold leading-5">
          {result.studentName}
        </Text>
        <Text numberOfLines={1} className="text-[13px] leading-[18px] text-muted-foreground">
          {result.studentNumber} · {result.answerKeyName}
        </Text>
        <Text numberOfLines={1} className="text-[13px] leading-[18px] text-muted-foreground">
          {formatWhen(result.capturedAt)}
          {attempt ? ` · ${attempt}` : ''}
        </Text>
      </View>
      <Text className="text-[15px] font-semibold leading-[22px]">
        {result.score} / {result.total}
      </Text>
      <Icon as={ChevronRight} size={16} className="text-muted-foreground" />
    </Pressable>
  );
}

function RecentKeyRow({ answerKey, isFirst, onPress }: RowProps & { answerKey: RecentAnswerKey }) {
  const { isPressed, pressHandlers } = usePressFeedback();
  const questions = countOf(answerKey.questionCount, 'question');
  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      accessibilityRole="button"
      accessibilityLabel={`${answerKey.name}. ${answerKey.subjectName}. ${questions}. Updated ${formatDay(answerKey.updatedAt)}. Open answer key`}
      className={cn(
        'min-h-14 flex-row items-center gap-3 px-3 py-2',
        !isFirst && 'border-t border-border',
        isPressed && 'bg-secondary',
        FOCUS_RING
      )}>
      <View className="flex-1 gap-0.5">
        <Text numberOfLines={1} className="text-sm font-semibold leading-5">
          {answerKey.name}
        </Text>
        <Text numberOfLines={1} className="text-[13px] leading-[18px] text-muted-foreground">
          {answerKey.subjectName} · {questions}
        </Text>
      </View>
      <Text className="text-[13px] leading-[18px] text-muted-foreground">
        {formatDay(answerKey.updatedAt)}
      </Text>
      <Icon as={ChevronRight} size={16} className="text-muted-foreground" />
    </Pressable>
  );
}

/** Rows of bars the size of the recent rows, while the first reading is on its way. */
function RecentSkeleton({ phase }: { phase: LoadingPhase }) {
  // The space is held from the first frame; the bars appear only after a moment.
  return (
    <View
      accessible={phase === 'skeleton'}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      aria-busy
      className={phase === 'skeleton' ? undefined : 'opacity-0'}>
      <SkeletonPulse>
        <SkeletonRows rows={2} hasTrailing />
      </SkeletonPulse>
    </View>
  );
}

type RecentSectionProps = {
  heading: string;
  /** Null while loading or when the list could not be read. */
  isEmpty: boolean | null;
  phase: LoadingPhase;
  emptyMessage: string;
  emptyAction: ReactNode;
  viewAllLabel: string;
  onViewAll: () => void;
  children: ReactNode;
};

/** A heading, up to three rows, and a way to the full list; or why there are none. */
function RecentSection({
  heading,
  isEmpty,
  phase,
  emptyMessage,
  emptyAction,
  viewAllLabel,
  onViewAll,
  children,
}: RecentSectionProps) {
  return (
    <View className="gap-2.5">
      <SectionHeading>{heading}</SectionHeading>
      {isEmpty === null ? (
        phase !== 'content' ? (
          <RecentSkeleton phase={phase} />
        ) : (
          <Text className="text-sm leading-5 text-muted-foreground">
            This list could not be read just now.
          </Text>
        )
      ) : isEmpty ? (
        <View className="gap-3 rounded-lg border border-border bg-card p-3">
          <Text className="text-sm leading-5 text-muted-foreground">{emptyMessage}</Text>
          {emptyAction}
        </View>
      ) : (
        <>
          <View className="overflow-hidden rounded-lg border border-border bg-card">{children}</View>
          <Button variant="ghost" className="h-12 self-start px-2" onPress={onViewAll}>
            <Text className="text-primary">{viewAllLabel}</Text>
            <Icon as={ChevronRight} size={16} className="text-primary" />
          </Button>
        </>
      )}
    </View>
  );
}

/**
 * Home: the way into every workflow, with a few real numbers and the most
 * recent activity read from the local database. It is read again each time
 * Home is shown, so a change made on any other screen is already there on
 * return. Nothing here is a sample or a placeholder: where there is no
 * database (the web preview) the data sections are replaced by a note.
 */
export function HomeScreen() {
  const router = useRouter();
  const { teacherName } = usePreferences();
  const greeting = useGreeting(teacherName);
  const dashboard = useDashboardUseCases();

  const [data, setData] = useState<Dashboard | null>(null);
  const [reloads, setReloads] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // One per mounted Home: only the newest reading is kept.
  const [latest] = useState(createLatestRequest);

  useFocusEffect(
    useCallback(() => {
      if (!dashboard) return;
      setIsRefreshing(true);
      latest.run(
        () => dashboard.getDashboard(),
        (reading) => {
          setData(reading);
          setIsRefreshing(false);
        }
      );
      return () => latest.cancel();
      // reloads is not read: changing it is what makes "Try again" read again.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dashboard, latest, reloads])
  );

  // The first reading: nothing for a moment, then skeleton bars, then the numbers.
  const phase = useLoadingPhase(dashboard !== null && data === null);
  // Later readings keep what is on screen and show a small spinner if they take a while.
  const refreshPhase = useLoadingPhase(isRefreshing && data !== null);
  const shown = phase === 'content' ? data : null;
  const counts = shown?.counts ?? null;
  const recentResults = shown?.recentResults ?? null;
  const recentAnswerKeys = shown?.recentAnswerKeys ?? null;
  const lastScan = shown?.lastScan ?? null;

  /** Goes to a screen, leaving it something to open when it has one. */
  function open(link: (typeof HOME_LINKS)[keyof typeof HOME_LINKS]) {
    if (link.route === '/keys' && link.intent) requestIntent('keys', link.intent);
    if (link.route === '/students' && link.intent) requestIntent('students', link.intent);
    router.navigate(link.route);
  }

  function continueScanning() {
    if (!lastScan) return;
    // Scan checks these against the database again and starts clean if they no longer fit.
    requestIntent('scan', {
      type: 'continue',
      subjectId: lastScan.subjectId,
      answerKeyId: lastScan.answerKeyId,
      classId: lastScan.classId,
    });
    router.navigate('/scan');
  }

  return (
    <Screen>
      <View className="flex-row items-center gap-3">
        <View className="flex-1 gap-1">
          <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
            <View className="flex-row items-center gap-2">
              <View accessible={false} importantForAccessibility="no" className="flex-row gap-1">
                <View className="h-2 w-2 rounded-full border border-muted-foreground" />
                <View className="h-2 w-2 rounded-full bg-primary" />
                <View className="h-2 w-2 rounded-full border border-muted-foreground" />
              </View>
              <Text className="text-sm font-medium text-muted-foreground">Answer Checker</Text>
            </View>
          </View>
          <Text
            role="heading"
            aria-level="1"
            numberOfLines={2}
            maxFontSizeMultiplier={1.4}
            className="text-xl font-semibold leading-7 tracking-tight">
            {greeting}
          </Text>
        </View>
        <SettingsButton onPress={() => open(HOME_LINKS.settings)} />
      </View>

      <View className="gap-2">
        <ScanAction onPress={() => open(HOME_LINKS.scan)} />
        {lastScan && (
          <ContinueScanning
            detail={`${lastScan.answerKeyName} · ${lastScan.className}`}
            accessibilityLabel={`Continue scanning ${lastScan.answerKeyName}, ${lastScan.subjectName}, class ${lastScan.className}. You choose the next student.`}
            onPress={continueScanning}
          />
        )}
        <View className="flex-row gap-2">
          <QuickAction
            label="Create answer key"
            icon={FilePlus}
            onPress={() => open(HOME_LINKS.createAnswerKey)}
          />
          <QuickAction label="Add student" icon={UserPlus} onPress={() => open(HOME_LINKS.addStudent)} />
          <QuickAction
            label="View results"
            icon={ClipboardCheck}
            onPress={() => open(HOME_LINKS.viewResults)}
          />
        </View>
      </View>

      {!dashboard ? (
        <Callout icon={Smartphone} title="Only on the phone">
          Counts and recent activity come from the phone&apos;s database. This web preview has none,
          so no numbers are shown here.
        </Callout>
      ) : (
        <>
          {shown?.isIncomplete && (
            <Callout
              icon={CircleAlert}
              tone="error"
              title="Some of this could not be loaded"
              action={
                <Button
                  variant="outline"
                  className="h-12 self-start"
                  onPress={() => setReloads((current) => current + 1)}>
                  <Text>Try again</Text>
                </Button>
              }>
              Nothing was changed. The actions above still work.
            </Callout>
          )}

          <View className="gap-2.5" aria-busy={phase !== 'content'}>
            <View className="flex-row items-center justify-between gap-3">
              <SectionHeading>Overview</SectionHeading>
              <RefreshIndicator phase={refreshPhase} />
            </View>
            <View className="flex-row flex-wrap gap-2">
              <CountCard
                value={counts?.students ?? null}
                phase={phase}
                singular="student"
                label="Students"
                icon={GraduationCap}
                onPress={() => open(HOME_LINKS.students)}
              />
              <CountCard
                value={counts?.classes ?? null}
                phase={phase}
                singular="class"
                plural="classes"
                label="Classes"
                icon={Users}
                onPress={() => open(HOME_LINKS.classes)}
              />
              <CountCard
                value={counts?.answerKeys ?? null}
                phase={phase}
                singular="answer key"
                label="Answer Keys"
                icon={FileCheck}
                onPress={() => open(HOME_LINKS.answerKeys)}
              />
              <CountCard
                value={counts?.results ?? null}
                phase={phase}
                singular="result"
                label="Results"
                icon={ClipboardCheck}
                onPress={() => open(HOME_LINKS.results)}
              />
            </View>
            <View
              accessible
              accessibilityLabel={
                counts === null
                  ? 'Scanned today'
                  : counts.scannedToday === 0
                    ? 'No sheets scanned today'
                    : `Scanned today: ${countOf(counts.scannedToday, 'sheet')}`
              }
              className="min-h-12 flex-row items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
              <Icon as={CalendarCheck} size={18} className="text-muted-foreground" />
              <Text className="flex-1 text-sm font-medium leading-5">Scanned today</Text>
              {counts === null ? (
                phase !== 'content' ? (
                  <ValueSkeleton phase={phase} className="h-4 w-8" />
                ) : (
                  <Text className="text-sm text-muted-foreground">–</Text>
                )
              ) : counts.scannedToday === 0 ? (
                <Text className="text-sm leading-5 text-muted-foreground">
                  No sheets scanned today.
                </Text>
              ) : (
                <Text className="text-[15px] font-semibold leading-[22px]">
                  {counts.scannedToday.toLocaleString()}
                </Text>
              )}
            </View>
          </View>

          <RecentSection
            heading="Recent results"
            isEmpty={recentResults === null ? null : recentResults.length === 0}
            phase={phase}
            emptyMessage="No saved results yet."
            emptyAction={
              <Button variant="outline" className="h-12 self-start" onPress={() => open(HOME_LINKS.scan)}>
                <Icon as={ScanLine} size={16} />
                <Text>Scan answer sheet</Text>
              </Button>
            }
            viewAllLabel="View all results"
            onViewAll={() => open(HOME_LINKS.results)}>
            {recentResults?.map((result, index) => (
              <RecentResultRow
                key={result.id}
                result={result}
                isFirst={index === 0}
                onPress={() => {
                  requestIntent('results', openResultIntent(result.id));
                  router.navigate('/results');
                }}
              />
            ))}
          </RecentSection>

          <RecentSection
            heading="Recent answer keys"
            isEmpty={recentAnswerKeys === null ? null : recentAnswerKeys.length === 0}
            phase={phase}
            emptyMessage="No answer keys yet."
            emptyAction={
              <Button
                variant="outline"
                className="h-12 self-start"
                onPress={() => open(HOME_LINKS.createAnswerKey)}>
                <Icon as={FilePlus} size={16} />
                <Text>Create answer key</Text>
              </Button>
            }
            viewAllLabel="View all answer keys"
            onViewAll={() => open(HOME_LINKS.answerKeys)}>
            {recentAnswerKeys?.map((answerKey, index) => (
              <RecentKeyRow
                key={answerKey.id}
                answerKey={answerKey}
                isFirst={index === 0}
                onPress={() => {
                  requestIntent('keys', viewAnswerKeyIntent(answerKey.id));
                  router.navigate('/keys');
                }}
              />
            ))}
          </RecentSection>
        </>
      )}

      <View className="gap-2.5">
        <SectionHeading>More</SectionHeading>
        <ItemGroup>
          <Item
            title="Classes"
            description="Student groups, such as Grade 11 STEM-A or BSIT 1A"
            icon={Users}
            onPress={() => open(HOME_LINKS.classes)}
          />
          <Item
            title="Subjects"
            description="What you teach, such as Mathematics or Data Structures"
            icon={BookOpen}
            onPress={() => open(HOME_LINKS.subjects)}
          />
          <Item
            title="Settings"
            description="Theme and your data"
            icon={Settings}
            onPress={() => open(HOME_LINKS.settings)}
          />
        </ItemGroup>
      </View>
    </Screen>
  );
}

type ContinueScanningProps = { detail: string; accessibilityLabel: string; onPress: () => void };

/** Picks up the last scan session: same subject, answer key, and class; the student is chosen anew. */
function ContinueScanning({ detail, accessibilityLabel, onPress }: ContinueScanningProps) {
  const { isPressed, pressHandlers } = usePressFeedback();
  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className={cn(
        'min-h-14 flex-row items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2',
        isPressed && 'bg-primary/20',
        FOCUS_RING
      )}>
      <Icon as={Play} size={18} className="text-primary" />
      <View className="flex-1">
        <Text className="text-sm font-semibold leading-5">Continue scanning</Text>
        <Text numberOfLines={1} className="text-[13px] leading-[18px] text-muted-foreground">
          {detail}
        </Text>
      </View>
      <Icon as={ChevronRight} size={16} className="text-muted-foreground" />
    </Pressable>
  );
}
