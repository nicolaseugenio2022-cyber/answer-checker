import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { LoadingPhase } from '@/core/presentation/lib/loading-gate';
import { cn } from '@/core/presentation/lib/utils';

/**
 * One grey bar that stands where a piece of content will be. Give it the size
 * of that content with `className` ("h-4 w-24"). It is a tint of the text
 * color, so it reads on the light, the dark, and the glass surfaces alike.
 * Use it inside a `SkeletonRegion`, which animates it and speaks for it.
 */
export function Skeleton({ className }: { className?: string }) {
  return <View className={cn('rounded-md bg-foreground/10', className)} />;
}

type SkeletonRegionProps = {
  /** What is loading, for a screen reader: "Loading students". */
  label: string;
  children: ReactNode;
  className?: string;
};

/**
 * Holds the skeleton of one screen or section. The region itself is announced
 * once, as busy; the bars inside are decoration and hidden from accessibility.
 * The whole region breathes slowly. With reduced motion it is still.
 */
export function SkeletonRegion({ label, children, className }: SkeletonRegionProps) {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} aria-busy>
      <SkeletonPulse className={className}>{children}</SkeletonPulse>
    </View>
  );
}

/**
 * The slow breathing of a skeleton, without a name of its own: for bars that
 * stand inside a control that already says what it is, such as a count card
 * on Home. Hidden from accessibility. Still when reduced motion is on.
 */
export function SkeletonPulse({ children, className }: { children: ReactNode; className?: string }) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      opacity.set(1);
      return;
    }
    opacity.set(
      withRepeat(
        withSequence(withTiming(0.45, { duration: 700 }), withTiming(1, { duration: 700 })),
        -1
      )
    );
    return () => cancelAnimation(opacity);
  }, [opacity, reduceMotion]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  return (
    <Animated.View style={style}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className={className}>
        {children}
      </View>
    </Animated.View>
  );
}

type PendingProps = {
  phase: LoadingPhase;
  label: string;
  /** The skeleton: bars laid out like the content that is coming. */
  children: ReactNode;
  className?: string;
};

/**
 * What a screen draws in place of content that is not ready: nothing for the
 * first moment, then the skeleton. Render it while the phase is not "content".
 */
export function Pending({ phase, label, children, className }: PendingProps) {
  if (phase !== 'skeleton') return null;
  return (
    <SkeletonRegion label={label} className={className}>
      {children}
    </SkeletonRegion>
  );
}

type SkeletonRowsProps = {
  rows?: number;
  /** A short bar at the end of each row, where a score, a count, or buttons will be. */
  hasTrailing?: boolean;
  /** Text lines per row. */
  lines?: 1 | 2 | 3;
};

/** A list of rows inside a card, like the lists of records the app shows. */
export function SkeletonRows({ rows = 5, hasTrailing = false, lines = 2 }: SkeletonRowsProps) {
  return (
    <View className="overflow-hidden rounded-lg border border-border bg-card">
      {Array.from({ length: rows }, (_, row) => (
        <View
          key={row}
          className={cn(
            'min-h-14 flex-row items-center gap-3 px-3 py-3',
            row > 0 && 'border-t border-border'
          )}>
          <View className="flex-1 gap-2">
            {/* Widths vary a little so the list does not look like a grid. */}
            <Skeleton className={cn('h-3.5', row % 2 === 0 ? 'w-1/2' : 'w-2/5')} />
            {lines >= 2 && <Skeleton className={cn('h-3', row % 2 === 0 ? 'w-3/5' : 'w-2/3')} />}
            {lines >= 3 && <Skeleton className="h-3 w-1/3" />}
          </View>
          {hasTrailing && <Skeleton className="h-4 w-12" />}
        </View>
      ))}
    </View>
  );
}

/** A search field and a row of filter chips, as above the lists that have them. */
export function SkeletonListControls({ chips = 3 }: { chips?: number }) {
  return (
    <View className="gap-3">
      <Skeleton className="h-12 w-full" />
      <View className="flex-row gap-2">
        {Array.from({ length: chips }, (_, chip) => (
          <Skeleton key={chip} className="h-11 w-24 rounded-full" />
        ))}
      </View>
    </View>
  );
}

/**
 * A small spinner for a screen that already shows its content and is reading
 * it again. Render it only while the refresh phase is "skeleton": a refresh
 * that finishes at once shows nothing.
 */
export function RefreshIndicator({ phase }: { phase: LoadingPhase }) {
  if (phase !== 'skeleton') return null;
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Refreshing" aria-busy>
      <ActivityIndicator size="small" className="text-muted-foreground" />
    </View>
  );
}
