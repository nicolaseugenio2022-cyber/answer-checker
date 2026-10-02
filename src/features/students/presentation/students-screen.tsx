import { useFocusEffect } from 'expo-router';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import FileUp from 'lucide-react-native/icons/file-up';
import GraduationCap from 'lucide-react-native/icons/graduation-cap';
import Pencil from 'lucide-react-native/icons/pencil';
import Search from 'lucide-react-native/icons/search';
import Smartphone from 'lucide-react-native/icons/smartphone';
import Trash from 'lucide-react-native/icons/trash';
import UserPlus from 'lucide-react-native/icons/user-plus';
import Users from 'lucide-react-native/icons/users';
import { useCallback, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, ScrollView, View } from 'react-native';

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
import { countOf } from '@/core/presentation/lib/describe-name-error';
import { destinationTitle } from '@/core/presentation/navigation/destinations';
import { takeIntent } from '@/core/presentation/navigation/screen-intent';
import { useClassUseCases } from '@/features/classes/presentation/class-use-cases-context';
import type { RosterDraft } from '@/features/students/application/roster-import';
import type { StudentWithClass } from '@/features/students/application/student-repository';
import { matchesStudentSearch, type StudentInput } from '@/features/students/domain/student';
import {
  describeStudentError,
  fieldOfStudentError,
} from '@/features/students/presentation/describe-student-error';
import { RosterImportDialog } from '@/features/students/presentation/roster-import-dialog';
import {
  StudentFormDialog,
  type StudentFormFailure,
} from '@/features/students/presentation/student-form-dialog';
import { useStudentUseCases } from '@/features/students/presentation/student-use-cases-context';

type ClassOption = { id: string; name: string };

type Loaded =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; students: readonly StudentWithClass[]; classes: readonly ClassOption[] };

type FormState = { mode: 'add' } | { mode: 'edit'; student: StudentWithClass };

type DeleteState = {
  student: StudentWithClass;
  phase: 'confirm' | 'deleting' | 'blocked' | 'failed';
  message: string | null;
};

const INTRO = 'Every student belongs to one class. Add them one at a time, or import a class roster.';

/**
 * Students: browse by class, search, add, edit, move, delete permanently, and
 * import a roster from a CSV file. It calls use cases only; it issues no SQL
 * and never sees a file path.
 */
export function StudentsScreen() {
  const useCases = useStudentUseCases();
  const classUseCases = useClassUseCases();

  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [deletion, setDeletion] = useState<DeleteState | null>(null);
  const [draft, setDraft] = useState<RosterDraft | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isAvailable = useCases !== null && classUseCases !== null;

  /** Reads the students and the classes together, so the two always agree. */
  const load = useCallback(async (): Promise<Loaded> => {
    if (!useCases || !classUseCases) return { status: 'loading' };
    try {
      const [students, classes] = await Promise.all([
        useCases.listStudents(),
        classUseCases.listClasses(),
      ]);
      return { status: 'ready', students, classes };
    } catch (error) {
      console.error(error);
      return { status: 'failed' };
    }
  }, [useCases, classUseCases]);

  // Loads when the screen opens and again each time it is shown: screens stay
  // mounted in the tab shell, and classes are edited on another screen.
  useFocusEffect(
    useCallback(() => {
      let isCurrent = true;
      setIsRefreshing(true);
      load().then((result) => {
        if (!isCurrent) return;
        setIsRefreshing(false);
        setLoaded(result);
        // Opened from Home's "Add student". Without a class the screen explains what is missing.
        const intent = takeIntent('students');
        if (intent && result.status === 'ready' && result.classes.length > 0) {
          setForm({ mode: 'add' });
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

  const loadingPhase = useLoadingPhase(isAvailable && loaded.status === 'loading');
  // A refresh of a list already on screen: the rows stay, the header shows a small spinner.
  const refreshPhase = useLoadingPhase(isRefreshing && loaded.status === 'ready');

  function announce(tone: NoticeMessage['tone'], text: string) {
    setNotice((previous) => ({ id: (previous?.id ?? 0) + 1, tone, text }));
    AccessibilityInfo.announceForAccessibility(text);
  }

  const classes = loaded.status === 'ready' ? loaded.classes : [];
  const allStudents = loaded.status === 'ready' ? loaded.students : [];
  // A filter for a class that was deleted elsewhere falls back to all classes.
  const activeFilter = classes.some((schoolClass) => schoolClass.id === classFilter)
    ? classFilter
    : null;
  const visible = allStudents.filter(
    (student) =>
      (activeFilter === null || student.classId === activeFilter) &&
      matchesStudentSearch(student, search)
  );
  // The list arrives ordered by class, so students of a class are adjacent.
  const groups: { classId: string; className: string; students: StudentWithClass[] }[] = [];
  for (const student of visible) {
    const last = groups[groups.length - 1];
    if (last?.classId === student.classId) last.students.push(student);
    else groups.push({ classId: student.classId, className: student.className, students: [student] });
  }
  const isFiltering = search.trim().length > 0 || activeFilter !== null;
  const canAdd = loaded.status === 'ready' && classes.length > 0;

  async function submitStudent(input: StudentInput): Promise<StudentFormFailure | null> {
    if (!useCases || !form) return null;
    try {
      if (form.mode === 'add') {
        await useCases.addStudent(input);
        announce('success', 'Student added');
      } else {
        const before = form.student;
        const after = await useCases.updateStudent(before.id, input);
        if (after.classId !== before.classId) {
          const destination = classes.find((schoolClass) => schoolClass.id === after.classId);
          announce('success', `Student moved to ${destination?.name ?? 'the class'}`);
        } else if (after.updatedAt !== before.updatedAt) {
          announce('success', 'Student updated');
        }
      }
    } catch (error) {
      const description = describeStudentError(error);
      if (description.kind === 'missing') {
        setForm(null);
        announce('error', description.message);
        await refresh();
        return null;
      }
      if (description.kind === 'failure') console.error(error);
      return { field: fieldOfStudentError(error), message: description.message };
    }
    setForm(null);
    await refresh();
    return null;
  }

  async function confirmDeletion() {
    if (!useCases || !deletion || deletion.phase === 'deleting') return;
    const { student } = deletion;
    setDeletion({ student, phase: 'deleting', message: null });
    try {
      await useCases.deleteStudent(student.id);
    } catch (error) {
      const description = describeStudentError(error);
      if (description.kind === 'missing') {
        setDeletion(null);
        announce('error', description.message);
        await refresh();
      } else if (description.kind === 'blocked') {
        setDeletion({ student, phase: 'blocked', message: description.message });
      } else {
        console.error(error);
        setDeletion({ student, phase: 'failed', message: description.message });
      }
      return;
    }
    setDeletion(null);
    announce('success', 'Student deleted permanently');
    await refresh();
  }

  async function pickRoster() {
    if (!useCases || isPicking) return;
    setIsPicking(true);
    try {
      // The use case reads the file and releases it before returning.
      const picked = await useCases.pickRoster();
      if (picked) setDraft(picked);
    } catch (error) {
      const description = describeStudentError(error);
      if (description.kind === 'failure') console.error(error);
      announce('error', description.message);
    } finally {
      setIsPicking(false);
    }
  }

  async function importRoster(students: StudentInput[]): Promise<string | null> {
    if (!useCases) return null;
    let added: number;
    try {
      added = await useCases.importStudents(students);
    } catch (error) {
      const description = describeStudentError(error);
      if (description.kind === 'failure') console.error(error);
      return `${description.message} No student was added.`;
    }
    setDraft(null);
    announce('success', `${countOf(added, 'student')} imported`);
    await refresh();
    return null;
  }

  return (
    <Screen
      title={destinationTitle('students')}
      refreshPhase={refreshPhase}
      overlay={
        notice && <Notice key={notice.id} notice={notice} onDismiss={() => setNotice(null)} />
      }>
      <View className="gap-4">
        <Text className="text-[15px] leading-[22px] text-muted-foreground">{INTRO}</Text>
        {isAvailable && (
          <View className="flex-row gap-3">
            <Button className="h-12 flex-1" disabled={!canAdd} onPress={() => setForm({ mode: 'add' })}>
              <Icon as={UserPlus} size={18} className="text-primary-foreground" />
              <Text>Add student</Text>
            </Button>
            <Button
              variant="outline"
              className="h-12 flex-1"
              disabled={!canAdd || isPicking}
              aria-busy={isPicking}
              onPress={pickRoster}>
              {isPicking ? <ActivityIndicator size="small" className="text-foreground" /> : <Icon as={FileUp} size={18} />}
              <Text>Import CSV</Text>
            </Button>
          </View>
        )}
      </View>

      {!isAvailable ? (
        <Callout icon={Smartphone} title="Only on the phone">
          Students are stored in a database on the phone. This web preview has no database, so
          nothing can be added, imported, or shown here.
        </Callout>
      ) : loaded.status === 'loading' || loadingPhase !== 'content' ? (
        <Pending phase={loadingPhase} label="Loading students" className="gap-4">
          <SkeletonListControls chips={3} />
          <SkeletonRows rows={5} hasTrailing />
        </Pending>
      ) : loaded.status === 'failed' ? (
        <Callout
          icon={CircleAlert}
          tone="error"
          title="The students could not be loaded"
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
      ) : classes.length === 0 ? (
        <Callout icon={Users} title="Add a class first">
          A student is always put in a class. Add one from Home → More → Classes, then come back.
        </Callout>
      ) : allStudents.length === 0 ? (
        <Callout icon={GraduationCap} title="No students yet">
          Add a student, or import a roster: a CSV file whose first row is student_id,full_name.
        </Callout>
      ) : (
        <>
          <View className="gap-3">
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name or Student ID"
              accessibilityLabel="Search students by name or Student ID"
            />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              accessibilityRole="radiogroup"
              accessibilityLabel="Show students of"
              // The chips scroll to the screen edges, past the screen's own padding.
              style={{ marginHorizontal: -16 }}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
              <FilterChip
                label="All classes"
                isSelected={activeFilter === null}
                onPress={() => setClassFilter(null)}
              />
              {classes.map((schoolClass) => (
                <FilterChip
                  key={schoolClass.id}
                  label={schoolClass.name}
                  isSelected={activeFilter === schoolClass.id}
                  onPress={() => setClassFilter(schoolClass.id)}
                />
              ))}
            </ScrollView>
          </View>

          {groups.length === 0 ? (
            <Callout
              icon={Search}
              title="No students match"
              action={
                isFiltering && (
                  <Button
                    variant="outline"
                    className="h-12 self-start"
                    onPress={() => {
                      setSearch('');
                      setClassFilter(null);
                    }}>
                    <Text>Show all students</Text>
                  </Button>
                )
              }>
              {search.trim().length > 0
                ? 'No name or Student ID contains what you typed.'
                : 'This class has no students yet.'}
            </Callout>
          ) : (
            <>
              <Text accessibilityLiveRegion="polite" className="text-sm text-muted-foreground">
                {isFiltering
                  ? `${countOf(visible.length, 'student')} of ${allStudents.length}`
                  : countOf(allStudents.length, 'student')}
              </Text>
              {groups.map((group) => (
                <View key={group.classId} className="gap-2.5">
                  <View className="flex-row items-center gap-2">
                    <View className="h-4 w-1 rounded-full bg-primary" />
                    <Text variant="h4" aria-level="2" className="flex-1 text-base">
                      {group.className}
                    </Text>
                    <Text className="text-sm text-muted-foreground">{group.students.length}</Text>
                  </View>
                  <ItemGroup>
                    {group.students.map((student) => (
                      <View key={student.id} className="min-h-14 flex-row items-center pl-4 pr-1">
                        <View className="flex-1 py-2">
                          <Text className="text-[15px] font-medium leading-[22px]">
                            {student.fullName}
                          </Text>
                          <Text className="text-[13px] leading-[18px] text-muted-foreground">
                            {student.studentNumber}
                          </Text>
                        </View>
                        <RowAction
                          icon={Pencil}
                          label={`Edit ${student.fullName}, Student ID ${student.studentNumber}`}
                          onPress={() => setForm({ mode: 'edit', student })}
                        />
                        <RowAction
                          icon={Trash}
                          label={`Delete ${student.fullName}, Student ID ${student.studentNumber}`}
                          destructive
                          onPress={() => setDeletion({ student, phase: 'confirm', message: null })}
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
        <StudentFormDialog
          mode={form.mode}
          initial={
            form.mode === 'edit'
              ? form.student
              : {
                  studentNumber: '',
                  fullName: '',
                  // The class being viewed, or the only class there is.
                  classId: activeFilter ?? (classes.length === 1 ? classes[0].id : null),
                }
          }
          classes={classes}
          onSubmit={submitStudent}
          onCancel={() => setForm(null)}
        />
      )}

      {deletion && (
        <DeleteDialog
          name={`${deletion.student.fullName} (${deletion.student.studentNumber})`}
          noun="student"
          isDeleting={deletion.phase === 'deleting'}
          blockedMessage={deletion.phase === 'blocked' ? deletion.message : null}
          failureMessage={deletion.phase === 'failed' ? deletion.message : null}
          onConfirm={confirmDeletion}
          onCancel={() => setDeletion(null)}
        />
      )}

      {draft && (
        <RosterImportDialog draft={draft} onConfirm={importRoster} onCancel={() => setDraft(null)} />
      )}
    </Screen>
  );
}
