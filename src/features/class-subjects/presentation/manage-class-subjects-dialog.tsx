import Check from 'lucide-react-native/icons/check';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { ModalCard } from '@/core/presentation/components/modal-card';
import { Button } from '@/core/presentation/components/ui/button';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { cn } from '@/core/presentation/lib/utils';
import {
  ClassNotFoundError,
  SubjectNotFoundError,
} from '@/features/class-subjects/application/class-subject-repository';
import type { ClassSubjectUseCases } from '@/features/class-subjects/application/class-subject-use-cases';
import type { SubjectUseCases } from '@/features/subjects/application/subject-use-cases';
import type { Subject } from '@/features/subjects/domain/subject';

type ManageClassSubjectsDialogProps = {
  schoolClass: { id: string; name: string };
  subjectUseCases: SubjectUseCases;
  classSubjectUseCases: ClassSubjectUseCases;
  onCancel: () => void;
  /** The selection was stored. The message is for the notice and the screen reader. */
  onSaved: (message: string) => void;
  /** The class was deleted in the meantime; nothing was stored. */
  onClassMissing: (message: string) => void;
};

type Loaded =
  | { status: 'loading' }
  | { status: 'failed'; isClassMissing: boolean }
  | { status: 'ready'; subjects: readonly Subject[] };

const UNEXPECTED = 'Something went wrong on this device. Nothing was changed. Try again.';

/**
 * Chooses which subjects are taught to one class. Nothing is stored until
 * "Save changes", which replaces the whole selection in one transaction.
 * Mount it only while it is open.
 */
export function ManageClassSubjectsDialog({
  schoolClass,
  subjectUseCases,
  classSubjectUseCases,
  onCancel,
  onSaved,
  onClassMissing,
}: ManageClassSubjectsDialogProps) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // State updates are not immediate; this stops a second tap in the same frame.
  const isSubmitting = useRef(false);

  useEffect(() => {
    let isCurrent = true;
    Promise.all([
      subjectUseCases.listSubjects(),
      classSubjectUseCases.listSubjectsForClass(schoolClass.id),
    ]).then(
      ([subjects, assigned]) => {
        if (!isCurrent) return;
        setSelected(new Set(assigned.map((subject) => subject.id)));
        setLoaded({ status: 'ready', subjects });
      },
      (error) => {
        if (!isCurrent) return;
        const isClassMissing = error instanceof ClassNotFoundError;
        if (!isClassMissing) console.error(error);
        setLoaded({ status: 'failed', isClassMissing });
      }
    );
    return () => {
      isCurrent = false;
    };
  }, [subjectUseCases, classSubjectUseCases, schoolClass.id, loadAttempt]);

  function toggle(subjectId: string) {
    if (isSaving) return;
    setSaveError(null);
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(subjectId)) next.add(subjectId);
      return next;
    });
  }

  async function save() {
    if (loaded.status !== 'ready' || isSubmitting.current) return;
    isSubmitting.current = true;
    setIsSaving(true);
    setSaveError(null);
    try {
      await classSubjectUseCases.replaceSubjectsForClass(schoolClass.id, [...selected]);
    } catch (error) {
      isSubmitting.current = false;
      setIsSaving(false);
      if (error instanceof ClassNotFoundError) {
        onClassMissing('That class no longer exists.');
      } else if (error instanceof SubjectNotFoundError) {
        // Keep the rest of the selection; drop only the subject that is gone.
        try {
          const subjects = await subjectUseCases.listSubjects();
          const known = new Set(subjects.map((subject) => subject.id));
          setSelected((current) => new Set([...current].filter((id) => known.has(id))));
          setLoaded({ status: 'ready', subjects });
          setSaveError('A subject no longer exists. The list was updated. Check it and save again.');
        } catch (reloadError) {
          console.error(reloadError);
          setSaveError(UNEXPECTED);
        }
      } else {
        console.error(error);
        setSaveError(UNEXPECTED);
      }
      return;
    }
    onSaved(`Subjects saved for ${schoolClass.name}`);
  }

  const subjects = loaded.status === 'ready' ? loaded.subjects : [];
  const hasSubjects = subjects.length > 0;
  const selectedCount = subjects.filter((subject) => selected.has(subject.id)).length;

  return (
    <ModalCard
      onRequestClose={() => {
        if (!isSaving) onCancel();
      }}>
      <View className="gap-1">
        <Text role="heading" aria-level="2" className="text-lg font-semibold leading-6">
          Subjects for {schoolClass.name}
        </Text>
        <Text className="text-sm leading-5 text-muted-foreground">
          {loaded.status === 'ready' && hasSubjects
            ? `${selectedCount} of ${subjects.length} selected`
            : 'Choose the subjects taught to this class.'}
        </Text>
      </View>

      {loaded.status === 'loading' ? (
        <View accessible accessibilityLabel="Loading subjects" className="min-h-12 flex-row items-center gap-3">
          <ActivityIndicator className="text-primary" />
          <Text className="text-sm text-muted-foreground">Loading subjects</Text>
        </View>
      ) : loaded.status === 'failed' && loaded.isClassMissing ? (
        <Text role="alert" className="text-sm leading-5 text-destructive">
          That class no longer exists.
        </Text>
      ) : loaded.status === 'failed' ? (
        <View className="gap-3">
          <Text role="alert" className="text-sm leading-5 text-destructive">
            The subjects could not be loaded. Nothing was changed.
          </Text>
          <Button
            variant="outline"
            className="h-12 self-start"
            onPress={() => {
              setLoaded({ status: 'loading' });
              setLoadAttempt((attempt) => attempt + 1);
            }}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : !hasSubjects ? (
        <View className="gap-1 rounded-lg bg-muted p-3">
          <Text className="text-sm font-semibold leading-5">No subjects yet</Text>
          <Text className="text-sm leading-5 text-muted-foreground">
            Add subjects first, then come back to choose them for this class: Home → More →
            Subjects.
          </Text>
        </View>
      ) : (
        <View className="overflow-hidden rounded-lg border border-border">
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator style={{ maxHeight: 312 }}>
            {subjects.map((subject, index) => (
              <SubjectOption
                key={subject.id}
                name={subject.name}
                isSelected={selected.has(subject.id)}
                isFirst={index === 0}
                disabled={isSaving}
                onPress={() => toggle(subject.id)}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {saveError !== null && (
        <Text accessibilityLiveRegion="polite" role="alert" className="text-sm leading-5 text-destructive">
          {saveError}
        </Text>
      )}

      {loaded.status === 'ready' && hasSubjects ? (
        <View className="flex-row gap-3">
          <Button variant="outline" className="h-12 flex-1" disabled={isSaving} onPress={onCancel}>
            <Text>Cancel</Text>
          </Button>
          <Button className="h-12 flex-1" disabled={isSaving} aria-busy={isSaving} onPress={save}>
            {isSaving && <ActivityIndicator size="small" className="text-primary-foreground" />}
            <Text>{isSaving ? 'Saving' : 'Save changes'}</Text>
          </Button>
        </View>
      ) : (
        <Button
          variant="outline"
          className="h-12"
          onPress={() => {
            if (loaded.status === 'failed' && loaded.isClassMissing) {
              onClassMissing('That class no longer exists.');
            } else {
              onCancel();
            }
          }}>
          <Text>Close</Text>
        </Button>
      )}
    </ModalCard>
  );
}

type SubjectOptionProps = {
  name: string;
  isSelected: boolean;
  isFirst: boolean;
  disabled: boolean;
  onPress: () => void;
};

/** A whole-row checkbox. Selection shows as a filled box with a check, not by color alone. */
function SubjectOption({ name, isSelected, isFirst, disabled, onPress }: SubjectOptionProps) {
  const { isPressed, pressHandlers } = usePressFeedback();

  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      disabled={disabled}
      role="checkbox"
      aria-checked={isSelected}
      accessibilityLabel={name}
      className={cn(
        'min-h-[52px] flex-row items-center gap-3 px-3 py-2 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
        !isFirst && 'border-t border-border',
        isSelected && 'bg-accent/50',
        isPressed && 'bg-secondary',
        disabled && 'opacity-60'
      )}>
      <View
        className={cn(
          'h-6 w-6 items-center justify-center rounded-md border-2',
          isSelected ? 'border-primary bg-primary' : 'border-input'
        )}>
        {isSelected && (
          <Icon as={Check} size={16} strokeWidth={3} className="text-primary-foreground" />
        )}
      </View>
      <Text className="flex-1 text-[15px] font-medium leading-[22px]">{name}</Text>
    </Pressable>
  );
}
