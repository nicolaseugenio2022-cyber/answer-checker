import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import CircleDashed from 'lucide-react-native/icons/circle-dashed';
import CircleX from 'lucide-react-native/icons/circle-x';
import ImageOff from 'lucide-react-native/icons/image-off';
import Pencil from 'lucide-react-native/icons/pencil';
import Trash from 'lucide-react-native/icons/trash';
import ZoomIn from 'lucide-react-native/icons/zoom-in';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackdrop } from '@/core/presentation/components/app-backdrop';
import { Callout } from '@/core/presentation/components/callout';
import { FilterChip } from '@/core/presentation/components/filter-chip';
import { ModalCard } from '@/core/presentation/components/modal-card';
import { Button } from '@/core/presentation/components/ui/button';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { cn } from '@/core/presentation/lib/utils';
import { ResultNotFoundError } from '@/features/results/application/results-ports';
import type { OpenedResult } from '@/features/results/application/results-use-cases';
import {
  answersInView,
  tallyAnswers,
  type AnswerView,
  type ResultAnswer,
  type ResultDetail,
} from '@/features/results/domain/result';
import {
  formatAttempt,
  formatFullDate,
  formatPercentage,
  formatScore,
} from '@/features/results/presentation/result-format';
import { useResultsUseCases } from '@/features/results/presentation/results-use-cases-context';
import { ScanImageViewer } from '@/features/results/presentation/scan-image-viewer';

type ResultDetailDialogProps = {
  resultId: string;
  onClose: () => void;
  /** The result was deleted permanently (or was found to be gone already). */
  onDeleted: (studentName: string | null) => void;
};

type Loaded =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'gone' }
  | { status: 'ready'; opened: OpenedResult };

/** An A4 sheet: every stored scan has this shape. */
const SHEET_ASPECT = 210 / 297;

const DELETE_WARNING =
  'This permanently deletes this result, its question answers, and its stored scan image. This cannot be undone.';

/** What the reader concluded, said plainly. Null when it simply read the answer that was scored. */
function describeDetection(answer: ResultAnswer): string | null {
  switch (answer.detectedState) {
    case 'BLANK':
      return answer.finalAnswer === null ? null : 'Read as blank';
    case 'MULTIPLE':
      return 'Read as more than one mark';
    case 'UNCLEAR':
      return 'Read as unclear';
    default:
      return answer.detectedAnswer !== answer.finalAnswer
        ? `Read as ${answer.detectedAnswer}`
        : null;
  }
}

/**
 * One saved result, read-only: who and what it was saved under, its score,
 * the stored scan, and every question. Nothing here can be edited; a wrong
 * result is deleted permanently and the sheet is scanned again.
 * Mount it only while it is open.
 */
export function ResultDetailDialog({ resultId, onClose, onDeleted }: ResultDetailDialogProps) {
  const results = useResultsUseCases();
  const insets = useSafeAreaInsets();
  const { isPressed, pressHandlers } = usePressFeedback();

  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<AnswerView>('all');
  const [isViewingImage, setIsViewingImage] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteFailure, setDeleteFailure] = useState<string | null>(null);
  // State updates are not immediate; this stops a second tap in the same frame.
  const isSubmitting = useRef(false);

  useEffect(() => {
    if (!results) return;
    let isCurrent = true;
    results.getResult(resultId).then(
      (opened) => {
        if (isCurrent) setLoaded(opened ? { status: 'ready', opened } : { status: 'gone' });
      },
      (error) => {
        console.error(error);
        if (isCurrent) setLoaded({ status: 'failed' });
      }
    );
    return () => {
      isCurrent = false;
    };
  }, [results, resultId, attempt]);

  const result = loaded.status === 'ready' ? loaded.opened.result : null;
  const imageUri = loaded.status === 'ready' && !imageFailed ? loaded.opened.imageUri : null;

  async function deletePermanently(target: ResultDetail) {
    if (!results || isSubmitting.current) return;
    isSubmitting.current = true;
    setIsDeleting(true);
    setDeleteFailure(null);
    try {
      await results.deleteResult(target.id);
      onDeleted(target.studentName);
    } catch (error) {
      // Already gone is the outcome that was asked for.
      if (error instanceof ResultNotFoundError) {
        onDeleted(target.studentName);
        return;
      }
      console.error(error);
      const message = 'The result could not be deleted. Nothing was removed. Try again.';
      isSubmitting.current = false;
      setIsDeleting(false);
      setDeleteFailure(message);
      AccessibilityInfo.announceForAccessibility(message);
    }
  }

  return (
    <Modal
      visible
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => {
        if (!isDeleting) onClose();
      }}>
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <AppBackdrop />
        <View className="min-h-14 flex-row items-center gap-1 px-4">
          <Pressable
            onPress={onClose}
            {...pressHandlers}
            disabled={isDeleting}
            accessibilityRole="button"
            accessibilityLabel="Back to results"
            className={cn(
              '-ml-3 h-12 w-12 items-center justify-center rounded-md web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
              isPressed && 'bg-foreground/10'
            )}>
            <Icon as={ArrowLeft} size={22} />
          </Pressable>
          <Text
            role="heading"
            aria-level="1"
            numberOfLines={1}
            maxFontSizeMultiplier={1.4}
            className="flex-1 text-2xl font-semibold leading-8 tracking-tight">
            Result
          </Text>
        </View>

        {loaded.status === 'loading' && (
          <View accessible accessibilityLabel="Loading" className="flex-row items-center gap-3 p-4">
            <ActivityIndicator className="text-primary" />
            <Text className="text-sm text-muted-foreground">Loading</Text>
          </View>
        )}

        {loaded.status === 'failed' && (
          <View className="p-4">
            <Callout
              icon={CircleAlert}
              tone="error"
              title="The result could not be loaded"
              action={
                <Button
                  variant="outline"
                  className="h-12 self-start"
                  onPress={() => {
                    setLoaded({ status: 'loading' });
                    setAttempt((current) => current + 1);
                  }}>
                  <Text>Try again</Text>
                </Button>
              }>
              Nothing was changed.
            </Callout>
          </View>
        )}

        {loaded.status === 'gone' && (
          <View className="p-4">
            <Callout
              icon={CircleAlert}
              title="This result no longer exists"
              action={
                <Button variant="outline" className="h-12 self-start" onPress={() => onDeleted(null)}>
                  <Text>Back to results</Text>
                </Button>
              }>
              It was deleted permanently.
            </Callout>
          </View>
        )}

        {result && (
          <>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              <View className="w-full max-w-2xl gap-5 self-center px-4 pb-6 pt-2">
                <Identity result={result} />
                <ScoreSummary result={result} />

                <View className="gap-2.5">
                  <Text variant="h4" aria-level="2" className="text-base">
                    Scanned sheet
                  </Text>
                  {imageUri ? (
                    <Pressable
                      onPress={() => setIsViewingImage(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Open the scanned sheet larger"
                      className="overflow-hidden rounded-lg border border-border bg-card web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring">
                      {/* The whole sheet, never cropped: the box has the sheet's own shape. */}
                      <View className="h-64 items-center bg-muted py-2">
                        <Image
                          source={{ uri: imageUri }}
                          accessible={false}
                          resizeMode="contain"
                          onError={() => setImageFailed(true)}
                          style={{ height: '100%', aspectRatio: SHEET_ASPECT }}
                        />
                      </View>
                      <View className="min-h-12 flex-row items-center gap-2 px-3">
                        <Icon as={ZoomIn} size={18} className="text-muted-foreground" />
                        <Text className="text-sm font-medium">Open larger</Text>
                      </View>
                    </Pressable>
                  ) : (
                    <View
                      accessible
                      className="flex-row items-center gap-3 rounded-lg border border-border bg-card p-4">
                      <Icon as={ImageOff} size={20} className="text-muted-foreground" />
                      <View className="flex-1">
                        <Text className="text-[15px] font-medium leading-[22px]">
                          Stored scan image is unavailable
                        </Text>
                        <Text className="text-sm leading-5 text-muted-foreground">
                          The score and the answers below are complete without it.
                        </Text>
                      </View>
                    </View>
                  )}
                </View>

                <Answers answers={result.answers} view={view} onChangeView={setView} />

                <View className="gap-1 border-t border-border pt-4">
                  <Text className="text-xs font-medium text-muted-foreground">Technical details</Text>
                  <Text className="text-[13px] leading-[18px] text-muted-foreground">
                    Answer sheet {result.templateId}. Saved {formatFullDate(result.createdAt)}.
                  </Text>
                  <Text className="text-[13px] leading-[18px] text-muted-foreground">
                    A saved result cannot be edited. If it is wrong, delete it and scan the sheet
                    again.
                  </Text>
                </View>
              </View>
            </ScrollView>

            <View
              className="border-t border-border bg-background px-4 pt-3"
              style={{ paddingBottom: insets.bottom + 12 }}>
              <Button
                variant="outline"
                className="h-12 w-full max-w-2xl self-center border-destructive/50"
                onPress={() => {
                  setDeleteFailure(null);
                  setIsConfirming(true);
                }}>
                <Icon as={Trash} size={18} className="text-destructive" />
                <Text className="text-destructive">Delete permanently</Text>
              </Button>
            </View>
          </>
        )}
      </View>

      {result && isViewingImage && imageUri && (
        <ScanImageViewer
          uri={imageUri}
          aspectRatio={SHEET_ASPECT}
          description={`Scanned answer sheet of ${result.studentName}`}
          onClose={() => setIsViewingImage(false)}
          onError={() => {
            setIsViewingImage(false);
            setImageFailed(true);
          }}
        />
      )}

      {result && isConfirming && (
        <ModalCard
          onRequestClose={() => {
            if (!isDeleting) setIsConfirming(false);
          }}>
          <View className="gap-3">
            <Text role="heading" aria-level="2" className="text-lg font-semibold leading-6">
              Delete this result?
            </Text>
            <View className="gap-1 rounded-lg bg-muted p-3">
              <Text className="text-[15px] font-semibold leading-[22px]">{result.studentName}</Text>
              <Fact label="Student ID" value={result.studentNumber} />
              <Fact label="Answer key" value={result.answerKeyName} />
              <Fact label="Scanned" value={formatFullDate(result.capturedAt)} />
              <Fact
                label="Score"
                value={`${formatScore(result.score, result.total)} (${formatPercentage(result.score, result.total)})`}
              />
              {formatAttempt(result.attempt) !== null && (
                <Fact label="Attempt" value={`${result.attempt.number} of ${result.attempt.count}`} />
              )}
            </View>
            <Text className="text-[15px] leading-[22px]">{DELETE_WARNING}</Text>
            {deleteFailure !== null && (
              <Text role="alert" className="text-sm leading-5 text-destructive">
                {deleteFailure}
              </Text>
            )}
          </View>
          <View className="flex-row gap-3">
            <Button
              variant="outline"
              className="h-12 flex-1"
              disabled={isDeleting}
              onPress={() => setIsConfirming(false)}>
              <Text>Cancel</Text>
            </Button>
            <Button
              variant="destructive"
              className="h-12 flex-1"
              disabled={isDeleting}
              aria-busy={isDeleting}
              accessibilityLabel={`Delete the result of ${result.studentName} permanently`}
              onPress={() => void deletePermanently(result)}>
              {isDeleting && <ActivityIndicator size="small" className="text-white" />}
              <Text>{isDeleting ? 'Deleting' : 'Delete'}</Text>
            </Button>
          </View>
        </ModalCard>
      )}
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row gap-2">
      <Text className="w-24 text-sm leading-5 text-muted-foreground">{label}</Text>
      <Text className="flex-1 text-sm font-medium leading-5">{value}</Text>
    </View>
  );
}

/** Who and what the result was saved under: the names at the time of the scan. */
function Identity({ result }: { result: ResultDetail }) {
  const attempt = formatAttempt(result.attempt);
  return (
    <View
      accessible
      accessibilityLabel={`Result of ${result.studentName}, Student ID ${result.studentNumber}, class ${result.className}, subject ${result.subjectName}, answer key ${result.answerKeyName}, scanned ${formatFullDate(result.capturedAt)}${attempt ? `, ${attempt}` : ''}. Names are as they were when the sheet was scanned.`}
      className="gap-3 rounded-lg border border-border bg-card p-4">
      <View>
        <Text className="text-xl font-semibold leading-7">{result.studentName}</Text>
        <Text className="text-[15px] leading-[22px] text-muted-foreground">
          Student ID {result.studentNumber}
        </Text>
      </View>
      <View className="gap-1.5 border-t border-border pt-3">
        <Fact label="Class" value={result.className} />
        <Fact label="Subject" value={result.subjectName} />
        <Fact label="Answer key" value={result.answerKeyName} />
        <Fact label="Scanned" value={formatFullDate(result.capturedAt)} />
        {attempt !== null && (
          <Fact label="Attempt" value={`${result.attempt.number} of ${result.attempt.count}`} />
        )}
      </View>
      <Text className="text-[13px] leading-[18px] text-muted-foreground">
        Names are shown as they were when the sheet was scanned.
      </Text>
    </View>
  );
}

/** The score and how the questions divide. Every count has a label and an icon, never a color alone. */
function ScoreSummary({ result }: { result: ResultDetail }) {
  const tally = tallyAnswers(result.answers);
  return (
    <View className="gap-3 rounded-lg border border-border bg-card p-4">
      <View
        accessible
        accessibilityLabel={`Score ${result.score} of ${result.total}, ${formatPercentage(result.score, result.total)}`}
        className="flex-row items-end justify-between gap-3">
        <View>
          <Text className="text-xs font-medium text-muted-foreground">Score</Text>
          <Text className="text-3xl font-semibold leading-9">
            {result.score}
            <Text className="text-xl font-medium text-muted-foreground"> / {result.total}</Text>
          </Text>
        </View>
        <Text className="text-xl font-semibold leading-7">
          {formatPercentage(result.score, result.total)}
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-x-4 gap-y-3 border-t border-border pt-3">
        <Count icon={CircleCheck} label="Correct" value={tally.correct} iconClassName="text-primary" />
        <Count icon={CircleX} label="Incorrect" value={tally.incorrect} iconClassName="text-destructive" />
        <Count icon={CircleDashed} label="Blank" value={tally.blank} iconClassName="text-muted-foreground" />
        <Count
          icon={Pencil}
          label="Manually corrected"
          value={tally.manuallyCorrected}
          iconClassName="text-muted-foreground"
        />
      </View>
    </View>
  );
}

type CountProps = { icon: typeof CircleCheck; label: string; value: number; iconClassName: string };

function Count({ icon, label, value, iconClassName }: CountProps) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      className="min-w-[44%] flex-1 flex-row items-center gap-2">
      <Icon as={icon} size={18} className={iconClassName} />
      <Text className="flex-1 text-sm leading-5 text-muted-foreground">{label}</Text>
      <Text className="text-[15px] font-semibold leading-[22px]">{value}</Text>
    </View>
  );
}

const VIEWS: { view: AnswerView; label: string }[] = [
  { view: 'all', label: 'All' },
  { view: 'incorrect', label: 'Incorrect' },
  { view: 'blank', label: 'Blank' },
  { view: 'corrected', label: 'Manually corrected' },
];

type AnswersProps = {
  answers: readonly ResultAnswer[];
  view: AnswerView;
  onChangeView: (view: AnswerView) => void;
};

/** Every question as it was scored, with a filter. Read-only. */
function Answers({ answers, view, onChangeView }: AnswersProps) {
  const shown = answersInView(answers, view);
  return (
    <View className="gap-3">
      <Text variant="h4" aria-level="2" className="text-base">
        Questions
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View role="radiogroup" accessibilityLabel="Which questions to show" className="flex-row gap-2">
          {VIEWS.map((option) => (
            <FilterChip
              key={option.view}
              label={`${option.label} (${answersInView(answers, option.view).length})`}
              isSelected={view === option.view}
              onPress={() => onChangeView(option.view)}
            />
          ))}
        </View>
      </ScrollView>

      {shown.length === 0 ? (
        <Text accessibilityLiveRegion="polite" className="py-3 text-sm leading-5 text-muted-foreground">
          No questions of this kind in this result.
        </Text>
      ) : (
        <View className="overflow-hidden rounded-lg border border-border bg-card">
          {shown.map((answer, index) => (
            <AnswerRow key={answer.questionNumber} answer={answer} isFirst={index === 0} />
          ))}
        </View>
      )}
    </View>
  );
}

function AnswerRow({ answer, isFirst }: { answer: ResultAnswer; isFirst: boolean }) {
  const isBlank = answer.finalAnswer === null;
  const status = answer.isCorrect ? 'Correct' : isBlank ? 'Blank, not correct' : 'Incorrect';
  const detection = describeDetection(answer);
  const confidence =
    answer.confidence === null ? null : `Reader confidence ${Math.round(answer.confidence * 100)}%`;

  return (
    <View
      accessible
      accessibilityLabel={[
        `Question ${answer.questionNumber}`,
        isBlank ? 'Answer: blank' : `Answer: ${answer.finalAnswer}`,
        `Correct answer: ${answer.correctAnswer}`,
        status,
        detection,
        answer.manuallyCorrected ? 'Manually corrected' : null,
        confidence,
      ]
        .filter(Boolean)
        .join('. ')}
      className={cn('min-h-14 flex-row items-center gap-3 px-3 py-2', !isFirst && 'border-t border-border')}>
      <Text className="w-8 text-[15px] font-semibold leading-[22px] text-muted-foreground">
        {answer.questionNumber}
      </Text>
      <View className="flex-1 gap-0.5">
        <View className="flex-row flex-wrap items-baseline gap-x-3">
          <Text className="text-[15px] font-semibold leading-[22px]">
            {isBlank ? 'Blank' : answer.finalAnswer}
          </Text>
          <Text className="text-[13px] leading-[18px] text-muted-foreground">
            Correct answer {answer.correctAnswer}
          </Text>
        </View>
        {(detection !== null || answer.manuallyCorrected) && (
          <Text className="text-[13px] leading-[18px]">
            {[detection, answer.manuallyCorrected ? 'Manually corrected' : null]
              .filter(Boolean)
              .join('. ')}
          </Text>
        )}
        {confidence !== null && (
          <Text className="text-xs leading-4 text-muted-foreground">{confidence}</Text>
        )}
      </View>
      <View className="flex-row items-center gap-1.5">
        <Icon
          as={answer.isCorrect ? CircleCheck : isBlank ? CircleDashed : CircleX}
          size={18}
          className={
            answer.isCorrect ? 'text-primary' : isBlank ? 'text-muted-foreground' : 'text-destructive'
          }
        />
        <Text className="text-sm font-medium leading-5">
          {answer.isCorrect ? 'Correct' : isBlank ? 'Blank' : 'Incorrect'}
        </Text>
      </View>
    </View>
  );
}
