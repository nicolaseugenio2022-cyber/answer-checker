import type { LucideIcon } from 'lucide-react-native';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import Pencil from 'lucide-react-native/icons/pencil';
import Plus from 'lucide-react-native/icons/plus';
import Smartphone from 'lucide-react-native/icons/smartphone';
import Trash from 'lucide-react-native/icons/trash';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';

import { Pending, SkeletonRows } from '@/core/presentation/components/skeleton';
import { useLoadingPhase } from '@/core/presentation/hooks/use-loading-phase';
import { AccessibilityInfo, View } from 'react-native';

import { Callout } from '@/core/presentation/components/callout';
import { DeleteDialog } from '@/core/presentation/components/delete-dialog';
import { ItemGroup } from '@/core/presentation/components/item';
import { NameFormDialog } from '@/core/presentation/components/name-form-dialog';
import { Notice, type NoticeMessage } from '@/core/presentation/components/notice';
import { RowAction } from '@/core/presentation/components/row-action';
import { Screen } from '@/core/presentation/components/screen';
import { Button } from '@/core/presentation/components/ui/button';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import type { ErrorDescription } from '@/core/presentation/lib/describe-name-error';

export type NamedRecord = {
  id: string;
  name: string;
  /** One short line under the name, such as "3 subjects". */
  detail?: string;
};

/** How a dialog opened from a row hands control back to the screen. */
export type RowDialogControls = {
  /** Close without a change. */
  close(): void;
  /** Close, confirm the change with a notice, and read the list again. */
  done(message: string): void;
  /** Close because the record is gone, say so, and read the list again. */
  missing(message: string): void;
};

/** One more icon button on every row, which opens a dialog owned by the feature. */
export type RowDialogAction = {
  icon: LucideIcon;
  /** Accessible name that includes the record, such as "Manage subjects for BSIT 1A". */
  label: (record: NamedRecord) => string;
  renderDialog: (record: NamedRecord, controls: RowDialogControls) => ReactNode;
};

/** The use cases of one feature, in the shape this screen needs. */
export type NameListOperations = {
  list(): Promise<readonly NamedRecord[]>;
  add(name: string): Promise<NamedRecord>;
  rename(id: string, name: string): Promise<NamedRecord>;
  remove(id: string): Promise<void>;
};

export type NameListCopy = {
  /** Lower case, as it reads inside a sentence: "subject". */
  noun: string;
  pluralNoun: string;
  /** One sentence under the header on what these records are for. */
  intro: string;
  /** Shown with the empty list: what to add first. */
  emptyHint: string;
  namePlaceholder: string;
};

type NameListScreenProps = {
  title: string;
  icon: LucideIcon;
  copy: NameListCopy;
  maxNameLength: number;
  /** Null where there is no database (the web preview). */
  operations: NameListOperations | null;
  describeError: (error: unknown) => ErrorDescription;
  rowAction?: RowDialogAction;
};

type ListState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; records: readonly NamedRecord[] };

type FormState = { mode: 'add' } | { mode: 'rename'; record: NamedRecord };

type DeleteState = {
  record: NamedRecord;
  phase: 'confirm' | 'deleting' | 'blocked' | 'failed';
  message: string | null;
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A screen that manages one list of named records: view, add, rename, and
 * delete permanently. Subjects and Classes are both this screen with their own
 * words and use cases. It issues no SQL and knows no table.
 */
export function NameListScreen({
  title,
  icon,
  copy,
  maxNameLength,
  operations,
  describeError,
  rowAction,
}: NameListScreenProps) {
  const { noun, pluralNoun } = copy;
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [form, setForm] = useState<FormState | null>(null);
  const [deletion, setDeletion] = useState<DeleteState | null>(null);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const [rowDialogRecord, setRowDialogRecord] = useState<NamedRecord | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const loadingPhase = useLoadingPhase(operations !== null && list.status === 'loading');
  // A refresh of a list already on screen: the rows stay, the header shows a small spinner.
  const refreshPhase = useLoadingPhase(isRefreshing && list.status === 'ready');

  // Loads when the screen opens and again each time it is shown: screens stay
  // mounted in the tab shell, and another screen may have changed what a row
  // says (a deleted subject changes a class's subject count).
  useFocusEffect(
    useCallback(() => {
      if (!operations) return;
      let isCurrent = true;
      setIsRefreshing(true);
      operations
        .list()
        .then(
          (records) => {
            if (isCurrent) setList({ status: 'ready', records });
          },
          (error) => {
            console.error(error);
            if (isCurrent) setList({ status: 'failed' });
          }
        )
        .finally(() => {
          if (isCurrent) setIsRefreshing(false);
        });
      return () => {
        isCurrent = false;
      };
      // loadAttempt is not read: changing it is what makes "Try again" load again.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [operations, loadAttempt])
  );

  function retryLoading() {
    setList({ status: 'loading' });
    setLoadAttempt((attempt) => attempt + 1);
  }

  function announce(tone: NoticeMessage['tone'], text: string) {
    setNotice((previous) => ({ id: (previous?.id ?? 0) + 1, tone, text }));
    AccessibilityInfo.announceForAccessibility(text);
  }

  /** Reads the list again after a change, so the screen shows what is stored. */
  async function refresh(source: NameListOperations) {
    try {
      setList({ status: 'ready', records: await source.list() });
    } catch (error) {
      console.error(error);
      setList({ status: 'failed' });
    }
  }

  async function submitName(name: string): Promise<string | null> {
    if (!operations || !form) return null;
    try {
      if (form.mode === 'add') {
        await operations.add(name);
        announce('success', `${capitalize(noun)} created`);
      } else {
        const renamed = await operations.rename(form.record.id, name);
        if (renamed.name !== form.record.name) {
          announce('success', `${capitalize(noun)} renamed`);
        }
      }
    } catch (error) {
      const description = describeError(error);
      if (description.kind === 'missing') {
        setForm(null);
        announce('error', description.message);
        await refresh(operations);
        return null;
      }
      if (description.kind === 'failure') console.error(error);
      return description.message;
    }
    setForm(null);
    await refresh(operations);
    return null;
  }

  async function confirmDeletion() {
    if (!operations || !deletion || deletion.phase === 'deleting') return;
    const { record } = deletion;
    setDeletion({ record, phase: 'deleting', message: null });
    try {
      await operations.remove(record.id);
    } catch (error) {
      const description = describeError(error);
      if (description.kind === 'missing') {
        setDeletion(null);
        announce('error', description.message);
        await refresh(operations);
      } else if (description.kind === 'blocked') {
        setDeletion({ record, phase: 'blocked', message: description.message });
      } else {
        console.error(error);
        setDeletion({ record, phase: 'failed', message: description.message });
      }
      return;
    }
    setDeletion(null);
    announce('success', `${capitalize(noun)} deleted permanently`);
    await refresh(operations);
  }

  return (
    <Screen
      title={title}
      showBack
      refreshPhase={refreshPhase}
      overlay={
        notice && <Notice key={notice.id} notice={notice} onDismiss={() => setNotice(null)} />
      }>
      <View className="gap-4">
        <Text className="text-[15px] leading-[22px] text-muted-foreground">{copy.intro}</Text>
        {operations && (
          <Button className="h-12" onPress={() => setForm({ mode: 'add' })}>
            <Icon as={Plus} size={18} className="text-primary-foreground" />
            <Text>Add {noun}</Text>
          </Button>
        )}
      </View>

      {!operations ? (
        <Callout icon={Smartphone} title="Only on the phone">
          {capitalize(pluralNoun)} are stored in a database on the phone. This web preview has no
          database, so nothing can be added or shown here.
        </Callout>
      ) : list.status === 'loading' || loadingPhase !== 'content' ? (
        // Nothing for the first moment, then rows shaped like the list that is coming.
        <Pending phase={loadingPhase} label={`Loading ${pluralNoun}`}>
          <SkeletonRows rows={4} hasTrailing />
        </Pending>
      ) : list.status === 'failed' ? (
        <Callout
          icon={CircleAlert}
          tone="error"
          title={`The ${pluralNoun} could not be loaded`}
          action={
            <Button variant="outline" className="h-12 self-start" onPress={retryLoading}>
              <Text>Try again</Text>
            </Button>
          }>
          Nothing was changed.
        </Callout>
      ) : list.records.length === 0 ? (
        <Callout icon={icon} title={`No ${pluralNoun} yet`}>
          {copy.emptyHint}
        </Callout>
      ) : (
        <View className="gap-3">
          <Text variant="h4" aria-level="2" className="text-base">
            {list.records.length} {list.records.length === 1 ? noun : pluralNoun}
          </Text>
          <ItemGroup>
            {list.records.map((record) => (
              <View key={record.id} className="min-h-14 flex-row items-center pl-4 pr-1">
                <View className="flex-1 py-2">
                  <Text className="text-[15px] font-medium leading-[22px]">{record.name}</Text>
                  {record.detail !== undefined && (
                    <Text className="text-[13px] leading-[18px] text-muted-foreground">
                      {record.detail}
                    </Text>
                  )}
                </View>
                {rowAction && (
                  <RowAction
                    icon={rowAction.icon}
                    label={rowAction.label(record)}
                    onPress={() => setRowDialogRecord(record)}
                  />
                )}
                <RowAction
                  icon={Pencil}
                  label={`Rename ${record.name}`}
                  onPress={() => setForm({ mode: 'rename', record })}
                />
                <RowAction
                  icon={Trash}
                  label={`Delete ${record.name}`}
                  destructive
                  onPress={() => setDeletion({ record, phase: 'confirm', message: null })}
                />
              </View>
            ))}
          </ItemGroup>
        </View>
      )}

      {form && (
        <NameFormDialog
          title={form.mode === 'add' ? `Add ${noun}` : `Rename ${noun}`}
          fieldLabel={`${capitalize(noun)} name`}
          placeholder={copy.namePlaceholder}
          initialName={form.mode === 'add' ? '' : form.record.name}
          submitLabel={form.mode === 'add' ? `Add ${noun}` : 'Save name'}
          maxLength={maxNameLength}
          onSubmit={submitName}
          onCancel={() => setForm(null)}
        />
      )}

      {deletion && (
        <DeleteDialog
          name={deletion.record.name}
          noun={noun}
          isDeleting={deletion.phase === 'deleting'}
          blockedMessage={deletion.phase === 'blocked' ? deletion.message : null}
          failureMessage={deletion.phase === 'failed' ? deletion.message : null}
          onConfirm={confirmDeletion}
          onCancel={() => setDeletion(null)}
        />
      )}

      {operations &&
        rowAction &&
        rowDialogRecord &&
        rowAction.renderDialog(rowDialogRecord, {
          close: () => setRowDialogRecord(null),
          done: (message) => {
            setRowDialogRecord(null);
            announce('success', message);
            void refresh(operations);
          },
          missing: (message) => {
            setRowDialogRecord(null);
            announce('error', message);
            void refresh(operations);
          },
        })}
    </Screen>
  );
}
