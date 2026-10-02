import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackdrop } from '@/core/presentation/components/app-backdrop';
import { Button } from '@/core/presentation/components/ui/button';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { countOf } from '@/core/presentation/lib/describe-name-error';
import { cn } from '@/core/presentation/lib/utils';
import {
  initialRosterSelection,
  resolveRoster,
  type RosterDraft,
  type RosterDraftGroup,
  type RosterSelection,
} from '@/features/students/application/roster-import';
import type { StudentInput } from '@/features/students/domain/student';
import { ClassChoiceList } from '@/features/students/presentation/class-choice-list';
import { describeRosterRowProblems } from '@/features/students/presentation/describe-student-error';

type RosterImportDialogProps = {
  /** The checked roster. The file it came from has already been released. */
  draft: RosterDraft;
  /**
   * Stores the rows. Resolves to null on success (the parent then unmounts the
   * dialog) or to a message; the Teacher's choices are kept.
   */
  onConfirm: (students: StudentInput[]) => Promise<string | null>;
  onCancel: () => void;
};

const students = (count: number) => countOf(count, 'student');

/**
 * The import preview: what the file contains, where each row will go, and what
 * will be left out and why. Nothing is stored until the Teacher confirms, and
 * the button says how many students that adds. Mount it only while it is open.
 */
export function RosterImportDialog({ draft, onConfirm, onCancel }: RosterImportDialogProps) {
  const insets = useSafeAreaInsets();
  const [selection, setSelection] = useState<RosterSelection>(() => initialRosterSelection(draft));
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // State updates are not immediate; this stops a second tap in the same frame.
  const isSubmitting = useRef(false);

  const resolution = resolveRoster(draft, selection);
  const importCount = resolution.importable.length;
  const className = (classId: string | null) =>
    draft.classes.find((schoolClass) => schoolClass.id === classId)?.name ?? null;

  async function confirm() {
    if (importCount === 0 || isSubmitting.current) return;
    isSubmitting.current = true;
    setIsSaving(true);
    setFailure(null);
    const message = await onConfirm(resolution.importable);
    if (message !== null) {
      isSubmitting.current = false;
      setIsSaving(false);
      setFailure(message);
    }
  }

  return (
    <Modal
      visible
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => {
        if (!isSaving) onCancel();
      }}>
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <AppBackdrop />
        <View className="min-h-14 justify-center px-4">
          <Text
            role="heading"
            aria-level="1"
            numberOfLines={1}
            className="text-2xl font-semibold leading-8 tracking-tight">
            Import students
          </Text>
        </View>

        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <View className="w-full max-w-2xl gap-5 self-center px-4 pb-6 pt-2">
            <View className="overflow-hidden rounded-lg border border-border bg-card">
              <SummaryRow label="File" value={draft.fileName} isFirst />
              <SummaryRow label="Rows in the file" value={String(draft.totalRows)} />
              <SummaryRow label="Ready to add" value={String(draft.rows.length)} />
              <SummaryRow label="Invalid rows" value={String(draft.invalid.length)} />
              <SummaryRow label="Repeated in the file" value={String(draft.duplicates.length)} />
              <SummaryRow label="Already in the app" value={String(draft.existing.length)} />
              {draft.format === 'MULTI_CLASS' && (
                <SummaryRow
                  label="Groups without a class"
                  value={String(resolution.unresolvedGroupCount)}
                  isWarning={resolution.unresolvedGroupCount > 0}
                />
              )}
              <SummaryRow label="Will be added" value={students(importCount)} isStrong />
            </View>

            {draft.rows.length > 0 && draft.format === 'SINGLE_CLASS' && (
              <Section title="Add these students to">
                <View className="overflow-hidden rounded-lg border border-border bg-card">
                  <ClassChoiceList
                    label="Class for these students"
                    classes={draft.classes}
                    selectedId={selection.destinationClassId}
                    disabled={isSaving}
                    onSelect={(classId) => {
                      setFailure(null);
                      setSelection((current) => ({ ...current, destinationClassId: classId }));
                    }}
                  />
                </View>
              </Section>
            )}

            {draft.format === 'MULTI_CLASS' && draft.groups.length > 0 && (
              <Section
                title="Match each group to a class"
                note="A group is one grade_and_section and course from the file. Only an exact match is chosen for you. A group without a class is left out.">
                {draft.groups.map((group) => (
                  <GroupMapping
                    key={group.key}
                    group={group}
                    chosenClassName={className(selection.groupClassIds[group.key] ?? null)}
                    isOpen={openGroupKey === group.key}
                    onToggle={() =>
                      setOpenGroupKey((current) => (current === group.key ? null : group.key))
                    }>
                    <ClassChoiceList
                      label={`Class for ${group.gradeAndSection} ${group.course}`}
                      classes={draft.classes}
                      selectedId={selection.groupClassIds[group.key] ?? null}
                      noneLabel="Leave this group out"
                      disabled={isSaving}
                      onSelect={(classId) => {
                        setFailure(null);
                        setOpenGroupKey(null);
                        setSelection((current) => ({
                          ...current,
                          groupClassIds: { ...current.groupClassIds, [group.key]: classId },
                        }));
                      }}
                    />
                  </GroupMapping>
                ))}
              </Section>
            )}

            {draft.invalid.length > 0 && (
              <Section
                title={`Invalid rows (${draft.invalid.length})`}
                note="These rows are left out. Correct them in the file and import it again to add them.">
                <RowList
                  rows={draft.invalid.map((row) => ({
                    rowNumber: row.rowNumber,
                    text: [row.studentNumber, row.fullName].filter(Boolean).join(', '),
                    reason: describeRosterRowProblems(row.problems),
                  }))}
                />
              </Section>
            )}

            {draft.duplicates.length > 0 && (
              <Section
                title={`Repeated in the file (${draft.duplicates.length})`}
                note="A Student ID can be used once. The first row with it is kept; these are left out.">
                <RowList
                  rows={draft.duplicates.map((row) => ({
                    rowNumber: row.rowNumber,
                    text: `${row.studentNumber}, ${row.fullName}`,
                    reason: `Same Student ID as row ${row.firstRowNumber}.`,
                  }))}
                />
              </Section>
            )}

            {draft.existing.length > 0 && (
              <Section
                title={`Already in the app (${draft.existing.length})`}
                note="A student with this Student ID exists. The stored student is not changed.">
                <RowList
                  rows={draft.existing.map((row) => ({
                    rowNumber: row.rowNumber,
                    text: `${row.studentNumber}, ${row.fullName}`,
                    reason: null,
                  }))}
                />
              </Section>
            )}
          </View>
        </ScrollView>

        <View
          className="gap-3 border-t border-border bg-card px-4 pt-3"
          style={{ paddingBottom: insets.bottom + 12 }}>
          {failure !== null ? (
            <Text
              accessibilityLiveRegion="polite"
              role="alert"
              className="text-sm leading-5 text-destructive">
              {failure}
            </Text>
          ) : (
            <Text className="text-sm leading-5 text-muted-foreground">
              {importCount === 0
                ? draft.rows.length === 0
                  ? 'No row in this file can be added.'
                  : 'Choose a class to add these students.'
                : resolution.unresolvedRowCount > 0
                  ? `${students(resolution.unresolvedRowCount)} without a class will be left out.`
                  : 'The file itself is not kept. Only the students are stored.'}
            </Text>
          )}
          <View className="flex-row gap-3">
            <Button variant="outline" className="h-12 flex-1" disabled={isSaving} onPress={onCancel}>
              <Text>Cancel</Text>
            </Button>
            <Button
              className="h-12 flex-1"
              disabled={importCount === 0 || isSaving}
              aria-disabled={importCount === 0 || isSaving}
              aria-busy={isSaving}
              onPress={confirm}>
              {isSaving && <ActivityIndicator size="small" className="text-primary-foreground" />}
              <Text>{isSaving ? 'Adding' : `Add ${students(importCount)}`}</Text>
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <View className="gap-2.5">
      <View className="gap-1">
        <Text variant="h4" aria-level="2" className="text-base">
          {title}
        </Text>
        {note !== undefined && (
          <Text className="text-sm leading-5 text-muted-foreground">{note}</Text>
        )}
      </View>
      {children}
    </View>
  );
}

type SummaryRowProps = {
  label: string;
  value: string;
  isFirst?: boolean;
  isStrong?: boolean;
  isWarning?: boolean;
};

function SummaryRow({ label, value, isFirst, isStrong, isWarning }: SummaryRowProps) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      className={cn(
        'min-h-11 flex-row items-center gap-3 px-3 py-2',
        !isFirst && 'border-t border-border',
        isStrong && 'bg-accent/50'
      )}>
      <Text className={cn('text-sm leading-5', isStrong ? 'font-semibold' : 'text-muted-foreground')}>
        {label}
      </Text>
      <View className="flex-1 flex-row items-center justify-end gap-1.5">
        {isWarning && <Icon as={TriangleAlert} size={14} className="text-destructive" />}
        <Text
          numberOfLines={1}
          ellipsizeMode="middle"
          className={cn('shrink text-right text-sm leading-5', isStrong ? 'font-semibold' : 'font-medium')}>
          {value}
        </Text>
      </View>
    </View>
  );
}

type GroupMappingProps = {
  group: RosterDraftGroup;
  chosenClassName: string | null;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
};

/** One group of the file and the class it will go to; opens to change the class. */
function GroupMapping({ group, chosenClassName, isOpen, onToggle, children }: GroupMappingProps) {
  const { isPressed, pressHandlers } = usePressFeedback();
  const title = [group.gradeAndSection, group.course].filter(Boolean).join(', ');
  const status =
    chosenClassName !== null
      ? `Goes to ${chosenClassName}`
      : group.isAmbiguous
        ? 'More than one class matches. Choose one.'
        : 'No class chosen. Left out.';

  return (
    <View className="overflow-hidden rounded-lg border border-border bg-card">
      <Pressable
        onPress={onToggle}
        {...pressHandlers}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        accessibilityLabel={`${title}, ${students(group.rowCount)}. ${status}`}
        className={cn(
          'min-h-14 flex-row items-center gap-3 px-3 py-2 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
          isPressed && 'bg-secondary'
        )}>
        <View
          className={cn(
            'h-8 w-8 items-center justify-center rounded-full',
            chosenClassName !== null ? 'bg-primary' : 'bg-destructive/15'
          )}>
          <Icon
            as={chosenClassName !== null ? Check : TriangleAlert}
            size={16}
            strokeWidth={chosenClassName !== null ? 3 : 2}
            className={chosenClassName !== null ? 'text-primary-foreground' : 'text-destructive'}
          />
        </View>
        <View className="flex-1">
          <Text className="text-[15px] font-medium leading-[22px]">
            {title} ({students(group.rowCount)})
          </Text>
          <Text
            className={cn(
              'text-[13px] leading-[18px]',
              chosenClassName !== null ? 'text-muted-foreground' : 'text-destructive'
            )}>
            {status}
          </Text>
        </View>
        <Icon as={isOpen ? ChevronUp : ChevronDown} size={18} className="text-muted-foreground" />
      </Pressable>
      {isOpen && <View className="border-t border-border">{children}</View>}
    </View>
  );
}

type RowListProps = {
  rows: { rowNumber: number; text: string; reason: string | null }[];
};

/** Rows that are left out, each with its line number in the CSV file. */
function RowList({ rows }: RowListProps) {
  return (
    <View className="overflow-hidden rounded-lg border border-border bg-card">
      {rows.map((row, index) => (
        <View
          key={row.rowNumber}
          className={cn('gap-0.5 px-3 py-2', index > 0 && 'border-t border-border')}>
          <Text className="text-sm font-medium leading-5">
            Row {row.rowNumber}
            {row.text.length > 0 ? `: ${row.text}` : ''}
          </Text>
          {row.reason !== null && (
            <Text className="text-[13px] leading-[18px] text-muted-foreground">{row.reason}</Text>
          )}
        </View>
      ))}
    </View>
  );
}
