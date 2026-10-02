import { View } from 'react-native';

import { Button } from '@/core/presentation/components/ui/button';
import { Text } from '@/core/presentation/components/ui/text';
import { getStartupMarks } from '@/core/presentation/lib/startup-marks';

type StartupStalledProps = {
  /** Starts the app's content over. The stored data is not touched. */
  onRetry: () => void;
};

/**
 * Shown over the app when its start has not finished after a generous wait.
 * It replaces a splash screen that would otherwise stay forever, says how far
 * the start got, and offers to try again. The start underneath keeps going:
 * if it finishes after all, this goes away by itself.
 *
 * It is not an error screen. A start that fails shows the error boundary's
 * message at once; this is for a start that neither finishes nor fails.
 */
export function StartupStalled({ onRetry }: StartupStalledProps) {
  const marks = getStartupMarks();
  return (
    <View className="absolute inset-0 items-center justify-center gap-4 bg-background p-6">
      <View accessible accessibilityRole="alert" className="gap-2">
        <Text role="heading" aria-level="1" className="text-center text-xl font-semibold leading-7">
          Answer Checker is taking long to start
        </Text>
        <Text className="text-center text-[15px] leading-[22px] text-muted-foreground">
          It is still trying. Nothing was deleted. You can wait, or try again.
        </Text>
      </View>
      <Button className="h-12" onPress={onRetry}>
        <Text>Try again</Text>
      </Button>
      {/* How far the start got: the last line is the step it is waiting on. */}
      <View className="w-full max-w-sm gap-1 rounded-lg border border-border bg-card p-3">
        <Text className="text-xs font-medium text-muted-foreground">Start-up steps reached</Text>
        {marks.map((mark) => (
          <Text key={mark.name} className="text-[13px] leading-[18px]">
            {mark.at} ms: {mark.name}
            {mark.duration === undefined ? '' : ` (${mark.duration} ms)`}
            {mark.count > 1 ? `, ${mark.count} times` : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}
