import Check from 'lucide-react-native/icons/check';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import X from 'lucide-react-native/icons/x';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  ReduceMotion,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { cn } from '@/core/presentation/lib/utils';
import {
  TAB_BAR_CONTENT_GAP,
  TAB_BAR_SIDE_MARGIN,
  tabBarClearance,
} from '@/core/presentation/navigation/tab-bar-metrics';

export type NoticeMessage = {
  /** Changes for every new notice, so repeating the same text shows again. */
  id: number;
  /** `success`: the action is done. `error`: it did not happen, or something is wrong. */
  tone: 'success' | 'error';
  text: string;
};

/** Errors stay longer: they carry something the Teacher has to read and act on. */
const VISIBLE_MS = { success: 3000, error: 6000 } as const;

const ENTER_MS = 220;
const EXIT_MS = 180;

const styles = StyleSheet.create({
  // boxShadow, as on the tab bar: Android elevation shows through a translucent surface.
  shadow: {
    borderRadius: 16,
    boxShadow: '0 6 18 0 rgba(0, 0, 0, 0.18)',
  },
});

/**
 * The app's one in-app notification: a small glass card that floats just above
 * the tab bar, over the scrolling content, without moving it. Success is pink
 * with a check; an error uses the destructive color and an alert icon, so the
 * two differ by icon as well as by color.
 *
 * Pass it to `Screen` as `overlay`, keyed by `notice.id`: a new notice then
 * replaces the current one, so notices never stack. It closes itself, and the
 * close button closes it sooner. It is not a live region: the caller announces
 * the text once with AccessibilityInfo, which avoids a double announcement.
 */
export function Notice({ notice, onDismiss }: { notice: NoticeMessage; onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { isPressed, pressHandlers } = usePressFeedback();
  const isError = notice.tone === 'error';

  useEffect(() => {
    const timer = setTimeout(onDismiss, VISIBLE_MS[notice.tone]);
    return () => clearTimeout(timer);
  }, [onDismiss, notice.tone]);

  // With reduced motion the notice only fades; it does not slide.
  const entering = reduceMotion
    ? FadeIn.duration(ENTER_MS).reduceMotion(ReduceMotion.Never)
    : FadeInDown.duration(ENTER_MS);

  return (
    <Animated.View
      entering={entering}
      exiting={FadeOut.duration(EXIT_MS).reduceMotion(ReduceMotion.Never)}
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: TAB_BAR_SIDE_MARGIN,
        right: TAB_BAR_SIDE_MARGIN,
        // The end of the scrolling content: above the bar, its raised collar, and the gesture area.
        bottom: tabBarClearance(insets.bottom) - TAB_BAR_CONTENT_GAP + 8,
        alignItems: 'center',
      }}>
      <View className="w-full max-w-md" style={styles.shadow}>
        <View
          className={cn(
            'min-h-14 flex-row items-center gap-3 overflow-hidden rounded-2xl border bg-glass/95 py-1 pl-3 pr-1',
            isError ? 'border-destructive/50' : 'border-primary/35'
          )}>
          {/* Highlight along the top edge, as on the tab bar. */}
          <View
            className={cn(
              'absolute left-5 right-5 top-0 h-px',
              isError ? 'bg-destructive/30' : 'bg-primary/30'
            )}
          />
          <View
            className={cn(
              'h-8 w-8 items-center justify-center rounded-full',
              isError ? 'bg-destructive/15' : 'bg-primary'
            )}>
            <Icon
              as={isError ? CircleAlert : Check}
              size={isError ? 18 : 16}
              strokeWidth={isError ? 2 : 3}
              className={isError ? 'text-destructive' : 'text-primary-foreground'}
            />
          </View>
          <Text className="flex-1 py-2 text-sm font-medium leading-5 text-foreground">
            {notice.text}
          </Text>
          <Pressable
            onPress={onDismiss}
            {...pressHandlers}
            accessibilityRole="button"
            accessibilityLabel="Dismiss message"
            className={cn(
              'h-12 w-12 items-center justify-center rounded-xl web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
              isPressed && 'bg-foreground/10'
            )}>
            <Icon as={X} size={18} className="text-muted-foreground" />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}
