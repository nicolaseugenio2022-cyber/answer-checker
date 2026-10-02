import { useFocusEffect, useRouter } from 'expo-router';
import BookOpen from 'lucide-react-native/icons/book-open';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import Copy from 'lucide-react-native/icons/copy';
import FileCheck from 'lucide-react-native/icons/file-check';
import FilePlus from 'lucide-react-native/icons/file-plus';
import Pencil from 'lucide-react-native/icons/pencil';
import Search from 'lucide-react-native/icons/search';
import Smartphone from 'lucide-react-native/icons/smartphone';
import Trash from 'lucide-react-native/icons/trash';
import { useCallback, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, View } from 'react-native';

import { Callout } from '@/core/presentation/components/callout';
import { DeleteDialog } from '@/core/presentation/components/delete-dialog';
import { FilterChip } from '@/core/presentation/components/filter-chip';
import { ItemGroup } from '@/core/presentation/components/item';
import { Notice, type NoticeMessage } from '@/core/presentation/components/notice';
import { RowAction } from '@/core/presentation/components/row-action';
import { Screen } from '@/core/presentation/components/screen';
import {
  Pending,
  SkeletonListControls,
  SkeletonRows,
} from '@/core/presentation/components/skeleton';
import { useLoadingPhase } from '@/core/presentation/hooks/use-loading-phase';
import { SearchField } from '@/core/presentation/components/search-field';
import { Button } from '@/core/presentation/components/ui/button';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { countOf } from '@/core/presentation/lib/describe-name-error';
import { cn } from '@/core/presentation/lib/utils';
import { destinationTitle } from '@/core/presentation/navigation/destinations';
import { takeIntent } from '@/core/presentation/navigation/screen-intent';
import { nameKey } from '@/core/domain/record-name';
import type { AnswerKeyDetails } from '@/features/answer-keys/application/answer-key-repository';
import type { AnswerKeyInput } from '@/features/answer-keys/domain/answer-key';
import {
  AnswerKeyFormDialog,
  type AnswerKeyFormFailure,
  type AnswerKeyFormValues,
} from '@/features/answer-keys/presentation/answer-key-form-dialog';
import { useAnswerKeyUseCases } from '@/features/answer-keys/presentation/answer-key-use-cases-context';
import {
  AnswerKeyViewDialog,
  describeUse,
} from '@/features/answer-keys/presentation/answer-key-view-dialog';
import {
  describeAnswerKeyError,
  fieldOfAnswerKeyError,
} from '@/features/answer-keys/presentation/describe-answer-key-error';
import { useSubjectUseCases } from '@/features/subjects/presentation/subject-use-cases-context';

type SubjectOption = { id: string; name: string };

type Loaded =
  | { status: 'loading' }
  | { status: 'failed' }
  | {
      status: 'ready';
      answerKeys: readonly AnswerKeyDetails[];
      subjects: readonly SubjectOption[];
    };

type FormState =
  | { mode: 'create'; initial: AnswerKeyFormValues }
  | { mode: 'duplicate'; initial: AnswerKeyFormValues }
  | { mode: 'edit'; initial: AnswerKeyFormValues; answerKey: AnswerKeyDetails };

type DeleteState = {
  answerKey: AnswerKeyDetails;
  phase: 'confirm' | 'deleting' | 'blocked' | 'failed';
  message: string | null;
};

const INTRO =
  'An answer key holds the correct answers of a test you give on paper. It belongs to a subject and works for every class that takes it.';

/** A new key starts with this many unanswered questions. */
const DEFAULT_QUESTION_COUNT = 10;

/**
 * Answer Keys: browse by subject, search, create, view, edit, duplicate, and
 * delete permanently. It calls use cases only and issues no SQL.
 */
export function AnswerKeysScreen() {
  const router = useRouter();
  const useCases = useAnswerKeyUseCases();
  const subjectUseCases = useSubjectUseCases();

  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [viewed, setViewed] = useState<AnswerKeyDetails | null>(null);
  const [deletion, setDeletion] = useState<DeleteState | null>(null);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isAvailable = useCases !== null && subjectUseCases !== null;
  const loadingPhase = useLoadingPhase(isAvailable && loaded.status === 'loading');
  // A refresh of a list already on screen: the rows stay, the header shows a small spinner.
  const refreshPhase = useLoadingPhase(isRefreshing && loaded.status === 'ready');

  /** Reads the keys and the subjects together, so the two always agree. */
  const load = useCallback(async (): Promise<Loaded> => {
    if (!useCases || !subjectUseCases) return { status: 'loading' };
    try {
      const [answerKeys, subjects] = await Promise.all([
        useCases.listAnswerKeys(),
        subjectUseCases.listSubjects(),
      ]);
      return { status: 'ready', answerKeys, subjects };
    } catch (error) {
      console.error(error);
      return { status: 'failed' };
    }
  }, [useCases, subjectUseCases]);

  // Loads when the screen opens and again each time it is shown: screens stay
  // mounted in the tab shell, and subjects are edited on another screen.
  useFocusEffect(
    useCallback(() => {
      let isCurrent = true;
      setIsRefreshing(true);
      load().then((result) => {
        if (!isCurrent) return;
        setIsRefreshing(false);
        setLoaded(result);
        // Opened from Home with something to do, once the list is known.
        const intent = takeIntent('keys');
        if (!intent || result.status !== 'ready') return;
        if (intent.type === 'view') {
          const answerKey = result.answerKeys.find((key) => key.id === intent.answerKeyId);
          if (answerKey) setViewed(answerKey);
        } else if (result.subjects.length > 0) {
          // Without a subject there is nothing to create under; the screen says so.
          setForm({
            mode: 'create',
            initial: {
              name: '',
              subjectId: result.subjects.length === 1 ? result.subjects[0].id : null,
              answers: Array<null>(DEFAULT_QUESTION_COUNT).fill(null),
            },
          });
        }
      });
      return () => {
        isCurrent = false;
      };
      // loadAttempt is not read: changing it is what makes "Try again" load again.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, loadAttempt])
  );

  const refresh = async () => setLoaded(await load());

  function announce(tone: NoticeMessage['tone'], text: string) {
    setNotice((previous) => ({ id: (previous?.id ?? 0) + 1, tone, text }));
    AccessibilityInfo.announceForAccessibility(text);
  }

  const subjects = loaded.status === 'ready' ? loaded.subjects : [];
  const allKeys = loaded.status === 'ready' ? loaded.answerKeys : [];
  // A filter for a subject that was deleted elsewhere falls back to all subjects.
  const activeFilter = subjects.some((subject) => subject.id === subjectFilter)
    ? subjectFilter
    : null;
  const wanted = nameKey(search.trim());
  const visible = allKeys.filter(
    (answerKey) =>
      (activeFilter === null || answerKey.subjectId === activeFilter) &&
      (wanted.length === 0 || nameKey(answerKey.name).includes(wanted))
  );
  // The list arrives ordered by subject, so keys of a subject are adjacent.
  const groups: { subjectId: string; subjectName: string; answerKeys: AnswerKeyDetails[] }[] = [];
  for (const answerKey of visible) {
    const last = groups[groups.length - 1];
    if (last?.subjectId === answerKey.subjectId) last.answerKeys.push(answerKey);
    else {
      groups.push({
        subjectId: answerKey.subjectId,
        subjectName: answerKey.subjectName,
        answerKeys: [answerKey],
      });
    }
  }
  const isFiltering = wanted.length > 0 || activeFilter !== null;
  const canCreate = loaded.status === 'ready' && subjects.length > 0;

  function openCreate() {
    setForm({
      mode: 'create',
      initial: {
        name: '',
        // The subject being viewed, or the only subject there is.
        subjectId: activeFilter ?? (subjects.length === 1 ? subjects[0].id : null),
        answers: Array<null>(DEFAULT_QUESTION_COUNT).fill(null),
      },
    });
  }

  async function openDuplicate(answerKey: AnswerKeyDetails) {
    if (!useCases) return;
    try {
      const draft = await useCases.draftDuplicate(answerKey.id);
      setForm({
        mode: 'duplicate',
        initial: { name: draft.name, subjectId: draft.subjectId, answers: draft.answers },
      });
    } catch (error) {
      const description = describeAnswerKeyError(error);
      if (description.kind === 'failure') console.error(error);
      announce('error', description.message);
      await refresh();
    }
  }

  async function submitForm(input: AnswerKeyInput): Promise<AnswerKeyFormFailure | null> {
    if (!useCases || !form) return null;
    try {
      if (form.mode === 'edit') {
        const after = await useCases.updateAnswerKey(form.answerKey.id, input);
        if (after.updatedAt !== form.answerKey.updatedAt) announce('success', 'Answer key updated');
      } else {
        await useCases.createAnswerKey(input);
        announce(
          'success',
          form.mode === 'duplicate' ? 'Answer key duplicated' : 'Answer key created'
        );
      }
    } catch (error) {
      const description = describeAnswerKeyError(error);
      if (description.kind === 'missing') {
        setForm(null);
        announce('error', description.message);
        await refresh();
        return null;
      }
      if (description.kind === 'failure') console.error(error);
      return { field: fieldOfAnswerKeyError(error), message: description.message };
    }
    setForm(null);
    await refresh();
    return null;
  }

  async function confirmDeletion() {
    if (!useCases || !deletion || deletion.phase === 'deleting') return;
    const { answerKey } = deletion;
    setDeletion({ answerKey, phase: 'deleting', message: null });
    try {
      await useCases.deleteAnswerKey(answerKey.id);
    } catch (error) {
      const description = describeAnswerKeyError(error);
      if (description.kind === 'missing') {
        setDeletion(null);
        announce('error', description.message);
        await refresh();
      } else if (description.kind === 'blocked') {
        setDeletion({ answerKey, phase: 'blocked', message: description.message });
      } else {
        console.error(error);
        setDeletion({ answerKey, phase: 'failed', message: description.message });
      }
      return;
    }
    setDeletion(null);
    announce('success', 'Answer key deleted permanently');
    await refresh();
  }

  return (
    <Screen
      title={destinationTitle('keys')}
      refreshPhase={refreshPhase}
      overlay={
        notice && <Notice key={notice.id} notice={notice} onDismiss={() => setNotice(null)} />
      }>
      <View className="gap-4">
        <Text className="text-[15px] leading-[22px] text-muted-foreground">{INTRO}</Text>
        {isAvailable && (
          <Button className="h-12" disabled={!canCreate} onPress={openCreate}>
            <Icon as={FilePlus} size={18} className="text-primary-foreground" />
            <Text>Create answer key</Text>
          </Button>
        )}
      </View>

      {!isAvailable ? (
        <Callout icon={Smartphone} title="Only on the phone">
          Answer keys are stored in a database on the phone. This web preview has no database, so
          nothing can be added or shown here.
        </Callout>
      ) : loaded.status === 'loading' || loadingPhase !== 'content' ? (
        <Pending phase={loadingPhase} label="Loading answer keys" className="gap-4">
          <SkeletonListControls chips={3} />
          <SkeletonRows rows={4} hasTrailing />
        </Pending>
      ) : loaded.status === 'failed' ? (
        <Callout
          icon={CircleAlert}
          tone="error"
          title="The answer keys could not be loaded"
          action={
            <Button
              variant="outline"
              className="h-12 self-start"
              onPress={() => {
                setLoaded({ status: 'loading' });
                setLoadAttempt((attempt) => attempt + 1);
              }}>
              <Text>Try again</Text>
            </Button>
          }>
          Nothing was changed.
        </Callout>
      ) : subjects.length === 0 ? (
        <Callout
          icon={BookOpen}
          title="Add a subject first"
          action={
            <Button
              variant="outline"
              className="h-12 self-start"
              onPress={() => router.navigate('/subjects')}>
              <Text>Open Subjects</Text>
            </Button>
          }>
          Every answer key belongs to a subject. Add the subjects you teach, then come back.
        </Callout>
      ) : allKeys.length === 0 ? (
        <Callout icon={FileCheck} title="No answer keys yet">
          Create the answer key of a test you are about to check: its name, its subject, and the
          correct letter of each question.
        </Callout>
      ) : (
        <>
          <View className="gap-3">
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name"
              accessibilityLabel="Search answer keys by name"
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              accessibilityRole="radiogroup"
              accessibilityLabel="Show answer keys of"
              // The chips scroll to the screen edges, past the screen's own padding.
              style={{ marginHorizontal: -16 }}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
              <FilterChip
                label="All subjects"
                isSelected={activeFilter === null}
                onPress={() => setSubjectFilter(null)}
              />
              {subjects.map((subject) => (
                <FilterChip
                  key={subject.id}
                  label={subject.name}
                  isSelected={activeFilter === subject.id}
                  onPress={() => setSubjectFilter(subject.id)}
                />
              ))}
            </ScrollView>
          </View>

          {groups.length === 0 ? (
            <Callout
              icon={Search}
              title="No answer keys match"
              action={
                isFiltering && (
                  <Button
                    variant="outline"
                    className="h-12 self-start"
                    onPress={() => {
                      setSearch('');
                      setSubjectFilter(null);
                    }}>
                    <Text>Show all answer keys</Text>
                  </Button>
                )
              }>
              {wanted.length > 0
                ? 'No name contains what you typed.'
                : 'This subject has no answer keys yet.'}
            </Callout>
          ) : (
            <>
              <Text accessibilityLiveRegion="polite" className="text-sm text-muted-foreground">
                {isFiltering
                  ? `${countOf(visible.length, 'answer key')} of ${allKeys.length}`
                  : countOf(allKeys.length, 'answer key')}
              </Text>
              {groups.map((group) => (
                <View key={group.subjectId} className="gap-2.5">
                  <View className="flex-row items-center gap-2">
                    <View className="h-4 w-1 rounded-full bg-primary" />
                    <Text variant="h4" aria-level="2" className="flex-1 text-base">
                      {group.subjectName}
                    </Text>
                    <Text className="text-sm text-muted-foreground">{group.answerKeys.length}</Text>
                  </View>
                  <ItemGroup>
                    {group.answerKeys.map((answerKey) => (
                      <View key={answerKey.id} className="min-h-14 flex-row items-center pr-1">
                        <OpenRow answerKey={answerKey} onPress={() => setViewed(answerKey)} />
                        <RowAction
                          icon={Copy}
                          label={`Duplicate ${answerKey.name}`}
                          onPress={() => openDuplicate(answerKey)}
                        />
                        <RowAction
                          icon={Pencil}
                          label={`Edit ${answerKey.name}`}
                          onPress={() =>
                            setForm({
                              mode: 'edit',
                              answerKey,
                              initial: {
                                name: answerKey.name,
                                subjectId: answerKey.subjectId,
                                answers: answerKey.answers,
                              },
                            })
                          }
                        />
                        <RowAction
                          icon={Trash}
                          label={`Delete ${answerKey.name}`}
                          destructive
                          onPress={() =>
                            setDeletion({ answerKey, phase: 'confirm', message: null })
                          }
                        />
                      </View>
                    ))}
                  </ItemGroup>
                </View>
              ))}
            </>
          )}
        </>
      )}

      {form && (
        <AnswerKeyFormDialog
          mode={form.mode}
          initial={form.initial}
          subjects={subjects}
          lockedResultCount={form.mode === 'edit' ? form.answerKey.resultCount : 0}
          onSubmit={submitForm}
          onCancel={() => setForm(null)}
        />
      )}

      {viewed && <AnswerKeyViewDialog answerKey={viewed} onClose={() => setViewed(null)} />}

      {deletion && (
        <DeleteDialog
          name={deletion.answerKey.name}
          noun="answer key"
          detail={`Subject: ${deletion.answerKey.subjectName}. ${countOf(deletion.answerKey.questionCount, 'question')}.`}
          isDeleting={deletion.phase === 'deleting'}
          blockedMessage={deletion.phase === 'blocked' ? deletion.message : null}
          failureMessage={deletion.phase === 'failed' ? deletion.message : null}
          onConfirm={confirmDeletion}
          onCancel={() => setDeletion(null)}
        />
      )}
    </Screen>
  );
}

/** The name area of a row: pressing it opens the key for viewing. */
function OpenRow({ answerKey, onPress }: { answerKey: AnswerKeyDetails; onPress: () => void }) {
  const { isPressed, pressHandlers } = usePressFeedback();
  const detail = `${countOf(answerKey.questionCount, 'question')}. ${describeUse(answerKey.resultCount)}`;

  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      accessibilityRole="button"
      accessibilityLabel={`View ${answerKey.name}. ${detail}`}
      className={cn(
        'min-h-14 flex-1 justify-center py-2 pl-4 pr-2 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
        isPressed && 'bg-secondary'
      )}>
      <Text className="text-[15px] font-medium leading-[22px]">{answerKey.name}</Text>
      <Text className="text-[13px] leading-[18px] text-muted-foreground">{detail}</Text>
    </Pressable>
  );
}
