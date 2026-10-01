import { View } from 'react-native';

import { Text } from '@/core/presentation/components/ui/text';
import { cn } from '@/core/presentation/lib/utils';

const CHOICES = ['A', 'B', 'C', 'D'] as const;

type Choice = (typeof CHOICES)[number];

type SampleRow = {
  question: number;
  shaded: readonly Choice[];
  reading: string;
  needsReview: boolean;
};

// Illustrative rows only. They show how a shaded sheet will be read; no scan produced them.
const SAMPLE_ROWS: readonly SampleRow[] = [
  { question: 1, shaded: ['B'], reading: 'B', needsReview: false },
  { question: 2, shaded: [], reading: 'Blank', needsReview: true },
  { question: 3, shaded: ['A', 'C'], reading: 'Two marks', needsReview: true },
];

export function SampleSheet() {
  return (
    <View
      className="rounded-lg border border-border bg-card"
      accessibilityLabel="Example of three answer sheet rows and how each would be read">
      {SAMPLE_ROWS.map((row, index) => (
        <View
          key={row.question}
          className={cn(
            'flex-row items-center gap-3 px-4 py-3',
            index > 0 && 'border-t border-border'
          )}>
          <Text className="w-5 text-sm text-muted-foreground">{row.question}</Text>
          <View className="flex-row gap-2">
            {CHOICES.map((choice) => {
              const isShaded = row.shaded.includes(choice);
              return (
                <View
                  key={choice}
                  className={cn(
                    'h-8 w-8 items-center justify-center rounded-full border',
                    isShaded ? 'border-primary bg-primary' : 'border-input bg-background'
                  )}>
                  <Text
                    className={cn(
                      'text-xs font-medium',
                      isShaded ? 'text-primary-foreground' : 'text-muted-foreground'
                    )}>
                    {choice}
                  </Text>
                </View>
              );
            })}
          </View>
          <Text
            className={cn(
              'flex-1 text-right text-sm font-medium',
              row.needsReview && 'text-accent-foreground'
            )}>
            {row.reading}
          </Text>
        </View>
      ))}
    </View>
  );
}
