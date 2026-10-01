import { useColorScheme } from 'nativewind';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { THEME } from '@/core/presentation/lib/theme';

/**
 * Two soft pink glows behind a screen: one at the top, one low on the
 * opposite side. They give the translucent surfaces something to show through.
 * Static and drawn once, so they cost nothing while scrolling.
 */
export function AppBackdrop() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const color = THEME[isDark ? 'dark' : 'light'].primary;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="topGlow" cx="88%" cy="0%" r="75%">
            <Stop offset="0" stopColor={color} stopOpacity={isDark ? 0.3 : 0.2} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="lowGlow" cx="0%" cy="100%" r="70%">
            <Stop offset="0" stopColor={color} stopOpacity={isDark ? 0.18 : 0.12} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="50%" fill="url(#topGlow)" />
        <Rect x="0" y="55%" width="100%" height="45%" fill="url(#lowGlow)" />
      </Svg>
    </View>
  );
}
