import { BlurView } from 'expo-blur';
import type { Tabs } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useEffect, type ComponentProps } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Icon } from '@/core/presentation/components/ui/icon';
import { Text } from '@/core/presentation/components/ui/text';
import { usePressFeedback } from '@/core/presentation/hooks/use-press-feedback';
import { THEME } from '@/core/presentation/lib/theme';
import { cn } from '@/core/presentation/lib/utils';

import { TAB_DESTINATIONS, type Destination } from './destinations';
import {
  TAB_BAR_BOTTOM_GAP,
  TAB_BAR_HEIGHT,
  TAB_BAR_INNER_PADDING,
  TAB_BAR_SIDE_MARGIN,
  TAB_CAPSULE_HEIGHT,
  TAB_CAPSULE_RADIUS,
  TAB_COLLAR_SIZE,
  TAB_DISC_SIZE,
  TAB_INDICATOR_RISE,
  tabBarClearance,
} from './tab-bar-metrics';

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/**
 * Live blur runs on iOS and the web preview. Android uses a translucent tinted
 * surface instead: expo-blur's Android blur needs the blurred content wrapped
 * in a BlurTargetView and only performs well on Android 12+, and it has not
 * been verified on a device. Icons and labels must stay readable either way.
 */
const HAS_LIVE_BLUR = Platform.OS !== 'android';

/** Without blur the surface has to carry more of the contrast itself. */
const SURFACE_CLASS = HAS_LIVE_BLUR ? 'bg-glass/75' : 'bg-glass/90';

// Keeps labels inside the fixed-height capsule when the system font size is raised.
const MAX_LABEL_SCALE = 1.2;

// Wide enough for five 48dp targets with labels; stops the capsule stretching in landscape.
const MAX_BAR_WIDTH = 448;

const RISE_IN = { duration: 180, easing: Easing.out(Easing.cubic) };

const COLLAR_MASK_SIZE = TAB_COLLAR_SIZE - 2;

const styles = StyleSheet.create({
  // Centered in its tab slot by layout alone: half the slot's width in, half its
  // own width back. No measured widths or translation math are involved, so it
  // cannot drift from the icon and label column it belongs to.
  indicator: {
    position: 'absolute',
    top: 0,
    left: '50%',
    marginLeft: -TAB_COLLAR_SIZE / 2,
    width: TAB_COLLAR_SIZE,
    height: TAB_COLLAR_SIZE,
  },
  capsule: {
    height: TAB_CAPSULE_HEIGHT,
    borderRadius: TAB_CAPSULE_RADIUS,
    // boxShadow, unlike Android elevation, does not show through a translucent surface.
    boxShadow: '0 8 24 0 rgba(0, 0, 0, 0.28)',
  },
  capsuleSurface: {
    borderRadius: TAB_CAPSULE_RADIUS,
  },
  // Opaque disc in the bar's surface color, slightly smaller than the collar.
  // It hides the capsule's top border everywhere under the indicator.
  collarMask: {
    position: 'absolute',
    left: 1,
    top: 1,
    width: COLLAR_MASK_SIZE,
    height: COLLAR_MASK_SIZE,
    borderRadius: COLLAR_MASK_SIZE / 2,
  },
  // Shows only the part of the bordered collar that is above the capsule's edge.
  collarClip: {
    height: TAB_INDICATOR_RISE,
    overflow: 'hidden',
  },
  collar: {
    width: TAB_COLLAR_SIZE,
    height: TAB_COLLAR_SIZE,
    borderRadius: TAB_COLLAR_SIZE / 2,
  },
  disc: {
    position: 'absolute',
    left: (TAB_COLLAR_SIZE - TAB_DISC_SIZE) / 2,
    top: (TAB_COLLAR_SIZE - TAB_DISC_SIZE) / 2,
    width: TAB_DISC_SIZE,
    height: TAB_DISC_SIZE,
    borderRadius: TAB_DISC_SIZE / 2,
  },
});

/**
 * Fades the screen into its background behind the floating bar, so content
 * scrolling underneath does not compete with the tab icons and labels.
 */
function BottomScrim({ height }: { height: number }) {
  const { colorScheme } = useColorScheme();
  const color = THEME[colorScheme === 'dark' ? 'dark' : 'light'].background;

  return (
    <View pointerEvents="none" className="absolute bottom-0 left-0 right-0" style={{ height }}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="tabBarScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0} />
            <Stop offset="0.55" stopColor={color} stopOpacity={0.85} />
            <Stop offset="1" stopColor={color} stopOpacity={0.96} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#tabBarScrim)" />
      </Svg>
    </View>
  );
}

/**
 * The raised marker of the current tab, rendered inside that tab's slot. From
 * back to front: an opaque disc in the bar's surface color that hides the
 * capsule's border beneath it; the collar's border, drawn only above the
 * capsule's edge so the capsule outline appears to curve up and around; and
 * the pink disc with the tab's icon. It rises into place when its tab becomes
 * current. Purely visual: the tab owns the press and the selected state.
 */
function RaisedIndicator({ icon }: { icon: LucideIcon }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    progress.value = reduceMotion ? 1 : withTiming(1, RISE_IN);
  }, [progress, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 8 }],
  }));

  return (
    // Positioned with style, not classes: NativeWind classes are not applied to Animated.View.
    <Animated.View pointerEvents="none" style={[styles.indicator, style]}>
      <View style={styles.collarMask} className="bg-glass" />
      <View style={styles.collarClip}>
        <View style={styles.collar} className="border border-glass-border/30" />
      </View>
      <View style={styles.disc} className="items-center justify-center bg-primary">
        <Icon as={icon} size={21} strokeWidth={2.25} className="text-primary-foreground" />
      </View>
    </Animated.View>
  );
}

type TabItemProps = {
  destination: Destination;
  isActive: boolean;
  onPress: () => void;
};

/**
 * One tab. Every tab, Scan included, looks the same when it is not current:
 * a neutral outline icon and label on a transparent background. When current,
 * the raised indicator replaces its in-bar icon and its label turns bolder, so
 * selection shows through position, shape, weight, and color together. The
 * touch target is the full height of the bar and never moves.
 */
function TabItem({ destination, isActive, onPress }: TabItemProps) {
  const { isPressed, pressHandlers } = usePressFeedback();

  return (
    <Pressable
      onPress={onPress}
      {...pressHandlers}
      accessibilityRole="tab"
      accessibilityLabel={destination.title}
      accessibilityState={{ selected: isActive }}
      aria-selected={isActive}
      className="group min-w-[48px] flex-1 items-center justify-end gap-0.5 pb-2 web:outline-none"
      style={{ height: TAB_BAR_HEIGHT }}>
      {isActive && <RaisedIndicator icon={destination.icon} />}
      <View
        className={cn(
          'h-8 w-10 items-center justify-center rounded-md web:group-focus-visible:ring-2 web:group-focus-visible:ring-ring',
          // Only while a finger is down, and never on the current tab.
          isPressed && !isActive && 'bg-foreground/10'
        )}>
        {!isActive && (
          <Icon
            as={destination.icon}
            size={21}
            strokeWidth={1.75}
            className="text-muted-foreground"
          />
        )}
      </View>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_LABEL_SCALE}
        className={cn(
          'text-[11px] leading-[14px]',
          isActive ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground'
        )}>
        {destination.tabLabel}
      </Text>
    </Pressable>
  );
}

/**
 * Floating glass tab bar with a raised indicator over the current tab. It sits
 * above the bottom safe-area inset, so it never overlaps Android's gesture or
 * navigation area. Screens pad their content with tabBarClearance() so the last
 * item can scroll completely above it.
 */
export function BottomTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { colorScheme } = useColorScheme();
  const activeRoute = state.routes[state.index]?.name;

  return (
    <>
      <BottomScrim height={tabBarClearance(insets.bottom) + 24} />
      <View
        pointerEvents="box-none"
        className="absolute left-0 right-0 items-center"
        style={{
          bottom: insets.bottom + TAB_BAR_BOTTOM_GAP,
          paddingLeft: insets.left + TAB_BAR_SIDE_MARGIN,
          paddingRight: insets.right + TAB_BAR_SIDE_MARGIN,
        }}>
        <View className="w-full" style={{ maxWidth: MAX_BAR_WIDTH, height: TAB_BAR_HEIGHT }}>
          {/* Capsule surface. The shadow is on this wrapper because the surface clips its blur. */}
          <View
            pointerEvents="none"
            className="absolute bottom-0 left-0 right-0"
            style={styles.capsule}>
            <View
              className="flex-1 overflow-hidden border border-glass-border/30"
              style={styles.capsuleSurface}>
              {HAS_LIVE_BLUR && (
                <BlurView
                  intensity={50}
                  tint={colorScheme === 'dark' ? 'dark' : 'light'}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <View style={StyleSheet.absoluteFill} className={SURFACE_CLASS} />
              {/* Inner highlight along the top edge. */}
              <View className="absolute left-6 right-6 top-0 h-px bg-foreground/10" />
            </View>
          </View>

          {/* Five equal slots across the width left after the capsule's inner padding. */}
          <View
            accessibilityRole="tablist"
            className="flex-1 flex-row"
            style={{ paddingHorizontal: TAB_BAR_INNER_PADDING }}>
            {TAB_DESTINATIONS.map((destination) => {
              const route = state.routes.find((candidate) => candidate.name === destination.route);
              if (!route) return null;

              const isActive = destination.route === activeRoute;
              const onPress = () => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!isActive && !event.defaultPrevented) {
                  navigation.navigate(route.name, route.params);
                }
              };

              return (
                <TabItem
                  key={destination.route}
                  destination={destination}
                  isActive={isActive}
                  onPress={onPress}
                />
              );
            })}
          </View>
        </View>
      </View>
    </>
  );
}
