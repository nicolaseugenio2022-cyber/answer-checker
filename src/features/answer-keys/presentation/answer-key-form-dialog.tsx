import Lock from 'lucide-react-native/icons/lock';
import Minus from 'lucide-react-native/icons/minus';
import Plus from 'lucide-react-native/icons/plus';
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackdrop } from '@/core/presentation/components/app-backdrop';
import { ChoiceList } from '@/core/presentation/components/choice-list';
import { ModalCard } from '@/core/presentation/components/modal-card';
import { Button } from '@/core/presentation/components/ui/button';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Input } from '@/core/presentation/components/ui/input';
import { Text } from '@/core/presentation/components/ui/text';
import { useKeyboardHeight } from '@/core/presentation/hooks/use-keyboard-height';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { countOf } from '@/core/presentation/lib/describe-name-error';
import { cn } from '@/core/presentation/lib/utils';
import {
  ANSWER_CHOICES,
  ANSWER_KEY_MAX_QUESTIONS,
  ANSWER_KEY_MIN_QUESTIONS,
  ANSWER_KEY_NAME_MAX_LENGTH,
  validateAnswerKeyInput,
  type AnswerChoice,
  type AnswerKeyInput,
} from '@/features/answer-keys/domain/answer-key';
import {
  describeLock,
  type AnswerKeyField,
} from '@/features/answer-keys/presentation/describe-answer-key-error';

export type AnswerKeyFormFailure = {
  /** The field the message belongs to, or null for a message about the whole save. */
  field: AnswerKeyField | null;
  message: string;
};

export type AnswerKeyFormValues = {
  name: string;
  subjectId: string | null;
  /** One entry per question; null where no answer is chosen yet. */
  answers: readonly (AnswerChoice | null)[];
};

type AnswerKeyFormDialogProps = {
  mode: 'create' | 'edit' | 'duplicate';
  initial: AnswerKeyFormValues;
  subjects: readonly { id: string; name: string }[];
  /**
   * Saved results scored with the key being edited. Above zero, only the name
   * can change.
   */
  lockedResultCount?: number;
  /**
   * Saves the key. Resolves to null on success (the parent then unmounts the
   * dialog) or to what went wrong; everything entered is kept.
   */
  onSubmit: (input: AnswerKeyInput) => Promise<AnswerKeyFormFailure | null>;
  onCancel: () => void;
};

const TITLES = {
  create: 'Create answer key',
  edit: 'Edit answer key',
  duplicate: 'Duplicate answer key',
} as const;

const SAVE_LABELS = {
  create: 'Create answer key',
  edit: 'Save changes',
  duplicate: 'Save copy',
} as const;

const clampCount = (count: number) =>
  Math.min(ANSWER_KEY_MAX_QUESTIONS, Math.max(ANSWER_KEY_MIN_QUESTIONS, count));

/**
 * The full-screen form for an answer key: name, subject, question count, and
 * the correct answer of every question. It never asks for a class. Nothing is
 * stored until every question has an answer and the Teacher saves. Mount it
 * only while it is open.
 */
export function AnswerKeyFormDialog({
  mode,
  initial,
  subjects,
  lockedResultCount = 0,
  onSubmit,
  onCancel,
}: AnswerKeyFormDialogProps) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();

  const [name, setName] = useState(initial.name);
  const [subjectId, setSubjectId] = useState(initial.subjectId);
  const [answers, setAnswers] = useState<(AnswerChoice | null)[]>([...initial.answers]);
  const [countText, setCountText] = useState(String(initial.answers.length));
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [showUnanswered, setShowUnanswered] = useState(false);
  const [failure, setFailure] = useState<AnswerKeyFormFailure | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // State updates are not immediate; this stops a second tap in the same frame.
  const isSubmitting = useRef(false);

  const scroll = useRef<ScrollView>(null);
  const answersTop = useRef(0);
  const rowTops = useRef<number[]>([]);

  const isLocked = lockedResultCount > 0;
  const questionCount = answers.length;
  const answeredCount = answers.filter((answer) => answer !== null).length;
  const firstUnanswered = answers.findIndex((answer) => answer === null);

  const input: AnswerKeyInput = { name, subjectId: subjectId ?? '', questionCount, answers };
  const validation = validateAnswerKeyInput(input);
  const problems = validation.ok ? [] : validation.problems;
  const nameProblem = problems.find((problem) => problem.field === 'name');
  const canSave = validation.ok && !isSaving;

  const isDirty =
    name !== initial.name ||
    subjectId !== initial.subjectId ||
    answers.length !== initial.answers.length ||
    answers.some((answer, index) => answer !== initial.answers[index]);

  function applyCount(count: number) {
    setAnswers((current) =>
      count <= current.length
        ? current.slice(0, count)
        : [...current, ...Array<null>(count - current.length).fill(null)]
    );
    setCountText(String(count));
    setFailure(null);
  }

  /** Changes the question count; asks first when that would throw answers away. */
  function requestCount(requested: number) {
    if (isLocked || isSaving) return;
    const count = clampCount(Number.isFinite(requested) ? Math.round(requested) : questionCount);
    if (count < questionCount && answers.slice(count).some((answer) => answer !== null)) {
      setPendingCount(count);
    } else {
      applyCount(count);
    }
  }

  function choose(index: number, choice: AnswerChoice) {
    if (isLocked || isSaving) return;
    setFailure(null);
    setAnswers((current) =>
      current.map((answer, position) =>
        // Tapping the chosen letter again clears it, to undo a slip.
        position === index ? (answer === choice ? null : choice) : answer
      )
    );
  }

  function goToFirstUnanswered() {
    if (firstUnanswered < 0) return;
    setShowUnanswered(true);
    const top = answersTop.current + (rowTops.current[firstUnanswered] ?? 0);
    scroll.current?.scrollTo({ y: Math.max(0, top - 16), animated: true });
  }

  function requestCancel() {
    if (isSaving) return;
    if (isDirty) setIsConfirmingDiscard(true);
    else onCancel();
  }

  async function submit() {
    if (!validation.ok) {
      // Not reachable through the disabled button; kept for the keyboard's Done key.
      goToFirstUnanswered();
      return;
    }
    if (isSubmitting.current) return;
    isSubmitting.current = true;
    setIsSaving(true);
    setFailure(null);
    const result = await onSubmit(validation.value);
    if (result !== null) {
      isSubmitting.current = false;
      setIsSaving(false);
      setFailure(result);
    }
  }

  const nameMessage =
    failure?.field === 'name'
      ? failure.message
      : nameProblem?.problem === 'TOO_LONG'
        ? `Use ${ANSWER_KEY_NAME_MAX_LENGTH} characters or fewer.`
        : null;
  const subjectMessage = failure?.field === 'subjectId' ? failure.message : null;
  const generalMessage = failure !== null && failure.field !== 'name' && failure.field !== 'subjectId'
    ? failure.message
    : null;

  /** What still stops the save, in the order of the form. */
  const todo: string[] = [];
  if (name.trim().length === 0) todo.push('Enter a name.');
  if (subjectId === null) todo.push('Choose a subject.');
  if (answeredCount < questionCount) {
    todo.push(`${countOf(questionCount - answeredCount, 'question')} without an answer.`);
  }

  return (
    <Modal
      visible
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={requestCancel}>
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <AppBackdrop />
        <View className="min-h-14 justify-center px-4">
          <Text
            role="heading"
            aria-level="1"
            numberOfLines={1}
            className="text-2xl font-semibold leading-8 tracking-tight">
            {TITLES[mode]}
          </Text>
        </View>

        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View className="w-full max-w-2xl gap-5 self-center px-4 pb-6 pt-2">
            {isLocked && (
              <View className="flex-row items-start gap-3 rounded-lg border border-border bg-muted p-3">
                <Icon as={Lock} size={18} className="mt-0.5 text-foreground" />
                <Text className="flex-1 text-sm leading-5">{describeLock(lockedResultCount)}</Text>
              </View>
            )}

            <View className="gap-2">
              <Text className="text-sm font-medium">Name</Text>
              <Input
                value={name}
                onChangeText={(text) => {
                  setName(text);
                  setFailure(null);
                }}
                placeholder="Midterm examination"
                accessibilityLabel="Answer key name"
                aria-invalid={nameMessage !== null}
                autoCapitalize="sentences"
                autoCorrect={false}
                returnKeyType="done"
                editable={!isSaving}
                className={nameMessage !== null ? 'border-destructive' : undefined}
              />
              {nameMessage !== null ? (
                <Text
                  accessibilityLiveRegion="polite"
                  role="alert"
                  className="text-sm leading-5 text-destructive">
                  {nameMessage}
                </Text>
              ) : (
                <Text className="text-sm leading-5 text-muted-foreground">
                  The test this key checks, such as Midterm examination or Quiz 3.
                </Text>
              )}
            </View>

            <View className="gap-2">
              <Text className="text-sm font-medium">Subject</Text>
              <View
                className={cn(
                  'overflow-hidden rounded-lg border bg-card',
                  subjectMessage !== null ? 'border-destructive' : 'border-border'
                )}>
                <ChoiceList
                  label="Subject"
                  options={subjects}
                  selectedId={subjectId}
                  disabled={isLocked || isSaving}
                  onSelect={(chosen) => {
                    setSubjectId(chosen);
                    setFailure(null);
                  }}
                />
              </View>
              {subjectMessage !== null ? (
                <Text
                  accessibilityLiveRegion="polite"
                  role="alert"
                  className="text-sm leading-5 text-destructive">
                  {subjectMessage}
                </Text>
              ) : (
                <Text className="text-sm leading-5 text-muted-foreground">
                  The key can be used with every class that takes this subject.
                </Text>
              )}
            </View>

            <View className="gap-2">
              <Text className="text-sm font-medium">Number of questions</Text>
              <View className="flex-row items-center gap-2">
                <CountStep
                  icon={Minus}
                  label="One question fewer"
                  disabled={isLocked || isSaving || questionCount <= ANSWER_KEY_MIN_QUESTIONS}
                  onPress={() => requestCount(questionCount - 1)}
                />
                <Input
                  value={countText}
                  onChangeText={(text) => setCountText(text.replace(/[^0-9]/g, '').slice(0, 2))}
                  onEndEditing={() => requestCount(Number.parseInt(countText, 10))}
                  accessibilityLabel="Number of questions"
                  keyboardType="number-pad"
                  inputMode="numeric"
                  returnKeyType="done"
                  selectTextOnFocus
                  editable={!isLocked && !isSaving}
                  className="w-20 text-center"
                />
                <CountStep
                  icon={Plus}
                  label="One question more"
                  disabled={isLocked || isSaving || questionCount >= ANSWER_KEY_MAX_QUESTIONS}
                  onPress={() => requestCount(questionCount + 1)}
                />
              </View>
              <Text className="text-sm leading-5 text-muted-foreground">
                From {ANSWER_KEY_MIN_QUESTIONS} to {ANSWER_KEY_MAX_QUESTIONS}.
              </Text>
            </View>

            <View
              className="gap-2"
              onLayout={(event) => {
                answersTop.current = event.nativeEvent.layout.y;
              }}>
              <View className="flex-row items-baseline justify-between gap-3">
                <Text className="text-sm font-medium">Correct answers</Text>
                <Text className="text-sm text-muted-foreground">
                  {answeredCount} of {questionCount} answered
                </Text>
              </View>
              <View className="overflow-hidden rounded-lg border border-border bg-card">
                {answers.map((answer, index) => (
                  <View
                    key={index}
                    onLayout={(event) => {
                      // Measured inside this bordered box, which starts one label row below the section top.
                      rowTops.current[index] = event.nativeEvent.layout.y + 28;
                    }}>
                    <QuestionRow
                      questionNumber={index + 1}
                      answer={answer}
                      isFirst={index === 0}
                      isFlagged={showUnanswered && answer === null}
                      disabled={isLocked || isSaving}
                      onChoose={(choice) => choose(index, choice)}
                    />
                  </View>
                ))}
              </View>
            </View>
          </View>
        </ScrollView>

        <View
          className="gap-3 border-t border-border bg-card px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, keyboardHeight) + 12 }}>
          {generalMessage !== null ? (
            <Text
              accessibilityLiveRegion="polite"
              role="alert"
              className="text-sm leading-5 text-destructive">
              {generalMessage}
            </Text>
          ) : (
            <View className="min-h-11 flex-row items-center gap-3">
              <Text
                accessibilityLiveRegion="polite"
                className="flex-1 text-sm leading-5 text-muted-foreground">
                {todo.length === 0 ? `All ${countOf(questionCount, 'question')} answered.` : todo.join(' ')}
              </Text>
              {firstUnanswered >= 0 && !isLocked && (
                <Button variant="ghost" className="h-11 px-3" onPress={goToFirstUnanswered}>
                  <Text className="text-primary">Go to {firstUnanswered + 1}</Text>
                </Button>
              )}
            </View>
          )}
          <View className="flex-row gap-3">
            <Button
              variant="outline"
              className="h-12 flex-1"
              disabled={isSaving}
              onPress={requestCancel}>
              <Text>Cancel</Text>
            </Button>
            <Button
              className="h-12 flex-1"
              disabled={!canSave}
              aria-disabled={!canSave}
              aria-busy={isSaving}
              onPress={submit}>
              {isSaving && <ActivityIndicator size="small" className="text-primary-foreground" />}
              <Text>{isSaving ? 'Saving' : SAVE_LABELS[mode]}</Text>
            </Button>
          </View>
        </View>

        {pendingCount !== null && (
          <ModalCard onRequestClose={() => setPendingCount(null)}>
            <View className="gap-2">
              <Text role="heading" aria-level="2" className="text-lg font-semibold leading-6">
                Remove questions {pendingCount + 1} to {questionCount}?
              </Text>
              <Text className="text-[15px] leading-[22px] text-muted-foreground">
                The answers chosen for those questions will be discarded.
              </Text>
            </View>
            <View className="flex-row gap-3">
              <Button
                variant="outline"
                className="h-12 flex-1"
                onPress={() => {
                  setPendingCount(null);
                  setCountText(String(questionCount));
                }}>
                <Text>Keep {questionCount}</Text>
              </Button>
              <Button
                variant="destructive"
                className="h-12 flex-1"
                onPress={() => {
                  applyCount(pendingCount);
                  setPendingCount(null);
                }}>
                <Text>Remove</Text>
              </Button>
            </View>
          </ModalCard>
        )}

        {isConfirmingDiscard && (
          <ModalCard onRequestClose={() => setIsConfirmingDiscard(false)}>
            <View className="gap-2">
              <Text role="heading" aria-level="2" className="text-lg font-semibold leading-6">
                {mode === 'edit' ? 'Discard your changes?' : 'Discard this answer key?'}
              </Text>
              <Text className="text-[15px] leading-[22px] text-muted-foreground">
                What you entered has not been saved and will be lost.
              </Text>
            </View>
            <View className="flex-row gap-3">
              <Button
                variant="outline"
                className="h-12 flex-1"
                onPress={() => setIsConfirmingDiscard(false)}>
                <Text>Keep editing</Text>
              </Button>
              <Button variant="destructive" className="h-12 flex-1" onPress={onCancel}>
                <Text>Discard</Text>
              </Button>
            </View>
          </ModalCard>
        )}
      </View>
    </Modal>
  );
}

type CountStepProps = {
  icon: typeof Plus;
  label: string;
  disabled: boolean;
  onPress: () => void;
};

function CountStep({ icon, label, disabled, onPress }: CountStepProps) {
  const { isPressed, pressHandlers } = usePressFeedback();

  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={cn(
        'h-12 w-12 items-center justify-center rounded-md border border-input bg-card web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
        isPressed && 'bg-secondary',
        disabled && 'opacity-40'
      )}>
      <Icon as={icon} size={18} />
    </Pressable>
  );
}

type QuestionRowProps = {
  questionNumber: number;
  answer: AnswerChoice | null;
  isFirst: boolean;
  /** Marks a question that still needs an answer, after the Teacher asked where they are. */
  isFlagged: boolean;
  disabled: boolean;
  onChoose: (choice: AnswerChoice) => void;
};

/** One question: its number and the four bubbles. */
function QuestionRow({
  questionNumber,
  answer,
  isFirst,
  isFlagged,
  disabled,
  onChoose,
}: QuestionRowProps) {
  return (
    <View
      role="radiogroup"
      accessibilityLabel={
        answer === null
          ? `Question ${questionNumber}, not answered`
          : `Question ${questionNumber}, answer ${answer}`
      }
      className={cn(
        'min-h-14 flex-row items-center gap-2 py-1.5 pl-3 pr-2',
        !isFirst && 'border-t border-border',
        isFlagged && 'bg-destructive/10'
      )}>
      <View className="w-16">
        <Text className="text-[15px] font-semibold leading-[22px]">{questionNumber}</Text>
        {isFlagged && <Text className="text-xs leading-4 text-destructive">No answer</Text>}
      </View>
      <View className="flex-1 flex-row justify-between">
        {ANSWER_CHOICES.map((choice) => (
          <Bubble
            key={choice}
            choice={choice}
            questionNumber={questionNumber}
            isSelected={answer === choice}
            disabled={disabled}
            onPress={() => onChoose(choice)}
          />
        ))}
      </View>
    </View>
  );
}

type BubbleProps = {
  choice: AnswerChoice;
  questionNumber: number;
  isSelected: boolean;
  disabled: boolean;
  onPress: () => void;
};

/** A 44dp answer bubble. Chosen: filled, with a heavier letter, not only a color. */
function Bubble({ choice, questionNumber, isSelected, disabled, onPress }: BubbleProps) {
  const { isPressed, pressHandlers } = usePressFeedback();

  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      disabled={disabled}
      hitSlop={{ top: 2, bottom: 2, left: 2, right: 2 }}
      role="radio"
      aria-checked={isSelected}
      accessibilityLabel={`Question ${questionNumber}, ${choice}`}
      className={cn(
        'h-11 w-11 items-center justify-center rounded-full border-2 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
        isSelected ? 'border-primary bg-primary' : 'border-input bg-background',
        isPressed && !isSelected && 'bg-secondary',
        disabled && !isSelected && 'opacity-50'
      )}>
      <Text
        className={cn(
          'text-base leading-5',
          isSelected ? 'font-bold text-primary-foreground' : 'font-medium text-foreground'
        )}>
        {choice}
      </Text>
    </Pressable>
  );
}
