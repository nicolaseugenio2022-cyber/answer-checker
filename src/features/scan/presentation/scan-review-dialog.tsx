import Check from 'lucide-react-native/icons/check';
import X from 'lucide-react-native/icons/x';
import { useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackdrop } from '@/core/presentation/components/app-backdrop';
import { FilterChip } from '@/core/presentation/components/filter-chip';
import { ModalCard } from '@/core/presentation/components/modal-card';
import { Button } from '@/core/presentation/components/ui/button';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { countOf } from '@/core/presentation/lib/describe-name-error';
import { cn } from '@/core/presentation/lib/utils';
import { ANSWER_CHOICES, type AnswerChoice } from '@/features/answer-keys/domain/answer-key';
import type { PreviousAttempt } from '@/features/scan/application/scan-ports';
import type { ScanDraft } from '@/features/scan/application/scan-use-cases';
import {
  countStates,
  reviewState,
  setReviewAnswer,
  unresolvedCount,
  type ReviewItem,
  type ReviewState,
} from '@/features/scan/domain/detection';
import { previewScore } from '@/features/scan/domain/scoring';
import { bubbleCenter, type SheetTemplate } from '@/features/scan/domain/template';

export type ReviewSaveOutcome =
  /** Saved: the parent closes the review. */
  | { kind: 'saved' }
  /** The student already has a result with this key; ask before saving another. */
  | { kind: 'duplicate'; previous: PreviousAttempt[] }
  /** Not saved. `canRetry` is false when the sheet must be scanned again. */
  | { kind: 'failed'; title: string; message: string; canRetry: boolean };

type ScanReviewDialogProps = {
  draft: ScanDraft;
  /** Scores and saves the reviewed sheet. */
  onSave: (review: ReviewItem[], confirmDuplicate: boolean) => Promise<ReviewSaveOutcome>;
  /** Throw this scan away and take the photo again. */
  onRetake: () => void;
  /** Throw this scan away and leave. */
  onCancel: () => void;
};

const STATE_LABELS: Record<ReviewState, string> = {
  marked: 'Read',
  blank: 'Blank',
  multiple: 'More than one mark',
  unclear: 'Unclear',
  manually_corrected: 'Set by you',
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The review of one read sheet. It shows who and what the result will be
 * saved under, every question with what was read, and lets the Teacher set
 * any answer. Nothing is stored until Save, and Save stays off while a
 * question read as blank, multiple, or unclear has not been decided.
 * Mount it only while it is open.
 */
export function ScanReviewDialog({ draft, onSave, onRetake, onCancel }: ScanReviewDialogProps) {
  const insets = useSafeAreaInsets();
  const { target } = draft;
  const correct = target.answerKey.answers;

  const [review, setReview] = useState<ReviewItem[]>(draft.review);
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(false);
  const [leaving, setLeaving] = useState<'retake' | 'cancel' | null>(null);
  const [duplicate, setDuplicate] = useState<PreviousAttempt[] | null>(null);
  const [failure, setFailure] = useState<{ title: string; message: string; canRetry: boolean } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // State updates are not immediate; this stops a second tap in the same frame.
  const isSubmitting = useRef(false);

  const waiting = unresolvedCount(review);
  const counts = countStates(review);
  const score = previewScore(review, correct);
  // A question that needed review stays in the filtered list after it is decided, so it does not jump away.
  const needsReview = (item: ReviewItem) => item.detection.state !== 'marked';
  const shown = onlyNeedsReview ? review.filter(needsReview) : review;
  const flaggedCount = review.filter(needsReview).length;
  const canSave = waiting === 0 && !isSaving && (failure === null || failure.canRetry);

  async function save(confirmDuplicate: boolean) {
    if (waiting > 0 || isSubmitting.current) return;
    isSubmitting.current = true;
    setIsSaving(true);
    setFailure(null);
    setDuplicate(null);
    const outcome = await onSave(review, confirmDuplicate);
    if (outcome.kind === 'saved') return;
    isSubmitting.current = false;
    setIsSaving(false);
    if (outcome.kind === 'duplicate') setDuplicate(outcome.previous);
    else setFailure(outcome);
  }

  function choose(questionNumber: number, answer: AnswerChoice | null) {
    if (isSaving) return;
    setFailure((current) => (current?.canRetry ? null : current));
    setReview((current) => setReviewAnswer(current, questionNumber, answer));
  }

  return (
    <Modal
      visible
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => {
        if (!isSaving) setLeaving('cancel');
      }}>
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <AppBackdrop />
        <View className="min-h-14 justify-center px-4">
          <Text
            role="heading"
            aria-level="1"
            numberOfLines={1}
            className="text-2xl font-semibold leading-8 tracking-tight">
            Review scan
          </Text>
        </View>

        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <View className="w-full max-w-2xl gap-5 self-center px-4 pb-6 pt-2">
            {/* Who and what this result is saved under: read from the Teacher's choices, never from the sheet. */}
            <View
              accessible
              accessibilityLabel={`This result is for ${target.student.fullName}, Student ID ${target.student.studentNumber}, class ${target.className}, subject ${target.subjectName}, answer key ${target.answerKey.name}.`}
              className="gap-3 rounded-lg border-2 border-primary/50 bg-card p-4">
              <View>
                <Text className="text-xs font-medium text-muted-foreground">This result is for</Text>
                <Text className="text-xl font-semibold leading-7">{target.student.fullName}</Text>
                <Text className="text-[15px] leading-[22px] text-muted-foreground">
                  Student ID {target.student.studentNumber}
                </Text>
              </View>
              <View className="gap-1.5 border-t border-border pt-3">
                <Fact label="Class" value={target.className} />
                <Fact label="Subject" value={target.subjectName} />
                <Fact label="Answer key" value={target.answerKey.name} />
                <Fact label="Answer sheet" value={`${countOf(draft.template.questionCount, 'question')} (${draft.templateId})`} />
              </View>
            </View>

            <View className="flex-row items-center gap-4 rounded-lg border border-border bg-card p-4">
              <View accessible accessibilityLabel={`Score so far: ${score.score} of ${score.total}`}>
                <Text className="text-xs font-medium text-muted-foreground">Score</Text>
                <Text className="text-3xl font-semibold leading-9">
                  {score.score}
                  <Text className="text-xl font-medium text-muted-foreground"> / {score.total}</Text>
                </Text>
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="text-sm leading-5">
                  {countOf(correct.length, 'question')} checked: {counts.marked} read, {counts.blank}{' '}
                  blank, {counts.multiple} with more than one mark, {counts.unclear} unclear.
                </Text>
                {waiting > 0 && (
                  <Text className="text-sm font-medium leading-5 text-destructive">
                    {countOf(waiting, 'question')} still {waiting === 1 ? 'needs' : 'need'} your decision.
                  </Text>
                )}
              </View>
            </View>

            <View className="gap-2.5">
              <Text variant="h4" aria-level="2" className="text-base">
                The sheet as it was read
              </Text>
              <View
                className="overflow-hidden rounded-lg border border-border bg-card"
                style={{ aspectRatio: draft.template.page.width / draft.template.page.height }}>
                <Image
                  source={{ uri: draft.previewUri }}
                  accessibilityLabel="The scanned answer sheet, straightened"
                  resizeMode="contain"
                  style={{ width: '100%', height: '100%' }}
                />
                {/* A ring on the bubble that will be scored for each question. */}
                {review.map((item) =>
                  item.finalAnswer === null ? null : (
                    <AnswerRing
                      template={draft.template}
                      key={item.questionNumber}
                      questionNumber={item.questionNumber}
                      answer={item.finalAnswer}
                      isCorrect={item.finalAnswer === correct[item.questionNumber - 1]}
                    />
                  )
                )}
              </View>
              <Text className="text-sm leading-5 text-muted-foreground">
                A solid ring marks a correct answer, a dashed ring an incorrect one.
              </Text>
            </View>

            <View className="gap-2.5">
              <Text variant="h4" aria-level="2" className="text-base">
                Answers
              </Text>
              <View role="radiogroup" accessibilityLabel="Show" className="flex-row gap-2">
                <FilterChip
                  label={`All ${review.length}`}
                  isSelected={!onlyNeedsReview}
                  onPress={() => setOnlyNeedsReview(false)}
                />
                <FilterChip
                  label={`Needs review ${flaggedCount}`}
                  isSelected={onlyNeedsReview}
                  onPress={() => setOnlyNeedsReview(true)}
                />
              </View>
              {shown.length === 0 ? (
                <Text className="text-sm leading-5 text-muted-foreground">
                  Every question was read as one clear mark. Nothing needs review.
                </Text>
              ) : (
                <View className="overflow-hidden rounded-lg border border-border bg-card">
                  {shown.map((item, index) => (
                    <ReviewRow
                      key={item.questionNumber}
                      item={item}
                      correctAnswer={correct[item.questionNumber - 1]}
                      isFirst={index === 0}
                      disabled={isSaving}
                      onChoose={(answer) => choose(item.questionNumber, answer)}
                    />
                  ))}
                </View>
              )}
            </View>
          </View>
        </ScrollView>

        <View
          className="gap-3 border-t border-border bg-card px-4 pt-3"
          style={{ paddingBottom: insets.bottom + 12 }}>
          {failure !== null ? (
            <View accessibilityLiveRegion="polite" role="alert" className="gap-0.5">
              <Text className="text-sm font-semibold leading-5 text-destructive">{failure.title}</Text>
              <Text className="text-sm leading-5 text-destructive">{failure.message}</Text>
            </View>
          ) : (
            <Text accessibilityLiveRegion="polite" className="text-sm leading-5 text-muted-foreground">
              {waiting > 0
                ? `Decide ${countOf(waiting, 'question')} marked for review before saving.`
                : `Ready to save ${score.score} of ${score.total} for ${target.student.fullName}.`}
            </Text>
          )}
          <View className="flex-row gap-2">
            <Button
              variant="outline"
              className="h-12 px-4"
              disabled={isSaving}
              onPress={() => setLeaving('cancel')}>
              <Text>Cancel</Text>
            </Button>
            <Button
              variant="outline"
              className="h-12 px-4"
              disabled={isSaving}
              onPress={() => setLeaving('retake')}>
              <Text>Retake</Text>
            </Button>
            <Button
              className="h-12 flex-1"
              disabled={!canSave}
              aria-disabled={!canSave}
              aria-busy={isSaving}
              onPress={() => void save(false)}>
              {isSaving && <ActivityIndicator size="small" className="text-primary-foreground" />}
              <Text>{isSaving ? 'Saving' : 'Save result'}</Text>
            </Button>
          </View>
        </View>

        {leaving !== null && (
          <ModalCard onRequestClose={() => setLeaving(null)}>
            <View className="gap-2">
              <Text role="heading" aria-level="2" className="text-lg font-semibold leading-6">
                {leaving === 'retake' ? 'Take the photo again?' : 'Discard this scan?'}
              </Text>
              <Text className="text-[15px] leading-[22px] text-muted-foreground">
                This scan has not been saved. The photo and your review of it will be discarded.
              </Text>
            </View>
            <View className="flex-row gap-3">
              <Button variant="outline" className="h-12 flex-1" onPress={() => setLeaving(null)}>
                <Text>Keep reviewing</Text>
              </Button>
              <Button
                variant="destructive"
                className="h-12 flex-1"
                onPress={leaving === 'retake' ? onRetake : onCancel}>
                <Text>{leaving === 'retake' ? 'Retake' : 'Discard'}</Text>
              </Button>
            </View>
          </ModalCard>
        )}

        {duplicate !== null && (
          <ModalCard onRequestClose={() => setDuplicate(null)}>
            <View className="gap-2">
              <Text role="heading" aria-level="2" className="text-lg font-semibold leading-6">
                {target.student.fullName} already has a result for this answer key
              </Text>
              {duplicate.map((attempt) => (
                <Text key={attempt.id} className="text-[15px] leading-[22px]">
                  {attempt.score} of {attempt.total}, saved {formatDate(attempt.createdAt)}
                </Text>
              ))}
              <Text className="text-[15px] leading-[22px] text-muted-foreground">
                Saving now adds this scan as another attempt. The earlier{' '}
                {duplicate.length === 1 ? 'result is' : 'results are'} kept and not changed.
              </Text>
            </View>
            <View className="gap-3">
              <Button variant="outline" className="h-12" onPress={() => setDuplicate(null)}>
                <Text>Do not save</Text>
              </Button>
              <Button className="h-12" onPress={() => void save(true)}>
                <Text>Save as another attempt</Text>
              </Button>
            </View>
          </ModalCard>
        )}
      </View>
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row gap-3">
      <Text className="w-24 text-sm leading-5 text-muted-foreground">{label}</Text>
      <Text className="flex-1 text-sm font-medium leading-5">{value}</Text>
    </View>
  );
}

/** A ring over one bubble of the sheet picture, placed by the template's own geometry. */
function AnswerRing({
  template,
  questionNumber,
  answer,
  isCorrect,
}: {
  template: SheetTemplate;
  questionNumber: number;
  answer: AnswerChoice;
  isCorrect: boolean;
}) {
  const center = bubbleCenter(template, questionNumber, answer);
  const diameter = template.bubbleRadius * 2.9;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no"
      className={cn('absolute rounded-full border-2 border-primary', !isCorrect && 'border-dashed')}
      style={{
        left: `${((center.x - diameter / 2) / template.page.width) * 100}%`,
        top: `${((center.y - diameter / 2) / template.page.height) * 100}%`,
        width: `${(diameter / template.page.width) * 100}%`,
        aspectRatio: 1,
      }}
    />
  );
}

type ReviewRowProps = {
  item: ReviewItem;
  correctAnswer: AnswerChoice;
  isFirst: boolean;
  disabled: boolean;
  onChoose: (answer: AnswerChoice | null) => void;
};

/** One question: what was read, the correct answer, and the five choices A, B, C, D, Blank. */
function ReviewRow({ item, correctAnswer, isFirst, disabled, onChoose }: ReviewRowProps) {
  const state = reviewState(item);
  const isCorrect = item.isResolved && item.finalAnswer === correctAnswer;
  const answerText = item.finalAnswer ?? 'blank';
  const summary = !item.isResolved
    ? `Question ${item.questionNumber}. ${STATE_LABELS[state]}. Needs your decision. Correct answer ${correctAnswer}.`
    : `Question ${item.questionNumber}. Answer ${answerText}, ${isCorrect ? 'correct' : 'incorrect'}. Correct answer ${correctAnswer}. ${STATE_LABELS[state]}.`;

  return (
    <View
      className={cn(
        'gap-2 px-3 py-2.5',
        !isFirst && 'border-t border-border',
        !item.isResolved && 'bg-destructive/10'
      )}>
      <View accessible accessibilityLabel={summary} className="flex-row items-center gap-2">
        <Text className="w-8 text-[15px] font-semibold leading-[22px]">{item.questionNumber}</Text>
        <Text
          className={cn(
            'flex-1 text-sm leading-5',
            item.isResolved ? 'text-muted-foreground' : 'font-medium text-destructive'
          )}>
          {item.isResolved ? STATE_LABELS[state] : `${STATE_LABELS[state]}: choose`}
        </Text>
        <Text className="text-sm leading-5 text-muted-foreground">Key {correctAnswer}</Text>
        {item.isResolved && (
          <View
            className={cn(
              'h-6 w-6 items-center justify-center rounded-full',
              isCorrect ? 'bg-primary' : 'border-2 border-muted-foreground'
            )}>
            <Icon
              as={isCorrect ? Check : X}
              size={14}
              strokeWidth={3}
              className={isCorrect ? 'text-primary-foreground' : 'text-muted-foreground'}
            />
          </View>
        )}
      </View>
      <View
        role="radiogroup"
        accessibilityLabel={`Answer for question ${item.questionNumber}`}
        className="flex-row items-center gap-2 pl-8">
        {ANSWER_CHOICES.map((choice) => (
          <ChoiceButton
            key={choice}
            label={choice}
            accessibilityLabel={`Question ${item.questionNumber}, ${choice}`}
            isSelected={item.isResolved && item.finalAnswer === choice}
            disabled={disabled}
            onPress={() => onChoose(choice)}
          />
        ))}
        <ChoiceButton
          label="Blank"
          accessibilityLabel={`Question ${item.questionNumber}, blank`}
          isSelected={item.isResolved && item.finalAnswer === null}
          isWide
          disabled={disabled}
          onPress={() => onChoose(null)}
        />
      </View>
    </View>
  );
}

type ChoiceButtonProps = {
  label: string;
  accessibilityLabel: string;
  isSelected: boolean;
  isWide?: boolean;
  disabled: boolean;
  onPress: () => void;
};

/** A 44dp choice. Chosen: filled, with a heavier letter, not only a color. */
function ChoiceButton({
  label,
  accessibilityLabel,
  isSelected,
  isWide = false,
  disabled,
  onPress,
}: ChoiceButtonProps) {
  const { isPressed, pressHandlers } = usePressFeedback();

  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      disabled={disabled}
      hitSlop={{ top: 2, bottom: 2 }}
      role="radio"
      aria-checked={isSelected}
      accessibilityLabel={accessibilityLabel}
      className={cn(
        'h-11 items-center justify-center rounded-full border-2 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
        isWide ? 'px-4' : 'w-11',
        isSelected ? 'border-primary bg-primary' : 'border-input bg-background',
        isPressed && !isSelected && 'bg-secondary',
        disabled && 'opacity-60'
      )}>
      <Text
        className={cn(
          isWide ? 'text-sm leading-5' : 'text-base leading-5',
          isSelected ? 'font-bold text-primary-foreground' : 'font-medium text-foreground'
        )}>
        {label}
      </Text>
    </Pressable>
  );
}
