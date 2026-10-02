import { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View, type TextInput } from 'react-native';

import { ModalCard } from '@/core/presentation/components/modal-card';
import { Button } from '@/core/presentation/components/ui/button';
import { Input } from '@/core/presentation/components/ui/input';
import { Text } from '@/core/presentation/components/ui/text';
import {
  findStudentProblems,
  normalizeStudentInput,
  STUDENT_ID_MAX_LENGTH,
  STUDENT_NAME_MAX_LENGTH,
  type StudentInput,
} from '@/features/students/domain/student';
import { ClassChoiceList } from '@/features/students/presentation/class-choice-list';
import {
  describeStudentProblem,
  type StudentField,
} from '@/features/students/presentation/describe-student-error';

export type StudentFormFailure = {
  /** The field the message belongs to, or null for a message about the whole save. */
  field: StudentField | null;
  message: string;
};

type StudentFormDialogProps = {
  mode: 'add' | 'edit';
  /** Empty strings and a null class when adding without a class filter. */
  initial: { studentNumber: string; fullName: string; classId: string | null };
  classes: readonly { id: string; name: string }[];
  /**
   * Saves the trimmed values. Resolves to null on success (the parent then
   * unmounts the dialog) or to what went wrong; the entered values are kept.
   */
  onSubmit: (input: StudentInput) => Promise<StudentFormFailure | null>;
  onCancel: () => void;
};

/**
 * Form for adding or editing one student: Student ID, full name, and class.
 * Moving a student is choosing another class here. It never creates a class.
 * Mount it only while it is open.
 */
export function StudentFormDialog({
  mode,
  initial,
  classes,
  onSubmit,
  onCancel,
}: StudentFormDialogProps) {
  const [studentNumber, setStudentNumber] = useState(initial.studentNumber);
  const [fullName, setFullName] = useState(initial.fullName);
  const [classId, setClassId] = useState(initial.classId);
  const [touched, setTouched] = useState<Partial<Record<StudentField, boolean>>>({});
  const [failure, setFailure] = useState<StudentFormFailure | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const firstInput = useRef<TextInput>(null);
  const nameInput = useRef<TextInput>(null);
  // State updates are not immediate; this stops a second tap in the same frame.
  const isSubmitting = useRef(false);

  const input = normalizeStudentInput({ studentNumber, fullName, classId: classId ?? '' });
  const problems = findStudentProblems(input);
  const canSubmit = problems.length === 0 && !isSaving;

  /** A too-long value is flagged at once; an empty one only after the field was left. */
  function messageFor(field: StudentField): string | null {
    if (failure?.field === field) return failure.message;
    const problem = problems.find((candidate) => candidate.field === field);
    if (!problem) return null;
    if (problem.problem === 'EMPTY' && !touched[field]) return null;
    return describeStudentProblem(problem);
  }

  const touch = (field: StudentField) => setTouched((current) => ({ ...current, [field]: true }));

  async function submit() {
    if (problems.length > 0) {
      setTouched({ studentNumber: true, fullName: true, classId: true });
      return;
    }
    if (isSubmitting.current) return;
    isSubmitting.current = true;
    setIsSaving(true);
    setFailure(null);
    const result = await onSubmit(input);
    if (result !== null) {
      isSubmitting.current = false;
      setIsSaving(false);
      setFailure(result);
    }
  }

  const idMessage = messageFor('studentNumber');
  const nameMessage = messageFor('fullName');
  const classMessage = messageFor('classId');

  return (
    <ModalCard
      position="top"
      onRequestClose={() => {
        if (!isSaving) onCancel();
      }}
      onShow={() => firstInput.current?.focus()}>
      <Text role="heading" aria-level="2" className="text-lg font-semibold leading-6">
        {mode === 'add' ? 'Add student' : 'Edit student'}
      </Text>

      <View className="gap-2">
        <Text className="text-sm font-medium">Student ID</Text>
        <Input
          ref={firstInput}
          value={studentNumber}
          onChangeText={(text) => {
            setStudentNumber(text);
            setFailure(null);
          }}
          onBlur={() => touch('studentNumber')}
          placeholder="2026-00125"
          accessibilityLabel="Student ID"
          aria-invalid={idMessage !== null}
          autoFocus={mode === 'add'}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => nameInput.current?.focus()}
          editable={!isSaving}
          className={idMessage !== null ? 'border-destructive' : undefined}
        />
        <FieldNote
          message={idMessage}
          hint={`The ID your school gives the student. Up to ${STUDENT_ID_MAX_LENGTH} characters.`}
        />
      </View>

      <View className="gap-2">
        <Text className="text-sm font-medium">Full name</Text>
        <Input
          ref={nameInput}
          value={fullName}
          onChangeText={(text) => {
            setFullName(text);
            setFailure(null);
          }}
          onBlur={() => touch('fullName')}
          placeholder="Maria Santos"
          accessibilityLabel="Full name"
          aria-invalid={nameMessage !== null}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          editable={!isSaving}
          className={nameMessage !== null ? 'border-destructive' : undefined}
        />
        <FieldNote message={nameMessage} hint={`Up to ${STUDENT_NAME_MAX_LENGTH} characters.`} />
      </View>

      <View className="gap-2">
        <Text className="text-sm font-medium">Class</Text>
        <View
          className={
            classMessage !== null
              ? 'overflow-hidden rounded-lg border border-destructive'
              : 'overflow-hidden rounded-lg border border-border'
          }>
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 196 }}>
            <ClassChoiceList
              label="Class"
              classes={classes}
              selectedId={classId}
              disabled={isSaving}
              onSelect={(chosen) => {
                setClassId(chosen);
                setFailure(null);
                touch('classId');
              }}
            />
          </ScrollView>
        </View>
        <FieldNote
          message={classMessage}
          hint={
            mode === 'edit'
              ? 'Choose another class to move the student.'
              : 'A student belongs to one class.'
          }
        />
      </View>

      {failure !== null && failure.field === null && (
        <Text
          accessibilityLiveRegion="polite"
          role="alert"
          className="text-sm leading-5 text-destructive">
          {failure.message}
        </Text>
      )}

      <View className="flex-row gap-3">
        <Button variant="outline" className="h-12 flex-1" disabled={isSaving} onPress={onCancel}>
          <Text>Cancel</Text>
        </Button>
        <Button
          className="h-12 flex-1"
          disabled={!canSubmit}
          aria-disabled={!canSubmit}
          aria-busy={isSaving}
          onPress={submit}>
          {isSaving && <ActivityIndicator size="small" className="text-primary-foreground" />}
          <Text>{isSaving ? 'Saving' : mode === 'add' ? 'Add student' : 'Save changes'}</Text>
        </Button>
      </View>
    </ModalCard>
  );
}

/** The line under a field: what is wrong with it, or otherwise what it is for. */
function FieldNote({ message, hint }: { message: string | null; hint: string }) {
  return message !== null ? (
    <Text accessibilityLiveRegion="polite" role="alert" className="text-sm leading-5 text-destructive">
      {message}
    </Text>
  ) : (
    <Text className="text-sm leading-5 text-muted-foreground">{hint}</Text>
  );
}
