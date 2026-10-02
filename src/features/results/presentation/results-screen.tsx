import { useFocusEffect, useRouter } from 'expo-router';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import ClipboardCheck from 'lucide-react-native/icons/clipboard-check';
import ScanLine from 'lucide-react-native/icons/scan-line';
import SearchX from 'lucide-react-native/icons/search-x';
import Smartphone from 'lucide-react-native/icons/smartphone';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Callout } from '@/core/presentation/components/callout';
import { Notice, type NoticeMessage } from '@/core/presentation/components/notice';
import { PickerSheet, type PickerOption } from '@/core/presentation/components/picker-sheet';
import { Screen } from '@/core/presentation/components/screen';
import { SearchField } from '@/core/presentation/components/search-field';
import { Pending, Skeleton, SkeletonRows } from '@/core/presentation/components/skeleton';
import { useLoadingPhase } from '@/core/presentation/hooks/use-loading-phase';
import { Button } from '@/core/presentation/components/ui/button';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { countOf } from '@/core/presentation/lib/describe-name-error';
import { cn } from '@/core/presentation/lib/utils';
import { destinationTitle } from '@/core/presentation/navigation/destinations';
import { takeIntent } from '@/core/presentation/navigation/screen-intent';
import { tabBarClearance } from '@/core/presentation/navigation/tab-bar-metrics';
import type { ResultCursor } from '@/features/results/application/results-ports';
import type { ResultSummary } from '@/features/results/domain/result';
import {
  NO_FILTER,
  filterChoices,
  hasActiveFilter,
  setFilter,
  withoutIncompatible,
  type FilterChoice,
  type FilterField,
  type ResultFilter,
  type ResultLink,
} from '@/features/results/domain/result-filter';
import { ResultDetailDialog } from '@/features/results/presentation/result-detail-dialog';
import {
  describeSummary,
  formatAttempt,
  formatPercentage,
  formatScore,
  formatShortDate,
} from '@/features/results/presentation/result-format';
import { useResultsUseCases } from '@/features/results/presentation/results-use-cases-context';

type Loaded =
  | { status: 'loading' }
  | { status: 'failed' }
  | {
      status: 'ready';
      items: ResultSummary[];
      next: ResultCursor | null;
      /** Results within the filters and the search, and results saved at all. */
      matching: number;
      total: number;
    };

/** The words of one filter: its button, its picker, and its "all" choice. */
const FILTERS: {
  field: FilterField;
  label: string;
  all: string;
  title: string;
  searchPlaceholder: string;
  choices: 'subjects' | 'answerKeys' | 'classes' | 'students';
}[] = [
  {
    field: 'subjectId',
    label: 'Subject',
    all: 'All subjects',
    title: 'Filter by subject',
    searchPlaceholder: 'Search subjects',
    choices: 'subjects',
  },
  {
    field: 'answerKeyId',
    label: 'Answer key',
    all: 'All answer keys',
    title: 'Filter by answer key',
    searchPlaceholder: 'Search answer keys',
    choices: 'answerKeys',
  },
  {
    field: 'classId',
    label: 'Class',
    all: 'All classes',
    title: 'Filter by class',
    searchPlaceholder: 'Search classes',
    choices: 'classes',
  },
  {
    field: 'studentId',
    label: 'Student',
    all: 'All students',
    title: 'Filter by student',
    searchPlaceholder: 'Search students by name or Student ID',
    choices: 'students',
  },
];

/** The id of the "all" row of a picker. No record has an empty id. */
const ALL = '';
/** Typing pauses this long before the list is read again. */
const SEARCH_DELAY_MS = 250;

/**
 * Results: every saved result, newest first, with one search field and four
 * filters, read a page at a time. Opening a row shows the result; nothing can
 * be edited, only deleted permanently. It calls use cases only: no SQL and no
 * file paths here. The filters are this screen's own and are independent of
 * what is chosen on the Scan screen.
 */
export function ResultsScreen() {
  const results = useResultsUseCases();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [filter, setFilterState] = useState<ResultFilter>(NO_FILTER);
  const [searchText, setSearchText] = useState('');
  // What the list was last read with: the typed text, once typing paused.
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [links, setLinks] = useState<ResultLink[]>([]);
  const [reloads, setReloads] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [picker, setPicker] = useState<FilterField | null>(null);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const loadingPhase = useLoadingPhase(results !== null && loaded.status === 'loading');
  // A refresh of a list already on screen: the rows stay, the header shows a small spinner.
  const refreshPhase = useLoadingPhase(isRefreshing && loaded.status === 'ready');

  // Tells a page that arrives late that the list has been read again since.
  const generation = useRef(0);
  // The filter buttons, to put screen-reader focus back when a picker closes.
  const subjectButton = useRef<View>(null);
  const answerKeyButton = useRef<View>(null);
  const classButton = useRef<View>(null);
  const studentButton = useRef<View>(null);
  const focusAfterPicker = useRef<FilterField | null>(null);

  function announce(tone: NoticeMessage['tone'], text: string) {
    setNotice((previous) => ({ id: (previous?.id ?? 0) + 1, tone, text }));
    AccessibilityInfo.announceForAccessibility(text);
  }

  // The list is not read on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchText.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  // The first page, the counts, and what the filters can offer. Read again
  // whenever the screen is shown: Scan saves results while this screen stays
  // mounted, and renames elsewhere change the filter names.
  useFocusEffect(
    useCallback(() => {
      if (!results) return;
      const current = ++generation.current;
      const isCurrent = () => generation.current === current;
      // Finishes or undoes a deletion that was interrupted; never blocks the list.
      void results.settleInterruptedDeletions();
      setIsRefreshing(true);
      Promise.all([
        results.listResults({ filter, search }),
        results.countResults(filter, search),
        results.listFilterLinks(),
      ]).then(
        ([page, counts, filterLinks]) => {
          if (!isCurrent()) return;
          setIsRefreshing(false);
          // Opened from Home's recent results: show that result over the list.
          const intent = takeIntent('results');
          if (intent) setOpenedId(intent.resultId);
          setLinks(filterLinks);
          // A filtered record may have lost its last result since the filter was set.
          const fitting = withoutIncompatible(filterLinks, filter);
          if (fitting !== filter) {
            setFilterState(fitting);
            return;
          }
          setLoaded({ status: 'ready', items: page.items, next: page.next, ...counts });
          setIsLoadingMore(false);
        },
        (error) => {
          console.error(error);
          if (!isCurrent()) return;
          setIsRefreshing(false);
          setLoaded({ status: 'failed' });
        }
      );
      return () => {
        // Leaving the screen: whatever is still on its way is out of date.
        generation.current++;
      };
      // reloads is not read: changing it is what makes "Try again" and a deletion read again.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [results, filter, search, reloads])
  );

  // A picker closed: focus returns to the button it was opened from.
  useEffect(() => {
    const field = focusAfterPicker.current;
    if (picker !== null || field === null) return;
    focusAfterPicker.current = null;
    const timer = setTimeout(() => {
      const button = {
        subjectId: subjectButton,
        answerKeyId: answerKeyButton,
        classId: classButton,
        studentId: studentButton,
      }[field].current;
      if (!button) return;
      if (Platform.OS === 'web') (button as unknown as { focus?: () => void }).focus?.();
      else AccessibilityInfo.sendAccessibilityEvent(button, 'focus');
    }, 350);
    return () => clearTimeout(timer);
  }, [picker]);

  async function loadMore() {
    if (!results || loaded.status !== 'ready' || loaded.next === null || isLoadingMore) return;
    const current = generation.current;
    setIsLoadingMore(true);
    try {
      const page = await results.listResults({ filter, search, after: loaded.next });
      if (generation.current !== current) return;
      setLoaded((previous) =>
        previous.status === 'ready'
          ? { ...previous, items: [...previous.items, ...page.items], next: page.next }
          : previous
      );
    } catch (error) {
      console.error(error);
      if (generation.current === current) {
        announce('error', 'More results could not be loaded. Scroll again to retry.');
      }
    } finally {
      if (generation.current === current) setIsLoadingMore(false);
    }
  }

  function closePicker(field: FilterField) {
    focusAfterPicker.current = field;
    setPicker(null);
  }

  function chooseFilter(field: FilterField, id: string) {
    setFilterState((current) => setFilter(links, current, field, id === ALL ? null : id));
    closePicker(field);
  }

  function clearFilters() {
    setFilterState(NO_FILTER);
    AccessibilityInfo.announceForAccessibility('Filters cleared');
  }

  const choices = filterChoices(links, filter);
  const isFiltered = hasActiveFilter(filter);
  const isSearching = search.length > 0;
  const openPicker = FILTERS.find((item) => item.field === picker) ?? null;
  const buttonRefs = {
    subjectId: subjectButton,
    answerKeyId: answerKeyButton,
    classId: classButton,
    studentId: studentButton,
  };

  const ready = loaded.status === 'ready' ? loaded : null;
  const hasHistory = ready !== null && ready.total > 0;

  // Search, filters, and the count: above the rows, scrolling with them.
  const header = hasHistory ? (
    <View className="gap-3 pb-1 pt-2">
      <SearchField
        value={searchText}
        onChangeText={setSearchText}
        placeholder="Search results"
        accessibilityLabel="Search results by student, Student ID, answer key, subject, or class"
      />
      <View className="flex-row flex-wrap gap-2">
        {FILTERS.map((item) => {
          const chosen = choices[item.choices].find((choice) => choice.id === filter[item.field]);
          return (
            <FilterButton
              key={item.field}
              ref={buttonRefs[item.field]}
              label={item.label}
              value={chosen?.name ?? null}
              onPress={() => setPicker(item.field)}
            />
          );
        })}
      </View>
      <View className="min-h-12 flex-row items-center justify-between gap-3">
        <Text accessibilityLiveRegion="polite" className="flex-1 text-sm leading-5 text-muted-foreground">
          {isFiltered || isSearching
            ? `${ready.matching} of ${countOf(ready.total, 'result')}`
            : countOf(ready.total, 'result')}
        </Text>
        {isFiltered && (
          <Button variant="ghost" className="h-12 px-3" onPress={clearFilters}>
            <Text className="text-primary">Clear filters</Text>
          </Button>
        )}
      </View>
    </View>
  ) : null;

  const empty = !ready ? null : ready.total === 0 ? (
    <View className="pt-2">
      <Callout
        icon={ClipboardCheck}
        title="No results yet"
        action={
          <Button className="h-12 self-start" onPress={() => router.navigate('/scan')}>
            <Icon as={ScanLine} size={18} className="text-primary-foreground" />
            <Text>Scan an answer sheet</Text>
          </Button>
        }>
        A result appears here after you scan an answer sheet and save it.
      </Callout>
    </View>
  ) : isSearching ? (
    <Callout
      icon={SearchX}
      title={`No results match “${search}”`}
      action={
        <Button variant="outline" className="h-12 self-start" onPress={() => setSearchText('')}>
          <Text>Clear search</Text>
        </Button>
      }>
      {isFiltered
        ? 'Nothing within the chosen filters has that student, Student ID, answer key, subject, or class.'
        : 'Search looks at the student, Student ID, answer key, subject, and class.'}
    </Callout>
  ) : (
    <Callout
      icon={SearchX}
      title="No results for these filters"
      action={
        <Button variant="outline" className="h-12 self-start" onPress={clearFilters}>
          <Text>Clear filters</Text>
        </Button>
      }>
      No saved result has this combination.
    </Callout>
  );

  return (
    <Screen
      title={destinationTitle('results')}
      scrollable={false}
      refreshPhase={refreshPhase}
      overlay={
        notice && <Notice key={notice.id} notice={notice} onDismiss={() => setNotice(null)} />
      }>
      {!results ? (
        <View className="px-4 pt-2">
          <Callout icon={Smartphone} title="Only on the phone">
            Results are stored in the phone&apos;s database. This web preview has none, so there is
            nothing to show here.
          </Callout>
        </View>
      ) : loaded.status === 'loading' || loadingPhase !== 'content' ? (
        <View className="px-4 pt-2">
          {/* Search, the four filters, and rows with a score at the end. */}
          <Pending phase={loadingPhase} label="Loading results" className="gap-3">
            <Skeleton className="h-12 w-full" />
            <View className="flex-row flex-wrap gap-2">
              {[0, 1, 2, 3].map((filter) => (
                <Skeleton key={filter} className="h-12 min-w-[46%] flex-1" />
              ))}
            </View>
            <SkeletonRows rows={5} lines={3} hasTrailing />
          </Pending>
        </View>
      ) : loaded.status === 'failed' ? (
        <View className="px-4 pt-2">
          <Callout
            icon={CircleAlert}
            tone="error"
            title="The results could not be loaded"
            action={
              <Button
                variant="outline"
                className="h-12 self-start"
                onPress={() => {
                  setLoaded({ status: 'loading' });
                  setReloads((current) => current + 1);
                }}>
                <Text>Try again</Text>
              </Button>
            }>
            Nothing was changed.
          </Callout>
        </View>
      ) : (
        <FlatList
          data={loaded.items}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <ResultRow result={item} isFirst={index === 0} onPress={setOpenedId} />
          )}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          ListFooterComponent={
            isLoadingMore ? (
              <View accessible accessibilityLabel="Loading more results" className="items-center py-4">
                <ActivityIndicator className="text-primary" />
              </View>
            ) : null
          }
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.6}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          // The last row scrolls clear of the floating tab bar and the gesture area.
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: tabBarClearance(insets.bottom),
          }}
        />
      )}

      {openPicker && (
        <PickerSheet
          key={openPicker.field}
          title={openPicker.title}
          searchPlaceholder={openPicker.searchPlaceholder}
          options={[
            { id: ALL, name: openPicker.all },
            ...choices[openPicker.choices].map(
              (choice: FilterChoice): PickerOption => ({
                id: choice.id,
                name: choice.name,
                detail: choice.detail,
              })
            ),
          ]}
          selectedId={filter[openPicker.field] ?? ALL}
          empty={{ title: 'Nothing to filter by', message: 'No result has been saved yet.' }}
          onSelect={(id) => chooseFilter(openPicker.field, id)}
          onClose={() => closePicker(openPicker.field)}
        />
      )}

      {openedId !== null && (
        <ResultDetailDialog
          resultId={openedId}
          onClose={() => setOpenedId(null)}
          onDeleted={(studentName) => {
            setOpenedId(null);
            setReloads((current) => current + 1);
            if (studentName !== null) {
              announce('success', `Result of ${studentName} deleted permanently`);
            }
          }}
        />
      )}
    </Screen>
  );
}

type FilterButtonProps = {
  label: string;
  /** The chosen record's name, or null for "all". */
  value: string | null;
  ref?: React.Ref<View>;
  onPress: () => void;
};

/** One filter: what it filters by and what is chosen. Two to a row, 48dp high. */
function FilterButton({ label, value, ref, onPress }: FilterButtonProps) {
  const { isPressed, pressHandlers } = usePressFeedback();
  const isActive = value !== null;
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      {...pressHandlers}
      accessibilityRole="button"
      accessibilityLabel={isActive ? `${label} filter: ${value}. Change.` : `${label} filter: all. Change.`}
      className={cn(
        'min-h-12 min-w-[46%] flex-1 flex-row items-center gap-2 rounded-lg border px-3 py-1 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
        isActive ? 'border-primary bg-primary/10' : 'border-border bg-card',
        isPressed && 'bg-secondary'
      )}>
      <View className="flex-1">
        <Text className="text-xs leading-4 text-muted-foreground">{label}</Text>
        <Text numberOfLines={1} className={cn('text-sm leading-5', isActive ? 'font-semibold' : 'font-medium')}>
          {value ?? 'All'}
        </Text>
      </View>
      <Icon as={ChevronDown} size={16} className={isActive ? 'text-primary' : 'text-muted-foreground'} />
    </Pressable>
  );
}

type ResultRowProps = {
  result: ResultSummary;
  isFirst: boolean;
  onPress: (id: string) => void;
};

/** One saved result. The whole row opens it. No scan image is loaded here. */
function ResultRow({ result, isFirst, onPress }: ResultRowProps) {
  const { isPressed, pressHandlers } = usePressFeedback();
  const attempt = formatAttempt(result.attempt);
  return (
    <Pressable
      onPress={() => onPress(result.id)}
      {...pressHandlers}
      accessibilityRole="button"
      accessibilityLabel={describeSummary(result)}
      accessibilityHint="Opens the result"
      className={cn(
        'min-h-14 flex-row gap-3 px-1 py-3 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
        !isFirst && 'border-t border-border',
        isPressed && 'bg-secondary'
      )}>
      <View className="flex-1 gap-0.5">
        <Text className="text-[15px] font-semibold leading-[22px]">{result.studentName}</Text>
        <Text className="text-[13px] leading-[18px] text-muted-foreground">
          {result.studentNumber} · {result.className}
        </Text>
        <Text className="text-[13px] leading-[18px] text-muted-foreground">
          {result.answerKeyName} · {result.subjectName}
        </Text>
        {attempt !== null && (
          <View className="mt-1 self-start rounded-full border border-border bg-muted px-2 py-0.5">
            <Text className="text-xs font-medium text-muted-foreground">{attempt}</Text>
          </View>
        )}
      </View>
      <View className="items-end gap-0.5">
        <Text className="text-[15px] font-semibold leading-[22px]">
          {formatScore(result.score, result.total)}
        </Text>
        <Text className="text-[13px] leading-[18px] text-muted-foreground">
          {formatPercentage(result.score, result.total)}
        </Text>
        <Text className="text-[13px] leading-[18px] text-muted-foreground">
          {formatShortDate(result.capturedAt)}
        </Text>
      </View>
    </Pressable>
  );
}
