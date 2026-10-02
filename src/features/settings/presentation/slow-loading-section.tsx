import { useSyncExternalStore } from 'react';
import { View } from 'react-native';

import { FilterChip } from '@/core/presentation/components/filter-chip';
import { Text } from '@/core/presentation/components/ui/text';
import {
  getArtificialLoadingMs,
  setArtificialLoading,
  subscribeToArtificialLoading,
} from '@/core/presentation/lib/artificial-loading';

const CHOICES = [
  { label: 'Off', ms: 0 },
  { label: '2 seconds', ms: 2000 },
  { label: '5 seconds', ms: 5000 },
];

/**
 * Makes every loading skeleton stay on screen for a while, so each one can be
 * looked at. Local reads are otherwise too fast to see them. It slows no
 * query and no file operation: only the skeletons linger. Shown only in
 * development builds; a release build renders nothing and cannot turn it on.
 * It is not stored: it is off again when the app restarts.
 */
export function SlowLoadingSection() {
  const current = useSyncExternalStore(
    subscribeToArtificialLoading,
    getArtificialLoadingMs,
    getArtificialLoadingMs
  );

  if (!__DEV__) return null;

  return (
    <View className="gap-3">
      <Text variant="h4" aria-level="2" className="text-base">
        Loading skeletons
      </Text>
      <View className="gap-3 rounded-lg border border-border bg-card p-4">
        <Text className="text-sm leading-5">
          Hold every loading skeleton on screen, to check how each one looks. Open a screen after
          choosing a time. Nothing real is slowed down.
        </Text>
        <View role="radiogroup" accessibilityLabel="Skeleton time" className="flex-row flex-wrap gap-2">
          {CHOICES.map((choice) => (
            <FilterChip
              key={choice.ms}
              label={choice.label}
              isSelected={current === choice.ms}
              onPress={() => setArtificialLoading(choice.ms, __DEV__)}
            />
          ))}
        </View>
        <Text className="text-sm text-muted-foreground">
          This section appears only in development builds and resets when the app restarts.
        </Text>
      </View>
    </View>
  );
}
