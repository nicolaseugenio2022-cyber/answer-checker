import type { LucideIcon } from 'lucide-react-native';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import Pencil from 'lucide-react-native/icons/pencil';
import Plus from 'lucide-react-native/icons/plus';
import Smartphone from 'lucide-react-native/icons/smartphone';
import Trash from 'lucide-react-native/icons/trash';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, View } from 'react-native';

import { DeleteDialog } from '@/core/presentation/components/delete-dialog';
import { GLASS_CLASSES } from '@/core/presentation/components/glass-surface';
import { ItemGroup } from '@/core/presentation/components/item';
import { NameFormDialog } from '@/core/presentation/components/name-form-dialog';
import { Notice, type NoticeMessage } from '@/core/presentation/components/notice';
import { Screen } from '@/core/presentation/components/screen';
import { Button } from '@/core/presentation/components/ui/button';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import type { ErrorDescription } from '@/core/presentation/lib/describe-name-error';
import { cn } from '@/core/presentation/lib/utils';

export type NamedRecord = { id: string; name: string };

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
}: NameListScreenProps) {
  const { noun, pluralNoun } = copy;
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [form, setForm] = useState<FormState | null>(null);
  const [deletion, setDeletion] = useState<DeleteState | null>(null);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);

  useEffect(() => {
    if (!operations) return;
    let isCurrent = true;
    operations.list().then(
      (records) => {
        if (isCurrent) setList({ status: 'ready', records });
      },
      (error) => {
        console.error(error);
        if (isCurrent) setList({ status: 'failed' });
      }
    );
    return () => {
      isCurrent = false;
    };
  }, [operations, loadAttempt]);

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
      ) : list.status === 'loading' ? (
        <View
          accessible
          accessibilityLabel={`Loading ${pluralNoun}`}
          className="min-h-12 flex-row items-center gap-3">
          <ActivityIndicator className="text-primary" />
          <Text className="text-sm text-muted-foreground">Loading {pluralNoun}</Text>
        </View>
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
                <Text className="flex-1 py-2 text-[15px] font-medium leading-[22px]">
                  {record.name}
                </Text>
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
    </Screen>
  );
}

type CalloutProps = {
  icon: LucideIcon;
  title: string;
  tone?: 'neutral' | 'error';
  /** The explanation, as plain text. */
  children: React.ReactNode;
  action?: React.ReactNode;
};

/** The one panel a list state uses to explain itself: empty, failed, or device-only. */
function Callout({ icon, title, tone = 'neutral', children, action }: CalloutProps) {
  return (
    <View className={cn('flex-row items-start gap-3 rounded-lg p-4', GLASS_CLASSES)}>
      <View
        className={cn(
          'h-10 w-10 items-center justify-center rounded-md',
          tone === 'error' ? 'bg-destructive/15' : 'bg-accent'
        )}>
        <Icon
          as={icon}
          size={18}
          className={tone === 'error' ? 'text-destructive' : 'text-accent-foreground'}
        />
      </View>
      <View className="flex-1 gap-1">
        <Text className="text-[15px] font-semibold leading-[22px]">{title}</Text>
        <Text className="text-sm leading-5 text-muted-foreground">{children}</Text>
        {action && <View className="pt-2">{action}</View>}
      </View>
    </View>
  );
}

type RowActionProps = {
  icon: LucideIcon;
  /** Accessible name that includes the record, such as "Rename Mathematics". */
  label: string;
  destructive?: boolean;
  onPress: () => void;
};

/** A 48dp icon button at the end of a list row. */
function RowAction({ icon, label, destructive = false, onPress }: RowActionProps) {
  const { isPressed, pressHandlers } = usePressFeedback();

  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={cn(
        'h-12 w-12 items-center justify-center rounded-md web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
        isPressed && (destructive ? 'bg-destructive/15' : 'bg-secondary')
      )}>
      <Icon
        as={icon}
        size={20}
        className={destructive ? 'text-destructive' : 'text-muted-foreground'}
      />
    </Pressable>
  );
}
