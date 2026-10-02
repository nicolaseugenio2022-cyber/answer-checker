import { useFocusEffect, useRouter } from 'expo-router';
import Camera from 'lucide-react-native/icons/camera';
import Check from 'lucide-react-native/icons/check';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import Printer from 'lucide-react-native/icons/printer';
import ScanLine from 'lucide-react-native/icons/scan-line';
import Smartphone from 'lucide-react-native/icons/smartphone';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Platform, Pressable, View } from 'react-native';

import { Callout } from '@/core/presentation/components/callout';
import { GLASS_CLASSES } from '@/core/presentation/components/glass-surface';
import { ModalCard } from '@/core/presentation/components/modal-card';
import { Notice, type NoticeMessage } from '@/core/presentation/components/notice';
import { PickerSheet, type PickerOption } from '@/core/presentation/components/picker-sheet';
import { Screen } from '@/core/presentation/components/screen';
import { Button } from '@/core/presentation/components/ui/button';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { countOf } from '@/core/presentation/lib/describe-name-error';
import { cn } from '@/core/presentation/lib/utils';
import { destinationTitle } from '@/core/presentation/navigation/destinations';
import { takeIntent } from '@/core/presentation/navigation/screen-intent';
import { DuplicateAttemptError, type PreviousAttempt } from '@/features/scan/application/scan-ports';
import type { ScanDraft, ScanOptions } from '@/features/scan/application/scan-use-cases';
import type { ReviewItem } from '@/features/scan/domain/detection';
import {
  EMPTY_SELECTION,
  isComplete,
  selectAnswerKey,
  selectClass,
  selectStudent,
  selectSubject,
  type ScanSelection,
} from '@/features/scan/domain/selection';
import { CameraCaptureDialog } from '@/features/scan/presentation/camera-capture-dialog';
import { describeScanError } from '@/features/scan/presentation/describe-scan-error';
import {
  ScanReviewDialog,
  type ReviewSaveOutcome,
} from '@/features/scan/presentation/scan-review-dialog';
import { useScanUseCases } from '@/features/scan/presentation/scan-use-cases-context';

type Loaded =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; options: ScanOptions };

type Field = 'subject' | 'answerKey' | 'class' | 'student';

/** The order the choices are made in. */
const FIELDS: readonly Field[] = ['subject', 'answerKey', 'class', 'student'];

/** The first choice still to make, or null when all four are made. */
function nextFieldOf(selection: ScanSelection): Field | null {
  if (selection.subjectId === null) return 'subject';
  if (selection.answerKeyId === null) return 'answerKey';
  if (selection.classId === null) return 'class';
  if (selection.studentId === null) return 'student';
  return null;
}

/** Where the Teacher is in one scan, after the four choices are made. */
type Step =
  | { name: 'select' }
  | { name: 'camera' }
  | { name: 'reading' }
  | { name: 'rejected'; title: string; message: string; canRetake: boolean }
  | { name: 'review'; draft: ScanDraft }
  | { name: 'saved'; studentName: string; score: number; total: number };

const INTRO = 'Choose who you are checking, then photograph the answer sheet.';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const scannedTag = (count: number) =>
  count === 0 ? undefined : count === 1 ? 'Scanned' : `Scanned ${count} times`;

/**
 * Scan: set up a scanning session (subject, answer key, class, student, in
 * that order), take one photo of the sheet, review what was read, and save the
 * result. Subject, answer key, and class stay for the next student. It calls
 * use cases only: no SQL, no file paths, no image processing here.
 */
export function ScanScreen() {
  const scan = useScanUseCases();
  const router = useRouter();

  const [selection, setSelection] = useState<ScanSelection>(EMPTY_SELECTION);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [attempts, setAttempts] = useState<PreviousAttempt[]>([]);
  const [picker, setPicker] = useState<Field | null>(null);
  const [step, setStep] = useState<Step>({ name: 'select' });
  const [isSharing, setIsSharing] = useState(false);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  // The draft on screen, so its preview file can be removed if the screen goes away.
  const openDraft = useRef<ScanDraft | null>(null);
  // The four setup rows, to put screen-reader focus back on one when a picker closes.
  const subjectRow = useRef<View>(null);
  const answerKeyRow = useRef<View>(null);
  const classRow = useRef<View>(null);
  const studentRow = useRef<View>(null);
  // Where focus goes once the picker is closed: a row, or the next choice still to make.
  const focusAfterPicker = useRef<Field | 'next' | null>(null);

  // A picker closed: focus returns to the row it was opened from, or, after a
  // choice, moves on to the next row that still needs one.
  useEffect(() => {
    const wanted = focusAfterPicker.current;
    if (picker !== null || wanted === null) return;
    const field = wanted === 'next' ? nextFieldOf(selection) : wanted;
    focusAfterPicker.current = null;
    if (field === null) return;
    // After the sheet has gone and the rows show the new choice.
    const timer = setTimeout(() => {
      const row = { subject: subjectRow, answerKey: answerKeyRow, class: classRow, student: studentRow }[field].current;
      if (!row) return;
      if (Platform.OS === 'web') (row as unknown as { focus?: () => void }).focus?.();
      else AccessibilityInfo.sendAccessibilityEvent(row, 'focus');
    }, 350);
    return () => clearTimeout(timer);
  }, [picker, selection]);

  function announce(tone: NoticeMessage['tone'], text: string) {
    setNotice((previous) => ({ id: (previous?.id ?? 0) + 1, tone, text }));
    AccessibilityInfo.announceForAccessibility(text);
  }

  // The lists depend on what is chosen so far, and are read again each time the
  // screen is shown: subjects, keys, classes, and students are edited elsewhere.
  useFocusEffect(
    useCallback(() => {
      if (!scan) return;
      let isCurrent = true;
      Promise.all([scan.listOptions(selection), scan.previousAttempts(selection)]).then(
        ([options, previous]) => {
          if (!isCurrent) return;
          setLoaded({ status: 'ready', options });
          setAttempts(previous);
        },
        (error) => {
          console.error(error);
          if (isCurrent) setLoaded({ status: 'failed' });
        }
      );
      return () => {
        isCurrent = false;
      };
      // loadAttempt is not read: changing it is what makes "Try again" load again.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scan, selection, loadAttempt])
  );

  // Home's "Continue scanning": start with the subject, answer key, and class
  // of the last scan, checked against the database, and no student.
  useFocusEffect(
    useCallback(() => {
      if (!scan) return;
      const intent = takeIntent('scan');
      if (!intent) return;
      let isCurrent = true;
      void scan.resumeSession(intent).then((resumed) => {
        if (isCurrent) setSelection(resumed);
      });
      return () => {
        isCurrent = false;
      };
    }, [scan])
  );

  // Once per visit: remove scan files left behind by an interrupted session.
  useFocusEffect(
    useCallback(() => {
      if (scan && openDraft.current === null) void scan.cleanUpScanFiles();
    }, [scan])
  );

  // Leaving the screen for good with a scan still open: its preview is removed.
  useEffect(() => {
    return () => {
      if (scan && openDraft.current) void scan.discardDraft(openDraft.current);
    };
  }, [scan]);

  const options = loaded.status === 'ready' ? loaded.options : null;

  // A choice that is no longer offered (deleted or reassigned elsewhere) does not count as chosen.
  const subject = options?.subjects.find((option) => option.id === selection.subjectId) ?? null;
  const answerKey = options?.answerKeys.find((key) => key.id === selection.answerKeyId) ?? null;
  const schoolClass = options?.classes.find((option) => option.id === selection.classId) ?? null;
  const student = options?.students.find((option) => option.id === selection.studentId) ?? null;
  const isValid =
    isComplete(selection) &&
    subject !== null &&
    answerKey !== null &&
    answerKey.fitsSheet &&
    schoolClass !== null &&
    student !== null;

  const stillNeeded: string[] = [];
  if (subject === null) stillNeeded.push('a subject');
  if (answerKey === null) stillNeeded.push('an answer key');
  if (schoolClass === null) stillNeeded.push('a class');
  if (student === null) stillNeeded.push('a student');

  async function chooseSubject(subjectId: string) {
    if (!scan) return;
    try {
      const classIds = await scan.classIdsOfSubject(subjectId);
      setSelection((current) => selectSubject(current, subjectId, classIds));
    } catch (error) {
      console.error(error);
      setLoaded({ status: 'failed' });
    }
  }

  function choose(field: Field, id: string) {
    const current = { subject: selection.subjectId, answerKey: selection.answerKeyId, class: selection.classId, student: selection.studentId }[field];
    // The same value again changes nothing, so focus goes back to the row.
    focusAfterPicker.current = id === current ? field : 'next';
    setPicker(null);
    if (field === 'subject') void chooseSubject(id);
    else if (field === 'answerKey') setSelection((current) => selectAnswerKey(current, id));
    else if (field === 'class') setSelection((current) => selectClass(current, id));
    else setSelection((current) => selectStudent(current, id));
  }

  function closeDraft(draft: ScanDraft) {
    openDraft.current = null;
    if (scan) void scan.discardDraft(draft);
  }

  async function read(captureUri: string) {
    if (!scan) return;
    setStep({ name: 'reading' });
    // Let the "Reading the sheet" message appear before the reading occupies the phone.
    await new Promise((resolve) => setTimeout(resolve, 60));
    try {
      const draft = await scan.readCapture(captureUri, selection);
      openDraft.current = draft;
      setStep({ name: 'review', draft });
    } catch (error) {
      const failure = describeScanError(error);
      if (failure.kind === 'failure') console.error(error);
      setStep({
        name: 'rejected',
        title: failure.title,
        message: failure.message,
        // A selection that no longer holds cannot be fixed by another photo.
        canRetake: failure.kind !== 'selection',
      });
      if (failure.kind === 'selection') setLoadAttempt((attempt) => attempt + 1);
    }
  }

  async function save(
    draft: ScanDraft,
    review: ReviewItem[],
    confirmDuplicate: boolean
  ): Promise<ReviewSaveOutcome> {
    if (!scan) return { kind: 'failed', title: '', message: '', canRetry: false };
    try {
      const saved = await scan.saveResult(draft, review, { confirmDuplicate });
      openDraft.current = null;
      // The session stays: subject, answer key, and class. Only the student is cleared.
      setSelection((current) => selectStudent(current, null));
      setStep({
        name: 'saved',
        studentName: draft.target.student.fullName,
        score: saved.score,
        total: saved.total,
      });
      AccessibilityInfo.announceForAccessibility(
        `Result saved for ${draft.target.student.fullName}: ${saved.score} of ${saved.total}`
      );
      return { kind: 'saved' };
    } catch (error) {
      if (error instanceof DuplicateAttemptError) return { kind: 'duplicate', previous: error.previous };
      const failure = describeScanError(error);
      if (failure.kind === 'failure') console.error(error);
      return {
        kind: 'failed',
        title: failure.title,
        message: failure.message,
        // After a changed key or selection the sheet must be scanned again.
        canRetry: failure.kind === 'failure' || failure.kind === 'review',
      };
    }
  }

  /** Makes and shares the sheet for the chosen answer key's exact number of questions. */
  async function sharePrintableSheet() {
    if (!scan || isSharing || !answerKey || !answerKey.fitsSheet) return;
    setIsSharing(true);
    try {
      await scan.sharePrintableSheet(answerKey.questionCount);
    } catch (error) {
      announce('error', describeScanError(error).message);
    } finally {
      setIsSharing(false);
    }
  }

  /** Android back, a tap outside, the close button, or a drag down: nothing changes. */
  function cancelPicker(field: Field) {
    focusAfterPicker.current = field;
    setPicker(null);
  }

  /** Leaves Scan for the screen where the missing record is added. */
  function openFromPicker(route: '/keys' | '/students') {
    focusAfterPicker.current = null;
    setPicker(null);
    router.navigate(route);
  }

  /** The options of the open picker, with what each row needs to say. */
  function pickerContent(field: Field, lists: ScanOptions) {
    if (field === 'subject') {
      return {
        title: 'Choose subject',
        context: undefined,
        searchPlaceholder: 'Search subjects',
        selectedId: selection.subjectId,
        empty: {
          title: 'No subjects yet',
          message: 'Add a subject from Home, More, Subjects.',
          action: undefined,
        },
        options: lists.subjects.map((option): PickerOption => ({ id: option.id, name: option.name })),
      };
    }
    if (field === 'answerKey') {
      return {
        title: 'Choose answer key',
        context: subject ? `Subject: ${subject.name}` : undefined,
        searchPlaceholder: 'Search answer keys',
        selectedId: selection.answerKeyId,
        empty: {
          title: `No answer keys for ${subject?.name ?? 'this subject'}`,
          message: 'An answer key holds the correct answers of one test. Create it in Keys, then come back to scan.',
          action: { label: 'Create answer key', route: '/keys' as const },
        },
        options: lists.answerKeys.map(
          (key): PickerOption => ({
            id: key.id,
            name: key.name,
            detail: countOf(key.questionCount, 'question'),
            disabledReason: key.fitsSheet
              ? undefined
              : `${key.questionCount} questions. One answer sheet holds at most ${lists.maxSheetQuestions}.`,
          })
        ),
      };
    }
    if (field === 'class') {
      return {
        title: 'Choose class',
        context: subject ? `Classes that take ${subject.name}` : undefined,
        searchPlaceholder: 'Search classes',
        selectedId: selection.classId,
        empty: {
          title: `No class takes ${subject?.name ?? 'this subject'}`,
          message: 'Assign the subject to a class from Home, More, Classes, Manage subjects.',
          action: undefined,
        },
        options: lists.classes.map((option): PickerOption => ({ id: option.id, name: option.name })),
      };
    }
    return {
      title: 'Choose student',
      context: schoolClass
        ? `Class: ${schoolClass.name}${answerKey ? `, ${scannedCount} of ${lists.students.length} scanned` : ''}`
        : undefined,
      searchPlaceholder: 'Search students by name or Student ID',
      selectedId: selection.studentId,
      empty: {
        title: `No students in ${schoolClass?.name ?? 'this class'}`,
        message: 'Add students one by one or import a class list in Students.',
        action: { label: 'Add students', route: '/students' as const },
      },
      options: lists.students.map(
        (option): PickerOption => ({
          id: option.id,
          name: option.name,
          detail: option.studentNumber,
          tag: scannedTag(option.scanCount),
        })
      ),
    };
  }

  const scannedCount = options?.students.filter((option) => option.scanCount > 0).length ?? 0;
  const openPicker = picker !== null && options !== null ? pickerContent(picker, options) : null;
  const pickerAction = openPicker?.empty.action;
  // The row the Teacher should look at next: the first one without a usable choice.
  const chosen = { subject, answerKey, class: schoolClass, student };
  const nextField = FIELDS.find((field) => chosen[field] === null) ?? null;

  return (
    <Screen
      title={destinationTitle('scan')}
      overlay={
        notice && <Notice key={notice.id} notice={notice} onDismiss={() => setNotice(null)} />
      }>
      <Text className="text-[15px] leading-[22px] text-muted-foreground">{INTRO}</Text>

      {!scan ? (
        <Callout icon={Smartphone} title="Only on the phone">
          Scanning uses the phone&apos;s camera and its database. This web preview has neither, so
          nothing can be scanned here.
        </Callout>
      ) : loaded.status === 'loading' ? (
        <View accessible accessibilityLabel="Loading" className="min-h-12 flex-row items-center gap-3">
          <ActivityIndicator className="text-primary" />
          <Text className="text-sm text-muted-foreground">Loading</Text>
        </View>
      ) : loaded.status === 'failed' || options === null ? (
        <Callout
          icon={CircleAlert}
          tone="error"
          title="The lists could not be loaded"
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
      ) : options.subjects.length === 0 ? (
        <Callout icon={ScanLine} title="Nothing to scan for yet">
          Scanning needs a subject, an answer key, a class that takes the subject, and a student.
          Add them from Home, Keys, and Students first.
        </Callout>
      ) : (
        <>
          {/* The scanning session: four choices in one card, made top to bottom. */}
          <View className={cn('overflow-hidden rounded-xl', GLASS_CLASSES)}>
            <SessionRow
              ref={subjectRow}
              isNext={nextField === 'subject'}
              label="Subject"
              value={subject?.name ?? null}
              placeholder="Choose a subject"
              isFirst
              onPress={() => setPicker('subject')}
            />
            <SessionRow
              ref={answerKeyRow}
              isNext={nextField === 'answerKey'}
              label="Answer key"
              value={answerKey?.name ?? null}
              detail={
                answerKey
                  ? answerKey.fitsSheet
                    ? countOf(answerKey.questionCount, 'question')
                    : `${answerKey.questionCount} questions, more than one sheet holds`
                  : undefined
              }
              hasProblem={answerKey !== null && !answerKey.fitsSheet}
              placeholder="Choose an answer key"
              lockedHint={subject === null ? 'Choose a subject first' : null}
              onPress={() => setPicker('answerKey')}
            />
            <SessionRow
              ref={classRow}
              isNext={nextField === 'class'}
              label="Class"
              value={schoolClass?.name ?? null}
              detail={
                schoolClass && answerKey && options.students.length > 0
                  ? `${scannedCount} of ${options.students.length} scanned`
                  : undefined
              }
              placeholder="Choose a class"
              lockedHint={subject === null ? 'Choose a subject first' : null}
              onPress={() => setPicker('class')}
            />
            <SessionRow
              ref={studentRow}
              isNext={nextField === 'student'}
              label="Student"
              value={student?.name ?? null}
              detail={student ? `Student ID ${student.studentNumber}` : undefined}
              placeholder="Choose a student"
              lockedHint={schoolClass === null ? 'Choose a class first' : null}
              onPress={() => setPicker('student')}
            />
          </View>

          <View className="gap-3">
            {isValid && attempts.length > 0 && (
              <View className="rounded-lg bg-muted p-3">
                <Text className="text-sm leading-5">
                  {student?.name} already has {countOf(attempts.length, 'result')} for this answer
                  key: {attempts[0].score} of {attempts[0].total}, saved{' '}
                  {formatDate(attempts[0].createdAt)}. Another scan is saved as a separate attempt,
                  after you confirm.
                </Text>
              </View>
            )}
            <Button className="h-12" disabled={!isValid} onPress={() => setStep({ name: 'camera' })}>
              <Icon as={Camera} size={18} className="text-primary-foreground" />
              <Text>Open camera</Text>
            </Button>
            <Text
              accessibilityLiveRegion="polite"
              className={cn(
                'text-sm leading-5',
                isValid ? 'text-muted-foreground' : 'font-medium text-foreground'
              )}>
              {stillNeeded.length > 0
                ? `Still to choose: ${stillNeeded.join(', ')}.`
                : answerKey && !answerKey.fitsSheet
                  ? `This answer key has ${answerKey.questionCount} questions and one answer sheet holds at most ${options.maxSheetQuestions}. Choose an answer key that fits.`
                  : `Questions 1 to ${answerKey?.questionCount} will be checked.`}
            </Text>
          </View>

          <View className="gap-2 rounded-lg border border-border bg-card p-3">
            <Text className="text-sm leading-5">
              {!answerKey
                ? 'Choose an answer key to get its answer sheet. The sheet is made for the exact number of questions of the answer key.'
                : !answerKey.fitsSheet
                  ? `One answer sheet holds at most ${options.maxSheetQuestions} questions, so there is no sheet for this answer key.`
                  : `This answer sheet contains ${countOf(answerKey.questionCount, 'question')} with choices A–D. Print one for each student.`}
            </Text>
            <Button
              variant="outline"
              className="h-12 self-start"
              disabled={isSharing || !answerKey || !answerKey.fitsSheet}
              aria-busy={isSharing}
              onPress={() => void sharePrintableSheet()}>
              {isSharing ? (
                <ActivityIndicator size="small" className="text-foreground" />
              ) : (
                <Icon as={Printer} size={18} />
              )}
              <Text>View or share printable sheet</Text>
            </Button>
          </View>
        </>
      )}

      {openPicker && picker && (
        <PickerSheet
          key={picker}
          title={openPicker.title}
          context={openPicker.context}
          searchPlaceholder={openPicker.searchPlaceholder}
          options={openPicker.options}
          selectedId={openPicker.selectedId}
          empty={{
            title: openPicker.empty.title,
            message: openPicker.empty.message,
            action: pickerAction && {
              label: pickerAction.label,
              onPress: () => openFromPicker(pickerAction.route),
            },
          }}
          onSelect={(id) => choose(picker, id)}
          onClose={() => cancelPicker(picker)}
        />
      )}

      {step.name === 'camera' && student && answerKey && (
        <CameraCaptureDialog
          studentName={`${student.name} (${student.studentNumber})`}
          answerKeyName={answerKey.name}
          onCaptured={(uri) => void read(uri)}
          onCancel={() => setStep({ name: 'select' })}
        />
      )}

      {step.name === 'reading' && (
        <ModalCard onRequestClose={() => undefined}>
          <View accessible accessibilityLabel="Reading the sheet" className="flex-row items-center gap-3">
            <ActivityIndicator className="text-primary" />
            <View className="flex-1">
              <Text className="text-base font-semibold leading-6">Reading the sheet</Text>
              <Text className="text-sm leading-5 text-muted-foreground">
                This takes a few seconds and happens on this phone.
              </Text>
            </View>
          </View>
        </ModalCard>
      )}

      {step.name === 'rejected' && (
        <ModalCard onRequestClose={() => setStep({ name: 'select' })}>
          <View className="gap-2">
            <Text role="heading" aria-level="2" className="text-lg font-semibold leading-6">
              {step.title}
            </Text>
            <Text accessibilityLiveRegion="polite" className="text-[15px] leading-[22px]">
              {step.message}
            </Text>
            <Text className="text-sm leading-5 text-muted-foreground">
              No answers were read and nothing was saved.
            </Text>
          </View>
          <View className="flex-row gap-3">
            <Button
              variant="outline"
              className="h-12 flex-1"
              onPress={() => setStep({ name: 'select' })}>
              <Text>{step.canRetake ? 'Cancel' : 'Close'}</Text>
            </Button>
            {step.canRetake && (
              <Button className="h-12 flex-1" onPress={() => setStep({ name: 'camera' })}>
                <Text>Retake</Text>
              </Button>
            )}
          </View>
        </ModalCard>
      )}

      {step.name === 'review' && (
        <ScanReviewDialog
          draft={step.draft}
          onSave={(review, confirmDuplicate) => save(step.draft, review, confirmDuplicate)}
          onRetake={() => {
            closeDraft(step.draft);
            setStep({ name: 'camera' });
          }}
          onCancel={() => {
            closeDraft(step.draft);
            setStep({ name: 'select' });
          }}
        />
      )}

      {step.name === 'saved' && (
        <ModalCard onRequestClose={() => setStep({ name: 'select' })}>
          <View className="flex-row items-start gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-primary">
              <Icon as={Check} size={20} strokeWidth={3} className="text-primary-foreground" />
            </View>
            <View className="flex-1 gap-1">
              <Text role="heading" aria-level="2" className="text-lg font-semibold leading-6">
                Result saved
              </Text>
              <Text className="text-[15px] leading-[22px]">
                {step.studentName}: {step.score} of {step.total}
              </Text>
              <Text className="text-sm leading-5 text-muted-foreground">
                {schoolClass && subject
                  ? `The next scan stays with ${subject.name}, ${answerKey?.name ?? 'the same answer key'}, and ${schoolClass.name}.`
                  : 'Choose the next student to keep scanning.'}
              </Text>
            </View>
          </View>
          <View className="flex-row gap-3">
            <Button
              variant="outline"
              className="h-12 flex-1"
              onPress={() => setStep({ name: 'select' })}>
              <Text>Done</Text>
            </Button>
            <Button
              className="h-12 flex-1"
              onPress={() => {
                setStep({ name: 'select' });
                setPicker('student');
              }}>
              <Text>Scan next student</Text>
            </Button>
          </View>
        </ModalCard>
      )}
    </Screen>
  );
}

type SessionRowProps = {
  label: string;
  /** The chosen record's name, or null while nothing is chosen. */
  value: string | null;
  /** A second line under the value. */
  detail?: string;
  placeholder: string;
  /** Set while the row above it is not chosen: the row is off and says why. */
  lockedHint?: string | null;
  /** The value is chosen but cannot be used; shown instead of the check. */
  hasProblem?: boolean;
  /** The first row still without a choice: drawn so the eye lands on it. */
  isNext?: boolean;
  isFirst?: boolean;
  ref?: React.Ref<View>;
  onPress: () => void;
};

/** One choice of the session: its label, what is chosen, and a check once it is. */
function SessionRow({
  label,
  value,
  detail,
  placeholder,
  lockedHint = null,
  hasProblem = false,
  isNext = false,
  isFirst = false,
  ref,
  onPress,
}: SessionRowProps) {
  const { isPressed, pressHandlers } = usePressFeedback();
  const isLocked = lockedHint !== null;
  const isDone = value !== null && !hasProblem;
  const secondary = isLocked ? lockedHint : value === null ? undefined : detail;

  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      {...pressHandlers}
      disabled={isLocked}
      accessibilityRole="button"
      accessibilityState={{ disabled: isLocked }}
      accessibilityLabel={
        isLocked
          ? `${label}. ${lockedHint}.`
          : value === null
            ? `${label}. ${placeholder}.`
            : `${label}: ${value}${detail ? `, ${detail}` : ''}. ${hasProblem ? 'Cannot be scanned.' : 'Chosen.'} Change.`
      }
      className={cn(
        'min-h-[68px] flex-row items-center gap-3 px-3 py-2 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
        !isFirst && 'border-t border-glass-border/15',
        isNext && !isLocked && 'bg-primary/10',
        isPressed && 'bg-secondary',
        isLocked && 'opacity-50'
      )}>
      <View
        className={cn(
          'h-7 w-7 items-center justify-center rounded-full',
          isDone
            ? 'bg-primary'
            : hasProblem
              ? 'bg-destructive/15'
              : isNext && !isLocked
                ? 'border-2 border-primary'
                : 'border-2 border-input'
        )}>
        {isDone && <Icon as={Check} size={16} strokeWidth={3} className="text-primary-foreground" />}
        {hasProblem && <Icon as={CircleAlert} size={16} className="text-destructive" />}
      </View>
      <View className="flex-1">
        <Text className="text-xs font-medium leading-4 text-muted-foreground">{label}</Text>
        <Text
          numberOfLines={1}
          className={cn(
            'text-[15px] leading-[22px]',
            value !== null
              ? 'font-semibold'
              : isNext && !isLocked
                ? 'font-medium text-foreground'
                : 'text-muted-foreground'
          )}>
          {value ?? placeholder}
        </Text>
        {secondary !== undefined && (
          <Text
            numberOfLines={1}
            className={cn(
              'text-[13px] leading-[18px]',
              hasProblem ? 'text-destructive' : 'text-muted-foreground'
            )}>
            {secondary}
          </Text>
        )}
      </View>
      <Icon
        as={ChevronRight}
        size={18}
        className={isNext && !isLocked ? 'text-primary' : 'text-muted-foreground'}
      />
    </Pressable>
  );
}
