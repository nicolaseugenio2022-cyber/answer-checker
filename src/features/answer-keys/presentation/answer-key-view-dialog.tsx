import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackdrop } from '@/core/presentation/components/app-backdrop';
import { Button } from '@/core/presentation/components/ui/button';
import { Text } from '@/core/presentation/components/ui/text';
import { countOf } from '@/core/presentation/lib/describe-name-error';
import type { AnswerKeyDetails } from '@/features/answer-keys/application/answer-key-repository';

type AnswerKeyViewDialogProps = {
  answerKey: AnswerKeyDetails;
  onClose: () => void;
};

/** How an answer key reports its use. Shared with the list rows. */
export function describeUse(resultCount: number): string {
  return resultCount === 0 ? 'Not used yet' : `Used by ${countOf(resultCount, 'saved result')}`;
}

/** A read-only view of one answer key: every question with its correct answer, in order. */
export function AnswerKeyViewDialog({ answerKey, onClose }: AnswerKeyViewDialogProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}>
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <AppBackdrop />
        <View className="min-h-14 justify-center px-4">
          <Text
            role="heading"
            aria-level="1"
            numberOfLines={2}
            className="text-2xl font-semibold leading-8 tracking-tight">
            {answerKey.name}
          </Text>
        </View>

        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <View className="w-full max-w-2xl gap-5 self-center px-4 pb-6 pt-2">
            <View className="overflow-hidden rounded-lg border border-border bg-card">
              <Fact label="Subject" value={answerKey.subjectName} isFirst />
              <Fact label="Questions" value={String(answerKey.questionCount)} />
              <Fact label="Use" value={describeUse(answerKey.resultCount)} />
            </View>

            <View className="gap-2.5">
              <Text variant="h4" aria-level="2" className="text-base">
                Correct answers
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {answerKey.answers.map((answer, index) => (
                  <View
                    key={index}
                    accessible
                    accessibilityLabel={`Question ${index + 1}, ${answer}`}
                    className="h-12 w-[72px] flex-row items-center justify-between rounded-lg border border-border bg-card pl-3 pr-1.5">
                    <Text className="text-sm text-muted-foreground">{index + 1}</Text>
                    <View className="h-9 w-9 items-center justify-center rounded-full bg-primary">
                      <Text className="text-base font-bold leading-5 text-primary-foreground">
                        {answer}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </ScrollView>

        <View
          className="border-t border-border bg-card px-4 pt-3"
          style={{ paddingBottom: insets.bottom + 12 }}>
          <Button variant="outline" className="h-12" onPress={onClose}>
            <Text>Close</Text>
          </Button>
        </View>
      </View>
    </Modal>
  );
}

function Fact({ label, value, isFirst }: { label: string; value: string; isFirst?: boolean }) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      className={
        isFirst
          ? 'min-h-11 flex-row items-center gap-3 px-3 py-2'
          : 'min-h-11 flex-row items-center gap-3 border-t border-border px-3 py-2'
      }>
      <Text className="text-sm leading-5 text-muted-foreground">{label}</Text>
      <Text className="flex-1 text-right text-sm font-medium leading-5">{value}</Text>
    </View>
  );
}
