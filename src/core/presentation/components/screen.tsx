import type { PropsWithChildren, ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackdrop } from '@/core/presentation/components/app-backdrop';
import { ScreenHeader } from '@/core/presentation/components/screen-header';
import { tabBarClearance } from '@/core/presentation/navigation/tab-bar-metrics';

type ScreenProps = PropsWithChildren<{
  /** Shows the compact header with this title. Omit on Home, which draws its own. */
  title?: string;
  /** Adds a back button to the header, for screens opened from Home. */
  showBack?: boolean;
  /** Drawn over the scrolling body and not scrolled with it, such as a `Notice`. */
  overlay?: ReactNode;
}>;

/**
 * A screen inside the tab shell: status-bar inset, optional compact header, and
 * a scrolling body, all drawn over the app backdrop. The tab bar floats over
 * the scene, so the body ends with exactly enough room for its last item to
 * scroll clear of the bar and the gesture area.
 */
export function Screen({ children, title, showBack, overlay }: ScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-1"
      style={{ paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
      <AppBackdrop />
      {title !== undefined && <ScreenHeader title={title} showBack={showBack} />}
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {/*
          The spacing lives on this plain View, not on the ScrollView's content
          container. On Android, NativeWind's contentContainerClassName replaced
          contentContainerStyle, which silently dropped the bottom clearance and
          left the last content stuck behind the tab bar.
        */}
        <View
          className="w-full max-w-2xl gap-5 self-center px-4"
          style={{
            paddingTop: title === undefined ? 12 : 8,
            paddingBottom: tabBarClearance(insets.bottom),
          }}>
          {children}
        </View>
      </ScrollView>
      {overlay}
    </View>
  );
}
