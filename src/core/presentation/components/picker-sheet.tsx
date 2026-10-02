import Check from 'lucide-react-native/icons/check';
import X from 'lucide-react-native/icons/x';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GLASS_CLASSES } from '@/core/presentation/components/glass-surface';
import { SearchField } from '@/core/presentation/components/search-field';
import { Button } from '@/core/presentation/components/ui/button';
import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { useKeyboardHeight } from '@/core/presentation/hooks/use-keyboard-height';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { cn } from '@/core/presentation/lib/utils';

export type PickerOption = {
  id: string;
  /** The main line, and what the search looks in. */
  name: string;
  /** A second line, such as a Student ID. Also searched. */
  detail?: string;
  /** A short tag at the end of the row, such as "Scanned". */
  tag?: string;
  /** When set, the option cannot be chosen and this explains why. */
  disabledReason?: string;
};

/** What the sheet says when there is nothing to choose from, and what to do about it. */
export type PickerEmptyState = {
  title: string;
  message: string;
  action?: { label: string; onPress: () => void };
};

type PickerSheetProps = {
  /** What is being chosen, as an instruction: "Choose answer key". */
  title: string;
  /** What the list was narrowed by, such as "Subject: Mathematics". */
  context?: string;
  searchPlaceholder: string;
  options: readonly PickerOption[];
  selectedId: string | null;
  empty: PickerEmptyState;
  onSelect: (id: string) => void;
  /** Android back, a tap outside, the close button, or dragging the sheet down. */
  onClose: () => void;
};

/** The sheet takes this share of the screen height at least and at most. */
const MIN_HEIGHT_SHARE = 0.65;
const MAX_HEIGHT_SHARE = 0.8;
/** Dragging the sheet down this far, or flicking it, closes it. */
const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 0.9;
/** Approximate heights in dp, used only to size the sheet to its list. */
const HEADER_HEIGHT = 84;
const SEARCH_HEIGHT = 60;
const ROW_HEIGHT = 61;

const normalize = (text: string) => text.normalize('NFC').toLowerCase();

/**
 * A single-choice picker in a sheet that rises from the bottom, above the tab
 * bar. Choosing closes it. Android back, a tap outside, the close button, and
 * dragging it down all leave the choice as it was. The search field stays above
 * the list and filters the given options as the Teacher types; what was typed
 * is gone the next time the sheet opens. Screen-reader focus moves
 * to its title when it opens; the screen that opened it puts focus back.
 * Mount it only while it is open.
 */
export function PickerSheet({
  title,
  context,
  searchPlaceholder,
  options,
  selectedId,
  empty,
  onSelect,
  onClose,
}: PickerSheetProps) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const reduceMotion = useReducedMotion();
  const [search, setSearch] = useState('');
  const { isPressed, pressHandlers } = usePressFeedback();
  const titleRef = useRef<View>(null);

  // With the keyboard open the sheet uses the room above it.
  const room = window.height - keyboardHeight - insets.top - 16;
  const maxHeight = Math.min(window.height * MAX_HEIGHT_SHARE, room);
  const minHeight = Math.min(window.height * MIN_HEIGHT_SHARE, maxHeight);
  // Tall enough for its list, within those bounds; a long list scrolls inside.
  const contentHeight =
    HEADER_HEIGHT + SEARCH_HEIGHT + options.length * ROW_HEIGHT + insets.bottom + 12;
  const height = Math.max(minHeight, Math.min(maxHeight, contentHeight));

  // The sheet rises in; under reduced motion it is simply there.
  const offset = useSharedValue(reduceMotion ? 0 : window.height * 0.4);
  useEffect(() => {
    offset.set(withTiming(0, { duration: reduceMotion ? 0 : 240 }));
  }, [offset, reduceMotion]);
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }));

  useEffect(() => {
    // After the sheet is drawn, so the screen reader finds the title.
    const timer = setTimeout(() => {
      const node = titleRef.current;
      if (!node) return;
      if (Platform.OS === 'web') (node as unknown as { focus?: () => void }).focus?.();
      else AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  // The handle and the title drag the sheet; the list below them scrolls.
  const drag = useMemo(
    () =>
      PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_, gesture) => {
        offset.set(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY) onClose();
        else offset.set(withTiming(0, { duration: 160 }));
      },
      onPanResponderTerminate: () => {
        offset.set(withTiming(0, { duration: 160 }));
      },
    }),
    [offset, onClose]
  );

  const wanted = normalize(search.trim());
  const shown =
    wanted.length === 0
      ? options
      : options.filter(
          (option) =>
            normalize(option.name).includes(wanted) ||
            (option.detail !== undefined && normalize(option.detail).includes(wanted))
        );

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ paddingBottom: keyboardHeight }}>
        {/* The scrim: dims the screen and the tab bar, and cancels when tapped. */}
        <Pressable
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
          className="absolute inset-0 bg-black/60"
        />
        <Animated.View style={[{ height }, sheetStyle]}>
          {/* An opaque base under the glass, so the scrim never shows through the list. */}
          <View
            accessibilityViewIsModal
            className="flex-1 overflow-hidden rounded-t-3xl bg-background">
            <View
              className={cn('flex-1 rounded-t-3xl border-b-0', GLASS_CLASSES)}
              style={{ paddingBottom: keyboardHeight > 0 ? 8 : insets.bottom + 12 }}>
              <View {...drag.panHandlers}>
                <View
                  accessible={false}
                  importantForAccessibility="no"
                  className="items-center pb-1 pt-2.5">
                  <View className="h-1 w-9 rounded-full bg-foreground/25" />
                </View>
                <View className="flex-row items-start gap-2 pb-2 pl-5 pr-2">
                  {/* One stop for a screen reader: what to choose, and from what. */}
                  <View
                    ref={titleRef}
                    accessible
                    role="heading"
                    aria-level="2"
                    tabIndex={-1}
                    accessibilityLabel={context === undefined ? title : `${title}. ${context}`}
                    className="flex-1 pt-1.5 web:outline-none">
                    <Text className="text-xl font-semibold leading-7">{title}</Text>
                    {context !== undefined && (
                      <Text numberOfLines={1} className="text-sm leading-5 text-muted-foreground">
                        {context}
                      </Text>
                    )}
                  </View>
                  <Pressable
                    onPress={onClose}
                    {...pressHandlers}
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    className={cn(
                      'h-12 w-12 items-center justify-center rounded-full web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
                      isPressed && 'bg-foreground/10'
                    )}>
                    <Icon as={X} size={20} className="text-muted-foreground" />
                  </Pressable>
                </View>
              </View>

              {options.length === 0 ? (
                <View className="flex-1 items-center justify-center gap-2 px-8 pb-8">
                  <Text className="text-center text-base font-semibold leading-6">{empty.title}</Text>
                  <Text className="text-center text-[15px] leading-[22px] text-muted-foreground">
                    {empty.message}
                  </Text>
                  {empty.action && (
                    <Button size="lg" className="mt-3 h-12" onPress={empty.action.onPress}>
                      <Text>{empty.action.label}</Text>
                    </Button>
                  )}
                </View>
              ) : (
                <>
                  {/* Outside the scrolling list, so it stays in place while results scroll. */}
                  <View className="px-4 pb-3">
                    <SearchField
                      value={search}
                      onChangeText={setSearch}
                      placeholder={searchPlaceholder}
                      accessibilityLabel={searchPlaceholder}
                    />
                  </View>
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    className="border-t border-glass-border/15">
                    <View role="radiogroup" accessibilityLabel={title}>
                      {shown.length === 0 ? (
                        <View
                          accessible
                          accessibilityLiveRegion="polite"
                          className="items-center gap-1 px-8 py-10">
                          <Text className="text-center text-base font-semibold leading-6">
                            No matches
                          </Text>
                          <Text className="text-center text-[15px] leading-[22px] text-muted-foreground">
                            Nothing here matches “{search.trim()}”. Check the spelling or clear the
                            search.
                          </Text>
                        </View>
                      ) : (
                        shown.map((option, index) => (
                          <PickerRow
                            key={option.id}
                            option={option}
                            isFirst={index === 0}
                            isSelected={option.id === selectedId}
                            onPress={() => onSelect(option.id)}
                          />
                        ))
                      )}
                    </View>
                  </ScrollView>
                </>
              )}
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

type PickerRowProps = {
  option: PickerOption;
  isFirst: boolean;
  isSelected: boolean;
  onPress: () => void;
};

/** One choice, the full width of the sheet. The chosen one carries a check, not only a color. */
function PickerRow({ option, isFirst, isSelected, onPress }: PickerRowProps) {
  const { isPressed, pressHandlers } = usePressFeedback();
  const isDisabled = option.disabledReason !== undefined;
  const secondary = option.disabledReason ?? option.detail;

  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      disabled={isDisabled}
      role="radio"
      aria-checked={isSelected}
      aria-disabled={isDisabled}
      accessibilityLabel={[option.name, secondary, option.tag].filter(Boolean).join('. ')}
      className={cn(
        'min-h-[60px] flex-row items-center gap-3 px-5 py-2 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring',
        !isFirst && 'border-t border-glass-border/15',
        isSelected && 'bg-primary/10',
        isPressed && 'bg-foreground/10'
      )}>
      <View className={cn('flex-1', isDisabled && 'opacity-60')}>
        <Text
          numberOfLines={2}
          className={cn('text-base leading-[22px]', isSelected ? 'font-semibold' : 'font-medium')}>
          {option.name}
        </Text>
        {secondary !== undefined && (
          <Text numberOfLines={2} className="text-[13px] leading-[18px] text-muted-foreground">
            {secondary}
          </Text>
        )}
      </View>
      {option.tag !== undefined && (
        <View className="rounded-full border border-border bg-muted px-2 py-0.5">
          <Text className="text-xs font-medium text-muted-foreground">{option.tag}</Text>
        </View>
      )}
      <View className="h-6 w-6 items-center justify-center">
        {isSelected && <Icon as={Check} size={20} strokeWidth={3} className="text-primary" />}
      </View>
    </Pressable>
  );
}
